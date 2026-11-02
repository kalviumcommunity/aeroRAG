import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  Compass,
  FileText,
    LayoutDashboard,
  LogOut,
  Search,
  ShieldCheck,
  Users,
  Waves,
  ChevronLeft
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { SafetyNotice } from './Shared.jsx';

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/search', label: 'Ask AeroRAG', icon: Compass },
  { to: '/documents', label: 'Document library', icon: BookOpen },
  { to: '/history', label: 'Search activity', icon: Activity }
];

const adminNavItems = [
  { to: '/admin/upload', label: 'Upload document', icon: FileText },
  { to: '/admin/users', label: 'User management', icon: Users }
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 700;

  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
    const handleResize = () => setSidebarOpen(window.innerWidth >= 700 ? false : sidebarOpen && window.innerWidth < 700);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile, sidebarOpen]);

  const activeAdmin = adminNavItems.some((item) => location.pathname.startsWith(item.to));

  return (
    <div className="app-shell relative min-h-screen bg-paper">
      <aside className={`aero-sidebar fixed inset-y-0 left-0 z-40 w-72 bg-ink border-r border-line/10 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${!isMobile ? 'relative translate-x-0 static' : ''}`}>
        <div className="flex h-full flex-col">
          <div className="p-5 border-b border-line/10">
            <a href="/" className="flex items-center gap-3" onClick={(e) => { if (isMobile) { e.preventDefault(); setSidebarOpen(false); navigate('/'); } }}>
              <span className="brand-symbol"><Waves size={20} /></span>
              <span>
                <strong className="text-sm text-white">AeroRAG</strong>
                <br />
                <span className="text-[10px] text-muted tracking-wider">DOCUMENT INTELLIGENCE</span>
              </span>
            </a>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Main navigation">
            <div className="px-3 text-[10px] font-bold text-muted tracking-wider uppercase mb-3">WORKSPACE</div>
            {navItems.map(({ to, label, icon: Icon, end }) => {
              const isActive = location.pathname === to || (end && location.pathname === '/');
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive: active }) => {
                    const base = 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors';
                    if (active || isActive) return `${base} bg-brand/10 text-brand border border-brand/20`;
                    return `${base} text-slate-400 hover:bg-slate-200/50 hover:text-ink`;
                  }}
                  onClick={() => { if (isMobile) setSidebarOpen(false); }}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </NavLink>
              );
            })}
            {user?.role === 'admin' && (
              <>
                <div className="px-3 text-[10px] font-bold text-muted tracking-wider uppercase mb-3 mt-4">ADMINISTRATION</div>
                {adminNavItems.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive: active }) => {
                      const base = 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors';
                      if (active || activeAdmin) return `${base} bg-brand/10 text-brand border border-brand/20`;
                      return `${base} text-slate-400 hover:bg-slate-200/50 hover:text-ink`;
                    }}
                    onClick={() => { if (isMobile) setSidebarOpen(false); }}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </>
            )}
          </nav>
          <div className="p-4 border-t border-line/10">
            <div className="flex items-center gap-3 rounded-xl border border-line/10 bg-slate-50/50 p-3">
              <ShieldCheck size={16} className="text-brand" />
              <div>
                <div className="text-[10px] font-bold text-muted">Evidence first</div>
                <div className="text-xs text-slate-600">Answers link to retrieved passages</div>
              </div>
            </div>
            <button
              onClick={() => { signOut(); navigate('/login'); if (isMobile) setSidebarOpen(false); }}
              className="mt-3 w-full flex items-center gap-3 rounded-xl border border-line/10 bg-white px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <main className={`aero-main-panel min-h-screen ${isMobile ? '' : 'pl-72'}`}>
        <header className="aero-topbar sticky top-0 z-20 border-b border-line/10 bg-white/80 backdrop-blur-md">
          <div className="flex items-center justify-between px-4 md:px-6 h-14">
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 transition-colors"
                aria-label="Open navigation"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="topbar-label flex items-center gap-1.5 text-[10px] font-bold text-muted tracking-wider uppercase">
              <span className="w-2 h-2 rounded-full bg-brand" /> DOCUMENT SEARCH
            </div>
            <div className="user-chip hidden md:flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-1.5 text-xs">
              <span className="avatar flex h-6 w-6 items-center justify-center rounded-lg bg-brand text-white text-xs font-semibold">
                {(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}
              </span>
              <div className="overflow-hidden">
                <div className="text-sm font-semibold text-ink">{user?.name || user?.email}</div>
                <div className="text-[10px] text-muted capitalize">{user?.role}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 text-muted hover:text-ink transition-colors" aria-label="Help">
                <ShieldCheck size={16} />
              </button>
            </div>
          </div>
        </header>
        <div className="aero-page-content p-4 md:p-6">
          <SafetyNotice />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
