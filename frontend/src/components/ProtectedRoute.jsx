import { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Calls GET /api/auth/me on every protected-page mount.
// If the backend returns 401 (no/expired cookie) we redirect to /login.
// While the request is in flight we render nothing to avoid a flash.
// The resolved user object is forwarded to child routes via Outlet context.
export default function ProtectedRoute() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'unauth'
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/auth/me`, { credentials: 'include' })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setStatus('ok');
        } else {
          setStatus('unauth');
        }
      })
      .catch(() => setStatus('unauth'));
  }, []);

  if (status === 'loading') return null;
  if (status === 'unauth') return <Navigate to="/login" replace />;
  return <Outlet context={{ user }} />;
}
