import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, Download, QrCode } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function QRGenerateDialog({ open, onOpenChange }: Props) {
  const [appType, setAppType] = useState<string>("guard_device");
  const [expiryMinutes, setExpiryMinutes] = useState(15);
  const [count, setCount] = useState(1);
  const [generatedTokens, setGeneratedTokens] = useState<
    { token: string; nonce: string; expires_at: string }[]
  >([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("qr-enroll", {
        body: { app_type: appType, expiry_minutes: expiryMinutes, count },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setGeneratedTokens(data.tokens);
      toast.success(`Generated ${data.count} QR token(s)`);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to generate QR tokens");
    },
  });

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    toast.success("Token copied to clipboard");
  };

  const downloadQR = (token: string, index: number) => {
    const svg = document.getElementById(`qr-${index}`);
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx?.drawImage(img, 0, 0, 512, 512);
      const a = document.createElement("a");
      a.download = `enrollment-qr-${index + 1}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setGeneratedTokens([]);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            Generate Enrollment QR
          </DialogTitle>
          <DialogDescription>
            Create QR codes for device self-enrollment. Devices scan the code to register automatically.
          </DialogDescription>
        </DialogHeader>

        {generatedTokens.length === 0 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>App Type</Label>
              <Select value={appType} onValueChange={setAppType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="guard_device">Guard Device</SelectItem>
                  <SelectItem value="admin_app">Admin App</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Expiry (minutes)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={expiryMinutes}
                  onChange={(e) => setExpiryMinutes(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Count</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate {count > 1 ? `${count} QR Codes` : "QR Code"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {appType === "guard_device" ? "Guard Device" : "Admin App"}
              </Badge>
              <Badge variant="outline">{generatedTokens.length} tokens</Badge>
            </div>

            <div className="grid gap-4">
              {generatedTokens.map((t, i) => (
                <div key={i} className="flex flex-col items-center gap-3 rounded-lg border border-border p-4 bg-background">
                  <QRCodeSVG
                    id={`qr-${i}`}
                    value={t.token}
                    size={200}
                    bgColor="transparent"
                    fgColor="hsl(var(--foreground))"
                    level="M"
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Expires: {new Date(t.expires_at).toLocaleString()}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyToken(t.token)}>
                      <Copy className="mr-1 h-3 w-3" /> Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadQR(t.token, i)}>
                      <Download className="mr-1 h-3 w-3" /> Download
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setGeneratedTokens([])}>
                Generate More
              </Button>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
