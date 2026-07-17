import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoStreamPlayer } from '@/lib/videoStream/player';
import Player from '@/components/player/player';
import MediaSettings from './components/MediaSettings';
import { getItem } from '@/utils/storage';
import { useMediaStatus } from './hooks/useMedia';
import { useStreamFallback } from '@/hooks/useStreamFallback';

export default function Monitoring() {
  const { t } = useTranslation();
  const playerRef = useRef<VideoStreamPlayer | null>(null);

  const [activeStream, setActiveStream] = useState<'main' | 'sub' | 'third'>(
    'main'
  );

  const { data: mediaStatus } = useMediaStatus();

  const streams = mediaStatus?.streams ?? [];

  const { effectiveStreamId, effectiveStreamInfo, codecNotice } =    useStreamFallback({ streams, activeStream });

  const activeStreamInfo = effectiveStreamInfo;

  const handleStreamChange = (streamId: string) => {
    if (streamId === 'main' || streamId === 'sub' || streamId === 'third') {
      setActiveStream(streamId);
    }
  };

  // Get current stream URL from streams API
  const getCurrentStreamUrl = () => {
    let token = getItem<string>('token') || '';
    if (token.startsWith('Bearer ')) {
      token = token.substring(7);
    }

    const baseUrl = window.location.origin.replace(/^http/, 'ws');
    return `${baseUrl}/api/v1/h264/${effectiveStreamId}?token=${encodeURIComponent(token)}`;
  };

  const [currentStreamUrl, setCurrentStreamUrl] = useState<string>(
    getCurrentStreamUrl()
  );

  useEffect(() => {
    setCurrentStreamUrl(getCurrentStreamUrl());
  }, [effectiveStreamId]);

  const noticeText = codecNotice
    ? t(
        `sys.monitoring.${codecNotice}`,
        codecNotice === 'hevc_unsupported_fallback'
          ? '当前浏览器不支持 H.265 解码，已切换为 H.264 播放'
          : '当前浏览器不支持 H.265 解码，且无可用 H.264 码流'
      )
    : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background md:flex-row">
      {/* Main Content Area */}
      <div className="flex w-full shrink-0 flex-col items-center justify-center px-3 pt-2 pb-1 md:h-full md:min-h-0 md:flex-1 md:shrink md:px-0 md:py-0">
        {noticeText && (
          <div className="w-full pb-1 text-[11px] leading-tight text-muted-foreground/70 md:px-8 md:pb-1.5">
            {noticeText}
          </div>
        )}
        <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-xl bg-black md:m-8 md:max-w-none md:rounded-2xl">
          <Player
            videoUrl={currentStreamUrl}
            videoRendererInstance={playerRef}
            streamWidth={activeStreamInfo?.width}
            streamHeight={activeStreamInfo?.height}
            audioOverlay
          />
        </div>
      </div>

      {/* 配置侧栏 — 移动端底部全宽 + 上边框，桌面端右侧固定宽 */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border bg-card md:h-full md:w-96 md:shrink-0 md:flex-none md:border-l md:border-t-0">
        <div className="flex px-6 pt-6 pb-2 items-center gap-2 border-b border-border text-lg font-semibold tracking-tight text-foreground">
          <span className="flex items-center gap-2">
            {' '}
            {t('sys.monitoring.config', 'Config')}{' '}
          </span>
        </div>

        {/* Config Content */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <MediaSettings
            activeStream={activeStream}
            onStreamChange={handleStreamChange}
          />
        </div>
      </div>
    </div>
  );
}
