import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Copy, Loader2, RefreshCw, QrCode, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppAuthorizedNumbers } from "@/hooks/useWhatsAppData";
import { toast } from "@/hooks/use-toast";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const SANDBOX_STORAGE_KEY = "mx-whatsapp-sandbox-setup";

type StepState = "done" | "pending";

function SandboxJoinQr() {
  const [sandboxNumber, setSandboxNumber] = useState("+14155238886");
  const [joinCode, setJoinCode] = useState("");
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SANDBOX_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { sandboxNumber?: string; joinCode?: string };
      if (saved.sandboxNumber) setSandboxNumber(saved.sandboxNumber);
      if (saved.joinCode) setJoinCode(saved.joinCode);
    } catch {
      /* ignore malformed cache */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({ sandboxNumber, joinCode }));
  }, [sandboxNumber, joinCode]);

  const digits = sandboxNumber.replace(/[^\d]/g, "");
  const message = joinCode.trim().toLowerCase().startsWith("join")
    ? joinCode.trim()
    : `join ${joinCode.trim()}`;
  const ready = digits.length >= 8 && joinCode.trim().length > 1;
  const waLink = ready ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(waLink);
      toast({ title: "Link copied", description: "Open it on your phone to join the sandbox." });
    } catch {
      toast({ title: "Copy failed", description: "Copy the link manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Sandbox number</Label>
          <Input
            value={sandboxNumber}
            onChange={(e) => setSandboxNumber(e.target.value)}
            placeholder="+14155238886"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Join code</Label>
          <Input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="able-tiger"
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!ready} onClick={() => setShowQr((v) => !v)}>
          <QrCode className="mr-1.5 h-3.5 w-3.5" />
          {showQr ? "Hide QR" : "Show QR"}
        </Button>
        <Button size="sm" variant="outline" disabled={!ready} asChild={ready}>
          {ready ? (
            <a href={waLink} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open WhatsApp
            </a>
          ) : (
            <span>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open WhatsApp
            </span>
          )}
        </Button>
        <Button size="sm" variant="ghost" disabled={!ready} onClick={copyLink}>
          <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link
        </Button>
      </div>

      {!ready && (
        <p className="text-[11px] text-muted-foreground">
          Enter the sandbox number and join code from Twilio to generate the QR code.
        </p>
      )}

      {ready && showQr && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-background p-4">
          <QRCodeSVG value={waLink} size={168} bgColor="transparent" fgColor="hsl(var(--foreground))" level="M" />
          <p className="text-[11px] text-muted-foreground">Scan with your phone camera, then send the prefilled message.</p>
          <code className="break-all text-center text-[10px] font-mono text-muted-foreground">{waLink}</code>
        </div>
      )}
    </div>
  );
}


const useWhatsAppOnboardingSignals = () => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["whatsapp-onboarding-signals"],
    queryFn: async () => {
      const [inbound, conversations, joinEvent] = await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select("id, created_at")
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("whatsapp_conversations")
          .select("id, phone_number, updated_at")
          .order("updated_at", { ascending: false })
          .limit(1),
        // The very first inbound message is the sandbox join confirmation event.
        supabase
          .from("whatsapp_messages")
          .select("id, created_at, message_body, metadata, whatsapp_conversations(phone_number)")
          .eq("direction", "inbound")
          .order("created_at", { ascending: true })
          .limit(1),
      ]);

      if (inbound.error) throw inbound.error;
      if (conversations.error) throw conversations.error;
      if (joinEvent.error) throw joinEvent.error;

      const je = joinEvent.data?.[0] as
        | {
            id: string;
            created_at: string;
            message_body: string | null;
            metadata: Record<string, unknown> | null;
            whatsapp_conversations?: { phone_number: string } | null;
          }
        | undefined;

      return {
        lastInbound: inbound.data?.[0] ?? null,
        lastConversation: conversations.data?.[0] ?? null,
        joinEvent: je
          ? {
              id: je.id,
              createdAt: je.created_at,
              body: je.message_body ?? "",
              sender:
                je.whatsapp_conversations?.phone_number ??
                (typeof je.metadata?.from === "string" ? (je.metadata.from as string) : "unknown"),
            }
          : null,
      };

    },
    // Poll fast while setup is incomplete, slow down once both signals landed.
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.lastInbound && d?.lastConversation ? 30000 : 4000;
    },
    refetchOnWindowFocus: true,
  });

  // Realtime: flip Step 1/2 the moment the sandbox join message arrives.
  useEffect(() => {
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ["whatsapp-onboarding-signals"] });

    const channel = supabase
      .channel("whatsapp-onboarding-signals")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_authorized_numbers" }, () => {
        queryClient.invalidateQueries({ queryKey: ["whatsapp-authorized-numbers"] });
        invalidate();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
};


