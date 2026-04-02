import { useState, useRef, useEffect, useCallback } from "react";
import { Maximize2, Minimize2, Grid2x2, Grid3x3, AlertTriangle, Camera } from "lucide-react";
import Hls from "hls.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCameras, useCameraEvents, useCameraRealtimeSubscription } from "@/hooks/useCameraData";
import { format } from "date-fns";

type GridSize = "2x2" | "3x3" | "1x1";

const CameraFeedPlayer = ({ streamUrl, name, status }: { streamUrl: string; name: string; status: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || status !== "online") return;

    const isHls = streamUrl.includes(".m3u8") || streamUrl.includes("m3u8");

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        liveSyncDurationCount: 3,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            hls.destroy();
          }
        }
      });
      hlsRef.current = hls;
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = streamUrl;
      video.load();
      video.play().catch(() => {});
    } else {
      // Direct mp4/webm fallback
      video.src = streamUrl;
      video.load();
      video.play().catch(() => {});
    }

    return () => {
      destroyHls();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl, status, destroyHls]);

  if (status !== "online") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-muted/50 text-muted-foreground">
        <Camera className="mb-2 h-8 w-8 opacity-40" />
        <span className="text-xs">Camera Offline</span>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="h-full w-full object-cover"
      autoPlay
      muted
      playsInline
      controls={false}
    />
  );
};

const CameraLive = () => {
  useCameraRealtimeSubscription();
  const { data: cameras = [] } = useCameras();
  const { data: events = [] } = useCameraEvents();
  const [gridSize, setGridSize] = useState<GridSize>("2x2");
  const [fullscreenCamera, setFullscreenCamera] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<string>("all");

  const displayCameras = selectedCamera === "all"
    ? cameras
    : cameras.filter((c) => c.id === selectedCamera);

  const gridClass = fullscreenCamera
    ? "grid-cols-1"
    : gridSize === "1x1"
    ? "grid-cols-1"
    : gridSize === "2x2"
    ? "grid-cols-1 sm:grid-cols-2"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  const camerasToShow = fullscreenCamera
    ? cameras.filter((c) => c.id === fullscreenCamera)
    : displayCameras;

  const recentEvents = events.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Live Monitoring</h2>
          <p className="text-sm text-muted-foreground">
            {cameras.filter((c) => c.status === "online").length} of {cameras.length} cameras online
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedCamera} onValueChange={setSelectedCamera}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Cameras" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cameras</SelectItem>
              {cameras.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!fullscreenCamera && (
            <div className="flex rounded-lg border border-border">
              <Button
                variant={gridSize === "2x2" ? "default" : "ghost"}
                size="sm"
                onClick={() => setGridSize("2x2")}
              >
                <Grid2x2 className="h-4 w-4" />
              </Button>
              <Button
                variant={gridSize === "3x3" ? "default" : "ghost"}
                size="sm"
                onClick={() => setGridSize("3x3")}
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
            </div>
          )}
          {fullscreenCamera && (
            <Button variant="outline" size="sm" onClick={() => setFullscreenCamera(null)}>
              <Minimize2 className="mr-1 h-4 w-4" /> Exit Fullscreen
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        <div className={`lg:col-span-3`}>
          {camerasToShow.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Camera className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">No cameras to display</p>
              </CardContent>
            </Card>
          ) : (
            <div className={`grid ${gridClass} gap-3`}>
              {camerasToShow.map((cam) => (
                <Card key={cam.id} className="glass-card overflow-hidden">
                  <div className={`relative ${fullscreenCamera ? "aspect-video" : "aspect-video"} bg-background`}>
                    <CameraFeedPlayer streamUrl={cam.stream_url} name={cam.name} status={cam.status} />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/90 to-transparent p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{cam.name}</p>
                          {cam.location && <p className="text-[10px] text-muted-foreground">{cam.location}</p>}
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant={cam.status === "online" ? "default" : "destructive"} className="text-[10px]">
                            {cam.status}
                          </Badge>
                          {!fullscreenCamera && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setFullscreenCamera(cam.id)}
                            >
                              <Maximize2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    {cam.is_recording && (
                      <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-destructive/80 px-1.5 py-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                        <span className="text-[9px] font-bold text-white">REC</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Event sidebar */}
        <div className="lg:col-span-1">
          <Card className="glass-card">
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" /> Recent Events
              </h3>
              {recentEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events yet</p>
              ) : (
                <div className="space-y-3">
                  {recentEvents.map((evt) => (
                    <div key={evt.id} className="rounded-lg border border-border bg-muted/30 p-2.5">
                      <div className="flex items-start justify-between">
                        <Badge
                          variant={evt.severity === "critical" ? "destructive" : "secondary"}
                          className="text-[9px]"
                        >
                          {evt.event_type.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground">
                          {format(new Date(evt.detected_at), "HH:mm")}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {evt.cameras?.name || "Unknown camera"}
                      </p>
                      {evt.description && (
                        <p className="mt-0.5 text-[10px] text-foreground/70">{evt.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CameraLive;
