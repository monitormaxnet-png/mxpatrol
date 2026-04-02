import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, CheckCircle2, XCircle, Loader2, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type FaceVerifyStatus = "idle" | "capturing" | "verifying" | "passed" | "failed";

export type FaceVerifyResult = {
  verified: boolean;
  confidence: number;
  reason: string;
};

interface FaceVerificationProps {
  guardPhotoUrl: string | null;
  onResult: (result: FaceVerifyResult) => void;
  disabled?: boolean;
}

const statusConfig = {
  idle: { color: "border-muted-foreground/30", bg: "bg-muted/20", text: "text-muted-foreground" },
  capturing: { color: "border-primary/60", bg: "bg-primary/10", text: "text-primary" },
  verifying: { color: "border-warning/60", bg: "bg-warning/10", text: "text-warning" },
  passed: { color: "border-success", bg: "bg-success/10", text: "text-success" },
  failed: { color: "border-destructive", bg: "bg-destructive/10", text: "text-destructive" },
};

const FaceVerification = ({ guardPhotoUrl, onResult, disabled }: FaceVerificationProps) => {
  const [status, setStatus] = useState<FaceVerifyStatus>("idle");
  const [confidence, setConfidence] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("capturing");
    } catch {
      toast.error("Camera access denied. Enable camera permissions.");
      setStatus("idle");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const captureAndVerify = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !guardPhotoUrl) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    stopCamera();
    setStatus("verifying");

    // Convert to base64
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = dataUrl.split(",")[1];

    try {
      const { data, error } = await supabase.functions.invoke("face-verify", {
        body: { selfie_base64: base64, reference_url: guardPhotoUrl },
      });

      if (error) throw error;

      const result: FaceVerifyResult = {
        verified: data.verified ?? false,
        confidence: data.confidence ?? 0,
        reason: data.reason ?? "Unknown",
      };

      setConfidence(result.confidence);
      setStatus(result.verified ? "passed" : "failed");
      onResult(result);

      // Auto-reset after display
      setTimeout(() => {
        setStatus("idle");
        setConfidence(null);
      }, 4000);
    } catch (err: any) {
      toast.error("Face verification failed: " + (err.message || "Unknown error"));
      setStatus("failed");
      onResult({ verified: false, confidence: 0, reason: "System error" });
      setTimeout(() => setStatus("idle"), 3000);
    }
  }, [guardPhotoUrl, onResult, stopCamera]);

  const cfg = statusConfig[status];

  if (!guardPhotoUrl) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-center">
        <ScanFace className="mx-auto h-8 w-8 text-warning mb-2" />
        <p className="text-sm font-medium text-warning">No Reference Photo</p>
        <p className="text-xs text-muted-foreground mt-1">
          Upload a guard profile photo to enable facial verification
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <ScanFace className="h-3.5 w-3.5" />
        Facial Verification
      </div>

      <div className={`relative rounded-xl border-2 ${cfg.color} ${cfg.bg} overflow-hidden transition-all duration-500`}>
        {/* Camera view */}
        <AnimatePresence mode="wait">
          {status === "capturing" && (
            <motion.div
              key="camera"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative"
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full aspect-[4/3] object-cover rounded-lg"
              />
              {/* Face guide overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-32 h-40 border-2 border-dashed border-primary/60 rounded-[50%]" />
              </div>
              <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                <Button onClick={captureAndVerify} size="sm" className="gap-2 shadow-lg">
                  <Camera className="h-4 w-4" />
                  Capture & Verify
                </Button>
              </div>
            </motion.div>
          )}

          {status === "verifying" && (
            <motion.div
              key="verifying"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-8"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              >
                <ScanFace className="h-12 w-12 text-warning" />
              </motion.div>
              <p className="mt-3 text-sm font-medium text-warning">Analyzing face...</p>
              <p className="text-xs text-muted-foreground">AI verification in progress</p>
            </motion.div>
          )}

          {status === "passed" && (
            <motion.div
              key="passed"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center justify-center py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 10 }}
              >
                <CheckCircle2 className="h-14 w-14 text-success" />
              </motion.div>
              <p className="mt-3 text-sm font-bold text-success">Identity Verified</p>
              <p className="text-xs text-muted-foreground">
                Confidence: {confidence ? `${Math.round(confidence * 100)}%` : "—"}
              </p>
            </motion.div>
          )}

          {status === "failed" && (
            <motion.div
              key="failed"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center justify-center py-8"
            >
              <XCircle className="h-14 w-14 text-destructive" />
              <p className="mt-3 text-sm font-bold text-destructive">Verification Failed</p>
              <p className="text-xs text-muted-foreground">
                Face does not match reference photo
              </p>
            </motion.div>
          )}

          {status === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-6"
            >
              <Button
                variant="outline"
                onClick={startCamera}
                disabled={disabled}
                className="gap-2"
              >
                <ScanFace className="h-4 w-4" />
                Start Face Verification
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default FaceVerification;
