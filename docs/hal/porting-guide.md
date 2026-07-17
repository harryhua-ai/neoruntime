# HAL Porting Guide

This document guides you through porting AIPC Platform to a new SoC platform.

## Overview

Porting primarily involves implementing the four HAL layer interfaces:
- `hal_video.h` - Camera and ISP
- `hal_ml.h` - AI accelerator
- `hal_codec.h` - Hardware encoder/decoder
- `hal_io.h` - MCU and peripheral control

## Porting Process

### 1. Preparation

1. Confirm the SoC has the following capabilities:
   - Camera interface (MIPI CSI / DVP)
   - AI accelerator (NPU / DSP)
   - Hardware encoder (H.264/H.265)
   - UART/I2C (for MCU communication)

2. Prepare development environment:
   - SoC vendor-provided SDK
   - Cross-compilation toolchain
   - Development board and debug tools

### 2. Implement HAL Video

#### 2.1 V4L2 Method (Recommended)

If the SoC supports standard V4L2 interfaces:

```c
// hal/media/v4l2_impl.c

#include "hal_video.h"
#include <linux/videodev2.h>
#include <sys/ioctl.h>
#include <fcntl.h>

typedef struct {
    int fd;
    struct v4l2_format format;
    struct v4l2_buffer* buffers;
    int num_buffers;
} V4l2Stream;

static int v4l2_init(void) {
    // Initialize V4L2 subsystem
    return HAL_VIDEO_SUCCESS;
}

static int v4l2_open_stream(const char* stream_id, HalVideoStream* out) {
    V4l2Stream* stream = malloc(sizeof(V4l2Stream));
    
    // Open device
    stream->fd = open("/dev/video0", O_RDWR);
    if (stream->fd < 0) {
        return HAL_VIDEO_ERROR_NO_DEVICE;
    }
    
    *out = stream;
    return HAL_VIDEO_SUCCESS;
}

static int v4l2_set_config(HalVideoStream s, const HalStreamConfig* config) {
    V4l2Stream* stream = (V4l2Stream*)s;
    
    // Set format
    struct v4l2_format fmt = {0};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = config->width;
    fmt.fmt.pix.height = config->height;
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_NV12;
    
    if (ioctl(stream->fd, VIDIOC_S_FMT, &fmt) < 0) {
        return HAL_VIDEO_ERROR_INVALID_ARG;
    }
    
    return HAL_VIDEO_SUCCESS;
}

// ... Implement other interfaces

// Export operations table
HalVideoOps HAL_VIDEO_OPS = {
    .init = v4l2_init,
    .deinit = v4l2_deinit,
    .open_stream = v4l2_open_stream,
    .close_stream = v4l2_close_stream,
    .set_config = v4l2_set_config,
    .start = v4l2_start,
    .stop = v4l2_stop,
    .read_frame = v4l2_read_frame,
    .release_frame = v4l2_release_frame,
};
```

#### 2.2 Vendor Private Interface Method

For example, RK3588 uses rkaiq:

```c
// hal/media/rk3588_impl.c

#include "hal_video.h"
#include <rk_aiq_user_api.h>

static int rk_init(void) {
    rk_aiq_working_mode_t mode = RK_AIQ_WORKING_MODE_NORMAL;
    rk_aiq_init(0, mode);
    return HAL_VIDEO_SUCCESS;
}

// ... Implement other interfaces
```

### 3. Implement HAL ML

#### 3.1 Hailo-15 Example

