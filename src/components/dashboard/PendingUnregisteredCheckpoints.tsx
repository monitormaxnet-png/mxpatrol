import { useState } from "react";
import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Loader2, MapPin, Radio, Smartphone, Tag } from "lucide-react";
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

export default function PendingUnregisteredCheckpoints() {
  const queryClient = useQueryClient();
  const [registeringTagUid, setRegisteringTagUid] = useState<string | null>(null);
  const [pendingRegistration, setPendingRegistration] = useState<PendingUnregisteredCheckpointRow | null>(null);
  const [checkpointName, setCheckpointName] = useState("");
  const { data: pending = [], isLoading, error, refetch } = usePendingUnregisteredCheckpoints(20, "all");
  const latestPending = pending[0];

  const openRegisterDialog = (tag: PendingUnregisteredCheckpointRow) => {
    setPendingRegistration(tag);
    setCheckpointName(`Checkpoint ${tag.tag_uid.slice(-6).toUpperCase()}`);
  };

  const refreshAfterRegistration = async () => {
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
    setRegisteringTagUid(tag.tag_uid);
    try {
      const normalizedTagUid = normalizeNfcUid(tag.tag_uid);
      const { data: pendingTags, error: pendingTagError } = await supabase
        .from("pending_nfc_tags")
        .select("id")
        .eq("company_id", tag.company_id)
        .eq("tag_uid", normalizedTagUid)
        .eq("status", "pending")
        .order("last_seen_at", { ascending: false })
        .limit(1);

      if (pendingTagError) {
        console.warn("[Pending Tags] pending_nfc_tags unavailable; registering from scan_logs", pendingTagError);
      }

      const pendingTag = pendingTagError ? undefined : pendingTags?.[0];
      if (pendingTag) {
        await reviewPendingNfcTag({
          pendingTagId: pendingTag.id,
          decision: "approved",
          checkpointName: name,
        });
      } else {
        await registerFromScanRow(tag, name);
      }

      console.info("[Pending Tags] Checkpoint registered", {
        company_id: tag.company_id,
        site_id: tag.site_id,
        tag_uid: normalizedTagUid,
        checkpoint_name: name,
      });

      toast.success("Checkpoint registered");
      setPendingRegistration(null);
      setCheckpointName("");
      await refreshAfterRegistration();
    } catch (registerError) {
      console.error("[Pending Tags] Checkpoint registration failed", registerError);
      toast.error(registerError instanceof Error ? registerError.message : "Checkpoint registration failed");
    } finally {
      setRegisteringTagUid(null);
    }
  };

  return (
    <>
      <div className="glass-card flex min-h-[320px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
          <div>
            <h3 className="font-heading text-sm font-semibold text-foreground">Pending Unregistered Checkpoints</h3>
            <p className="text-[11px] text-muted-foreground">Newest unknown NFC tag waiting for admin registration</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-medium text-warning">
            <Radio className="h-3 w-3" /> {pending.length} Pending
          </span>
        </div>

        {isLoading && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pending tag...
          </div>
        )}

        {!isLoading && error && (
          <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> Pending unregistered checkpoints could not be loaded.
          </div>
        )}

        {!isLoading && !error && !latestPending && (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
            <Tag className="mb-2 h-7 w-7" />
            No unknown NFC tags are waiting for registration.
          </div>
        )}

        {!isLoading && !error && latestPending && (
          <div className="flex flex-1 flex-col gap-4 p-5">
            <div className="rounded-xl border border-warning/25 bg-warning/[0.06] p-4">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/40 pb-3">
                <span className="inline-flex items-center gap-2 text-sm font-bold text-warning"><AlertTriangle className="h-4 w-4" /> Pending Review</span>
                <span className="rounded-full bg-warning/15 px-2 py-1 text-[10px] font-semibold uppercase text-warning">Pending Registration</span>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
                <Detail icon={MapPin} label="Site" value={latestPending.sites?.name ?? "Unassigned"} />
                <Detail icon={Tag} label="Tag UID" value={latestPending.tag_uid} highlight mono />
                <Detail icon={Smartphone} label="Device Identity" value={pendingCheckpointDeviceIdentity(latestPending)} />
                <Detail icon={Calendar} label="Date" value={format(new Date(latestPending.scanned_at), "yyyy-MM-dd")} />
                <Detail icon={Clock} label="Time" value={format(new Date(latestPending.scanned_at), "HH:mm:ss")} />
                <Detail icon={MapPin} label="Coordinates" value={coordinates(latestPending)} warning={latestPending.gps_lat == null || latestPending.gps_lng == null} mono />
              </div>
            </div>
            <div className="border-t border-border/50 pt-4">
              <p className="text-sm font-medium text-foreground">This tag has not been registered.</p>
              <p className="mt-1 text-sm text-muted-foreground">Review and register it to include it in a patrol route.</p>
              <button
                type="button"
                onClick={() => openRegisterDialog(latestPending)}
                disabled={registeringTagUid === latestPending.tag_uid}
                className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-warning/40 bg-warning px-4 text-sm font-bold text-warning-foreground transition hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {registeringTagUid === latestPending.tag_uid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                Review & Register Tag
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!pendingRegistration} onOpenChange={(open) => { if (!open) setPendingRegistration(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register checkpoint</DialogTitle>
            <DialogDescription>
              Create a checkpoint from this pending NFC tag and update matching scan logs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>NFC Tag UID</Label>
              <Input value={pendingRegistration?.tag_uid ?? ""} readOnly className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pending-checkpoint-name">Checkpoint name</Label>
              <Input
                id="pending-checkpoint-name"
                value={checkpointName}
                onChange={(event) => setCheckpointName(event.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRegistration(null)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => void registerPendingCheckpoint()}
              disabled={!checkpointName.trim() || registeringTagUid === pendingRegistration?.tag_uid}
            >
              {registeringTagUid === pendingRegistration?.tag_uid && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function coordinates(tag: PendingUnregisteredCheckpointRow) {
  return tag.gps_lat != null && tag.gps_lng != null ? `${tag.gps_lng.toFixed(6)}, ${tag.gps_lat.toFixed(6)}` : "Unavailable";
}

function Detail({ icon: Icon, label, value, highlight, warning, mono }: { icon: typeof Radio; label: string; value: string; highlight?: boolean; warning?: boolean; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/35 bg-muted/15 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <p className={`truncate font-semibold ${warning ? "text-warning" : highlight ? "text-warning" : "text-foreground"} ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</p>
    </div>
  );
}