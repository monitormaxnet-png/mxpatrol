import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const isCapacitorBuild = mode === "capacitor";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },

    plugins: [
      react(),
      mode === "development" && componentTagger(),
      !isCapacitorBuild &&
        VitePWA({
          registerType: "autoUpdate",
          devOptions: { enabled: false },
          workbox: {
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            navigateFallbackDenylist: [/^\/~oauth/],
            globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          },
          manifest: false,
        }),
    ].filter(Boolean),

    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },

    esbuild: {
      target: "es2017",
    },

    build: {
      target: "es2017",
      cssTarget: "chrome61",
      minify: isCapacitorBuild ? "esbuild" : false,
      rollupOptions: isCapacitorBuild
        ? {
            output: {
              inlineDynamicImports: true,
              manualChunks: undefined,
            },
          }
        : undefined,
    },
  };
});