```c
// hal/accel/hailo15_impl.c

#include "hal_ml.h"
#include <hailo/hailort.h>

typedef struct {
    hailo_device device;
    hailo_hef hef;
    hailo_configured_network_group network_group;
} HailoModel;

static int hailo_init(void) {
    // Initialize HailoRT
    return HAL_ML_SUCCESS;
}

static int hailo_load_model(const char* path, HalModel* out) {
    HailoModel* model = malloc(sizeof(HailoModel));
    
    // Load HEF file
    hailo_status status = hailo_create_device(NULL, &model->device);
    if (status != HAILO_SUCCESS) {
        return HAL_ML_ERROR_NO_DEVICE;
    }
    
    status = hailo_create_hef_file(&model->hef, path);
    if (status != HAILO_SUCCESS) {
        return HAL_ML_ERROR_MODEL_LOAD;
    }
    
    // Configure network
    hailo_configure_params_t config_params = {0};
    status = hailo_configure_device(model->device, model->hef, &config_params, 
                                     &model->network_group);
    
    *out = model;
    return HAL_ML_SUCCESS;
}

static int hailo_infer(HalModel m, 
                       const HalTensor* inputs, int num_inputs,
                       HalTensor* outputs, int num_outputs,
                       const HalInferConfig* config) {
    HailoModel* model = (HailoModel*)m;
    
    // Execute inference
    hailo_status status = hailo_run_async(model->network_group, 
                                          inputs, outputs, 
                                          NULL, NULL);
    
    return (status == HAILO_SUCCESS) ? HAL_ML_SUCCESS : HAL_ML_ERROR_GENERIC;
}

// Export operations table
HalMLOps HAL_ML_OPS = {
    .init = hailo_init,
    .load_model = hailo_load_model,
    .infer = hailo_infer,
    // ...
};
```

#### 3.2 RKNN Example

```c
// hal/accel/rknn_impl.c

#include "hal_ml.h"
#include <rknn_api.h>

typedef struct {
    rknn_context ctx;
} RKNNModel;

static int rknn_load_model(const char* path, HalModel* out) {
    RKNNModel* model = malloc(sizeof(RKNNModel));
    
    // Read model file
    FILE* fp = fopen(path, "rb");
    fseek(fp, 0, SEEK_END);
    size_t size = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    
    void* data = malloc(size);
    fread(data, 1, size, fp);
    fclose(fp);
    
    // Load model
    int ret = rknn_init(&model->ctx, data, size, 0);
    free(data);
    
    if (ret != RKNN_SUCC) {
        return HAL_ML_ERROR_MODEL_LOAD;
    }
    
    *out = model;
    return HAL_ML_SUCCESS;
}
```

### 4. Implement HAL Codec

#### 4.1 RK MPP Example

```c
// hal/codec/mpp_impl.c

#include "hal_codec.h"
#include <rockchip/rk_mpi.h>

typedef struct {
    MppCtx ctx;
    MppApi* mpi;
} MPPEncoder;

static int mpp_create_encoder(const HalCodecConfig* config, HalCodec* out) {
    MPPEncoder* enc = malloc(sizeof(MPPEncoder));
    
    // Create MPP context
    mpp_create(&enc->ctx, &enc->mpi);
    mpp_init(enc->ctx, MPP_CTX_ENC, MPP_VIDEO_CodingAVC);
    
    // Configure encoding parameters
    MppEncCfg cfg;
    mpp_enc_cfg_init(&cfg);
    mpp_enc_cfg_set_s32(cfg, "prep:width", config->width);
    mpp_enc_cfg_set_s32(cfg, "prep:height", config->height);
    mpp_enc_cfg_set_s32(cfg, "rc:bps", config->bitrate);
    
    enc->mpi->control(enc->ctx, MPP_ENC_SET_CFG, cfg);
    
    *out = enc;
    return HAL_CODEC_SUCCESS;
}
```

### 5. Implement HAL IO

MCU communication is typically through UART:

```c
// hal/board/uart_impl.c

#include "hal_io.h"
#include <termios.h>
#include <fcntl.h>

static int uart_fd = -1;

static int uart_init(void) {
    uart_fd = open("/dev/ttyS1", O_RDWR | O_NOCTTY);
    if (uart_fd < 0) {
        return HAL_IO_ERROR_NO_DEVICE;
    }
    
    // Configure serial port parameters
    struct termios options;
    tcgetattr(uart_fd, &options);
    cfsetispeed(&options, B115200);
    cfsetospeed(&options, B115200);
    options.c_cflag |= (CLOCAL | CREAD);
    options.c_cflag &= ~PARENB;
    options.c_cflag &= ~CSTOPB;
    options.c_cflag &= ~CSIZE;
    options.c_cflag |= CS8;
    tcsetattr(uart_fd, TCSANOW, &options);
    
    return HAL_IO_SUCCESS;
}

static int uart_send_command(const HalIORequest* req) {
    // Build protocol frame
    uint8_t frame[256];
    int len = 0;
    
    frame[len++] = 0xAA;  // Header
    frame[len++] = 0x55;
    frame[len++] = req->cmd;
    frame[len++] = req->payload_len;
    memcpy(&frame[len], req->payload, req->payload_len);
    len += req->payload_len;
    
    // Checksum
    uint8_t checksum = 0;
    for (int i = 0; i < len; i++) {
        checksum ^= frame[i];
    }
    frame[len++] = checksum;
    
    // Send
    write(uart_fd, frame, len);
    
    // Receive response
    if (req->resp_buf) {
        int n = read(uart_fd, req->resp_buf, req->resp_buf_size);
        req->resp_len = n;
    }
    
    return HAL_IO_SUCCESS;
}
```

