export type FeedbackSound =
  | "scan-detected"
  | "scan-success"
  | "verifying"
  | "offline-queued"
  | "duplicate"
  | "sync-complete"
  | "error"
  | "sos"
  | "photo-received"
  | "photo-capture";

const SOUND_ENABLED_KEY = "mxpatrol_feedback_sounds_enabled";

type BrowserWindowWithAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type Tone = {
  frequency: number;
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
};

const patterns: Record<FeedbackSound, Tone[]> = {
  "scan-detected": [{ frequency: 740, start: 0, duration: 0.06, gain: 0.045 }],
  "scan-success": [
    { frequency: 660, start: 0, duration: 0.07, gain: 0.055 },
    { frequency: 920, start: 0.08, duration: 0.09, gain: 0.055 },
  ],
  verifying: [
    { frequency: 520, start: 0, duration: 0.035, gain: 0.035 },
    { frequency: 620, start: 0.055, duration: 0.035, gain: 0.035 },
  ],
  "offline-queued": [
    { frequency: 520, start: 0, duration: 0.08, gain: 0.045 },
    { frequency: 420, start: 0.1, duration: 0.08, gain: 0.04 },
  ],
  duplicate: [
    { frequency: 390, start: 0, duration: 0.07, gain: 0.045, type: "triangle" },
    { frequency: 390, start: 0.1, duration: 0.07, gain: 0.035, type: "triangle" },
  ],
  "sync-complete": [
    { frequency: 620, start: 0, duration: 0.06, gain: 0.045 },
    { frequency: 780, start: 0.07, duration: 0.06, gain: 0.045 },
    { frequency: 980, start: 0.14, duration: 0.08, gain: 0.05 },
  ],
  error: [
    { frequency: 280, start: 0, duration: 0.11, gain: 0.055, type: "sawtooth" },
    { frequency: 220, start: 0.13, duration: 0.13, gain: 0.05, type: "sawtooth" },
  ],
  sos: [
    { frequency: 880, start: 0, duration: 0.12, gain: 0.13, type: "square" },
    { frequency: 1240, start: 0.15, duration: 0.12, gain: 0.12, type: "square" },
    { frequency: 880, start: 0.3, duration: 0.12, gain: 0.13, type: "square" },
    { frequency: 1240, start: 0.45, duration: 0.18, gain: 0.11, type: "square" },
  ],
  "photo-capture": [
    { frequency: 980, start: 0, duration: 0.035, gain: 0.07, type: "triangle" },
    { frequency: 1560, start: 0.045, duration: 0.045, gain: 0.055, type: "triangle" },
  ],
  "photo-received": [
    { frequency: 720, start: 0, duration: 0.06, gain: 0.05 },
    { frequency: 1040, start: 0.08, duration: 0.08, gain: 0.055 },
    { frequency: 1320, start: 0.18, duration: 0.07, gain: 0.045 },
  ],
};

export const isFeedbackSoundEnabled = () => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "false";
};

export const setFeedbackSoundEnabled = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOUND_ENABLED_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent("mxpatrol-feedback-sound-change", { detail: { enabled } }));
};

export const playFeedbackSound = (sound: FeedbackSound) => {
  if (typeof window === "undefined" || !isFeedbackSoundEnabled()) return;

  try {
    const AudioContextClass = window.AudioContext || (window as BrowserWindowWithAudio).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const now = audioContext.currentTime;

    patterns[sound].forEach((tone) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + tone.start;
      const end = start + tone.duration;

      oscillator.type = tone.type ?? "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(tone.gain ?? 0.05, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    });

    window.setTimeout(() => void audioContext.close().catch(() => undefined), 1000);
  } catch {
    // Audio feedback is best-effort only; visual feedback remains authoritative.
  }
};


export const playTagDetected = () => playFeedbackSound("scan-detected");
export const playVerifying = () => playFeedbackSound("verifying");
export const playScanSuccess = () => playFeedbackSound("scan-success");
export const playOfflineSaved = () => playFeedbackSound("offline-queued");
export const playDuplicate = () => playFeedbackSound("duplicate");
export const playSosAlert = () => playFeedbackSound("sos");
export const playPhotoReceived = () => playFeedbackSound("photo-received");
export const playPhotoCapture = () => playFeedbackSound("photo-capture");
export const playScanError = () => playFeedbackSound("error");
export const playError = playScanError;