function StepRow({
  index,
  title,
  state,
  description,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  description: string;
  children?: React.ReactNode;
}) {
  const done = state === "done";
  return (
    <div className="flex gap-3 rounded-lg border border-border/50 bg-slate-950/30 p-3">
      <div className="mt-0.5 shrink-0">
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-success" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground/60" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            Step {index}: {title}
          </p>
          <Badge variant={done ? "default" : "secondary"} className="text-[9px]">
            {done ? "Complete" : "Waiting"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

const SETUP_COMPLETE_MARKER = "WhatsApp setup complete";

export function WhatsAppOnboardingChecklist() {
  const { data: numbers = [], isLoading: numbersLoading } = useWhatsAppAuthorizedNumbers();
  const { data: signals, isLoading: signalsLoading, refetch, isFetching } = useWhatsAppOnboardingSignals();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const announcedRef = useRef(false);

  const activeNumbers = numbers.filter((n) => n.status === "active" && n.phone);
  const webhookDone = Boolean(signals?.lastInbound);
  const sandboxDone = Boolean(signals?.lastConversation);
  const numberDone = activeNumbers.length > 0;
  const completed = [webhookDone, sandboxDone, numberDone].filter(Boolean).length;
  const allDone = webhookDone && sandboxDone && numberDone;

  // Notify the team once, the first time all three steps are green.
  useEffect(() => {
    if (!allDone || announcedRef.current) return;
    announcedRef.current = true;

    const announce = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) return;

        // Skip if we already logged this for the company.
        const { data: existing } = await supabase
          .from("alerts")
          .select("id")
          .eq("company_id", profile.company_id)
          .ilike("message", `${SETUP_COMPLETE_MARKER}%`)
          .limit(1);
        if (existing && existing.length > 0) return;

        const { error } = await supabase.from("alerts").insert({
          company_id: profile.company_id,
          type: "anomaly" as const,
          severity: "low" as const,
          message: `${SETUP_COMPLETE_MARKER} | Webhook live, sandbox conversation active, ${activeNumbers.length} authorized number${
            activeNumbers.length === 1 ? "" : "s"
          } (${activeNumbers.map((n) => n.phone).slice(0, 3).join(", ")}). WhatsApp operations are ready to use.`,
        });
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        toast({
          title: "WhatsApp setup complete",
          description: "Your team has been notified in the notification center.",
        });
      } catch {
        announcedRef.current = false;
      }
    };

    void announce();
  }, [allDone, activeNumbers, queryClient]);

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(WEBHOOK_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Copy the URL manually.", variant: "destructive" });
    }
  };

  const loading = numbersLoading || signalsLoading;


  return (
    <Card className="glass-card border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="text-sm font-semibold">
          WhatsApp Setup Checklist
          <span className="ml-2 text-xs font-normal text-muted-foreground">{completed}/3 complete</span>
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="ml-2 hidden sm:inline">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin text-primary" /> Checking setup status...
          </div>
        ) : (
          <>
            <StepRow
              index={1}
              title="Point Twilio at the webhook"
              state={webhookDone ? "done" : "pending"}
              description={
                webhookDone
                  ? `Inbound message received ${new Date(signals!.lastInbound!.created_at).toLocaleString()} — the webhook is live.`
                  : "In Twilio Messaging settings, set “When a message comes in” to POST at the URL below."
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-foreground">
                  {WEBHOOK_URL}
                </code>
                <Button variant="ghost" size="sm" onClick={copyWebhook}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </StepRow>

            <StepRow
              index={2}
              title="Join the WhatsApp sandbox"
              state={sandboxDone ? "done" : "pending"}
              description={
                sandboxDone
                  ? `Conversation active with ${signals!.lastConversation!.phone_number}.`
                  : "Scan the QR code with your phone to open WhatsApp with the join message prefilled. Skip if you use an approved production sender."
              }
            >
              {signals?.joinEvent && (
                <div className="mb-3 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
                  <p className="mb-2 font-medium text-foreground">Join confirmation event</p>
                  <dl className="space-y-1">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground">Timestamp</dt>
                      <dd className="font-mono text-foreground">
                        {new Date(signals.joinEvent.createdAt).toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground">Sender</dt>
                      <dd className="font-mono text-foreground">{signals.joinEvent.sender}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground">Message</dt>
                      <dd className="break-words font-mono text-foreground">
                        {signals.joinEvent.body || <span className="text-muted-foreground">(empty body)</span>}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
              <SandboxJoinQr />

            </StepRow>

            <StepRow
              index={3}
              title="Authorize your number"
              state={numberDone ? "done" : "pending"}
              description={
                numberDone
                  ? `${activeNumbers.length} active number${activeNumbers.length === 1 ? "" : "s"}: ${activeNumbers
                      .map((n) => n.phone)
                      .slice(0, 3)
                      .join(", ")}`
                  : "Open the Authorized Numbers tab and add your number in international format (+27...), or issue a link code. Unauthorized numbers are blocked."
              }
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
