import { isFeedbackSoundEnabled } from "@/lib/feedbackSound";

const MUTE_KEY = "mxpatrol_sos_siren_muted";
const VOLUME_KEY = "mxpatrol_sos_siren_volume";

type AudioContextLike = AudioContext & { webkitAudioContext?: never };

let audioContext: AudioContextLike | null = null;
let masterGain: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let active = false;

const getStoredBoolean = (key: string, fallback: boolean) => {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  if (value == null) return fallback;
  return value === "true";
};

const getStoredVolume = () => {
  if (typeof window === "undefined") return 0.75;
  const raw = Number(window.localStorage.getItem(VOLUME_KEY));
  if (!Number.isFinite(raw)) return 0.75;
  return Math.min(1, Math.max(0, raw));
};

const ensureAudio = () => {
  if (typeof window === "undefined" || !isFeedbackSoundEnabled() || getStoredBoolean(MUTE_KEY, false)) return null;
  const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = getStoredVolume() * 0.18;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
  return audioContext;
};

const playPulse = () => {
  const context = ensureAudio();
  if (!context || !masterGain) return;

  try {
    const now = context.currentTime;
    [
      { frequency: 760, start: 0, duration: 0.32 },
      { frequency: 1040, start: 0.34, duration: 0.34 },
      { frequency: 760, start: 0.72, duration: 0.28 },
    ].forEach((tone) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + tone.start;
      const end = start + tone.duration;

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.85, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    });
  } catch {
    // Siren audio is best-effort; visual SOS state remains authoritative.
  }
};

export const startSosSiren = () => {
  if (active) return;
  active = true;
  playPulse();
  timer = window.setInterval(playPulse, 1850);
};

export const stopSosSiren = () => {
  active = false;
  if (timer) window.clearInterval(timer);
  timer = null;
};

export const isSosSirenActive = () => active;

export const isSosSirenMuted = () => getStoredBoolean(MUTE_KEY, false);

export const setSosSirenMuted = (muted: boolean) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, muted ? "true" : "false");
  if (muted) stopSosSiren();
  window.dispatchEvent(new CustomEvent("mxpatrol-sos-siren-settings", { detail: { muted, volume: getStoredVolume() } }));
};

export const getSosSirenVolume = () => getStoredVolume();

export const setSosSirenVolume = (volume: number) => {
  if (typeof window === "undefined") return;
  const next = Math.min(1, Math.max(0, volume));
  window.localStorage.setItem(VOLUME_KEY, String(next));
  if (masterGain) masterGain.gain.value = next * 0.18;
  window.dispatchEvent(new CustomEvent("mxpatrol-sos-siren-settings", { detail: { muted: isSosSirenMuted(), volume: next } }));
};

export const disposeSosSiren = () => {
  stopSosSiren();
  if (audioContext && audioContext.state !== "closed") void audioContext.close().catch(() => undefined);
  audioContext = null;
  masterGain = null;
};
