import { useEffect, useState } from 'react';
import { Search, FileText, CalendarDays, Clock3, ArrowRight } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorNotice, Loading, EmptyState } from '../components/Shared.jsx';
import { Button, Badge } from '../components/ui.jsx';
import { DocumentCard } from '../components/DocumentCard.jsx';

const STATUS_OPTIONS = ['CURRENT', 'SUPERSEDED', 'EXPIRED', 'DRAFT', 'HISTORICAL', 'UNKNOWN'];
const TYPE_OPTIONS = [
  'Operational Manual',
  'Safety Bulletin',
  'Regulatory Directive',
  'Standard Operating Procedure',
  'Quick Reference Handbook',
  'Maintenance Manual',
  'Flight Crew Operating Manual'
];

export function DocumentsPage() {
  const [documents, setDocuments] = useState(null);
  const [filter, setFilter] = useState({ search: '', status: '', type: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.type) params.type = filter.type;
    api.get('/documents', { params })
      .then((response) => setDocuments(response.data))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, [filter.status, filter.type]);

  const { user: authUser } = useAuth();
  const isAdminUser = authUser?.role === 'admin';

  const visibleDocuments = (documents || []).filter((document) => {
    const text = `${document.title} ${document.documentId} ${document.documentType}`.toLowerCase();
    return text.includes(filter.search.toLowerCase());
  });

  return (
    <>
      <div className="mb-6">
        <span className="block text-xs font-semibold text-muted tracking-wide uppercase">Knowledge Collection</span>
        <h1 className="text-xl font-semibold text-ink">Document library</h1>
        <p className="text-muted text-sm">Browse documents available to your account. Status and dates are shown only when supplied in source metadata.</p>
      </div>

      <ErrorNotice>{error}</ErrorNotice>

      <div className="library-filters flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
          <Search size={14} className="text-muted" />
          <input
            value={filter.search}
            onChange={(event) => setFilter({ ...filter, search: event.target.value })}
            placeholder="Search title, ID, or type"
            className="flex-1 border-0 outline-0 text-sm text-ink placeholder:text-muted"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={filter.status}
          onChange={(event) => setFilter({ ...filter, status: event.target.value })}
          className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by type"
          value={filter.type}
          onChange={(event) => setFilter({ ...filter, type: event.target.value })}
          className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setFilter({ search: '', status: '', type: '' })}>Clear filters</Button>
      </div>

      {documents === null ? (
        <Loading label="Loading documents" />
      ) : visibleDocuments.length === 0 ? (
        <EmptyState title={documents.length ? 'No matching documents' : 'No documents available'}>
          {documents.length ? 'Try another search or status filter.' : 'Your organization has not made any documents available yet.'}
        </EmptyState>
      ) : (
        <div className="document-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleDocuments.map((document) => (
            <DocumentCard
              key={document.documentId}
              document={document}
              isAdmin={isAdminUser}
              onDelete={() => setDocuments((prev) => prev.filter((d) => d.documentId !== document.documentId))}
              onReindex={() => {
                setDocuments((prev) => prev.map((d) => (d.documentId === document.documentId ? { ...d, processingStatus: 'PROCESSING' } : d)));
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
