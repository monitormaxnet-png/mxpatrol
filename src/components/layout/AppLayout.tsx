import { useState } from "react";
import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import TopBar from "./TopBar";
import { useAlertNotifications } from "@/hooks/useAlertNotifications";

const AppLayout = () => {
  useAlertNotifications();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background grid-pattern">
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col lg:pl-64">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
