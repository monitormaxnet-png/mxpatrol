import { useEffect, useRef, useState } from "react";
import { MapPin, Clock, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GuardPosition } from "@/hooks/useGuardPositions";

interface GuardPositionsPanelProps {
  positions: GuardPosition[];
  onSelectGuard?: (guardId: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const GuardPositionsPanel = ({ positions, onSelectGuard }: GuardPositionsPanelProps) => {
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const prevPositionsRef = useRef<Map<string, string>>(new Map());

  // Detect guard position changes and highlight
  useEffect(() => {
    const prev = prevPositionsRef.current;
    const newHighlights = new Set<string>();

    positions.forEach((g) => {
      const key = `${g.lat},${g.lng}`;
      const oldKey = prev.get(g.guard_id);
      if (oldKey && oldKey !== key) {
        newHighlights.add(g.guard_id);
      }
      prev.set(g.guard_id, key);
    });

    if (newHighlights.size > 0) {
      setHighlighted(newHighlights);
      const timer = setTimeout(() => setHighlighted(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [positions]);

  const sorted = [...positions].sort(
    (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-success" />
          <h4 className="text-xs font-semibold text-foreground">Guard Positions</h4>
        </div>
        <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-medium text-success">
          {positions.length} active
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {sorted.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No guard positions yet
            </p>
          )}
          {sorted.map((g) => {
            const isHighlighted = highlighted.has(g.guard_id);
            return (
              <button
                key={g.guard_id}
                onClick={() => onSelectGuard?.(g.guard_id)}
                className={`group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-all duration-300 ${
                  isHighlighted
                    ? "bg-success/15 ring-1 ring-success/40"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="relative shrink-0">
                  <div
                    className={`h-8 w-8 rounded-full bg-success/20 flex items-center justify-center text-[10px] font-bold text-success ${
                      isHighlighted ? "animate-pulse" : ""
                    }`}
                  >
                    {g.badge_number.slice(-2)}
                  </div>
                  {isHighlighted && (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-background" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {g.full_name}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(g.scanned_at)}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default GuardPositionsPanel;
