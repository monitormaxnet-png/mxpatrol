import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Calendar, Download, Loader2, Maximize2, Minimize2, Pause, Play, Radio, RotateCcw, Route, ScanLine, ShieldAlert, X } from "lucide-react";
import { format } from "date-fns";
import DevicePositionsPanel from "@/components/dashboard/DevicePositionsPanel";
import { Button } from "@/components/ui/button";
import SiteSelector from "@/components/sites/SiteSelector";
import { exportCsv, formatStatus } from "@/components/dashboard/dashboardTableFilters";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAlerts, useCheckpoints } from "@/hooks/useDashboardData";
import { type ReplayRoutePoint, useDevicePositions, useDeviceTrails, useReplayDeviceIdentities, useReplayRoute, useScanMapEvents } from "@/hooks/useDeviceMapData";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";

const TRAIL_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16"];

function deviceIcon(status: string) {
  const color = status === "online" ? "#10b981" : "#94a3b8";
  return L.divIcon({ className: "", html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 10px ${color}99;display:flex;align-items:center;justify-content:center;"><div style="width:7px;height:7px;border-radius:50%;background:#fff;"></div></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
}

function replayDeviceIcon() {
  return L.divIcon({ className: "", html: `<div style="width:26px;height:26px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 14px #f59e0bbb;display:flex;align-items:center;justify-content:center;"><div style="width:0;height:0;border-left:7px solid #fff;border-top:5px solid transparent;border-bottom:5px solid transparent;margin-left:2px;"></div></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}

function checkpointIcon() {
  return L.divIcon({ className: "", html: `<div style="width:14px;height:14px;transform:rotate(45deg);background:hsl(174,100%,42%);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
}

function scanIcon(status: string) {
  const color = status === "pending_registration" ? "#f59e0b" : "#38bdf8";
  return L.divIcon({ className: "", html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color}99;"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });
}

function sosIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:34px;height:34px;border-radius:999px;background:#dc2626;border:3px solid #fff;box-shadow:0 0 18px #dc2626;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;">SOS<span style="position:absolute;inset:-10px;border-radius:999px;border:2px solid rgba(220,38,38,.55);animation:sos-pulse 1.1s infinite;"></span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

const today = () => new Date().toISOString().slice(0, 10);
type SosAlertMarker = {
  id: string;
  message: string;
  created_at: string;
  lat: number;
  lng: number;
  deviceIdentifier: string;
};

const parseSosAlertMarker = (alert: { id: string; message: string; created_at: string; type: string }): SosAlertMarker | null => {
  if (alert.type !== "panic_button") return null;
  const locationMatch = alert.message.match(/Location:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (!locationMatch) return null;
  const lat = Number(locationMatch[1]);
  const lng = Number(locationMatch[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const deviceMatch = alert.message.match(/Device ID:\s*([^|]+)/i);
  return {
    id: alert.id,
    message: alert.message,
    created_at: alert.created_at,
    lat,
    lng,
    deviceIdentifier: deviceMatch?.[1]?.trim() || "SOS device",
  };
};

const routePointPopup = (point: ReplayRoutePoint) => `
  <div class="text-xs">
    <strong>Route Point</strong><br/>
    DeviceIdentity: ${point.device_identifier}<br/>
    CheckpointName: ${point.checkpoint_name}<br/>
    Date: ${format(new Date(point.scanned_at), "yyyy-MM-dd")}<br/>
    Time: ${format(new Date(point.scanned_at), "HH:mm:ss")}<br/>
    Longitude: ${point.lng.toFixed(6)}<br/>
    Latitude: ${point.lat.toFixed(6)}<br/>
    Status: ${formatStatus(point.tag_status)}
  </div>
`;

type LiveMapProps = {
  operationsMode?: boolean;
  showCheckpoints?: boolean;
  showDevices?: boolean;
  showRoutes?: boolean;
  showSos?: boolean;
};

const LiveMap = ({
  operationsMode = false,
  showCheckpoints = true,
  showDevices = true,
  showRoutes = true,
  showSos = true,
}: LiveMapProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState("all");
  const [selectedDeviceIdentifier, setSelectedDeviceIdentifier] = useState("all");
  const [date, setDate] = useState(today());
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const [replayMode, setReplayMode] = useState(false);
  const [replaySiteId, setReplaySiteId] = useState("all");
  const [replayDeviceIdentifier, setReplayDeviceIdentifier] = useState("all");
  const [replayStartDate, setReplayStartDate] = useState(today());
  const [replayEndDate, setReplayEndDate] = useState(today());
  const [replaySessionId, setReplaySessionId] = useState("all");
  const [replayIndex, setReplayIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);

  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const deviceMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const checkpointMarkersRef = useRef<L.Marker[]>([]);
  const trailLinesRef = useRef<L.Polyline[]>([]);
  const scanMarkersRef = useRef<L.Marker[]>([]);
  const sosMarkersRef = useRef<L.Marker[]>([]);
  const replayLineRef = useRef<L.Polyline | null>(null);
  const replayMarkerRef = useRef<L.Marker | null>(null);
  const replayPointMarkersRef = useRef<L.Marker[]>([]);
  const hasFittedRef = useRef(false);

  const filters = useMemo(() => ({ deviceIdentifier: selectedDeviceIdentifier, date, timeFrom, timeTo, siteId: selectedSiteId }), [selectedDeviceIdentifier, date, timeFrom, timeTo, selectedSiteId]);
  const replayFilters = useMemo(() => ({ deviceIdentifier: replayDeviceIdentifier, startDate: replayStartDate, endDate: replayEndDate, sessionId: replaySessionId, siteId: replaySiteId }), [replayDeviceIdentifier, replayStartDate, replayEndDate, replaySessionId, replaySiteId]);

  const { data: checkpoints = [], isLoading: checkpointsLoading, error: checkpointsError } = useCheckpoints();
  const { data: alerts = [] } = useAlerts();
  const { data: devicePositions = [], isLoading: positionsLoading, error: positionsError } = useDevicePositions();
  const { data: deviceTrails = [], isLoading: trailsLoading, error: trailsError } = useDeviceTrails(filters);
  const { data: scanEvents = [], isLoading: scansLoading, error: scansError } = useScanMapEvents(filters);
  const realtime = useRealtimeConnectionStatus("live-device-map");
  const { data: replayDeviceIdentities = [] } = useReplayDeviceIdentities();
  const { data: replayPoints = [], isLoading: replayLoading, error: replayError, refetch: refetchReplayRoute } = useReplayRoute(replayFilters, replayMode);

  const isLoading = checkpointsLoading || (!replayMode && (positionsLoading || trailsLoading || scansLoading)) || (replayMode && replayLoading);
  const mapError = checkpointsError || (!replayMode && (positionsError || trailsError || scansError)) || (replayMode && replayError);

  const lastScanByCheckpoint = useMemo(() => {
    const map = new Map<string, string>();
    scanEvents.forEach((scan) => {
      if (scan.checkpoint_id && !map.has(scan.checkpoint_id)) map.set(scan.checkpoint_id, scan.scanned_at);
    });
    return map;
  }, [scanEvents]);

  const checkpointsWithCoords = useMemo(() => checkpoints.filter((cp) => cp.location_lat != null && cp.location_lng != null), [checkpoints]);
  const sosAlerts = useMemo(() => alerts.map((alert) => parseSosAlertMarker(alert)).filter((alert): alert is SosAlertMarker => Boolean(alert)).slice(0, 5), [alerts]);
  const filteredDevicePositions = useMemo(() => devicePositions.filter((device) => (selectedSiteId === "all" || device.site_id === selectedSiteId) && (selectedDeviceIdentifier === "all" || device.device_identifier === selectedDeviceIdentifier)), [devicePositions, selectedDeviceIdentifier, selectedSiteId]);
  const replaySessionOptions = useMemo(() => replayPoints.map((point) => ({ id: point.session_id, label: `${point.session_id.slice(0, 8)} - ${format(new Date(point.scanned_at), "MMM d HH:mm")}` })), [replayPoints]);
  const currentReplayPoint = replayPoints[replayIndex] ?? null;
  const liveHasData = checkpointsWithCoords.length > 0 || filteredDevicePositions.length > 0 || scanEvents.length > 0 || sosAlerts.length > 0;

  const markRealtimeUpdated = realtime.markUpdated;

  useEffect(() => {
    if (filteredDevicePositions.length > 0 || scanEvents.length > 0 || sosAlerts.length > 0) {
      markRealtimeUpdated();
      if (filteredDevicePositions.length > 0) console.info("[Live Map] Device location updated", filteredDevicePositions[0]);
    }
  }, [filteredDevicePositions, markRealtimeUpdated, scanEvents.length, sosAlerts.length]);
  const replayHasRoute = replayPoints.length > 0;
  const hasData = replayMode ? checkpointsWithCoords.length > 0 || replayHasRoute : liveHasData;

  const clearLiveLayers = useCallback(() => {
    deviceMarkersRef.current.forEach((marker) => marker.remove());
    deviceMarkersRef.current.clear();
    trailLinesRef.current.forEach((line) => line.remove());
    trailLinesRef.current = [];
    scanMarkersRef.current.forEach((marker) => marker.remove());
    scanMarkersRef.current = [];
    sosMarkersRef.current.forEach((marker) => marker.remove());
    sosMarkersRef.current = [];
  }, []);

  const clearReplayLayers = useCallback(() => {
    replayLineRef.current?.remove();
    replayLineRef.current = null;
    replayMarkerRef.current?.remove();
    replayMarkerRef.current = null;
    replayPointMarkersRef.current.forEach((marker) => marker.remove());
    replayPointMarkersRef.current = [];
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { center: [0, 0], zoom: 2, scrollWheelZoom: true, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &amp; <a href="https://carto.com/">CARTO</a>' }).addTo(map);
    mapRef.current = map;
    const deviceMarkers = deviceMarkersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      deviceMarkers.clear();
      checkpointMarkersRef.current = [];
      trailLinesRef.current = [];
      scanMarkersRef.current = [];
      sosMarkersRef.current = [];
      replayLineRef.current = null;
      replayMarkerRef.current = null;
      replayPointMarkersRef.current = [];
      hasFittedRef.current = false;
    };
  }, []);

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngExpression[] = [];
    if (showCheckpoints) checkpointsWithCoords.forEach((cp) => pts.push([cp.location_lat!, cp.location_lng!]));
    if (replayMode) replayPoints.forEach((point) => pts.push([point.lat, point.lng]));
    else {
      if (showDevices) filteredDevicePositions.forEach((device) => pts.push([device.lat, device.lng]));
      if (showCheckpoints) scanEvents.forEach((scan) => pts.push([scan.lat, scan.lng]));
      if (showSos) sosAlerts.forEach((alert) => pts.push([alert.lat, alert.lng]));
    }
    if (pts.length > 0) map.fitBounds(L.latLngBounds(pts as [number, number][]), { padding: [40, 40], maxZoom: 16 });
  }, [checkpointsWithCoords, filteredDevicePositions, replayMode, replayPoints, scanEvents, showCheckpoints, showDevices, showSos, sosAlerts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    checkpointMarkersRef.current.forEach((marker) => marker.remove());
    checkpointMarkersRef.current = [];
    if (!showCheckpoints) return;
    const icon = checkpointIcon();
    checkpointsWithCoords.forEach((checkpoint) => {
      const lastScan = lastScanByCheckpoint.get(checkpoint.id);
      const marker = L.marker([checkpoint.location_lat!, checkpoint.location_lng!], { icon })
        .addTo(map)
        .bindPopup(`<div class="text-xs"><strong>${checkpoint.name}</strong><br/>Tag UID: ${checkpoint.nfc_tag_id}<br/>GPS: ${checkpoint.location_lat?.toFixed(6)}, ${checkpoint.location_lng?.toFixed(6)}<br/>Last scan: ${lastScan ? new Date(lastScan).toLocaleString() : "No scans yet"}</div>`);
      checkpointMarkersRef.current.push(marker);
    });
  }, [checkpointsWithCoords, lastScanByCheckpoint, showCheckpoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (replayMode || !showDevices) {
      deviceMarkersRef.current.forEach((marker) => marker.remove());
      deviceMarkersRef.current.clear();
      return;
    }
    const currentIds = new Set(filteredDevicePositions.map((device) => device.device_identifier));
    deviceMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        deviceMarkersRef.current.delete(id);
      }
    });
    filteredDevicePositions.forEach((device) => {
      const popup = `<div class="text-xs"><strong>${device.device_name || "Patrol Device"}</strong><br/>Device ID: ${device.device_identifier}<br/>Last seen: ${new Date(device.last_seen_at).toLocaleString()}<br/>GPS: ${device.lat.toFixed(6)}, ${device.lng.toFixed(6)}<br/>Accuracy: ${device.accuracy ?? "n/a"}m<br/>Battery: ${device.battery_level != null ? `${device.battery_level}%` : "Battery pending"}<br/>Status: ${device.status}</div>`;
      const existing = deviceMarkersRef.current.get(device.device_identifier);
      if (existing) {
        existing.setLatLng([device.lat, device.lng]);
        existing.setIcon(deviceIcon(device.status));
        existing.setPopupContent(popup);
      } else {
        const marker = L.marker([device.lat, device.lng], { icon: deviceIcon(device.status) }).addTo(map).bindPopup(popup);
        deviceMarkersRef.current.set(device.device_identifier, marker);
      }
    });
  }, [filteredDevicePositions, replayMode, showDevices]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    trailLinesRef.current.forEach((line) => line.remove());
    trailLinesRef.current = [];
    if (!showTrails || !showRoutes || replayMode) return;
    deviceTrails.forEach((trail, index) => {
      if (trail.points.length < 2) return;
      const color = TRAIL_COLORS[index % TRAIL_COLORS.length];
      const line = L.polyline(trail.points.map((point) => [point.lat, point.lng]), { color, weight: 3, opacity: 0.75, dashArray: "8 6", lineCap: "round" }).addTo(map);
      line.bindPopup(`<div class="text-xs"><strong>${trail.device_name}</strong><br/>Device ID: ${trail.device_id}<br/>${trail.points.length} GPS scan points</div>`);
      trailLinesRef.current.push(line);
    });
  }, [deviceTrails, replayMode, showRoutes, showTrails]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    scanMarkersRef.current.forEach((marker) => marker.remove());
    scanMarkersRef.current = [];
    sosMarkersRef.current.forEach((marker) => marker.remove());
    sosMarkersRef.current = [];
    if (replayMode || !showCheckpoints) return;
    scanEvents.forEach((scan) => {
      const marker = L.marker([scan.lat, scan.lng], { icon: scanIcon(scan.tag_status) })
        .addTo(map)
        .bindPopup(`<div class="text-xs"><strong>Scan Event</strong><br/>Device: ${scan.device_name}<br/>Checkpoint: ${scan.checkpoint_name}<br/>Time: ${new Date(scan.scanned_at).toLocaleString()}<br/>GPS Accuracy: ${scan.accuracy ?? "n/a"}m<br/>Tag UID: ${scan.tag_uid ?? "n/a"}</div>`);
      scanMarkersRef.current.push(marker);
    });
  }, [replayMode, scanEvents, showCheckpoints]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    sosMarkersRef.current.forEach((marker) => marker.remove());
    sosMarkersRef.current = [];
    if (replayMode || !showSos) return;

    const icon = sosIcon();
    sosAlerts.forEach((alert) => {
      const marker = L.marker([alert.lat, alert.lng], { icon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(`<div class="text-xs"><strong>SOS Panic Alert</strong><br/>Device: ${alert.deviceIdentifier}<br/>Time: ${new Date(alert.created_at).toLocaleString()}<br/>GPS: ${alert.lat.toFixed(6)}, ${alert.lng.toFixed(6)}</div>`);
      sosMarkersRef.current.push(marker);
    });
  }, [replayMode, showSos, sosAlerts]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    clearReplayLayers();
    if (!replayMode || replayPoints.length === 0) return;

    const latLngs = replayPoints.map((point) => [point.lat, point.lng] as [number, number]);
    replayLineRef.current = L.polyline(latLngs, { color: "#f59e0b", weight: 4, opacity: 0.9, lineCap: "round" }).addTo(map);
    replayPointMarkersRef.current = replayPoints.map((point) =>
      L.marker([point.lat, point.lng], { icon: scanIcon(point.tag_status) }).addTo(map).bindPopup(routePointPopup(point))
    );
    const firstPoint = replayPoints[0];
    replayMarkerRef.current = L.marker([firstPoint.lat, firstPoint.lng], { icon: replayDeviceIcon() }).addTo(map).bindPopup(routePointPopup(firstPoint));
  }, [clearReplayLayers, replayMode, replayPoints]);

  useEffect(() => {
    if (!replayMode || !currentReplayPoint || !replayMarkerRef.current) return;
    replayMarkerRef.current.setLatLng([currentReplayPoint.lat, currentReplayPoint.lng]);
    replayMarkerRef.current.setPopupContent(routePointPopup(currentReplayPoint));
  }, [currentReplayPoint, replayMode]);

  useEffect(() => {
    if (!replayMode || !isPlaying || replayPoints.length <= 1) return;
    const timer = window.setInterval(() => {
      setReplayIndex((index) => {
        if (index >= replayPoints.length - 1) {
          setIsPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, 1200 / replaySpeed);
    return () => window.clearInterval(timer);
  }, [isPlaying, replayMode, replayPoints.length, replaySpeed]);

  useEffect(() => {
    setReplayIndex(0);
    setIsPlaying(false);
    hasFittedRef.current = false;
  }, [replayFilters]);

  useEffect(() => {
    if (!replayMode) {
      clearReplayLayers();
      setIsPlaying(false);
      setReplayIndex(0);
      hasFittedRef.current = false;
    } else {
      clearLiveLayers();
      hasFittedRef.current = false;
    }
  }, [clearLiveLayers, clearReplayLayers, replayMode]);

  useEffect(() => {
    if (!hasFittedRef.current && hasData) {
      fitBounds();
      hasFittedRef.current = true;
    }
  }, [fitBounds, hasData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const timer = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(timer);
  }, [isFullscreen, showDevicePanel, replayMode]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  const handleFlyToDevice = useCallback((deviceId: string) => {
    const map = mapRef.current;
    const marker = deviceMarkersRef.current.get(deviceId);
    if (!map || !marker) return;
    map.flyTo(marker.getLatLng(), 15, { duration: 0.8 });
    marker.openPopup();
  }, []);

  const restartReplay = () => {
    setReplayIndex(0);
    setIsPlaying(false);
  };

  const exportReplayRoute = () => {
    exportCsv(
      "replay-route.csv",
      ["DeviceIdentity", "CheckpointName", "Date", "Time", "Longitude", "Latitude", "Status"],
      replayPoints.map((point) => [
        point.device_identifier,
        point.checkpoint_name,
        format(new Date(point.scanned_at), "yyyy-MM-dd"),
        format(new Date(point.scanned_at), "HH:mm:ss"),
        point.lng.toFixed(6),
        point.lat.toFixed(6),
        formatStatus(point.tag_status),
      ])
    );
  };

  const wrapperClass = isFullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-background"
    : operationsMode
      ? "flex h-full min-h-0 flex-col overflow-hidden bg-transparent"
      : "glass-card flex flex-col overflow-hidden";

  return (
    <div className={wrapperClass}>
      {(!operationsMode || isFullscreen) && (
      <div className="flex flex-col gap-3 border-b border-border/50 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-heading text-sm font-semibold text-foreground">Live Device Map</h3>
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${replayMode ? "bg-warning/20 text-warning" : "bg-success/20 text-success"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${replayMode ? "bg-warning" : "animate-pulse bg-success"}`} />
              {replayMode ? "REPLAY" : "LIVE"}
            </span>
            {!replayMode && (
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${realtime.status === "live" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                {realtimeStatusLabel(realtime.status)}
              </span>
            )}
          </div>
          {!replayMode && <p className="text-[10px] text-muted-foreground">Last updated: {realtime.lastUpdatedAt ? format(new Date(realtime.lastUpdatedAt), "HH:mm:ss") : "Waiting"}</p>}
          <div className="flex items-center gap-1">
            <button onClick={() => setReplayMode((value) => !value)} className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors ${replayMode ? "bg-warning/20 text-warning" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title={replayMode ? "Exit replay mode" : "Replay route"}>
              {replayMode ? <X className="h-3.5 w-3.5" /> : <Route className="h-3.5 w-3.5" />}
              {replayMode ? "Exit Replay" : "Replay Route"}
            </button>
            {!replayMode && (
              <button onClick={() => setShowTrails((value) => !value)} className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors ${showTrails ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Toggle device trails">
                <Route className="h-3.5 w-3.5" /> Trails
              </button>
            )}
            <button onClick={() => setShowDevicePanel((value) => !value)} className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors ${showDevicePanel ? "bg-success/20 text-success" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Toggle device list">
              <Radio className="h-3.5 w-3.5" /> Devices
            </button>
            <button onClick={() => setIsFullscreen((value) => !value)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {!replayMode && (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_minmax(220px,1.2fr)_minmax(170px,1fr)_120px_120px]">
            <SiteSelector value={selectedSiteId} onChange={(value) => { setSelectedSiteId(value); hasFittedRef.current = false; }} className="flex min-h-8 min-w-0 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 text-[10px] text-muted-foreground [&_button]:h-8 [&_button]:min-w-0 [&_button]:flex-1" />
            <label className="flex min-h-8 min-w-0 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 text-[10px] text-muted-foreground [&_button]:h-8 [&_button]:min-w-0 [&_button]:flex-1">
              <Radio className="h-3 w-3" />
              <select value={selectedDeviceIdentifier} onChange={(event) => { setSelectedDeviceIdentifier(event.target.value); hasFittedRef.current = false; }} className="min-w-0 flex-1 bg-transparent text-foreground outline-none">
                <option value="all" disabled hidden>Select Device</option>
                {devicePositions.map((device) => <option key={device.device_identifier} value={device.device_identifier}>{device.device_name || device.device_identifier}</option>)}
              </select>
            </label>
            <label className="flex min-h-8 min-w-0 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 text-[10px] text-muted-foreground [&_button]:h-8 [&_button]:min-w-0 [&_button]:flex-1">
              <Calendar className="h-3 w-3" />
              <input type="date" value={date} onChange={(event) => { setDate(event.target.value); hasFittedRef.current = false; }} className="min-w-0 flex-1 bg-transparent text-foreground outline-none" />
            </label>
            <input type="time" value={timeFrom} onChange={(event) => { setTimeFrom(event.target.value); hasFittedRef.current = false; }} className="h-8 rounded-md border border-border/50 bg-muted/30 px-2 text-xs text-foreground outline-none" />
            <input type="time" value={timeTo} onChange={(event) => { setTimeTo(event.target.value); hasFittedRef.current = false; }} className="h-8 rounded-md border border-border/50 bg-muted/30 px-2 text-xs text-foreground outline-none" />
          </div>
        )}

        {replayMode && (
          <div className="space-y-3 rounded-md border border-border/50 bg-muted/20 p-3">
            <div className="grid gap-2 md:grid-cols-5">
              <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Site
                <SiteSelector value={replaySiteId} onChange={setReplaySiteId} className="block" />
              </label>
              <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Device Identity
                <select value={replayDeviceIdentifier} onChange={(event) => setReplayDeviceIdentifier(event.target.value)} className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs normal-case text-foreground outline-none">
                  <option value="all" disabled hidden>Select Device</option>
                  {replayDeviceIdentities.map((identity) => <option key={identity} value={identity}>{identity}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Start Date
                <input type="date" value={replayStartDate} onChange={(event) => setReplayStartDate(event.target.value)} className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs normal-case text-foreground outline-none" />
              </label>
              <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                End Date
                <input type="date" value={replayEndDate} onChange={(event) => setReplayEndDate(event.target.value)} className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs normal-case text-foreground outline-none" />
              </label>
              <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Session ID
                <select value={replaySessionId} onChange={(event) => setReplaySessionId(event.target.value)} className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs normal-case text-foreground outline-none">
                  <option value="all" disabled hidden>Select Session</option>
                  {replaySessionOptions.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
                </select>
              </label>
            </div>

            <div className="grid gap-3 xl:grid-cols-[auto_1fr_auto] xl:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setIsPlaying(true)} disabled={replayPoints.length <= 1 || replayIndex >= replayPoints.length - 1}><Play /> Play</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setIsPlaying(false)} disabled={!isPlaying}><Pause /> Pause</Button>
                <Button type="button" size="sm" variant="outline" onClick={restartReplay} disabled={replayPoints.length === 0}><RotateCcw /> Restart</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void refetchReplayRoute()} disabled={replayLoading}><Route className={replayLoading ? "animate-spin" : ""} /> Reload</Button>
              </div>

              <label className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                <span className="shrink-0 font-medium text-foreground">Timeline</span>
                <input type="range" min={0} max={Math.max(replayPoints.length - 1, 0)} value={Math.min(replayIndex, Math.max(replayPoints.length - 1, 0))} onChange={(event) => { setIsPlaying(false); setReplayIndex(Number(event.target.value)); }} disabled={replayPoints.length === 0} className="min-w-0 flex-1 accent-primary" />
                <span className="shrink-0 tabular-nums">{replayPoints.length === 0 ? "0 / 0" : `${replayIndex + 1} / ${replayPoints.length}`}</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                {[1, 2, 4].map((speed) => (
                  <button key={speed} type="button" onClick={() => setReplaySpeed(speed)} className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${replaySpeed === speed ? "bg-primary text-primary-foreground" : "border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{speed}x</button>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={exportReplayRoute} disabled={replayPoints.length === 0}><Download /> Export Route CSV</Button>
              </div>
            </div>

            {currentReplayPoint && (
              <div className="text-xs text-muted-foreground">
                Current: <span className="text-foreground">{currentReplayPoint.device_identifier}</span> at <span className="text-foreground">{currentReplayPoint.checkpoint_name}</span> on {format(new Date(currentReplayPoint.scanned_at), "yyyy-MM-dd HH:mm:ss")}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      <div className={`relative flex flex-1 ${operationsMode ? "min-h-[520px]" : "min-h-[300px]"}` }>
        <div className={`relative flex-1 ${operationsMode ? "min-h-[520px]" : "min-h-[300px]"} ${showDevicePanel ? "min-w-0" : ""}` }>
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {replayMode ? "Loading route replay..." : "Loading live patrol map..."}
            </div>
          )}
          {!isLoading && mapError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/30 px-6 text-center text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {replayMode ? "Route replay data could not be loaded." : "Live map data could not be loaded. Retrying automatically."}
            </div>
          )}
          {!isLoading && !mapError && replayMode && !replayHasRoute && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/20 text-sm text-muted-foreground">No route data for selected filters.</div>
          )}
          {!isLoading && !mapError && !replayMode && !hasData && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/20 text-sm text-muted-foreground">GPS unavailable. Waiting for a device location or checkpoint scan.</div>
          )}
          <div ref={mapContainerRef} className={`h-full w-full ${operationsMode ? "min-h-[520px]" : "min-h-[300px]"}`} style={{ background: "hsl(var(--muted))" }} />

          {hasData && (
            <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap gap-3 rounded-md bg-background/80 px-3 py-1.5 backdrop-blur-sm">
              {!replayMode && (
                <>
                  <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-success" /><span className="text-[10px] text-muted-foreground">Devices ({filteredDevicePositions.length})</span></div>
                  <div className="flex items-center gap-1.5"><ScanLine className="h-3 w-3 text-sky-400" /><span className="text-[10px] text-muted-foreground">Scans ({scanEvents.length})</span></div>
                  {sosAlerts.length > 0 && <div className="flex items-center gap-1.5"><ShieldAlert className="h-3 w-3 text-destructive" /><span className="text-[10px] text-destructive">SOS ({sosAlerts.length})</span></div>}
                  {showTrails && deviceTrails.length > 0 && <div className="flex items-center gap-1.5"><div className="h-0.5 w-4 rounded" style={{ borderTop: "2px dashed #3b82f6" }} /><span className="text-[10px] text-muted-foreground">Routes ({deviceTrails.length})</span></div>}
                </>
              )}
              {replayMode && <div className="flex items-center gap-1.5"><div className="h-0.5 w-4 rounded bg-warning" /><span className="text-[10px] text-muted-foreground">Replay Points ({replayPoints.length})</span></div>}
              <div className="flex items-center gap-1.5"><div className="h-2 w-2 rotate-45 bg-primary" /><span className="text-[10px] text-muted-foreground">Checkpoints ({checkpointsWithCoords.length})</span></div>
            </div>
          )}
        </div>

        {showDevicePanel && !replayMode && !operationsMode && (
          <div className="w-60 shrink-0 border-l border-border/50 bg-background/50">
            <DevicePositionsPanel positions={filteredDevicePositions} onSelectDevice={handleFlyToDevice} />
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveMap;

