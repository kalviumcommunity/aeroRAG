import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, BookOpenText, FileUp, LogOut, Search, ShieldCheck, Waves } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { SafetyNotice } from './Shared.jsx';

const navItems = [
  { to: '/', label: 'Overview', icon: Waves, end: true },
  { to: '/search', label: 'Ask AeroRAG', icon: Search },
  { to: '/documents', label: 'Document library', icon: BookOpenText },
  { to: '/history', label: 'Search activity', icon: Activity }
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="/" aria-label="AeroRAG overview">
          <span className="brand-symbol"><Waves size={21} /></span>
          <span><strong>AeroRAG</strong><small>DOCUMENT INTELLIGENCE</small></span>
        </a>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} /><span>{label}</span>
            </NavLink>
          ))}
          {user?.role === 'admin' && <NavLink to="/admin/upload" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><FileUp size={18} /><span>Upload document</span></NavLink>}
        </nav>
        <div className="sidebar-bottom">
          <div className="prototype-card"><ShieldCheck size={17} /><div><strong>Evidence first</strong><span>Answers link to retrieved passages.</span></div></div>
          <button className="nav-link signout" onClick={() => { signOut(); navigate('/login'); }}><LogOut size={18} /><span>Sign out</span></button>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-label"><span className="status-dot" /> DOCUMENT SEARCH</div>
          <div className="user-chip"><span className="avatar">{(user?.name || 'U').slice(0, 1).toUpperCase()}</span><span>{user?.name || user?.email}</span><span className="role-label">{user?.role}</span></div>
        </header>
        <div className="page-content">
          <SafetyNotice />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
