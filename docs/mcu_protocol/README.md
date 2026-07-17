# AIPC MCU Communication Protocol

## Overview

The AIPC platform uses an MCU (STM32/ESP32/etc.) to control peripherals. Communication between the Hailo-15 SoC and MCU is via UART.

## Protocol Specification

### Frame Format

```
[Header] [Cmd] [Len] [Payload] [Checksum]
```

| Field | Size | Description |
|-------|------|-------------|
| Header | 2 bytes | Fixed: `0xAA 0x55` |
| Cmd | 1 byte | Command code (see table below) |
| Len | 1 byte | Payload length (0-255) |
| Payload | N bytes | Command parameters |
| Checksum | 1 byte | XOR of all previous bytes |

### UART Configuration

- Baud rate: 115200
- Data bits: 8
- Parity: None
- Stop bits: 1
- Flow control: None

### Command Codes

#### 0x1X - Light Control

| Code | Command | Payload | Response |
|------|---------|---------|----------|
| 0x10 | SetWhiteLight | 1 byte: level (0-100) | Status |
| 0x11 | SetIrLed | 1 byte: on/off (0/1) | Status |
| 0x12 | SetIrCut | 1 byte: mode (0=Auto, 1=Day, 2=Night) | Status |

#### 0x2X - PTZ Control

| Code | Command | Payload | Response |
|------|---------|---------|----------|
| 0x20 | Pan | 2 bytes: direction, speed | Status |
| 0x21 | Tilt | 2 bytes: direction, speed | Status |
| 0x22 | PTZStop | None | Status |
| 0x23 | SavePreset | 1 byte: preset_id (1-16) | Status |
| 0x24 | CallPreset | 1 byte: preset_id (1-16) | Status |

Direction values:
- Pan: 0=Stop, 1=Left, 2=Right
- Tilt: 0=Stop, 1=Up, 2=Down

Speed: 0-100

#### 0x3X - Lens Control

| Code | Command | Payload | Response |
|------|---------|---------|----------|
| 0x30 | Zoom | 1 byte: speed (-100 to +100, signed) | Status |
| 0x31 | Focus | 1 byte: speed (-100 to +100, signed) | Status |
| 0x32 | Autofocus | 1 byte: enable (0/1) | Status |

#### 0x4X - GPIO

| Code | Command | Payload | Response |
|------|---------|---------|----------|
| 0x40 | GPIOSet | 2 bytes: pin, value | Status |
| 0x41 | GPIOGet | 1 byte: pin | Status + 1 byte value |

#### 0x5X - Status Query

| Code | Command | Payload | Response |
|------|---------|---------|----------|
| 0x50 | GetTemperature | None | Status + 2 floats (SoC, MCU) |
| 0x51 | GetLightSensor | None | Status + 2 bytes (sensor value) |
| 0x52 | GetPTZPosition | None | Status + 4 bytes (pan, tilt) |
| 0x53 | GetZoomFocus | None | Status + 4 bytes (zoom, focus) |

#### 0xFX - System Commands

| Code | Command | Payload | Response |
|------|---------|---------|----------|
| 0xF0 | MCUReset | None | Status |
| 0xFF | GetVersion | None | Status + version string |

### Response Format

```
[Header] [Cmd] [Status] [DataLen] [Data] [Checksum]
```

| Field | Size | Description |
|-------|------|-------------|
| Header | 2 bytes | `0xAA 0x55` |
| Cmd | 1 byte | Original command code |
| Status | 1 byte | 0=Success, 1=Error, 2=Busy, 3=Not Supported |
| DataLen | 1 byte | Response data length |
| Data | N bytes | Response data |
| Checksum | 1 byte | XOR checksum |

## Example Transactions

### Example 1: Set White Light to 80%

**Request:**
```
AA 55 10 01 50 EB
```
- Header: AA 55
- Cmd: 0x10 (SetWhiteLight)
- Len: 0x01
- Payload: 0x50 (80 in hex)
- Checksum: 0xEB (XOR of all previous bytes)

**Response:**
```
AA 55 10 00 00 EB
```
- Header: AA 55
- Cmd: 0x10
- Status: 0x00 (Success)
- DataLen: 0x00
- Checksum: 0xEB

### Example 2: Get Temperature

**Request:**
```
AA 55 50 00 FA
```
- Header: AA 55
- Cmd: 0x50 (GetTemperature)
- Len: 0x00
- Checksum: 0xFA

**Response:**
```
AA 55 50 00 08 [temp_data] [checksum]
```
- 8 bytes of data: 2x float32 (SoC temp, MCU temp)

### Example 3: Call PTZ Preset 3

