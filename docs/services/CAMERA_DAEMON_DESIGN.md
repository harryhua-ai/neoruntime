# Camera Daemon Design Document

## 1. Overview

Camera Daemon is the core C++ service of the AIPC platform, responsible for video capture, frame dispatch, encoding, and multi-channel frame publishing. It directly operates the HAL hardware abstraction layer, serving as the bridge between hardware and upper-layer platform services/App containers.

**Design Goals:**
- Zero-copy frame dispatch (DMA-BUF FD passthrough + reference counting)
- Dual-channel App frame delivery (FD passthrough / SHM ring buffer coexistence)
- Strict buffer lifecycle management (reference counting + retain/release + watchdog)
- Platform-independent (HAL dynamic loading, no hardware coupling)
- Tiered container security isolation

## 2. Overall Architecture

```mermaid
graph TB
    subgraph Hardware
        ISP[ISP / Sensor]
    end

    subgraph HAL["HAL .so (dlopen)"]
        HAL_VIDEO[hal_video]
        HAL_CODEC[hal_codec]
        HAL_OSD[hal_osd]
    end

    subgraph Daemon["camera-daemon"]
        HL[HalLoader<br/>dlopen/dlsym]
        VS[VideoSource<br/>push mode callback]
        FR[FrameRouter<br/>ref-count dispatch<br/>retain / release]
        WD[FrameWatchdog<br/>200ms timeout guard]

        OSD[OsdManager<br/>in-place draw]
        ENC[EncoderManager<br/>HAL Codec]
        SHM[ShmPublisher<br/>memcpy -> ring buffer]
        FDP[FdPublisher<br/>SCM_RIGHTS zero-copy]
    end

    subgraph Consumers
        RTSP[RTSP / HLS<br/>encoded packets]
        APP_SHM[Normal App<br/>SHM mmap PROT_READ]
        APP_FD[Trusted App<br/>recv_fd + mmap]
        AI_RT[ai-runtime<br/>SCM_RIGHTS passthrough]
    end

    ISP --> HAL_VIDEO
    HL -->|dlopen| HAL_VIDEO
    HL -->|dlopen| HAL_CODEC
    HL -->|dlopen| HAL_OSD
    HAL_VIDEO -->|HalRawFrame*| VS
    VS -->|frame callback| FR
    WD -.->|force_reclaim| FR

    FR -->|ref++| OSD
    OSD -->|in-place| ENC
    ENC -->|release| FR
    ENC --> RTSP

    FR -->|ref++| SHM
    SHM -->|release| FR
    SHM -->|SHM file| APP_SHM

    FR -->|retain per client| FDP
    FDP -->|release| FR
    FDP -->|SCM_RIGHTS UDS| APP_FD

    FR -->|SCM_RIGHTS| AI_RT
```

## 3. Module Relationships and Initialization Order

```mermaid
graph LR
    subgraph Init["Initialization Order (Strict Dependencies)"]
        direction LR
        A[1. HalLoader] --> B[2. VideoSource]
        B --> C[3. OsdManager]
        C --> D[4. EncoderManager]
        D --> E[5. FrameWatchdog]
        E --> F[6. FrameRouter]
        F --> G[7. ShmPublisher]
        G --> H[8. FdPublisher]
        H --> I[9. register_subscribers]
        I --> J[10. start streams]
    end
```

```mermaid
graph RL
    subgraph Shutdown["Shutdown Order (Reverse)"]
        direction RL
        S1[1. stop streams] --> S2[2. stop watchdog]
        S2 --> S3[3. stop FdPublisher]
        S3 --> S4[4. destroy encoders]
        S4 --> S5[5. destroy OSD]
        S5 --> S6[6. destroy SHM]
        S6 --> S7[7. deinit video]
        S7 --> S8[8. unload HAL]
    end
```

## 4. Dual-Channel Frame Delivery

App containers can obtain video frames in two ways. The daemon automatically selects based on App permissions:

### 4.1 FD Passthrough (Zero-Copy) -- FdPublisher

**Applicable to:** Trusted Apps (manifest declares `dma_buf: true`)

