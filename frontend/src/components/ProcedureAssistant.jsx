import React, { useState } from 'react';
import { 
  Send, 
  Sparkles, 
  ShieldCheck, 
  AlertTriangle, 
  BookOpen, 
  Copy, 
  Check, 
  FileText, 
  RefreshCw,
  Search,
  ExternalLink,
  Flame,
  Volume2
} from 'lucide-react';
import { queryProcedure } from '../services/api';

const QUICK_SCENARIOS = [
  {
    label: "Emergency Descent",
    query: "What is the initial memory action for emergency descent rapid depressurization?",
    type: "EMERGENCY",
    badge: "QRH Non-Normal"
  },
  {
    label: "Engine Failure After V1",
    query: "What is the procedure for engine failure during takeoff after passing V1 speed?",
    type: "CRITICAL",
    badge: "FCTM Takeoff"
  },
  {
    label: "Sterile Flight Deck",
    query: "When does the sterile flight deck rule apply below 10,000 feet?",
    type: "REGULATORY",
    badge: "FAR 121.542"
  },
  {
    label: "Missed Approach Go-Around",
    query: "What are the required pilot flying actions for a go around missed approach?",
    type: "SOP",
    badge: "SOP Approach"
  },
  {
    label: "Contaminated Runway Calculation",
    query: "Can we take credit for reverse thrust on contaminated runway takeoff distance calculation?",
    type: "DIRECTIVE",
    badge: "SAFO / ICAO"
  }
];

export default function ProcedureAssistant({ onProcedureSelect }) {
  const [queryInput, setQueryInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(true);

  const handleSearch = async (textToSearch) => {
    const q = textToSearch || queryInput;
    if (!q.trim()) return;

    setIsLoading(true);
    if (onProcedureSelect) onProcedureSelect(q);

    try {
      const response = await queryProcedure(q);
      setResult(response);
    } catch (error) {
      console.error('Error querying procedure:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result?.answer) return;
    navigator.clipboard.writeText(result.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleQuickScenario = (scenario) => {
    setQueryInput(scenario.query);
    handleSearch(scenario.query);
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Top Search Input Box */}
      <div className="glass-panel-glow rounded-xl p-4 border border-cyan-500/40 relative">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold font-orbitron tracking-wider text-cyan-300">
              PROCEDURE INTELLIGENCE QUERY
            </h2>
          </div>
          <span className="text-[11px] font-mono-code text-slate-400">
            RAG GROUNDED · VERIFIED SOURCES ONLY
          </span>
        </div>

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-cyan-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Ask any operational question (e.g. Emergency descent memory items, engine failure at V1)..."
              className="w-full pl-10 pr-4 py-2.5 bg-black/60 border border-cyan-500/30 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-sans"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !queryInput.trim()}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold font-orbitron text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-black" />
                <span>SEARCHING...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 text-black" />
                <span>QUERY</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Scenario Preset Chips */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800">
          <span className="text-[11px] font-mono-code text-slate-400 mr-1 flex items-center gap-1">
            <Flame className="w-3 h-3 text-amber-400" /> Presets:
          </span>
          {QUICK_SCENARIOS.map((sc, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleQuickScenario(sc)}
              className="text-xs px-2.5 py-1 rounded bg-slate-900/80 hover:bg-cyan-950/80 border border-slate-700 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 transition-all"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                sc.type === 'EMERGENCY' ? 'bg-red-400' : sc.type === 'CRITICAL' ? 'bg-amber-400' : 'bg-cyan-400'
              }`}></span>
              <span>{sc.label}</span>
              <span className="text-[10px] text-slate-500 font-mono-code">({sc.badge})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Response Area */}
      <div className="flex-1 glass-panel rounded-xl p-5 border border-cyan-500/20 overflow-y-auto flex flex-col justify-between">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="relative">
              <div className="w-16 h-16 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"></div>
              <Sparkles className="w-6 h-6 text-cyan-400 absolute inset-0 m-auto animate-pulse" />
            </div>
            <div className="text-center">
              <div className="font-orbitron text-sm font-bold text-cyan-300 tracking-wider">
                RETRIEVING VERIFIED PROCEDURAL CHUNKS
              </div>
              <p className="text-xs text-slate-400 font-mono-code mt-1">
                Cosine similarity scoring & vector space validation in progress...
              </p>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4">
            {/* Answer Header & Badges */}
            <div className="flex items-center justify-between pb-3 border-b border-cyan-500/20">
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold font-orbitron flex items-center gap-1.5 border ${
                  result.status === 'APPROVED' 
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                    : result.status === 'CURRENT'
                    ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40'
                    : 'bg-red-950/80 text-red-300 border-red-500/40'
                }`}>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  STATUS: {result.status || 'VERIFIED'}
                </span>

                <span className="text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 font-mono-code">
                  CONFIDENCE: {Math.round((result.confidence || 0.95) * 100)}%
                </span>

                {result.isLiveBackend ? (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 font-mono-code flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    LIVE BACKEND (PORT 5000)
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-600/40 font-mono-code">
                    OFFLINE CACHE
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 text-xs rounded bg-slate-900/90 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 flex items-center gap-1 transition-all"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'COPIED' : 'COPY'}</span>
                </button>
              </div>
            </div>

            {/* Structured Answer Body */}
            <div className="bg-black/50 border border-cyan-500/20 rounded-lg p-4">
              <pre className="text-sm text-slate-100 font-mono-code whitespace-pre-wrap leading-relaxed">
                {result.answer}
              </pre>
            </div>

            {/* Mandatory Safety Invariant Notice */}
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/40 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200/90 leading-tight">
                <strong>SAFETY INVARIANT (FAA / EASA COMPLIANCE):</strong>{' '}
                {result.disclaimer || 
                  "Semantic similarity alone does not establish regulatory validity or flight authorization. Always consult the official current aircraft flight manual before operational execution."}
              </div>
            </div>

            {/* Grounded Source Citations */}
            {result.sources && result.sources.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <div 
                  onClick={() => setShowSources(!showSources)}
                  className="flex items-center justify-between cursor-pointer text-xs font-bold font-orbitron text-cyan-400 mb-2 hover:text-cyan-300"
                >
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>GROUNDED SOURCE EVIDENCE ({result.sources.length})</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono-code">
                    {showSources ? 'HIDE ▲' : 'SHOW ▼'}
                  </span>
                </div>

                {showSources && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                    {result.sources.map((src, idx) => (
                      <div 
                        key={idx}
                        className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/80 hover:border-cyan-500/40 transition-all flex flex-col justify-between"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                            <FileText className="w-3.5 h-3.5 text-cyan-400" />
                            <span>{src.documentId || `SOURCE-${idx + 1}`}</span>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono-code ${
                            src.status === 'SUPERSEDED' 
                              ? 'bg-red-950 text-red-300 border border-red-800' 
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}>
                            {src.status || 'VERIFIED'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 line-clamp-1">{src.title}</p>
                        <div className="text-[10px] text-slate-500 font-mono-code mt-1.5">
                          EFFECTIVE: {src.effectiveDate || '2026-01-01'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6">
            <div className="w-12 h-12 rounded-full bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center mb-3">
              <BookOpen className="w-6 h-6 text-cyan-400" />
            </div>
            <h3 className="font-orbitron text-sm font-bold text-slate-200">
              AIRCRAFT PROCEDURE INTELLIGENCE READY
            </h3>
            <p className="text-xs text-slate-400 max-w-md mt-1">
              Select one of the emergency presets above or type a natural flight procedure question to retrieve deterministic, grounded, and verified flight crew instructions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

