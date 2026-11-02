import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Waves } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { getErrorMessage } from '../api/client.js';
import { ErrorNotice } from '../components/Shared.jsx';
import { api } from '../api/client.js';
import { Card, Button, Input, Label } from '../components/ui.jsx';

function AuthLayout({ title, intro, children, footer }) {
  const [serviceNotice, setServiceNotice] = useState('');
  useEffect(() => {
    api.get('/health')
      .then(({ data }) => {
        if (data.mongodb !== 'connected') {
          setServiceNotice('MongoDB is disconnected. Start the local database before signing in.');
        }
      })
      .catch(() => setServiceNotice('AeroRAG API is unavailable. Start the backend before signing in.'));
  }, []);
  return (
    <main className="auth-page min-h-screen flex items-center justify-center bg-paper px-4 py-6">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <span className="brand-symbol"><Waves size={20} /></span>
          <div>
            <strong className="text-base text-ink">AeroRAG</strong>
            <div className="text-[10px] text-muted tracking-wider">Document Intelligence</div>
          </div>
        </div>
        <span className="block text-xs font-semibold text-muted tracking-wide mb-2">AERO RAG</span>
        <h2 className="text-xl font-semibold text-ink mb-2">{title}</h2>
        <p className="text-muted text-sm mb-6">{intro}</p>
        {serviceNotice && <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700" role="status">{serviceNotice}</div>}
        {children}
        <div className="auth-footer mt-6 pt-4 border-t border-line text-xs text-muted">{footer}</div>
      </Card>
    </main>
  );
}

export function LoginPage() {
  const { user, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  async function submit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try { await signIn(form); navigate('/'); } catch (requestError) { setError(getErrorMessage(requestError)); } finally { setSubmitting(false); }
  }
  return (
    <AuthLayout title="Sign in to your workspace" intro="Use your AeroRAG account to search your organization's document collection." footer={<>New to AeroRAG? <Link to="/register">Create an account <ArrowRight size={14} /></Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNotice>{error}</ErrorNotice>
        <div className="space-y-3">
          <Label htmlFor="login-email">Email address</Label>
          <Input id="login-email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="you@organization.com" />
        </div>
        <div className="space-y-3">
          <Label htmlFor="login-password">Password</Label>
          <Input id="login-password" type="password" autoComplete="current-password" required value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" />
        </div>
        <Button variant="primary" className="w-full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { user, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  async function submit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try { await signIn(form, '/auth/register'); navigate('/'); } catch (requestError) { setError(getErrorMessage(requestError)); } finally { setSubmitting(false); }
  }
  return (
    <AuthLayout title="Create your account" intro="Register for a standard user account. Administrator access is assigned separately." footer={<>Already registered? <Link to="/login">Sign in <ArrowRight size={14} /></Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNotice>{error}</ErrorNotice>
        <div className="space-y-3">
          <Label htmlFor="register-name">Full name</Label>
          <Input id="register-name" type="text" autoComplete="name" required minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Your name" />
        </div>
        <div className="space-y-3">
          <Label htmlFor="register-email">Email address</Label>
          <Input id="register-email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="you@organization.com" />
        </div>
        <div className="space-y-3">
          <Label htmlFor="register-password">Password</Label>
          <Input id="register-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="At least 8 characters" />
          <FieldHint>Use at least 8 characters.</FieldHint>
        </div>
        <Button variant="primary" className="w-full" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'} <ArrowRight size={17} /></Button>
      </form>
    </AuthLayout>
  );
}

function FieldHint({ children, className = '' }) {
  return <p className={`text-xs text-muted mt-1 ${className}`}>{children}</p>;
}