```mermaid
sequenceDiagram
    participant ISP
    participant HAL as HAL Video
    participant VS as VideoSource
    participant FR as FrameRouter
    participant FDP as FdPublisher
    participant App as App (Python)

    ISP->>HAL: Hardware interrupt (frame ready)
    HAL->>VS: HalVideoFrameCallback(frame*)
    VS->>FR: on_frame_arrived(stream_fd, frame)
    FR->>FR: ManagedFrame(ref=N)

    FR->>FDP: on_frame(stream, mf)
    FDP->>FR: retain(mf) [+1 ref per client]
    FDP->>App: sendmsg(SCM_RIGHTS, dma_fd[])
    FDP->>FR: release(mf) [original ref]

    Note over App: mmap(fd) -> np.frombuffer<br/>Inference/analysis...

    App->>FDP: send(RELEASE, frame_id)
    FDP->>FR: release(mf)
    FR->>HAL: release_frame (ref=0)

    Note over ISP,HAL: DMA-BUF returned to buffer pool
```

**Wire Protocol (`fd_protocol.h`):**

| Direction | Message | Description |
|-----------|---------|-------------|
| Client -> Server | `SUBSCRIBE(stream_name)` | Subscribe to stream |
| Server -> Client | `FRAME` + SCM_RIGHTS | Frame metadata + DMA-BUF fd |
| Client -> Server | `RELEASE(frame_id)` | Return frame |
| Client -> Server | `UNSUBSCRIBE` | Unsubscribe |

**Security Constraints:**
- App container seccomp must allow `DMA_BUF_IOCTL_SYNC` (only this one ioctl)
- `max_outstanding_per_client = 3`, frames dropped if exceeded (backpressure protection)
- Watchdog 200ms timeout forced reclaim (App crash/hang protection)

### 4.2 SHM Ring Buffer (Single memcpy) -- ShmPublisher

**Applicable to:** All Apps (no special container permissions required)

```mermaid
sequenceDiagram
    participant FR as FrameRouter
    participant SP as ShmPublisher
    participant SHM as SHM Ring Buffer
    participant App as App (Python)

    FR->>SP: on_frame(stream, mf)

    alt DMA-BUF frame
        SP->>SP: get_or_mmap(dma_fd) [cached]
        SP->>SP: DMA_BUF_IOCTL_SYNC(START)
        SP->>SHM: memcpy -> slot[write_idx]
        SP->>SP: DMA_BUF_IOCTL_SYNC(END)
    else CPU memory frame
        SP->>SHM: memcpy -> slot[write_idx]
    end

    SP->>SP: slot.state = READY
    SP->>SP: atomic write_seq++
    SP->>FR: release(mf)

    Note over SHM: Slot data ready

    App->>SHM: poll write_seq change
    App->>SHM: read slot (PROT_READ)
    App->>App: np.frombuffer -> process
```

**Performance:** Single memcpy. 640x640 NV12 ~0.1ms, 4K ~2ms.

**DMA-BUF mmap Cache:** HAL buffer pool fds are fixed during stream lifecycle. ShmPublisher caches mmap results to avoid per-frame mmap/munmap syscalls (critical optimization for 4K scenarios).

### 4.3 Comparison of the Two Approaches

| | FD Passthrough | SHM |
|---|---|---|
| Copy | 0 | 1 memcpy |
| 640x640 Latency | ~0.03ms | ~0.1ms |
| 4K Latency | ~0.03ms | ~2ms |
| Container Permissions | seccomp: ioctl, SCM_RIGHTS | No special permissions |
| App Crash Risk | HAL buffer leak (watchdog protection) | No impact |
| Python Interface | recv_fd + mmap + np.frombuffer | mmap + np.frombuffer |
| Recommended Use Case | AI inference, high-framerate processing | General analysis, image saving |

## 5. Frame Lifecycle Management

### 5.1 Reference Counting Flow

