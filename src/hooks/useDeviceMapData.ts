import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyId } from "@/hooks/usePatrolScanData";

export interface DevicePosition {
  id: string;
  device_identifier: string;
  device_name: string | null;
  battery_level: number | null;
  metadata?: Record<string, unknown> | null;
  status: string;
  site_id?: string | null;
  site_name?: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  last_seen_at: string;
}

export interface DeviceTrail {
  device_id: string;
  device_name: string;
  battery_level: number | null;
  status: string;
  points: {
    lat: number;
    lng: number;
    accuracy: number | null;
    scanned_at: string;
    checkpoint_name: string;
    tag_uid: string | null;
  }[];
}

export interface ScanMapEvent {
  id: string;
  device_id: string | null;
  checkpoint_id: string | null;
  device_name: string;
  checkpoint_name: string;
  tag_uid: string | null;
  tag_status: string;
  scanned_at: string;
  lat: number;
  lng: number;
  accuracy: number | null;
}

export interface ReplayRoutePoint {
  id: string;
  session_id: string;
  device_id: string | null;
  device_identifier: string;
  checkpoint_name: string;
  tag_uid: string | null;
  tag_status: string;
  scanned_at: string;
  lat: number;
  lng: number;
  accuracy: number | null;
}

export type DeviceMapFilters = {
  deviceIdentifier?: string;
  date?: string;
  timeFrom?: string;
  timeTo?: string;
  siteId?: string;
};

export type ReplayRouteFilters = {
  deviceIdentifier?: string;
  startDate?: string;
  endDate?: string;
  sessionId?: string;
  siteId?: string;
};

type DevicePositionRow = {
  id: string;
  device_identifier: string;
  device_name: string | null;
  battery_level: number | null;
  metadata?: Record<string, unknown> | null;
  status: string;
  current_gps_lat: number;
  current_gps_lng: number;
  current_gps_accuracy: number | null;
  current_gps_at: string | null;
  site_id?: string | null;
  sites?: { name: string } | null;
  last_seen_at: string;
};

type DeviceSummaryRow = {
  device_identifier: string;
  device_name: string | null;
  battery_level: number | null;
  metadata?: Record<string, unknown> | null;
  status: string;
  site_id?: string | null;
  sites?: { name: string } | null;
};

type ScanLogMapRow = {
  id: string;
  company_id?: string;
  device_id: string | null;
  checkpoint_id?: string | null;
  device_identifier: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  scanned_at: string;
  tag_uid: string | null;
  tag_status: string | null;
  site_id?: string | null;
  checkpoints: { name: string } | null;
};

const dateRange = (filters: DeviceMapFilters) => {
  const day = filters.date || new Date().toISOString().slice(0, 10);
  const from = new Date(`${day}T${filters.timeFrom || "00:00"}:00`);
  const to = new Date(`${day}T${filters.timeTo || "23:59"}:59`);
  return { from: from.toISOString(), to: to.toISOString() };
};

const replayDateRange = (filters: ReplayRouteFilters) => {
  const start = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
  const end = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;
  return { from: start?.toISOString(), to: end?.toISOString() };
};

