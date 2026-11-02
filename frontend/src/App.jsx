import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import { Loading } from './components/Shared.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import { DashboardPage, DocumentsPage, HistoryPage, SearchPage, UploadPage } from './pages/WorkspacePages.jsx';

function RequireAuth({ children, admin = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading"><Loading label="Checking your session" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Workspace({ children, admin = false }) {
  return <RequireAuth admin={admin}><AppShell /></RequireAuth>;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/" element={<Workspace />}><Route index element={<DashboardPage />} /><Route path="search" element={<SearchPage />} /><Route path="documents" element={<DocumentsPage />} /><Route path="history" element={<HistoryPage />} /></Route>
    <Route path="/admin" element={<Workspace admin />}><Route path="upload" element={<UploadPage />} /></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
