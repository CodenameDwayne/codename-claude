import { describe, test, expect } from 'vitest';
import { parseCheckboxTasks, markTaskComplete, findNextTask } from './orchestrator.js';

describe('parseCheckboxTasks', () => {
  test('extracts unchecked tasks from plan', () => {
    const plan = `# Plan\n\n## Tasks\n\n- [ ] Set up project\n- [ ] Add auth\n- [ ] Add tests\n`;
    const tasks = parseCheckboxTasks(plan);
    expect(tasks).toEqual([
      { title: 'Set up project', checked: false },
      { title: 'Add auth', checked: false },
      { title: 'Add tests', checked: false },
    ]);
  });

  test('distinguishes checked and unchecked tasks', () => {
    const plan = `- [x] Done task\n- [ ] Pending task\n- [x] Another done\n`;
    const tasks = parseCheckboxTasks(plan);
    expect(tasks).toEqual([
      { title: 'Done task', checked: true },
      { title: 'Pending task', checked: false },
      { title: 'Another done', checked: true },
    ]);
  });

  test('returns empty array when no checkboxes found', () => {
    const plan = `# Plan\n\nJust some text, no tasks.\n`;
    expect(parseCheckboxTasks(plan)).toEqual([]);
  });

  test('handles tasks with colons and special characters', () => {
    const plan = `- [ ] Set up project: directories, configs\n- [ ] Add auth (JWT + sessions)\n`;
    const tasks = parseCheckboxTasks(plan);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toBe('Set up project: directories, configs');
  });
});

describe('markTaskComplete', () => {
  test('checks off a specific task by title', () => {
    const plan = `- [ ] Task A\n- [ ] Task B\n- [ ] Task C\n`;
    const updated = markTaskComplete(plan, 'Task B');
    expect(updated).toBe(`- [ ] Task A\n- [x] Task B\n- [ ] Task C\n`);
  });

  test('does not modify already-checked tasks', () => {
    const plan = `- [x] Task A\n- [ ] Task B\n`;
    const updated = markTaskComplete(plan, 'Task A');
    expect(updated).toBe(plan);
  });
});

describe('findNextTask', () => {
  test('returns first unchecked task', () => {
    const plan = `- [x] Done\n- [ ] Next one\n- [ ] After\n`;
    const next = findNextTask(plan);
    expect(next).toBe('Next one');
  });

  test('returns null when all tasks are checked', () => {
    const plan = `- [x] Done\n- [x] Also done\n`;
    expect(findNextTask(plan)).toBeNull();
  });

  test('returns null for empty plan', () => {
    expect(findNextTask('# No tasks here')).toBeNull();
  });
});
