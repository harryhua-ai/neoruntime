import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoStreamPlayer } from '@/lib/videoStream';
import { AudioPlayer } from '@/lib/audioStream/audioPlayer';
import Loading from '@/components/loading';
import { Button } from '@/components/ui/button';
import PlayerPanel from './player-panel';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { setItem, getItem } from '@/utils/storage';
import { useAudioControlStore } from '@/store/audio';
import { useAudioTalk } from '@/lib/audioStream/useAudioTalk';

type PlayerProps = {
  videoUrl: string;
  videoRendererInstance: React.RefObject<VideoStreamPlayer | null>;
  showPanel?: boolean;
  enableDoubleClickFullscreen?: boolean;
  /** Configured stream width for accurate snapshot dimensions */
  streamWidth?: number;
  /** Configured stream height for accurate snapshot dimensions */
  streamHeight?: number;
  /** How the video fills its container */
  objectFit?: 'contain' | 'cover';
  /** When false, audio stream is never started and controls are hidden */
  enableAudio?: boolean;
  /** Initial stream stats overlay visibility (overrides localStorage when set) */
  defaultStreamStatsVisible?: boolean;
  /**
   * Render the audio controls (mute / volume / listen / PTT) inside the player
   * overlay and host the audio engine here. Pass true on the single player
   * instance that owns audio (Media page) — other players stay engine-free.
   */
  audioOverlay?: boolean;
};

const STREAM_STATS_KEY = 'deviceToolStreamStatsVisible';

