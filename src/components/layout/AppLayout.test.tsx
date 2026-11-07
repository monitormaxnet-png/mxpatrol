import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AppLayout from './AppLayout';

vi.mock('@/hooks/useAlertNotifications', () => ({ useAlertNotifications: () => {} }));
vi.mock('@/hooks/useOnboardingStatus', () => ({
  useOnboardingStatus: () => ({ needsOnboarding: true, completeOnboarding: async () => {} }),
}));
vi.mock('@/components/onboarding/OnboardingWizard', () => ({
  default: () => <div>Onboarding Wizard</div>,
}));
vi.mock('./AppSidebar', () => ({ default: () => <nav>Sidebar</nav> }));
vi.mock('./TopBar', () => ({ default: () => <header>Top Bar</header> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/assistant" element={<div>Assistant Page</div>} />
          <Route path="/bulk-registration" element={<div>Bulk Registration Page</div>} />
          <Route path="/guards" element={<div>Guards Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('primary workspace routing', () => {
  it('opens bulk registration without the internal query flag or onboarding modal', () => {
    renderAt('/bulk-registration');
    expect(screen.getByText('Bulk Registration Page')).toBeInTheDocument();
    expect(screen.queryByText('Onboarding Wizard')).not.toBeInTheDocument();
  });

  it('keeps other maintenance routes behind the existing internal flag', async () => {
    renderAt('/guards');
    expect(await screen.findByText('Assistant Page')).toBeInTheDocument();
    expect(screen.queryByText('Guards Page')).not.toBeInTheDocument();
  });

  it('preserves internal access and onboarding on existing maintenance routes', () => {
    renderAt('/guards?internal=1');
    expect(screen.getByText('Guards Page')).toBeInTheDocument();
    expect(screen.getByText('Onboarding Wizard')).toBeInTheDocument();
  });
});
