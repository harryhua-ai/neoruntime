import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, Headphones, Mic, MicOff } from 'lucide-react';
import SvgIcon from '@/components/svg-icon';
import { cn } from '@/lib/utils';

type PlayerPanelProps = {
  handleReload: () => void;
  snapshot: () => void;
  className?: string;
  isFullscreen: boolean;
  fullscreen: () => void;
  isControlPanel?: boolean;
  isShowStreamStats?: boolean;
  toggleStreamStats?: () => void;
  /** Render the audio control group (mute / volume / listen / PTT). */
  audioOverlay?: boolean;
  /** Browser-side mute state. */
  isAudioMuted?: boolean;
  onToggleAudioMute?: () => void;
  /** 0..1 browser volume. */
  audioVolume?: number;
  onVolumeChange?: (v: number) => void;
  /** Browser listen intent (starts the AudioPlayer WS stream). */
  listenEnabled?: boolean;
  onToggleListen?: () => void;
  /** Device capture HW is on — gates the listen switch. */
  captureAvailable?: boolean;
  /** Device speaker gate is on — gates PTT. */
  playbackEnabled?: boolean;
  /** PTT active state + mic level (0..~0.2) + press handlers. */
  talking?: boolean;
  audioLevel?: number;
  onMicPressStart?: () => void;
  onMicPressEnd?: () => void;
};

