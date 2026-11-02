import { CalendarDays, Clock3, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Button, Badge, Card, useToast } from './ui.jsx';
import { getErrorMessage } from '../api/client.js';

export function statusVariant(status) {
  const s = (status || 'UNKNOWN').toUpperCase();
  if (s === 'CURRENT' || s === 'APPROVED' || s === 'ACTIVE') return 'current';
  if (s === 'SUPERSEDED') return 'superseded';
  if (s === 'EXPIRED') return 'expired';
  if (s === 'DRAFT') return 'draft';
  if (s === 'HISTORICAL') return 'historical';
  if (s === 'READY') return 'ready';
  if (s === 'PROCESSING') return 'processing';
  if (s === 'FAILED') return 'failed';
  return 'unknown';
}

export function DocumentCard({ document, onDelete, onReindex, isAdmin = false }) {
  const { toast } = useToast();
  const effectiveStatus = document.effectiveStatus || document.status;

  async function handleDelete() {
    if (!window.confirm(`Remove ${document.documentId} and its indexed chunks?`)) return;
    try {
      await api.delete(`/documents/${document.documentId}`);
      toast({ title: 'Removed', description: `${document.documentId} was deleted.`, variant: 'success' });
      onDelete?.();
    } catch (error) {
      toast({ title: 'Delete failed', description: getErrorMessage(error), variant: 'error' });
    }
  }

  async function handleReindex() {
    try {
      await api.post(`/documents/${document.documentId}/reindex`);
      toast({ title: 'Reindexing', description: `${document.documentId} is being reindexed.`, variant: 'default' });
      onReindex?.();
    } catch (error) {
      toast({ title: 'Reindex failed', description: getErrorMessage(error), variant: 'error' });
    }
  }

  return (
    <Card className="hover:shadow-card transition-shadow group">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Badge variant={statusVariant(effectiveStatus)}>{effectiveStatus}</Badge>
          <Badge variant="default">{document.fileType || 'FILE'}</Badge>
          {document.supersedes?.length > 0 && (
            <Badge variant="outline" title="Explicitly supersedes older versions">
              Supersedes
            </Badge>
          )}
        </div>
        <h3 className="text-base font-semibold text-ink leading-snug">{document.title}</h3>
        <p className="text-xs text-muted mb-4">
          {document.documentId} &middot; Version {document.version || 'Not provided'}{' '}
          &middot; {document.documentType}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
          <div className="flex items-center gap-2">
            <CalendarDays size={13} className="text-muted" />
            <span>Effective {document.effectiveDate ? new Date(document.effectiveDate).toLocaleDateString() : 'Not provided'}</span>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Clock3 size={13} className="text-muted" />
            <span>
              {document.chunkCount || 0} chunks &middot; <Badge variant={statusVariant(document.processingStatus)} className="ml-1">{document.processingStatus || 'UNKNOWN'}</Badge>
            </span>
          </div>
        </div>
        {document.processingError && (
          <p className="text-xs text-rose-600 bg-rose-50/50 rounded-lg p-2 mb-4">Indexing issue: {document.processingError}</p>
        )}
        <div className="flex items-center gap-2 pt-4 border-t border-line">
          <Link to={`/documents/${document.documentId}`} className="text-sm text-brand hover:underline font-medium">
            View details
          </Link>
          {isAdmin && (
            <>
              <Button variant="ghost" size="sm" onClick={handleReindex} disabled={document.processingStatus === 'PROCESSING'}>
                <RefreshCw size={14} /> Reindex
              </Button>
              <Button variant="danger" size="sm" onClick={handleDelete}>
                <Trash2 size={14} /> Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export function CitationCard({ citation, index }) {
  return (
    <article className="border border-line rounded-xl bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[10px] font-bold text-muted tracking-wider uppercase">SOURCE {String(index + 1).padStart(2, '0')}</span>
        <Badge variant={statusVariant(citation.status)}>{citation.status || 'STATUS UNKNOWN'}</Badge>
      </div>
      <h3 className="text-sm font-semibold text-ink leading-snug">{citation.title || 'Untitled source'}</h3>
      <div className="flex flex-wrap gap-3 text-xs text-muted mb-3">
        <span>
          <FileText size={13} className="mr-1" /> {citation.documentId || 'ID unavailable'}
        </span>
        {citation.version && <span>v{citation.version}</span>}
        {citation.effectiveDate && (
          <span>
            <CalendarDays size={13} className="mr-1" />
            Effective {new Date(citation.effectiveDate).toLocaleDateString()}
          </span>
        )}
        {citation.section && <span>{citation.section}</span>}
        {citation.page && <span>Page {citation.page}</span>}
      </div>
      <blockquote className="border-l-2 border-brand bg-paper/30 pl-3 py-2 my-0 text-sm text-ink italic">
        {citation.passage}
      </blockquote>
    </article>
  );
}
