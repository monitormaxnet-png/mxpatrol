import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.tsx";
import "./index.css";

const isNativeAndroid =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

// Polyfill crypto.randomUUID for old Android WebViews (RG360 fix)
(function () {
  if (!isNativeAndroid || !window.crypto || !window.crypto.getRandomValues) return;

  if (!window.crypto.randomUUID) {
    window.crypto.randomUUID = function () {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);

      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      const hex = [...bytes].map(b => b.toString(16).padStart(2, "0"));

      return (
        hex.slice(0, 4).join("") + "-" +
        hex.slice(4, 6).join("") + "-" +
        hex.slice(6, 8).join("") + "-" +
        hex.slice(8, 10).join("") + "-" +
        hex.slice(10, 16).join("")
      ) as `${string}-${string}-${string}-${string}-${string}`;
    };
  }
})();

if (isNativeAndroid) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(reg => reg.unregister());
    });
  }

  if ("caches" in window) {
    caches.keys().then(keys => {
      keys.forEach(key => caches.delete(key));
    });
  }

  window.onerror = function (msg, source, lineno, colno, error) {
    const message = typeof msg === "string" ? msg : String(msg);
    const isEarlyBridgeEvent = message.includes("triggerEvent") && message.includes("undefined");

    if (isEarlyBridgeEvent) {
      console.warn("[AndroidStartup] Ignored early Capacitor bridge event", { message, source, lineno, colno, error });
      return true;
    }

    console.error("[AndroidStartup] Unhandled window error", { message, source, lineno, colno, error });
    document.body.innerHTML = `
      <div style="color:white;padding:20px;">
        <h2>App Crash</h2>
        <p>${message}</p>
      </div>
    `;
    return true;
  };
}

// PWA: Prevent service worker registration in Lovable preview/iframe
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (!isNativeAndroid && (isPreviewHost || isInIframe)) {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((r) => r.unregister());
    });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
