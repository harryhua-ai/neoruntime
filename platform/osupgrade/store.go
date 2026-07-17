package osupgrade

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const DefaultRoot = "/data/aipc-os-upgrade"

type State string

const (
	StateIdle           State = "idle"
	StateUploading      State = "uploading"
	StateValidating     State = "validating"
	StateReady          State = "ready"
	StateInstalling     State = "installing"
	StateInstalled      State = "installed"
	StateAwaitingReboot State = "awaiting_reboot"
	StateRebooting      State = "rebooting"
	StateVerifying      State = "verifying"
	StateSuccess        State = "success"
	StateRollback       State = "rollback"
	StateFailed         State = "failed"
	StateCancelled      State = "cancelled"
)

type Job struct {
	ID                          string    `json:"job_id"`
	State                       State     `json:"status"`
	Progress                    int       `json:"progress"`
	Message                     string    `json:"message,omitempty"`
	Error                       string    `json:"error,omitempty"`
	FileName                    string    `json:"file_name,omitempty"`
	PackagePath                 string    `json:"-"`
	Size                        int64     `json:"file_size,omitempty"`
	SHA256                      string    `json:"sha256,omitempty"`
	CurrentVersion              string    `json:"current_version,omitempty"`
	TargetVersion               string    `json:"target_version,omitempty"`
	BuildTime                   string    `json:"build_time,omitempty"`
	Machine                     string    `json:"machine,omitempty"`
	Product                     string    `json:"product,omitempty"`
	HardwareVersion             string    `json:"hardware_version,omitempty"`
	CurrentCopy                 string    `json:"current_copy,omitempty"`
	TargetCopy                  string    `json:"target_copy,omitempty"`
	PreviousCopy                string    `json:"previous_copy,omitempty"`
	UpgradeMode                 string    `json:"upgrade_mode,omitempty"`
	RecoverySource              string    `json:"recovery_source,omitempty"`
	RecoveryVersion             string    `json:"recovery_version,omitempty"`
	AppVersion                  string    `json:"app_version,omitempty"`
	CompatLevel                 int       `json:"compat_level,omitempty"`
	DataSchema                  int       `json:"data_schema,omitempty"`
	CompatibilityValid          bool      `json:"compatibility_valid"`
	RollbackSupported           bool      `json:"rollback_supported"`
	ServiceInterruptionRequired bool      `json:"service_interruption_required"`
	DowngradeAllowed            bool      `json:"downgrade_allowed"`
	SignatureValid              bool      `json:"signature_valid"`
	RebootRequired              bool      `json:"reboot_required"`
	CreatedAt                   time.Time `json:"created_at"`
	UpdatedAt                   time.Time `json:"updated_at"`
}

func (j Job) Terminal() bool {
	return j.State == StateSuccess || j.State == StateFailed ||
		j.State == StateCancelled
}

type Store struct {
	Root string
}

func NewStore(root string) *Store {
	if strings.TrimSpace(root) == "" {
		root = DefaultRoot
	}
	return &Store{Root: filepath.Clean(root)}
}

func (s *Store) Init() error {
	for _, dir := range []string{s.IncomingDir(), s.PackagesDir(), s.JobsDir()} {
		if err := os.MkdirAll(dir, 0750); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) IncomingDir() string { return filepath.Join(s.Root, "incoming") }
func (s *Store) PackagesDir() string { return filepath.Join(s.Root, "packages") }
func (s *Store) JobsDir() string     { return filepath.Join(s.Root, "jobs") }
func (s *Store) ActivePath() string  { return filepath.Join(s.Root, "active-job") }
func (s *Store) LockPath() string    { return filepath.Join(s.Root, "install.lock") }
func (s *Store) JobDir(id string) string {
	return filepath.Join(s.JobsDir(), id)
}
func (s *Store) StatusPath(id string) string {
	return filepath.Join(s.JobDir(id), "status.json")
}
func (s *Store) LogPath(id string) string {
	return filepath.Join(s.JobDir(id), "swupdate.log")
}
func (s *Store) IncomingPath(id string) string {
	return filepath.Join(s.IncomingDir(), id+".part")
}
func (s *Store) PackagePath(id string) string {
	return filepath.Join(s.PackagesDir(), id+".swu")
}

func validateID(id string) error {
	if id == "" || strings.ContainsAny(id, `/\`) || id == "." || id == ".." {
		return errors.New("invalid job id")
	}
	return nil
}

func (s *Store) Save(job *Job) error {
	if err := validateID(job.ID); err != nil {
		return err
	}
	if err := s.Init(); err != nil {
		return err
	}
	if err := os.MkdirAll(s.JobDir(job.ID), 0750); err != nil {
		return err
	}
	job.UpdatedAt = time.Now().UTC()
	if job.CreatedAt.IsZero() {
		job.CreatedAt = job.UpdatedAt
	}
	if job.PackagePath == "" {
		job.PackagePath = s.PackagePath(job.ID)
	}
	data, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(s.StatusPath(job.ID), data, 0640)
}

func (s *Store) Load(id string) (*Job, error) {
	if err := validateID(id); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(s.StatusPath(id))
	if err != nil {
		return nil, err
	}
	var job Job
	if err := json.Unmarshal(data, &job); err != nil {
		return nil, err
	}
	job.PackagePath = s.PackagePath(job.ID)
	return &job, nil
}

func (s *Store) SetActive(id string) error {
	if err := validateID(id); err != nil {
		return err
	}
	return atomicWrite(s.ActivePath(), []byte(id+"\n"), 0640)
}

func (s *Store) Active() (*Job, error) {
	data, err := os.ReadFile(s.ActivePath())
	if err != nil {
		return nil, err
	}
	return s.Load(strings.TrimSpace(string(data)))
}

func (s *Store) RemovePackage(job *Job) error {
	if !job.Terminal() {
		return fmt.Errorf("cannot remove package while job is %s", job.State)
	}
	if err := os.Remove(s.PackagePath(job.ID)); err != nil && !os.IsNotExist(err) {
		return err
	}
	if data, err := os.ReadFile(s.ActivePath()); err == nil &&
		strings.TrimSpace(string(data)) == job.ID {
		if err := os.Remove(s.ActivePath()); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}
