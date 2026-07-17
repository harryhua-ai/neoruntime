/**
 * WebCodecs H264 Player
 *
 * Uses the WebCodecs API for direct H264 decoding without MP4 encapsulation.
 * Falls back to MSE player if WebCodecs is not supported.
 *
 * Advantages over MSE:
 * - No MP4 muxing overhead
 * - Direct frame-level control
 * - Better error recovery
 * - Can detect and handle frame drops explicitly
 */

interface CallbackEvent {
  t: 'mseError' | 'startPlay';
}

type CallbackFunction = (event: CallbackEvent) => void;

interface Mp4EventData {
  data: ArrayBuffer;
  codec: string;
}

interface NALUnit {
  data: Uint8Array;
  type: number;
  isKeyframe: boolean;
}

/* eslint-disable class-methods-use-this */
// Check if WebCodecs is supported
export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoDecoder !== 'undefined'
    && typeof VideoFrame !== 'undefined'
    && typeof EncodedVideoChunk !== 'undefined'
  );
}

class WebCodecsPlayer {
  private decoder: VideoDecoder | null = null;

  private canvas: HTMLCanvasElement | null = null;

  private ctx: CanvasRenderingContext2D | null = null;

  private cb: CallbackFunction;

  private codec: string = '';

  private sps: Uint8Array | null = null;

  private pps: Uint8Array | null = null;

  private isInitialized: boolean = false;

  private frameCount: number = 0;

  private isActive: boolean = true;

  constructor(cb: CallbackFunction) {
    this.cb = cb;
  }

  /**
   * Initialize the WebCodecs decoder
   */
  async initMse(codecString: string): Promise<boolean> {
    // console.log('[WebCodecs] initMse called, codec:', codecString);

    if (!isWebCodecsSupported()) {
      console.error('[WebCodecs] Not supported in this browser');
      return false;
    }

    this.codec = codecString;
    return true;
  }

  /**
   * Set the canvas element for rendering
   */
  setVideoElement(videoElement: HTMLVideoElement): void {
    // Create a canvas to render decoded frames
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    this.canvas.style.cssText =      'width: 100%; height: 100%; object-fit: contain;';
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    // Replace video element with canvas
    if (videoElement.parentNode) {
      videoElement.parentNode.replaceChild(this.canvas, videoElement);
    }
  }

  /**
   * Process H264 NAL units and decode them
   */
  processMp4VideoData(event: { data: Mp4EventData }): void {
    if (!this.isActive) return;

    const objData = event.data;
    const data = new Uint8Array(objData.data);

    // Parse NAL units from AVCC format
    const nals = this.parseAVCCNALs(data);

    // Extract SPS/PPS and initialize decoder
    for (const nal of nals) {
      const nalType = nal.type;

      if (nalType === 7) {
        // SPS
        this.sps = nal.data;
        // console.log('[WebCodecs] Received SPS, size:', nal.data.length);
      } else if (nalType === 8) {
        // PPS
        this.pps = nal.data;
        // console.log('[WebCodecs] Received PPS, size:', nal.data.length);
      }
    }

    // Initialize decoder when we have SPS and PPS
    if (!this.isInitialized && this.sps && this.pps) {
      this.initializeDecoder();
    }

    // Decode video NALs (exclude SPS/PPS/AUD/SEI)
    if (this.isInitialized && this.decoder) {
      for (const nal of nals) {
        // NAL type 1-5 are VCL NALs (video coding layer)
        // Type 5 = IDR (keyframe), Types 1-4 = non-IDR
        if (nal.type >= 1 && nal.type <= 5) {
          this.decodeNAL(nal.data, nal.type === 5);
        }
      }
    }
  }

