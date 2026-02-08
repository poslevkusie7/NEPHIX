import { AuthForm } from '@/components/auth-form';

export default function LoginPage() {
  return (
    <main className="container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="panel" style={{ width: '100%', maxWidth: 460, padding: 24 }}>
        <h1 style={{ marginTop: 0, marginBottom: 6 }}>Nephix</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Sign in to continue your study feed.
        </p>
        <AuthForm />
      </div>
    </main>
  );
}
