import { useState } from 'react';
import { ArrowRight, Sparkles, FileText, Clock3 } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { ErrorNotice, Loading, EmptyState } from '../components/Shared.jsx';
import { Button, Badge, Card, Label } from '../components/ui.jsx';
import { CitationCard } from '../components/DocumentCard.jsx';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const response = await api.post('/rag/query', { query });
      setResult(response.data);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        <span className="block text-xs font-semibold text-muted tracking-wide uppercase">Evidence Search</span>
        <h1 className="text-xl font-semibold text-ink">Ask AeroRAG</h1>
        <p className="text-muted text-sm">Ask a question about your documents. Answers are only useful when you can inspect their supporting passages.</p>
      </div>

      <form className="search-panel space-y-3" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="search-question">YOUR QUESTION</Label>
          <textarea
            id="search-question"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={3}
            maxLength={2000}
            required
            rows={4}
            className="flex-1 bg-white border border-line rounded-xl px-3 py-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent resize-y disabled:bg-paper"
            placeholder="For example: What does the available manual say about sterile cockpit procedures?"
            disabled={loading}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{query.length}/2000 characters</span>
            <span className="text-xs text-muted">{result ? result.demoMode ? 'Demo mode · extractive response' : 'Live AI response' : ''}</span>
          </div>
        </div>
        <Button variant="primary" className="w-full" disabled={loading || query.trim().length < 3}>
          {loading ? 'Searching…' : 'Search documents'} <ArrowRight size={16} />
        </Button>
      </form>

      <ErrorNotice>{error}</ErrorNotice>
      {loading && <Loading label="Searching documents and preparing evidence" />}

      {result && (
        <section className="answer-section mt-6">
          <Card>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={15} />
                <span className="text-xs font-semibold {result.demoMode ? 'text-amber-700' : 'text-brand'}">
                  {result.demoMode ? 'DEMO MODE &middot; EXTRACTIVE RESPONSE' : 'RETRIEVED ANSWER'}
                </span>
                <Badge variant={result.isGrounded ? 'current' : 'unknown'} className="ml-auto">
                  {result.isGrounded ? 'Evidence retrieved' : 'Insufficient evidence'}
                </Badge>
              </div>
              <p className="text-sm text-ink leading-relaxed mb-4 whitespace-pre-line">{result.answer}</p>
              <div className="flex items-center gap-4 text-xs text-muted border-t border-line pt-3">
                <span><FileText size={13} className="mr-1" /> {result.retrievedChunks} retrieved passage(s)</span>
                <span><Clock3 size={13} className="mr-1" /> Confidence {Math.round((result.confidence ?? 0) * 100)}%</span>
              </div>
            </div>
          </Card>

          <div className="mt-6 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">Supporting passages</h2>
            <p className="text-xs text-muted">Only passages returned by retrieval are shown as citations.</p>
          </div>

          {result.citations?.length ? (
            <div className="space-y-3">
              {result.citations.map((citation, index) => (
                <CitationCard key={`${citation.documentId}-${citation.section}-${index}`} citation={citation} index={index} />
              ))}
            </div>
          ) : (
            <EmptyState title="No supporting passages">The available documents did not return evidence for this question. No citation was created.</EmptyState>
          )}
        </section>
      )}
    </>
  );
}
