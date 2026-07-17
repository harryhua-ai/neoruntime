package gyro

import (
	"context"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultIIOBase = "/sys/bus/iio/devices"
	subBufferSize  = 8               // per-subscriber sample buffer
	scaleRefresh   = 5 * time.Second // re-read scale files this often
	probeInterval  = 2 * time.Second // re-discovery cadence when offline
	maxPollRateHz  = 1000

	// Startup static gyro-bias calibration.
	defaultCalibrationMs = 2000   // default CalibrationMs when unset
	minCalSamples        = 12     // floor on the calibration sample count
	maxCalSamples        = 200    // ceiling on the calibration sample count
	stillGateRps         = 0.0175 // ~1 dps/axis; std above this hints the device moved
	rps2dps              = 180.0 / math.Pi
)

// IIOSourceConfig configures an IIOSource.
type IIOSourceConfig struct {
	PollRateHz    int        // sensor read cadence (default 100)
	FusionAlpha   float64    // complementary filter coefficient (default 0.05)
	MountMatrix   [9]float64 // row-major 3x3 body -> spec frame (default identity)
	AccelPath     string     // accel device dir override; "" = autodiscover
	GyroPath      string     // anglvel device dir override; "" = autodiscover
	IIOBase       string     // IIO sysfs root (default /sys/bus/iio/devices)
	CalibrateBias bool       // run a one-shot static gyro-bias calibration at startup
	CalibrationMs int        // calibration window length (ms); default 2000
}

// iioDevice holds open fds for one IIO device's three axes plus its scale.
type iioDevice struct {
	dir       string
	kind      string // "accel" or "anglvel"
	rawFiles  [3]*os.File
	scaleFile *os.File
	scale     float64
	scaleAt   time.Time
}

// IIOSource reads LSM6DSR accel + gyro samples from the Linux IIO sysfs tree,
// fuses them into an orientation quaternion via a single Fusion instance, and
// fans the result out to N SSE subscribers through a non-blocking broker.
//
// Exactly one read goroutine (Start) drives the Fusion and the file reads; all
// subscribers share it. This satisfies the gyro.Source contract.
type IIOSource struct {
	cfg    IIOSourceConfig
	fusion *Fusion

	mu     sync.Mutex
	status StatusCode
	subs   map[chan Sample]struct{}

	accelDev *iioDevice
	gyroDev  *iioDevice
}

// NewIIOSource builds an IIOSource. It does not open any files or start a loop;
// call Start to begin reading. Start performs the initial probe and ongoing
// re-discovery, so a missing sensor at startup is non-fatal.
func NewIIOSource(cfg IIOSourceConfig) *IIOSource {
	if cfg.IIOBase == "" {
		cfg.IIOBase = defaultIIOBase
	}
	if cfg.PollRateHz <= 0 {
		cfg.PollRateHz = 100
	}
	return &IIOSource{
		cfg:    cfg,
		fusion: NewFusion(cfg.FusionAlpha, cfg.MountMatrix),
		subs:   make(map[chan Sample]struct{}),
		status: StatusOffline,
	}
}

// Start runs the read/fuse/publish loop until ctx is canceled. It blocks; run
// it in a goroutine. It is safe to call Start at most once per source.
//
// When CalibrateBias is set, the first calSampleCount() good gyro samples are
// averaged (in the body frame, before the mount matrix) to estimate the static
// zero-rate bias, which is then subtracted from every subsequent sample. The
// device is assumed to be still during this window. Samples are still fused and
// published throughout, so the bias is live after at most one calibration
// window with no first-sample gap.
func (s *IIOSource) Start(ctx context.Context) {
	defer s.cleanup()

	s.probeAndOpen()

	poll := time.NewTicker(s.period())
	defer poll.Stop()
	probe := time.NewTicker(probeInterval)
	defer probe.Stop()

	calN := s.calSampleCount()
	var calSamples [][3]float64
	calibrated := !s.cfg.CalibrateBias // skip when disabled

	var last time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-poll.C:
			if s.accelDev == nil || s.gyroDev == nil {
				continue // not ready; probe ticker will reopen
			}
			now := time.Now()
			accel, errA := s.accelDev.read(now)
			gyro, errG := s.gyroDev.read(now)
			if errA != nil || errG != nil {
				// Reopen fds on next probe; temporarily mark error.
				s.setStatus(StatusError)
				s.reopenLocked()
				last = time.Time{}
				continue
			}
			if s.status != StatusOnline {
				s.setStatus(StatusOnline)
			}
			var dt float64
			if !last.IsZero() {
				dt = now.Sub(last).Seconds()
			}
			last = now

			// One-shot static bias calibration: accumulate body-frame gyro
			// samples (raw, pre-mount, rad/s) until the window fills, then
			// install the per-axis mean as the bias. Bias is a chip property,
			// so we never recalibrate after a transient disconnect.
			if !calibrated {
				calSamples = append(calSamples, gyro)
				if len(calSamples) >= calN {
					mean, std := meanStdGyro(calSamples)
					s.fusion.SetGyroBias(mean)
					calibrated = true
					calSamples = nil
					log.Printf("gyro: static bias estimated dps=[%.3f,%.3f,%.3f] std_dps=[%.3f,%.3f,%.3f] samples=%d",
						mean[0]*rps2dps, mean[1]*rps2dps, mean[2]*rps2dps,
						std[0]*rps2dps, std[1]*rps2dps, std[2]*rps2dps, calN)
					if std[0] > stillGateRps || std[1] > stillGateRps || std[2] > stillGateRps {
						log.Printf("gyro: WARN calibration std exceeds still-gate (%.3f dps/axis); device may have moved during calibration", stillGateRps*rps2dps)
					}
				}
			}

			q := s.fusion.Update(accel, gyro, dt)
			s.publish(Sample{Timestamp: now, Quat: q})
		case <-probe.C:
			// Re-discover on hotplug or after a read failure.
			if s.accelDev == nil || s.gyroDev == nil {
				s.probeAndOpen()
			}
		}
	}
}

