import { useState, useCallback, useRef, useEffect } from "react";

export type NfcStatus = "idle" | "scanning" | "success" | "error" | "unsupported" | "disabled";

type NfcResult = {
  serialNumber: string;
  timestamp: string;
};

type UseNfcReaderOptions = {
  onScan?: (result: NfcResult) => void;
  debounceMs?: number;
};

export function useNfcReader({ onScan, debounceMs = 3000 }: UseNfcReaderOptions = {}) {
  const [status, setStatus] = useState<NfcStatus>("idle");
  const [lastTag, setLastTag] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastScanRef = useRef<{ tag: string; time: number } | null>(null);
  const supported = typeof window !== "undefined" && "NDEFReader" in window;

  const startScanning = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      setErrorMessage("NFC is not supported on this device or browser. Use Chrome on Android.");
      return;
    }

    try {
      setStatus("scanning");
      setErrorMessage(null);

      const ndef = new (window as any).NDEFReader();
      const controller = new AbortController();
      abortRef.current = controller;

      await ndef.scan({ signal: controller.signal });

      ndef.addEventListener("reading", ({ serialNumber }: any) => {
        const now = Date.now();
        const tag = serialNumber || "unknown";

        // Debounce duplicate scans of the same tag
        if (
          lastScanRef.current &&
          lastScanRef.current.tag === tag &&
          now - lastScanRef.current.time < debounceMs
        ) {
          return;
        }

        lastScanRef.current = { tag, time: now };
        setLastTag(tag);
        setStatus("success");

        const result: NfcResult = {
          serialNumber: tag,
          timestamp: new Date().toISOString(),
        };

        onScan?.(result);

        // Reset to scanning after success display
        setTimeout(() => setStatus("scanning"), 2500);
      }, { signal: controller.signal });

      ndef.addEventListener("readingerror", () => {
        setStatus("error");
        setErrorMessage("Failed to read NFC tag. Try again.");
        setTimeout(() => setStatus("scanning"), 2000);
      }, { signal: controller.signal });

    } catch (err: any) {
      if (err.name === "AbortError") return;

      if (err.name === "NotAllowedError") {
        setStatus("disabled");
        setErrorMessage("NFC permission denied. Enable NFC in device settings.");
      } else {
        setStatus("error");
        setErrorMessage(err.message || "NFC read failed");
      }
    }
  }, [supported, onScan, debounceMs]);

  const stopScanning = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    status,
    lastTag,
    errorMessage,
    supported,
    startScanning,
    stopScanning,
  };
}
