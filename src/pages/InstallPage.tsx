import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Download, Smartphone, CheckCircle2, Share, MoreVertical,
  ArrowDown, Monitor, Apple, Chrome,
} from "lucide-react";

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) setPlatform("ios");
    else if (/Android/i.test(ua)) setPlatform("android");
    else setPlatform("desktop");

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setIsInstalled(true));

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") setIsInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full space-y-6"
      >
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Install SENTINEL</h1>
          <p className="text-sm text-muted-foreground">
            Install the app on your device for quick access, offline support, and a native experience.
          </p>
        </div>

        {isInstalled ? (
          <Card className="border-success/50">
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <p className="text-lg font-bold text-foreground">Already Installed!</p>
              <p className="text-sm text-muted-foreground text-center">
                SENTINEL is installed on this device. Open it from your home screen.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Direct install button (Chrome/Edge/Android) */}
            {deferredPrompt && (
              <Button size="lg" className="w-full text-base gap-2" onClick={handleInstall}>
                <Download className="h-5 w-5" /> Install SENTINEL
              </Button>
            )}

            {/* Platform-specific instructions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  {platform === "ios" && <Apple className="h-5 w-5" />}
                  {platform === "android" && <Chrome className="h-5 w-5" />}
                  {platform === "desktop" && <Monitor className="h-5 w-5" />}
                  {platform === "ios" ? "Install on iPhone/iPad" : platform === "android" ? "Install on Android" : "Install on Desktop"}
                </CardTitle>
                <CardDescription>Follow these steps:</CardDescription>
              </CardHeader>
              <CardContent>
                {platform === "ios" ? (
                  <ol className="space-y-4 text-sm text-muted-foreground">
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">1</Badge>
                      <span>Tap the <Share className="inline h-4 w-4 mx-1 text-primary" /> Share button in Safari's toolbar</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">2</Badge>
                      <span>Scroll down and tap <strong className="text-foreground">"Add to Home Screen"</strong></span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">3</Badge>
                      <span>Tap <strong className="text-foreground">"Add"</strong> to confirm</span>
                    </li>
                  </ol>
                ) : platform === "android" ? (
                  <ol className="space-y-4 text-sm text-muted-foreground">
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">1</Badge>
                      <span>Tap the <MoreVertical className="inline h-4 w-4 mx-1 text-primary" /> menu in Chrome</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">2</Badge>
                      <span>Tap <strong className="text-foreground">"Install app"</strong> or <strong className="text-foreground">"Add to Home screen"</strong></span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">3</Badge>
                      <span>Tap <strong className="text-foreground">"Install"</strong> to confirm</span>
                    </li>
                  </ol>
                ) : (
                  <ol className="space-y-4 text-sm text-muted-foreground">
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">1</Badge>
                      <span>Look for the <ArrowDown className="inline h-4 w-4 mx-1 text-primary" /> install icon in the browser address bar</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">2</Badge>
                      <span>Click <strong className="text-foreground">"Install"</strong> to add SENTINEL to your desktop</span>
                    </li>
                  </ol>
                )}
              </CardContent>
            </Card>

            {/* Features */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: Smartphone, label: "Native Feel" },
                { icon: Download, label: "Offline Ready" },
                { icon: Shield, label: "Secure" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-3">
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="text-center">
          <Button variant="link" className="text-muted-foreground" onClick={() => window.location.href = "/login"}>
            Continue to Login →
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
