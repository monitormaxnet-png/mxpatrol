import { motion } from "framer-motion";
import { Maximize2 } from "lucide-react";

const guards = [
  { id: 1, name: "G-03", x: 25, y: 30, status: "active" },
  { id: 2, name: "G-08", x: 60, y: 45, status: "active" },
  { id: 3, name: "G-12", x: 40, y: 70, status: "warning" },
  { id: 4, name: "G-15", x: 75, y: 20, status: "active" },
  { id: 5, name: "G-07", x: 15, y: 60, status: "offline" },
];

const checkpoints = [
  { id: "A-1", x: 20, y: 25 },
  { id: "A-7", x: 70, y: 18 },
  { id: "B-4", x: 50, y: 50 },
  { id: "C-2", x: 30, y: 75 },
  { id: "D-2", x: 80, y: 65 },
];

const LiveMap = () => {
  return (
    <div className="glass-card flex flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h3 className="font-heading text-sm font-semibold text-foreground">Live Patrol Map</h3>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="relative flex-1 min-h-[300px] bg-muted/20 overflow-hidden">
        {/* Grid overlay */}
        <div className="absolute inset-0 grid-pattern opacity-50" />

        {/* Checkpoints */}
        {checkpoints.map((cp) => (
          <div
            key={cp.id}
            className="absolute flex flex-col items-center"
            style={{ left: `${cp.x}%`, top: `${cp.y}%`, transform: "translate(-50%, -50%)" }}
          >
            <div className="h-3 w-3 rotate-45 border border-muted-foreground/40 bg-muted/60" />
            <span className="mt-1 text-[9px] text-muted-foreground">{cp.id}</span>
          </div>
        ))}

        {/* Guards */}
        {guards.map((guard, i) => (
          <motion.div
            key={guard.id}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="absolute flex flex-col items-center"
            style={{ left: `${guard.x}%`, top: `${guard.y}%`, transform: "translate(-50%, -50%)" }}
          >
            <div className="relative">
              <div className={`h-4 w-4 rounded-full ${
                guard.status === "active" ? "bg-success" : guard.status === "warning" ? "bg-warning" : "bg-muted-foreground"
              }`} />
              {guard.status === "active" && (
                <div className="absolute inset-0 animate-ping rounded-full bg-success opacity-30" />
              )}
            </div>
            <span className="mt-1 rounded bg-background/80 px-1 text-[9px] font-medium text-foreground">{guard.name}</span>
          </motion.div>
        ))}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex gap-4 rounded-md bg-background/80 px-3 py-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-success" />
            <span className="text-[10px] text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-warning" />
            <span className="text-[10px] text-muted-foreground">Warning</span>
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
