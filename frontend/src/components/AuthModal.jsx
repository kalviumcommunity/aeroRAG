import React, { useState } from 'react';
import { X, Shield, Lock, Mail, User, Check, Plane } from 'lucide-react';
import { loginUser } from '../services/api';

export default function AuthModal({ isOpen, onClose, onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('CAPTAIN');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleQuickDemoLogin = async (roleName, demoEmail) => {
    setIsLoading(true);
    try {
      const user = await loginUser(demoEmail || `${roleName.toLowerCase()}@aerorag.aero`, 'demo1234');
      user.roleName = roleName;
      if (onLoginSuccess) onLoginSuccess(user);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    try {
      const user = await loginUser(email, password);
      if (onLoginSuccess) onLoginSuccess(user);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-md glass-panel-glow rounded-2xl p-6 border border-cyan-500/40 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-lg bg-cyan-950/80 border border-cyan-500/50 text-cyan-400">
            <Plane className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold font-orbitron text-white tracking-wider">
              FLIGHT CREW AUTHENTICATION
            </h2>
            <p className="text-xs text-slate-400 font-mono-code">
              aeroRAG Role-Based Access Control
            </p>
          </div>
        </div>

        {/* 1-Click Quick Pilot Roles */}
        <div className="mb-5 space-y-2">
          <div className="text-[11px] font-mono-code text-cyan-400 font-bold uppercase tracking-wider">
            Quick Crew Sign-in (1-Click)
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleQuickDemoLogin('Captain', 'captain.sterling@aerorag.aero')}
              className="p-2.5 rounded-lg bg-slate-900/80 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-500 text-center transition-all group"
            >
              <div className="text-xs font-bold text-white group-hover:text-cyan-300 font-orbitron">
                CAPTAIN
              </div>
              <div className="text-[10px] text-slate-400 font-mono-code mt-0.5">Full Admin</div>
            </button>

            <button
              onClick={() => handleQuickDemoLogin('First Officer', 'first.officer@aerorag.aero')}
              className="p-2.5 rounded-lg bg-slate-900/80 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-500 text-center transition-all group"
            >
              <div className="text-xs font-bold text-white group-hover:text-cyan-300 font-orbitron">
                FIRST OFFICER
              </div>
              <div className="text-[10px] text-slate-400 font-mono-code mt-0.5">Flight Crew</div>
            </button>

            <button
              onClick={() => handleQuickDemoLogin('Safety Inspector', 'inspector@aerorag.aero')}
              className="p-2.5 rounded-lg bg-slate-900/80 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-500 text-center transition-all group"
            >
              <div className="text-xs font-bold text-white group-hover:text-cyan-300 font-orbitron">
                INSPECTOR
              </div>
              <div className="text-[10px] text-slate-400 font-mono-code mt-0.5">Auditor</div>
            </button>
          </div>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase font-mono-code">
            <span className="bg-[#0b1329] px-2 text-slate-500">Or Custom Credentials</span>
          </div>
        </div>

        {/* Custom Form */}
        <form onSubmit={handleCustomSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-mono-code text-slate-400 mb-1">CALLSIGN / EMAIL</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="crew.member@aerorag.aero"
                className="w-full pl-9 pr-3 py-2 bg-black/60 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono-code"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono-code text-slate-400 mb-1">PASSWORD / PIN</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-black/60 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono-code"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold font-orbitron text-xs tracking-wider shadow-lg shadow-cyan-500/30 transition-all"
          >
            {isLoading ? 'AUTHENTICATING...' : 'SIGN IN TO FLIGHT DECK'}
          </button>
        </form>
      </div>
    </div>
  );
}