async function fetchLatestScanPositions(companyId: string, siteId = "all"): Promise<DevicePosition[]> {
  const scanQuery = supabase
    .from("scan_logs")
    .select("id, device_id, device_identifier, site_id, gps_lat, gps_lng, gps_accuracy, scanned_at")
    .eq("company_id", companyId)
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .order("scanned_at", { ascending: false })
    .limit(500);


  const { data: scanData, error: scanError } = await scanQuery;
  if (scanError) throw scanError;

  const latest = new Map<string, ScanLogMapRow>();
  for (const scan of (scanData ?? []) as ScanLogMapRow[]) {
    const identity = scan.device_identifier ?? scan.device_id;
    if (identity && scan.gps_lat != null && scan.gps_lng != null && !latest.has(identity)) {
      latest.set(identity, scan);
    }
  }

  const summaries = await fetchDeviceSummaries(companyId, Array.from(latest.keys()));

  const positions = Array.from(latest.values()).map((scan) => {
    const identity = scan.device_identifier ?? scan.device_id ?? "Unknown device";
    const summary = summaries.get(identity);
    return {
      id: scan.id,
      device_identifier: identity,
      device_name: summary?.device_name ?? identity,
      battery_level: summary?.battery_level ?? (typeof summary?.metadata?.battery_level === "number" ? summary.metadata.battery_level : null),
      status: summary?.status ?? "online",
      site_id: scan.site_id ?? summary?.site_id ?? null,
      site_name: summary?.sites?.name ?? null,
      lat: scan.gps_lat!,
      lng: scan.gps_lng!,
      accuracy: scan.gps_accuracy ?? null,
      last_seen_at: scan.scanned_at,
    };
  }).filter((position) => siteId === 'all' || position.site_id === siteId);

  if (positions.length > 0) console.info("[Map] Device marker updated from latest scan GPS", { companyId, count: positions.length, latest: positions[0] });
  return positions;
}
async function fetchDevicePositions(companyId: string, siteId = "all"): Promise<DevicePosition[]> {
  let deviceQuery = supabase
    .from("devices")
    .select("id, device_identifier, device_name, battery_level, metadata, status, site_id, sites(name), current_gps_lat, current_gps_lng, current_gps_accuracy, current_gps_at, last_seen_at")
    .eq("company_id", companyId)
    .not("current_gps_lat", "is", null)
    .not("current_gps_lng", "is", null)
    .order("last_seen_at", { ascending: false });
  if (siteId !== "all") deviceQuery = deviceQuery.eq("site_id", siteId);
  const { data, error } = await deviceQuery;

  if (error) {
    console.warn("[LiveMap] Device GPS columns unavailable; using latest scan GPS fallback");
    const { data: scanData, error: scanError } = await supabase
      .from("scan_logs")
      .select("id, device_id, device_identifier, gps_lat, gps_lng, gps_accuracy, scanned_at")
      .eq("company_id", companyId)
      .not("gps_lat", "is", null)
      .not("gps_lng", "is", null)
      .order("scanned_at", { ascending: false })
      .limit(500);
    if (scanError) throw scanError;

    const latest = new Map<string, ScanLogMapRow>();
    for (const scan of (scanData ?? []) as ScanLogMapRow[]) {
      const identity = scan.device_identifier ?? scan.device_id;
      if (identity && scan.gps_lat != null && scan.gps_lng != null && !latest.has(identity)) {
        latest.set(identity, scan);
      }
    }

    return Array.from(latest.values()).map((scan) => ({
      id: scan.id,
      device_identifier: scan.device_identifier ?? scan.device_id ?? "Unknown device",
      device_name: null,
      battery_level: null,
      status: "online",
      site_id: null,
      site_name: null,
      lat: scan.gps_lat!,
      lng: scan.gps_lng!,
      accuracy: scan.gps_accuracy ?? null,
      last_seen_at: scan.scanned_at,
    }));
  }

  const positions = ((data ?? []) as DevicePositionRow[]).map((device) => ({
    id: device.id,
    device_identifier: device.device_identifier,
    device_name: device.device_name,
    battery_level: device.battery_level ?? (typeof device.metadata?.battery_level === "number" ? device.metadata.battery_level : null),
    status: device.status,
    site_id: device.site_id ?? null,
    site_name: device.sites?.name ?? null,
    lat: device.current_gps_lat,
    lng: device.current_gps_lng,
    accuracy: device.current_gps_accuracy,
    last_seen_at: device.current_gps_at ?? device.last_seen_at,
  }));
  if (positions.length === 0) {
    console.info("[Map] No current device GPS found; using latest scan GPS fallback", { companyId, siteId });
    return fetchLatestScanPositions(companyId, siteId);
  }

  console.info("[Map] Device marker updated", { companyId, count: positions.length, latest: positions[0] });
  return positions;
}

async function fetchDeviceSummaries(companyId: string, deviceIdentifiers: string[]) {
  if (deviceIdentifiers.length === 0) return new Map<string, DeviceSummaryRow>();

  const { data } = await supabase
    .from("devices")
    .select("device_identifier, device_name, battery_level, metadata, status, site_id, sites(name)")
    .eq("company_id", companyId)
    .in("device_identifier", deviceIdentifiers);

  return new Map(((data ?? []) as DeviceSummaryRow[]).map((device) => [device.device_identifier, device]));
}

