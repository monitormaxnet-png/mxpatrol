import { motion } from "framer-motion";
import { Maximize2 } from "lucide-react";
import { useGuards, useCheckpoints } from "@/hooks/useDashboardData";

const LiveMap = () => {
  const { data: guards = [] } = useGuards();
  const { data: checkpoints = [] } = useCheckpoints();

  const activeGuards = guards.filter((g) => g.is_active);

  // Distribute guards on map using a simple hash-based layout
  const getPosition = (id: string, index: number) => {
    const hash = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
    return {
      x: 10 + ((hash * 37 + index * 23) % 80),
      y: 10 + ((hash * 53 + index * 17) % 80),
    };
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h3 className="font-heading text-sm font-semibold text-foreground">Live Patrol Map</h3>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="relative flex-1 min-h-[300px] bg-muted/20 overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-50" />

        {/* Checkpoints */}
        {checkpoints.map((cp, i) => {
          const pos = getPosition(cp.id, i + 100);
          return (
            <div
              key={cp.id}
              className="absolute flex flex-col items-center"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)" }}
            >
              <div className="h-3 w-3 rotate-45 border border-muted-foreground/40 bg-muted/60" />
              <span className="mt-1 text-[9px] text-muted-foreground">{cp.name}</span>
            </div>
          );
        })}

        {/* Guards */}
        {activeGuards.map((guard, i) => {
          const pos = getPosition(guard.id, i);
          const status = guard.is_active ? "active" : "offline";
          return (
            <motion.div
              key={guard.id}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.1 }}
              className="absolute flex flex-col items-center"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)" }}
            >
              <div className="relative">
                <div className={`h-4 w-4 rounded-full ${status === "active" ? "bg-success" : "bg-muted-foreground"}`} />
                {status === "active" && (
                  <div className="absolute inset-0 animate-ping rounded-full bg-success opacity-30" />
                )}
              </div>
              <span className="mt-1 rounded bg-background/80 px-1 text-[9px] font-medium text-foreground">
                {guard.badge_number}
              </span>
            </motion.div>
          );
        })}

        {/* Empty state */}
        {activeGuards.length === 0 && checkpoints.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No guards or checkpoints yet
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex gap-4 rounded-md bg-background/80 px-3 py-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-success" />
            <span className="text-[10px] text-muted-foreground">Active ({activeGuards.length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Offline</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveMap;