**Request:**
```
AA 55 24 01 03 7D
```
- Cmd: 0x24 (CallPreset)
- Payload: 0x03 (Preset ID 3)

**Response:**
```
AA 55 24 00 00 7E
```
- Status: Success

## Checksum Calculation

Simple XOR of all bytes before checksum:

```c
uint8_t calculate_checksum(uint8_t* data, int len) {
    uint8_t checksum = 0;
    for (int i = 0; i < len; i++) {
        checksum ^= data[i];
    }
    return checksum;
}
```

## Error Handling

### Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0x00 | Success | Command executed successfully |
| 0x01 | Error | Generic error, check logs |
| 0x02 | Busy | Device busy, retry later |
| 0x03 | Not Supported | Command not supported by this MCU |
| 0x04 | Invalid Param | Invalid parameter value |
| 0x05 | Timeout | Operation timeout |

### Timeout and Retry

- Default timeout: 1000ms
- Max retries: 3
- Retry delay: 100ms

## MCU Implementation Guide

### Initialization

```c
void mcu_uart_init() {
    // Configure UART
    UART_Init(115200, 8, NONE, 1);
    
    // Enable RX interrupt
    UART_EnableRxInterrupt();
}
```

### Command Handler

```c
void mcu_handle_command(uint8_t cmd, uint8_t* payload, uint8_t len) {
    switch (cmd) {
        case 0x10:  // SetWhiteLight
            pwm_set_duty_cycle(PWM_WHITE_LIGHT, payload[0]);
            send_response(cmd, 0x00, NULL, 0);
            break;
            
        case 0x20:  // Pan
            ptz_pan(payload[0], payload[1]);
            send_response(cmd, 0x00, NULL, 0);
            break;
            
        // ... more cases
        
        default:
            send_response(cmd, 0x03, NULL, 0);  // Not supported
            break;
    }
}
```

### Response Function

```c
void send_response(uint8_t cmd, uint8_t status, uint8_t* data, uint8_t len) {
    uint8_t frame[256];
    int idx = 0;
    
    frame[idx++] = 0xAA;
    frame[idx++] = 0x55;
    frame[idx++] = cmd;
    frame[idx++] = status;
    frame[idx++] = len;
    
    if (len > 0 && data != NULL) {
        memcpy(&frame[idx], data, len);
        idx += len;
    }
    
    // Calculate checksum
    uint8_t checksum = 0;
    for (int i = 0; i < idx; i++) {
        checksum ^= frame[i];
    }
    frame[idx++] = checksum;
    
    // Send
    UART_Send(frame, idx);
}
```

## Testing

### Test Tool

Use the provided test tool:

```bash
# Test white light
aipc-mcu-test --cmd 0x10 --payload 50

# Test PTZ preset
aipc-mcu-test --cmd 0x24 --payload 03
```

### Python Test Script

```python
import serial

def send_command(ser, cmd, payload):
    # Build frame
    frame = bytearray([0xAA, 0x55, cmd, len(payload)])
    frame.extend(payload)
    
    # Checksum
    checksum = 0
    for b in frame:
        checksum ^= b
    frame.append(checksum)
    
    # Send
    ser.write(frame)
    
    # Receive response
    resp = ser.read(6)  # Minimum response size
    return resp

# Example usage
with serial.Serial('/dev/ttyS1', 115200) as ser:
    # Set white light to 80
    resp = send_command(ser, 0x10, [80])
    print(f"Response: {resp.hex()}")
```

## Performance Considerations

### Latency

- UART transmission: ~0.87ms (10 bytes @ 115200 bps)
- MCU processing: <1ms
- Total round-trip: ~2-3ms

This is negligible compared to:
- Video frame interval: 16.7-33ms (30-60fps)
- Motor movement: 10-100ms

### Throughput

Maximum commands per second:
- Theoretical: ~1000 cmd/sec
- Practical: ~500 cmd/sec (with responses)

This is sufficient for real-time control.

## Firmware Update

MCU firmware can be updated via:
1. UART bootloader
2. SWD/JTAG interface
3. OTA update command (future)

## Debugging

### Enable Debug Mode

Send command `0xFE` to enable verbose logging on MCU UART.

### Packet Capture

```bash
# Capture UART traffic
cat /dev/ttyS1 | hexdump -C
```

## Reference Implementation

See `hal/board/mcu_protocol.c` for Linux-side implementation.

See `docs/mcu_protocol/example_firmware/` for example MCU firmware (STM32).

## Version History

- v1.0 - Initial protocol definition
- v1.1 - Add autofocus command
- v1.2 - Add temperature query

---

**Current Version:** 1.2  
**Last Updated:** 2024-12-12

