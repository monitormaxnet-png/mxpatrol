import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCheckpoints } from "@/hooks/useDashboardData";
import { useGuardPositions, type GuardPosition } from "@/hooks/useGuardPositions";

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

const LiveMap = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const guardMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const checkpointMarkersRef = useRef<L.Marker[]>([]);
  const hasFittedRef = useRef(false);

  const { data: checkpoints = [] } = useCheckpoints();
  const { data: guardPositions = [] } = useGuardPositions();

  const checkpointsWithCoords = useMemo(
    () => checkpoints.filter((cp) => cp.location_lat != null && cp.location_lng != null),
    [checkpoints]
  );

  const hasData = checkpointsWithCoords.length > 0 || guardPositions.length > 0;

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

    // Remove old
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

  // Update guard markers (smoothly move existing, add new, remove stale)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const icon = createGuardIcon();
    const currentIds = new Set(guardPositions.map((g) => g.guard_id));

    // Remove markers for guards no longer present
    guardMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        guardMarkersRef.current.delete(id);
      }
    });

    // Add or update
    guardPositions.forEach((g) => {
      const existing = guardMarkersRef.current.get(g.guard_id);
      const popupContent = `<div class="text-xs"><strong>${g.full_name}</strong> (${g.badge_number})<br/>Last scan: ${new Date(g.scanned_at).toLocaleTimeString()}</div>`;

      if (existing) {
        // Smoothly move to new position
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

  const wrapperClass = isFullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-background"
    : "glass-card flex flex-col overflow-hidden";

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-sm font-semibold text-foreground">Live Patrol Map</h3>
          <span className="flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-medium text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Live
          </span>
        </div>
        <button
          onClick={() => setIsFullscreen((f) => !f)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
      <div className="relative flex-1 min-h-[300px]">
        {!hasData && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground bg-muted/20">
            No GPS data available — add coordinates to checkpoints to see them on the map
          </div>
        )}
        <div ref={mapContainerRef} className="h-full w-full min-h-[300px]" style={{ background: "hsl(var(--muted))" }} />

        {hasData && (
          <div className="absolute bottom-3 left-3 z-[1000] flex gap-4 rounded-md bg-background/80 px-3 py-1.5 backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-success" />
              <span className="text-[10px] text-muted-foreground">Guards ({guardPositions.length})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rotate-45 bg-primary" />
              <span className="text-[10px] text-muted-foreground">Checkpoints ({checkpointsWithCoords.length})</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveMap;
