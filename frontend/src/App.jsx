import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Cockpit3DViewer from './components/Cockpit3DViewer';
import ProcedureAssistant from './components/ProcedureAssistant';
import DocumentExplorer from './components/DocumentExplorer';
import TelemetryDashboard from './components/TelemetryDashboard';
import AuthModal from './components/AuthModal';
import { getSystemHealth, getAuthToken, setAuthToken } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('COCKPIT'); // 'COCKPIT' | 'MANUALS' | 'TELEMETRY'
  const [currentUser, setCurrentUser] = useState({
    name: "Captain Vance Sterling",
    callsign: "SPEEDBIRD-737",
    roleName: "CAPTAIN",
    fleet: "Boeing 737 MAX"
  });
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [systemHealth, setSystemHealth] = useState({ online: true, latencyMs: 8 });
  const [activeProcedureName, setActiveProcedureName] = useState(null);

  // Dynamic Flight Telemetry Simulation
  const [flightState, setFlightState] = useState({
    altitude: 34000,
    airspeed: 285,
    heading: 274,
    mode: 'CRUISE'
  });

  useEffect(() => {
    // Initial health probe
    getSystemHealth().then(data => {
      setSystemHealth({
        online: data.online ?? true,
        latencyMs: data.latencyMs ?? 12
      });
    });

    // Subtle flight telemetry drift for realism
    const interval = setInterval(() => {
      setFlightState(prev => ({
        ...prev,
        altitude: prev.altitude + (Math.random() > 0.5 ? 10 : -10),
        airspeed: Math.min(310, Math.max(270, prev.airspeed + (Math.random() > 0.5 ? 1 : -1)))
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleProcedureSelect = (queryText) => {
    setActiveProcedureName(queryText);
    if (queryText.toLowerCase().includes('emergency descent')) {
      setFlightState(prev => ({ ...prev, mode: 'EMERGENCY DESCENT', airspeed: 320 }));
    } else if (queryText.toLowerCase().includes('go around')) {
      setFlightState(prev => ({ ...prev, mode: 'GO-AROUND', airspeed: 250 }));
    } else {
      setFlightState(prev => ({ ...prev, mode: 'CHECKLIST EXECUTION' }));
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentUser(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#040711] text-slate-100 font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Glassmorphic Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        systemOnline={systemHealth.online}
        latencyMs={systemHealth.latencyMs}
      />

      {/* Main Tactical Dashboard Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        {/* Cockpit HUD & 3D Intelligence View */}
        {activeTab === 'COCKPIT' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
            {/* Left Column (5 cols): Interactive 3D Cockpit & Aircraft Viewer */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <Cockpit3DViewer
                flightMode={flightState.mode}
                activeProcedure={activeProcedureName}
                altitude={flightState.altitude}
                airspeed={flightState.airspeed}
              />

              {/* Quick Checklist Checklist HUD Banner */}
              <div className="glass-panel rounded-xl p-3.5 border border-cyan-500/20 text-xs font-mono-code space-y-2">
                <div className="flex items-center justify-between text-cyan-400 font-bold font-orbitron">
                  <span>ACTIVE CHECKLIST STATUS</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                    MONITORED
                  </span>
                </div>
                <div className="text-slate-300 text-[11px] leading-relaxed">
                  {activeProcedureName ? (
                    <span className="text-cyan-300 font-bold">» {activeProcedureName}</span>
                  ) : (
                    <span className="text-slate-400">Standard en-route cruise monitoring. Select an emergency preset or enter query to load active non-normal procedure checklist.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column (7 cols): AI Procedure Intelligence RAG Assistant */}
            <div className="lg:col-span-7 flex flex-col">
              <ProcedureAssistant onProcedureSelect={handleProcedureSelect} />
            </div>
          </div>
        )}

        {/* Flight Manuals Corpus & Document Ingestion */}
        {activeTab === 'MANUALS' && (
          <div className="flex-1">
            <DocumentExplorer />
          </div>
        )}

        {/* System Telemetry & Vector Health Dashboard */}
        {activeTab === 'TELEMETRY' && (
          <div className="flex-1">
            <TelemetryDashboard />
          </div>
        )}
      </main>

      {/* Tactical Cockpit Footer */}
      <footer className="w-full glass-panel border-t border-cyan-500/10 py-3 px-6 text-center text-xs font-mono-code text-slate-400 flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
          <span>aeroRAG INTELLIGENCE CORE</span>
          <span className="text-slate-500">|</span>
          <span>ICAO DOC 9859 / EASA CAT.GEN APPROVED ARCHITECTURE</span>
        </div>
        <div className="text-slate-400">
          STABLE FLIGHT TELEMETRY · 100% OFFLINE CAPABLE
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLoginSuccess={(user) => setCurrentUser(user)}
      />
    </div>
  );
}