### 6. Build and Install

#### 6.1 CMakeLists.txt Example

```cmake
# hal/CMakeLists.txt

cmake_minimum_required(VERSION 3.10)
project(aipc_hal)

# Select implementation based on platform
if(TARGET_SOC STREQUAL "hailo15")
    set(HAL_IMPL_SOURCES
        media/v4l2_impl.c
        accel/hailo15_impl.c
        codec/hailo_codec_impl.c
        board/uart_impl.c
    )
    find_package(HailoRT REQUIRED)
    set(HAL_LIBS ${HailoRT_LIBRARIES})
    
elseif(TARGET_SOC STREQUAL "rk3588")
    set(HAL_IMPL_SOURCES
        media/rk3588_impl.c
        accel/rknn_impl.c
        codec/mpp_impl.c
        board/uart_impl.c
    )
    find_library(RKNN_LIB rknn_api)
    find_library(MPP_LIB rockchip_mpp)
    set(HAL_LIBS ${RKNN_LIB} ${MPP_LIB})
endif()

# Build shared library
add_library(hal-${TARGET_SOC} SHARED ${HAL_IMPL_SOURCES})
target_include_directories(hal-${TARGET_SOC} PUBLIC include)
target_link_libraries(hal-${TARGET_SOC} ${HAL_LIBS})

# Install
install(TARGETS hal-${TARGET_SOC}
        LIBRARY DESTINATION /opt/aipc/lib/hal)
```

#### 6.2 Build Commands

```bash
mkdir build && cd build
cmake .. -DTARGET_SOC=hailo15
make
sudo make install
```

### 7. Testing

#### 7.1 Unit Tests

```c
// hal/tests/test_video.c

#include "hal_video.h"
#include <assert.h>

void test_video_init() {
    int ret = HAL_VIDEO_OPS.init();
    assert(ret == HAL_VIDEO_SUCCESS);
}

void test_video_open() {
    HalVideoStream stream;
    int ret = HAL_VIDEO_OPS.open_stream("cam0_main", &stream);
    assert(ret == HAL_VIDEO_SUCCESS);
    assert(stream != NULL);
}

int main() {
    test_video_init();
    test_video_open();
    printf("All tests passed\n");
    return 0;
}
```

#### 7.2 Integration Tests

Configure the platform to use the new HAL:

```yaml
# configs/platform/camera-daemon.yaml
hal:
  library_path: /opt/aipc/lib/hal/hal-rk3588.so
```

Start platform services and verify functionality.

## Common Issues

### Q: How to handle DMA-BUF?

A: Fill `HalFrame.dma_fds` in `read_frame()`, and the platform will automatically handle zero-copy.

### Q: How to support multiple cameras?

A: Open different devices in `open_stream()` based on the `stream_id` parameter.

### Q: What to do about insufficient inference performance?

A: Check if `HalMLOps.infer()` uses the hardware acceleration path, and avoid CPU copies.

### Q: Incompatible MCU protocol?

A: Modify the protocol encapsulation in the `hal_io.h` implementation while keeping the interface unchanged.

## References

- [HAL Interface Complete Definition](interfaces.md)
- [Hailo-15 SDK Documentation](https://hailo.ai/developer-zone/)
- [RK3588 SDK Documentation](https://github.com/rockchip-linux)
- [Jetson SDK Documentation](https://developer.nvidia.com/embedded/jetson)