import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Maximize2, Minimize2, Route, Play, Pause, RotateCcw, Users } from "lucide-react";
import GuardPositionsPanel from "@/components/dashboard/GuardPositionsPanel";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCheckpoints } from "@/hooks/useDashboardData";
import { useGuardPositions, useGuardTrails } from "@/hooks/useGuardPositions";
import { Slider } from "@/components/ui/slider";

// Distinct colors for guard trails
const TRAIL_COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
];

function createGuardIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:#10b981;border:3px solid #fff;box-shadow:0 0 8px rgba(16,185,129,0.6);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function createCheckpointIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;transform:rotate(45deg);background:hsl(174,100%,42%);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function createReplayIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 10px ${color}80;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const LiveMap = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState(0); // 0-100
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedGuardId, setSelectedGuardId] = useState<string>("all");

  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const guardMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const checkpointMarkersRef = useRef<L.Marker[]>([]);
  const trailLinesRef = useRef<L.Polyline[]>([]);
  const trailDotsRef = useRef<L.CircleMarker[]>([]);
  const replayMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const replayTrailsRef = useRef<L.Polyline[]>([]);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasFittedRef = useRef(false);

  const { data: checkpoints = [] } = useCheckpoints();
  const { data: guardPositions = [] } = useGuardPositions();
  const { data: guardTrails = [] } = useGuardTrails();

  const checkpointsWithCoords = useMemo(
    () => checkpoints.filter((cp) => cp.location_lat != null && cp.location_lng != null),
    [checkpoints]
  );

  const hasData = checkpointsWithCoords.length > 0 || guardPositions.length > 0;

  // Filter trails by selected guard
  const filteredTrails = useMemo(() => {
    if (selectedGuardId === "all") return guardTrails;
    return guardTrails.filter((t) => t.guard_id === selectedGuardId);
  }, [guardTrails, selectedGuardId]);

  // Compute global time range from filtered trail points
  const timeRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    filteredTrails.forEach((trail) => {
      trail.points.forEach((pt) => {
        const t = new Date(pt.scanned_at).getTime();
        if (t < min) min = t;
        if (t > max) max = t;
      });
    });
    return { min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 0 };
  }, [filteredTrails]);

  const currentTime = useMemo(() => {
    if (timeRange.max === timeRange.min) return timeRange.max;
    return timeRange.min + (replayProgress / 100) * (timeRange.max - timeRange.min);
  }, [replayProgress, timeRange]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [0, 0],
      zoom: 2,
      scrollWheelZoom: true,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &amp; <a href="https://carto.com/">CARTO</a>',
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      hasFittedRef.current = false;
      guardMarkersRef.current.clear();
      checkpointMarkersRef.current = [];
      trailLinesRef.current = [];
      trailDotsRef.current = [];
    };
  }, []);

  // Fit bounds helper
  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const pts: L.LatLngExpression[] = [];
    checkpointsWithCoords.forEach((cp) => pts.push([cp.location_lat!, cp.location_lng!]));
    guardPositions.forEach((g) => pts.push([g.lat, g.lng]));

    if (pts.length > 0) {
      map.fitBounds(L.latLngBounds(pts as [number, number][]), {
        padding: [40, 40],
        maxZoom: 16,
      });
    }
  }, [checkpointsWithCoords, guardPositions]);

  // Update checkpoint markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    checkpointMarkersRef.current.forEach((m) => m.remove());
    checkpointMarkersRef.current = [];

    const icon = createCheckpointIcon();
    checkpointsWithCoords.forEach((cp) => {
      const marker = L.marker([cp.location_lat!, cp.location_lng!], { icon })
        .addTo(map)
        .bindPopup(`<div class="text-xs"><strong>${cp.name}</strong><br/>NFC: ${cp.nfc_tag_id}</div>`);
      checkpointMarkersRef.current.push(marker);
    });

    if (!hasFittedRef.current && (checkpointsWithCoords.length > 0 || guardPositions.length > 0)) {
      fitBounds();
      hasFittedRef.current = true;
    }
  }, [checkpointsWithCoords, fitBounds, guardPositions.length]);

  // Update guard markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const icon = createGuardIcon();
    const currentIds = new Set(guardPositions.map((g) => g.guard_id));

    guardMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        guardMarkersRef.current.delete(id);
      }
    });

    guardPositions.forEach((g) => {
      const existing = guardMarkersRef.current.get(g.guard_id);
      const popupContent = `<div class="text-xs"><strong>${g.full_name}</strong> (${g.badge_number})<br/>Last scan: ${new Date(g.scanned_at).toLocaleTimeString()}</div>`;

      if (existing) {
        existing.setLatLng([g.lat, g.lng]);
        existing.setPopupContent(popupContent);
      } else {
        const marker = L.marker([g.lat, g.lng], { icon })
          .addTo(map)
          .bindPopup(popupContent);
        guardMarkersRef.current.set(g.guard_id, marker);
      }
    });

    if (!hasFittedRef.current && guardPositions.length > 0) {
      fitBounds();
      hasFittedRef.current = true;
    }
  }, [guardPositions, fitBounds]);

  // Toggle guard marker visibility during replay
  useEffect(() => {
    guardMarkersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el) el.style.display = isReplaying ? "none" : "";
    });
  }, [isReplaying, guardPositions]);

  // Draw patrol trail polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old trails
    trailLinesRef.current.forEach((l) => l.remove());
    trailLinesRef.current = [];
    trailDotsRef.current.forEach((d) => d.remove());
    trailDotsRef.current = [];

    if (!showTrails || isReplaying) return;

    filteredTrails.forEach((trail, idx) => {
      if (trail.points.length < 2) return;

      const color = TRAIL_COLORS[idx % TRAIL_COLORS.length];
      const latlngs: [number, number][] = trail.points.map((p) => [p.lat, p.lng]);

      // Draw polyline
      const polyline = L.polyline(latlngs, {
        color,
        weight: 3,
        opacity: 0.7,
        dashArray: "8 6",
        lineCap: "round",
      }).addTo(map);

      polyline.bindPopup(
        `<div class="text-xs"><strong>${trail.full_name}</strong> (${trail.badge_number})<br/>${trail.points.length} scans</div>`
      );

      trailLinesRef.current.push(polyline);

      // Draw scan point dots along the trail
      trail.points.forEach((pt, ptIdx) => {
        const dot = L.circleMarker([pt.lat, pt.lng], {
          radius: 4,
          color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 1,
        }).addTo(map);

        dot.bindPopup(
          `<div class="text-xs"><strong>${trail.full_name}</strong><br/>${pt.checkpoint_name}<br/>${new Date(pt.scanned_at).toLocaleString()}<br/>Stop ${ptIdx + 1} of ${trail.points.length}</div>`
        );

        trailDotsRef.current.push(dot);
      });
    });
  }, [filteredTrails, showTrails, isReplaying]);

  // Replay rendering: draw trails up to currentTime and position replay markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReplaying) {
      // Clean up replay layers when not replaying
      replayMarkersRef.current.forEach((m) => m.remove());
      replayMarkersRef.current.clear();
      replayTrailsRef.current.forEach((l) => l.remove());
      replayTrailsRef.current = [];
      return;
    }

    // Clear previous replay trails
    replayTrailsRef.current.forEach((l) => l.remove());
    replayTrailsRef.current = [];

    // Remove markers not in current filter
    const filteredIds = new Set(filteredTrails.map((t) => t.guard_id));
    replayMarkersRef.current.forEach((m, id) => {
      if (!filteredIds.has(id)) { m.remove(); replayMarkersRef.current.delete(id); }
    });

    filteredTrails.forEach((trail, idx) => {
      const color = TRAIL_COLORS[idx % TRAIL_COLORS.length];
      const visiblePoints = trail.points.filter((p) => new Date(p.scanned_at).getTime() <= currentTime);

      if (visiblePoints.length === 0) {
        // Remove marker if guard hasn't appeared yet
        const existing = replayMarkersRef.current.get(trail.guard_id);
        if (existing) { existing.remove(); replayMarkersRef.current.delete(trail.guard_id); }
        return;
      }

      // Draw trail up to current time
      if (visiblePoints.length >= 2) {
        const latlngs: [number, number][] = visiblePoints.map((p) => [p.lat, p.lng]);
        const polyline = L.polyline(latlngs, { color, weight: 3, opacity: 0.8, lineCap: "round" }).addTo(map);
        replayTrailsRef.current.push(polyline);
      }

      // Position the guard replay marker at latest visible point
      const lastPt = visiblePoints[visiblePoints.length - 1];
      const existing = replayMarkersRef.current.get(trail.guard_id);
      const popupContent = `<div class="text-xs"><strong>${trail.full_name}</strong> (${trail.badge_number})<br/>${lastPt.checkpoint_name}<br/>${new Date(lastPt.scanned_at).toLocaleTimeString()}<br/>Scan ${visiblePoints.length} of ${trail.points.length}</div>`;

      if (existing) {
        existing.setLatLng([lastPt.lat, lastPt.lng]);
        existing.setPopupContent(popupContent);
      } else {
        const marker = L.marker([lastPt.lat, lastPt.lng], { icon: createReplayIcon(color) })
          .addTo(map)
          .bindPopup(popupContent);
        replayMarkersRef.current.set(trail.guard_id, marker);
      }
    });
  }, [isReplaying, currentTime, filteredTrails]);

  // Auto-play interval
  useEffect(() => {
    if (isPlaying && isReplaying) {
      playIntervalRef.current = setInterval(() => {
        setReplayProgress((prev) => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return Math.min(prev + 0.5, 100);
        });
      }, 50);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, isReplaying]);

  // Invalidate map size on fullscreen toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  const handleToggleReplay = () => {
    if (isReplaying) {
      setIsReplaying(false);
      setIsPlaying(false);
      setReplayProgress(0);
    } else {
      setIsReplaying(true);
      setReplayProgress(0);
    }
  };

  const handleReset = () => {
    setReplayProgress(0);
    setIsPlaying(false);
  };

  const wrapperClass = isFullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-background"
    : "glass-card flex flex-col overflow-hidden";

  const formatTime = (ts: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-sm font-semibold text-foreground">Live Patrol Map</h3>
          {!isReplaying && (
            <span className="flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-medium text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live
            </span>
          )}
          {isReplaying && (
            <span className="flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Play className="h-2.5 w-2.5" />
              Replay
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {guardTrails.length > 0 && (
            <button
              onClick={handleToggleReplay}
              className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors ${
                isReplaying
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              title={isReplaying ? "Exit replay" : "Replay patrols"}
            >
              <Play className="h-3.5 w-3.5" />
              Replay
            </button>
          )}
          {!isReplaying && (
            <button
              onClick={() => setShowTrails((t) => !t)}
              className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors ${
                showTrails ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              title="Toggle patrol trails"
            >
              <Route className="h-3.5 w-3.5" />
              Trails
            </button>
          )}
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-[300px]">
        {!hasData && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground bg-muted/20">
            No GPS data available — add coordinates to checkpoints to see them on the map
          </div>
        )}
        <div ref={mapContainerRef} className="h-full w-full min-h-[300px]" style={{ background: "hsl(var(--muted))" }} />

        {/* Replay controls overlay */}
        {isReplaying && (
          <div className="absolute bottom-12 left-3 right-3 z-[1000] rounded-lg bg-background/90 px-4 py-3 backdrop-blur-sm border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setIsPlaying((p) => !p)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/80"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={handleReset}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Reset"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <select
                value={selectedGuardId}
                onChange={(e) => { setSelectedGuardId(e.target.value); setReplayProgress(0); setIsPlaying(false); }}
                className="h-7 shrink-0 rounded-md border border-border/50 bg-muted/50 px-2 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary max-w-[110px] truncate"
              >
                <option value="all">All Guards</option>
                {guardTrails.map((trail) => (
                  <option key={trail.guard_id} value={trail.guard_id}>
                    {trail.badge_number} — {trail.full_name}
                  </option>
                ))}
              </select>
              <div className="flex-1 min-w-0">
                <Slider
                  value={[replayProgress]}
                  onValueChange={([v]) => { setReplayProgress(v); setIsPlaying(false); }}
                  min={0}
                  max={100}
                  step={0.5}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{formatTime(timeRange.min)}</span>
              <span className="font-medium text-foreground">{formatTime(currentTime)}</span>
              <span>{formatTime(timeRange.max)}</span>
            </div>
          </div>
        )}

        {hasData && (
          <div className={`absolute ${isReplaying ? "bottom-28" : "bottom-3"} left-3 z-[1000] flex flex-wrap gap-3 rounded-md bg-background/80 px-3 py-1.5 backdrop-blur-sm transition-all`}>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-success" />
              <span className="text-[10px] text-muted-foreground">Guards ({guardPositions.length})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rotate-45 bg-primary" />
              <span className="text-[10px] text-muted-foreground">Checkpoints ({checkpointsWithCoords.length})</span>
            </div>
            {(showTrails || isReplaying) && guardTrails.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="h-0.5 w-4 rounded" style={{ borderTop: "2px dashed #3b82f6" }} />
                <span className="text-[10px] text-muted-foreground">Trails ({guardTrails.length})</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveMap;