```mermaid
stateDiagram-v2
    [*] --> Created: HAL callback
    Created --> Distributed: ref_count = N subscribers

    Distributed --> Retained: FdPublisher retain() +1
    Retained --> Distributed: one client RELEASE -> release() -1

    Distributed --> Released: release() -> ref_count=0
    Released --> HAL_Pool: release_frame()
    HAL_Pool --> [*]

    Distributed --> ForceReclaimed: watchdog timeout 200ms
    ForceReclaimed --> Released: remaining release() calls
    note right of ForceReclaimed: reclaimed=true<br/>HAL already released<br/>skip HAL release
```

### 5.2 Watchdog Forced Reclaim

```mermaid
flowchart TD
    WD[FrameWatchdog Scanner Thread<br/>every 50ms] -->|Scan outstanding| CHECK{Frame hold time<br/>> 200ms?}
    CHECK -->|No| WD
    CHECK -->|Yes| RECLAIM[force_reclaim]
    RECLAIM --> MARK[reclaimed = true]
    MARK --> HAL_REL[release_frame -> HAL]
    HAL_REL --> KEEP[Keep ManagedFrame<br/>wait for remaining releases]

    KEEP --> LATE[Subsequent release calls]
    LATE --> CHK2{ref_count = 0?}
    CHK2 -->|No| KEEP
    CHK2 -->|Yes| DEL[delete ManagedFrame<br/>skip HAL release]
```

## 6. Module Descriptions

### 6.1 HalLoader (`hal_loader.h/cpp`)

Dynamically loads HAL shared libraries via `dlopen`/`dlsym`.

| HAL | Symbol | Required |
|-----|--------|----------|
| Video | `HAL_VIDEO_OPS` | Required |
| Codec | `HAL_CODEC_OPS` | Optional |
| OSD | `HAL_OSD_OPS` | Optional |

### 6.2 VideoSource (`video_source.h/cpp`)

Wraps `hal_video.h` interface, push-mode frame callbacks, supports multi-stream (ISP hardware scaler).

**Key Point:** 4K main stream + 640x640 AI stream + sub-stream are all ISP hardware-scaled outputs, no software scaling.

### 6.3 FrameRouter (`frame_router.h/cpp`)

Reference-counted frame dispatch core.

```cpp
struct ManagedFrame {
    HalRawFrame     frame;           // Shallow copy (dma_fd and other metadata)
    std::atomic<int> ref_count{0};   // Initial = subscriber count
    std::atomic<bool> reclaimed{false}; // Watchdog forced reclaim flag
    uint64_t        frame_id;
};
```

The `retain()` method is used by FdPublisher to increment the reference count per client when dispatching to N clients, extending the frame's lifetime until all clients have RELEASE'd.

`force_reclaim()` safety mechanism: On watchdog timeout, marks `reclaimed = true` and immediately releases the frame to HAL, but does not delete the ManagedFrame (FD clients may still hold references). Subsequent `release()` calls check the `reclaimed` flag and skip HAL release, deleting the object when ref_count finally drops to 0.

### 6.4 FrameWatchdog (`frame_watchdog.h/cpp`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `scan_interval` | 50ms | Scan period |
| `frame_timeout` | 200ms | Timeout forced reclaim |
| `warn_threshold` | 150ms | Warning threshold |

### 6.5 FdPublisher (`fd_publisher.h/cpp`)

Zero-copy DMA-BUF FD publisher.

**Thread Model:**
- 1 accept thread (listening on UDS)
- N recv threads (one per client, handling SUBSCRIBE/RELEASE)
- Frame dispatch on FrameRouter callback thread (non-blocking sendmsg)

**Frame Dispatch Flow:**
```
on_frame(stream, mf):  // FrameRouter callback
  for each subscribed client:
    if outstanding >= max_outstanding -> drop
    retain(mf)            // +1 ref
    sendmsg(SCM_RIGHTS)   // send dma_fd
    track in outstanding
  release(mf)             // release this callback's ref
```

**Client Disconnect Handling:** Release all outstanding frame references for the disconnected client. If a frame has already been reclaimed by the watchdog, release checks the `reclaimed` flag and safely skips HAL release.

