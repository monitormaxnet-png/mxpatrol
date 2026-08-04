import { MapPin } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSites } from "@/hooks/useSites";

type SiteSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
};

export default function SiteSelector({ value, onChange, className, label = "Site" }: SiteSelectorProps) {
  const { data: sites = [] } = useSites();

  return (
    <div className={className ?? "flex items-center gap-2"}>
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" /> {label}
      </span>
      <Select value={value === "all" ? undefined : value} onValueChange={onChange}>
        <SelectTrigger className="h-9 min-w-[160px]">
          <SelectValue placeholder="Select Site" />
        </SelectTrigger>
        <SelectContent>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

