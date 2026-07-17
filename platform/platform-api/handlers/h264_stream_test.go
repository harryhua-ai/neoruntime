package handlers

import (
	"net"
	"sync"
	"testing"
	"time"
)

// fakeConn is a minimal net.Conn that records bytes written to it.
type fakeConn struct {
	mu    sync.Mutex
	wrote []byte
}

func (f *fakeConn) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.wrote = append(f.wrote, p...)
	return len(p), nil
}
func (f *fakeConn) Read(p []byte) (int, error)         { return 0, nil }
func (f *fakeConn) Close() error                       { return nil }
func (f *fakeConn) LocalAddr() net.Addr                { return nil }
func (f *fakeConn) RemoteAddr() net.Addr               { return nil }
func (f *fakeConn) SetDeadline(t time.Time) error      { return nil }
func (f *fakeConn) SetReadDeadline(t time.Time) error  { return nil }
func (f *fakeConn) SetWriteDeadline(t time.Time) error { return nil }

func (f *fakeConn) bytes() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]byte, len(f.wrote))
	copy(out, f.wrote)
	return out
}

// TestForceKeyframe_ManagerWritesControlByte verifies the manager-level
// ForceKeyframe delegates to the stream and writes the keyframe control byte
// (ctrlRequestKeyframe = 0x4B 'K') over the UDS connection.
func TestForceKeyframe_ManagerWritesControlByte(t *testing.T) {
	m := NewH264StreamManager()
	fc := &fakeConn{}
	m.streams["main"] = &H264Stream{StreamID: "main", conn: fc}

	m.ForceKeyframe("main")

	got := fc.bytes()
	if len(got) != 1 || got[0] != ctrlRequestKeyframe {
		t.Fatalf("expected single control byte 0x4B, got %v", got)
	}
}

// TestForceKeyframe_ManagerMissingStreamIsNoop ensures requesting a keyframe for
// a stream that does not exist is a safe no-op (no panic, no write).
func TestForceKeyframe_ManagerMissingStreamIsNoop(t *testing.T) {
	m := NewH264StreamManager()

	// Must not panic on a missing stream.
	m.ForceKeyframe("nonexistent")

	fc := &fakeConn{}
	m.streams["other"] = &H264Stream{StreamID: "other", conn: fc}
	// No conn set on "main" → requestKeyframe must skip the write silently.
	m.ForceKeyframe("main")

	if len(fc.bytes()) != 0 {
		t.Fatalf("expected no write to unrelated stream, got %v", fc.bytes())
	}
}

// TestForceKeyframe_NilConnIsNoop verifies requestKeyframe skips the write when
// the stream has no live UDS connection (conn == nil).
func TestForceKeyframe_NilConnIsNoop(t *testing.T) {
	m := NewH264StreamManager()
	m.streams["main"] = &H264Stream{StreamID: "main"} // conn == nil

	// Must not panic and must not write.
	m.ForceKeyframe("main")
}

// TestStreamHandlersForceKeyframe_Delegates verifies the StreamHandlers wrapper
// delegates to its H264StreamManager.
func TestStreamHandlersForceKeyframe_Delegates(t *testing.T) {
	fc := &fakeConn{}
	h := &StreamHandlers{
		h264Streams: NewH264StreamManager(),
	}
	h.h264Streams.streams["main"] = &H264Stream{StreamID: "main", conn: fc}

	h.ForceKeyframe("main")

	got := fc.bytes()
	if len(got) != 1 || got[0] != ctrlRequestKeyframe {
		t.Fatalf("expected single control byte 0x4B via wrapper, got %v", got)
	}
}

// TestStreamHandlersForceKeyframe_NilManagerIsSafe ensures the wrapper tolerates
// a nil H264StreamManager (defensive — some test/early-init paths may not set it).
func TestStreamHandlersForceKeyframe_NilManagerIsSafe(t *testing.T) {
	h := &StreamHandlers{}  // h264Streams == nil
	h.ForceKeyframe("main") // must not panic
}
