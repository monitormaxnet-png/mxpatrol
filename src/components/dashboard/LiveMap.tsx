import { useMemo, useEffect } from "react";
import { Maximize2 } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCheckpoints } from "@/hooks/useDashboardData";
import { useGuardPositions } from "@/hooks/useGuardPositions";

// Fix default marker icon issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const guardIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#10b981;border:3px solid #fff;box-shadow:0 0 8px rgba(16,185,129,0.6);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const checkpointIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:14px;height:14px;transform:rotate(45deg);background:hsl(var(--primary));border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Auto-fit bounds when data changes
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [positions, map]);
  return null;
}

const LiveMap = () => {
  const { data: checkpoints = [] } = useCheckpoints();
  const { data: guardPositions = [] } = useGuardPositions();

  const checkpointsWithCoords = useMemo(
    () => checkpoints.filter((cp) => cp.location_lat != null && cp.location_lng != null),
    [checkpoints]
  );

  // Combine all coordinates to fit bounds
  const allPositions = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    checkpointsWithCoords.forEach((cp) => pts.push([cp.location_lat!, cp.location_lng!]));
    guardPositions.forEach((g) => pts.push([g.lat, g.lng]));
    return pts;
  }, [checkpointsWithCoords, guardPositions]);

  // Default center (fallback when no data)
  const defaultCenter: [number, number] = allPositions.length > 0 ? allPositions[0] : [0, 0];
  const hasData = allPositions.length > 0;

  return (
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h3 className="font-heading text-sm font-semibold text-foreground">Live Patrol Map</h3>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="relative flex-1 min-h-[300px]">
        {!hasData ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-muted/20">
            No GPS data available — add coordinates to checkpoints to see them on the map
          </div>
        ) : (
          <MapContainer
            center={defaultCenter}
            zoom={14}
            scrollWheelZoom={true}
            className="h-full w-full min-h-[300px] z-0"
            style={{ background: "hsl(var(--muted))" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &amp; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <FitBounds positions={allPositions} />

            {/* Checkpoint markers */}
            {checkpointsWithCoords.map((cp) => (
              <Marker key={cp.id} position={[cp.location_lat!, cp.location_lng!]} icon={checkpointIcon}>
                <Popup>
                  <div className="text-xs">
                    <strong>{cp.name}</strong>
                    <br />
                    NFC: {cp.nfc_tag_id}
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Guard markers */}
            {guardPositions.map((g) => (
              <Marker key={g.guard_id} position={[g.lat, g.lng]} icon={guardIcon}>
                <Popup>
                  <div className="text-xs">
                    <strong>{g.full_name}</strong> ({g.badge_number})
                    <br />
                    Last seen: {new Date(g.scanned_at).toLocaleTimeString()}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}

        {/* Legend overlay */}
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
