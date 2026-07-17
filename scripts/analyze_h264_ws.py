#!/usr/bin/env python3
"""Analyze H264 WebSocket stream to understand NAL unit patterns."""

import asyncio
import websockets
import struct

# NAL type definitions
NAL_TYPES = {
    1: "Non-IDR slice (P-frame)",
    2: "Slice data partition A",
    3: "Slice data partition B",
    4: "Slice data partition C",
    5: "IDR slice (I-frame/keyframe)",
    6: "SEI (Supplemental Enhancement Information)",
    7: "SPS (Sequence Parameter Set)",
    8: "PPS (Picture Parameter Set)",
    9: "AUD (Access Unit Delimiter)",
    10: "End of sequence",
    11: "End of stream",
    12: "Filler data",
}

async def analyze_h264_stream(url: str, count: int = 50):
    """Connect to H264 WebSocket and analyze NAL units."""
    print(f"Connecting to {url}...")
    print(f"Analyzing {count} NAL units...\n")

    nal_type_counts = {}
    size_distribution = {}
    pattern_analysis = []

    async with websockets.connect(url) as ws:
        msg_count = 0
        while msg_count < count:
            try:
                data = await asyncio.wait_for(ws.recv(), timeout=10.0)
                msg_count += 1

                if len(data) < 5:
                    print(f"[{msg_count}] Too small: {len(data)} bytes")
                    continue

                # Parse AVCC format: 4-byte length + NAL data
                nal_len = struct.unpack(">I", data[0:4])[0]
                nal_type = data[4] & 0x1f

                # Track statistics
                nal_type_counts[nal_type] = nal_type_counts.get(nal_type, 0) + 1
                size_distribution[len(data)] = size_distribution.get(len(data), 0) + 1

                # Store pattern for analysis
                pattern_analysis.append((msg_count, len(data), nal_type, nal_len))

                # Print details
                nal_name = NAL_TYPES.get(nal_type, f"Unknown ({nal_type})")
                print(f"[{msg_count:3d}] Size: {len(data):5d}B | NAL type: {nal_type:2d} ({nal_name[:30]}) | NAL len: {nal_len}")

            except asyncio.TimeoutError:
                print("Timeout waiting for data")
                break

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)

    print("\nNAL Type Distribution:")
    for nal_type, count in sorted(nal_type_counts.items()):
        nal_name = NAL_TYPES.get(nal_type, "Unknown")
        print(f"  Type {nal_type:2d} ({nal_name[:25]}): {count}")

    print("\nSize Distribution:")
    for size, count in sorted(size_distribution.items()):
        print(f"  {size:5d} bytes: {count} times")

    # Analyze 91-byte pattern
    print("\n91-Byte Pattern Analysis:")
    ninety_one_occurrences = [(msg, nal_type) for msg, size, nal_type, _ in pattern_analysis if size == 91]
    if ninety_one_occurrences:
        print(f"  Found {len(ninety_one_occurrences)} occurrences of 91 bytes")
        for msg, nal_type in ninety_one_occurrences[:10]:
            nal_name = NAL_TYPES.get(nal_type, "Unknown")
            print(f"    Message {msg}: NAL type {nal_type} ({nal_name})")

    # Check alternating pattern
    print("\nPattern Check (alternating sizes):")
    sizes = [size for _, size, _, _ in pattern_analysis]
    if len(sizes) >= 10:
        recent = sizes[-10:]
        print(f"  Last 10 sizes: {recent}")

        # Check if there's a pattern
        if 91 in sizes:
            positions = [i for i, s in enumerate(sizes) if s == 91]
            if len(positions) >= 2:
                gaps = [positions[i+1] - positions[i] for i in range(len(positions)-1)]
                print(f"  Positions of 91B: {positions}")
                print(f"  Gaps between: {gaps}")
                if len(set(gaps)) == 1:
                    print(f"  --> REGULAR PATTERN: every {gaps[0]} messages")

if __name__ == "__main__":
    URL = "ws://192.0.2.72:8080/api/v1/h264/main"
    asyncio.run(analyze_h264_stream(URL, 100))