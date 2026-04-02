import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGuards } from "@/hooks/useDashboardData";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";

const deviceSchema = z.object({
  device_name: z.string().min(1, "Device name is required").max(100),
  device_type: z.enum(["mobile", "pda", "nfc_reader", "tablet"]),
  device_identifier: z.string().min(1, "Device identifier is required").max(100),
  serial_number: z.string().max(100).optional().or(z.literal("")),
  site_location: z.string().max(200).optional().or(z.literal("")),
  guard_id: z.string().optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

type DeviceFormValues = z.infer<typeof deviceSchema>;

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editDevice?: any;
}

export default function DeviceRegistrationDialog({ open, onOpenChange, editDevice }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: guards = [] } = useGuards();
  const isEdit = !!editDevice;

  const form = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceSchema),
    defaultValues: {
      device_name: editDevice?.device_name || "",
      device_type: editDevice?.device_type || "mobile",
      device_identifier: editDevice?.device_identifier || "",
      serial_number: editDevice?.serial_number || "",
      site_location: editDevice?.site_location || "",
      guard_id: editDevice?.guard_id || "",
      notes: editDevice?.notes || "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: DeviceFormValues) => {
      // Get user's company_id
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user!.id)
        .single();

      if (!profile?.company_id) throw new Error("No company found");

      const payload: any = {
        device_name: values.device_name,
        device_type: values.device_type,
        device_identifier: values.device_identifier,
        serial_number: values.serial_number || null,
        site_location: values.site_location || null,
        guard_id: values.guard_id || null,
        notes: values.notes || null,
        company_id: profile.company_id,
      };

      if (isEdit) {
        const { error } = await supabase.from("devices").update(payload).eq("id", editDevice.id);
        if (error) throw error;
      } else {
        const pairingCode = generatePairingCode();
        payload.pairing_code = pairingCode;
        payload.pairing_status = "pending";
        payload.pairing_expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const { error } = await supabase.from("devices").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Device updated" : "Device registered successfully");
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      onOpenChange(false);
      form.reset();
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save device");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Device" : "Register New Device"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update device details" : "Register a new NFC patrol device to the platform"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="device_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Guard Phone #1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="device_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Device Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="mobile">Mobile</SelectItem>
                        <SelectItem value="pda">PDA</SelectItem>
                        <SelectItem value="nfc_reader">NFC Reader</SelectItem>
                        <SelectItem value="tablet">Tablet</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="device_identifier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Device ID</FormLabel>
                    <FormControl>
                      <Input placeholder="Unique identifier" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="serial_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serial / IMEI</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="site_location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assigned Site</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. HQ Building A" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="guard_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assign to Guard</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">Unassigned</SelectItem>
                      {guards.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.full_name} ({g.badge_number})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Optional notes..." rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? "Update" : "Register Device"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
