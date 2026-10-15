import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorText, type Me } from '../api';
import { Banner } from '../ui';

export default function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<Me & { email: string }>('POST', '/api/v1/auth/login', { email, password }),
    onSuccess: (u) => qc.setQueryData(['me'], { id: u.id, role: u.role, name: u.name }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); login.mutate(); };

  return (
    <div className="center">
      <form className="login" onSubmit={submit}>
        <h1>UpShift Gig Review</h1>
        <p className="muted">Sign in to review discovered opportunities.</p>
        {login.isError && <Banner kind="error">{errorText(login.error)}</Banner>}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="primary" type="submit" disabled={login.isPending}>{login.isPending ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  );
}
