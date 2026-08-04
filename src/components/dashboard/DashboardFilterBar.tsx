import { Download, Filter, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FilterOption = {
  value: string;
  label: string;
};

export type DashboardFilters = {
  checkpoint: string;
  device: string;
  startDate: string;
  endDate: string;
  status: string;
};

type DashboardFilterBarProps = {
  filters: DashboardFilters;
  checkpointLabel: string;
  checkpointAllLabel: string;
  deviceAllLabel?: string;
  statusAllLabel?: string;
  checkpointOptions: FilterOption[];
  deviceOptions: FilterOption[];
  statusOptions: FilterOption[];
  isRefreshing?: boolean;
  onFiltersChange: (filters: DashboardFilters) => void;
  onRefresh: () => void;
  onReset: () => void;
  onExport: () => void;
};

const inputClass =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus:ring-2 focus:ring-ring";

export default function DashboardFilterBar({
  filters,
  checkpointLabel,
  checkpointAllLabel,
  deviceAllLabel = "All Devices",
  statusAllLabel = "All Scans",
  checkpointOptions,
  deviceOptions,
  statusOptions,
  isRefreshing,
  onFiltersChange,
  onRefresh,
  onReset,
  onExport,
}: DashboardFilterBarProps) {
  const update = (patch: Partial<DashboardFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="border-b border-border/50 bg-background/30 px-5 py-4">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2 text-primary">
          <Filter className="h-5 w-5" />
          <h4 className="font-heading text-lg font-semibold">Filters</h4>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={onRefresh} disabled={isRefreshing} className="h-10">
            <RefreshCw className={isRefreshing ? "animate-spin" : ""} /> Refresh
          </Button>
          <Button type="button" variant="outline" onClick={onReset} className="h-10">
            Reset
          </Button>
          <Button type="button" variant="outline" onClick={onExport} className="h-10">
            <Download /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-2">
          <span className="text-sm font-semibold text-muted-foreground">{checkpointLabel}</span>
          <Select value={filters.checkpoint === "all" ? undefined : filters.checkpoint} onValueChange={(value) => update({ checkpoint: value })}>
            <SelectTrigger className="h-10 bg-muted/40">
              <SelectValue placeholder={`Select ${checkpointLabel}`} />
            </SelectTrigger>
            <SelectContent>
              {checkpointOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-muted-foreground">Device</span>
          <Select value={filters.device === "all" ? undefined : filters.device} onValueChange={(value) => update({ device: value })}>
            <SelectTrigger className="h-10 bg-muted/40">
              <SelectValue placeholder="Select Device" />
            </SelectTrigger>
            <SelectContent>
              {deviceOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-muted-foreground">Start Date</span>
          <input
            type="date"
            value={filters.startDate}
            onChange={(event) => update({ startDate: event.target.value })}
            className={inputClass}
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-muted-foreground">End Date</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(event) => update({ endDate: event.target.value })}
            className={inputClass}
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-muted-foreground">Status</span>
          <Select value={filters.status === "all" ? undefined : filters.status} onValueChange={(value) => update({ status: value })}>
            <SelectTrigger className="h-10 bg-muted/40">
              <SelectValue placeholder="Select Status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  );
}

