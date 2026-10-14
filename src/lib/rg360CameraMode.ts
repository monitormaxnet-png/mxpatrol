export type Rg360CameraMode = 'PATROL' | 'FACIAL_ENROLLMENT' | 'FACIAL_ATTENDANCE' | 'BIOMETRIC_TEST';

const CAMERA_MODE_KEY = 'mxpatrol_rg360_camera_mode';

export function getRg360CameraMode(): Rg360CameraMode {
  if (typeof window === 'undefined') return 'PATROL';
  const value = window.localStorage.getItem(CAMERA_MODE_KEY);
  if (value === 'FACIAL_ENROLLMENT' || value === 'FACIAL_ATTENDANCE' || value === 'BIOMETRIC_TEST') return value;
  return 'PATROL';
}

export function setRg360CameraMode(mode: Rg360CameraMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CAMERA_MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent('mxpatrol:rg360-camera-mode', { detail: { mode } }));
}

export function releaseRg360CameraMode(mode?: Rg360CameraMode) {
  if (typeof window === 'undefined') return;
  if (!mode || getRg360CameraMode() === mode) setRg360CameraMode('PATROL');
}

export function isRg360CameraMode(mode: Rg360CameraMode) {
  return getRg360CameraMode() === mode;
}
