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

// Detect Capacitor native runtime
const isNativePlatform = (): boolean => {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
};

const hasWebNfc = (): boolean => {
  return typeof window !== "undefined" && "NDEFReader" in window;
};

export function useNfcReader({ onScan, debounceMs = 3000 }: UseNfcReaderOptions = {}) {
  const [status, setStatus] = useState<NfcStatus>("idle");
  const [lastTag, setLastTag] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastScanRef = useRef<{ tag: string; time: number } | null>(null);
  const nativeUnsubsRef = useRef<Array<() => void>>([]);

  const native = isNativePlatform();
  const supported = native || hasWebNfc();

  const handleTag = useCallback(
    (tag: string) => {
      const now = Date.now();
      const safeTag = tag || "unknown";

      if (
        lastScanRef.current &&
        lastScanRef.current.tag === safeTag &&
        now - lastScanRef.current.time < debounceMs
      ) {
        return;
      }

      lastScanRef.current = { tag: safeTag, time: now };
      setLastTag(safeTag);
      setStatus("success");

      onScan?.({
        serialNumber: safeTag,
        timestamp: new Date().toISOString(),
      });

      setTimeout(() => setStatus("scanning"), 2500);
    },
    [debounceMs, onScan]
  );

  const startNative = useCallback(async () => {
    try {
      setStatus("scanning");
      setErrorMessage(null);

      // Lazy import so web bundle doesn't crash if plugin missing
      const mod: any = await import("@exxili/capacitor-nfc");
      const NFC = mod.NFC ?? mod.default ?? mod;

      const supportedRes = await NFC.isSupported?.();
      if (supportedRes && supportedRes.supported === false) {
        setStatus("unsupported");
        setErrorMessage("This device does not support NFC.");
        return;
      }

      // Clean any prior listeners
      nativeUnsubsRef.current.forEach((fn) => fn());
      nativeUnsubsRef.current = [];

      // onRead returns an unsubscribe
      const offRead = NFC.onRead((data: any) => {
        try {
          const parsed = data?.string?.() ?? data;
          const uid = parsed?.tagInfo?.uid;
          // Prefer tag UID; fall back to first text record payload
          let tag = uid;
          if (!tag) {
            const records = parsed?.messages?.[0]?.records;
            if (records && records.length) {
              const payload = records[0]?.payload;
              if (typeof payload === "string") tag = payload;
            }
          }
          if (tag) handleTag(String(tag));
        } catch (e) {
          // Ignore parse errors per scan
        }
      });
      nativeUnsubsRef.current.push(offRead);

      const offError = NFC.onError((err: any) => {
        setStatus("error");
        setErrorMessage(err?.error || "NFC read failed");
        setTimeout(() => setStatus("scanning"), 2000);
      });
      nativeUnsubsRef.current.push(offError);

      await NFC.startScan({ mode: "auto" });
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err?.message || "Failed to start native NFC scan");
    }
  }, [handleTag]);

  const startWeb = useCallback(async () => {
    try {
      setStatus("scanning");
      setErrorMessage(null);

      const ndef = new (window as any).NDEFReader();
      const controller = new AbortController();
      abortRef.current = controller;

      await ndef.scan({ signal: controller.signal });

      ndef.addEventListener(
        "reading",
        ({ serialNumber }: any) => {
          handleTag(serialNumber || "unknown");
        },
        { signal: controller.signal }
      );

      ndef.addEventListener(
        "readingerror",
        () => {
          setStatus("error");
          setErrorMessage("Failed to read NFC tag. Try again.");
          setTimeout(() => setStatus("scanning"), 2000);
        },
        { signal: controller.signal }
      );
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
  }, [handleTag]);

  const startScanning = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      setErrorMessage(
        "NFC not available in this browser. Use the native app, or open in Chrome on Android."
      );
      return;
    }

    if (native) {
      await startNative();
    } else {
      await startWeb();
    }
  }, [supported, native, startNative, startWeb]);

  const stopScanning = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    // Clean up native listeners and try to cancel scan
    nativeUnsubsRef.current.forEach((fn) => fn());
    nativeUnsubsRef.current = [];

    if (native) {
      import("@exxili/capacitor-nfc")
        .then((mod: any) => {
          const NFC = mod.NFC ?? mod.default ?? mod;
          NFC.cancelScan?.().catch(() => {});
        })
        .catch(() => {});
    }

    setStatus("idle");
  }, [native]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      nativeUnsubsRef.current.forEach((fn) => fn());
      nativeUnsubsRef.current = [];
    };
  }, []);

  return {
    status,
    lastTag,
    errorMessage,
    supported,
    isNative: native,
    startScanning,
    stopScanning,
  };
}
