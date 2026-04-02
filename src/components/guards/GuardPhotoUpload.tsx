import { useState, useRef } from "react";
import { Camera, Upload, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GuardPhotoUploadProps {
  guardId: string;
  currentPhotoUrl: string | null;
  onPhotoUpdated: (url: string) => void;
}

const GuardPhotoUpload = ({ guardId, currentPhotoUrl, onPhotoUpdated }: GuardPhotoUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentPhotoUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${guardId}/reference.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("guard-photos")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast.error("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("guard-photos").getPublicUrl(path);
    // Since bucket is private, use signed URL
    const { data: signedData } = await supabase.storage
      .from("guard-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 year

    const photoUrl = signedData?.signedUrl || urlData.publicUrl;

    const { error: updateError } = await supabase
      .from("guards")
      .update({ photo_url: photoUrl })
      .eq("id", guardId);

    if (updateError) {
      toast.error("Failed to save photo reference");
    } else {
      toast.success("Guard reference photo updated");
      setPreview(photoUrl);
      onPhotoUpdated(photoUrl);
    }
    setUploading(false);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Reference Photo (Face ID)
      </label>
      <div className="flex items-center gap-3">
        {preview ? (
          <div className="relative h-16 w-16 rounded-full overflow-hidden border-2 border-primary/30">
            <img src={preview} alt="Guard reference" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 bg-muted/20">
            <Camera className="h-6 w-6 text-muted-foreground" />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5 text-xs"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {preview ? "Replace Photo" : "Upload Photo"}
          </Button>
          <p className="text-[10px] text-muted-foreground">Clear front-facing photo required</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
    </div>
  );
};

export default GuardPhotoUpload;
