import { useEffect, useState } from 'react';
import { FileText, ArrowRight, GitCompare, Link as LuLink } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { ErrorNotice, Loading, EmptyState, PageHeader } from '../components/Shared.jsx';
import { Button, Badge, Card } from '../components/ui.jsx';
import { Link } from 'react-router-dom';

export function ComparePage() {
  const [documents, setDocuments] = useState([]);
  const [selection, setSelection] = useState({ id1: '', id2: '' });
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/documents')
      .then((response) => setDocuments(response.data || []))
      .catch(() => setDocuments([]));
  }, []);

  async function handleCompare(event) {
    event.preventDefault();
    const { id1, id2 } = selection;
    if (!id1 || !id2 || id1 === id2) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/documents/compare/${encodeURIComponent(id1)}/${encodeURIComponent(id2)}`);
      setComparison(response.data);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Version comparison" title="Compare documents" description="Inspect two documents side by side, including explicit supersession links and content differences." />
      <ErrorNotice>{error}</ErrorNotice>

      <form onSubmit={handleCompare} className="space-y-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-muted">First document</label>
            <select
              value={selection.id1}
              onChange={(e) => setSelection({ ...selection, id1: e.target.value })}
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Select a document</option>
              {documents.map((d) => (
                <option key={d.documentId} value={d.documentId}>
                  {d.documentId} &middot; {d.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-muted">Second document</label>
            <select
              value={selection.id2}
              onChange={(e) => setSelection({ ...selection, id2: e.target.value })}
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Select a document</option>
              {documents.map((d) => (
                <option key={d.documentId} value={d.documentId}>
                  {d.documentId} &middot; {d.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="pt-4">
          <Button variant="primary" disabled={loading || !selection.id1 || !selection.id2 || selection.id1 === selection.id2}>
            {loading ? 'Comparing…' : 'Compare documents'} <ArrowRight size={16} />
          </Button>
        </div>
      </form>

      {!comparison && documents.length === 0 && <Loading label="Loading document library" />}
      {documents.length === 0 && !comparison && <EmptyState title="No documents available">Upload documents to compare them.</EmptyState>}

      {comparison && (
        <section className="space-y-6">
          <Card>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <GitCompare size={20} className="text-brand" />
                <h2 className="text-base font-semibold text-ink">Supersession relationship</h2>
              </div>
              <p className="text-sm text-ink">{comparison.supersession.notes}</p>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant={comparison.supersession.authoritativeId ? 'current' : 'unknown'}>
                  {comparison.supersession.relationship}
                </Badge>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2].map((n) => {
              const doc = comparison[`document${n}`];
              const pub = comparison.supersession;
              const isAuthoritative = pub.authoritativeId === doc.documentId;
              const isSuperseded = pub.supersededId === doc.documentId;
              return (
                <Card key={n} className={`p-5 ${isAuthoritative ? 'ring-2 ring-brand' : ''}`}>
                  <h3 className="text-sm font-semibold text-ink mb-1">{`Document ${n}`}</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant={isSuperseded ? 'expired' : 'current'}>{String(doc.status || 'UNKNOWN').charAt(0).toUpperCase() + String(doc.status || 'UNKNOWN').slice(1).toLowerCase()}</Badge>
                    {isAuthoritative && <Badge variant="default" title="Authoritative">Authoritative</Badge>}
                  </div>
                  <p className="text-sm font-medium text-ink">{doc.title}</p>
                  <p className="text-xs text-muted">{doc.documentId} &middot; v{doc.version || '—'} &middot; {doc.documentType}</p>
                  <p className="text-xs text-muted mt-2">
                    Effective {doc.effectiveDate ? new Date(doc.effectiveDate).toLocaleDateString() : 'Not provided'}
                  </p>
                  <Link to={`/documents/${doc.documentId}`} className="text-xs text-brand mt-2 inline-block hover:underline">View document</Link>
                </Card>
              );
            })}
          </div>

          <Card className="mt-4">
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <FileText size={18} className="text-muted" />
                <h2 className="text-base font-semibold text-ink">Content difference</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2].map((n) => (
                  <div key={n} className="border border-line rounded-lg bg-paper/50 p-3">
                    <h4 className="text-xs font-bold text-muted uppercase mb-2">Document {n}</h4>
                    <p className="text-xs text-ink font-mono whitespace-pre-line overflow-auto max-h-[300px]">
                      {comparison[`content${n}`] || '(no content)'}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-xs text-muted">
                  Removed: {comparison.diff.removedLines.length} lines &middot; Added: {comparison.diff.addedLines.length} lines &middot; Common: {comparison.diff.commonCount} lines
                </p>
              </div>
            </div>
          </Card>
        </section>
      )}
    </>
  );
}
