import { motion } from "framer-motion";
import { Scan, WifiOff, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";

type ScanLogEntry = {
  id: string;
  checkpointName: string;
  timestamp: string;
  valid: boolean;
  offline?: boolean;
};

interface ScanLogProps {
  entries: ScanLogEntry[];
}

const ScanLog = ({ entries }: ScanLogProps) => {
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="font-heading text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Session Log
      </h3>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {entries.map((entry, idx) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.03 }}
            className="glass-card flex items-center gap-2.5 px-3 py-2"
          >
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${entry.valid ? "bg-success/10" : "bg-destructive/10"}`}>
              {entry.valid ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {entry.checkpointName}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {entry.offline && <WifiOff className="h-3 w-3 text-muted-foreground/50" />}
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(entry.timestamp), "HH:mm:ss")}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default ScanLog;
export type { ScanLogEntry };
