import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Copy, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppAuthorizedNumbers } from "@/hooks/useWhatsAppData";
import { toast } from "@/hooks/use-toast";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

type StepState = "done" | "pending";

const useWhatsAppOnboardingSignals = () => {
  return useQuery({
    queryKey: ["whatsapp-onboarding-signals"],
    queryFn: async () => {
      const [inbound, conversations] = await Promise.all([
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
      ]);

      if (inbound.error) throw inbound.error;
      if (conversations.error) throw conversations.error;

      return {
        lastInbound: inbound.data?.[0] ?? null,
        lastConversation: conversations.data?.[0] ?? null,
      };
    },
    refetchInterval: 15000,
  });
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

export function WhatsAppOnboardingChecklist() {
  const { data: numbers = [], isLoading: numbersLoading } = useWhatsAppAuthorizedNumbers();
  const { data: signals, isLoading: signalsLoading, refetch, isFetching } = useWhatsAppOnboardingSignals();
  const [copied, setCopied] = useState(false);

  const activeNumbers = numbers.filter((n) => n.status === "active" && n.phone);
  const webhookDone = Boolean(signals?.lastInbound);
  const sandboxDone = Boolean(signals?.lastConversation);
  const numberDone = activeNumbers.length > 0;
  const completed = [webhookDone, sandboxDone, numberDone].filter(Boolean).length;

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
                  : "Send the Twilio sandbox join code (e.g. “join able-tiger”) from your phone to the sandbox number. Skip if you use an approved production sender."
              }
            />

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
