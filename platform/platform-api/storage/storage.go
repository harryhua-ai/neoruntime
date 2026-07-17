package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"

	"aipc/platform/common/logger"
)

// ModelStorage manages model binary files using Content Addressable Storage (CAS).
type ModelStorage struct {
	blobDir      string // directory for hash-named blobs
	minFreeBytes uint64 // minimum free disk space to allow writes
}

// HEFInfo holds metadata extracted from a HEF file via hailortcli.
type HEFInfo struct {
	NetworkName string   `json:"network_name"`
	RawOutput   string   `json:"raw_output"`
	VStreams    []string `json:"vstreams,omitempty"`
	InputWidth  int      `json:"input_width"`  // Extracted from input vstream shape
	InputHeight int      `json:"input_height"` // Extracted from input vstream shape
}

// NewModelStorage creates a ModelStorage backed by the given blob directory.
func NewModelStorage(blobDir string, minFreeBytes uint64) (*ModelStorage, error) {
	if err := os.MkdirAll(blobDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create blob directory %s: %w", blobDir, err)
	}
	return &ModelStorage{
		blobDir:      blobDir,
		minFreeBytes: minFreeBytes,
	}, nil
}

// SaveResult is returned by SaveWithHash on success.
type SaveResult struct {
	Hash    string // hex-encoded SHA256
	Path    string // absolute path to the blob file
	Size    int64  // file size in bytes
	Existed bool   // true if the blob already existed (dedup)
}

// SaveWithHash streams the reader content to a temporary file, computes SHA256,
// and atomically renames it to blobs/<hash><ext>. Returns dedup info.
func (s *ModelStorage) SaveWithHash(r io.Reader, ext string) (*SaveResult, error) {
	// Check disk quota before writing
	if err := s.CheckQuota(0); err != nil {
		return nil, err
	}

	// Write to temp file while computing hash
	tmpFile, err := os.CreateTemp(s.blobDir, "upload-*.tmp")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		// Clean up temp file on any error path
		tmpFile.Close()
		os.Remove(tmpPath)
	}()

	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)

	written, err := io.Copy(writer, r)
	if err != nil {
		return nil, fmt.Errorf("failed to write model data: %w", err)
	}
	tmpFile.Close()

	hash := hex.EncodeToString(hasher.Sum(nil))
	blobName := hash + ext
	blobPath := filepath.Join(s.blobDir, blobName)

	// Check if blob already exists (dedup)
	if _, err := os.Stat(blobPath); err == nil {
		// Already exists — remove temp and return existing
		os.Remove(tmpPath)
		return &SaveResult{
			Hash:    hash,
			Path:    blobPath,
			Size:    written,
			Existed: true,
		}, nil
	}

	// Atomic rename temp → blob
	if err := os.Rename(tmpPath, blobPath); err != nil {
		return nil, fmt.Errorf("failed to rename blob: %w", err)
	}

	return &SaveResult{
		Hash:    hash,
		Path:    blobPath,
		Size:    written,
		Existed: false,
	}, nil
}

// Delete removes a blob by hash and extension.
func (s *ModelStorage) Delete(hash, ext string) error {
	path := filepath.Join(s.blobDir, hash+ext)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete blob %s: %w", hash, err)
	}
	return nil
}

// Exists checks if a blob exists.
func (s *ModelStorage) Exists(hash, ext string) bool {
	path := filepath.Join(s.blobDir, hash+ext)
	_, err := os.Stat(path)
	return err == nil
}

// BlobPath returns the absolute path for a given hash and extension.
func (s *ModelStorage) BlobPath(hash, ext string) string {
	return filepath.Join(s.blobDir, hash+ext)
}

// CheckQuota verifies that the filesystem hosting blobDir has enough free space.
func (s *ModelStorage) CheckQuota(additionalBytes uint64) error {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(s.blobDir, &stat); err != nil {
		return fmt.Errorf("failed to check disk space: %w", err)
	}

	freeBytes := stat.Bavail * uint64(stat.Bsize)
	required := s.minFreeBytes + additionalBytes

	if freeBytes < required {
		return fmt.Errorf("insufficient disk space: %d bytes free, need at least %d bytes",
			freeBytes, required)
	}
	return nil
}

