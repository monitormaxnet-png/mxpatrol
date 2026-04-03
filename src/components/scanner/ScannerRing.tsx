import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, WifiOff } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";
import vaultDoor from "@/assets/vault-door.png";

const statusConfig = {
  idle: {
    label: "Ready to Scan",
    sublabel: "Tap to begin scanning",
    glowColor: "rgba(100,120,140,0.3)",
    iconColor: "text-muted-foreground",
    overlayIcon: null,
  },
  scanning: {
    label: "Scanning...",
    sublabel: "Hold device near NFC tag",
    glowColor: "rgba(0,200,255,0.5)",
    iconColor: "text-primary",
    overlayIcon: null,
  },
  success: {
    label: "Checkpoint Verified",
    sublabel: "Scan recorded successfully",
    glowColor: "rgba(16,185,129,0.6)",
    iconColor: "text-success",
    overlayIcon: CheckCircle2,
  },
  error: {
    label: "Invalid or Unauthorized Tag",
    sublabel: "Tag not recognized",
    glowColor: "rgba(239,68,68,0.6)",
    iconColor: "text-destructive",
    overlayIcon: XCircle,
  },
  unsupported: {
    label: "NFC Not Available",
    sublabel: "Use manual scan mode instead",
    glowColor: "rgba(245,158,11,0.4)",
    iconColor: "text-warning",
    overlayIcon: WifiOff,
  },
  disabled: {
    label: "NFC Disabled",
    sublabel: "Enable NFC in device settings",
    glowColor: "rgba(245,158,11,0.4)",
    iconColor: "text-warning",
    overlayIcon: WifiOff,
  },
};

interface ScannerRingProps {
  status: NfcStatus;
  checkpointName?: string | null;
  errorReason?: string | null;
  onClick?: () => void;
}

const ScannerRing = ({ status, checkpointName, errorReason, onClick }: ScannerRingProps) => {
  const config = statusConfig[status];
  const OverlayIcon = config.overlayIcon;
  const isAnimating = status === "scanning";

  return (
    <div className="flex flex-col items-center gap-6" onClick={onClick}>
      {/* Vault container */}
      <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>
        {/* Radar pulse rings for scanning */}
        <AnimatePresence>
          {isAnimating && (
            <>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={`pulse-${i}`}
                  className="absolute rounded-full"
                  style={{
                    width: 260,
                    height: 260,
                    border: `2px solid ${config.glowColor}`,
                  }}
                  initial={{ scale: 0.85, opacity: 0.6 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{
                    duration: 2.5,
                    delay: i * 0.8,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
              ))}
            </>
          )}
        </AnimatePresence>

        {/* Glow behind vault */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 220,
            height: 220,
            background: `radial-gradient(circle, ${config.glowColor} 0%, transparent 70%)`,
            filter: "blur(20px)",
          }}
          animate={
            isAnimating
              ? { opacity: [0.4, 0.8, 0.4], scale: [1, 1.1, 1] }
              : { opacity: 0.5 }
          }
          transition={isAnimating ? { duration: 2, repeat: Infinity } : { duration: 0.5 }}
        />

        {/* Vault door image */}
        <motion.img
          src={vaultDoor}
          alt="Vault Scanner"
          className="relative z-10 drop-shadow-2xl"
          style={{
            width: 200,
            height: 200,
            objectFit: "contain",
            filter: `drop-shadow(0 0 20px ${config.glowColor})`,
          }}
          animate={
            isAnimating
              ? { rotateZ: [0, 8, -8, 0] }
              : status === "success"
              ? { rotateZ: [0, 15] }
              : status === "error"
              ? { rotateZ: [0, -5, 5, -5, 0] }
              : { rotateZ: [0, 360] }
          }
          transition={
            isAnimating
              ? { duration: 3, repeat: Infinity, ease: "easeInOut" }
              : status === "success"
              ? { duration: 0.6, ease: "easeOut" }
              : status === "error"
              ? { duration: 0.5, ease: "easeOut" }
              : {}
          }
        />

        {/* Status overlay icon */}
        <AnimatePresence>
          {OverlayIcon && (
            <motion.div
              className="absolute z-20 flex items-center justify-center"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 12 }}
            >
              <div className="rounded-full bg-background/80 p-3 backdrop-blur-sm">
                <OverlayIcon className={`h-10 w-10 ${config.iconColor}`} strokeWidth={2} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status text */}
      <div className="text-center space-y-1">
        <motion.p
          key={`label-${status}`}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-heading text-lg font-bold text-foreground"
        >
          {status === "success" && checkpointName ? `✓ ${checkpointName}` : config.label}
        </motion.p>
        <motion.p
          key={`sub-${status}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-sm text-muted-foreground"
        >
          {status === "error" && errorReason ? errorReason : config.sublabel}
        </motion.p>
      </div>
    </div>
  );
};

export default ScannerRing;
