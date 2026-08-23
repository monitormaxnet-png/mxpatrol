type VerifyInput = {
  serviceClient: any;
  device: Record<string, any>;
  auth: Record<string, unknown> | null | undefined;
  action: string;
};

const encoder = new TextEncoder();
const MAX_SKEW_MS = 5 * 60 * 1000;

export async function verifySecureDeviceRequest({ serviceClient, device, auth, action }: VerifyInput) {
  if (!device?.secure_mode_enabled && !device?.public_key) return { ok: true, required: false };

  const fail = async (code: string, message: string, metadata: Record<string, unknown> = {}) => {
    await logDeviceSecurityEvent(serviceClient, device, code.toLowerCase(), "high", metadata);
    return { ok: false, required: true, code, message };
  };

  if (!auth || typeof auth !== "object") return fail("DEVICE_AUTH_REQUIRED", "Device authorization is required");
  const timestamp = stringOrNull(auth.timestamp);
  const nonce = stringOrNull(auth.nonce);
  const payloadHash = stringOrNull(auth.payload_hash);
  const signature = stringOrNull(auth.signature);
  const deviceIdentifier = stringOrNull(auth.device_identifier);
  const authAction = stringOrNull(auth.action);

  if (!timestamp || !nonce || !payloadHash || !signature || !deviceIdentifier || !authAction) {
    return fail("DEVICE_AUTH_INCOMPLETE", "Device authorization is incomplete");
  }
  if (deviceIdentifier !== device.device_identifier || authAction !== action) {
    return fail("DEVICE_AUTH_MISMATCH", "Device authorization does not match this request", { auth_action: authAction });
  }
  if (device.secure_mode_status === "revoked" || device.secure_mode_status === "disabled" || device.pairing_status === "revoked") {
    return fail("DEVICE_REVOKED", "Device is disabled");
  }

  const requestTime = Date.parse(timestamp);
  if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > MAX_SKEW_MS) {
    return fail("DEVICE_AUTH_EXPIRED", "Device authorization expired");
  }

  const nonceInsert = await serviceClient.from("device_request_nonces").insert({
    device_id: device.id,
    nonce,
    action,
    request_timestamp: timestamp,
    payload_hash: payloadHash,
  });
  if (nonceInsert.error?.code === "23505") return fail("DEVICE_AUTH_REPLAY", "Duplicate device authorization rejected", { nonce });
  if (nonceInsert.error) return fail("DEVICE_AUTH_NONCE_ERROR", "Device authorization could not be recorded", { error: nonceInsert.error.message });

  if (!device.public_key) return fail("DEVICE_PUBLIC_KEY_MISSING", "Device key is not registered");

  const canonical = [deviceIdentifier, timestamp, nonce, action, payloadHash].join("\n");
  const verified = await verifyEcdsaSignature(String(device.public_key), canonical, signature);
  if (!verified) return fail("DEVICE_AUTH_INVALID", "Invalid device authorization signature");

  await serviceClient.from("devices").update({ last_secure_auth_at: new Date().toISOString() }).eq("id", device.id);
  return { ok: true, required: true };
}

async function verifyEcdsaSignature(publicKeyBase64: string, canonical: string, signatureBase64: string) {
  try {
    const publicKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(publicKeyBase64),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signature = derToJose(base64ToBytes(signatureBase64), 64) ?? base64ToBytes(signatureBase64);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, encoder.encode(canonical));
  } catch (error) {
    console.warn("secure device signature verification failed", error);
    return false;
  }
}

function derToJose(signature: Uint8Array, outputLength: number) {
  if (signature[0] !== 0x30) return null;
  let offset = signature[1] & 0x80 ? 2 + (signature[1] & 0x7f) : 2;
  if (signature[offset] !== 0x02) return null;
  const rLength = signature[offset + 1];
  const r = signature.slice(offset + 2, offset + 2 + rLength);
  offset = offset + 2 + rLength;
  if (signature[offset] !== 0x02) return null;
  const sLength = signature[offset + 1];
  const s = signature.slice(offset + 2, offset + 2 + sLength);
  const out = new Uint8Array(outputLength);
  const rt = trimInteger(r);
  const st = trimInteger(s);
  out.set(rt.slice(-32), 32 - Math.min(32, rt.length));
  out.set(st.slice(-32), 64 - Math.min(32, st.length));
  return out;
}

function trimInteger(value: Uint8Array) {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  return value.slice(start);
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function logDeviceSecurityEvent(serviceClient: any, device: Record<string, any>, eventType: string, severity: string, metadata: Record<string, unknown>) {
  try {
    await serviceClient.from("device_security_events").insert({
      company_id: device.company_id,
      site_id: device.site_id ?? null,
      device_id: device.id,
      device_identifier: device.device_identifier,
      event_type: eventType,
      severity,
      app_version: device.app_version ?? null,
      metadata,
    });
  } catch (error) {
    console.warn("device security event log failed", error);
  }
}
