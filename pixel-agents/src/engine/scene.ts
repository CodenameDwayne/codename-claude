// pixel-agents/src/engine/scene.ts
import { GameLoop } from './gameLoop';
import { findPath } from './tileMap';
import {
  createRenderContext,
  resizeCanvas,
  clearCanvas,
  renderTilemap,
  renderScene,
  renderLabels,
  renderBubbles,
  renderPipelineLabel,
} from './renderer';
import type { RenderContext } from './renderer';
import { createCharacter, updateCharacter } from '../agents/characterState';
import type { Character, Direction } from '../agents/characterState';
import type { CharacterSprites, TilesetGrid } from '../sprites/types';
import { AGENT_COLORS } from '../sprites/characters';
import type { Theme } from '../themes/types';
import type { WSEvent, AgentRole } from '../ws/types';

export class GameScene {
  private rc: RenderContext | null = null;
  private loop: GameLoop;
  private characters = new Map<AgentRole, Character>();
  private theme: Theme;
  private tileset: TilesetGrid;
  private charSprites: Record<AgentRole, CharacterSprites>;
  private eventQueue: WSEvent[] = [];
  private pipelineLabel = '';

  constructor(
    theme: Theme,
    tileset: TilesetGrid,
    charSprites: Record<AgentRole, CharacterSprites>,
  ) {
    this.theme = theme;
    this.tileset = tileset;
    this.charSprites = charSprites;
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      () => this.render(),
    );

    // Create characters at their desk positions
    for (const desk of theme.desks) {
      const char = createCharacter(desk.role, desk.seatPos);
      char.direction = desk.facing as Direction;
      this.characters.set(desk.role, char);
    }
  }

  attach(canvas: HTMLCanvasElement, zoom: number): void {
    this.rc = createRenderContext(canvas, zoom);
    resizeCanvas(this.rc, this.theme.map);
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  pushEvent(event: WSEvent): void {
    this.eventQueue.push(event);
  }

  setZoom(z: number): void {
    if (this.rc) this.rc.zoom = z;
  }

  private update(dt: number): void {
    // Process queued events
    while (this.eventQueue.length > 0) {
      this.processEvent(this.eventQueue.shift()!);
    }

    // Update character animations and movement
    for (const char of this.characters.values()) {
      updateCharacter(char, dt);
    }
  }

  private render(): void {
    if (!this.rc) return;
    const rc = this.rc;

    resizeCanvas(rc, this.theme.map);
    clearCanvas(rc, this.theme.background);

    // 1. Floor and wall tiles
    renderTilemap(rc, this.theme.map, this.tileset, this.theme);

    // 2. Furniture + characters (z-sorted)
    renderScene(rc, this.tileset, this.theme, this.characters, this.charSprites);

    // 3. Labels on top
    renderLabels(rc, this.characters, AGENT_COLORS);

    // 4. Speech bubbles above working characters
    renderBubbles(rc, this.characters);

    // 5. Pipeline label
    renderPipelineLabel(rc, this.theme.map, this.pipelineLabel);
  }

  private processEvent(event: WSEvent): void {
    switch (event.type) {
      case 'agent:active': {
        const char = this.characters.get(event.agent);
        if (!char) break;
        const desk = this.theme.desks.find((d) => d.role === event.agent);
        if (!desk) break;
        const path = findPath(this.theme.map, char.gridPos, desk.seatPos);
        if (path.length > 0) {
          char.state = {
            state: 'walking',
            path,
            pathIndex: 1,
            targetState: { state: 'working', activity: event.activity },
          };
        } else {
          char.state = { state: 'working', activity: event.activity };
        }
        break;
      }
      case 'agent:idle': {
        const char = this.characters.get(event.agent);
        if (char) char.state = { state: 'idle' };
        break;
      }
      case 'handoff': {
        const from = this.characters.get(event.from);
        const toDesk = this.theme.desks.find((d) => d.role === event.to);
        if (!from || !toDesk) break;
        const path = findPath(this.theme.map, from.gridPos, toDesk.approachPos);
        if (path.length > 0) {
          from.state = {
            state: 'carrying',
            path,
            pathIndex: 1,
            item: event.artifact,
            targetAgent: event.to,
          };
        }
        break;
      }
      case 'verdict': {
        if (event.verdict === 'approve') {
          for (const char of this.characters.values()) {
            char.state = { state: 'celebrating' };
            setTimeout(() => {
              char.state = { state: 'idle' };
            }, 2000);
          }
        }
        break;
      }
      case 'pipeline:start':
        this.pipelineLabel = event.taskDescription;
        break;
      case 'pipeline:end':
        this.pipelineLabel = '';
        break;
      case 'state:snapshot':
        for (const [role, activity] of Object.entries(event.agents)) {
          const char = this.characters.get(role as AgentRole);
          if (char && activity !== 'idle') {
            char.state = { state: 'working', activity };
          }
        }
        break;
    }
  }
}
