import { motion, AnimatePresence } from "framer-motion";
import { Scan, CheckCircle2, XCircle, WifiOff, Smartphone } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";

const statusConfig = {
  idle: {
    icon: Scan,
    label: "Ready to Scan",
    sublabel: "Tap to begin scanning",
    ringColor: "border-muted-foreground/30",
    glowClass: "",
    pulseColor: "bg-muted-foreground/10",
    iconColor: "text-muted-foreground",
  },
  scanning: {
    icon: Smartphone,
    label: "Scanning...",
    sublabel: "Hold device near NFC tag",
    ringColor: "border-primary/60",
    glowClass: "glow-primary",
    pulseColor: "bg-primary/20",
    iconColor: "text-primary",
  },
  success: {
    icon: CheckCircle2,
    label: "Checkpoint Verified",
    sublabel: "Scan recorded successfully",
    ringColor: "border-success",
    glowClass: "glow-success",
    pulseColor: "bg-success/20",
    iconColor: "text-success",
  },
  error: {
    icon: XCircle,
    label: "Invalid or Unauthorized Tag",
    sublabel: "Tag not recognized",
    ringColor: "border-destructive",
    glowClass: "glow-destructive",
    pulseColor: "bg-destructive/20",
    iconColor: "text-destructive",
  },
  unsupported: {
    icon: WifiOff,
    label: "NFC Not Available",
    sublabel: "Use manual scan mode instead",
    ringColor: "border-warning/50",
    glowClass: "glow-warning",
    pulseColor: "bg-warning/10",
    iconColor: "text-warning",
  },
  disabled: {
    icon: WifiOff,
    label: "NFC Disabled",
    sublabel: "Enable NFC in device settings",
    ringColor: "border-warning/50",
    glowClass: "glow-warning",
    pulseColor: "bg-warning/10",
    iconColor: "text-warning",
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
  const Icon = config.icon;
  const isAnimating = status === "scanning";

  return (
    <div className="flex flex-col items-center gap-6" onClick={onClick}>
      {/* Outer ring container */}
      <div className="relative flex items-center justify-center" style={{ width: 240, height: 240 }}>
        {/* Radar pulse rings */}
        <AnimatePresence>
          {isAnimating && (
            <>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={`pulse-${i}`}
                  className="absolute inset-0 rounded-full border-2 border-primary/30"
                  initial={{ scale: 0.8, opacity: 0.6 }}
                  animate={{ scale: 1.6, opacity: 0 }}
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

        {/* Success/Error glow burst */}
        <AnimatePresence>
          {(status === "success" || status === "error") && (
            <motion.div
              className={`absolute inset-0 rounded-full ${config.pulseColor}`}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1.3, opacity: 0.4 }}
              exit={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>

        {/* Main ring */}
        <motion.div
          className={`relative flex h-48 w-48 items-center justify-center rounded-full border-4 ${config.ringColor} ${config.glowClass} transition-colors duration-500`}
          animate={
            isAnimating
              ? { scale: [1, 1.03, 1], borderColor: ["hsl(188 95% 50% / 0.4)", "hsl(188 95% 50% / 0.8)", "hsl(188 95% 50% / 0.4)"] }
              : { scale: 1 }
          }
          transition={isAnimating ? { duration: 2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        >
          {/* Inner glow background */}
          <div className={`absolute inset-2 rounded-full ${config.pulseColor} transition-colors duration-500`} />

          {/* Icon */}
          <motion.div
            key={status}
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", damping: 12, stiffness: 200 }}
          >
            <Icon className={`h-16 w-16 ${config.iconColor} transition-colors duration-300`} strokeWidth={1.5} />
          </motion.div>
        </motion.div>
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
