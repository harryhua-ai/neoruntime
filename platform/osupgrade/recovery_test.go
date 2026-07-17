package osupgrade

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRecoveryBundle(t *testing.T) {
	dir := t.TempDir()
	fit := filepath.Join(dir, "fitImage")
	root := filepath.Join(dir, "swupdate-image-hailo15-ne503.ext4.gz")
	if err := os.WriteFile(fit, []byte("fit"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root, gzipBytes(t, []byte("root "+SingleRecoveryMarker)), 0644); err != nil {
		t.Fatal(err)
	}
	manifest, err := BuildRecoveryManifest("hailo15-ne503", "1.11.0", "1.2.0", "key-1", fit, root)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	bundle, err := LoadRecoveryBundle(dir, "hailo15-ne503")
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Manifest.RecoveryVersion != "1.2.0" {
		t.Fatalf("unexpected manifest: %+v", bundle.Manifest)
	}
	if err := bundle.Compatible(&ValidationResult{
		Machine:            "hailo15-ne503",
		MinRecoveryVersion: "1.1.0",
		SecureBootKeyID:    "key-1",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestLoadRecoveryBundleRejectsTamper(t *testing.T) {
	dir := t.TempDir()
	fit := filepath.Join(dir, "fitImage")
	root := filepath.Join(dir, "swupdate-image-hailo15-ne503.ext4.gz")
	_ = os.WriteFile(fit, []byte("fit"), 0644)
	_ = os.WriteFile(root, gzipBytes(t, []byte(SingleRecoveryMarker)), 0644)
	manifest, err := BuildRecoveryManifest("hailo15-ne503", "1.11.0", "1.0.0", "", fit, root)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0644)
	_ = os.WriteFile(fit, []byte("tampered"), 0644)
	if _, err := LoadRecoveryBundle(dir, "hailo15-ne503"); err == nil {
		t.Fatal("expected tampered bundled recovery to be rejected")
	}
}

func TestRecoveryCompatibilityRejectsMinimumVersion(t *testing.T) {
	bundle := &RecoveryBundle{Manifest: RecoveryManifest{
		Machine:         "hailo15-ne503",
		RecoveryVersion: "1.0.0",
	}}
	if err := bundle.Compatible(&ValidationResult{
		Machine:            "hailo15-ne503",
		MinRecoveryVersion: "2.0.0",
	}); err == nil {
		t.Fatal("expected recovery version incompatibility")
	}
}
