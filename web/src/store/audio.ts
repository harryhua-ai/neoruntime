import { create } from 'zustand';

/**
 * AudioControlStore — Media-page browser-side audio state.
 *
 * Bridges the pieces of audio state that live in different places:
 * - The player overlay (`player-panel.tsx`, rendered when `audioOverlay` is on):
 *   owns the mute / volume / listen / PTT controls and writes them here.
 *   The PTT engine + device-status sync live in `useAudioTalk`, which also
 *   writes the `captureAvailable` / `playbackEnabled` gate flags here.
 * - `player.tsx`: reads `listenEnabled && captureAvailable && !muted` to
 *   decide whether to start the AudioPlayer (WS listen stream) and applies
 *   `volume` to it. It owns the AudioPlayer lifecycle (gesture unlock + video
 *   reconnect sync) and hosts the `useAudioTalk` engine on the overlay player.
 *
 * Volume/mute here are intentionally browser-side only (AudioPlayer gain),
 * NOT written back to the device — device-side volume/mute is owned by the
 * Peripheral capture switch semantics. This avoids a two-layer volume coupling.
 *
 * Cross-page linkage with the Peripheral page is event-driven
 * (`audio-capture-change` / `audio-playback-change` window events) plus a
 * remount/window-focus refetch of `fetchAudioStatus`, which `useAudioTalk`
 * owns.
 */
interface AudioControlState {
  /** 麦克风开关 — browser listen intent (starts/stops AudioPlayer). */
  listenEnabled: boolean;
  /** 浏览器静音 — when true the player tears down the listen stream. */
  muted: boolean;
  /** 0..1 browser volume applied to AudioPlayer gain. */
  volume: number;
  /** Device capture HW is on (from status). Gates the listen switch. */
  captureAvailable: boolean;
  /** Device playback (speaker) gate is on (from status). Gates PTT. */
  playbackEnabled: boolean;
}

interface AudioControlActions {
  setListen: (value: boolean) => void;
  setMuted: (value: boolean) => void;
  setVolume: (value: number) => void;
  setCaptureAvailable: (value: boolean) => void;
  setPlaybackEnabled: (value: boolean) => void;
}

type AudioControlStore = AudioControlState & AudioControlActions;

export const useAudioControlStore = create<AudioControlStore>(set => ({
  listenEnabled: false,
  muted: true,
  volume: 1.0,
  captureAvailable: false,
  playbackEnabled: false,

  setListen: value => set({ listenEnabled: value }),
  setMuted: value => set({ muted: value }),
  setVolume: value => set({ volume: Math.max(0, Math.min(1, value)) }),
  setCaptureAvailable: value => set({ captureAvailable: value }),
  setPlaybackEnabled: value => set({ playbackEnabled: value }),
}));
