import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import TopBar from "./TopBar";

const AppLayout = () => {
  return (
    <div className="flex min-h-screen bg-background grid-pattern">
      <AppSidebar />
      <div className="flex flex-1 flex-col pl-64">
        <TopBar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
