import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, Upload as UpIcon } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorNotice, PageHeader } from '../components/Shared.jsx';
import { Button, Input, Label, Badge, Card } from '../components/ui.jsx';

const TYPE_OPTIONS = [
  'Operational Manual',
  'Safety Bulletin',
  'Regulatory Directive',
  'Standard Operating Procedure',
  'Quick Reference Handbook',
  'Maintenance Manual',
  'Flight Crew Operating Manual'
];

export function UploadPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const [form, setForm] = useState({
    documentId: '',
    title: '',
    documentType: 'Operational Manual',
    version: '',
    issueDate: '',
    effectiveDate: '',
    expiryDate: '',
    status: 'CURRENT',
    supersedes: ''
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!file) { setError('Choose a file to upload.'); return; }
    if (!form.documentId || !form.title || !form.version || !form.issueDate || !form.effectiveDate) {
      setError('Document ID, title, version, issue date, and effective date are required.');
      return;
    }
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
    payload.append('file', file);
    setLoading(true);
    try {
      const response = await api.post('/documents/upload', payload);
      setMessage(`Uploaded ${response.data.title}. Indexed ${response.data.chunkCount || 0} chunk(s). Status: ${(response.data.effectiveStatus || response.data.status)}.`);
      setForm({ documentId: '', title: '', documentType: 'Operational Manual', version: '', issueDate: '', effectiveDate: '', expiryDate: '', status: 'CURRENT', supersedes: '' });
      setFile(null);
      event.target.reset();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Administration" title="Add a document" description="Upload a source file and its metadata. Explicit supersession relationships are entered by an administrator; dates do not infer authority." />
      <ErrorNotice>{error}</ErrorNotice>
      {message && <div className="mb-4 rounded-lg border border-green-100 bg-green-50 p-3 text-sm text-green-700" role="status">{message}</div>}
      <form className="upload-panel space-y-4" onSubmit={submit}>
        <div className="space-y-3">
          <Label>Source document ID</Label>
          <Input required maxLength={100} value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })} placeholder="e.g. SOP-OPS-737-05" />
        </div>
        <div className="space-y-3">
          <Label>Document title</Label>
          <Input required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Procedure title" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Label>Document type</Label>
            <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand">
              {TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div className="space-y-3">
            <Label>Version / issue</Label>
            <Input required maxLength={50} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="e.g. 4.0" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-3">
            <Label>Issue date</Label>
            <Input type="date" required value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
          </div>
          <div className="space-y-3">
            <Label>Effective date</Label>
            <Input type="date" required value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
          </div>
          <div className="space-y-3">
            <Label>Expiry date (optional)</Label>
            <Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
          </div>
        </div>
        <div className="space-y-3">
          <Label>Status</Label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="CURRENT">Current</option>
            <option value="SUPERSEDED">Superseded</option>
            <option value="EXPIRED">Expired</option>
            <option value="DRAFT">Draft</option>
            <option value="HISTORICAL">Historical</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
        </div>
        <div className="space-y-3">
          <Label>Explicitly supersedes <span className="text-xs text-muted">(optional, comma-separated document IDs)</span></Label>
          <Input value={form.supersedes} onChange={(e) => setForm({ ...form, supersedes: e.target.value })} placeholder="e.g. SOP-OPS-737-03" />
          <p className="text-xs text-muted">Never assume a newer publication supersedes an older one; declare the relationship explicitly.</p>
        </div>
        <div className="border border-line rounded-xl bg-white p-4">
          <Label className="flex items-center gap-2 cursor-pointer block">
            <UpIcon size={18} className="text-brand" />
            <span>PDF, TXT, DOCX, HTML, or Markdown file</span>
            <input
              type="file"
              accept=".pdf,.txt,.docx,.html,.htm,.md,.markdown"
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="sr-only"
            />
          </Label>
          <p className="text-xs text-muted mt-2">Maximum 25 MB. Scanned PDFs require OCR, which is not enabled.</p>
        </div>
        <Button variant="primary" className="w-full" disabled={loading}>
          {loading ? 'Uploading and indexing…' : 'Upload and index'} <ArrowRight size={16} />
        </Button>
        <Link to="/documents" className="w-full flex items-center justify-center text-xs text-brand hover:underline font-medium">Back to document library</Link>
      </form>
    </>
  );
}
