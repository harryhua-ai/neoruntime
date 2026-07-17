package osupgrade

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestValidatePackage(t *testing.T) {
	rootfs := gzipBytes(t, []byte("root filesystem"))
	path := filepath.Join(t.TempDir(), "image.swu")
	writeCPIO(t, path, map[string][]byte{
		"sw-description": []byte(`software = {
			version = "1.12.0";
			product = "ne503";
			aipc-compat-level = "1";
			data-schema = "1";
			hardware-compatibility: [ "1.0" ];
			embedded-script = "vars = { FILESYSTEM_DEVICE = 'mmcblk1' }";
			stable = { copy-a: {}; copy-b: {}; };
		}`),
		"hailo-image-hailo15-ne503.ext4.gz":    rootfs,
		"swupdate-image-hailo15-ne503.ext4.gz": gzipBytes(t, []byte("filesystem "+SingleRecoveryMarker)),
		"sw-description.sig":                   []byte("signature"),
	})

	result, err := ValidatePackage(path, ValidationOptions{
		ExpectedMachine:      "hailo15-ne503",
		ExpectedProduct:      "ne503",
		ExpectedHW:           "1.0",
		ExpectedDevice:       "mmcblk1",
		RequireAB:            true,
		RequireCompatibility: true,
		RequireSignature:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Version != "1.12.0" || result.Machine != "hailo15-ne503" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.CompatLevel != 1 || result.DataSchema != 1 {
		t.Fatalf("missing compatibility metadata: %+v", result)
	}
	if result.SHA256 == "" || result.Entries != 4 || !result.HasSignature {
		t.Fatalf("missing validation details: %+v", result)
	}
	if !result.SingleRecoveryCapable {
		t.Fatalf("missing validation details: %+v", result)
	}
}

func TestValidatePackageRequiresSignatureEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "image.swu")
	writeCPIO(t, path, map[string][]byte{
		"sw-description": []byte(`software = {
			version = "1.12.0";
			embedded-script = "vars = { FILESYSTEM_DEVICE = 'mmcblk1' }";
			stable = { copy-a: {}; copy-b: {}; };
		}`),
		"hailo-image-hailo15-ne503.ext4.gz": gzipBytes(t, []byte("rootfs")),
	})
	if _, err := ValidatePackage(path, ValidationOptions{
		ExpectedMachine:  "hailo15-ne503",
		ExpectedDevice:   "mmcblk1",
		RequireAB:        true,
		RequireSignature: true,
	}); err == nil {
		t.Fatal("expected unsigned package to be rejected")
	}
}

func TestValidatePackageRejectsCorruptRootFS(t *testing.T) {
	path := filepath.Join(t.TempDir(), "image.swu")
	writeCPIO(t, path, map[string][]byte{
		"sw-description":                    []byte(`software = { version = "1.12.0"; };`),
		"hailo-image-hailo15-ne503.ext4.gz": []byte("not gzip"),
	})
	if _, err := ValidatePackage(path, ValidationOptions{ExpectedMachine: "hailo15-ne503"}); err == nil {
		t.Fatal("expected corrupt rootfs error")
	}
}

func TestStorePersistsActiveJob(t *testing.T) {
	store := NewStore(t.TempDir())
	job := &Job{ID: "job-1", State: StateReady, TargetVersion: "1.2.3"}
	if err := store.Save(job); err != nil {
		t.Fatal(err)
	}
	if err := store.SetActive(job.ID); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Active()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ID != job.ID || loaded.TargetVersion != "1.2.3" || loaded.PackagePath == "" {
		t.Fatalf("unexpected persisted job: %+v", loaded)
	}
}

func TestMarkerWriterFindsRecoveryCapabilityAcrossChunks(t *testing.T) {
	writer := newMarkerWriter([]byte(SingleRecoveryMarker))
	_, _ = writer.Write([]byte("prefix AIPC_LOCAL_"))
	_, _ = writer.Write([]byte("RECOVERY_V1 suffix"))
	if !writer.Found() {
		t.Fatal("recovery marker was not detected across chunks")
	}
}

func gzipBytes(t *testing.T, data []byte) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := gzip.NewWriter(&output)
	if _, err := writer.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func writeCPIO(t *testing.T, path string, entries map[string][]byte) {
	t.Helper()
	var output bytes.Buffer
	index := 1
	for name, data := range entries {
		writeCPIOEntry(t, &output, index, name, data)
		index++
	}
	writeCPIOEntry(t, &output, index, "TRAILER!!!", nil)
	if err := os.WriteFile(path, output.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
}

func writeCPIOEntry(t *testing.T, output *bytes.Buffer, ino int, name string, data []byte) {
	t.Helper()
	nameBytes := append([]byte(name), 0)
	header := fmt.Sprintf(
		"070701%08x%08x%08x%08x%08x%08x%08x%08x%08x%08x%08x%08x%08x",
		ino, 0100644, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(nameBytes), 0,
	)
	if len(header) != 110 {
		t.Fatalf("bad test CPIO header length %d", len(header))
	}
	output.WriteString(header)
	output.Write(nameBytes)
	writePadding(output, 110+len(nameBytes))
	output.Write(data)
	writePadding(output, len(data))
}

func writePadding(output *bytes.Buffer, size int) {
	for padding := (4 - size%4) % 4; padding > 0; padding-- {
		output.WriteByte(0)
	}
}
