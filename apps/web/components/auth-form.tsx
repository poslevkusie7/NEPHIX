'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'forgot') {
        const response = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email }),
        });

        const body = (await response.json().catch(() => null)) as
          | { error?: string; message?: string; resetToken?: string }
          | null;

        if (!response.ok) {
          throw new Error(body?.error ?? 'Failed to start password reset.');
        }

        if (body?.resetToken) {
          setResetToken(body.resetToken);
          setMode('reset');
          setNotice('Reset token generated. Enter a new password to complete reset.');
        } else {
          setNotice(body?.message ?? 'If the account exists, reset instructions were generated.');
        }
        return;
      }

      if (mode === 'reset') {
        const response = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: resetToken, password }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
        if (!response.ok) {
          throw new Error(body?.error ?? 'Failed to reset password.');
        }

        setMode('login');
        setPassword('');
        setNotice(body?.message ?? 'Password reset complete. You can now login.');
        return;
      }

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
          className={`btn ${mode === 'login' || mode === 'forgot' || mode === 'reset' ? 'btn-primary' : ''}`}
          onClick={() => {
            setMode('login');
            setError(null);
            setNotice(null);
          }}
          style={{ flex: 1 }}
        >
          Login
        </button>
        <button
          type="button"
          className={`btn ${mode === 'signup' ? 'btn-primary' : ''}`}
          onClick={() => {
            setMode('signup');
            setError(null);
            setNotice(null);
          }}
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
          disabled={mode === 'reset'}
        />
      </label>

      {mode !== 'forgot' ? (
        <label className="field">
          <span>{mode === 'reset' ? 'New Password' : 'Password'}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={8}
            required
          />
        </label>
      ) : null}

      {mode === 'reset' ? (
        <label className="field">
          <span>Reset Token</span>
          <input
            value={resetToken}
            onChange={(event) => setResetToken(event.target.value)}
            autoComplete="off"
            minLength={32}
            required
          />
        </label>
      ) : null}

      {mode === 'login' ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setMode('forgot');
            setPassword('');
            setError(null);
            setNotice(null);
          }}
        >
          Forgot password?
        </button>
      ) : null}

      {mode === 'forgot' ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setMode('login');
            setError(null);
            setNotice(null);
          }}
        >
          Back to Login
        </button>
      ) : null}

      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}
      {notice ? <p className="muted" style={{ margin: 0 }}>{notice}</p> : null}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy
          ? 'Please wait...'
          : mode === 'login'
            ? 'Login'
            : mode === 'signup'
              ? 'Create Account'
              : mode === 'forgot'
                ? 'Generate Reset Token'
                : 'Reset Password'}
      </button>
    </form>
  );
}
