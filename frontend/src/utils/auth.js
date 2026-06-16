const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export function getGuestSessionId() {
  return localStorage.getItem('guestSessionId');
}

export function ensureGuestSession() {
  let id = localStorage.getItem('guestSessionId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('guestSessionId', id);
  }
  return id;
}

export function clearGuestSession() {
  localStorage.removeItem('guestSessionId');
}

export function buildHeaders(extra = {}) {
  const sessionId = getGuestSessionId();
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (sessionId) headers['X-Guest-Session'] = sessionId;
  return headers;
}

export async function fetchAuthState() {
  const sessionId = getGuestSessionId();
  if (sessionId) {
    return { user: null, isAuthenticated: false, isGuest: true };
  }

  try {
    const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return { user: data.user, isAuthenticated: true, isGuest: false };
    }
  } catch { /* network error — treat as unauthenticated */ }
  return { user: null, isAuthenticated: false, isGuest: false };
}
