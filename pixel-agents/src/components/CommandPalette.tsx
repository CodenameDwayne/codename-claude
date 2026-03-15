import { useState, useEffect, useRef } from 'react';

interface Command {
  key: string;
  label: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ open, onClose, commands }: Props) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = commands.filter(
    (cmd) => cmd.label.toLowerCase().includes(filter.toLowerCase())
      || cmd.key.toLowerCase().includes(filter.toLowerCase()),
  );

  useEffect(() => {
    if (open) {
      setFilter('');
      setSelectedIndex(0);
      // Focus after overlay renders
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); }
      if (e.key === 'ArrowUp') { setSelectedIndex((i) => Math.max(i - 1, 0)); e.preventDefault(); }
      if (e.key === 'Enter' && filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filter, selectedIndex, filtered, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="> type a command..."
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
        />
        <div className="cmd-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.key}
              className={`cmd-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => { cmd.action(); onClose(); }}
            >
              <span className="cmd-key">{cmd.key}</span>
              {cmd.label}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="cmd-item" style={{ color: 'var(--text-dim)' }}>No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}