export default function PlayerPanel({
  handleReload,
  isFullscreen,
  snapshot,
  fullscreen,
  isControlPanel,
  isShowStreamStats,
  toggleStreamStats,
  audioOverlay = false,
  isAudioMuted = true,
  onToggleAudioMute,
  audioVolume = 1,
  onVolumeChange,
  listenEnabled = false,
  onToggleListen,
  captureAvailable = false,
  playbackEnabled = false,
  talking = false,
  audioLevel = 0,
  onMicPressStart,
  onMicPressEnd,
  className,
}: PlayerPanelProps) {
  const { t } = useTranslation();

  const volumePct = Math.round(Math.max(0, Math.min(1, audioVolume)) * 100);
  // Match the AudioBlock meter scale so the bar is lively at normal mic levels.
  const levelPct = Math.max(0, Math.min(100, audioLevel * 500));
  const micDisabled = !playbackEnabled || !captureAvailable;

  return (
    <div
      className={cn(
        'w-full md:h-[60px] h-[40px] md:px-12 px-8 flex items-center justify-between transition-all duration-300 ease-in-out bg-linear-to-t from-black/70 via-black/30 to-transparent',
        className
      )}
    >
      <div className="flex items-center gap-4">
        <div className="relative md:w-10 w-8 md:h-10 h-8 flex items-center justify-center group">
          <button
            onClick={handleReload}
            className="md:w-7 w-6 md:h-7 h-6 flex items-center justify-center"
          >
            <SvgIcon
              className="w-full h-full flex-1 text-[#f3f2f3]"
              icon="reload"
            />
          </button>
          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            {t('sys.device_tool.reload')}
          </span>
        </div>
      </div>

      <div className="flex gap-3">
        {audioOverlay && (
          <>
            {/* Volume — mute toggle with a hover-revealed vertical slider */}
            <div className="group/vol relative md:w-10 w-8 md:h-10 h-8 flex items-center justify-center">
              <button
                onClick={onToggleAudioMute}
                className="md:w-7 w-6 md:h-7 h-6 flex items-center justify-center"
              >
                {isAudioMuted || volumePct === 0 ? (
                  <VolumeX className="w-4 h-4 text-[#f3f2f3]" />
                ) : (
                  <Volume2 className="w-4 h-4 text-[#f3f2f3]" />
                )}
              </button>
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover/vol:opacity-100">
                {t('sys.media_settings.volume', 'Volume')}
              </span>
              {/* Hover popup: vertical slider + % label. The transparent bridge
                  div lets the cursor travel from the button to the slider
                  without dropping the hover (no dead-zone gap). */}
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col items-center gap-1 rounded-lg bg-black/80 px-2 py-3 opacity-0 transition-opacity group-hover/vol:opacity-100">
                <div className="h-20 w-5 flex items-center justify-center">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volumePct}
                    onChange={e => onVolumeChange?.(Number(e.target.value) / 100)}
                    aria-label={t('sys.media_settings.volume', 'Volume')}
                    style={{
                      writingMode: 'vertical-rl',
                      direction: 'rtl',
                      width: '4px',
                      height: '72px',
                    }}
                    className="accent-primary cursor-pointer"
                  />
                </div>
                <span className="text-[10px] tabular-nums text-white">
                  {volumePct}%
                </span>
              </div>
              {/* Bridge — covers the gap between button top and popup bottom */}
              <div className="pointer-events-auto absolute bottom-full left-1/2 -translate-x-1/2 h-2 w-10" />
            </div>

            {/* Listen — toggle the browser-side AudioPlayer stream */}
            <div className="relative md:w-10 w-8 md:h-10 h-8 flex items-center justify-center group/listen">
              <button
                disabled={!captureAvailable}
                onClick={onToggleListen}
                className="md:w-7 w-6 md:h-7 h-6 flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none"
              >
                <Headphones
                  className={cn(
                    'w-4 h-4',
                    listenEnabled ? 'text-primary' : 'text-[#f3f2f3]'
                  )}
                />
              </button>
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover/listen:opacity-100">
                {t('sys.media_settings.mic_listen', 'Listen')}
              </span>
            </div>

            {/* PTT — press-hold to talk (180ms debounce in useAudioTalk) */}
            <div className="relative md:w-10 w-8 md:h-10 h-8 flex items-center justify-center group/mic">
              <button
                disabled={micDisabled}
                onPointerDown={e => {
                  e.preventDefault();
                  onMicPressStart?.();
                }}
                onPointerUp={onMicPressEnd}
                onPointerLeave={() => talking && onMicPressEnd?.()}
                className={cn(
                  'md:w-7 w-6 md:h-7 h-6 flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none select-none',
                  talking && 'scale-95'
                )}
              >
                {micDisabled ? (
                  <MicOff className="w-4 h-4 text-[#f3f2f3]/60" />
                ) : (
                  <Mic
                    className={cn(
                      'w-4 h-4',
                      talking ? 'text-red-500' : 'text-[#f3f2f3]'
                    )}
                  />
                )}
              </button>
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover/mic:opacity-100">
                {micDisabled
                  ? t(
                      'sys.media_settings.talk_playback_off_hint',
                      'Speaker off'
                    )
                  : t('sys.media_settings.talk', 'Talk')}
              </span>
              {/* Mic level meter — shown while talking */}
              {talking && (
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 h-6 w-1 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="w-full bg-red-500 origin-bottom"
                    style={{ height: `${levelPct}%`, marginTop: `${100 - levelPct}%` }}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* Stream stats toggle */}
        <div className="relative md:w-10 w-8 md:h-10 h-8 flex items-center justify-center group">
          <button
            disabled={!isControlPanel}
            onClick={toggleStreamStats}
            className="md:w-7 w-6 md:h-7 h-6 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isShowStreamStats ? (
              <SvgIcon
                className="w-full h-full flex-1 text-[#f3f2f3]"
                icon="show_info"
              />
            ) : (
              <SvgIcon
                className="w-full h-full flex-1 text-[#f3f2f3]"
                icon="close_info"
              />
            )}
          </button>
          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            {t('sys.device_tool.stream_info')}
          </span>
        </div>

        {/* Snapshot */}
        <div className="relative md:w-10 w-8 md:h-10 h-8 flex items-center justify-center group">
          <button
            disabled={!isControlPanel}
            onClick={snapshot}
            className="md:w-7 w-6 md:h-7 h-6 disabled:opacity-50 disabled:pointer-events-none"
          >
            <SvgIcon
              className="w-full h-full flex-1 text-[#f3f2f3]"
              icon="screenshot"
            />
          </button>
          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            {t('sys.device_tool.snapshot')}
          </span>
        </div>

        {/* Fullscreen */}
        <div className="relative md:w-10 w-8 md:h-10 h-8 flex items-center justify-center group">
          <button
            disabled={!isControlPanel}
            onClick={fullscreen}
            className="md:w-7 w-6 md:h-7 h-6 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isFullscreen ? (
              <SvgIcon
                className="w-full h-full flex-1 text-[#f3f2f3]"
                icon="fullscreen_exit"
              />
            ) : (
              <SvgIcon
                className="w-full h-full flex-1 text-[#f3f2f3]"
                icon="fullscreen"
              />
            )}
          </button>
          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            {t('sys.device_tool.fullscreen')}
          </span>
        </div>
      </div>
    </div>
  );
}
