import { useState } from "react";
import { AlertTriangle, Camera, Filter, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCameras, useCameraEvents, useCameraRealtimeSubscription } from "@/hooks/useCameraData";
import { format } from "date-fns";

const eventTypeLabels: Record<string, string> = {
  intrusion: "🚨 Intrusion",
  loitering: "🚶 Loitering",
  motion_restricted: "⚠️ Motion (Restricted)",
  object_left: "📦 Object Left Behind",
  suspicious_behavior: "🔍 Suspicious Behavior",
  camera_offline: "📷 Camera Offline",
  camera_online: "✅ Camera Online",
};

const severityColor: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const CameraEvents = () => {
  useCameraRealtimeSubscription();
  const { data: cameras = [] } = useCameras();
  const { data: events = [] } = useCameraEvents();
  const [filterCamera, setFilterCamera] = useState("all");
  const [filterType, setFilterType] = useState("all");

  const filtered = events.filter((e) => {
    if (filterCamera !== "all" && e.camera_id !== filterCamera) return false;
    if (filterType !== "all" && e.event_type !== filterType) return false;
    return true;
  });

  const eventTypes = [...new Set(events.map((e) => e.event_type))];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Camera Events</h2>
        <p className="text-sm text-muted-foreground">AI detection events and camera activity history</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={filterCamera} onValueChange={setFilterCamera}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Cameras" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cameras</SelectItem>
            {cameras.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Event Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {eventTypes.map((t) => (
              <SelectItem key={t} value={t}>{eventTypeLabels[t] || t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Camera className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No events found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((evt) => (
            <Card key={evt.id} className="glass-card">
              <CardContent className="flex items-start gap-4 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {eventTypeLabels[evt.event_type] || evt.event_type}
                    </span>
                    <Badge variant={severityColor[evt.severity] || "secondary"} className="text-[10px]">
                      {evt.severity}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Camera: {evt.cameras?.name || "Unknown"}
                  </p>
                  {evt.description && (
                    <p className="mt-1 text-sm text-foreground/80">{evt.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {format(new Date(evt.detected_at), "PPp")}
                  </div>
                </div>
                {evt.thumbnail_url && (
                  <img
                    src={evt.thumbnail_url}
                    alt="Event thumbnail"
                    className="h-16 w-24 rounded-lg object-cover"
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default CameraEvents;
