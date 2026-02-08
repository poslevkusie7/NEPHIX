'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Authentication failed.');
      }

      router.push('/study');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ marginBottom: 4 }}>
        <button
          type="button"
          className={`btn ${mode === 'login' ? 'btn-primary' : ''}`}
          onClick={() => setMode('login')}
          style={{ flex: 1 }}
        >
          Login
        </button>
        <button
          type="button"
          className={`btn ${mode === 'signup' ? 'btn-primary' : ''}`}
          onClick={() => setMode('signup')}
          style={{ flex: 1 }}
        >
          Sign Up
        </button>
      </div>

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          required
        />
      </label>

      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}
      </button>
    </form>
  );
}
