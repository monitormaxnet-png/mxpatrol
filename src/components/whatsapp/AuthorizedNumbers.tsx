import { useState } from "react";
import { Copy, Loader2, Plus, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  useAuthorizeWhatsAppNumber,
  useRemoveWhatsAppNumber,
  useUpdateWhatsAppNumber,
  useWhatsAppAuthorizedNumbers,
} from "@/hooks/useWhatsAppData";

const statusVariant = (status: string) =>
  status === "active" ? "default" : status === "pending" ? "secondary" : "outline";

export const AuthorizedNumbers = () => {
  const { data: numbers = [], isLoading } = useWhatsAppAuthorizedNumbers();
  const authorize = useAuthorizeWhatsAppNumber();
  const updateNumber = useUpdateWhatsAppNumber();
  const removeNumber = useRemoveWhatsAppNumber();

  const [mode, setMode] = useState<"direct" | "link_code">("direct");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");

  const submit = async () => {
    try {
      const created = await authorize.mutateAsync({ mode, phone, displayName });
      setPhone("");
      setDisplayName("");
      toast({
        title: mode === "direct" ? "Number authorized" : "Link code created",
        description:
          mode === "direct"
            ? `${created.phone} can now use the WhatsApp assistant.`
            : `Share code ${created.link_code} — it expires in 24 hours.`,
      });
    } catch (error) {
      toast({
        title: "Could not authorize number",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="glass-card lg:col-span-1">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Authorize a number
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as "direct" | "link_code")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Authorize a phone number</SelectItem>
                <SelectItem value="link_code">Generate a self-serve link code</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "direct" && (
            <div className="space-y-1.5">
              <Label htmlFor="wa-phone">WhatsApp number</Label>
              <Input
                id="wa-phone"
                placeholder="+27821234567"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={20}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="wa-name">Name</Label>
            <Input
              id="wa-name"
              placeholder="Supervisor name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
            />
          </div>

          <Button className="w-full" onClick={submit} disabled={authorize.isPending}>
            {authorize.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {mode === "direct" ? "Authorize number" : "Create link code"}
          </Button>

          <p className="text-xs text-muted-foreground">
            Link codes let a user send the code from their own WhatsApp to link their number automatically.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <UserCheck className="h-4 w-4" />
            Authorized numbers ({numbers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[520px]">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : numbers.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No numbers authorized yet. Only authorized numbers can use the WhatsApp assistant.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {numbers.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {row.phone ?? row.link_code ?? "Pending link"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.display_name ?? "Unnamed"}
                        {row.link_code && !row.phone ? ` · code ${row.link_code}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                      {row.link_code && !row.phone && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            navigator.clipboard?.writeText(row.link_code!);
                            toast({ title: "Link code copied" });
                          }}
                          aria-label="Copy link code"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateNumber.mutate({ id: row.id, status: row.status === "active" ? "revoked" : "active" })
                        }
                      >
                        {row.status === "active" ? "Revoke" : "Activate"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeNumber.mutate(row.id)}
                        aria-label="Remove number"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
