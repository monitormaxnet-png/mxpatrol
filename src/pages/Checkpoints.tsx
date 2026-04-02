import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Plus, Loader2, Pencil, Trash2, Scan, Wifi, WifiOff, CheckCircle2, XCircle } from "lucide-react";
import { useCheckpoints, usePatrols } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUserRole } from "@/hooks/useUserRole";
import { useNfcReader, type NfcStatus } from "@/hooks/useNfcReader";

type CheckpointForm = {
  name: string;
  nfc_tag_id: string;
  location_lat: string;
  location_lng: string;
  patrol_id: string;
  sort_order: string;
};

const emptyForm: CheckpointForm = { name: "", nfc_tag_id: "", location_lat: "", location_lng: "", patrol_id: "", sort_order: "0" };

const NfcScanButton = ({ onTagScanned, currentTag }: { onTagScanned: (tag: string) => void; currentTag: string }) => {
  const { status, lastTag, errorMessage, supported, startScanning, stopScanning } = useNfcReader({
    onScan: (result) => {
      onTagScanned(result.serialNumber);
      stopScanning();
    },
  });

  const isScanning = status === "scanning";
  const isSuccess = status === "success";
  const isError = status === "error" || status === "unsupported" || status === "disabled";

  return (
    <div className="space-y-2">
      <Label>NFC Tag ID</Label>
      <div className="flex gap-2">
        <Input
          value={currentTag}
          readOnly
          placeholder="Tap 'Scan' to read NFC tag"
          className="bg-muted/50 font-mono text-sm"
        />
        <Button
          type="button"
          variant={isScanning ? "destructive" : "default"}
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={isScanning ? stopScanning : startScanning}
        >
          <Scan className="h-4 w-4" />
          {isScanning ? "Stop" : "Scan"}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {isScanning && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
          >
            <motion.div
              className="h-2.5 w-2.5 rounded-full bg-primary"
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
            <span className="text-xs font-medium text-primary">Waiting for tag…</span>
          </motion.div>
        )}

        {isSuccess && (
          <motion.div
            key="success"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2"
          >
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-xs font-medium text-green-500">Tag detected: {lastTag}</span>
          </motion.div>
        )}

        {isError && (
          <motion.div
            key="error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2"
          >
            <XCircle className="h-4 w-4 text-destructive" />
            <span className="text-xs font-medium text-destructive">{errorMessage || "Failed to read tag"}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {!supported && (
        <p className="text-xs text-muted-foreground">
          NFC not supported — you can type a tag ID manually below.
        </p>
      )}
    </div>
  );
};

const Checkpoints = () => {
  const { data: checkpoints = [], isLoading } = useCheckpoints();
  const { data: patrols = [] } = usePatrols();
  const { canManage } = useUserRole();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CheckpointForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (cp: typeof checkpoints[0]) => {
    setEditId(cp.id);
    setForm({
      name: cp.name,
      nfc_tag_id: cp.nfc_tag_id,
      location_lat: cp.location_lat?.toString() || "",
      location_lng: cp.location_lng?.toString() || "",
      patrol_id: cp.patrol_id || "",
      sort_order: cp.sort_order?.toString() || "0",
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.nfc_tag_id) {
      toast.error("Name and NFC Tag ID are required");
      return;
    }
    setSaving(true);

    const { data: profile } = await supabase.from("profiles").select("company_id").single();
    if (!profile?.company_id) { toast.error("No company associated"); setSaving(false); return; }

    const payload = {
      company_id: profile.company_id,
      name: form.name,
      nfc_tag_id: form.nfc_tag_id,
      location_lat: form.location_lat ? parseFloat(form.location_lat) : null,
      location_lng: form.location_lng ? parseFloat(form.location_lng) : null,
      patrol_id: form.patrol_id || null,
      sort_order: parseInt(form.sort_order) || 0,
    };

    const { error } = editId
      ? await supabase.from("checkpoints").update(payload).eq("id", editId)
      : await supabase.from("checkpoints").insert(payload);

    setSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success(editId ? "Checkpoint updated" : "Checkpoint created");
      setForm(emptyForm);
      setEditId(null);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["checkpoints"] });
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    const { error } = await supabase.from("checkpoints").delete().eq("id", id);
    setDeleting(null);
    if (error) toast.error("Failed to delete: " + error.message);
    else {
      toast.success("Checkpoint deleted");
      queryClient.invalidateQueries({ queryKey: ["checkpoints"] });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Checkpoint Management</h2>
          <p className="text-sm text-muted-foreground">Manage NFC checkpoints and patrol routes</p>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <button onClick={openCreate} className="flex h-9 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" />
                New Checkpoint
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editId ? "Edit Checkpoint" : "Create Checkpoint"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Entrance Gate" /></div>

                {/* NFC Scan section */}
                <NfcScanButton
                  currentTag={form.nfc_tag_id}
                  onTagScanned={(tag) => setForm((f) => ({ ...f, nfc_tag_id: tag }))}
                />
                {/* Manual fallback for unsupported devices */}
                {!nfcSupported && (
                  <div>
                    <Label>Manual Tag ID</Label>
                    <Input
                      value={form.nfc_tag_id}
                      onChange={(e) => setForm({ ...form, nfc_tag_id: e.target.value })}
                      placeholder="NFC-A001"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Latitude</Label><Input type="number" step="any" value={form.location_lat} onChange={(e) => setForm({ ...form, location_lat: e.target.value })} /></div>
                  <div><Label>Longitude</Label><Input type="number" step="any" value={form.location_lng} onChange={(e) => setForm({ ...form, location_lng: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Assign to Patrol</Label>
                  <Select value={form.patrol_id} onValueChange={(v) => setForm({ ...form, patrol_id: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Select patrol (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {patrols.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
                <Button onClick={handleSave} disabled={saving || !form.nfc_tag_id} className="w-full">
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editId ? "Update Checkpoint" : "Create Checkpoint"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="space-y-3">
        {checkpoints.map((cp, i) => (
          <motion.div key={cp.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="glass-card p-4 lg:p-5">
            <div className="flex items-center gap-3 lg:gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 lg:h-10 lg:w-10">
                <MapPin className="h-4 w-4 text-primary lg:h-5 lg:w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-heading text-sm font-semibold text-foreground">{cp.name}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Scan className="h-3 w-3" />{cp.nfc_tag_id}</span>
                  {cp.location_lat && cp.location_lng && (
                    <span>({cp.location_lat.toFixed(4)}, {cp.location_lng.toFixed(4)})</span>
                  )}
                  <span>Order: {cp.sort_order}</span>
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(cp)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(cp.id)}
                    disabled={deleting === cp.id}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    {deleting === cp.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {!isLoading && checkpoints.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">No checkpoints configured yet</div>
        )}
      </div>
    </div>
  );
};

export default Checkpoints;
