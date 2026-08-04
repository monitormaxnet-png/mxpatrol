import { useState, useCallback, useRef, useEffect } from "react";
import { registerPlugin } from "@capacitor/core";

export type NfcStatus =
  | "idle"
  | "scanning"
  | "success"
  | "saving"
  | "error"
  | "unsupported"
  | "disabled";

type NfcResult = {
  serialNumber: string;
  timestamp: string;
};

type UseNfcReaderOptions = {
  onScan?: (result: NfcResult) => void | Promise<void>;
  debounceMs?: number;
};

const NFC = registerPlugin<any>("CapacitorNfc");

const isNativePlatform = (): boolean =>
  typeof window !== "undefined" &&
  !!(window as any)?.Capacitor?.isNativePlatform?.();

const hasWebNfc = (): boolean =>
  typeof window !== "undefined" && "NDEFReader" in window;

const bytesToHex = (bytes: number[] | Uint8Array) =>
  Array.from(bytes)
    .map((b) => (b & 0xff).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function useNfcReader({
  onScan,
  debounceMs = 3000,
}: UseNfcReaderOptions = {}) {
  const [status, setStatus] = useState<NfcStatus>("idle");
  const [lastTag, setLastTag] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onScanRef = useRef(onScan);
  const lastScanRef = useRef<{ tag: string; time: number } | null>(null);
  const listenersRef = useRef<any[]>([]);
  const webAbortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const startingRef = useRef(false);

  const native = isNativePlatform();
  const supported = native || hasWebNfc();

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const handleTag = useCallback(
    (tag: string) => {
      const now = Date.now();

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

      void onScanRef.current?.({
        serialNumber: tag,
        timestamp: new Date().toISOString(),
      });

      window.setTimeout(() => {
        if (startedRef.current) setStatus("scanning");
      }, 1200);
    },
    [debounceMs]
  );

  const parseEvent = useCallback(
    (event: any) => {
      try {
        console.log(`[NFC RAW EVENT] ${safeStringify(event)}`);

        let uid: string | null = null;
        const tagId = event?.tag?.id;
        if (Array.isArray(tagId) || tagId instanceof Uint8Array) {
          uid = bytesToHex(tagId);
        }

        if (!uid) {
          const raw =
            event?.tagInfo?.id ??
            event?.tagInfo?.uid ??
            event?.id ??
            event?.uid ??
            event?.serialNumber;

          if (Array.isArray(raw) || raw instanceof Uint8Array) {
            uid = bytesToHex(raw);
          } else if (typeof raw === "string") {
            uid = raw.replace(/:/g, "").toUpperCase().trim();
          }
        }

        if (!uid || uid.length < 4) {
          console.warn(`[NFC] UID extraction failed ${safeStringify(event)}`);
          setStatus("error");
          setErrorMessage("Could not read NFC tag");
          window.setTimeout(() => {
            if (startedRef.current) setStatus("scanning");
          }, 1500);
          return;
        }

        console.log(`[NFC UID FINAL] ${uid}`);
        handleTag(uid);
      } catch (e) {
        console.error("[NFC PARSE ERROR]", e);
        setStatus("error");
        setErrorMessage("NFC parse error");
      }
    },
    [handleTag]
  );

  const startNative = useCallback(async () => {
    if (startedRef.current || startingRef.current) return;
    startingRef.current = true;

    try {
      setStatus("scanning");
      setErrorMessage(null);

      const supportedRes = await NFC.isSupported?.();
      console.log("[NFC supported]", supportedRes);

      if (supportedRes === false || supportedRes?.supported === false) {
        setStatus("unsupported");
        setErrorMessage("Device does not support NFC");
        return;
      }

      if (listenersRef.current.length === 0) {
        const listener = await NFC.addListener("nfcEvent", parseEvent);
        listenersRef.current = [listener];
      }

      await NFC.startScanning({});
      startedRef.current = true;
      console.log("[NFC] scan started");
    } catch (err: any) {
      console.error("[NFC START ERROR]", err);
      console.error("[NFC START ERROR FULL]", safeStringify(err));
      setStatus("error");
      setErrorMessage(err?.message || "NFC start failed");
      startedRef.current = false;
    } finally {
      startingRef.current = false;
    }
  }, [parseEvent]);

  const startWeb = useCallback(async () => {
    if (startedRef.current || startingRef.current) return;
    startingRef.current = true;

    try {
      setStatus("scanning");
      setErrorMessage(null);

      const ndef = new (window as any).NDEFReader();
      const controller = new AbortController();
      webAbortRef.current = controller;

      await ndef.scan({ signal: controller.signal });
      ndef.addEventListener("reading", ({ serialNumber }: any) => {
        if (serialNumber) handleTag(serialNumber);
      });

      startedRef.current = true;
    } catch (err: any) {
      console.error("[WEB NFC ERROR]", err);
      setStatus("error");
      setErrorMessage(err?.message || "Web NFC failed");
      startedRef.current = false;
    } finally {
      startingRef.current = false;
    }
  }, [handleTag]);

  const startScanning = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    if (native) await startNative();
    else await startWeb();
  }, [native, supported, startNative, startWeb]);

  const stopScanning = useCallback(async () => {
    startingRef.current = false;
    startedRef.current = false;

    webAbortRef.current?.abort();
    webAbortRef.current = null;

    const listeners = listenersRef.current;
    listenersRef.current = [];
    await Promise.all(listeners.map((listener) => Promise.resolve(listener.remove?.()).catch(() => undefined)));

    if (native) {
      try {
        await NFC.stopScanning();
      } catch {}
    }

    setStatus("idle");
  }, [native]);

  useEffect(() => {
    return () => {
      void stopScanning();
    };
  }, [stopScanning]);

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