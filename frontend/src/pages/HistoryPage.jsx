import { useEffect, useState } from 'react';
import { Search, Clock3, CheckCircle2, ArrowRight } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { ErrorNotice, Loading, EmptyState } from '../components/Shared.jsx';
import { CitationCard } from '../components/DocumentCard.jsx';

export function HistoryPage() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/rag/history')
      .then((response) => setHistory(response.data))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, []);

  return (
    <>
      <div className="mb-6">
        <span className="block text-xs font-semibold text-muted tracking-wide uppercase">Private activity</span>
        <h1 className="text-xl font-semibold text-ink">Search activity</h1>
        <p className="text-muted text-sm">Your account&apos;s latest 50 searches. Activity is scoped to your authenticated user.</p>
      </div>

      <ErrorNotice>{error}</ErrorNotice>

      {history === null ? (
        <Loading label="Loading search history" />
      ) : history.length === 0 ? (
        <EmptyState title="Nothing to show yet">Your questions will appear here after your first search.</EmptyState>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <article key={item._id} className="border border-line rounded-xl bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Search size={15} className="text-muted" />
                  <span className="text-sm font-semibold text-ink">{item.query}</span>
                </div>
                <span className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-sm text-ink leading-relaxed mb-3">{item.answer}</p>
              <div className="flex items-center gap-2 text-xs text-muted mb-2">
                <CheckCircle2 size={13} className="text-green-600" />
                <span>{item.sources?.length || 0} sources &middot; {item.confidence != null ? Math.round(item.confidence * 100) + '% confidence' : ''}</span>
              </div>
              <div className="space-y-2">
                {(item.sources || []).map((source, index) => (
                  <CitationCard key={source.documentId + index} citation={{ ...source, status: source.status || 'UNKNOWN' }} index={index} />
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