async function fetchDeviceTrails(companyId: string, filters: DeviceMapFilters): Promise<DeviceTrail[]> {
  const { from, to } = dateRange(filters);
  let query = supabase
    .from("scan_logs")
    .select("id, company_id, device_id, checkpoint_id, device_identifier, gps_lat, gps_lng, gps_accuracy, scanned_at, tag_uid, tag_status, checkpoints(name)")
    .eq("company_id", companyId)
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .gte("scanned_at", from)
    .lte("scanned_at", to)
    .order("scanned_at", { ascending: true })
    .limit(1000);

  if (filters.deviceIdentifier && filters.deviceIdentifier !== "all") {
    query = query.or(`device_identifier.eq.${filters.deviceIdentifier},device_id.eq.${filters.deviceIdentifier}`);
  }
  if (filters.siteId && filters.siteId !== "all") query = query.eq("site_id", filters.siteId);
  if (filters.siteId && filters.siteId !== "all") query = query.eq("site_id", filters.siteId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as ScanLogMapRow[];
  const deviceIdentifiers = Array.from(new Set(rows.map((row) => row.device_identifier ?? row.device_id).filter(Boolean))) as string[];
  const deviceMap = await fetchDeviceSummaries(companyId, deviceIdentifiers);
  const trailMap = new Map<string, DeviceTrail>();

  for (const row of rows) {
    const deviceIdentifier = row.device_identifier ?? row.device_id;
    if (!deviceIdentifier || row.gps_lat == null || row.gps_lng == null) continue;

    const device = deviceMap.get(deviceIdentifier);
    let trail = trailMap.get(deviceIdentifier);

    if (!trail) {
      trail = {
        device_id: deviceIdentifier,
        device_name: device?.device_name || deviceIdentifier,
        battery_level: device?.battery_level ?? (typeof device?.metadata?.battery_level === "number" ? device.metadata.battery_level : null),
        status: device?.status || "offline",
        points: [],
      };
      trailMap.set(deviceIdentifier, trail);
    }

    trail.points.push({
      lat: row.gps_lat,
      lng: row.gps_lng,
      accuracy: row.gps_accuracy ?? null,
      scanned_at: row.scanned_at,
      checkpoint_name: row.checkpoints?.name ?? "Unregistered",
      tag_uid: row.tag_uid ?? null,
    });
  }

  return Array.from(trailMap.values());
}

async function fetchScanEvents(companyId: string, filters: DeviceMapFilters): Promise<ScanMapEvent[]> {
  const { from, to } = dateRange(filters);
  let query = supabase
    .from("scan_logs")
    .select("id, company_id, device_id, checkpoint_id, device_identifier, gps_lat, gps_lng, gps_accuracy, scanned_at, tag_uid, tag_status, checkpoints(name)")
    .eq("company_id", companyId)
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .gte("scanned_at", from)
    .lte("scanned_at", to)
    .order("scanned_at", { ascending: false })
    .limit(500);

  if (filters.deviceIdentifier && filters.deviceIdentifier !== "all") {
    query = query.or(`device_identifier.eq.${filters.deviceIdentifier},device_id.eq.${filters.deviceIdentifier}`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as ScanLogMapRow[])
    .filter((row) => row.gps_lat != null && row.gps_lng != null)
    .map((row) => ({
      id: row.id,
      device_id: row.device_id,
      checkpoint_id: row.checkpoint_id ?? null,
      device_name: row.device_identifier || row.device_id || "Device",
      checkpoint_name: row.checkpoints?.name ?? "Unregistered",
      tag_uid: row.tag_uid ?? null,
      tag_status: row.tag_status ?? "registered",
      scanned_at: row.scanned_at,
      lat: row.gps_lat!,
      lng: row.gps_lng!,
      accuracy: row.gps_accuracy ?? null,
    }));
}

async function fetchReplayRoute(companyId: string, filters: ReplayRouteFilters): Promise<ReplayRoutePoint[]> {
  const { from, to } = replayDateRange(filters);
  let query = supabase
    .from("scan_logs")
    .select("id, company_id, device_id, checkpoint_id, device_identifier, gps_lat, gps_lng, gps_accuracy, scanned_at, tag_uid, tag_status, checkpoints(name)")
    .eq("company_id", companyId)
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .order("scanned_at", { ascending: true })
    .limit(1500);

  if (from) query = query.gte("scanned_at", from);
  if (to) query = query.lte("scanned_at", to);
  if (filters.deviceIdentifier && filters.deviceIdentifier !== "all") {
    query = query.or(`device_identifier.eq.${filters.deviceIdentifier},device_id.eq.${filters.deviceIdentifier}`);
  }
  if (filters.siteId && filters.siteId !== "all") query = query.eq("site_id", filters.siteId);
  if (filters.sessionId && filters.sessionId !== "all") {
    query = query.eq("id", filters.sessionId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as ScanLogMapRow[])
    .filter((row) => row.gps_lat != null && row.gps_lng != null)
    .map((row) => ({
      id: row.id,
      session_id: row.id,
      device_id: row.device_id,
      device_identifier: row.device_identifier || row.device_id || "Unknown device",
      checkpoint_name: row.checkpoints?.name ?? "Unregistered",
      tag_uid: row.tag_uid ?? null,
      tag_status: row.tag_status ?? "registered",
      scanned_at: row.scanned_at,
      lat: row.gps_lat!,
      lng: row.gps_lng!,
      accuracy: row.gps_accuracy ?? null,
    }));
}

async function fetchReplayDeviceIdentities(companyId: string) {
  const { data, error } = await supabase
    .from("scan_logs")
    .select("device_id, device_identifier")
    .eq("company_id", companyId)
    .order("scanned_at", { ascending: false })
    .limit(1000);

  if (error) throw error;

  return Array.from(
    new Set(
      ((data ?? []) as Array<{ device_id: string | null; device_identifier: string | null }>)
        .map((row) => row.device_identifier ?? row.device_id)
        .filter((value): value is string => Boolean(value))
    )
  ).sort((a, b) => a.localeCompare(b));
}

export function useDevicePositions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();

  useEffect(() => {
    if (!user || !companyId) return;

    const channel = supabase
      .channel(`device-map-realtime-${companyId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "devices", filter: `company_id=eq.${companyId}` }, (payload) => {
        console.info("[Map] Device marker updated", payload.new);
        queryClient.invalidateQueries({ queryKey: ["device_positions", companyId] });
        queryClient.invalidateQueries({ queryKey: ["replay_device_identities", companyId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "scan_logs", filter: `company_id=eq.${companyId}` }, (payload) => {
        console.info("[Map] Device marker updated", payload.new);
        queryClient.invalidateQueries({ queryKey: ["device_positions", companyId] });
        queryClient.invalidateQueries({ queryKey: ["device_trails", companyId] });
        queryClient.invalidateQueries({ queryKey: ["scan_map_events", companyId] });
        queryClient.invalidateQueries({ queryKey: ["replay_route", companyId] });
        queryClient.invalidateQueries({ queryKey: ["replay_device_identities", companyId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, companyId, queryClient]);

  return useQuery({
    queryKey: ["device_positions", companyId],
    queryFn: () => fetchDevicePositions(companyId!, "all"),
    enabled: !!user && !!companyId,
    refetchInterval: 15_000,
  });
}

export function useDeviceTrails(filters: DeviceMapFilters) {
  const { user } = useAuth();
  const { data: companyId } = useCompanyId();

  return useQuery({
    queryKey: ["device_trails", companyId, filters],
    queryFn: () => fetchDeviceTrails(companyId!, filters),
    enabled: !!user && !!companyId,
    refetchInterval: 15_000,
  });
}

export function useScanMapEvents(filters: DeviceMapFilters) {
  const { user } = useAuth();
  const { data: companyId } = useCompanyId();

  return useQuery({
    queryKey: ["scan_map_events", companyId, filters],
    queryFn: () => fetchScanEvents(companyId!, filters),
    enabled: !!user && !!companyId,
    refetchInterval: 15_000,
  });
}

export function useReplayRoute(filters: ReplayRouteFilters, enabled = false) {
  const { user } = useAuth();
  const { data: companyId } = useCompanyId();

  return useQuery({
    queryKey: ["replay_route", companyId, filters],
    queryFn: () => fetchReplayRoute(companyId!, filters),
    enabled: !!user && !!companyId && enabled,
  });
}

export function useReplayDeviceIdentities() {
  const { user } = useAuth();
  const { data: companyId } = useCompanyId();

  return useQuery({
    queryKey: ["replay_device_identities", companyId],
    queryFn: () => fetchReplayDeviceIdentities(companyId!),
    enabled: !!user && !!companyId,
  });
}





