import type { ReactNode } from 'react';

type CardShellProps = {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
};

export function CardShell({ title, subtitle, footer, children }: CardShellProps) {
  return (
    <section
      style={{
        borderRadius: 16,
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        padding: 20,
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>{title}</h2>
        {subtitle ? <p style={{ margin: '6px 0 0', color: '#475569', fontSize: 14 }}>{subtitle}</p> : null}
      </header>
      <div>{children}</div>
      {footer ? <footer style={{ marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>{footer}</footer> : null}
    </section>
  );
}
