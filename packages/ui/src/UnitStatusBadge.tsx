import type { UnitStatus } from '@nephix/contracts';

type UnitStatusBadgeProps = {
  status: UnitStatus;
};

export function UnitStatusBadge({ status }: UnitStatusBadgeProps) {
  const palette = {
    unread: { background: '#f1f5f9', color: '#334155' },
    active: { background: '#fef3c7', color: '#92400e' },
    completed: { background: '#dcfce7', color: '#166534' },
  } as const;

  return (
    <span
      style={{
        display: 'inline-flex',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        ...palette[status],
      }}
    >
      {status}
    </span>
  );
}
