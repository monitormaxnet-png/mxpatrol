import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Radio, ScanLine } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import DashboardFilterBar from "./DashboardFilterBar";
import SiteSelector from "@/components/sites/SiteSelector";
import {
  defaultDashboardFilters,
  exportCsv,
  isDateInRange,
  toFilterOptions,
} from "./dashboardTableFilters";
import {
  patrolScanCheckpointName,
  patrolScanDeviceIdentity,
  useLivePatrolScans,
} from "@/hooks/usePatrolScanData";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";

const liveStatus = () => "Active";

export default function LivePatrolSession() {
  const [siteId, setSiteId] = useState("all");
  const [filters, setFilters] = useState(defaultDashboardFilters);
  const { data: scans = [], isLoading, isFetching, error, refetch } = useLivePatrolScans(20, siteId);
  const realtime = useRealtimeConnectionStatus("live-patrol-session");
  const [highlightedScanId, setHighlightedScanId] = useState<string | null>(null);
  const previousTopScanRef = useRef<string | null>(null);

  useEffect(() => {
    const topScanId = scans[0]?.id ?? null;
    if (!topScanId) return;
    realtime.markUpdated();
    if (previousTopScanRef.current && previousTopScanRef.current !== topScanId) {
      setHighlightedScanId(topScanId);
      const timer = window.setTimeout(() => setHighlightedScanId(null), 3500);
      previousTopScanRef.current = topScanId;
      return () => window.clearTimeout(timer);
    }
    previousTopScanRef.current = topScanId;
  }, [scans[0]?.id]);

  const checkpointOptions = useMemo(() => toFilterOptions(scans.map(patrolScanCheckpointName)), [scans]);
  const deviceOptions = useMemo(() => toFilterOptions(scans.map(patrolScanDeviceIdentity)), [scans]);
  const statusOptions = useMemo(() => toFilterOptions(["Active"]), []);

  const filteredScans = useMemo(
    () =>
      scans.filter((scan) => {
        const checkpointName = patrolScanCheckpointName(scan);
        const deviceIdentity = patrolScanDeviceIdentity(scan);
        const status = liveStatus();

        return (
          (filters.checkpoint === "all" || checkpointName === filters.checkpoint) &&
          (filters.device === "all" || deviceIdentity === filters.device) &&
          (filters.status === "all" || status === filters.status) &&
          isDateInRange(scan.scanned_at, filters.startDate, filters.endDate)
        );
      }),
    [filters, scans]
  );

  const exportFilteredRows = () => {
    exportCsv(
      "live-patrol.csv",
      ["Site", "Device Identity", "Current Checkpoint", "Last Scan Time", "GPS", "Status"],
      filteredScans.map((scan) => [
        scan.sites?.name ?? "Unassigned",
        patrolScanDeviceIdentity(scan),
        patrolScanCheckpointName(scan),
        format(new Date(scan.scanned_at), "yyyy-MM-dd HH:mm:ss"),
        scan.gps_lat != null && scan.gps_lng != null
          ? `${scan.gps_lat.toFixed(6)}, ${scan.gps_lng.toFixed(6)}`
          : "GPS unavailable",
        liveStatus(),
      ])
    );
  };

  return (
    <div className="glass-card flex min-h-[340px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <div>
          <h3 className="font-heading text-sm font-semibold text-foreground">Live Patrol Session</h3>
          <p className="text-[11px] text-muted-foreground">Registered checkpoint scans from active patrol devices. Last updated: {realtime.lastUpdatedAt ? format(new Date(realtime.lastUpdatedAt), "HH:mm:ss") : "Waiting"}</p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${realtime.status === "live" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
          <Radio className={`h-3 w-3 ${realtime.status === "live" ? "animate-pulse" : ""}`} /> {realtimeStatusLabel(realtime.status)}
        </span>
      </div>

      <div className="border-b border-border/50 px-5 py-3"><SiteSelector value={siteId} onChange={setSiteId} /></div>

      <DashboardFilterBar
        filters={filters}
        checkpointLabel="Checkpoint"
        checkpointAllLabel="All Checkpoints"
        checkpointOptions={checkpointOptions}
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading patrol scans...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Live scans could not be loaded.
        </div>
      )}

      {!isLoading && !error && scans.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <ScanLine className="mb-2 h-7 w-7" />
          No registered checkpoint scans yet. The next registered NFC scan will appear here automatically.
        </div>
      )}

      {!isLoading && !error && scans.length > 0 && filteredScans.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          No live patrol rows match these filters.
        </div>
      )}

      {!isLoading && !error && filteredScans.length > 0 && (
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[860px] table-fixed text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border/50 bg-muted/70 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              <tr>
                <th className="w-[14%] px-4 py-2">Site</th>
                <th className="w-[20%] px-4 py-2">Device Identity</th>
                <th className="w-[24%] px-4 py-2">Current Checkpoint</th>
                <th className="w-[18%] px-4 py-2">Last Scan Time</th>
                <th className="w-[24%] px-4 py-2">GPS</th>
                <th className="w-[12%] px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filteredScans.map((scan) => (
                <tr key={scan.id} className={`transition-colors hover:bg-muted/30 ${highlightedScanId === scan.id ? "bg-primary/10 ring-1 ring-primary/20" : ""}`} title={format(new Date(scan.scanned_at), "PPpp")}>
                  <td className="truncate px-4 py-3 text-foreground" title={scan.sites?.name ?? "Unassigned"}>{scan.sites?.name ?? "Unassigned"}</td>
                  <td className="truncate px-4 py-3 font-semibold text-foreground" title={patrolScanDeviceIdentity(scan)}>
                    {patrolScanDeviceIdentity(scan)}
                  </td>
                  <td className="truncate px-4 py-3 text-foreground" title={patrolScanCheckpointName(scan)}>
                    {patrolScanCheckpointName(scan)}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {formatDistanceToNow(new Date(scan.scanned_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {scan.gps_lat != null && scan.gps_lng != null
                      ? `${scan.gps_lat.toFixed(6)}, ${scan.gps_lng.toFixed(6)}`
                      : "GPS unavailable"}
                  </td>
                  <td className="px-4 py-3 font-medium text-success">{liveStatus()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
