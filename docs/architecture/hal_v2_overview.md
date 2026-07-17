# HAL v2 Overview

## Overview

HAL v2 (`hal_v2/`) is the second-generation implementation of the hardware abstraction layer, featuring a modular architecture that supports media pipelines, AI inference, DSP processing, and peripheral control. It coexists with HAL v1 (`hal/`) and is the preferred implementation for new features.

## Directory Structure

```
hal_v2/
├── include/               # Public headers (organized by module)
│   ├── common/           # Common types, logging, buffers
│   ├── media/            # Media pipeline interface (hal_media.h)
│   ├── model/            # AI model interface (inference, post-processing, GenAI)
│   ├── dsp/              # DSP operation interface
│   └── peripheral/       # Peripheral interface (MCU, devices)
├── platforms/            # Platform implementations
│   ├── hailo15/          # Hailo-15 implementation
│   └── stub/             # Test stub implementation
├── common/               # Common source code
├── examples/             # Example programs
├── third_party/          # Third-party dependencies
└── scripts/              # Build scripts
```

## Differences from HAL v1

| Feature | HAL v1 (`hal/`) | HAL v2 (`hal_v2/`) |
|---------|-----------------|---------------------|
| Structure | Flat, organized by function files | Modular, organized by component directories |
| Interface | Direct function calls | Operation tables (Ops structs) |
| Media | Basic video capture/encoding | Full pipeline (configuration, privacy masks, digital zoom, stabilization) |
| AI | Basic inference | Inference + post-processing + GenAI (LLM/VLM) |
| DSP | None | Image processing, format conversion, privacy masks |
| Build | CMake single target | CMake supports single library/modular builds |

## Core Interfaces

### Media Pipeline (`hal_media.h`)

Unified video pipeline lifecycle management:
- Profile switching
- Dynamic image parameters (rotation, flip, zoom, stabilization)
- Privacy masks (polygon)
- Runtime stream add/remove
- Frontend-to-encoder automatic forwarding control

### AI Inference & GenAI

- `hal_model.h`: Model inference and post-processing
- `hal_genai.h`: LLM/VLM streaming generation with custom stop words and context management

### DSP (`hal_dsp.h`)

Image processing operations: crop, scale, format conversion, privacy masks, stabilization.

### Peripherals (`hal_mcu.h`)

Generic MCU communication interface for standardized device control.

## Building

```bash
# Build stub (local testing)
make hal-v2

# Build Hailo-15 (requires cross-compilation SDK)
source /opt/poky/4.0.23/environment-setup-aarch64-poky-linux
make hal-v2 HAL_PLATFORM=hailo15
```

## Hailo-15 Implementation

`platforms/hailo15/` contains the complete Hailo-15 platform implementation:

- **Media**: Video capture, encoding (H.264/H.265), ISP, OSD
- **Inference**: HailoRT inference, post-processing, GenAI
- **DSP**: Hailo DSP-based image processing
- **Peripherals**: LED, RTC, sensor, lens control, GPIO

## Examples

The `examples/` directory contains multiple complete examples:

- AI pipeline (multi-model inference)
- GenAI integration
- Dynamic privacy masks
- Two-stage OCR
- Depth estimation, pose detection
