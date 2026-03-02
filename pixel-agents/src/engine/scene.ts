import { GameLoop } from './gameLoop';
import { TILE_SIZE, TileType, findPath } from './tileMap';
import { createRenderContext, resizeCanvas, clearCanvas, renderSprite, renderCharacters, renderText, type RenderContext } from './renderer';
import { createCharacter, updateCharacter, type Character, type DeskAssignment } from '../agents/characterState';
import { resolveCharacterSprites, getGlowColor, type ResolvedSprites } from '../sprites/characters';
import type { Theme } from '../themes/types';
import type { WSEvent, AgentRole } from '../ws/types';

export class GameScene {
  private rc: RenderContext | null = null;
  private loop: GameLoop;
  private characters: Map<AgentRole, Character> = new Map();
  private sprites: Map<AgentRole, ResolvedSprites> = new Map();
  private theme: Theme;
  private eventQueue: WSEvent[] = [];
  private pipelineLabel = 'idle';

  constructor(theme: Theme) {
    this.theme = theme;
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      () => this.render(),
    );

    // Initialize characters at their desk approach positions
    for (const desk of theme.desks) {
      const char = createCharacter(desk.role, desk.approachPos);
      this.characters.set(desk.role, char);
      this.sprites.set(desk.role, resolveCharacterSprites(desk.role));
    }
  }

  attach(canvas: HTMLCanvasElement, zoom: number = 3): void {
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

  setZoom(zoom: number): void {
    if (this.rc) {
      this.rc.zoom = zoom;
      this.rc.ctx.imageSmoothingEnabled = false;
      resizeCanvas(this.rc, this.theme.map);
    }
  }

  private update(dt: number): void {
    // Process event queue
    while (this.eventQueue.length > 0) {
      this.processEvent(this.eventQueue.shift()!);
    }

    // Update all characters
    for (const char of this.characters.values()) {
      updateCharacter(char, dt);
    }
  }

  private render(): void {
    if (!this.rc) return;

    // Clear
    clearCanvas(this.rc, this.theme.background);

    // Render floor tiles
    const map = this.theme.map;
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tile = map.tiles[row]?.[col];
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const z = this.rc.zoom;

        if (tile === TileType.Wall) {
          this.rc.ctx.fillStyle = this.theme.wallColor;
          this.rc.ctx.fillRect(x * z, y * z, TILE_SIZE * z, TILE_SIZE * z);
        } else if (tile === TileType.Floor) {
          this.rc.ctx.fillStyle = this.theme.floorColor;
          this.rc.ctx.fillRect(x * z, y * z, TILE_SIZE * z, TILE_SIZE * z);

          // Cyberpunk grid lines
          this.rc.ctx.strokeStyle = '#1a1a4a';
          this.rc.ctx.lineWidth = 1;
          this.rc.ctx.strokeRect(x * z, y * z, TILE_SIZE * z, TILE_SIZE * z);
        } else if (tile === TileType.Desk) {
          this.rc.ctx.fillStyle = '#2a2a5a';
          this.rc.ctx.fillRect(x * z, y * z, TILE_SIZE * z, TILE_SIZE * z);
          // Monitor glow on desk
          this.rc.ctx.fillStyle = '#00aaff';
          this.rc.ctx.globalAlpha = 0.3;
          this.rc.ctx.fillRect((x + 3) * z, (y + 2) * z, 10 * z, 8 * z);
          this.rc.ctx.globalAlpha = 1;
        } else if (tile === TileType.Chair) {
          this.rc.ctx.fillStyle = this.theme.floorColor;
          this.rc.ctx.fillRect(x * z, y * z, TILE_SIZE * z, TILE_SIZE * z);
          // Chair dot
          this.rc.ctx.fillStyle = '#4a4a6a';
          this.rc.ctx.fillRect((x + 4) * z, (y + 4) * z, 8 * z, 8 * z);
        }
      }
    }

    // Render characters
    const chars = [...this.characters.values()];
    renderCharacters(
      this.rc,
      chars,
      (char) => this.getSpriteForState(char),
      (role) => getGlowColor(role as AgentRole),
    );

    // Render pipeline label
    const labelX = (map.width * TILE_SIZE) / 2;
    const labelY = map.height * TILE_SIZE - 4;
    renderText(this.rc, this.pipelineLabel, labelX, labelY, '#8888aa');
  }

  private processEvent(event: WSEvent): void {
    switch (event.type) {
      case 'agent:active': {
        const char = this.characters.get(event.agent);
        const desk = this.theme.desks.find((d) => d.role === event.agent);
        if (char && desk) {
          // Walk to desk, then start working
          const path = findPath(this.theme.map, char.gridPos, desk.approachPos);
          if (path.length > 0) {
            char.state = {
              state: 'walking',
              path,
              pathIndex: 1, // skip start position
              targetState: { state: 'working', activity: event.activity },
            };
          } else {
            char.state = { state: 'working', activity: event.activity };
          }
        }
        break;
      }

      case 'agent:idle': {
        const char = this.characters.get(event.agent);
        if (char) {
          char.state = { state: 'idle' };
          char.animFrame = 0;
          char.animTimer = 0;
        }
        break;
      }

      case 'handoff': {
        const fromChar = this.characters.get(event.from);
        const toDesk = this.theme.desks.find((d) => d.role === event.to);
        if (fromChar && toDesk) {
          const path = findPath(this.theme.map, fromChar.gridPos, toDesk.approachPos);
          if (path.length > 0) {
            fromChar.state = {
              state: 'carrying',
              path,
              pathIndex: 1,
              item: event.artifact,
              targetAgent: event.to,
            };
          }
        }
        break;
      }

      case 'verdict': {
        const reviewer = this.characters.get('reviewer');
        if (reviewer && event.verdict === 'approve') {
          reviewer.state = { state: 'celebrating' };
          reviewer.animFrame = 0;
          reviewer.animTimer = 0;
          // Return to idle after 2 seconds
          setTimeout(() => {
            if (reviewer.state.state === 'celebrating') {
              reviewer.state = { state: 'idle' };
            }
          }, 2000);
        }
        break;
      }

      case 'pipeline:start':
        this.pipelineLabel = event.taskDescription;
        break;

      case 'pipeline:end':
        this.pipelineLabel = event.result === 'success' ? 'completed!' : 'failed';
        setTimeout(() => { this.pipelineLabel = 'idle'; }, 5000);
        break;

      case 'state:snapshot':
        // Set initial states for all agents
        for (const [role, activity] of Object.entries(event.agents)) {
          const char = this.characters.get(role as AgentRole);
          if (char && activity !== 'idle') {
            char.state = { state: 'working', activity: activity };
          }
        }
        break;
    }
  }

  private getSpriteForState(char: Character): string[][] | null {
    const sprites = this.sprites.get(char.role);
    if (!sprites) return null;

    switch (char.state.state) {
      case 'idle':
        return sprites.idle.down[char.animFrame % 2] ?? null;
      case 'walking':
      case 'carrying':
        return sprites.walk.down[char.animFrame % 4] ?? null;
      case 'working':
        return sprites.work.down[char.animFrame % 2] ?? null;
      case 'celebrating':
        return sprites.idle.down[char.animFrame % 2] ?? null; // reuse idle for now
    }
  }
}
