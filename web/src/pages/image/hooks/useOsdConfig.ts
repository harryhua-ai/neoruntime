import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  fetchOsdConfig,
  updateOsdConfig,
  type StreamOsdConfig,
  type OsdTextOverlay,
  type OsdDateTimeOverlay,
  type OsdImageOverlay,
} from '@/services/media';

export type StreamName = 'main' | 'sub' | 'third';

export interface OsdConfigController {
  config: StreamOsdConfig[] | null;
  loading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  currentStream: StreamOsdConfig | undefined;
  textOverlays: OsdTextOverlay[];
  datetimeOverlays: OsdDateTimeOverlay[];
  imageOverlays: OsdImageOverlay[];
  addTextOverlay: () => void;
  updateTextOverlay: (id: string, changes: Partial<OsdTextOverlay>) => void;
  removeTextOverlay: (id: string) => void;
  addDateTimeOverlay: () => void;
  updateDateTimeOverlay: (
    id: string,
    changes: Partial<OsdDateTimeOverlay>
  ) => void;
  removeDateTimeOverlay: (id: string) => void;
  addImageOverlay: () => void;
  updateImageOverlay: (id: string, changes: Partial<OsdImageOverlay>) => void;
  removeImageOverlay: (id: string) => void;
}

/**
 * Owns OSD overlay state shared by the live-video interaction layer and the
 * sidebar form. Lifted to the common parent (`media/index.tsx`) so the
 * interaction handles can render directly inside the video container as plain
 * children — no portal needed. The OSD config is only fetched while the OSD
 * tab is active (`enabled`).
 *
 * Saves are debounced (400ms) so rapid drag/resize/typing coalesce into one
 * PUT (clear-and-reapply to the HAL in-memory state).
 */