// Status returns the current sensor status (thread-safe).
func (s *IIOSource) Status() StatusCode {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Subscribe returns a channel receiving fused attitude samples. Pass the
// returned channel to Unsubscribe when done.
func (s *IIOSource) Subscribe() <-chan Sample {
	ch := make(chan Sample, subBufferSize)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber. It does not close the channel; the broker
// stops sending to it immediately and the channel is garbage-collected once the
// caller drops its reference.
func (s *IIOSource) Unsubscribe(ch <-chan Sample) {
	s.mu.Lock()
	for k := range s.subs {
		if k == ch {
			delete(s.subs, k)
			break
		}
	}
	s.mu.Unlock()
}

// period derives the poll interval from PollRateHz with sane clamps.
func (s *IIOSource) period() time.Duration {
	hz := s.cfg.PollRateHz
	if hz < 1 {
		hz = 100
	}
	if hz > maxPollRateHz {
		hz = maxPollRateHz
	}
	return time.Second / time.Duration(hz)
}

// calSampleCount derives the startup calibration sample count from CalibrationMs
// and PollRateHz, clamped to [minCalSamples, maxCalSamples].
func (s *IIOSource) calSampleCount() int {
	ms := s.cfg.CalibrationMs
	if ms <= 0 {
		ms = defaultCalibrationMs
	}
	hz := s.cfg.PollRateHz
	if hz < 1 {
		hz = 100
	}
	n := int(math.Round(float64(ms) / 1000.0 * float64(hz)))
	if n < minCalSamples {
		n = minCalSamples
	}
	if n > maxCalSamples {
		n = maxCalSamples
	}
	return n
}

// meanStdGyro returns the per-axis population mean and population standard
// deviation of the given body-frame gyro samples (rad/s). It is pure for unit
// testing.
func meanStdGyro(samples [][3]float64) (mean, std [3]float64) {
	n := len(samples)
	if n == 0 {
		return
	}
	for _, smp := range samples {
		mean[0] += smp[0]
		mean[1] += smp[1]
		mean[2] += smp[2]
	}
	mean[0] /= float64(n)
	mean[1] /= float64(n)
	mean[2] /= float64(n)
	for _, smp := range samples {
		d0, d1, d2 := smp[0]-mean[0], smp[1]-mean[1], smp[2]-mean[2]
		std[0] += d0 * d0
		std[1] += d1 * d1
		std[2] += d2 * d2
	}
	std[0] = math.Sqrt(std[0] / float64(n))
	std[1] = math.Sqrt(std[1] / float64(n))
	std[2] = math.Sqrt(std[2] / float64(n))
	return mean, std
}

func (s *IIOSource) setStatus(st StatusCode) {
	s.mu.Lock()
	s.status = st
	s.mu.Unlock()
}

// probeAndOpen discovers (or honors configured overrides for) the accel and
// gyro devices and opens their fds. Updates status: offline if absent, error if
// found but unopenable, online on success.
func (s *IIOSource) probeAndOpen() {
	base := s.cfg.IIOBase
	accelDir := s.cfg.AccelPath
	gyroDir := s.cfg.GyroPath

	if accelDir == "" {
		d, err := discoverDevice(base, "accel")
		if err != nil {
			s.setStatus(StatusOffline)
			return
		}
		accelDir = d
	}
	if gyroDir == "" {
		d, err := discoverDevice(base, "anglvel")
		if err != nil {
			s.setStatus(StatusOffline)
			return
		}
		gyroDir = d
	}

	ad, errA := openDevice(accelDir, "accel")
	gd, errG := openDevice(gyroDir, "anglvel")
	if errA != nil || errG != nil {
		if ad != nil {
			ad.close()
		}
		if gd != nil {
			gd.close()
		}
		s.setStatus(StatusError)
		return
	}

	s.mu.Lock()
	s.accelDev = ad
	s.gyroDev = gd
	s.status = StatusOnline
	s.mu.Unlock()
}

// reopenLocked closes and clears the device fds so the probe ticker reopens
// them.
func (s *IIOSource) reopenLocked() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accelDev != nil {
		s.accelDev.close()
		s.accelDev = nil
	}
	if s.gyroDev != nil {
		s.gyroDev.close()
		s.gyroDev = nil
	}
}

func (s *IIOSource) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subs = nil
	if s.accelDev != nil {
		s.accelDev.close()
		s.accelDev = nil
	}
	if s.gyroDev != nil {
		s.gyroDev.close()
		s.gyroDev = nil
	}
	s.status = StatusOffline
}

