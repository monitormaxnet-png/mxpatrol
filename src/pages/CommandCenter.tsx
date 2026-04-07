import { useState } from "react";
import { motion } from "framer-motion";
import { Send, Terminal, Radio, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeviceRealtime } from "@/hooks/useDeviceRealtime";

import FleetOverview from "@/components/command-center/FleetOverview";
import CommandTracker from "@/components/command-center/CommandTracker";
import DeviceFleetList from "@/components/command-center/DeviceFleetList";
import BulkCommandDialog from "@/components/command-center/BulkCommandDialog";

export default function CommandCenter() {
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  useDeviceRealtime();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground flex items-center gap-2">
            <Terminal className="h-6 w-6 text-primary" />
            Command Center
          </h2>
          <p className="text-sm text-muted-foreground">
            Monitor fleet status, issue commands, and track execution in real-time
          </p>
        </div>
        <Button onClick={() => setCommandDialogOpen(true)}>
          <Send className="mr-2 h-4 w-4" /> Issue Command
        </Button>
      </div>

      {/* Fleet Overview Stats */}
      <FleetOverview />

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Command Tracker */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="glass-card h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" />
                Command Queue
              </CardTitle>
              <div className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <CommandTracker />
            </CardContent>
          </Card>
        </motion.div>

        {/* Device Fleet */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="glass-card h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4 text-primary" />
                Device Fleet
              </CardTitle>
              <div className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </div>
            </CardHeader>
            <CardContent>
              <DeviceFleetList />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <BulkCommandDialog open={commandDialogOpen} onOpenChange={setCommandDialogOpen} />
    </div>
  );
}
