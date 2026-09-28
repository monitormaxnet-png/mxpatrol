import { useState } from "react";
import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Loader2, MapPin, Radio, Smartphone, Tag, XCircle } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { reviewPendingNfcTag } from "@/lib/nfcWorkflow";
import { normalizeNfcUid } from "@/lib/nfcUid";
import {
  pendingCheckpointDeviceIdentity,
  type PendingUnregisteredCheckpointRow,
  usePendingUnregisteredCheckpoints,
} from "@/hooks/usePatrolScanData";

type Props = { siteId?: string | null };

export default function PendingUnregisteredCheckpoints({ siteId = "all" }: Props) {
  const queryClient = useQueryClient();
  const [busyTagUid, setBusyTagUid] = useState<string | null>(null);
  const [selected, setSelected] = useState<PendingUnregisteredCheckpointRow | null>(null);
  const [pendingRegistration, setPendingRegistration] = useState<PendingUnregisteredCheckpointRow | null>(null);
  const [checkpointName, setCheckpointName] = useState("");
  const { data: pending = [], isLoading, error, refetch } = usePendingUnregisteredCheckpoints(30, siteId ?? "all");
  const active = selected ?? pending[0] ?? null;

  const openRegisterDialog = (tag: PendingUnregisteredCheckpointRow) => {
    setPendingRegistration(tag);
    setCheckpointName(`Checkpoint ${tag.tag_uid.slice(-6).toUpperCase()}`);
  };

  const refreshAfterDecision = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pending_unregistered_checkpoints"] }),
      queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] }),
      queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags_count"] }),
      queryClient.invalidateQueries({ queryKey: ["checkpoints"] }),
      queryClient.invalidateQueries({ queryKey: ["scan_logs"] }),
      queryClient.invalidateQueries({ queryKey: ["session_scan_logs"] }),
      queryClient.invalidateQueries({ queryKey: ["live_patrol_scans"] }),
      queryClient.invalidateQueries({ queryKey: ["device_trails"] }),
      queryClient.invalidateQueries({ queryKey: ["scan_map_events"] }),
      queryClient.invalidateQueries({ queryKey: ["alerts"] }),
    ]);
    void refetch();
  };

  const findPendingTagId = async (tag: PendingUnregisteredCheckpointRow) => {
    const normalizedTagUid = normalizeNfcUid(tag.tag_uid);
    const { data, error: pendingTagError } = await supabase
      .from("pending_nfc_tags")
      .select("id")
      .eq("company_id", tag.company_id)
      .eq("tag_uid", normalizedTagUid)
      .eq("status", "pending")
      .order("last_seen_at", { ascending: false })
      .limit(1);
    if (pendingTagError) {
      console.warn("[Pending Tags] pending_nfc_tags unavailable; falling back to scan_logs", pendingTagError);
      return null;
    }
    return data?.[0]?.id ?? null;
  };

  const registerFromScanRow = async (tag: PendingUnregisteredCheckpointRow, name: string) => {
    const normalizedTagUid = normalizeNfcUid(tag.tag_uid);
    const { data: existingCheckpoints, error: existingCheckpointError } = await supabase
      .from("checkpoints")
      .select("id")
      .eq("company_id", tag.company_id)
      .eq("nfc_tag_id", normalizedTagUid)
      .limit(1);
    if (existingCheckpointError) throw existingCheckpointError;

    let checkpointId = existingCheckpoints?.[0]?.id ?? null;

    if (!checkpointId) {
      const { data: checkpoint, error: checkpointError } = await supabase
        .from("checkpoints")
        .insert({
          company_id: tag.company_id,
          site_id: tag.site_id,
          name,
          nfc_tag_id: normalizedTagUid,
          location_lat: tag.gps_lat,
          location_lng: tag.gps_lng,
          sort_order: 0,
          status: "active",
        })
        .select("id")
        .single();
      if (checkpointError) throw checkpointError;
      checkpointId = checkpoint.id;
    }

    const { error: scanUpdateError } = await supabase
      .from("scan_logs")
      .update({ checkpoint_id: checkpointId, tag_status: "registered" } as never)
      .eq("company_id", tag.company_id)
      .is("checkpoint_id", null)
      .eq("tag_uid", normalizedTagUid);
    if (scanUpdateError) throw scanUpdateError;
  };

  const registerPendingCheckpoint = async () => {
    if (!pendingRegistration) return;
    const name = checkpointName.trim();
    if (!name) {
      toast.error("Checkpoint name is required");
      return;
    }

    const tag = pendingRegistration;
    setBusyTagUid(tag.tag_uid);
    try {
      const pendingTagId = await findPendingTagId(tag);
      if (pendingTagId) {
        await reviewPendingNfcTag({ pendingTagId, decision: "approved", checkpointName: name });
      } else {
        await registerFromScanRow(tag, name);
      }

      toast.success("Checkpoint registered");
      setSelected(null);
      setPendingRegistration(null);
      setCheckpointName("");
      await refreshAfterDecision();
    } catch (registerError) {
      console.error("[Pending Tags] Checkpoint registration failed", registerError);
      toast.error(registerError instanceof Error ? registerError.message : "Checkpoint registration failed");
    } finally {
      setBusyTagUid(null);
    }
  };

  const ignorePendingCheckpoint = async (tag: PendingUnregisteredCheckpointRow) => {
    if (!window.confirm("Ignore this unregistered NFC tag? Historical scan logs will be kept.")) return;
    setBusyTagUid(tag.tag_uid);
    try {
      const pendingTagId = await findPendingTagId(tag);
      if (pendingTagId) {
        await reviewPendingNfcTag({ pendingTagId, decision: "rejected", rejectionReason: "Ignored from Command Center" });
      } else {
        const normalizedTagUid = normalizeNfcUid(tag.tag_uid);
        const { error: scanUpdateError } = await supabase
          .from("scan_logs")
          .update({ tag_status: "rejected" } as never)
          .eq("company_id", tag.company_id)
          .is("checkpoint_id", null)
          .eq("tag_uid", normalizedTagUid);
        if (scanUpdateError) throw scanUpdateError;
      }
      toast.success("Pending tag ignored");
      setSelected(null);
      await refreshAfterDecision();
    } catch (ignoreError) {
      console.error("[Pending Tags] Ignore failed", ignoreError);
      toast.error(ignoreError instanceof Error ? ignoreError.message : "Could not ignore pending tag");
    } finally {
      setBusyTagUid(null);
    }
  };

  return (
    <>
      <div className="glass-card grid min-h-[360px] overflow-hidden xl:grid-cols-[0.9fr_1.1fr]">
        <section className="border-b border-border/50 xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
            <div>
              <h3 className="font-heading text-sm font-semibold text-foreground">Pending Unregistered Checkpoints</h3>
              <p className="text-[11px] text-muted-foreground">Unknown NFC tags scanned by patrol devices</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-medium text-warning">
              <Radio className="h-3 w-3" /> {pending.length} Pending
            </span>
          </div>

          {isLoading && <State icon={Loader2} spin text="Loading pending tags..." />}
          {!isLoading && error && <State icon={AlertCircle} destructive text="Pending unregistered checkpoints could not be loaded." />}
          {!isLoading && !error && !pending.length && <State icon={Tag} text="No unknown NFC tags are waiting for registration." />}

          {!isLoading && !error && !!pending.length && (
            <div className="max-h-[430px] space-y-2 overflow-y-auto p-3">
              {pending.map((tag) => (
                <button
                  key={tagKey(tag)}
                  type="button"
                  onClick={() => setSelected(tag)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${active && normalizeNfcUid(active.tag_uid) === normalizeNfcUid(tag.tag_uid) ? "border-warning/50 bg-warning/[0.08]" : "border-border/60 bg-background/80 hover:border-warning/40 hover:bg-warning/[0.05]"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs font-bold text-foreground">UID {shortUid(tag.tag_uid)}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{tag.sites?.name ?? "Unassigned site"} - {pendingCheckpointDeviceIdentity(tag)}</span>
                    </span>
<span className="shrink-0 rounded-full bg-warning/15 px-2 py-1 text-[10px] font-bold uppercase text-warning">Pending</span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Last seen {formatDateTime(tag.scanned_at)}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-[320px] p-5">
          {!active ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Tag className="mb-2 h-7 w-7" />
              Select a pending tag to review it.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-3">
                <span className="inline-flex items-center gap-2 text-sm font-bold text-warning"><AlertTriangle className="h-4 w-4" /> Unregistered Checkpoint</span>
<span className="rounded-full bg-warning/15 px-2 py-1 text-[10px] font-semibold uppercase text-warning">{active.tag_status}</span>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <Detail icon={Tag} label="NFC UID" value={active.tag_uid} highlight mono />
                <Detail icon={MapPin} label="Site" value={active.sites?.name ?? "Unassigned"} />
                <Detail icon={Smartphone} label="Device" value={pendingCheckpointDeviceIdentity(active)} />
                <Detail icon={Calendar} label="Last Seen" value={formatDateTime(active.scanned_at)} />
                <Detail icon={Clock} label="Recorded" value={formatDateTime(active.scanned_at)} />
                <Detail icon={MapPin} label="Coordinates" value={coordinates(active)} warning={active.gps_lat == null || active.gps_lng == null} mono />
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 text-sm text-muted-foreground">
                Registering creates a canonical checkpoint and links matching historical unregistered scans. Ignoring keeps history but removes this UID from the active pending list.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => openRegisterDialog(active)} disabled={busyTagUid === active.tag_uid}>
                  {busyTagUid === active.tag_uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Register Checkpoint
                </Button>
                <Button type="button" variant="outline" onClick={() => void ignorePendingCheckpoint(active)} disabled={busyTagUid === active.tag_uid}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Ignore / Dismiss
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!pendingRegistration} onOpenChange={(open) => { if (!open) setPendingRegistration(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register checkpoint</DialogTitle>
            <DialogDescription>Create a checkpoint from this pending NFC tag and update matching scan logs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>NFC Tag UID</Label>
              <Input value={pendingRegistration?.tag_uid ?? ""} readOnly className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pending-checkpoint-name">Checkpoint name</Label>
              <Input id="pending-checkpoint-name" value={checkpointName} onChange={(event) => setCheckpointName(event.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRegistration(null)}>Cancel</Button>
            <Button type="button" onClick={() => void registerPendingCheckpoint()} disabled={!checkpointName.trim() || busyTagUid === pendingRegistration?.tag_uid}>
              {busyTagUid === pendingRegistration?.tag_uid && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function tagKey(tag: PendingUnregisteredCheckpointRow) {
  return `${normalizeNfcUid(tag.tag_uid)}-${tag.site_id ?? "site"}`;
}

function shortUid(uid: string) {
  return uid.length > 8 ? `...${uid.slice(-8).toUpperCase()}` : uid.toUpperCase();
}

function formatDateTime(value: string) {
  return format(new Date(value), "yyyy-MM-dd HH:mm");
}

function coordinates(tag: PendingUnregisteredCheckpointRow) {
  return tag.gps_lat != null && tag.gps_lng != null ? `${tag.gps_lng.toFixed(6)}, ${tag.gps_lat.toFixed(6)}` : "Unavailable";
}

function State({ icon: Icon, text, spin, destructive }: { icon: typeof Tag; text: string; spin?: boolean; destructive?: boolean }) {
  return (
    <div className={`flex min-h-[240px] flex-col items-center justify-center px-6 text-center text-sm ${destructive ? "text-destructive" : "text-muted-foreground"}`}>
      <Icon className={`mb-2 h-6 w-6 ${spin ? "animate-spin" : ""}`} />
      {text}
    </div>
  );
}

function Detail({ icon: Icon, label, value, highlight, warning, mono }: { icon: typeof Radio; label: string; value: string; highlight?: boolean; warning?: boolean; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/35 bg-muted/15 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <p className={`truncate font-semibold ${warning ? "text-warning" : highlight ? "text-warning" : "text-foreground"} ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</p>
    </div>
  );
}
