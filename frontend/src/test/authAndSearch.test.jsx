import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

vi.mock('../api/client.js', () => ({
  api: { get: apiGet, post: apiPost },
  getErrorMessage: error => error.message || 'Request failed'
}));

import App from '../App.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

beforeEach(() => {
  apiGet.mockResolvedValue({ data: { mongodb: 'connected' } });
});

describe('authentication routes', () => {
  it('redirects protected search to sign-in when no token exists', async () => {
    renderAt('/search');
    expect(await screen.findByRole('heading', { name: 'Sign in to your workspace' })).toBeInTheDocument();
  });

  it('shows a useful login error from the API', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(new Error('Invalid email or password'));
    renderAt('/login');
    await user.type(screen.getByLabelText('Email address'), 'pilot@example.test');
    await user.type(screen.getByLabelText('Password'), 'incorrect-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('registers only through the standard public account form', async () => {
    renderAt('/register');
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText(/Administrator access is assigned separately/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/role|administrator/i)).not.toBeInTheDocument();
  });
});

describe('search workflow', () => {
  it('renders actual retrieved citations returned by the API', async () => {
    const user = userEvent.setup();
    const account = { id: 'user-1', name: 'Test User', role: 'ground_staff' };
    apiGet.mockResolvedValue({ data: account });
    apiPost.mockResolvedValue({
      data: {
        answer: 'The available passage states the sterile cockpit threshold.',
        demoMode: true,
        isGrounded: true,
        retrievedChunks: 1,
        confidence: 0.5,
        citations: [{
          documentId: 'SOP-OPS-737-04',
          title: 'Sterile Cockpit Procedures',
          status: 'APPROVED',
          passage: 'The sterile cockpit rule applies below 10,000 feet MSL.'
        }]
      }
    });
    sessionStorage.setItem('aerorag-token', 'test-token');
    renderAt('/search');

    await screen.findByRole('heading', { name: 'Ask AeroRAG' });
    await user.type(screen.getByLabelText('YOUR QUESTION'), 'When does the sterile cockpit rule apply?');
    await user.click(screen.getByRole('button', { name: 'Search documents' }));

    expect(await screen.findByText('SOP-OPS-737-04')).toBeInTheDocument();
    expect(screen.getByText('The sterile cockpit rule applies below 10,000 feet MSL.')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith('/rag/query', { query: 'When does the sterile cockpit rule apply?' });
  });
});
