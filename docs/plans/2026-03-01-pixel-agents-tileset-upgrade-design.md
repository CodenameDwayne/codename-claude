# Pixel Agents Tileset Upgrade Design

## Goal

Replace hand-coded pixel sprites and colored rectangles with professional tileset assets (Donarg Office Tileset + MetroCity 2.0 characters) to match the visual quality of [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents).

## Design Decisions

- **Theme**: Warm natural office (beige/wood tones) using Donarg tileset as-is
- **Layout**: Open plan — 4 workstations with shared props (water cooler, bookshelf, plants)
- **Characters**: MetroCity 2.0 "Suit.png" — 4 characters with full directional animation
- **Rendering**: Sprite cache with off-screen canvases, `drawImage()` instead of per-pixel `fillRect()`

## Asset Pipeline

Build-time script extracts PNGs into `SpriteData` (`string[][]`) TypeScript modules:

1. **Tileset extraction** (`Office Tileset All 16x16.png` → individual 16x16 tile sprites)
   - Floor tiles, wall tiles, desks, chairs, monitors, bookshelves, plants, water cooler, clocks, wall art
   - Each tile becomes a named export in `sprites/tileset.ts`

2. **Character extraction** (`Suit.png` → directional animation frames)
   - Sheet layout: 768x128, two halves (384px each), 4 rows per half
   - Each row is a distinct character with 12 frames (6 narrow front/back + 6 wider side views)
   - Frames extracted per direction: down, up, left, right (left = horizontally flipped right)
   - 4 characters assigned to: Scout (row 0), Architect (row 1), Builder (row 2), Reviewer (row 3)

3. Output shipped as TypeScript — zero runtime PNG parsing

## Sprite Cache

Activate existing `sprites/cache.ts`:

- `WeakMap<SpriteData, HTMLCanvasElement>` keyed per zoom level
- Each sprite rendered once to off-screen canvas via `fillRect()` per pixel
- Frame rendering becomes single `drawImage()` call
- ~90% reduction in per-frame draw operations

## Tilemap Renderer

Replace colored rectangles with tileset-based rendering:

- Office layout defined as 2D grid of tile IDs (enum)
- Tile types: `FLOOR`, `WALL`, `DESK`, `CHAIR`, `MONITOR`, `BOOKSHELF`, `PLANT`, `WATER_COOLER`, `CLOCK`, `WALL_ART`, `VOID`
- Floor: warm gray/beige diamond pattern from Donarg
- Walls: white/beige wall sprites from Donarg
- Furniture z-sorted with characters by Y position (painter's algorithm)

### Office Layout (Open Plan)

```
~20x15 tile grid
┌────────────────────────────────┐
│ Wall with window/clock/art     │
│ [bookshelf] [water] [plant]   │
│                                │
│  [Scout desk+monitor]  [Architect desk+monitor]  │
│   [chair]               [chair]                   │
│                                │
│  [Builder desk+monitor] [Reviewer desk+monitor]   │
│   [chair]               [chair]                   │
│                                │
│ [plant]        [bookshelf]    │
│ Wall                           │
└────────────────────────────────┘
```

## Character Upgrade

- Frame size: ~16x16 (front/back) to ~19x32 (side views) from MetroCity sheet
- 4 directions with walk cycle animation
- Sitting offset when at desk (CHARACTER_SITTING_OFFSET_PX)
- Palette per agent preserved via character row assignment

## Visual Polish

### Speech Bubbles
- Pixel-art bubble sprites (hardcoded `SpriteData` arrays)
- Two types: working bubble ("..." dots), waiting bubble (checkmark)
- Positioned centered above character head
- Fade-out animation on dismiss (0.5s alpha interpolation)

### Matrix Spawn/Despawn Effect
- Per-column digital rain sweep (0.3s duration)
- Staggered column timing with flicker hash
- Green overlay trail fading behind sweep head
- Triggered on character spawn (pipeline start) and despawn (pipeline end)

### Vignette
- CSS overlay with radial gradient darkening canvas edges
- `z-index` above canvas, below UI controls

### Selection Outlines
- Algorithmically generated 1px white outline sprites
- Full opacity on click, 50% on hover

## File Changes

| File | Action |
|------|--------|
| `sprites/characters.ts` | Rewrite — sprite sheet extraction replaces hand-coded templates |
| `sprites/cache.ts` | Activate — wire into renderer |
| `engine/renderer.ts` | Rewrite — tileset rendering + drawImage via cache |
| `themes/cyberpunk.ts` | Replace with `themes/office.ts` — warm palette + tileset layout |
| `themes/types.ts` | Update — tile IDs instead of color strings |
| `engine/scene.ts` | Update — z-sorting for furniture, speech bubble rendering |
| `App.css` | Update — warm palette CSS variables, vignette overlay |
| `App.tsx` | Update — add vignette div, update theme references |
| New: `pixel-agents/assets/` | Character + tileset PNGs copied here |
| New: `scripts/extract-sprites.ts` | Build-time PNG → SpriteData extraction |
| New: `sprites/tileset.ts` | Extracted tileset tile data |
| New: `sprites/bubbles.ts` | Speech bubble sprite data |
| New: `effects/matrix.ts` | Spawn/despawn digital rain effect |

## What Gets Deleted

- Hand-coded 10x16 sprite templates in `characters.ts`
- Colored-rectangle tile rendering in `cyberpunk.ts`
- Neon glow effect (replaced by tileset furniture)
- Grid-line floor rendering

## What Stays The Same

- Game loop (`requestAnimationFrame` + delta time)
- BFS pathfinding on tile grid
- Character state machine (idle, walking, working, carrying, celebrating)
- WebSocket integration + event types
- Demo mode pipeline simulation
- React shell + status bar
- Zoom controls
