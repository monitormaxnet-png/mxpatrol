/**
 * Canonical MX Patrol Data Log Form field vocabulary for the client surfaces.
 * Mirrors supabase/functions/_shared/data-log-fields.ts (the server remains the
 * authority — it re-validates everything).
 */

export type DataLogFieldTypeId =
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'yes_no'
  | 'dropdown'
  | 'multiple_choice'
  | 'checkbox'
  | 'pass_fail'
  | 'photo'
  | 'signature'
  | 'temperature'
  | 'meter_reading'
  | 'quantity';

export type DataLogFieldTypeDef = { id: DataLogFieldTypeId; label: string; needsOptions?: boolean };

export const DATA_LOG_FIELD_TYPES: DataLogFieldTypeDef[] = [
  { id: 'text', label: 'Text' },
  { id: 'long_text', label: 'Long Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'datetime', label: 'Date + Time' },
  { id: 'yes_no', label: 'Yes / No' },
  { id: 'dropdown', label: 'Dropdown', needsOptions: true },
  { id: 'multiple_choice', label: 'Multiple Choice', needsOptions: true },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'pass_fail', label: 'Pass / Fail' },
  { id: 'photo', label: 'Photo' },
  { id: 'signature', label: 'Signature' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'meter_reading', label: 'Meter Reading' },
  { id: 'quantity', label: 'Quantity' },
];

export function fieldTypeById(id: unknown): DataLogFieldTypeDef | null {
  return DATA_LOG_FIELD_TYPES.find((type) => type.id === id) ?? null;
}

export function pickFieldType(input: string): DataLogFieldTypeDef | null {
  const trimmed = String(input ?? '').trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= DATA_LOG_FIELD_TYPES.length) {
    return DATA_LOG_FIELD_TYPES[index - 1];
  }
  const lower = trimmed.toLowerCase().replace(/[\s/+-]+/g, '_');
  return (
    DATA_LOG_FIELD_TYPES.find((type) => type.label.toLowerCase() === trimmed.toLowerCase()) ??
    DATA_LOG_FIELD_TYPES.find((type) => type.id === lower) ??
    null
  );
}

export function fieldTypeNeedsOptions(id: unknown): boolean {
  return Boolean(fieldTypeById(id)?.needsOptions);
}

export function parseFieldOptions(input: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const entry of String(input ?? '').split(/[,;|\n]/)) {
    const value = entry.trim().slice(0, 60);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(value);
  }
  return options.slice(0, 20);
}
