// Canonical MX Patrol Data Log Form field vocabulary + validation.
// Shared by the management action service (Web AI + WhatsApp AI) so both
// surfaces validate identically. Field types mirror the DB check constraint on
// public.data_log_form_fields.field_type.

export type DataLogFieldTypeId =
  | "text"
  | "long_text"
  | "number"
  | "date"
  | "time"
  | "datetime"
  | "yes_no"
  | "dropdown"
  | "multiple_choice"
  | "checkbox"
  | "pass_fail"
  | "photo"
  | "signature"
  | "temperature"
  | "meter_reading"
  | "quantity";

export type DataLogFieldTypeDef = { id: DataLogFieldTypeId; label: string; needsOptions?: boolean };

export const DATA_LOG_FIELD_TYPES: DataLogFieldTypeDef[] = [
  { id: "text", label: "Text" },
  { id: "long_text", label: "Long Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "time", label: "Time" },
  { id: "datetime", label: "Date + Time" },
  { id: "yes_no", label: "Yes / No" },
  { id: "dropdown", label: "Dropdown", needsOptions: true },
  { id: "multiple_choice", label: "Multiple Choice", needsOptions: true },
  { id: "checkbox", label: "Checkbox" },
  { id: "pass_fail", label: "Pass / Fail" },
  { id: "photo", label: "Photo" },
  { id: "signature", label: "Signature" },
  { id: "temperature", label: "Temperature" },
  { id: "meter_reading", label: "Meter Reading" },
  { id: "quantity", label: "Quantity" },
];

export const DATA_LOG_FORM_TYPES = ["checklist", "data_entry", "mixed"] as const;

export function fieldTypeDef(value: unknown): DataLogFieldTypeDef | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s/+-]+/g, "_");
  const aliases: Record<string, DataLogFieldTypeId> = {
    date_time: "datetime",
    date_and_time: "datetime",
    yes_no_: "yes_no",
    yesno: "yes_no",
    yes: "yes_no",
    longtext: "long_text",
    multiline: "long_text",
    select: "dropdown",
    multi_choice: "multiple_choice",
    multiplechoice: "multiple_choice",
    passfail: "pass_fail",
    meter: "meter_reading",
    temp: "temperature",
    qty: "quantity",
  };
  const id = (aliases[raw] ?? raw) as DataLogFieldTypeId;
  return DATA_LOG_FIELD_TYPES.find((type) => type.id === id) ?? null;
}

/** Resolve a field type from a 1-based menu number or a name/id. */
export function pickFieldType(input: string): DataLogFieldTypeDef | null {
  const trimmed = String(input ?? "").trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= DATA_LOG_FIELD_TYPES.length) {
    return DATA_LOG_FIELD_TYPES[index - 1];
  }
  const lower = trimmed.toLowerCase();
  const byLabel = DATA_LOG_FIELD_TYPES.find((type) => type.label.toLowerCase() === lower);
  return byLabel ?? fieldTypeDef(trimmed);
}

export function fieldTypeNeedsOptions(value: unknown): boolean {
  return Boolean(fieldTypeDef(value)?.needsOptions);
}

export function parseOptions(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map((item) => String(item)) : String(input ?? "").split(/[,;|\n]/);
  const seen = new Set<string>();
  const options: string[] = [];
  for (const entry of raw) {
    const value = entry.trim().slice(0, 60);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(value);
  }
  return options.slice(0, 20);
}

export type RawFormField = {
  label?: unknown;
  field_type?: unknown;
  required?: unknown;
  sequence_order?: unknown;
  options_json?: unknown;
  options?: unknown;
  placeholder?: unknown;
};

export type NormalizedFormField = {
  label: string;
  field_type: DataLogFieldTypeId;
  required: boolean;
  sequence_order: number;
  options_json: string[];
  placeholder: string | null;
};

export class DataLogFieldError extends Error {
  status = 400;
}

/**
 * Validate + resequence fields. Sequence order is always rewritten to a dense
 * 1..n sequence so duplicate/missing orders can never violate the
 * (form_id, sequence_order) unique constraint.
 */
export function normalizeFormFields(fields: unknown): NormalizedFormField[] {
  const list = Array.isArray(fields) ? fields : [];
  if (!list.length) throw new DataLogFieldError("A Data Log Form needs at least one field");
  if (list.length > 40) throw new DataLogFieldError("A Data Log Form supports at most 40 fields");

  // Preserve any explicit ordering the caller supplied, then densify.
  const ordered = list
    .map((field, index) => ({ field: field as RawFormField, index }))
    .sort((a, b) => {
      const aOrder = Number((a.field as RawFormField).sequence_order);
      const bOrder = Number((b.field as RawFormField).sequence_order);
      const aKey = Number.isFinite(aOrder) ? aOrder : a.index + 1;
      const bKey = Number.isFinite(bOrder) ? bOrder : b.index + 1;
      return aKey === bKey ? a.index - b.index : aKey - bKey;
    });

  return ordered.map(({ field }, position) => {
    const label = String(field.label ?? "").trim().slice(0, 120);
    if (label.length < 2) throw new DataLogFieldError("Every field needs a label of at least 2 characters");
    const type = fieldTypeDef(field.field_type);
    if (!type) throw new DataLogFieldError(`Unsupported field type for "${label}"`);
    const options = parseOptions(field.options_json ?? field.options ?? []);
    if (type.needsOptions && options.length < 2) {
      throw new DataLogFieldError(`"${label}" (${type.label}) needs at least two options`);
    }
    return {
      label,
      field_type: type.id,
      required: field.required === true || field.required === "true" || field.required === "yes",
      sequence_order: position + 1,
      options_json: type.needsOptions ? options : options,
      placeholder: typeof field.placeholder === "string" && field.placeholder.trim() ? field.placeholder.trim().slice(0, 120) : null,
    };
  });
}

export function normalizeFormType(value: unknown, fields: NormalizedFormField[]): "checklist" | "data_entry" | "mixed" {
  const raw = String(value ?? "").trim().toLowerCase();
  if ((DATA_LOG_FORM_TYPES as readonly string[]).includes(raw)) return raw as "checklist" | "data_entry" | "mixed";
  const checklistTypes = new Set(["yes_no", "pass_fail", "checkbox"]);
  const checklist = fields.filter((field) => checklistTypes.has(field.field_type)).length;
  if (checklist === fields.length) return "checklist";
  if (checklist === 0) return "data_entry";
  return "mixed";
}
