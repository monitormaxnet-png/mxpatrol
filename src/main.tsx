import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Detect runtime environment
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

const isCapacitorNative = (() => {
  const cap = (window as any).Capacitor;
  return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
})();

// Kill service workers + cached responses inside iframe, preview hosts, AND
// the Capacitor WebView. The PWA service worker registered on
// mxpatrol.lovable.app can serve stale assets or hijack navigation inside the
// APK, leaving a blank screen. Always start the native shell from a clean slate.
if (isPreviewHost || isInIframe || isCapacitorNative) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((r) => r.unregister().catch(() => {}));
    }).catch(() => {});
  }
  if ("caches" in window) {
    caches.keys().then((keys) => {
      keys.forEach((k) => caches.delete(k).catch(() => {}));
    }).catch(() => {});
  }
}

// Visible boot-error fallback — if React fails to mount inside the WebView we
// at least see *something* instead of a blank screen. Logs to console so it
// shows up in `adb logcat | grep -i chromium`.
const rootEl = document.getElementById("root");
try {
  if (!rootEl) throw new Error("Root element #root not found in DOM");
  createRoot(rootEl).render(<App />);
  console.log("[boot] React app mounted", {
    href: window.location.href,
    isCapacitorNative,
    userAgent: navigator.userAgent,
  });
} catch (err) {
  console.error("[boot] Fatal mount error:", err);
  if (rootEl) {
    rootEl.innerHTML = `
      <div style="font-family:system-ui;padding:24px;color:#fff;background:#0b1220;min-height:100vh;">
        <h1 style="color:#22d3ee;margin:0 0 12px;font-size:20px;">SENTINEL — boot error</h1>
        <p style="margin:0 0 8px;">The web app failed to start inside the WebView.</p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#111827;padding:12px;border-radius:8px;font-size:12px;">${
          (err as Error)?.stack || String(err)
        }</pre>
        <p style="margin-top:12px;font-size:12px;opacity:.7;">URL: ${window.location.href}</p>
      </div>
    `;
  }
}
