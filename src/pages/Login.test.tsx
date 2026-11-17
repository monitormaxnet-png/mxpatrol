import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Login from './Login';

const { signInWithPassword, toastError } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { signInWithPassword } },
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<p>Recovery page</p>} />
        <Route path="/signup" element={<p>Request access page</p>} />
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('collapsible login panel', () => {
  it('starts collapsed above the unchanged video and keeps entered credentials when collapsed again', () => {
    renderLogin();
    const panel = screen.getByRole('region', { name: 'Sign in' });
    const trigger = screen.getByRole('button', { name: 'Expand sign-in panel' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('data-expanded', 'false');
    expect(document.querySelector('.mx-video-background')).toHaveAttribute('src', '/mxpatrol-background.mp4');
    expect(document.getElementById('mx-login-panel-fields')).toHaveAttribute('inert');

    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Collapse sign-in panel' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'operator@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sign-in panel' }));
    expect(document.getElementById('mx-login-panel-fields')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sign-in panel' }));
    expect(screen.getByLabelText('Email')).toHaveValue('operator@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('secret-password');
  });

  it('keeps recovery and request-access navigation available when expanded', () => {
    const first = renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sign-in panel' }));
    fireEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
    expect(screen.getByText('Recovery page')).toBeInTheDocument();
    first.unmount();

    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sign-in panel' }));
    fireEvent.click(screen.getByRole('link', { name: 'Request access' }));
    expect(screen.getByText('Request access page')).toBeInTheDocument();
  });

  it('holds the panel open while authenticating and shows failures without changing the success redirect', async () => {
    let finishLogin: (value: { error: { message: string } | null }) => void = () => {};
    signInWithPassword.mockImplementationOnce(() => new Promise((resolve) => { finishLogin = resolve; }));
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sign-in panel' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'operator@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(screen.getByRole('button', { name: 'Collapse sign-in panel' })).toBeDisabled();
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'operator@example.com', password: 'wrong-password' });

    finishLogin({ error: { message: 'Invalid login credentials' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
    expect(screen.getByRole('button', { name: 'Collapse sign-in panel' })).toHaveAttribute('aria-expanded', 'true');
    expect(toastError).toHaveBeenCalled();

    signInWithPassword.mockResolvedValueOnce({ error: null });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.getByText('Dashboard page')).toBeInTheDocument());
  });
});
