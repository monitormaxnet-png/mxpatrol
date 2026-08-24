import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import DevicePresenceHeartbeat from "@/components/devices/DevicePresenceHeartbeat";
import HardwareSosListener from "@/components/devices/HardwareSosListener";
import IncidentPhotoListener from "@/components/devices/IncidentPhotoListener";
import SystemFeedbackOverlay from "@/components/feedback/SystemFeedbackOverlay";
import PageTransition from "@/components/feedback/PageTransition";
import { LoadingState } from "@/components/feedback/FeedbackPrimitives";
import ErrorBoundary from "@/components/layout/ErrorBoundary";

const GuardDetail = lazy(() => import("./pages/GuardDetail"));
const Patrols = lazy(() => import("./pages/Patrols"));
const Schedules = lazy(() => import("./pages/Schedules"));
const RoutesPage = lazy(() => import("./pages/Routes"));
const Guards = lazy(() => import("./pages/Guards"));
const Checkpoints = lazy(() => import("./pages/Checkpoints"));
const Incidents = lazy(() => import("./pages/Incidents"));
const AIInsights = lazy(() => import("./pages/AIInsights"));
const Reports = lazy(() => import("./pages/Reports"));
const Devices = lazy(() => import("./pages/Devices"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Profile = lazy(() => import("./pages/Profile"));
const Shifts = lazy(() => import("./pages/Shifts"));
const ScanRecord = lazy(() => import("./pages/ScanRecord"));
const NFCScanner = lazy(() => import("./pages/NFCScanner"));
const Cameras = lazy(() => import("./pages/Cameras"));
const CameraLive = lazy(() => import("./pages/CameraLive"));
const CameraEvents = lazy(() => import("./pages/CameraEvents"));
const WhatsApp = lazy(() => import("./pages/WhatsApp"));
const EnrollPage = lazy(() => import("./pages/EnrollPage"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const LivePatrol = lazy(() => import("./pages/LivePatrol"));
const LiveMapPage = lazy(() => import("./pages/LiveMapPage"));
const SessionLogsPage = lazy(() => import("./pages/SessionLogsPage"));
const ScanLogs = lazy(() => import("./pages/ScanLogs"));
const SosAlerts = lazy(() => import("./pages/SosAlerts"));
const Companies = lazy(() => import("./pages/Companies"));
const InstallPage = lazy(() => import("./pages/InstallPage"));

const queryClient = new QueryClient();

const RouteLoading = () => (
  <div className="mx-auto w-full max-w-xl py-10">
    <LoadingState label="Loading page..." />
  </div>
);

const lazyRoute = (element: ReactNode) => (
  <ErrorBoundary label="route"><Suspense fallback={<RouteLoading />}><PageTransition>{element}</PageTransition></Suspense></ErrorBoundary>
);
const NativeScannerRouteGuard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || loading || user) return;

    const scannerSafePaths = new Set(["/", "/nfc-scanner", "/enroll", "/install"]);
    const supervisorLogin = location.pathname === "/login" && new URLSearchParams(location.search).get("supervisor") === "1";
    if (scannerSafePaths.has(location.pathname) || supervisorLogin) return;

    navigate("/nfc-scanner", { replace: true });
  }, [loading, location.pathname, location.search, navigate, user]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <NativeScannerRouteGuard />
          <IncidentPhotoListener />
          <SystemFeedbackOverlay />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={lazyRoute(<Login />)} />
            <Route path="/signup" element={lazyRoute(<Signup />)} />
            <Route path="/forgot-password" element={lazyRoute(<ForgotPassword />)} />
            <Route path="/reset-password" element={lazyRoute(<ResetPassword />)} />
            <Route path="/" element={lazyRoute(<NFCScanner />)} />
            <Route path="/nfc-scanner" element={lazyRoute(<NFCScanner />)} />
            <Route path="/enroll" element={lazyRoute(<EnrollPage />)} />
            <Route path="/install" element={lazyRoute(<InstallPage />)} />

            {/* Protected routes */}
            <Route
              element={
                <ProtectedRoute>
                  <>
                    <DevicePresenceHeartbeat />
                    <HardwareSosListener />
                    <ErrorBoundary label="app-layout"><AppLayout /></ErrorBoundary>
                  </>
                </ProtectedRoute>
              }
            >
              <Route path="/assistant" element={lazyRoute(<CommandCenter />)} />
              <Route path="/dashboard" element={lazyRoute(<CommandCenter />)} />
              <Route path="/live-patrol" element={lazyRoute(<LivePatrol />)} />
              <Route path="/session-logs" element={lazyRoute(<SessionLogsPage />)} />
              <Route path="/scan-logs" element={lazyRoute(<ScanLogs />)} />
              <Route path="/live-map" element={lazyRoute(<LiveMapPage />)} />
              <Route path="/sos-alerts" element={lazyRoute(<SosAlerts />)} />
              <Route path="/patrols" element={lazyRoute(<Patrols />)} />
              <Route path="/routes" element={lazyRoute(<RoutesPage />)} />
              <Route path="/schedules" element={lazyRoute(<Schedules />)} />
              <Route path="/patrols/templates" element={lazyRoute(<Patrols />)} />
              <Route path="/patrols/routes" element={lazyRoute(<Patrols />)} />
              <Route path="/patrols/schedules" element={lazyRoute(<Patrols />)} />
              <Route path="/patrols/sessions" element={lazyRoute(<Patrols />)} />
              <Route path="/guards" element={lazyRoute(<Guards />)} />
              <Route path="/guards/:id" element={lazyRoute(<GuardDetail />)} />
              <Route path="/checkpoints" element={lazyRoute(<Checkpoints />)} />
              <Route path="/shifts" element={lazyRoute(<Shifts />)} />
              <Route path="/incidents" element={lazyRoute(<Incidents />)} />
              <Route path="/scan" element={lazyRoute(<ScanRecord />)} />
              <Route path="/ai-insights" element={lazyRoute(<AIInsights />)} />
              <Route path="/reports" element={lazyRoute(<Reports />)} />
              <Route path="/cameras" element={lazyRoute(<Cameras />)} />
              <Route path="/cameras/live" element={lazyRoute(<CameraLive />)} />
              <Route path="/cameras/events" element={lazyRoute(<CameraEvents />)} />
              <Route path="/whatsapp" element={lazyRoute(<WhatsApp />)} />
              <Route path="/devices" element={lazyRoute(<Devices />)} />
              <Route path="/command-center" element={lazyRoute(<CommandCenter />)} />
              <Route path="/companies" element={lazyRoute(<Companies />)} />
              <Route path="/settings" element={lazyRoute(<SettingsPage />)} />
              <Route path="/profile" element={lazyRoute(<Profile />)} />
            </Route>

            <Route path="*" element={lazyRoute(<NotFound />)} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