export default function Player({
  videoUrl,
  videoRendererInstance,
  showPanel = true,
  enableDoubleClickFullscreen = true,
  streamWidth,
  streamHeight,
  objectFit = 'contain',
  enableAudio = true,
  defaultStreamStatsVisible,
  audioOverlay = false,
}: PlayerProps) {
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  // isloading and isReload are mutually exclusive
  // const [isReload, setIsReload] = useState(false);
  const [isShowPanel, setIsShowPanel] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const audioUnlockedRef = useRef(false);
  // True while we're waiting out a profile-switch pipeline restart. Suppresses
  // the "Disconnected" UI that would otherwise flash when the daemon tears down
  // its GStreamer pipeline before the player reconnects.
  const profileSwitchingRef = useRef(false);
  const [isShowStreamStats, setIsShowStreamStats] = useState<boolean>(() => {
    if (defaultStreamStatsVisible !== undefined) {
      return defaultStreamStatsVisible;
    }
    if (typeof window === 'undefined') return false;
    try {
      const stored = window.localStorage.getItem(STREAM_STATS_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });
  const [streamStats, setStreamStats] = useState({
    fps: 0,
    latency: 0,
    bandwidth: 0,
  });
  const [isControlPanel, setIsControlPanel] = useState(false);
  // Audio controls (mute / volume / listen / PTT) render in the player overlay
  // on pages that opt in via `audioOverlay`. They bridge through this shared
  // store; the player owns the AudioPlayer listen lifecycle (gesture unlock +
  // video-reconnect sync) and, when overlay is on, the PTT engine too.
  const listenEnabled = useAudioControlStore(s => s.listenEnabled);
  const muted = useAudioControlStore(s => s.muted);
  const volume = useAudioControlStore(s => s.volume);
  const captureAvailable = useAudioControlStore(s => s.captureAvailable);
  const playbackEnabled = useAudioControlStore(s => s.playbackEnabled);
  const setListen = useAudioControlStore(s => s.setListen);
  const setMuted = useAudioControlStore(s => s.setMuted);
  const setVolume = useAudioControlStore(s => s.setVolume);

  // PTT engine + device status sync. Only runs on the overlay host so other
  // player instances (dashboard / image) never spawn a second talk session.
  const { talking, level, pressStart, pressEnd } = useAudioTalk({
    enabled: audioOverlay,
  });

  // AudioPlayer should run when: audio enabled at all, the user asked to
  // listen, the device capture HW is on, and the browser isn't muted.
  const audioShouldPlay = enableAudio && listenEnabled && captureAvailable && !muted;

  const [connectionState, setConnectionState] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');
  const [videoVisible, setVideoVisible] = useState(false);

  // Ref mirror so async/gesture callbacks read the latest gate without being
  // recreated on every store update.
  const audioSettingsRef = useRef({ audioShouldPlay, volume, videoUrl });
  audioSettingsRef.current = { audioShouldPlay, volume, videoUrl };

  const startAudioPlayer = useCallback(() => {
    const settings = audioSettingsRef.current;
    if (
      !settings.audioShouldPlay
      || !settings.videoUrl
      || audioPlayerRef.current?.active
    ) {
      return;
    }

    const audioBaseUrl = window.location.origin.replace(/^http/, 'ws');
    let token = getItem<string>('token') || '';
    if (token.startsWith('Bearer ')) {
      token = token.substring(7);
    }
    const audioUrl = `${audioBaseUrl}/api/v1/audio/stream?token=${encodeURIComponent(token)}`;
    const player = new AudioPlayer({ syncDelayMs: 300 });
    player.setVolume(settings.volume);
    audioPlayerRef.current = player;
    player.start(audioUrl);
  }, []);

  // Start/stop the AudioPlayer reactively as the store's gate conditions
  // change (mic-listen toggled, mute toggled, capture HW flipped by the
  // Peripheral page). Requires the user-gesture unlock first; the gesture
  // unlock effect below flips audioUnlockedRef and calls startAudioPlayer.
  useEffect(() => {
    if (!audioShouldPlay) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop();
        audioPlayerRef.current = null;
      }
      return;
    }
    if (audioUnlockedRef.current) {
      startAudioPlayer();
    }
  }, [audioShouldPlay, startAudioPlayer]);

  // Apply browser-side volume changes from the store to the live AudioPlayer.
  useEffect(() => {
    audioPlayerRef.current?.setVolume(volume);
  }, [volume]);

  // Keep snapshot dimensions in a ref to avoid closure staleness in async effects
  const snapshotDimsRef = useRef<{ width: number; height: number } | null>(
    null
  );

  useEffect(() => {
    if (streamWidth && streamHeight) {
      snapshotDimsRef.current = { width: streamWidth, height: streamHeight };
      videoRendererInstance.current?.setSnapshotDimensions(
        streamWidth,
        streamHeight
      );
    }
  }, [streamWidth, streamHeight, videoRendererInstance]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setItem(STREAM_STATS_KEY, isShowStreamStats);
    } catch {
      // ignore storage errors
    }
  }, [isShowStreamStats]);

  useEffect(() => {
    let isCancelled = false;

    const initializePlayer = async () => {
      setLoading(true);
      setConnectionState('connecting');
      setVideoVisible(false);

      if (!videoUrl) return;

      const video = videoRef.current;
      if (!video) return;

      // Brief delay to let browser settle after previous cleanup
      await new Promise<void>(resolve => {
        setTimeout(resolve, 100);
      });
      if (isCancelled) return;

      videoRendererInstance.current = new VideoStreamPlayer();
      videoRendererInstance.current.initPlayer(video);
      const dims = snapshotDimsRef.current;
      if (dims) {
        videoRendererInstance.current.setSnapshotDimensions(
          dims.width,
          dims.height
        );
      }
      videoRendererInstance.current.start(videoUrl);

      // Once unlocked, keep audio active across video stream reconnects.
      if (audioUnlockedRef.current) {
        startAudioPlayer();
      }
    };

    initializePlayer();

    return () => {
      isCancelled = true;
      if (videoRendererInstance.current) {
        videoRendererInstance.current.destroy();
        videoRendererInstance.current = null;
      }
      // Stop audio when video disconnects
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop();
        audioPlayerRef.current = null;
      }
    };
  }, [videoUrl]);

  // Browser audio playback must begin from a user gesture. The first pointer
  // or keyboard interaction anywhere on the page unlocks live audio.
  useEffect(() => {
    if (!enableAudio || audioUnlockedRef.current) return;

    const unlockAudio = () => {
      audioUnlockedRef.current = true;
      startAudioPlayer();
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };

    window.addEventListener('pointerdown', unlockAudio, {
      capture: true,
      once: true,
    });
    window.addEventListener('keydown', unlockAudio, {
      capture: true,
      once: true,
    });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
  }, [enableAudio, startAudioPlayer]);

  // Update stream stats once per second (single setState to avoid 4 re-renders)
  useEffect(() => {
    const interval = setInterval(() => {
      const packetsPerSecond =        videoRendererInstance.current?.packetsPerSecond ?? 0;
      const currentPackets = videoRendererInstance.current?.packetCount ?? 0;
      const fps = packetsPerSecond || currentPackets;

      const stats = videoRendererInstance.current?.getStats?.();
      const latency = stats?.latency ?? 0;
      const bandwidth = stats?.bandwidth ?? 0;

      setStreamStats({ fps, latency, bandwidth });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleReload = () => {
    videoRendererInstance.current?.resetStartState().start(videoUrl);
    setLoading(false);
  };

  // Keep latest handleReload in a ref so the global reload listener (subscribed
  // once) always invokes the current closure with the up-to-date videoUrl.
  const handleReloadRef = useRef(handleReload);
  handleReloadRef.current = handleReload;

  // External callers (e.g. encoder reconfigure) request a full player reconnect
  // by dispatching 'player-reload'. This tears down WS + MSE and reconnects,
  // fetching fresh SPS/PPS and waiting for a clean IDR — avoiding 花屏/黑屏
  // after a resolution/codec/fps change.
  useEffect(() => {
    const onPlayerReload = () => {
      handleReloadRef.current?.();
    };
    window.addEventListener('player-reload', onPlayerReload);
    return () => window.removeEventListener('player-reload', onPlayerReload);
  }, []);

  // AI ISP profile switches restart the daemon's GStreamer pipeline for
  // ~interrupt_ms (reported by the switch RPC). Reconnecting immediately would
  // hit a half-rebuilt pipeline and 花屏/黑屏. Wait out the interrupt window,
  // then reuse the canonical reload path. The switching ref suppresses the
  // transient "Disconnected" state the WS close produces during the wait.
  useEffect(() => {
    let fallback: number | undefined;
    const onProfileChanged = (e: Event) => {
      const { detail } = e as CustomEvent<{ interrupt_ms?: number }>;
      const wait = Math.max(0, detail?.interrupt_ms ?? 0);
      profileSwitchingRef.current = true;
      setLoading(true);
      setConnectionState('connecting');
      setVideoVisible(false);
      // Safety net: if the reconnect never produces a wv_work, drop the guard
      // so the disconnected UI is reachable again.
      fallback = window.setTimeout(() => {
        profileSwitchingRef.current = false;
      }, wait + 10000);
      window.setTimeout(() => {
        handleReloadRef.current?.();
      }, wait + 300);
    };
    window.addEventListener('aipc:media-profile-changed', onProfileChanged);
    return () => {
      window.removeEventListener(
        'aipc:media-profile-changed',
        onProfileChanged
      );
      if (fallback) window.clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    const handlWvClose = (e: Event) => {
      const event = e as CustomEvent<{ code?: number; reason?: string }>;
      if (event.detail.reason === 'Connection replaced') {
        toast.error(t('sys.device_tool.preview_disconnected'));
      }
      // During a profile-switch pipeline restart the WS close is expected; keep
      // the loading spinner up so the user doesn't see a disconnected flicker.
      if (profileSwitchingRef.current) return;
      setIsControlPanel(false);
      setLoading(false);
      setConnectionState('disconnected');
    };

    const handleWvWork = (e: Event) => {
      const isWorking = (e as CustomEvent<boolean>).detail;
      setLoading(!isWorking);
      if (isWorking) {
        // Reconnect landed after a profile switch — drop the guard so later
        // genuine disconnects surface normally.
        profileSwitchingRef.current = false;
        setIsControlPanel(true);
        setConnectionState('connected');
        setVideoVisible(true);
      } else {
        setIsControlPanel(false);
      }
    };
    const handleWvError = (_e: Event) => {
      // ignore websocket errors
    };

    window.addEventListener('wv_work', handleWvWork);
    window.addEventListener('wv_close', handlWvClose);
    window.addEventListener('wv_error', handleWvError);
    return () => {
      window.removeEventListener('wv_work', handleWvWork);
      window.removeEventListener('wv_close', handlWvClose);
      window.removeEventListener('wv_error', handleWvError);
    };
  }, [t]);

  const handleSnapshot = () => {
    videoRendererInstance.current?.doSnapshot();
  };
  const handleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen?.();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setIsFullscreen(false);
    }
  }, []);
  useEffect(() => {
    const onFsChange = () => {
      const isFs = Boolean(document.fullscreenElement);
      setIsFullscreen(isFs);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Double-click to fullscreen
  useEffect(() => {
    if (!enableDoubleClickFullscreen) return;

    const el = videoRef.current;
    if (!el) return;
    const onDbl = () => {
      handleFullscreen().catch(() => {
        // ignore fullscreen errors
      });
    };
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('dblclick', onDbl);
    };
  }, [enableDoubleClickFullscreen, handleFullscreen]);

  // Hide panel on mouse enter
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const clearIdle = () => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
    const startIdle = () => {
      clearIdle();
      idleTimerRef.current = window.setTimeout(() => {
        setIsShowPanel(false);
      }, 3000);
    };
    const onEnter = () => {
      setIsShowPanel(true);
      startIdle();
    };
    const onLeave = () => {
      setIsShowPanel(false);
      clearIdle();
    };
    const onMove = () => {
      setIsShowPanel(true);
      startIdle();
    };
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('mousemove', onMove);
      clearIdle();
    };
  }, []);

  return (
    <div className="w-full h-full">
      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black"
      >
        <div className="w-full h-full flex items-center justify-center">
          <video
            ref={videoRef}
            className={`w-full ${objectFit === 'cover' ? 'object-cover h-full' : 'object-contain'} transition-opacity duration-500 ${videoVisible ? 'opacity-100' : 'opacity-0'}`}
            id="videoPlayer"
            muted
            playsInline
            autoPlay
            disableRemotePlayback
          />
          {isShowStreamStats && (
            <div className="absolute md:top-4 top-2 md:right-4 right-2 bg-gray-800/50 px-2 py-1 rounded text-xs font-mono space-y-0.5">
              <div>
                <span className="text-gray-400 font-bold">
                  {t('sys.device_tool.fps')}:
                </span>{' '}
                <span className="text-white">{streamStats.fps}</span>
              </div>
              <div>
                <span className="text-gray-400 font-bold">
                  {t('sys.device_tool.latency')}:
                </span>{' '}
                <span className="text-white">
                  {streamStats.latency.toFixed(2)}s
                </span>
              </div>
              <div>
                <span className="text-gray-400 font-bold">
                  {t('sys.device_tool.bandwidth')}:
                </span>{' '}
                <span className="text-white">
                  {streamStats.bandwidth.toFixed(1)} kB/s
                </span>
              </div>
            </div>
          )}
        </div>
        {showPanel && (
          <PlayerPanel
            handleReload={handleReload}
            className={`absolute bottom-0 left-0 transition-all duration-300 ease-in-out ${
              isShowPanel
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-full'
            }`}
            isFullscreen={isFullscreen}
            snapshot={handleSnapshot}
            fullscreen={handleFullscreen}
            isControlPanel={isControlPanel}
            isShowStreamStats={isShowStreamStats}
            toggleStreamStats={() => setIsShowStreamStats(prev => !prev)}
            audioOverlay={audioOverlay}
            isAudioMuted={muted}
            onToggleAudioMute={() => setMuted(!muted)}
            audioVolume={volume}
            onVolumeChange={setVolume}
            listenEnabled={listenEnabled}
            onToggleListen={() => setListen(!listenEnabled)}
            captureAvailable={captureAvailable}
            playbackEnabled={playbackEnabled}
            talking={talking}
            audioLevel={level}
            onMicPressStart={pressStart}
            onMicPressEnd={pressEnd}
          />
        )}
        {loading && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
            <Loading fullHeight={false} className="w-40" />
          </div>
        )}
        {!loading && connectionState === 'disconnected' && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
            <span className="text-sm text-white/70">
              {t('sys.device_tool.disconnected', 'Disconnected')}
            </span>
            <Button
              onClick={handleReload}
              size="sm"
              variant="ghost"
              className="bg-white/20 hover:bg-white/30 text-white hover:text-white"
            >
              {t('sys.device_tool.reload')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
