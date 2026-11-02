import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, CalendarDays, Clock3, RefreshCw, Trash2, Share2, ArrowRight, LayoutDashboard } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorNotice, Loading, EmptyState, PageHeader } from '../components/Shared.jsx';
import { Button, Badge, Card, Input, Label, useToast } from '../components/ui.jsx';

export function DocumentDetailPage() {
  const { documentId } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const [doc, setDoc] = useState(null);
  const [content, setContent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, [documentId]);

  async function load() {
    setLoading(true);
    try {
      const [docRes, contentRes] = await Promise.all([api.get(`/documents/${documentId}`), api.get(`/documents/${documentId}/content`)]);
      setDoc(docRes.data);
      setContent(contentRes.data);
      setEditForm({
        title: docRes.data.title,
        documentType: docRes.data.documentType,
        version: docRes.data.version,
        issueDate: docRes.data.issueDate ? new Date(docRes.data.issueDate).toISOString().slice(0, 10) : '',
        effectiveDate: docRes.data.effectiveDate ? new Date(docRes.data.effectiveDate).toISOString().slice(0, 10) : '',
        expiryDate: docRes.data.expiryDate ? new Date(docRes.data.expiryDate).toISOString().slice(0, 10) : '',
        status: docRes.data.status,
        supersedes: (docRes.data.supersedes || []).join(', ')
      });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleReindex() {
    try {
      await api.post(`/documents/${documentId}/reindex`);
      toast({ title: 'Reindexing', description: `${documentId} is being reindexed.`, variant: 'default' });
      load();
    } catch (requestError) {
      toast({ title: 'Reindex failed', description: getErrorMessage(requestError), variant: 'error' });
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remove ${documentId} and its indexed chunks? This cannot be undone.`)) return;
    try {
      await api.delete(`/documents/${documentId}`);
      toast({ title: 'Removed', description: `${documentId} was deleted.`, variant: 'success' });
    } catch (requestError) {
      toast({ title: 'Delete failed', description: getErrorMessage(requestError), variant: 'error' });
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { ...editForm, supersedes: editForm.supersedes.split(',').map((s) => s.trim()).filter(Boolean) };
      await api.put(`/documents/${documentId}`, payload);
      toast({ title: 'Saved', description: `${documentId} metadata updated.`, variant: 'success' });
      setEditMode(false);
      load();
    } catch (requestError) {
      toast({ title: 'Update failed', description: getErrorMessage(requestError), variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading document" />;
  if (error || !doc) return <div className="py-10"><ErrorNotice>{error || 'Document not found'}</ErrorNotice><Button variant="outline" asChild><Link to="/documents">Back to library</Link></Button></div>;

  const effectiveStatus = doc.effectiveStatus || doc.status;
  return (
    <>
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <PageHeader eyebrow="Document" title={doc.title} description={`${doc.documentId} &middot; v${doc.version || '—'} &middot; ${doc.documentType}`} />
        </div>
        <div className="flex items-center gap-2">
          <Link to="/documents" className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-paper transition-colors"><LayoutDashboard size={14} className="mr-1" /> Library</Link>
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={handleReindex} disabled={doc.processingStatus === 'PROCESSING'}>
                <RefreshCw size={14} /> {doc.processingStatus === 'PROCESSING' ? 'Indexing…' : 'Reindex'}
              </Button>
              <Button variant="danger" size="sm" onClick={handleDelete}>
                <Trash2 size={14} /> Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant={(effectiveStatus || doc.status).toLowerCase()}>{effectiveStatus || doc.status}</Badge>
                <Badge variant="default">{doc.fileType || 'FILE'}</Badge>
                {doc.supersedes?.length > 0 && <Badge variant="outline" title="Explicitly supersedes">Supersedes: {doc.supersedes.join(', ')}</Badge>}
                {doc.supersededBy && <Badge variant="outline" title="Superseded by">Superseded by {doc.supersededBy}</Badge>}
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted text-xs">Document ID</dt>
                <dd className="text-ink font-mono">{doc.documentId}</dd>
                <dt className="text-muted text-xs">Version</dt>
                <dd className="text-ink">{doc.version || 'Not provided'}</dd>
                <dt className="text-muted text-xs">Document type</dt>
                <dd className="text-ink">{doc.documentType}</dd>
                <dt className="text-muted text-xs">Effective status</dt>
                <dd className={`text-ink font-semibold ${effectiveStatus === 'CURRENT' ? 'text-green-700' : 'text-rose-600'}`}>{effectiveStatus}</dd>
                <dt className="text-muted text-xs">Issue date</dt>
                <dd className="text-ink">{doc.issueDate ? new Date(doc.issueDate).toLocaleDateString() : 'Not provided'}</dd>
                <dt className="text-muted text-xs">Effective date</dt>
                <dd className="text-ink">{doc.effectiveDate ? new Date(doc.effectiveDate).toLocaleDateString() : 'Not provided'}</dd>
                <dt className="text-muted text-xs">Expiry date</dt>
                <dd className="text-ink">{doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString() : 'None'}</dd>
                <dt className="text-muted text-xs">Indexed chunks</dt>
                <dd className="text-ink">{doc.chunkCount || 0}</dd>
                <dt className="text-muted text-xs">Processing</dt>
                <dd className="text-ink"><Badge variant={(doc.processingStatus || 'UNKNOWN').toLowerCase()} className="ml-1">{doc.processingStatus || 'UNKNOWN'}</Badge></dd>
                {doc.processingError && (
                  <><dt className="text-muted text-xs">Processing error</dt><dd className="text-rose-600 text-sm">{doc.processingError}</dd></>
                )}
              </dl>
              {doc.notes && (
                <div className="mt-4 pt-4 border-t border-line">
                  <dt className="text-muted text-xs">Notes</dt>
                  <dd className="text-sm text-ink">{doc.notes}</dd>
                </div>
              )}
            </div>
          </Card>

          {content && (
            <Card className="mt-6">
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-muted" />
                  <span className="text-sm font-semibold text-ink">Extracted content</span>
                </div>
                <span className="text-xs text-muted">{content.length} characters</span>
              </CardHeader>
              <CardBody className="font-mono text-xs text-ink overflow-x-auto whitespace-pre-line bg-slate-50/50 rounded-lg border border-line p-4 max-h-[60vh]">
                {content.content || content.text || 'No content available'}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="lg:col-span-1">
          <Card>
            <div className="p-5">
              <h3 className="text-sm font-semibold text-ink mb-4">Admin actions</h3>
              {isAdmin ? (
                <>
                  <Button variant="outline" size="sm" className="w-full mb-3" onClick={() => setEditMode(!editMode)}>
                    {editMode ? 'Cancel' : 'Edit metadata'} <ArrowRight size={14} />
                  </Button>
                  {editMode && (
                    <form onSubmit={handleSave} className="space-y-3 mt-4">
                      <Label>Title</Label>
                      <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                      <Label>Version</Label>
                      <Input value={editForm.version} onChange={(e) => setEditForm({ ...editForm, version: e.target.value })} />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Issue date</Label>
                          <Input type="date" value={editForm.issueDate} onChange={(e) => setEditForm({ ...editForm, issueDate: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label>Effective date</Label>
                          <Input type="date" value={editForm.effectiveDate} onChange={(e) => setEditForm({ ...editForm, effectiveDate: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Expiry date (optional)</Label>
                        <Input type="date" value={editForm.expiryDate} onChange={(e) => setEditForm({ ...editForm, expiryDate: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Input value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} />
                        <p className="text-xs text-muted">CURRENT, SUPERSEDED, EXPIRED, DRAFT, HISTORICAL, UNKNOWN</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Explicitly supersedes (comma-separated IDs)</Label>
                        <Input value={editForm.supersedes} onChange={(e) => setEditForm({ ...editForm, supersedes: e.target.value })} />
                      </div>
                      <Button variant="primary" className="w-full" disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </Button>
                    </form>
                  )}
                  <Button variant="danger" size="sm" className="w-full mt-4" onClick={handleDelete}>
                    <Trash2 size={14} /> Delete document
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="w-full" disabled>
                  Admin sign-in required to manage documents
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
