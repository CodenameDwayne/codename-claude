export interface CheckboxTask {
  title: string;
  checked: boolean;
}

export function parseCheckboxTasks(planContent: string): CheckboxTask[] {
  const tasks: CheckboxTask[] = [];
  const regex = /^- \[([ x])\] (.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(planContent)) !== null) {
    tasks.push({
      checked: match[1] === 'x',
      title: match[2]!.trim(),
    });
  }

  return tasks;
}

export function markTaskComplete(planContent: string, taskTitle: string): string {
  return planContent.replace(`- [ ] ${taskTitle}`, `- [x] ${taskTitle}`);
}

export function findNextTask(planContent: string): string | null {
  const tasks = parseCheckboxTasks(planContent);
  const next = tasks.find(t => !t.checked);
  return next?.title ?? null;
}
