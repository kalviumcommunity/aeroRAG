import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenText, CalendarDays, CheckCircle2, Clock3, FileSearch, FileText, Search, Sparkles } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorNotice, Loading } from '../components/Shared.jsx';

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ documents: null, history: null, health: null });
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api.get('/documents').then(response => response.data),
      api.get('/rag/history').then(response => response.data),
      api.get('/health').then(response => response.data)
    ]).then(([documents, history, health]) => setSummary({ documents: documents.length, history, health }))
      .catch(requestError => setError(getErrorMessage(requestError)));
  }, []);
  return <>
    <PageHeading eyebrow="YOUR WORKSPACE" title={`Good day, ${user?.name?.split(' ')[0] || 'there'}.`} description="Search approved documents and review the evidence behind every response." action={<Link className="button-primary" to="/search"><Search size={17} /> Ask a question</Link>} />
    <ErrorNotice>{error}</ErrorNotice>
    <div className="metric-grid">
      <div className="metric-card"><span className="metric-icon teal"><BookOpenText size={19} /></span><span className="metric-label">AVAILABLE DOCUMENTS</span><strong>{summary.documents ?? '—'}</strong><small>In your authorized collection</small></div>
      <div className="metric-card"><span className="metric-icon blue"><FileSearch size={19} /></span><span className="metric-label">RECENT SEARCHES</span><strong>{summary.history?.length ?? '—'}</strong><small>Latest 50 personal searches</small></div>
      <div className="metric-card"><span className="metric-icon amber"><Sparkles size={19} /></span><span className="metric-label">ANSWER MODE</span><strong className="metric-mode">{summary.health ? (summary.health.demoMode ? 'DEMO' : 'LIVE') : '—'}</strong><small>{summary.health ? `API ${summary.health.status}; vector store ${summary.health.vectorStore}` : 'Backend status unavailable'}</small></div>
    </div>
    <div className="section-heading"><div><h2>Recent activity</h2><p>Your recent document questions and sources.</p></div><Link className="text-link" to="/history">View activity <ArrowRight size={15} /></Link></div>
    {!summary.history ? <Loading label="Loading recent activity" /> : summary.history.length === 0 ? <EmptyState title="No searches yet">Ask a question to see retrieved evidence and citations here.</EmptyState> : <div className="activity-list">{summary.history.slice(0, 5).map(item => <Link className="activity-row" to="/search" key={item._id}><span className="activity-icon"><Search size={17} /></span><span className="activity-main"><strong>{item.query}</strong><small>{item.sources?.length || 0} source(s) · {new Date(item.createdAt).toLocaleString()}</small></span><ArrowRight size={17} className="row-arrow" /></Link>)}</div>}
  </>;
}

