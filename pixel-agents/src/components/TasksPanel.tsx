import type { TaskItem, VerdictInfo } from '../hooks/useMissionControl';

interface Props {
  tasks: TaskItem[];
  lastVerdict: VerdictInfo | null;
}

export function TasksPanel({ tasks, lastVerdict }: Props) {
  return (
    <div className="sidebar-right">
      <div className="panel-title">{'─ tasks'}</div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>No tasks yet</div>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <div key={task.index} className={`task-item ${task.status}`}>
              <span className="task-checkbox">
                {task.status === 'done' ? '[✓]' : task.status === 'current' ? '[▸]' : '[ ]'}
              </span>
              <span>{task.label}</span>
            </div>
          ))}
        </div>
      )}

      {lastVerdict && (
        <div className="verdict-section">
          <div className="panel-title" style={{ marginTop: 16 }}>{'─ verdict'}</div>
          <span className={`verdict-badge ${lastVerdict.verdict}`}>
            {lastVerdict.verdict}
          </span>
          <div className="verdict-score">
            <div className="score-bar">
              {Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className={i < lastVerdict.score ? 'filled' : 'empty'}
                  style={i < lastVerdict.score ? { background: scoreColor(lastVerdict.score) } : undefined}
                />
              ))}
            </div>
            <span style={{ color: 'var(--text-secondary)' }}>{lastVerdict.score}/10</span>
          </div>
        </div>
      )}
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 8) return 'var(--accent-green)';
  if (score >= 5) return 'var(--accent-gold)';
  return '#ff4444';
}
