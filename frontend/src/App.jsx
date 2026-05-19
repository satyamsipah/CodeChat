import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import AddRepo from './pages/AddRepo.jsx';
import ChatShell from './pages/ChatShell.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"  element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Protected routes — redirects to /login if not authenticated */}
        <Route element={<ProtectedRoute />}>
          <Route path="/add-repo" element={<AddRepo />} />
          <Route path="/chat"     element={<ChatShell />} />
        </Route>

        {/* Redirect root to /login by default */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
