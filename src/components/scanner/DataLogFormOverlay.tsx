import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScanDataLogForm } from "@/lib/scanResult";

type Props = {
  form: ScanDataLogForm;
  checkpointName: string;
  submitting: boolean;
  onSubmit: (responses: Record<string, unknown>) => void;
  onCancel?: () => void;
};

export const DataLogFormOverlay = ({ form, submitting, onSubmit, onCancel }: Props) => {
  const field = useMemo(() => [...form.fields].sort((a, b) => a.sequence_order - b.sequence_order)[0], [form.fields]);
  const label = (field?.label || form.name || "Datalog").trim();
  const [value, setValue] = useState("");

  const cleanValue = value.trim();
  const handleSubmit = () => {
    if (!cleanValue || submitting) return;
    onSubmit({
      datalog_value: cleanValue,
      datalog_label: label,
      ...(field?.id ? { [field.id]: cleanValue } : {}),
    });
  };

  return (
    <section className="rg360-data-log" aria-label="Checkpoint data log">
      <div className="rg360-form-fields">
        <div className="rg360-form-field">
          <label htmlFor="simple-datalog-value">{label.toUpperCase()}</label>
          <Input
            id="simple-datalog-value"
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSubmit();
            }}
          />
        </div>
      </div>

      <div className="rg360-data-actions">
        <Button type="button" className="rg360-primary-action" disabled={submitting || !cleanValue} onClick={handleSubmit}>
          {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
          SUBMIT
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            LATER
          </Button>
        ) : null}
      </div>
    </section>
  );
};

export default DataLogFormOverlay;
