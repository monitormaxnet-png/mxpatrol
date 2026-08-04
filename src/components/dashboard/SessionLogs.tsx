import { useMemo, useState } from "react";
import { AlertCircle, Clock, Loader2, Radio } from "lucide-react";
import { format } from "date-fns";
import DashboardFilterBar from "./DashboardFilterBar";
import SiteSelector from "@/components/sites/SiteSelector";
import {
  defaultDashboardFilters,
  exportCsv,
  isDateInRange,
  scanStatus,
  toFilterOptions,
} from "./dashboardTableFilters";
import {
  patrolScanCheckpointName,
  patrolScanDeviceIdentity,
  useSessionScanLogs,
} from "@/hooks/usePatrolScanData";

export default function SessionLogs() {
  const [siteId, setSiteId] = useState("all");
  const [filters, setFilters] = useState(defaultDashboardFilters);
  const { data: scans = [], isLoading, isFetching, error, refetch } = useSessionScanLogs(80, siteId);

  const checkpointOptions = useMemo(() => toFilterOptions(scans.map(patrolScanCheckpointName)), [scans]);
  const deviceOptions = useMemo(() => toFilterOptions(scans.map(patrolScanDeviceIdentity)), [scans]);
  const statusOptions = useMemo(
    () => toFilterOptions(["Registered", "Unregistered", "Failed", "Synced", ...scans.map(scanStatus)]),
    [scans]
  );

  const filteredScans = useMemo(
    () =>
      scans.filter((scan) => {
        const checkpointName = patrolScanCheckpointName(scan);
        const deviceIdentity = patrolScanDeviceIdentity(scan);
        const status = scanStatus(scan);

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
      "session-logs.csv",
      ["Site", "Session ID", "Device Identity", "Checkpoint Name", "Date", "Time", "Longitude", "Latitude", "Status"],
      filteredScans.map((scan) => [
        scan.sites?.name ?? "Unassigned",
        scan.id,
        patrolScanDeviceIdentity(scan),
        patrolScanCheckpointName(scan),
        format(new Date(scan.scanned_at), "yyyy-MM-dd"),
        format(new Date(scan.scanned_at), "HH:mm:ss"),
        scan.gps_lng != null ? scan.gps_lng.toFixed(6) : "Unavailable",
        scan.gps_lat != null ? scan.gps_lat.toFixed(6) : "Unavailable",
        scanStatus(scan),
      ])
    );
  };

  return (
    <div className="glass-card flex min-h-[360px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <div>
          <h3 className="font-heading text-sm font-semibold text-foreground">Session Logs</h3>
          <p className="text-[11px] text-muted-foreground">Latest scan sequence by company devices</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
          <Radio className="h-3 w-3" /> Realtime
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
        isRefreshing={isFetching}
        onFiltersChange={setFilters}
        onRefresh={() => void refetch()}
        onReset={() => setFilters(defaultDashboardFilters)}
        onExport={exportFilteredRows}
      />

      {isLoading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading session logs...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Session logs could not be loaded.
        </div>
      )}

      {!isLoading && !error && scans.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <Clock className="mb-2 h-7 w-7" />
          No session scans yet. Registered and unregistered scan events will appear here automatically.
        </div>
      )}

      {!isLoading && !error && scans.length > 0 && filteredScans.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          No session logs match these filters.
        </div>
      )}

      {!isLoading && !error && filteredScans.length > 0 && (
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[1080px] table-fixed text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border/50 bg-muted/70 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              <tr>
                <th className="w-[12%] px-4 py-2">Site</th>
                <th className="w-[16%] px-4 py-2">Session ID</th>
                <th className="w-[16%] px-4 py-2">Device Identity</th>
                <th className="w-[18%] px-4 py-2">Checkpoint Name</th>
                <th className="w-[12%] px-4 py-2">Date</th>
                <th className="w-[10%] px-4 py-2">Time</th>
                <th className="w-[13%] px-4 py-2">Longitude</th>
                <th className="w-[13%] px-4 py-2">Latitude</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filteredScans.map((scan) => (
                <tr key={scan.id} className="transition-colors hover:bg-muted/30" title={`Status: ${scanStatus(scan)}`}>
                  <td className="truncate px-4 py-3 text-foreground" title={scan.sites?.name ?? "Unassigned"}>
                    {scan.sites?.name ?? "Unassigned"}
                  </td>
                  <td className="truncate px-4 py-3 font-mono text-xs text-foreground" title={scan.id}>
                    {scan.id}
                  </td>
                  <td className="truncate px-4 py-3 font-medium text-foreground" title={patrolScanDeviceIdentity(scan)}>
                    {patrolScanDeviceIdentity(scan)}
                  </td>
                  <td className="truncate px-4 py-3 text-foreground" title={patrolScanCheckpointName(scan)}>
                    {patrolScanCheckpointName(scan)}
                  </td>
                  <td className="px-4 py-3 text-foreground">{format(new Date(scan.scanned_at), "yyyy-MM-dd")}</td>
                  <td className="px-4 py-3 text-foreground">{format(new Date(scan.scanned_at), "HH:mm:ss")}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {scan.gps_lng != null ? scan.gps_lng.toFixed(6) : "Unavailable"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {scan.gps_lat != null ? scan.gps_lat.toFixed(6) : "Unavailable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