function CitationCard({ citation, index }) {
  return <article className="citation-card"><div className="citation-top"><span className="citation-index">SOURCE {String(index + 1).padStart(2, '0')}</span><span className={`status-pill ${citation.status?.toLowerCase() === 'current' || citation.status?.toLowerCase() === 'approved' ? 'approved' : ''}`}>{citation.status || 'STATUS UNKNOWN'}</span></div><h3>{citation.title || 'Untitled source'}</h3><div className="citation-meta"><span><FileText size={14} />{citation.documentId || 'ID unavailable'}</span>{citation.effectiveDate && <span><CalendarDays size={14} />Effective {new Date(citation.effectiveDate).toLocaleDateString()}</span>}{citation.section && <span>{citation.section}</span>}{citation.page && <span>Page {citation.page}</span>}</div><blockquote>{citation.passage}</blockquote></article>;
}

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
  return <>
    <PageHeading eyebrow="EVIDENCE SEARCH" title="Ask AeroRAG" description="Ask a question about your documents. Answers are only useful when you can inspect their supporting passages." />
    <form className="search-panel" onSubmit={submit}><label htmlFor="question">YOUR QUESTION</label><textarea id="question" value={query} onChange={event => setQuery(event.target.value)} minLength={3} maxLength={2000} required placeholder="For example: What does the available manual say about…?" /><div className="search-controls"><span>{query.length}/2000 characters</span><button className="button-primary" disabled={loading || query.trim().length < 3}>{loading ? 'Searching…' : 'Search documents'} <ArrowRight size={16} /></button></div></form>
    <ErrorNotice>{error}</ErrorNotice>
    {loading && <Loading label="Searching documents and preparing evidence" />}
    {result && <section className="answer-section"><div className="answer-card"><div className="answer-kicker"><Sparkles size={16} /> {result.demoMode ? 'DEMO MODE · EXTRACTIVE RESPONSE' : 'RETRIEVED ANSWER'} <span className={result.isGrounded ? 'grounded-tag' : 'uncertain-tag'}>{result.isGrounded ? 'Evidence retrieved' : 'Insufficient evidence'}</span></div><p className="answer-text">{result.answer}</p><div className="answer-foot">{result.retrievedChunks} retrieved passage(s) · Confidence {Math.round((result.confidence ?? 0) * 100)}%</div></div><div className="section-heading compact"><div><h2>Supporting passages</h2><p>Only passages returned by retrieval are shown as citations.</p></div></div>{result.citations?.length ? <div className="citation-list">{result.citations.map((citation, index) => <CitationCard key={`${citation.documentId}-${citation.section}-${index}`} citation={citation} index={index} />)}</div> : <EmptyState title="No supporting passages">The available documents did not return evidence for this question. No citation was created.</EmptyState>}</section>}
  </>;
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState(null);
  const [filter, setFilter] = useState({ search: '', status: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/documents', { params: filter.status ? { status: filter.status } : {} })
      .then(response => setDocuments(response.data))
      .catch(requestError => setError(getErrorMessage(requestError)));
  }, [filter.status]);
  const visibleDocuments = documents?.filter(document => (
    `${document.title} ${document.documentId} ${document.documentType}`.toLowerCase().includes(filter.search.toLowerCase())
  ));
  return <>
    <PageHeading eyebrow="KNOWLEDGE COLLECTION" title="Document library" description="Browse documents that are available to your account. Status and dates are shown only when supplied in source metadata." />
    <ErrorNotice>{error}</ErrorNotice>
    <div className="library-filters"><label><Search size={16} /><input value={filter.search} onChange={event => setFilter({ ...filter, search: event.target.value })} placeholder="Search title, ID, or type" /></label><select aria-label="Filter by status" value={filter.status} onChange={event => setFilter({ ...filter, status: event.target.value })}><option value="">All statuses</option><option value="CURRENT">Current</option><option value="SUPERSEDED">Superseded</option><option value="DRAFT">Draft</option><option value="EXPIRED">Expired</option></select></div>
    {documents === null ? <Loading label="Loading documents" /> : visibleDocuments.length === 0 ? <EmptyState title={documents.length ? 'No matching documents' : 'No documents available'}>{documents.length ? 'Try another search or status filter.' : 'Your organization has not made any documents available yet.'}</EmptyState> : <div className="document-grid">{visibleDocuments.map(document => <article className="document-card" key={document.documentId}><div className="document-card-top"><span className="document-type"><FileText size={16} />{document.documentType}</span><span className={`status-pill ${document.status === 'CURRENT' ? 'approved' : ''}`}>{document.status}</span></div><h2>{document.title}</h2><p className="document-id">{document.documentId} · Version {document.version || 'Not provided'}</p><div className="document-dates"><span><CalendarDays size={14} />Effective {document.effectiveDate ? new Date(document.effectiveDate).toLocaleDateString() : 'Not provided'}</span><span><Clock3 size={14} />{document.chunkCount || 0} indexed chunks · {document.processingStatus || 'STATUS UNKNOWN'}</span></div>{document.processingError && <p className="supersession">Indexing issue: {document.processingError}</p>}{document.supersedes?.length > 0 && <p className="supersession">Explicitly supersedes: {document.supersedes.join(', ')}</p>}</article>)}</div>}
  </>;
}

