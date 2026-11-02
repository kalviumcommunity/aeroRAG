import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import { Loading } from './components/Shared.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { SearchPage } from './pages/SearchPage.jsx';
import { DocumentsPage } from './pages/DocumentsPage.jsx';
import { DocumentDetailPage } from './pages/DocumentDetailPage.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { ComparePage } from './pages/ComparePage.jsx';
import { UploadPage } from './pages/UploadPage.jsx';
import { AdminUsersPage } from './pages/AdminUsersPage.jsx';

function RequireAuth({ children, admin = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading flex h-full items-center justify-center"><Loading label="Checking your session" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function ProtectedLayout() {
  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  );
}

function AdminLayout() {
  return (
    <RequireAuth admin={true}>
      <AppShell />
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:documentId" element={<DocumentDetailPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="compare" element={<ComparePage />} />
      </Route>
      <Route element={<AdminLayout />}>
        <Route path="admin/upload" element={<UploadPage />} />
        <Route path="admin/users" element={<AdminUsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