// publish fans a sample out to every subscriber without blocking the read loop.
// A full channel triggers drop-oldest: one stale sample is discarded and the
// fresh one is retried once.
func (s *IIOSource) publish(sample Sample) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs {
		select {
		case ch <- sample:
		default:
			select {
			case <-ch: // drop oldest
			default:
			}
			select {
			case ch <- sample:
			default:
			}
		}
	}
}

// discoverDevice returns the first iio:device* dir under base that exposes the
// given channel kind ("accel" or "anglvel"). Device numbers can shift across
// boots, so nothing is hardcoded.
func discoverDevice(base, kind string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(base, "iio:device*"))
	if err != nil {
		return "", fmt.Errorf("glob iio devices under %s: %w", base, err)
	}
	for _, d := range matches {
		if fileExists(filepath.Join(d, "in_"+kind+"_x_raw")) {
			return d, nil
		}
	}
	return "", fmt.Errorf("no iio device exposing in_%s_*_raw under %s", kind, base)
}

// openDevice opens the three axis raw files and the scale file for a device,
// reading the scale immediately.
func openDevice(dir, kind string) (*iioDevice, error) {
	d := &iioDevice{dir: dir, kind: kind}
	axes := [3]string{"x", "y", "z"}
	for i, ax := range axes {
		f, err := os.Open(filepath.Join(dir, "in_"+kind+"_"+ax+"_raw"))
		if err != nil {
			d.close()
			return nil, fmt.Errorf("open %s %s raw: %w", kind, ax, err)
		}
		d.rawFiles[i] = f
	}
	sf, err := os.Open(filepath.Join(dir, "in_"+kind+"_scale"))
	if err != nil {
		d.close()
		return nil, fmt.Errorf("open %s scale: %w", kind, err)
	}
	d.scaleFile = sf
	sc, err := readSeekFloat(sf)
	if err != nil {
		d.close()
		return nil, fmt.Errorf("read %s scale: %w", kind, err)
	}
	d.scale = sc
	d.scaleAt = time.Now()
	return d, nil
}

// read returns the three axes in physical units, refreshing the scale
// periodically.
func (d *iioDevice) read(now time.Time) ([3]float64, error) {
	var v [3]float64
	if now.Sub(d.scaleAt) > scaleRefresh {
		if sc, err := readSeekFloat(d.scaleFile); err == nil {
			d.scale = sc
			d.scaleAt = now
		}
	}
	for i, f := range d.rawFiles {
		raw, err := readSeekInt(f)
		if err != nil {
			return v, fmt.Errorf("read %s axis %d: %w", d.kind, i, err)
		}
		v[i] = float64(raw) * d.scale
	}
	return v, nil
}

func (d *iioDevice) close() {
	for _, f := range d.rawFiles {
		if f != nil {
			f.Close()
		}
	}
	if d.scaleFile != nil {
		d.scaleFile.Close()
	}
}

// readSeek re-reads a small sysfs value by seeking to the start, returning the
// trimmed content. Handles partial reads and the trailing newline.
func readSeek(f *os.File) (string, error) {
	if _, err := f.Seek(0, 0); err != nil {
		return "", err
	}
	var sb strings.Builder
	buf := make([]byte, 32)
	for {
		n, err := f.Read(buf)
		if n > 0 {
			sb.Write(buf[:n])
			if strings.ContainsRune(sb.String(), '\n') {
				break
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return "", err
		}
	}
	return strings.TrimSpace(sb.String()), nil
}

func readSeekInt(f *os.File) (int64, error) {
	s, err := readSeek(f)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(s, 10, 64)
}

func readSeekFloat(f *os.File) (float64, error) {
	s, err := readSeek(f)
	if err != nil {
		return 0, err
	}
	return strconv.ParseFloat(s, 64)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
