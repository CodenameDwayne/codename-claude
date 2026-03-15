import type { ConnectionStatus } from '../ws/types';

interface Props {
  budget: { used: number; limit: number };
  uptime: number;
  status: ConnectionStatus;
  demoActive: boolean;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m`;
}

function budgetColor(percent: number): string {
  if (percent > 50) return 'green';
  if (percent > 20) return 'yellow';
  return 'red';
}

export function FooterBar({ budget, uptime, status, demoActive }: Props) {
  const percent = budget.limit > 0 ? (budget.used / budget.limit) * 100 : 0;
  const fillClass = budgetColor(100 - percent); // invert: color represents remaining

  return (
    <div className="footer-bar">
      <div className="footer-segment">
        <span className="label">budget</span>
        <div className="budget-bar">
          <div className={`fill ${fillClass}`} style={{ width: `${percent}%` }} />
        </div>
        <span className="budget-label">{budget.used}/{budget.limit}</span>
      </div>

      <span className="footer-separator">│</span>

      <div className="footer-segment">
        <span className="label">uptime</span>
        <span>{formatUptime(uptime)}</span>
      </div>

      <span className="footer-separator">│</span>

      <div className="footer-segment">
        <StatusDot status={status} />
        <span>{status}</span>
      </div>

      {demoActive && (
        <>
          <span className="footer-separator">│</span>
          <span className="demo-label">DEMO</span>
        </>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  return <span className={`status-dot ${status}`} />;
}
