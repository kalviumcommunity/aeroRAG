import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Waves } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { getErrorMessage } from '../api/client.js';
import { ErrorNotice } from '../components/Shared.jsx';
import { api } from '../api/client.js';

function AuthLayout({ title, intro, children, footer }) {
  const [serviceNotice, setServiceNotice] = useState('');
  useEffect(() => {
    api.get('/health')
      .then(({ data }) => {
        if (data.mongodb !== 'connected') {
          setServiceNotice('API is reachable, but MongoDB is disconnected. Start the local database before signing in or registering.');
        }
      })
      .catch(() => setServiceNotice('AeroRAG API is unavailable. Start the backend before signing in or registering.'));
  }, []);
  return (
    <main className="auth-page">
      <div className="auth-art"><div className="auth-art-grid" /><div className="auth-brand"><span className="brand-symbol"><Waves size={22} /></span><strong>AeroRAG</strong></div><div className="auth-art-copy"><span className="eyebrow light">AIRLINE DOCUMENT INTELLIGENCE</span><h1>Find the evidence<br />behind every answer.</h1><p>Search authorized documents with traceable passages and clear uncertainty.</p></div><div className="auth-art-foot">BUILT FOR DOCUMENT-GROUNDED SEARCH</div></div>
      <div className="auth-form-wrap"><div className="auth-form"><span className="eyebrow">WELCOME TO AERORAG</span><h2>{title}</h2><p className="muted">{intro}</p>{serviceNotice && <div className="service-note" role="status">{serviceNotice}</div>}{children}<div className="auth-footer">{footer}</div></div></div>
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
  return <AuthLayout title="Sign in to your workspace" intro="Use your AeroRAG account to search your organization's document collection." footer={<>New to AeroRAG? <Link to="/register">Create an account <ArrowRight size={14} /></Link></>}>
    <form onSubmit={submit} className="form-stack">
      <ErrorNotice>{error}</ErrorNotice>
      <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="you@organization.com" /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" /></label>
      <button className="button-primary full-width" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></button>
    </form>
  </AuthLayout>;
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
  return <AuthLayout title="Create your account" intro="Register for a standard user account. Administrator access is assigned separately." footer={<>Already registered? <Link to="/login">Sign in <ArrowRight size={14} /></Link></>}>
    <form onSubmit={submit} className="form-stack">
      <ErrorNotice>{error}</ErrorNotice>
      <label>Full name<input type="text" autoComplete="name" required minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Your name" /></label>
      <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="you@organization.com" /></label>
      <label>Password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="At least 8 characters" /><small className="field-hint">Use at least 8 characters.</small></label>
      <button className="button-primary full-width" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'} <ArrowRight size={17} /></button>
    </form>
  </AuthLayout>;
}
