// Package media is the Config Controller adapter for the media domain. It owns
// the camera-daemon.yaml config file — the media pipeline config (encoders,
// streams, rtsp, image/transform sections) that platform-api reads and writes.
//
// The adapter is SINGLE-KEY ("config"): the desired value IS the full YAML the
// handler already produces via yaml.Marshal of its config map. Returning that
// YAML verbatim in Render (rather than round-tripping through JSON) is
// deliberate: a YAML→JSON→YAML cycle would drift integer formatting
// (bitrate 8000000 → 8e+06), changing the file's bytes even though the value
// is semantically equal. By treating the handler's marshaled YAML as the
// desired state, the adapter preserves byte-for-byte output and still gives
// the Manager atomic write + read-back Verify + auto-Restore + revision/audit.
//
// All seven os.WriteFile(h.configPath, ...) sites in handlers/media.go
// (SetConfig, writeStreamHotReload, writeAppliedStreamsToConfig,
// writeStreamToConfig, addStreamToConfig, removeStreamFromConfig,
// setStreamEnabledInConfig) write the SAME file and already produce the full
// config YAML before writing, so they collapse onto this one key.
//
// The adapter only projects the file. The live pipeline reconfiguration — gRPC
// UpdateEncoderConfig / ReloadStreams / ReconfigurePipeline — stays in the
// handler post-Apply, exactly as the time and network adapters keep their
// exec/restart in the handler. camera-daemon.yaml is platform-api-owned
// (camera-daemon reads it, never writes it at runtime), so a byte-compare
// Verify is safe: no concurrent writer can make a just-written file mismatch.
//
// Per the Phase 0 decision, OSD and privacy-mask are self-projected by
// camera-daemon to their own JSON files; this adapter does NOT touch those —
// routing their gRPC calls here would double-write.
package media

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"

	"aipc/platform/common/constants"
	"aipc/platform/platform-api/internal/atomicfile"
)

const (
	// keyConfig is the only key: desired = full camera-daemon.yaml content.
	keyConfig = "config"
)

var (
	// ErrUnknownKey is returned when key is not "config".
	ErrUnknownKey = errors.New("media: unknown key")
	// ErrInvalidYAML is returned when the desired value is not parseable YAML.
	ErrInvalidYAML = errors.New("media: desired is not valid YAML")
	// ErrBadRenderedType is returned by Apply when rendered is not YAML bytes.
	ErrBadRenderedType = errors.New("media: rendered value is not YAML bytes")
	// ErrBadBackupType is returned by Restore when backup is not file bytes.
	ErrBadBackupType = errors.New("media: backup value is not file bytes")
)

// Adapter owns the camera-daemon.yaml file for the media domain.
type Adapter struct {
	configPath string
}

// New returns a media Adapter. configPath defaults to
// constants.ConfigPath()+"/camera-daemon.yaml" when empty so production uses
// the canonical install root while tests inject a t.TempDir() path.
func New(configPath string) *Adapter {
	if configPath == "" {
		configPath = constants.ConfigPath() + "/camera-daemon.yaml"
	}
	return &Adapter{configPath: configPath}
}

// backupState holds the file's pre-Apply bytes. A nil slice means the file did
// not exist before Apply, in which case Restore removes whatever Apply created.
type backupState struct{ bytes []byte }

// rendered is the YAML byte slice to write. It is a distinct type so Apply can
// type-assert and reject a mis-typed rendered value.
type rendered []byte

// Validate parses desiredJSON as YAML. The media config is a generic
// map[string]interface{} (the handler unmarshals into exactly that), so any
// parseable YAML document is accepted; non-YAML input fails the job fast.
func (a *Adapter) Validate(ctx context.Context, key, desiredJSON string) error {
	if key != keyConfig {
		return ErrUnknownKey
	}
	var m map[string]interface{}
	if err := yaml.Unmarshal([]byte(desiredJSON), &m); err != nil {
		return ErrInvalidYAML
	}
	return nil
}

// Backup reads the current file bytes. A missing file yields a nil-byte
// backupState (not an error): Restore will then remove any file Apply created.
func (a *Adapter) Backup(ctx context.Context, key string) (any, error) {
	if key != keyConfig {
		return nil, ErrUnknownKey
	}
	b, err := os.ReadFile(a.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return backupState{nil}, nil
		}
		return nil, err
	}
	return backupState{b}, nil
}

// Render returns the desired YAML verbatim as the bytes to write. The handler
// produces this YAML via yaml.Marshal of its config map; returning it unchanged
// avoids a YAML→JSON→YAML round-trip that would drift integer formatting.
func (a *Adapter) Render(ctx context.Context, key, desiredJSON string) (any, error) {
	if key != keyConfig {
		return nil, ErrUnknownKey
	}
	return rendered([]byte(desiredJSON)), nil
}

// Apply atomically writes the rendered YAML to the config file. The parent
// directory is created if missing (defensive — the install root normally
// exists; matches the network adapter).
func (a *Adapter) Apply(ctx context.Context, key string, r any) error {
	if key != keyConfig {
		return ErrUnknownKey
	}
	rd, ok := r.(rendered)
	if !ok {
		return ErrBadRenderedType
	}
	if err := os.MkdirAll(filepath.Dir(a.configPath), 0755); err != nil {
		return err
	}
	return atomicfile.Write(a.configPath, []byte(rd), 0644)
}

// Verify reads the file back and byte-compares against the desired YAML.
// camera-daemon.yaml is platform-api-owned (no runtime concurrent writer), so
// a mismatch indicates external tampering or disk error and triggers Restore.
func (a *Adapter) Verify(ctx context.Context, key, desiredJSON string) error {
	if key != keyConfig {
		return ErrUnknownKey
	}
	got, err := os.ReadFile(a.configPath)
	if err != nil {
		return err
	}
	if string(got) != desiredJSON {
		return errors.New("media: file content does not match desired")
	}
	return nil
}

// Restore reverts the file to the backup. A nil-byte backup means the file did
// not exist pre-Apply; Restore removes the file Apply created (missing-file is
// not an error). A non-nil backup is written atomically.
func (a *Adapter) Restore(ctx context.Context, key string, backup any) error {
	if key != keyConfig {
		return ErrUnknownKey
	}
	bs, ok := backup.(backupState)
	if !ok {
		return ErrBadBackupType
	}
	if bs.bytes == nil {
		if err := os.Remove(a.configPath); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(a.configPath), 0755); err != nil {
		return err
	}
	return atomicfile.Write(a.configPath, bs.bytes, 0644)
}

// Snapshot reads the current file bytes and returns them as desiredJSON. It
// implements config.Snapshotter so the Manager's Reconcile can import a
// pre-existing live camera-daemon.yaml into an empty desired-state store
// (the R-migration case) WITHOUT overwriting the file: Reconcile only records
// a revision + desired row mirroring what is already on disk.
//
// The media desired value IS the full file content (Render returns
// rendered([]byte(desiredJSON)), Apply writes it, Verify byte-compares), so a
// Snapshot of the live file is exactly the desiredJSON that Apply would
// re-project byte-identically — making Snapshot a true inverse of Apply.
//
// A missing file returns os.ErrNotExist, which Reconcile treats as "nothing to
// import" (non-error no-op). Any other read error is surfaced as a job failure.
func (a *Adapter) Snapshot(ctx context.Context, key string) (string, error) {
	if key != keyConfig {
		return "", ErrUnknownKey
	}
	b, err := os.ReadFile(a.configPath)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
