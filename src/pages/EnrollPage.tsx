import { useState, useEffect, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Shield, Camera, CameraOff, CheckCircle2, XCircle, Loader2,
  Smartphone, Wifi, WifiOff, QrCode, ArrowLeft, RefreshCw, CloudUpload,
} from "lucide-react";
import { useOfflineEnrollQueue } from "@/hooks/useOfflineEnrollQueue";

type EnrollState = "scanning" | "processing" | "success" | "error" | "offline-queued" | "manual";

interface DeviceMetadata {
  device_identifier: string;
  device_name: string;
  device_type: string;
  serial_number: string;
}

export default function EnrollPage() {
  const [state, setState] = useState<EnrollState>("scanning");
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [manualToken, setManualToken] = useState("");
  const [metadata, setMetadata] = useState<DeviceMetadata>({
    device_identifier: "",
    device_name: "",
    device_type: "mobile",
    serial_number: "",
  });
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const { enqueue, syncQueue, syncing, pendingCount } = useOfflineEnrollQueue();
  // Auto-populate device metadata from browser
  useEffect(() => {
    const ua = navigator.userAgent;
    const isMobile = /Mobile|Android|iPhone/i.test(ua);
    const deviceId = `WEB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    setMetadata((prev) => ({
      ...prev,
      device_identifier: deviceId,
      device_name: isMobile ? "Guard Mobile Device" : "Guard Workstation",
      device_type: isMobile ? "mobile" : "tablet",
    }));
  }, []);

  // Online/offline listener
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
      try {
        await scannerRef.current.stop();
      } catch {}
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const processEnrollment = useCallback(
    async (token: string) => {
      if (processingRef.current) return;
      processingRef.current = true;
      setState("processing");
      await stopCamera();

      const enrollPayload = {
        qr_token: token.trim(),
        device_metadata: {
          device_identifier: metadata.device_identifier,
          device_name: metadata.device_name,
          device_type: metadata.device_type,
          serial_number: metadata.serial_number || undefined,
          user_agent: navigator.userAgent,
          screen: `${screen.width}x${screen.height}`,
          language: navigator.language,
        },
      };

      if (!isOnline) {
        enqueue(enrollPayload);
        setState("offline-queued");
        processingRef.current = false;
        return;
      }

      try {
        const { data, error: fnError } = await supabase.functions.invoke("device-enroll", {
          body: enrollPayload,
        });

        if (fnError) throw fnError;
        if (data?.error) throw new Error(data.error);

        setResult(data);
        setState("success");
        toast.success("Device enrolled successfully!");
      } catch (err: any) {
        setError(err.message || "Enrollment failed");
        setState("error");
      } finally {
        processingRef.current = false;
      }
    },
    [metadata, isOnline, stopCamera]
  );

  const startCamera = useCallback(async () => {
    setState("scanning");
    setError("");
    processingRef.current = false;

    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          processEnrollment(decodedText);
        },
        () => {}
      );
      setCameraActive(true);
    } catch (err: any) {
      setError("Camera access denied or unavailable. Try entering the token manually.");
      setState("manual");
    }
  }, [processEnrollment]);

  const handleManualSubmit = () => {
    if (!manualToken.trim()) {
      toast.error("Please enter a QR token");
      return;
    }
    processEnrollment(manualToken);
  };

  const resetScanner = () => {
    setState("scanning");
    setError("");
    setResult(null);
    processingRef.current = false;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-heading text-sm font-bold text-foreground tracking-wide">
              SENTINEL
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Device Enrollment
            </p>
          </div>
          <div className="ml-auto">
            <Badge variant={isOnline ? "default" : "destructive"} className={isOnline ? "bg-success text-success-foreground" : ""}>
              {isOnline ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
              {isOnline ? "Online" : "Offline"}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg space-y-6">
          <AnimatePresence mode="wait">
            {/* ===== SCANNING STATE ===== */}
            {(state === "scanning") && (
              <motion.div
                key="scanning"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <Card>
                  <CardHeader className="text-center">
                    <CardTitle className="flex items-center justify-center gap-2">
                      <QrCode className="h-5 w-5 text-primary" />
                      Scan Enrollment QR Code
                    </CardTitle>
                    <CardDescription>
                      Point your camera at the QR code provided by your administrator
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Camera viewport */}
                    <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-primary/30 bg-muted/50">
                      <div id="qr-reader" className="w-full min-h-[300px]" />
                      {!cameraActive && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                          <Camera className="h-12 w-12 text-muted-foreground" />
                          <Button onClick={startCamera}>
                            <Camera className="mr-2 h-4 w-4" /> Start Camera
                          </Button>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => { stopCamera(); setState("manual"); }}
                    >
                      Enter token manually
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ===== MANUAL ENTRY ===== */}
            {state === "manual" && (
              <motion.div
                key="manual"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <Card>
                  <CardHeader>
                    <CardTitle>Manual Token Entry</CardTitle>
                    <CardDescription>
                      Paste the enrollment token from your administrator
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Enrollment Token</Label>
                      <Input
                        value={manualToken}
                        onChange={(e) => setManualToken(e.target.value)}
                        placeholder="Paste token here..."
                        className="font-mono text-xs"
                      />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label>Device Name</Label>
                      <Input
                        value={metadata.device_name}
                        onChange={(e) =>
                          setMetadata((m) => ({ ...m, device_name: e.target.value }))
                        }
                        placeholder="e.g. Guard Phone #1"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" onClick={resetScanner} className="flex-1">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Camera
                      </Button>
                      <Button onClick={handleManualSubmit} className="flex-1">
                        Enroll Device
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ===== PROCESSING ===== */}
            {state === "processing" && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card>
                  <CardContent className="flex flex-col items-center gap-4 py-12">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    <p className="text-lg font-medium text-foreground">Enrolling device...</p>
                    <p className="text-sm text-muted-foreground">Validating token and registering your device</p>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ===== SUCCESS ===== */}
            {state === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card className="border-success/50">
                  <CardContent className="flex flex-col items-center gap-4 py-12">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                      <CheckCircle2 className="h-10 w-10 text-success" />
                    </div>
                    <p className="text-xl font-bold text-foreground">Enrollment Complete!</p>
                    <p className="text-sm text-muted-foreground text-center">
                      This device has been successfully registered and is ready for patrol duty.
                    </p>

                    {result && (
                      <div className="w-full space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Device ID</span>
                          <span className="font-mono text-xs text-foreground">
                            {result.device_id?.slice(0, 8)}...
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">App Type</span>
                          <Badge variant="outline">
                            {result.app_type === "admin_app" ? "Admin" : "Guard"}
                          </Badge>
                        </div>
                      </div>
                    )}

                    <Button variant="outline" onClick={() => window.location.href = "/login"}>
                      Go to Login
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ===== ERROR ===== */}
            {state === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card className="border-destructive/50">
                  <CardContent className="flex flex-col items-center gap-4 py-12">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                      <XCircle className="h-10 w-10 text-destructive" />
                    </div>
                    <p className="text-xl font-bold text-foreground">Enrollment Failed</p>
                    <p className="text-sm text-destructive text-center">{error}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={resetScanner}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Try Again
                      </Button>
                      <Button variant="outline" onClick={() => setState("manual")}>
                        Enter Manually
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ===== OFFLINE QUEUED ===== */}
            {state === "offline-queued" && (
              <motion.div
                key="offline"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card className="border-warning/50">
                  <CardContent className="flex flex-col items-center gap-4 py-12">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
                      <WifiOff className="h-10 w-10 text-warning" />
                    </div>
                    <p className="text-xl font-bold text-foreground">Saved Offline</p>
                    <p className="text-sm text-muted-foreground text-center">
                      Your enrollment request has been saved locally. It will be submitted automatically when you reconnect to the internet.
                    </p>
                    {pendingCount > 0 && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CloudUpload className="h-3 w-3" />
                        <span>{pendingCount} pending enrollment{pendingCount > 1 ? "s" : ""} in queue</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={resetScanner}>
                        Scan Another
                      </Button>
                      <Button variant="outline" onClick={syncQueue} disabled={syncing || !isOnline}>
                        {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Sync Now
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Device info footer */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Smartphone className="h-3 w-3" />
              <span>Device: {metadata.device_name}</span>
              <span className="mx-1">•</span>
              <span>ID: {metadata.device_identifier}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
