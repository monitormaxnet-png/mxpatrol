import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Radio, Tag } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import DashboardFilterBar from "./DashboardFilterBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SiteSelector from "@/components/sites/SiteSelector";
import { supabase } from "@/integrations/supabase/client";
import { reviewPendingNfcTag } from "@/lib/nfcWorkflow";
import { normalizeNfcUid } from "@/lib/nfcUid";
import {
  defaultDashboardFilters,
  exportCsv,
  isDateInRange,
  pendingCheckpointStatus,
  toFilterOptions,
} from "./dashboardTableFilters";
import {
  pendingCheckpointDeviceIdentity,
  type PendingUnregisteredCheckpointRow,
  usePendingUnregisteredCheckpoints,
} from "@/hooks/usePatrolScanData";

export default function PendingUnregisteredCheckpoints() {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState("all");
  const [filters, setFilters] = useState(defaultDashboardFilters);
  const [registeringTagUid, setRegisteringTagUid] = useState<string | null>(null);
  const [pendingRegistration, setPendingRegistration] = useState<PendingUnregisteredCheckpointRow | null>(null);
  const [checkpointName, setCheckpointName] = useState("");
  const { data: pending = [], isLoading, isFetching, error, refetch } = usePendingUnregisteredCheckpoints(30, siteId);

  const tagOptions = useMemo(() => toFilterOptions(pending.map((tag) => tag.tag_uid)), [pending]);
  const deviceOptions = useMemo(() => toFilterOptions(pending.map(pendingCheckpointDeviceIdentity)), [pending]);
  const statusOptions = useMemo(
    () => toFilterOptions(["Pending", "Registered", "Ignored", ...pending.map(pendingCheckpointStatus)]),
    [pending]
  );

  const filteredPending = useMemo(
    () =>
      pending.filter((tag) => {
        const deviceIdentity = pendingCheckpointDeviceIdentity(tag);
        const status = pendingCheckpointStatus(tag);

        return (
          (filters.checkpoint === "all" || tag.tag_uid === filters.checkpoint) &&
          (filters.device === "all" || deviceIdentity === filters.device) &&
          (filters.status === "all" || status === filters.status) &&
          isDateInRange(tag.scanned_at, filters.startDate, filters.endDate)
        );
      }),
    [filters, pending]
  );

  const exportFilteredRows = () => {
    exportCsv(
      "pending-unregistered-checkpoints.csv",
      ["Site", "Tag UID", "Device Identity", "Date", "Time", "Longitude", "Latitude", "Status"],
      filteredPending.map((tag) => [
        tag.sites?.name ?? "Unassigned",
        tag.tag_uid,
        pendingCheckpointDeviceIdentity(tag),
        format(new Date(tag.scanned_at), "yyyy-MM-dd"),
        format(new Date(tag.scanned_at), "HH:mm:ss"),
        tag.gps_lng != null ? tag.gps_lng.toFixed(6) : "Unavailable",
        tag.gps_lat != null ? tag.gps_lat.toFixed(6) : "Unavailable",
        pendingCheckpointStatus(tag),
      ])
    );
  };

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

      if (pendingTagError) throw pendingTagError;

      const pendingTag = pendingTags?.[0];
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
          <p className="text-[11px] text-muted-foreground">Unknown NFC tags waiting for admin registration</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-medium text-warning">
          <Radio className="h-3 w-3" /> Realtime
        </span>
      </div>

      <div className="border-b border-border/50 px-5 py-3"><SiteSelector value={siteId} onChange={setSiteId} /></div>

      <DashboardFilterBar
        filters={filters}
        checkpointLabel="Tag UID / Pending Tag"
        checkpointAllLabel="All Pending Tags"
        checkpointOptions={tagOptions}
        deviceOptions={deviceOptions}
        statusOptions={statusOptions}
        statusAllLabel="All Statuses"
        isRefreshing={isFetching}
        onFiltersChange={setFilters}
        onRefresh={() => void refetch()}
        onReset={() => setFilters(defaultDashboardFilters)}
        onExport={exportFilteredRows}
      />

      {isLoading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading pending tags...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Pending unregistered checkpoints could not be loaded.
        </div>
      )}

      {!isLoading && !error && pending.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <Tag className="mb-2 h-7 w-7" />
          No unknown NFC tags are waiting for registration.
        </div>
      )}

      {!isLoading && !error && pending.length > 0 && filteredPending.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          No pending checkpoint rows match these filters.
        </div>
      )}

      {!isLoading && !error && filteredPending.length > 0 && (
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full min-w-[1160px] table-fixed text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border/50 bg-muted/70 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              <tr>
                <th className="w-[11%] px-4 py-2">Site</th>
                <th className="w-[15%] px-4 py-2">Tag UID</th>
                <th className="w-[16%] px-4 py-2">Device Identity</th>
                <th className="w-[11%] px-4 py-2">Date</th>
                <th className="w-[9%] px-4 py-2">Time</th>
                <th className="w-[12%] px-4 py-2">Longitude</th>
                <th className="w-[12%] px-4 py-2">Latitude</th>
                <th className="w-[10%] px-4 py-2">Status</th>
                <th className="w-[14%] px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filteredPending.map((tag) => (
                <tr key={tag.id} className="transition-colors hover:bg-muted/30" title="Pending checkpoint registration">
                  <td className="truncate px-4 py-3 text-foreground" title={tag.sites?.name ?? "Unassigned"}>{tag.sites?.name ?? "Unassigned"}</td>
                  <td className="truncate px-4 py-3 font-mono text-xs text-foreground" title={tag.tag_uid}>
                    {tag.tag_uid}
                  </td>
                  <td className="truncate px-4 py-3 font-medium text-foreground" title={pendingCheckpointDeviceIdentity(tag)}>
                    {pendingCheckpointDeviceIdentity(tag)}
                  </td>
                  <td className="px-4 py-3 text-foreground">{format(new Date(tag.scanned_at), "yyyy-MM-dd")}</td>
                  <td className="px-4 py-3 text-foreground">{format(new Date(tag.scanned_at), "HH:mm:ss")}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {tag.gps_lng != null ? tag.gps_lng.toFixed(6) : "Unavailable"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {tag.gps_lat != null ? tag.gps_lat.toFixed(6) : "Unavailable"}
                  </td>
                  <td className="px-4 py-3 font-medium text-warning">{pendingCheckpointStatus(tag)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openRegisterDialog(tag)}
                      disabled={registeringTagUid === tag.tag_uid}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {registeringTagUid === tag.tag_uid ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Register
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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