// ValidateHEF runs hailortcli parse-hef on the given file and extracts metadata.
// Returns an error if the file is not a valid HEF or doesn't target the expected hardware.
func (s *ModelStorage) ValidateHEF(filePath string) (*HEFInfo, error) {
	// Check if hailortcli is available
	hailortcli, err := exec.LookPath("hailortcli")
	if err != nil {
		logger.Warn("hailortcli not found, skipping HEF validation")
		return &HEFInfo{RawOutput: "validation skipped: hailortcli not available"}, nil
	}

	cmd := exec.Command(hailortcli, "parse-hef", filePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("HEF validation failed: %s (exit: %v)", string(output), err)
	}

	info := &HEFInfo{
		RawOutput: string(output),
	}

	// Parse network name and input dimensions from output
	var inputVStreamFound bool
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Network group name:") {
			// Extract name, remove any trailing metadata after comma
			name := strings.TrimSpace(strings.TrimPrefix(line, "Network group name:"))
			if idx := strings.Index(name, ","); idx > 0 {
				name = strings.TrimSpace(name[:idx])
			}
			info.NetworkName = name
		}
		if strings.Contains(line, "VStream") || strings.Contains(line, "stream") || strings.HasPrefix(line, "Input") || strings.HasPrefix(line, "Output") {
			info.VStreams = append(info.VStreams, line)
			// Try to parse input dimensions from input vstream line
			// Format example: "input_yuv (HailoStream) [640, 640, 3]" or similar
			if !inputVStreamFound && (strings.HasPrefix(line, "Input")) {
				if w, h := parseInputDimensions(line); w > 0 && h > 0 {
					info.InputWidth = w
					info.InputHeight = h
					inputVStreamFound = true
				}
			}
		}
	}

	// Fallback: try to extract from any vstream line if input not identified
	if !inputVStreamFound {
		for _, line := range info.VStreams {
			if w, h := parseInputDimensions(line); w > 0 && h > 0 {
				info.InputWidth = w
				info.InputHeight = h
				break
			}
		}
	}

	return info, nil
}

// parseInputDimensions extracts width and height from a vstream line.
// Supports formats like: "[640, 640, 3]" "640x640" "shape: (640, 640, 3)" etc.
func parseInputDimensions(line string) (width, height int) {
	// Try format: [height, width, channels] or [width, height]
	if idx := strings.Index(line, "["); idx != -1 {
		if endIdx := strings.Index(line[idx:], "]"); endIdx != -1 {
			shapeStr := line[idx+1 : idx+endIdx]
			parts := strings.Split(shapeStr, ",")
			if len(parts) >= 2 {
				// Try to parse as [height, width, channels] or [width, height]
				h, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
				w, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
				if err1 == nil && err2 == nil && h > 0 && w > 0 {
					// Assume first two are height, width for typical image tensors
					return w, h
				}
			}
		}
	}

	// Try format: 640x640 or 640_x_640 (from filename patterns in output)
	re := regexp.MustCompile(`(\d+)[_xX](\d+)`)
	if matches := re.FindStringSubmatch(line); len(matches) == 3 {
		w, _ := strconv.Atoi(matches[1])
		h, _ := strconv.Atoi(matches[2])
		if w > 0 && h > 0 {
			return w, h
		}
	}

	return 0, 0
}

// ValidateHEFToJSON runs ValidateHEF and returns the info as a JSON string.
func (s *ModelStorage) ValidateHEFToJSON(filePath string) (string, *HEFInfo, error) {
	info, err := s.ValidateHEF(filePath)
	if err != nil {
		return "", nil, err
	}

	jsonBytes, err := json.Marshal(info)
	if err != nil {
		return "", info, fmt.Errorf("failed to marshal HEF info: %w", err)
	}

	return string(jsonBytes), info, nil
}