export function useOsdConfig(
  activeStream: StreamName,
  enabled: boolean
): OsdConfigController {
  const { t } = useTranslation();

  const [config, setConfig] = useState<StreamOsdConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Latest config in a ref so the unmount/exit effect can flush the final
  // config without re-subscribing on every keystroke/drag (the effect depends
  // only on `enabled`).
  const configRef = useRef<StreamOsdConfig[] | null>(null);
  configRef.current = config;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection is per-stream; clear it when the edited stream changes.
  useEffect(() => {
    setSelectedId(null);
  }, [activeStream]);

  // Enter the OSD editor: just fetch the current config. The device keeps
  // baking normally (never suppressed) so the user sees — and drags — the REAL
  // baked text/image on the live stream. The HTML layer is only a transparent
  // drag frame, so on exit there is nothing to re-bake and no proxy→baked jump.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchOsdConfig();
        if (cancelled) return;
        setConfig(data.streams ?? []);
      } catch {
        toast.error(
          t('sys.media_settings.osd_load_failed', 'Failed to load OSD config')
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, t]);

  const currentStream = config?.find(s => s.stream_name === activeStream);

  const saveConfig = (updatedStreams: StreamOsdConfig[]) => {
    setConfig(updatedStreams);
    // Debounce: coalesce rapid changes (drag, keystroke) into a single PUT.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateOsdConfig({ streams: updatedStreams });
      } catch {
        toast.error(
          t('sys.media_settings.osd_save_failed', 'Failed to save OSD config')
        );
      }
    }, 400);
  };

  // Leave the OSD editor (tab switch or unmount): cancel any pending debounced
  // save and flush the final config so a change made right before leaving is
  // not lost. Baking is never suppressed, so there is no re-bake to do here.
  // Runs on `enabled` change + unmount.
  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (configRef.current) {
        updateOsdConfig({ streams: configRef.current }).catch(() => {
          /* best-effort flush on exit */
        });
      }
    },
    [enabled]
  );

  const updateStreamConfig = (
    streamName: string,
    updater: (s: StreamOsdConfig) => StreamOsdConfig
  ) => {
    if (!config) return;
    const existing = config.find(s => s.stream_name === streamName);
    const updated = config.map(s => (s.stream_name === streamName ? updater(s) : s));
    if (!existing) {
      updated.push(updater({ stream_name: streamName }));
    }
    saveConfig(updated);
  };

  // ---- Text overlay handlers ----
  const updateTextOverlay = (id: string, changes: Partial<OsdTextOverlay>) => {
    updateStreamConfig(activeStream, s => ({
      ...s,
      text_overlays: (s.text_overlays ?? []).map(o => (o.id === id ? { ...o, ...changes } : o)),
    }));
  };

  const addTextOverlay = () => {
    const id = `text_${Date.now()}`;
    updateStreamConfig(activeStream, s => ({
      ...s,
      text_overlays: [
        ...(s.text_overlays ?? []),
        {
          id,
          text: 'Text',
          x: 0.05,
          y: 0.05,
          font_size: 32,
          text_color: 0xffffffff,
          enabled: true,
        },
      ],
    }));
    setSelectedId(id);
  };

  const removeTextOverlay = (id: string) => {
    updateStreamConfig(activeStream, s => ({
      ...s,
      text_overlays: (s.text_overlays ?? []).filter(o => o.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  };

  // ---- DateTime overlay handlers ----
  const updateDateTimeOverlay = (
    id: string,
    changes: Partial<OsdDateTimeOverlay>
  ) => {
    updateStreamConfig(activeStream, s => ({
      ...s,
      datetime_overlays: (s.datetime_overlays ?? []).map(o => (o.id === id ? { ...o, ...changes } : o)),
    }));
  };

  const addDateTimeOverlay = () => {
    const id = `datetime_${Date.now()}`;
    // Default to bottom-left corner with proper HAL anchoring.
    updateStreamConfig(activeStream, s => ({
      ...s,
      datetime_overlays: [
        ...(s.datetime_overlays ?? []),
        {
          id,
          x: 0.02,
          y: 0.98,
          format: '%Y-%m-%d %H:%M:%S',
          font_size: 28,
          text_color: 0xffffffff,
          h_align: 0, // LEFT
          v_align: 2, // BOTTOM
          enabled: true,
        },
      ],
    }));
    setSelectedId(id);
  };

  const removeDateTimeOverlay = (id: string) => {
    updateStreamConfig(activeStream, s => ({
      ...s,
      datetime_overlays: (s.datetime_overlays ?? []).filter(o => o.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  };

  // ---- Image overlay handlers ----
  const updateImageOverlay = (
    id: string,
    changes: Partial<OsdImageOverlay>
  ) => {
    updateStreamConfig(activeStream, s => ({
      ...s,
      image_overlays: (s.image_overlays ?? []).map(o => (o.id === id ? { ...o, ...changes } : o)),
    }));
  };

  const addImageOverlay = () => {
    const id = `image_${Date.now()}`;
    updateStreamConfig(activeStream, s => ({
      ...s,
      image_overlays: [
        ...(s.image_overlays ?? []),
        {
          id,
          image_path: '',
          x: 0.8,
          y: 0.02,
          width: 0.12,
          height: 0.08,
          enabled: false,
        },
      ],
    }));
    setSelectedId(id);
  };

  const removeImageOverlay = (id: string) => {
    updateStreamConfig(activeStream, s => ({
      ...s,
      image_overlays: (s.image_overlays ?? []).filter(o => o.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  };

  return {
    config,
    loading,
    selectedId,
    setSelectedId,
    currentStream,
    textOverlays: currentStream?.text_overlays ?? [],
    datetimeOverlays: currentStream?.datetime_overlays ?? [],
    imageOverlays: currentStream?.image_overlays ?? [],
    addTextOverlay,
    updateTextOverlay,
    removeTextOverlay,
    addDateTimeOverlay,
    updateDateTimeOverlay,
    removeDateTimeOverlay,
    addImageOverlay,
    updateImageOverlay,
    removeImageOverlay,
  };
}
