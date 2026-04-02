import { useState } from "react";
import { Camera, Video, VideoOff, Plus, MapPin, Trash2, Settings, Wifi, WifiOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCameras, useAddCamera, useDeleteCamera, useCameraRealtimeSubscription } from "@/hooks/useCameraData";
import { useCheckpoints } from "@/hooks/useDashboardData";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const Cameras = () => {
  useCameraRealtimeSubscription();
  const { data: cameras = [], isLoading } = useCameras();
  const { data: checkpoints = [] } = useCheckpoints();
  const addCamera = useAddCamera();
  const deleteCamera = useDeleteCamera();
  const { role } = useUserRole();
  const navigate = useNavigate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    stream_url: "",
    ip_address: "",
    location: "",
    camera_type: "ip_camera",
    checkpoint_id: "",
  });

  const onlineCameras = cameras.filter((c) => c.status === "online").length;
  const offlineCameras = cameras.filter((c) => c.status === "offline").length;

  const handleAdd = async () => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", (await supabase.auth.getUser()).data.user?.id || "")
      .single();

    if (!profile?.company_id) {
      toast.error("Could not determine company");
      return;
    }

    addCamera.mutate(
      {
        name: form.name,
        stream_url: form.stream_url,
        ip_address: form.ip_address || undefined,
        location: form.location || undefined,
        camera_type: form.camera_type,
        checkpoint_id: form.checkpoint_id || undefined,
        company_id: profile.company_id,
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setForm({ name: "", stream_url: "", ip_address: "", location: "", camera_type: "ip_camera", checkpoint_id: "" });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">CCTV Cameras</h2>
          <p className="text-sm text-muted-foreground">Manage and monitor security cameras</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/cameras/live")}>
            <Eye className="mr-2 h-4 w-4" /> Live View
          </Button>
          {role === "admin" && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> Add Camera</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Camera</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Camera Name</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Front Gate Camera" />
                  </div>
                  <div>
                    <Label>Stream URL (HLS)</Label>
                    <Input value={form.stream_url} onChange={(e) => setForm({ ...form, stream_url: e.target.value })} placeholder="https://example.com/stream.m3u8" />
                  </div>
                  <div>
                    <Label>IP Address</Label>
                    <Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" />
                  </div>
                  <div>
                    <Label>Location</Label>
                    <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Building A, Floor 2" />
                  </div>
                  <div>
                    <Label>Camera Type</Label>
                    <Select value={form.camera_type} onValueChange={(v) => setForm({ ...form, camera_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ip_camera">IP Camera</SelectItem>
                        <SelectItem value="nvr">NVR/DVR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Link to Checkpoint</Label>
                    <Select value={form.checkpoint_id} onValueChange={(v) => setForm({ ...form, checkpoint_id: v })}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {checkpoints.map((cp) => (
                          <SelectItem key={cp.id} value={cp.id}>{cp.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full" onClick={handleAdd} disabled={!form.name || !form.stream_url || addCamera.isPending}>
                    {addCamera.isPending ? "Adding..." : "Add Camera"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="glass-card">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Camera className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{cameras.length}</p>
              <p className="text-xs text-muted-foreground">Total Cameras</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
              <Wifi className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{onlineCameras}</p>
              <p className="text-xs text-muted-foreground">Online</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
              <WifiOff className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{offlineCameras}</p>
              <p className="text-xs text-muted-foreground">Offline</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Camera Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="glass-card animate-pulse"><CardContent className="h-48" /></Card>
          ))}
        </div>
      ) : cameras.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <VideoOff className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold text-foreground">No cameras configured</h3>
            <p className="mt-1 text-sm text-muted-foreground">Add your first camera to start monitoring</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((cam) => (
            <Card key={cam.id} className="glass-card overflow-hidden">
              <div className="relative aspect-video bg-muted flex items-center justify-center">
                <Video className="h-8 w-8 text-muted-foreground" />
                <Badge
                  className="absolute right-2 top-2"
                  variant={cam.status === "online" ? "default" : "destructive"}
                >
                  {cam.status}
                </Badge>
                {cam.is_recording && (
                  <div className="absolute left-2 top-2 flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    <span className="text-[10px] font-semibold text-destructive">REC</span>
                  </div>
                )}
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">{cam.name}</h3>
                    {cam.location && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" /> {cam.location}
                      </p>
                    )}
                    {cam.checkpoints && (
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        Checkpoint: {cam.checkpoints.name}
                      </Badge>
                    )}
                  </div>
                  {role === "admin" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteCamera.mutate(cam.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">{cam.camera_type === "nvr" ? "NVR" : "IP Camera"}</Badge>
                  {cam.ip_address && <span>{cam.ip_address}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Cameras;
