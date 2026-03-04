import type { PipelineStage } from '../hooks/useMissionControl';
import { AGENT_COLORS } from '../sprites/characters';

const STATUS_LABELS: Record<string, string> = {
  idle: 'IDLE',
  active: 'ACTIVE',
  done: 'DONE',
  waiting: 'WAITING',
  failed: 'FAILED',
};

interface Props {
  stages: PipelineStage[];
  phase: string;
  taskDescription: string;
}

export function PipelinePanel({ stages, phase, taskDescription }: Props) {
  return (
    <div className="sidebar-left">
      <div className="panel-title">{'─ pipeline'}</div>
      {taskDescription && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
          {taskDescription}
        </div>
      )}
      <div className="pipeline-stages">
        {stages.map((stage, i) => (
          <div key={stage.role}>
            <div className={`stage ${stage.status === 'active' ? 'active' : ''}`}>
              <div className="stage-header">
                <span
                  className={`stage-dot ${stage.status}`}
                  style={stage.status === 'active' ? { background: AGENT_COLORS[stage.role] } : undefined}
                />
                <span className="stage-role" style={{ color: AGENT_COLORS[stage.role] }}>
                  {stage.role}
                </span>
              </div>
              <div className="stage-status">
                {STATUS_LABELS[stage.status] ?? stage.status}
                {stage.status === 'active' && stage.activity !== 'idle' && ` · ${stage.activity}`}
              </div>
              {stage.taskProgress && (
                <div className="stage-progress">
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>
                    task {stage.taskProgress.current}/{stage.taskProgress.total}
                  </div>
                  <div className="progress-bar" style={{ color: AGENT_COLORS[stage.role] }}>
                    {Array.from({ length: stage.taskProgress.total }, (_, j) => (
                      <div key={j} className={j < stage.taskProgress!.current ? 'filled' : 'empty'} />
                    ))}
                  </div>
                </div>
              )}
            </div>
            {i < stages.length - 1 && (
              <div className={`stage-arrow ${stage.status === 'done' ? 'active' : ''}`}>│</div>
            )}
          </div>
        ))}
      </div>
      {phase !== 'idle' && (
        <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
          phase: {phase}
        </div>
      )}
    </div>
  );
}
