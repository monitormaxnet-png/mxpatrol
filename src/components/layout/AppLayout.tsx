import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import TopBar from './TopBar';
import { useAlertNotifications } from '@/hooks/useAlertNotifications';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';

const AppLayout = () => {
  useAlertNotifications();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { needsOnboarding, completeOnboarding } = useOnboardingStatus();
  const [showOnboarding, setShowOnboarding] = useState(true);
  const location = useLocation();
  const aiFirstCommandCenter = location.pathname === '/assistant' || location.pathname === '/dashboard' || location.pathname === '/command-center';
  const bulkRegistrationWorkspace = location.pathname === '/bulk-registration';
  const internalMaintenanceAccess = new URLSearchParams(location.search).get('internal') === '1';

  const handleOnboardingComplete = async () => {
    await completeOnboarding();
    setShowOnboarding(false);
  };

  if (!aiFirstCommandCenter && !bulkRegistrationWorkspace && !internalMaintenanceAccess) {
    return <Navigate to='/assistant' replace />;
  }

  if (aiFirstCommandCenter) {
    return (
      <div className='relative z-[1] min-h-screen bg-transparent'>
        <Outlet />
      </div>
    );
  }

  return (
    <div className='relative z-[1] flex min-h-screen bg-transparent grid-pattern'>
      {!bulkRegistrationWorkspace && needsOnboarding && showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className='flex flex-1 flex-col lg:pl-64'>
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className='flex-1 p-4 lg:p-6'>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
