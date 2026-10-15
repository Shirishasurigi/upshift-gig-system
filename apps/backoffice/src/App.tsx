import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Me } from './api';
import Login from './pages/Login';
import Queue from './pages/Queue';
import GigDetail from './pages/GigDetail';
import Sources from './pages/Sources';
import Runs from './pages/Runs';

export default function App() {
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('GET', '/api/v1/auth/me') });
  const logout = useMutation({
    mutationFn: () => api('POST', '/api/v1/auth/logout'),
    onSuccess: () => { qc.clear(); qc.setQueryData(['me'], null); },
  });

  if (meQ.isLoading) return <div className="center">Loading...</div>;
  if (!meQ.data) return <Login />;
  const me = meQ.data;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>UpShift<span>Gig Review</span></h1>
        <nav>
          <NavLink to="/queue">Review queue</NavLink>
          <NavLink to="/runs">Discovery runs</NavLink>
          <NavLink to="/sources">Sources</NavLink>
        </nav>
        <div className="who">
          <strong>{me.name}</strong>
          <span className="muted">{me.role}</span>
          <button className="link" onClick={() => logout.mutate()}>Log out</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/queue" replace />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/gigs/:id" element={<GigDetail me={me} />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/sources" element={<Sources me={me} />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
