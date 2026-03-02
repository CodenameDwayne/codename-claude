export type UpdateFn = (dt: number) => void;
export type RenderFn = () => void;

const MAX_DT = 0.1; // Cap at 100ms to prevent huge jumps

export class GameLoop {
  private animFrameId: number | null = null;
  private lastTime = 0;
  private running = false;

  constructor(
    private update: UpdateFn,
    private render: RenderFn,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private tick = (): void => {
    if (!this.running) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt);
    this.render();

    this.animFrameId = requestAnimationFrame(this.tick);
  };
}
