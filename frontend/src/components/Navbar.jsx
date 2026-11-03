import React from 'react';
import { 
  Plane, 
  ShieldCheck, 
  Layers, 
  Activity, 
  Terminal, 
  User, 
  LogOut, 
  Wifi, 
  WifiOff,
  Compass
} from 'lucide-react';

export default function Navbar({ 
  activeTab, 
  setActiveTab, 
  currentUser, 
  onOpenAuth, 
  onLogout,
  systemOnline = true,
  latencyMs = 8
}) {
  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-cyan-500/20 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo & Callsign */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center p-0.5 shadow-lg shadow-cyan-500/30">
            <div className="w-full h-full bg-[#040711] rounded-[10px] flex items-center justify-center">
              <Plane className="w-5 h-5 text-cyan-400 rotate-45" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-orbitron font-extrabold text-lg tracking-wider text-white">
                aero<span className="text-cyan-400">RAG</span>
              </span>
              <span className="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                v2.4
              </span>
            </div>
            <div className="text-[10px] font-mono-code text-slate-400 uppercase tracking-widest">
              Airline Procedure Intelligence
            </div>
          </div>
        </div>

        {/* Tactical Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 bg-black/50 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('COCKPIT')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-orbitron font-bold flex items-center gap-2 transition-all ${
              activeTab === 'COCKPIT'
                ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-900/60'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>COCKPIT HUD & 3D</span>
          </button>

          <button
            onClick={() => setActiveTab('MANUALS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-orbitron font-bold flex items-center gap-2 transition-all ${
              activeTab === 'MANUALS'
                ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-900/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>FLIGHT MANUALS</span>
          </button>

          <button
            onClick={() => setActiveTab('TELEMETRY')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-orbitron font-bold flex items-center gap-2 transition-all ${
              activeTab === 'TELEMETRY'
                ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-900/60'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>TELEMETRY & HEALTH</span>
          </button>
        </nav>

        {/* Right Status Indicators & Crew Sign-in */}
        <div className="flex items-center gap-3">
          {/* Live System Health Pill */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/60 border border-slate-800 text-xs font-mono-code">
            {systemOnline ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-slate-300">LINK:</span>
                <span className="text-emerald-400 font-bold">ONLINE</span>
                <span className="text-slate-500">({latencyMs}ms)</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span className="text-slate-300">MODE:</span>
                <span className="text-amber-400 font-bold">DEMO/OFFLINE</span>
              </>
            )}
          </div>

          {/* User Profile Button */}
          {currentUser ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-bold text-white font-orbitron leading-tight">
                  {currentUser.callsign || currentUser.name}
                </div>
                <div className="text-[10px] text-cyan-400 font-mono-code leading-tight">
                  {currentUser.roleName || 'CAPTAIN'} · B737
                </div>
              </div>

              <button
                onClick={onLogout}
                className="p-2 rounded-lg bg-slate-900 hover:bg-red-950/80 border border-slate-700 hover:border-red-500/50 text-slate-400 hover:text-red-300 transition-all"
                title="Sign out of flight deck"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold font-orbitron text-xs flex items-center gap-1.5 shadow-md shadow-cyan-500/20 transition-all"
            >
              <User className="w-3.5 h-3.5 text-black" />
              <span>CREW SIGN IN</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex border-t border-slate-800 bg-black/80 px-2 py-1.5 justify-around text-xs font-orbitron">
        <button
          onClick={() => setActiveTab('COCKPIT')}
          className={`py-1 px-2 rounded ${activeTab === 'COCKPIT' ? 'text-cyan-400 font-bold' : 'text-slate-400'}`}
        >
          COCKPIT
        </button>
        <button
          onClick={() => setActiveTab('MANUALS')}
          className={`py-1 px-2 rounded ${activeTab === 'MANUALS' ? 'text-cyan-400 font-bold' : 'text-slate-400'}`}
        >
          MANUALS
        </button>
        <button
          onClick={() => setActiveTab('TELEMETRY')}
          className={`py-1 px-2 rounded ${activeTab === 'TELEMETRY' ? 'text-cyan-400 font-bold' : 'text-slate-400'}`}
        >
          HEALTH
        </button>
      </div>
    </header>
  );
}

