import { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';

// Calls GET /api/auth/me on every protected-page mount.
// If the backend returns 401 (no/expired cookie) we redirect to /login.
// While the request is in flight we render nothing to avoid a flash.
export default function ProtectedRoute() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'unauth'

  useEffect(() => {
    fetch('http://localhost:5000/api/auth/me', { credentials: 'include' })
      .then((res) => setStatus(res.ok ? 'ok' : 'unauth'))
      .catch(() => setStatus('unauth'));
  }, []);

  if (status === 'loading') return null;
  if (status === 'unauth') return <Navigate to="/login" replace />;
  return <Outlet />;
}
