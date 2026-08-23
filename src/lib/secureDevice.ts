import { Capacitor, registerPlugin } from "@capacitor/core";

export type SecureDeviceNativeState = {
  platform?: string;
  packageName?: string;
  packageNameValid?: boolean;
  deviceOwner?: boolean;
  kioskActive?: boolean;
  deviceKeyAvailable?: boolean;
  appVersion?: string | null;
  appVersionCode?: number | null;
  isDebugBuild?: boolean;
  developerModeDetected?: boolean;
  adbDetected?: boolean;
  appSignatureSha256?: string | null;
  capabilities?: string[];
};

export type SecureDeviceAuth = {
  device_identifier: string;
  timestamp: string;
  nonce: string;
  action: string;
  payload_hash: string;
  signature: string;
  signature_algorithm: "SHA256withECDSA";
};

type SecureDevicePlugin = {
  getSecurityState(): Promise<SecureDeviceNativeState>;
  ensureDeviceKey(): Promise<{ deviceKeyAvailable: boolean; publicKey: string; publicKeyAlgorithm: string; keyAlias?: string }>;
  signRequest(input: { canonical: string }): Promise<{ signature: string; signatureAlgorithm: string; canonical: string }>;
  enableKiosk(): Promise<Record<string, unknown>>;
  disableKiosk(): Promise<Record<string, unknown>>;
  enterMaintenanceMode(input?: { expiresAt?: string; token?: string }): Promise<Record<string, unknown>>;
  exitMaintenanceMode(): Promise<Record<string, unknown>>;
};

export const SecureDevice = registerPlugin<SecureDevicePlugin>("SecureDevice");
export const isSecureDeviceNativeAvailable = () => Capacitor.getPlatform() === "android" && Capacitor.isNativePlatform();

export const getWebSecureDeviceState = (): SecureDeviceNativeState => ({
  platform: Capacitor.getPlatform(),
  packageNameValid: true,
  deviceOwner: false,
  kioskActive: false,
  deviceKeyAvailable: false,
  isDebugBuild: import.meta.env.DEV,
  developerModeDetected: false,
  adbDetected: false,
  capabilities: [],
});

export async function getSecureDeviceState(): Promise<SecureDeviceNativeState> {
  if (!isSecureDeviceNativeAvailable()) return getWebSecureDeviceState();
  try {
    return await SecureDevice.getSecurityState();
  } catch (error) {
    console.warn("[SecureDevice] Native security state unavailable", error);
    return { ...getWebSecureDeviceState(), platform: "android", packageNameValid: false };
  }
}

export async function ensureSecureDeviceKey() {
  if (!isSecureDeviceNativeAvailable()) return null;
  return SecureDevice.ensureDeviceKey();
}

export function canonicalSecureRequest(input: { deviceIdentifier: string; timestamp: string; nonce: string; action: string; payloadHash: string }) {
  return [input.deviceIdentifier, input.timestamp, input.nonce, input.action, input.payloadHash].join("\n");
}

export async function sha256Base64Url(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  const binary = bytes.map((byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function signSecureDevicePayload(action: string, deviceIdentifier: string | null | undefined, payload: unknown): Promise<SecureDeviceAuth | null> {
  if (!deviceIdentifier || !isSecureDeviceNativeAvailable()) return null;
  try {
    await ensureSecureDeviceKey();
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const payloadHash = await sha256Base64Url(payload);
    const canonical = canonicalSecureRequest({ deviceIdentifier, timestamp, nonce, action, payloadHash });
    const signed = await SecureDevice.signRequest({ canonical });
    return { device_identifier: deviceIdentifier, timestamp, nonce, action, payload_hash: payloadHash, signature: signed.signature, signature_algorithm: "SHA256withECDSA" };
  } catch (error) {
    console.warn("[SecureDevice] Request signing failed", error);
    return null;
  }
}

export function getSecureDeviceBlockedReason(input: { nativeState: SecureDeviceNativeState | null | undefined; secureModeEnabled?: boolean | null; secureModeStatus?: string | null; pairingStatus?: string | null; isNative?: boolean }) {
  if (input.pairingStatus && input.pairingStatus !== "paired") return "Device is not enrolled for patrol scanning.";
  if (!input.secureModeEnabled) return null;
  if (!input.isNative) return "Secure Patrol Device Mode requires the approved Android patrol APK.";
  if (input.secureModeStatus === "revoked") return "Device Disabled. Contact your administrator.";
  if (input.secureModeStatus === "disabled") return "Device Disabled. Contact your administrator.";
  if (input.secureModeStatus === "update_required") return "MX Patrol Update Required.";
  if (input.secureModeStatus === "integrity_failed") return "Device Security Check Failed. Administrator attention required.";
  if (!input.nativeState?.packageNameValid) return "Device Security Check Failed. Administrator attention required.";
  if (!input.nativeState?.deviceKeyAvailable) return "Device authorization key is not ready. Contact your administrator.";
  if (input.nativeState?.isDebugBuild && import.meta.env.PROD) return "Device Security Check Failed. Administrator attention required.";
  return null;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}