export function HistoryPage() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/rag/history').then(response => setHistory(response.data)).catch(requestError => setError(getErrorMessage(requestError)));
  }, []);
  return <>
    <PageHeading eyebrow="PRIVATE ACTIVITY" title="Search activity" description="Your account’s latest 50 searches. Activity is scoped to your authenticated user." />
    <ErrorNotice>{error}</ErrorNotice>
    {history === null ? <Loading label="Loading search history" /> : history.length === 0 ? <EmptyState title="Nothing to show yet">Your questions will appear here after your first search.</EmptyState> : <div className="activity-list">{history.map(item => <article className="history-card" key={item._id}><div className="activity-row"><span className="activity-icon"><Search size={17} /></span><span className="activity-main"><strong>{item.query}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="history-source-count">{item.sources?.length || 0} sources</span></div><p className="history-answer">{item.answer}</p><div className="history-citations">{item.sources?.map(source => <span key={source.documentId}><CheckCircle2 size={13} />{source.documentId || source.title || 'Source'}</span>)}</div></article>)}</div>}
  </>;
}

export function UploadPage() {
  const [form, setForm] = useState({ documentId: '', title: '', documentType: 'Operational Manual', version: '', issueDate: '', effectiveDate: '', status: 'CURRENT', supersedes: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!file) { setError('Choose a PDF or TXT file to upload.'); return; }
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
    payload.append('file', file);
    setLoading(true);
    try {
      const response = await api.post('/documents/upload', payload);
      setMessage(`Uploaded ${response.data.title}. Indexed ${response.data.chunkCount || 0} chunk(s).`);
      setForm({ documentId: '', title: '', documentType: 'Operational Manual', version: '', issueDate: '', effectiveDate: '', status: 'CURRENT', supersedes: '' });
      setFile(null);
      event.target.reset();
    } catch (requestError) { setError(getErrorMessage(requestError)); } finally { setLoading(false); }
  }
  return <>
    <PageHeading eyebrow="ADMINISTRATION" title="Add a document" description="Upload a source file and its metadata. Explicit supersession relationships are entered by an administrator; dates do not infer authority." />
    <ErrorNotice>{error}</ErrorNotice>
    {message && <div className="notice-success" role="status">{message}</div>}
    <form className="upload-panel form-stack" onSubmit={submit}><label>Source document ID<input required maxLength={100} value={form.documentId} onChange={event => setForm({ ...form, documentId: event.target.value })} /></label><label>Document title<input required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label><div className="form-row"><label>Document type<select value={form.documentType} onChange={event => setForm({ ...form, documentType: event.target.value })}><option>Operational Manual</option><option>Safety Bulletin</option><option>Regulatory Directive</option></select></label><label>Version / issue<input required maxLength={50} value={form.version} onChange={event => setForm({ ...form, version: event.target.value })} /></label></div><div className="form-row"><label>Issue date<input type="date" required value={form.issueDate} onChange={event => setForm({ ...form, issueDate: event.target.value })} /></label><label>Effective date<input type="date" required value={form.effectiveDate} onChange={event => setForm({ ...form, effectiveDate: event.target.value })} /></label></div><label>Explicitly supersedes <span className="optional">(optional, comma-separated document IDs)</span><input value={form.supersedes} onChange={event => setForm({ ...form, supersedes: event.target.value })} /></label><label className="file-control">PDF or plain-text file<input type="file" accept=".pdf,.txt,application/pdf,text/plain" required onChange={event => setFile(event.target.files?.[0] || null)} /><small>Maximum 10 MB. Scanned PDFs require OCR, which is not enabled.</small></label><button className="button-primary" disabled={loading}>{loading ? 'Uploading and indexing…' : 'Upload and index'} <ArrowRight size={16} /></button></form>
  </>;
}
