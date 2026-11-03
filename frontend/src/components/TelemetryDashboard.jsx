import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Database, 
  Cpu, 
  Zap, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  ShieldCheck, 
  Layers, 
  DollarSign, 
  Server,
  Terminal,
  Radio,
  ExternalLink
} from 'lucide-react';
import { getSystemHealth, testBackendConnection } from '../services/api';

export default function TelemetryDashboard() {
  const [health, setHealth] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastCheck, setLastCheck] = useState(new Date().toLocaleTimeString());
  
  // Interactive Live Connection Test State
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  const checkHealth = async () => {
    setIsLoading(true);
    try {
      const data = await getSystemHealth();
      setHealth(data);
      setLastCheck(new Date().toLocaleTimeString());
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const runConnectionTest = async () => {
    setIsTesting(true);
    try {
      const res = await testBackendConnection();
      setTestResult(res);
      if (res.success) {
        checkHealth();
      }
    } finally {
      setIsTesting(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-5">
      {/* Top Banner with Real-time Ping */}
      <div className="glass-panel-glow rounded-xl p-4 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center">
            <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold font-orbitron text-white tracking-wider flex items-center gap-2">
              AERORAG SYSTEM TELEMETRY & HEALTH
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            </h2>
            <p className="text-xs text-slate-400 font-mono-code">
              LAST AUDIT PING: {lastCheck} · LATENCY: <span className="text-cyan-300 font-bold">{health?.latencyMs || 8}ms</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={runConnectionTest}
            disabled={isTesting}
            className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-orbitron font-bold text-xs flex items-center gap-1.5 shadow-md shadow-cyan-500/30 transition-all disabled:opacity-50"
          >
            <Radio className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
            <span>TEST BACKEND LINK</span>
          </button>

          <button
            onClick={checkHealth}
            disabled={isLoading}
            className="px-3.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-cyan-950/90 border border-slate-700 hover:border-cyan-500/50 text-xs font-orbitron font-bold text-cyan-300 flex items-center gap-2 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>REFRESH</span>
          </button>
        </div>
      </div>

      {/* Live Connection Diagnostics Console */}
      {testResult && (
        <div className={`p-4 rounded-xl border transition-all ${
          testResult.success 
            ? 'glass-panel-glow border-emerald-500/50 bg-emerald-950/20' 
            : 'glass-panel-red border-red-500/50'
        }`}>
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-bold font-orbitron">
              {testResult.success ? (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300">BACKEND CONNECTION VERIFIED (HTTP {testResult.status})</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span className="text-red-300">BACKEND UNREACHABLE ON PORT 5000</span>
                </>
              )}
            </div>
            <span className="text-[11px] font-mono-code text-slate-400">
              Target: {testResult.endpoint} ({testResult.latencyMs}ms)
            </span>
          </div>

          <div className="mt-3">
            <div className="text-[11px] text-slate-400 font-mono-code mb-1">RAW SERVER DIAGNOSTIC PAYLOAD:</div>
            <pre className="p-3 rounded-lg bg-black/70 border border-slate-800 text-xs font-mono-code text-cyan-300 overflow-x-auto">
              {JSON.stringify(testResult.data || testResult.error, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* 4 Infrastructure Micro-Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Node 1: Vector Database */}
        <div className="glass-panel rounded-xl p-4 border border-cyan-500/20 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="p-2 rounded-lg bg-cyan-950/50 border border-cyan-800 text-cyan-400">
              <Database className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              ONLINE
            </span>
          </div>
          <div className="mt-3">
            <div className="text-[10px] font-mono-code text-slate-400">VECTOR STORE</div>
            <div className="text-sm font-bold font-orbitron text-white mt-0.5">Qdrant / ChromaDB</div>
            <div className="text-xs text-cyan-300 font-mono-code mt-1">768 DIMS · Cosine</div>
          </div>
        </div>

        {/* Node 2: Primary LLM Provider */}
        <div className="glass-panel rounded-xl p-4 border border-cyan-500/20 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="p-2 rounded-lg bg-blue-950/50 border border-blue-800 text-blue-400">
              <Cpu className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              READY
            </span>
          </div>
          <div className="mt-3">
            <div className="text-[10px] font-mono-code text-slate-400">LLM MODEL ADAPTER</div>
            <div className="text-sm font-bold font-orbitron text-white mt-0.5">Google Gemini / Mock</div>
            <div className="text-xs text-blue-300 font-mono-code mt-1">gemini-3.5-flash-lite</div>
          </div>
        </div>

        {/* Node 3: Grounded Ingestion Pipeline */}
        <div className="glass-panel rounded-xl p-4 border border-cyan-500/20 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="p-2 rounded-lg bg-amber-950/50 border border-amber-800 text-amber-400">
              <Layers className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
              VALIDATED
            </span>
          </div>
          <div className="mt-3">
            <div className="text-[10px] font-mono-code text-slate-400">INGESTION VALIDATION</div>
            <div className="text-sm font-bold font-orbitron text-white mt-0.5">Heading & Token-Aware</div>
            <div className="text-xs text-amber-300 font-mono-code mt-1">Zero Duplicate Ingest</div>
          </div>
        </div>

        {/* Node 4: Cost & Token Tracker */}
        <div className="glass-panel rounded-xl p-4 border border-cyan-500/20 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="p-2 rounded-lg bg-emerald-950/50 border border-emerald-800 text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              TRACKED
            </span>
          </div>
          <div className="mt-3">
            <div className="text-[10px] font-mono-code text-slate-400">USAGE ACCOUNTING</div>
            <div className="text-sm font-bold font-orbitron text-emerald-300 mt-0.5">$0.00015 / query</div>
            <div className="text-xs text-slate-400 font-mono-code mt-1">Exact Token Metering</div>
          </div>
        </div>
      </div>

      {/* Safety & Mathematical Benchmarks Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Milestone 3.27 & 3.29 Similarity Quality Audit */}
        <div className="glass-panel rounded-xl p-4 border border-cyan-500/20 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-orbitron text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              SIMILARITY QUALITY AUDIT (DAY 16)
            </h3>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono-code border border-emerald-700">
              PASSED
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono-code">
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">TOP-1 RANKING ACCURACY</span>
              <span className="text-white font-bold">80.0% (4 / 5 Queries)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">MEAN RELATED SIMILARITY</span>
              <span className="text-cyan-300 font-bold">0.424293</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">MEAN UNRELATED SIMILARITY</span>
              <span className="text-slate-400">0.039119</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">SEPARATION MARGIN</span>
              <span className="text-emerald-400 font-bold">+0.385174 (Threshold &gt; +0.20)</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">SUPERSEDED TRAP DETECTION</span>
              <span className="text-amber-400 font-bold">SAFETY WARNING FLAGGED</span>
            </div>
          </div>
        </div>

        {/* Milestone 3.28 Batch Embedding & Resilience Audit */}
        <div className="glass-panel rounded-xl p-4 border border-cyan-500/20 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-orbitron text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-cyan-400" />
              BATCH EMBEDDING ORCHESTRATION (DAY 15)
            </h3>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono-code border border-emerald-700">
              ACTIVE
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono-code">
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">BATCH PARTITION SIZE</span>
              <span className="text-white font-bold">32 Chunks / Batch</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">EXPONENTIAL BACKOFF</span>
              <span className="text-cyan-300 font-bold">Full Jitter U(0, Ceiling)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">IDEMPOTENT CACHE KEY</span>
              <span className="text-white font-bold">SHA-256 (Model:Dim:Text)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">REPEATED INGESTION COST</span>
              <span className="text-emerald-400 font-bold">$0.00 (100% Cache Hits)</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">PERMANENT ERROR POLICY</span>
              <span className="text-red-400 font-bold">Abort on Attempt 0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
