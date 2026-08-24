import { useMemo, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScanDataLogField, ScanDataLogForm } from "@/lib/scanResult";

type Props = {
  form: ScanDataLogForm;
  checkpointName: string;
  submitting: boolean;
  onSubmit: (responses: Record<string, unknown>) => void;
  onCancel: () => void;
};

const YES_NO = ["Yes", "No"];
const PASS_FAIL = ["Pass", "Fail"];

const optionsFor = (field: ScanDataLogField): string[] => {
  if (field.options.length) return field.options;
  if (field.field_type === "yes_no") return YES_NO;
  if (field.field_type === "pass_fail") return PASS_FAIL;
  return [];
};

const isNumeric = (field: ScanDataLogField) =>
  ["number", "temperature", "meter_reading", "quantity"].includes(field.field_type);

export const DataLogFormOverlay = ({ form, checkpointName, submitting, onSubmit, onCancel }: Props) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(
    () => [...form.fields].sort((a, b) => a.sequence_order - b.sequence_order),
    [form.fields],
  );

  const setValue = (id: string, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
    setError(null);
  };

  const handleSubmit = () => {
    const missing = fields.find((field) => field.required && !(values[field.id] ?? "").trim());
    if (missing) {
      setError(`${missing.label} is required`);
      return;
    }
    const badNumber = fields.find(
      (field) => isNumeric(field) && (values[field.id] ?? "").trim() && !/^-?\d+(\.\d+)?$/.test(values[field.id].trim()),
    );
    if (badNumber) {
      setError(`${badNumber.label} must be numeric`);
      return;
    }

    const responses: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = (values[field.id] ?? "").trim();
      if (!raw) continue;
      responses[field.id] = isNumeric(field) ? Number(raw) : raw;
    }
    onSubmit(responses);
  };

  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-black/85 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-bold text-white">{form.name}</p>
          <p className="text-xs text-white/70">{checkpointName} · complete this form to finish the checkpoint</p>
        </div>
      </div>

      <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
        {fields.map((field) => {
          const options = optionsFor(field);
          return (
            <div key={field.id} className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-white/80">
                {field.label}
                {field.required ? <span className="ml-1 text-destructive">*</span> : null}
              </Label>

              {options.length > 0 ? (
                <Select value={values[field.id] ?? ""} onValueChange={(value) => setValue(field.id, value)}>
                  <SelectTrigger className="border-white/15 bg-white/5 text-sm text-white">
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.field_type === "long_text" ? (
                <Textarea
                  rows={3}
                  value={values[field.id] ?? ""}
                  onChange={(event) => setValue(field.id, event.target.value)}
                  className="border-white/15 bg-white/5 text-sm text-white"
                />
              ) : (
                <Input
                  type={isNumeric(field) ? "number" : field.field_type === "date" ? "date" : field.field_type === "time" ? "time" : "text"}
                  inputMode={isNumeric(field) ? "decimal" : undefined}
                  value={values[field.id] ?? ""}
                  onChange={(event) => setValue(field.id, event.target.value)}
                  className="border-white/15 bg-white/5 text-sm text-white"
                />
              )}
            </div>
          );
        })}
      </div>

      {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button className="flex-1" size="sm" disabled={submitting} onClick={handleSubmit}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Submit Data Log
        </Button>
        <Button variant="ghost" size="sm" className="text-xs text-white/65" disabled={submitting} onClick={onCancel}>
          Later
        </Button>
      </div>
    </div>
  );
};

export default DataLogFormOverlay;