### 6.6 ShmPublisher (`shm_publisher.h/cpp`)

SHM ring buffer frame publisher with DMA-BUF mmap cache optimization.

**SHM Memory Layout:**

```mermaid
block-beta
    columns 1
    block:header["ShmHeader (4096 B, page-aligned)"]
        columns 3
        A["magic: 'AIPC'"] B["version, width, height<br/>format, fps, strides"] C["atomic write_seq<br/>atomic latest_slot"]
    end
    block:slot0["Slot 0"]
        columns 2
        D["ShmSlotHeader (64 B)<br/>sequence, timestamp<br/>atomic state, sizes"] E["Pixel Data<br/>Y plane + UV plane<br/>(NV12)"]
    end
    block:slot1["Slot 1"]
        columns 2
        F["ShmSlotHeader (64 B)"] G["Pixel Data"]
    end
    block:slotn["... Slot N-1"]
        columns 2
        H["ShmSlotHeader (64 B)"] I["Pixel Data"]
    end
```

### 6.7 OsdManager (`osd_manager.h/cpp`)

Manages per-stream OSD instances (independent instances for different resolutions). `draw()` performs in-place pixel modification on `HalRawFrame`, used only for the encoding path and does not affect the AI inference stream.

### 6.8 EncoderManager (`encoder_manager.h/cpp`)

Manages HAL Codec hardware encoder instances. Uses push mode (`subscribe`) to obtain encoded packets. `encode_frame` accepts `HalRawFrame*`, and HAL internally accesses DMA-BUF directly for zero-copy encoding. Supports runtime parameter adjustment (bitrate, framerate, GOP, force keyframe).

## 7. Data Flow Overview

```mermaid
flowchart LR
    ISP[ISP<br/>4K Sensor] -->|Hardware scaler| S_MAIN[main stream<br/>3840x2160@30]
    ISP -->|Hardware scaler| S_AI[ai stream<br/>640x640@15]
    ISP -->|Hardware scaler| S_SUB[sub stream<br/>640x480@10]

    S_MAIN --> FR_M[FrameRouter]
    S_AI --> FR_A[FrameRouter]
    S_SUB --> FR_S[FrameRouter]

    FR_M -->|ref| OSD_M[OSD] --> ENC_M[Encoder H.265] --> RTSP[RTSP/HLS]
    FR_M -->|ref| SHM_M[ShmPub] --> APP1[Normal App<br/>Recording/Screenshot]
    FR_M -->|retain| FDP_M[FdPub] --> APP2[Trusted App<br/>4K Analysis]

    FR_A -->|ref| SHM_A[ShmPub] --> APP3[Normal App]
    FR_A -->|retain| FDP_A[FdPub] --> APP4[AI App<br/>hailo_infer]

    FR_S -->|ref| SHM_S[ShmPub] --> APP5[Preview App]

    style S_MAIN fill:#f96,stroke:#333
    style S_AI fill:#6f9,stroke:#333
    style S_SUB fill:#69f,stroke:#333
    style APP4 fill:#ff0,stroke:#333
```

## 8. Typical App-Side Usage

### 8.1 AI Inference (FD Passthrough, Python)

```python
from hailo_ipc_sdk import FrameReceiver

receiver = FrameReceiver("/run/aipc/camera.sock", stream="ai")

with receiver.recv_frame() as frame:
    # frame.array: numpy view on mmap'd DMA-BUF, zero-copy
    # 640x640 NV12, ISP hardware-scaled output
    results = hailo_infer(frame.array)
    # Exiting the with block auto munmap + RELEASE
```

### 8.2 Image Saving (SHM, Python)

```python
from hailo_ipc_sdk import ShmReader

reader = ShmReader("/run/aipc/shm/main.raw")

frame = reader.read_latest()
with open("capture.nv12", "wb") as f:
    f.write(frame)  # Write raw frame directly, no transcoding
```

### 8.3 ROI Crop Analysis (FD Passthrough, Python)

```python
with receiver.recv_frame() as frame:
    h, w = frame.height, frame.width
    y_plane = frame.array[:h*w].reshape(h, w)
    roi = y_plane[100:300, 200:400]  # Zero-copy view crop
    analyze(roi)
```

