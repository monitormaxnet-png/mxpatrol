import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Copy, Loader2, LogIn, QrCode, Radio, RefreshCw, Smartphone } from "lucide-react";
import { useOfflineEnrollQueue } from "@/hooks/useOfflineEnrollQueue";
import { getPatrolDeviceInfo } from "@/lib/deviceInfo";
import { ensureSecureDeviceKey, getSecureDeviceState } from "@/lib/secureDevice";
import { TTechMxPatrolLogo } from "@/components/branding/TTechMxPatrolLogo";
import { MxPatrolVideoBackground } from "@/components/branding/MxPatrolVideoBackground";

type ProcessState = "idle" | "processing" | "error" | "offline-queued" | "success";

interface DeviceMetadata {
  device_identifier: string;
  device_name: string;
  device_type: string;
  serial_number: string;
}

const normalizePairingCode = (value: string) =>
  value.trim().toUpperCase().replace(/^MXP[-\s]?/, "").replace(/[\s-]/g, "");

export default function EnrollPage() {
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [manualToken, setManualToken] = useState("");
  const [metadata, setMetadata] = useState<DeviceMetadata>({
    device_identifier: "",
    device_name: "",
    device_type: "mobile",
    serial_number: "",
  });
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [deviceCodeLoading, setDeviceCodeLoading] = useState(false);
  const [deviceCodeError, setDeviceCodeError] = useState("");

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const { enqueue } = useOfflineEnrollQueue();

  useEffect(() => {
    const ua = navigator.userAgent;
    const isMobile = /Mobile|Android|iPhone/i.test(ua);
    const device = getPatrolDeviceInfo();
    setMetadata((prev) => ({
      ...prev,
      device_identifier: device.deviceIdentifier,
      device_name: isMobile ? "MX Patrol Mobile Device" : "MX Patrol Web Scanner",
      device_type: isMobile ? "mobile" : "scanner",
    }));
  }, []);

  const requestDeviceCode = useCallback(async () => {
    const device = getPatrolDeviceInfo();
    if (!navigator.onLine) {
      setDeviceCodeError("A pairing code needs an internet connection.");
      return;
    }
    setDeviceCodeLoading(true);
    setDeviceCodeError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("device-pair", {
        body: {
          mode: "request_code",
          device_metadata: {
            device_identifier: device.deviceIdentifier,
            device_type: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "tablet",
            model: navigator.userAgent,
            os: navigator.platform,
          },
        },
      });
      if (fnError) throw fnError;
      if (!data?.success) throw new Error(data?.error || "Could not get a pairing code");
      setDeviceCode(data.display_code ?? "MX-" + data.pairing_code);
    } catch (err: unknown) {
      setDeviceCodeError(err instanceof Error ? err.message : "Could not get a pairing code");
    } finally {
      setDeviceCodeLoading(false);
    }
  }, []);

  useEffect(() => { requestDeviceCode(); }, [requestDeviceCode]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch (stopError) { console.warn("Unable to stop QR scanner", stopError); }
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => { return () => { stopCamera(); }; }, [stopCamera]);

  const processEnrollmentToken = useCallback(async (token: string) => {
    const trimmedToken = token.trim();
    if (!trimmedToken) return;

    setProcessState("processing");
    setError("");
    const secureKey = await ensureSecureDeviceKey();
    const secureState = await getSecureDeviceState();
    const enrollPayload = {
      qr_token: trimmedToken,
      device_metadata: {
        device_identifier: metadata.device_identifier,
        device_name: metadata.device_name,
        device_type: metadata.device_type,
        serial_number: metadata.serial_number || undefined,
        user_agent: navigator.userAgent,
        screen: screen.width + "x" + screen.height,
        language: navigator.language,
        public_key: secureKey?.publicKey,
        public_key_algorithm: secureKey?.publicKeyAlgorithm,
        secure_device_state: secureState,
      },
    };

    if (!isOnline) {
      enqueue(enrollPayload);
      setProcessState("offline-queued");
      toast.success("Enrollment saved offline");
      return;
    }

    try {
      const { data, error: fnError } = await supabase.functions.invoke("device-enroll", {
        body: enrollPayload,
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setProcessState("success");
      toast.success("Device enrolled successfully!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
      setProcessState("error");
    }
  }, [enqueue, isOnline, metadata]);

  const handleTokenScanned = useCallback(async (token: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    await stopCamera();
    const trimmedToken = token.trim();
    setManualToken(trimmedToken);
    await processEnrollmentToken(trimmedToken);
    processingRef.current = false;
  }, [processEnrollmentToken, stopCamera]);

  const startCamera = useCallback(async () => {
    setError("");
    processingRef.current = false;
    try {
      const scanner = new Html5Qrcode("web-scanner-qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleTokenScanned(decodedText),
        () => {}
      );
      setCameraActive(true);
    } catch {
      setCameraActive(false);
      setError("Camera scanner unavailable. Enter the enrollment code manually.");
    }
  }, [handleTokenScanned]);

  const processPairingCode = useCallback(async (code: string) => {
    const normalizedCode = normalizePairingCode(code);
    if (!isOnline) {
      toast.error("Pairing requires an internet connection");
      return;
    }

    setError("");
    setProcessState("processing");

    try {
      const secureKey = await ensureSecureDeviceKey();
      const secureState = await getSecureDeviceState();
      const { data, error: fnError } = await supabase.functions.invoke("device-pair", {
        body: {
          pairing_code: normalizedCode,
          device_metadata: {
            device_identifier: metadata.device_identifier,
            device_name: metadata.device_name,
            device_type: metadata.device_type,
            serial_number: metadata.serial_number || undefined,
            model: navigator.userAgent,
            os: navigator.platform,
            nfc_enabled: true,
            public_key: secureKey?.publicKey,
            public_key_algorithm: secureKey?.publicKeyAlgorithm,
            secure_device_state: secureState,
          },
        },
      });

      if (fnError) throw fnError;
      if (!data?.success) throw new Error(data?.error || "Pairing failed");

      setProcessState("success");
      toast.success("Device paired successfully!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Pairing failed");
      setProcessState("error");
    }
  }, [isOnline, metadata]);

  const handleEnrollmentSubmit = () => {
    const value = manualToken.trim();
    if (!value) { toast.error("Please enter an enrollment code"); return; }

    if (value.includes(".")) {
      processEnrollmentToken(value);
      return;
    }

    processPairingCode(value);
  };

  const copyDeviceCode = async () => {
    if (!deviceCode) return;
    await navigator.clipboard.writeText(deviceCode);
    toast.success("Device identifier copied");
  };

  const scannerStatus = processState === "processing"
    ? "Pairing Device"
    : processState === "success"
      ? "Device Ready"
      : processState === "offline-queued"
        ? "Saved Offline"
        : "Tap NFC Tag";

  const scannerDetail = processState === "error"
    ? error
    : processState === "success"
      ? "This scanner is ready for MX Patrol."
      : processState === "offline-queued"
        ? "Enrollment will sync when the connection returns."
        : cameraActive
          ? "Camera scanner active. Hold the enrollment QR in view."
          : "Hold your device close to the checkpoint tag.";

  return (
    <MxPatrolVideoBackground shellClassName="mx-web-scanner" shadeClassName="mx-web-scanner-shade">
      <main className="mx-web-scanner-interface">
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mx-web-scanner-panel"
          aria-label="MX Patrol web scanner"
        >
          <div className="login-side-dots mx-web-scanner-logo">
            <TTechMxPatrolLogo variant="login" priority className="login-logo-video" />
          </div>

          <div className="mx-web-scanner-fields">
            <div className="login-side-dots mx-web-scanner-field">
              <Label htmlFor="device-enrollment">Device Enrollment</Label>
              <div className="mx-web-scanner-input-row">
                <QrCode className="h-5 w-5 text-cyan-300" />
                <Input
                  id="device-enrollment"
                  value={manualToken}
                  onChange={(event) => setManualToken(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") handleEnrollmentSubmit(); }}
                  placeholder="Enter enrollment code"
                  className="mx-web-scanner-input"
                  disabled={processState === "processing"}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleEnrollmentSubmit}
                  disabled={processState === "processing"}
                  aria-label="Submit enrollment code"
                  className="mx-web-scanner-icon-button"
                >
                  {processState === "processing" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radio className="h-5 w-5" />}
                </Button>
              </div>
            </div>

            <div className="login-side-dots mx-web-scanner-field">
              <Label>Device Identifier Code</Label>
              <div className="mx-web-scanner-input-row">
                <Smartphone className="h-5 w-5 text-cyan-300" />
                <span className="mx-web-scanner-code">{deviceCodeLoading ? "Requesting code" : deviceCode ?? metadata.device_identifier}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={deviceCode ? copyDeviceCode : requestDeviceCode}
                  disabled={deviceCodeLoading}
                  aria-label={deviceCode ? "Copy device identifier" : "Refresh device identifier"}
                  className="mx-web-scanner-icon-button"
                >
                  {deviceCodeLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : deviceCode ? <Copy className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
                </Button>
              </div>
              {deviceCodeError ? <p className="mx-web-scanner-message is-error">{deviceCodeError}</p> : null}
            </div>
          </div>

          <Link to="/login" className="login-side-dots mx-web-scanner-login-link">
            <LogIn className="h-5 w-5" /> Login
          </Link>

          <section className="mx-web-scanner-stage" aria-label="Scanner">
            <p className="mx-web-scanner-kicker">NFC SCANNER</p>
            <div className="mx-web-scanner-ring">
              <div className="mx-web-scanner-camera" id="web-scanner-qr-reader" />
              {!cameraActive ? (
                <div className="mx-web-scanner-core">
                  {processState === "processing" ? <Loader2 className="h-14 w-14 animate-spin" /> : <Smartphone className="h-16 w-16" />}
                  <strong>NFC</strong>
                </div>
              ) : null}
            </div>
            <h1>{scannerStatus}</h1>
            <p>{scannerDetail}</p>
            {processState === "error" ? <p className="mx-web-scanner-message is-error">{error}</p> : null}
            <Button
              type="button"
              onClick={cameraActive ? stopCamera : startCamera}
              variant="outline"
              className="mx-web-scanner-camera-button"
              disabled={processState === "processing"}
            >
              <Camera className="h-4 w-4" /> {cameraActive ? "Stop Scanner" : "Start Scanner"}
            </Button>
          </section>
        </motion.section>
      </main>
    </MxPatrolVideoBackground>
  );
}
