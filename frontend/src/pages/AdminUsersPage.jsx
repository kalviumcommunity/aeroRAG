import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, ShieldAlert } from 'lucide-react';
import { api, getErrorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorNotice, Loading, EmptyState, PageHeader } from '../components/Shared.jsx';
import { Button, Badge, Card, Input, Label } from '../components/ui.jsx';

export function AdminUsersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (user?.role !== 'admin') {
    navigate('/');
    return null;
  }
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/users').then((response) => setUsers(response.data)).catch((requestError) => setError(getErrorMessage(requestError)));
  }, []);

  async function updateRole(targetId, role) {
    setLoading(true);
    try {
      await api.patch(`/users/${targetId}/role`, { role });
      setMessage(`Role updated to ${role}.`);
      setUsers((prev) => (prev ? prev.map((u) => (u._id === targetId ? { ...u, role } : u)) : prev));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(targetId, email) {
    if (!window.confirm(`Remove ${email}?`)) return;
    setLoading(true);
    try {
      await api.delete(`/users/${targetId}`);
      setMessage(`${email} removed.`);
      setUsers((prev) => (prev ? prev.filter((u) => u._id !== targetId) : prev));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  if (!user || user.role !== 'admin') return <NavigateHome />;
  if (loading) return <Loading label="Loading users" />;
  if (error) return <div className="py-10"><ErrorNotice>{error}</ErrorNotice></div>;

  return (
    <>
      <div className="mb-6 flex items-center gap-2">
        <Users size={20} className="text-brand" />
        <h1 className="text-xl font-semibold text-ink">User management</h1>
      </div>
      <p className="text-muted text-sm mb-6">Administrator-only area. Public registration creates only ground_staff accounts.</p>
      {message && <div className="mb-4 rounded-lg border border-green-100 bg-green-50 p-3 text-sm text-green-700" role="status">{message}</div>}
      <ErrorNotice>{error}</ErrorNotice>

      {users === null ? <Loading label="Loading users" /> : users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <Card key={u._id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="avatar flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white text-sm font-semibold">
                    {u.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-ink">{u.name}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </div>
                </div>
                <Badge variant={u.role === 'admin' ? 'current' : 'default'}>{u.role}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="mb-0 text-xs text-muted">Role</Label>
                  <select
                    value={u.role}
                    onChange={(e) => updateRole(u._id, e.target.value)}
                    disabled={String(u._id) === String(user._id) && u.role !== 'admin'}
                    className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="ground_staff">Ground staff</option>
                    <option value="admin">Administrator</option>
                  </select>
                  {String(u._id) === String(user._id) && u.role !== 'admin' && (
                    <span className="text-xs text-muted">(cannot revoke your own admin)</span>
                  )}
                </div>
                {String(u._id) !== String(user._id) && (
                  <Button variant="danger" size="sm" onClick={() => deleteUser(u._id, u.email)}>
                    <ShieldAlert size={14} /> Remove
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function NavigateHome() {
  return null;
}