## 9. Build

```bash
cd platform/camera-daemon
mkdir -p build && cd build
cmake ..
make -j$(nproc)
```

**Dependencies:** C++17, libdl, libpthread, librt. No GStreamer.

## 10. Configuration

```yaml
hal:
  video_library: /opt/aipc/lib/hal/hal-hailo15.so
  codec_library: ""
  osd_library: ""

video:
  device_path: /dev/video0
  streams:
    - { name: main, width: 3840, height: 2160, fps: 30, pool: 8 }
    - { name: ai,   width: 640,  height: 640,  fps: 15, pool: 6 }
    - { name: sub,  width: 640,  height: 480,  fps: 10, pool: 4 }

shm:
  directory: /run/aipc/shm
  buffer_count: 4

fd_publisher:
  sock_path: /run/aipc/camera.sock
  max_clients: 16
  max_outstanding_per_client: 3

watchdog:
  scan_interval_ms: 50
  frame_timeout_ms: 200
  warn_threshold_ms: 150
```

## 11. File Listing

```
platform/camera-daemon/
├── CMakeLists.txt
├── include/
│   ├── camera_daemon.h      # Top-level orchestrator + config structs
│   ├── hal_loader.h          # HAL dynamic loading
│   ├── video_source.h        # HAL Video wrapper
│   ├── frame_router.h        # Reference-counted frame dispatch (retain/release/reclaimed)
│   ├── frame_watchdog.h      # Timeout forced reclaim
│   ├── fd_protocol.h         # FD passthrough wire protocol (SCM_RIGHTS)
│   ├── fd_publisher.h        # FD passthrough publisher
│   ├── shm_protocol.h        # SHM ring buffer memory layout
│   ├── shm_publisher.h       # SHM publisher (with mmap cache)
│   ├── osd_manager.h         # OSD management
│   └── encoder_manager.h     # Hardware encoding management
├── src/
│   ├── main.cpp              # Entry, config, signal handling
│   ├── camera_daemon.cpp     # Orchestrator
│   ├── hal_loader.cpp
│   ├── video_source.cpp
│   ├── frame_router.cpp
│   ├── frame_watchdog.cpp
│   ├── fd_publisher.cpp
│   ├── shm_publisher.cpp
│   ├── osd_manager.cpp
│   └── encoder_manager.cpp
```

## 12. Security Model

```mermaid
flowchart TB
    subgraph Trust["Trust Levels"]
        direction TB
        T1[Platform Services<br/>ai-runtime, event-bus]
        T2[Trusted App<br/>manifest: dma_buf: true]
        T3[Normal App<br/>Default permissions]
    end

    subgraph Delivery["Frame Delivery Method"]
        D1[SCM_RIGHTS Passthrough<br/>Full zero-copy]
        D2[FdPublisher<br/>Zero-copy + backpressure + watchdog]
        D3[ShmPublisher<br/>Single memcpy + read-only mmap]
    end

    T1 --> D1
    T2 --> D2
    T3 --> D3

    subgraph Safety["Safety Mechanisms"]
        S1[max_outstanding = 3<br/>Backpressure limit]
        S2[watchdog 200ms<br/>Forced reclaim]
        S3[reclaimed flag<br/>Safe release]
        S4[UDS 0660 permissions<br/>Group-level access control]
        S5[seccomp<br/>Only allow DMA_BUF_SYNC ioctl]
    end

    D2 --- S1
    D2 --- S2
    D2 --- S3
    D2 --- S4
    D2 --- S5
```

| App Type | Frame Delivery Method | Container Permissions | Risk Control |
|----------|----------------------|----------------------|-------------|
| Trusted App (`dma_buf: true`) | FD passthrough | seccomp: +ioctl(DMA_BUF_SYNC) | Watchdog + backpressure |
| Normal App (default) | SHM | No special permissions | Read-only mmap |
| Platform Service (ai-runtime) | SCM_RIGHTS passthrough | Full trust | N/A |
