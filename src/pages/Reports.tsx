import { motion } from "framer-motion";
import { FileText, Download, Calendar, Clock } from "lucide-react";

const reports = [
  { id: "RPT-024", title: "Daily Patrol Summary — March 25", type: "Daily", generated: "Today, 06:00", pages: 12 },
  { id: "RPT-023", title: "Weekly Security Overview", type: "Weekly", generated: "Mar 24, 08:00", pages: 28 },
  { id: "RPT-022", title: "AI Anomaly Report — Zone C", type: "AI Generated", generated: "Mar 23, 14:30", pages: 8 },
  { id: "RPT-021", title: "Guard Performance Report — March", type: "Monthly", generated: "Mar 22, 09:00", pages: 34 },
  { id: "RPT-020", title: "Incident Analysis — Q1 2026", type: "Quarterly", generated: "Mar 20, 10:00", pages: 52 },
];

const Reports = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Reports</h2>
          <p className="text-sm text-muted-foreground">AI-generated patrol and security reports</p>
        </div>
        <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <FileText className="h-4 w-4" />
          Generate Report
        </button>
      </div>

      <div className="space-y-3">
        {reports.map((report, i) => (
          <motion.div
            key={report.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card flex items-center gap-5 p-5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-heading text-sm font-semibold text-foreground">{report.title}</p>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5">{report.type}</span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{report.generated}</span>
                <span>{report.pages} pages</span>
              </div>
            </div>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
              <Download className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Reports;
