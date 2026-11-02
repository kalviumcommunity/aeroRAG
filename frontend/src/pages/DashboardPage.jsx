import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, FileSearch, Sparkles, CalendarDays } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorNotice, Loading, PageHeader } from '../components/Shared.jsx';
import { Button, Badge, Card } from '../components/ui.jsx';

export function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ stats: null, history: null, health: null });
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api.get('/documents/stats').then((response) => response.data),
      api.get('/rag/history').then((response) => response.data),
      api.get('/health').then((response) => response.data)
    ])
      .then(([stats, history, health]) => setSummary({ stats, history, health }))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, []);

  const stats = summary.stats || {};
  const statusBreakdown = stats.statusBreakdown || {};

  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE"
        title={`Good day, ${user?.name?.split(' ')[0] || 'there'}.`}
        description="Search approved documents and review the evidence behind every response."
        action={<Link to="/search" className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-paper transition-colors"><ArrowRight size={16} /> Ask a question</Link>}
      />
      <ErrorNotice>{error}</ErrorNotice>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">AVAILABLE DOCUMENTS</p>
              <span className="text-2xl font-bold text-ink">{stats.totalDocuments ?? '—'}</span>
            </div>
            <div className="rounded-lg bg-paper p-3"><BookOpen size={22} className="text-brand" /></div>
          </div>
          <p className="text-xs text-muted mt-3">In your authorized collection</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">RECENT SEARCHES</p>
              <span className="text-2xl font-bold text-ink">{summary.history?.length ?? '—'}</span>
            </div>
            <div className="rounded-lg bg-paper p-3"><FileSearch size={22} className="text-brand" /></div>
          </div>
          <p className="text-xs text-muted mt-3">Latest 50 personal searches</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">ANSWER MODE</p>
              <span className="text-2xl font-bold text-ink">{summary.health ? (summary.health.demoMode ? 'DEMO' : 'LIVE') : '—'}</span>
            </div>
            <div className="rounded-lg bg-paper p-3"><Sparkles size={22} className="text-brand" /></div>
          </div>
          <p className="text-xs text-muted mt-3">
            {summary.health ? `API ${summary.health.status} &middot; vector store ${summary.health.vectorStore}` : 'Backend status unavailable'}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[['CURRENT', statusBreakdown.current], ['SUPERSEDED', statusBreakdown.superseded], ['EXPIRED', statusBreakdown.expired], ['DRAFT', statusBreakdown.draft]].map(([status, count]) => (
          <Card key={status} className="p-4">
            <Badge variant={status.toLowerCase()} className="mb-2">{status}</Badge>
            <span className="text-2xl font-bold text-ink">{count ?? 0}</span>
            <p className="text-xs text-muted mt-1">documents</p>
          </Card>
        ))}
      </div>

      <div className="border border-line rounded-2xl bg-white overflow-hidden">
        <div className="border-b border-line bg-paper px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
          <Link className="text-xs text-brand hover:underline font-medium" to="/history">
            View activity <ArrowRight size={14} />
          </Link>
        </div>
        <div className="divide-y divide-line">
          {!summary.history ? (
            <div className="p-6"><Loading label="Loading recent activity" /></div>
          ) : summary.history.length === 0 ? (
            <div className="p-6"><EmptyState title="No searches yet">Ask a question to see retrieved evidence and citations here.</EmptyState></div>
          ) : (
            summary.history.slice(0, 8).map((item) => (
              <Link key={item._id} to="/search" className="block px-5 py-3.5 hover:bg-paper transition-colors border-b border-line last:border-0">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-ink truncate">{item.query}</div>
                    <div className="text-xs text-muted">{item.sources?.length || 0} source(s) &middot; {new Date(item.createdAt).toLocaleString()}</div>
                  </div>
                  <CalendarDays size={14} className="text-muted" />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </>
  );
}