  /**
   * Parse NAL units from AVCC format (4-byte length prefix)
   */
  // eslint-disable-next-line class-methods-use-this
  private parseAVCCNALs(data: Uint8Array): NALUnit[] {
    const nals: NALUnit[] = [];
    let offset = 0;

    while (offset + 4 <= data.length) {
      const length =        (data[offset] << 24)
        | (data[offset + 1] << 16)
        | (data[offset + 2] << 8)
        | data[offset + 3];

      if (length <= 0 || offset + 4 + length > data.length) {
        break;
      }

      const nalData = data.subarray(offset + 4, offset + 4 + length);
      const nalType = nalData[0] & 0x1f;

      nals.push({
        data: nalData,
        type: nalType,
        isKeyframe: nalType === 5, // IDR frame
      });

      offset += 4 + length;
    }

    return nals;
  }

  /**
   * Initialize the VideoDecoder
   */
  private initializeDecoder(): void {
    if (!this.sps || !this.pps) return;

    try {
      // Generate codec string from SPS if not set
      if (!this.codec || this.codec === '') {
        const profileIdc = this.sps[1];
        const profileCompatibility = this.sps[2];
        const levelIdc = this.sps[3];
        this.codec = `avc1.${profileIdc.toString(16).padStart(2, '0')}${profileCompatibility.toString(16).padStart(2, '0')}${levelIdc.toString(16).padStart(2, '0')}`;
      }

      // Create codec description in AVCC format
      const description = this.createCodecDescription(this.sps, this.pps);

      const config: VideoDecoderConfig = {
        codec: this.codec,
        description,
        optimizeForLatency: true,
      };

      console.log('[WebCodecs] Initializing decoder with codec:', this.codec);

      this.decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          this.renderFrame(frame);
        },
        error: (error: Error) => {
          console.error('[WebCodecs] Decoder error:', error);
          // Notify parent to fall back to MSE
          this.cb({ t: 'mseError' });
        },
      });

      try {
        this.decoder.configure(config);
        // Check if configuration was successful
        if (this.decoder.state === 'configured') {
          // console.log('[WebCodecs] Decoder configured successfully');
          this.isInitialized = true;
          this.cb({ t: 'startPlay' });
        } else {
          console.error('[WebCodecs] Decoder failed to configure');
          this.handleDecoderError();
        }
      } catch (configureErr) {
        console.error('[WebCodecs] Exception during configure:', configureErr);
        this.handleDecoderError();
      }
    } catch (e) {
      console.error('[WebCodecs] Failed to initialize decoder:', e);
      this.handleDecoderError();
    }
  }

  /**
   * Create codec description from SPS/PPS in AVCC format
   */
  // eslint-disable-next-line class-methods-use-this
  private createCodecDescription(sps: Uint8Array, pps: Uint8Array): Uint8Array {
    // AVCC format:
    // - configuration version (1 byte)
    // - profile, level, compatibility (3 bytes)
    // - length size minus one (1 byte, usually 3 = 4 bytes)
    // - number of SPS (1 byte)
    // - SPS length (2 bytes) + SPS data
    // - number of PPS (1 byte)
    // - PPS length (2 bytes) + PPS data

    const result = new Uint8Array(
      1 + 3 + 1 + 1 + 2 + sps.length + 1 + 2 + pps.length
    );
    let offset = 0;

    // Configuration version
    result[offset++] = 1;

    // Profile, profile compatibility, level
    /* eslint-disable prefer-destructuring */
    result[offset++] = sps[1];
    result[offset++] = sps[2];
    result[offset++] = sps[3];
    /* eslint-enable prefer-destructuring */

    // Length size minus one (4 bytes)
    result[offset++] = 0xff;

    // Number of SPS
    result[offset++] = 0xe1; // 1 SPS with high bits set

    // SPS length
    result[offset++] = (sps.length >> 8) & 0xff;
    result[offset++] = sps.length & 0xff;

    // SPS data
    result.set(sps, offset);
    offset += sps.length;

    // Number of PPS
    result[offset++] = 1;

    // PPS length
    result[offset++] = (pps.length >> 8) & 0xff;
    result[offset++] = pps.length & 0xff;

    // PPS data
    result.set(pps, offset);

    return result;
  }

  /**
   * Decode a NAL unit
   */
  private decodeNAL(nalData: Uint8Array, isKeyframe: boolean): void {
    if (!this.decoder || this.decoder.state !== 'configured') {
      return;
    }

    // Convert Annex-B to AVCC if needed
    let data = nalData;
    if (
      nalData[0] === 0
      && nalData[1] === 0
      && nalData[2] === 0
      && nalData[3] === 1
    ) {
      // Annex-B format with start code - convert to AVCC
      data = new Uint8Array(nalData.length - 4);
      const length = nalData.length - 4;
      data[0] = (length >> 24) & 0xff;
      data[1] = (length >> 16) & 0xff;
      data[2] = (length >> 8) & 0xff;
      data[3] = length & 0xff;
      data.set(nalData.subarray(4), 4);
    } else if (nalData[0] === 0 && nalData[1] === 0 && nalData[2] === 1) {
      // 3-byte start code
      data = new Uint8Array(nalData.length - 3);
      const length = nalData.length - 3;
      data[0] = (length >> 24) & 0xff;
      data[1] = (length >> 16) & 0xff;
      data[2] = (length >> 8) & 0xff;
      data[3] = length & 0xff;
      data.set(nalData.subarray(3), 4);
    }

    try {
      // Generate timestamp in microseconds (90kHz * 1000 / 90 = microseconds)
      const timestamp = this.frameCount * 33333; // ~30fps
      this.frameCount++;

      const chunk = new EncodedVideoChunk({
        type: isKeyframe ? 'key' : 'delta',
        timestamp,
        data,
      });

      this.decoder.decode(chunk);
    } catch (e) {
      console.error('[WebCodecs] Failed to decode chunk:', e);
    }
  }

  /**
   * Render decoded frame to canvas
   */
  private renderFrame(frame: VideoFrame): void {
    if (!this.ctx || !this.canvas || !this.isActive) {
      frame.close();
      return;
    }

    // Update canvas size if needed
    if (
      this.canvas.width !== frame.displayWidth
      || this.canvas.height !== frame.displayHeight
    ) {
      this.canvas.width = frame.displayWidth;
      this.canvas.height = frame.displayHeight;
    }

    // Draw frame to canvas
    this.ctx.drawImage(frame, 0, 0);

    frame.close();

    // Auto-play notification on first frame
    if (this.frameCount === 1) {
      // console.log('[WebCodecs] First frame rendered');
      this.cb({ t: 'startPlay' });
    }
  }

  /**
   * Handle decoder errors
   */
  private handleDecoderError(): void {
    console.warn('[WebCodecs] Decoder error, triggering MSE fallback');
    this.cb({ t: 'mseError' });
  }

  /**
   * Uninitialize and cleanup
   */
  uninitMse(): void {
    this.isActive = false;

    if (this.decoder) {
      try {
        if (this.decoder.state === 'configured') {
          this.decoder.close();
        }
      } catch {
        // Ignore close errors
      }
      this.decoder = null;
    }

    if (this.ctx) {
      this.ctx = null;
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.remove();
    }

    this.canvas = null;
    this.sps = null;
    this.pps = null;
    this.isInitialized = false;
    this.frameCount = 0;
  }

  /**
   * Clear buffer (no-op for WebCodecs as we don't buffer)
   */
  clearBuffer(): void {
    // WebCodecs doesn't maintain a buffer like MSE
  }

  setPlayMode(_playback: boolean): void {
    // No-op for WebCodecs
  }

  resetInitFlag(): void {
    // No-op for WebCodecs
  }

  getInitFlag(): number {
    return this.isInitialized ? 2 : 0; // statusNormal : statusIdel
  }
}

export default WebCodecsPlayer;
