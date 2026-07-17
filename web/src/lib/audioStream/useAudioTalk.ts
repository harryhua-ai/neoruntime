import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AudioTalker } from './audioTalker';
import { useAudioControlStore } from '@/store/audio';
import { fetchAudioStatus, audioTalkStreamUrl } from '@/services/settings';

const TALK_START_HOLD_MS = 180;

/**
 * useAudioTalk — push-to-talk engine + device audio-status sync for the player
 * overlay. Extracted from the old Media-sidebar `AudioBlock` so the overlay
 * (`player-panel`) can render the controls while a single hook owns the
 * AudioTalker WebSocket + getUserMedia lifecycle, the 180ms press-hold
 * debounce, and the cross-page capture/playback gate refresh.
 *
 * Pass `enabled = true` only on the player instance that hosts audio (Media
 * page). When false every effect short-circuits — no status fetch, no event
 * listeners, no AudioTalker — so non-audio players (dashboard / image) stay
 * cheap and never spawn a second talk session.
 *
 * Gate flags (`captureAvailable` / `playbackEnabled`) are written to the shared
 * audio store so `player.tsx` (the AudioPlayer listen host) and the overlay
 * buttons read one source of truth. PTT is additionally gated by
 * `playbackEnabled` (the Peripheral speaker-output switch): the browser mic
 * can only feed a device that is driving its speaker.
 */
export function useAudioTalk({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();

  const setCaptureAvailable = useAudioControlStore(s => s.setCaptureAvailable);
  const setPlaybackEnabled = useAudioControlStore(s => s.setPlaybackEnabled);
  const playbackEnabled = useAudioControlStore(s => s.playbackEnabled);

  const [talking, setTalking] = useState(false);
  const [level, setLevel] = useState(0);

  const talkerRef = useRef<AudioTalker | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const stopGuardRef = useRef(false); // ensures teardown runs once per press

  // Ref mirror so the setTimeout-fired startTalk reads the latest gate without
  // being recreated on every store update.
  const playbackRef = useRef(playbackEnabled);
  playbackRef.current = playbackEnabled;

  // Pull device capture/playback status into the store on mount + window focus
  // (so Peripheral-page toggles are reflected when the user returns).
  const loadData = useCallback(async () => {
    try {
      const audioStatus = await fetchAudioStatus();
      setCaptureAvailable(!!audioStatus.capturing);
      setPlaybackEnabled(
        audioStatus.playback_enabled === undefined
          ? true
          : !!audioStatus.playback_enabled
      );
    } catch {
      // API errors handled by the request interceptor.
    }
  }, [setCaptureAvailable, setPlaybackEnabled]);

  useEffect(() => {
    if (!enabled) return;
    loadData();
    const onFocus = () => loadData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, loadData]);

  // Cross-page real-time sync: Peripheral dispatches these after its toggles.
  useEffect(() => {
    if (!enabled) return;
    const onCaptureChange = (e: Event) => setCaptureAvailable(!!(e as CustomEvent<boolean>).detail);
    const onPlaybackChange = (e: Event) => setPlaybackEnabled(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener('audio-capture-change', onCaptureChange);
    window.addEventListener('audio-playback-change', onPlaybackChange);
    return () => {
      window.removeEventListener('audio-capture-change', onCaptureChange);
      window.removeEventListener('audio-playback-change', onPlaybackChange);
    };
  }, [enabled, setCaptureAvailable, setPlaybackEnabled]);

  const finishTalk = useCallback(async () => {
    if (stopGuardRef.current) return;
    stopGuardRef.current = true;
    setTalking(false);
    setLevel(0);
    try {
      // Await the WebSocket close so the server-side StreamAudioPcm teardown
      // (and camera-daemon stop_playback) completes cleanly. See audioTalker.stop().
      await talkerRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  // One AudioTalker for the player's lifetime, wired to UI callbacks.
  useEffect(() => {
    if (!enabled) return;
    talkerRef.current = new AudioTalker({
      onLevel: l => setLevel(l),
      onBusy: () => {
        toast.error(
          t('sys.media_settings.talk_busy', 'Another talk session is active')
        );
        setTalking(false);
        finishTalk().catch(() => {});
      },
      onError: msg => {
        toast.error(
          `${t('sys.media_settings.talk_error', 'Talk error')}: ${msg}`
        );
        finishTalk().catch(() => {});
      },
    });
    return () => {
      talkerRef.current?.stop();
      talkerRef.current = null;
    };
  }, [enabled, t, finishTalk]);

  const startTalk = useCallback(async () => {
    if (!playbackRef.current || !talkerRef.current) return;
    stopGuardRef.current = false;
    setLevel(0);
    try {
      await talkerRef.current.start(audioTalkStreamUrl());

      // User released the button before start finished -> tear straight down.
      if (stopGuardRef.current) {
        talkerRef.current.stop();
        return;
      }
      if (!talkerRef.current.active) {
        // Busy / rejected — nothing to restore (full-duplex: capture untouched).
        return;
      }
      setTalking(true);
    } catch (err) {
      const denied = err instanceof DOMException
        && (err.name === 'NotAllowedError'
          || err.name === 'PermissionDeniedError');
      if (denied) {
        toast.error(
          t(
            'sys.media_settings.mic_permission_denied',
            'Microphone permission denied'
          )
        );
      } else {
        // Surface the real failure so a missing mic (NotFoundError) or busy
        // device (NotReadableError) is distinguishable from a server fault.
        const detail = err instanceof DOMException
            ? `${err.name}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err ?? '');
        toast.error(
          `${t('sys.media_settings.talk_error', 'Talk error')}${detail ? `: ${detail}` : ''}`
        );
      }
    }
  }, [t]);

  // Press-hold: only start after the button has been held TALK_START_HOLD_MS,
  // so a stray tap never opens a mic session. Release before the timer fires
  // cancels cleanly; release after hands off to stopTalk.
  const pressStart = useCallback(() => {
    if (!enabled || !playbackRef.current) return;
    if (talking || startTimerRef.current !== null) return;
    stopGuardRef.current = false;
    setLevel(0);
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null;
      startTalk().catch(() => {});
    }, TALK_START_HOLD_MS);
  }, [enabled, talking, startTalk]);

  const pressEnd = useCallback(() => {
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
      stopGuardRef.current = true;
      setLevel(0);
      return;
    }
    finishTalk().catch(() => {});
  }, [finishTalk]);

  // Clear any pending start timer on unmount so it can't fire post-teardown.
  useEffect(
    () => () => {
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    },
    []
  );

  return { talking, level, pressStart, pressEnd };
}
