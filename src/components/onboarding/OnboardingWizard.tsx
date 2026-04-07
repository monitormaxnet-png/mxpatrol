import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Building2, Users, MapPin, Smartphone, Route,
  ChevronRight, ChevronLeft, X, CheckCircle2, Plus, Trash2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const STEPS = [
  { label: "Company", icon: Building2 },
  { label: "Team", icon: Users },
  { label: "Checkpoints", icon: MapPin },
  { label: "Device", icon: Smartphone },
  { label: "Patrol", icon: Route },
];

interface OnboardingWizardProps {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Step 1: Company
  const [companyName, setCompanyName] = useState("");
  const [companyDomain, setCompanyDomain] = useState("");

  // Step 2: Team invites
  const [invites, setInvites] = useState([{ email: "", role: "guard" as "guard" | "supervisor" }]);

  // Step 3: Checkpoints
  const [checkpoints, setCheckpoints] = useState([{ name: "", nfc_tag_id: "" }]);

  // Step 4: Device QR
  const [qrToken, setQrToken] = useState("");

  // Step 5: Patrol
  const [patrolName, setPatrolName] = useState("");

  const progress = ((step + 1) / STEPS.length) * 100;

  const getCompanyId = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user!.id)
      .single();
    return data?.company_id;
  };

  const handleCompanySave = async () => {
    if (!companyName.trim()) {
      toast.error("Please enter a company name");
      return;
    }
    setLoading(true);
    try {
      const companyId = await getCompanyId();
      if (companyId) {
        await supabase
          .from("companies")
          .update({ name: companyName, domain: companyDomain || null })
          .eq("id", companyId);
      }
      toast.success("Company updated!");
      setStep(1);
    } catch {
      toast.error("Failed to save company");
    } finally {
      setLoading(false);
    }
  };

  const handleTeamSave = async () => {
    const validInvites = invites.filter((i) => i.email.trim());
    if (validInvites.length > 0) {
      toast.success(`${validInvites.length} invite(s) noted — share login link with your team.`);
    }
    setStep(2);
  };

  const handleCheckpointsSave = async () => {
    const valid = checkpoints.filter((c) => c.name.trim() && c.nfc_tag_id.trim());
    if (valid.length === 0) {
      setStep(3);
      return;
    }
    setLoading(true);
    try {
      const companyId = await getCompanyId();
      if (!companyId) throw new Error("No company");
      const inserts = valid.map((c, i) => ({
        company_id: companyId,
        name: c.name,
        nfc_tag_id: c.nfc_tag_id,
        sort_order: i,
      }));
      const { error } = await supabase.from("checkpoints").insert(inserts);
      if (error) throw error;
      toast.success(`${valid.length} checkpoint(s) created!`);
      setStep(3);
    } catch {
      toast.error("Failed to save checkpoints");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQR = async () => {
    setLoading(true);
    try {
      const companyId = await getCompanyId();
      if (!companyId) throw new Error("No company");

      const nonce = crypto.randomUUID();
      const exp = Math.floor(Date.now() / 1000) + 600; // 10 min
      const payload = { tid: companyId, app: "guard_device", nonce, exp };
      const payloadB64 = btoa(JSON.stringify(payload));

      // Store token (simplified — full HMAC done server-side)
      const token = `${payloadB64}.placeholder`;

      const { error } = await supabase.from("enrollment_tokens").insert({
        company_id: companyId,
        token,
        nonce,
        expires_at: new Date(exp * 1000).toISOString(),
        app_type: "guard_device",
        created_by: user!.id,
      });

      if (error) throw error;
      setQrToken(token);
      toast.success("QR code generated!");
    } catch {
      toast.error("Failed to generate QR code");
    } finally {
      setLoading(false);
    }
  };

  const handlePatrolSave = async () => {
    if (!patrolName.trim()) {
      onComplete();
      return;
    }
    setLoading(true);
    try {
      const companyId = await getCompanyId();
      if (!companyId) throw new Error("No company");
      const { error } = await supabase.from("patrols").insert({
        company_id: companyId,
        name: patrolName,
        status: "scheduled",
      });
      if (error) throw error;
      toast.success("First patrol created!");
      onComplete();
    } catch {
      toast.error("Failed to create patrol");
    } finally {
      setLoading(false);
    }
  };

  const StepIndicator = () => (
    <div className="space-y-4">
      <Progress value={progress} className="h-1.5" />
      <div className="flex justify-between">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex flex-col items-center gap-1">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                i <= step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className="text-[10px] text-muted-foreground hidden sm:block">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg space-y-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-heading text-lg font-bold text-foreground">Welcome to SENTINEL</h2>
              <p className="text-xs text-muted-foreground">Let's set up your organization</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onComplete} title="Skip setup">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <StepIndicator />

        <AnimatePresence mode="wait">
          {/* Step 1: Company */}
          {step === 0 && (
            <motion.div key="company" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="text-center mb-4">
                    <Building2 className="mx-auto h-10 w-10 text-primary mb-2" />
                    <h3 className="font-bold text-foreground">Company Setup</h3>
                    <p className="text-sm text-muted-foreground">Configure your organization details</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Company Name *</Label>
                    <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Security Services" />
                  </div>
                  <div className="space-y-2">
                    <Label>Domain (optional)</Label>
                    <Input value={companyDomain} onChange={(e) => setCompanyDomain(e.target.value)} placeholder="acmesecurity.com" />
                  </div>
                  <Button className="w-full" onClick={handleCompanySave} disabled={loading}>
                    Continue <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 2: Team */}
          {step === 1 && (
            <motion.div key="team" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="text-center mb-4">
                    <Users className="mx-auto h-10 w-10 text-primary mb-2" />
                    <h3 className="font-bold text-foreground">Invite Your Team</h3>
                    <p className="text-sm text-muted-foreground">Add supervisors and guards (you can do this later too)</p>
                  </div>
                  {invites.map((invite, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={invite.email}
                        onChange={(e) => {
                          const next = [...invites];
                          next[i].email = e.target.value;
                          setInvites(next);
                        }}
                        placeholder="email@example.com"
                        className="flex-1"
                      />
                      <select
                        value={invite.role}
                        onChange={(e) => {
                          const next = [...invites];
                          next[i].role = e.target.value as any;
                          setInvites(next);
                        }}
                        className="rounded-md border border-input bg-background px-2 text-sm text-foreground"
                      >
                        <option value="guard">Guard</option>
                        <option value="supervisor">Supervisor</option>
                      </select>
                      {invites.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => setInvites(invites.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setInvites([...invites, { email: "", role: "guard" }])}>
                    <Plus className="mr-2 h-3 w-3" /> Add another
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setStep(0)}>
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button className="flex-1" onClick={handleTeamSave}>
                      Continue <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 3: Checkpoints */}
          {step === 2 && (
            <motion.div key="checkpoints" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="text-center mb-4">
                    <MapPin className="mx-auto h-10 w-10 text-primary mb-2" />
                    <h3 className="font-bold text-foreground">Create Checkpoints</h3>
                    <p className="text-sm text-muted-foreground">Add NFC checkpoint locations for patrols</p>
                  </div>
                  {checkpoints.map((cp, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={cp.name}
                        onChange={(e) => {
                          const next = [...checkpoints];
                          next[i].name = e.target.value;
                          setCheckpoints(next);
                        }}
                        placeholder="e.g. Main Entrance"
                        className="flex-1"
                      />
                      <Input
                        value={cp.nfc_tag_id}
                        onChange={(e) => {
                          const next = [...checkpoints];
                          next[i].nfc_tag_id = e.target.value;
                          setCheckpoints(next);
                        }}
                        placeholder="NFC Tag ID"
                        className="flex-1"
                      />
                      {checkpoints.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => setCheckpoints(checkpoints.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setCheckpoints([...checkpoints, { name: "", nfc_tag_id: "" }])}>
                    <Plus className="mr-2 h-3 w-3" /> Add checkpoint
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button className="flex-1" onClick={handleCheckpointsSave} disabled={loading}>
                      Continue <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 4: Device enrollment */}
          {step === 3 && (
            <motion.div key="device" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="text-center mb-4">
                    <Smartphone className="mx-auto h-10 w-10 text-primary mb-2" />
                    <h3 className="font-bold text-foreground">Enroll First Device</h3>
                    <p className="text-sm text-muted-foreground">Generate a QR code for guard device enrollment</p>
                  </div>

                  {qrToken ? (
                    <div className="flex flex-col items-center gap-4">
                      <div className="rounded-xl border border-border bg-white p-4">
                        <QRCodeSVG value={qrToken} size={200} />
                      </div>
                      <p className="text-xs text-muted-foreground text-center">
                        Scan this QR code from the guard's device at <strong>/enroll</strong>
                      </p>
                      <Badge variant="outline">Expires in 10 minutes</Badge>
                    </div>
                  ) : (
                    <Button className="w-full" onClick={handleGenerateQR} disabled={loading}>
                      <Smartphone className="mr-2 h-4 w-4" /> Generate QR Code
                    </Button>
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button className="flex-1" onClick={() => setStep(4)}>
                      {qrToken ? "Continue" : "Skip"} <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 5: First Patrol */}
          {step === 4 && (
            <motion.div key="patrol" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="text-center mb-4">
                    <Route className="mx-auto h-10 w-10 text-primary mb-2" />
                    <h3 className="font-bold text-foreground">Create First Patrol</h3>
                    <p className="text-sm text-muted-foreground">Set up your first patrol route (optional)</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Patrol Name</Label>
                    <Input value={patrolName} onChange={(e) => setPatrolName(e.target.value)} placeholder="e.g. Night Perimeter Patrol" />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setStep(3)}>
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button className="flex-1" onClick={handlePatrolSave} disabled={loading}>
                      {patrolName.trim() ? "Complete Setup" : "Finish"} <CheckCircle2 className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-xs text-muted-foreground">
          You can always configure these settings later from the Settings page.
        </p>
      </motion.div>
    </div>
  );
}
