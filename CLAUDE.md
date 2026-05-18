# CLAUDE.md

Working notes for AI sessions on this repo. Read this first — it captures the
architecture, the 3D-view design, the tile-detection system, and the gotchas
that will otherwise cost you time.

## What this project is

A Game Boy (DMG-01) emulator written in plain JavaScript + HTML, running in the
browser. On top of the normal **2D** emulator there is now an experimental
**3D view** that runs side-by-side: it watches the emulator's video memory in
real time, recognises specific overworld assets (currently *tall grass*,
*fences*, *post fences*, *flowers*, *houses*, and *billboards* from Pokemon Red), and rebuilds them as
pixel-styled 3D geometry with Three.js.

The long-term goal is a "3D mode" for Pokemon Red. This is the first milestone:
detect + render grass, fences, flowers, houses, and billboards. Everything is **content-based** (it matches
tile pixel patterns, not hard-coded tile IDs), so it keeps working as the map
scrolls and as the game reloads tiles.

## How to run

```
python -m http.server 8000
# then open http://localhost:8000/index.html
```

Load a ROM with the **Load ROM** button. The 3D panel is on the right; drag to
orbit, scroll to zoom, shift-drag (or right-drag) to pan.

## Repository layout

| File | Role |
|---|---|
| `index.html` | Page, CSS, and the `main()` driver loop. Wires CPU/MMU/PPU/APU together and now also constructs `View3D`. |
| `cpu.js` | LR35902 CPU core (`Cpu`). |
| `memorymanagementunit.js` | `MemoryManagementUnit` — the full 64 KB address space lives in `mmu.memory` (a `Uint8Array(0x10000)`), plus cartridge/MBC handling. |
| `pixelprocessingunit.js` | `PixelProcessingUnit` — scanline renderer to the 2D `#screen` canvas. The 3D view mirrors its tile-decoding logic. |
| `apu.js`, `PulseChannel.js`, `WaveChannel.js`, `NoiseChannel.js`, `audio-processor.js` | Audio. |
| `joypad.js` | Input. |
| `view3d.js` | **The 3D view** — detector + Three.js renderer. See below. |
| `gfx/` | Source artwork from the Pokemon Red disassembly. `gfx/tilesets/overworld.png` and `gfx/blocksets/overworld.bst` are the references used to extract tile signatures. |
| `roms/` | User-supplied ROMs. Do not commit or redistribute. |

### The 2D frame loop (`index.html` → `main()`)

Each animation frame runs the emulator for one GB frame (`70224` cycles), then
calls `view3d.update()`. The MMU/CPU/PPU instances are created in `main()`;
`View3D` is given the `MemoryManagementUnit` instance so it can read VRAM.

## Memory map quick reference (what the 3D view reads)

All of these are plain reads from `mmu.memory[...]` on DMG — no banking in this
range, so the 3D view reads the array directly for speed.

| Address | Meaning |
|---|---|
| `0x8000–0x97FF` | Tile data (graphics). 16 bytes per 8×8 tile, 2bpp. |
| `0x9800–0x9BFF` | BG tile map 0 (32×32 tile indices). |
| `0x9C00–0x9FFF` | BG tile map 1. |
| `0xFF40` LCDC | bit7 = LCD on, bit4 = BG tile-data area (`1`→`0x8000` unsigned, `0`→`0x9000` signed), bit3 = BG map select, bit0 = BG enable. |
| `0xFF42 / 0xFF43` | SCY / SCX background scroll. |
| `0xFF47` BGP | Background palette (2 bits per colour index). |

2bpp tile format: two bytes per row, byte 0 = low bit-plane, byte 1 = high
bit-plane, bit 7 = leftmost pixel. `colorIndex = (highBit<<1)|lowBit`.

## The 3D view (`view3d.js`)

Self-contained IIFE that exposes `window.View3D`. Construct with
`new View3D(canvas, mmu, { hudElement })`; call `.update()` once per frame.

### Pipeline (per frame, inside `update()`)

1. Read `LCDC`, `SCX`, `SCY`, `BGP` and pick the BG map / tile-data area.
2. Compute a cheap **scene hash** (`_sceneHash`, FNV-1a over the visible tile
   map entries + a few content bytes of each tile). If unchanged, skip the
   rebuild — just reposition and render.
3. On change, `_rebuild()` walks the visible `COLS×ROWS` window (20×18, matching
   the Game Boy screen):
   - decode each tile's 16 VRAM bytes to 64 colour indices (`decode2bpp`);
   - paint it into the shared **floor** canvas texture (BGP applied, so the
     floor matches the 2D screen exactly);
   - `_classify()` it against the signature table; if it matches, add a prop.
4. Smooth sub-tile scrolling: the whole `_world` group is nudged by the
   fractional part of `SCX/SCY`, so tile-level rebuilds only happen on a real
   content change (a few times per second, e.g. player movement / animation).

### Coordinate system & rendering

- 1 world unit = 1 GB tile. `X` = column (east), `Z` = row (south), `Y` = up.
- Tile `(col,row)` → prop centred at `(col+0.5, y, row+0.5)`. North is `Z=0`.
- **Floor**: one `PlaneGeometry` with a `CanvasTexture` (NearestFilter) redrawn
  each rebuild. Carries the ground grass and all unrecognised tiles.
- **Tall grass**: two crossed billboard quads, raised, textured with the live
  grass tile. Colour-index-0 pixels are made transparent (`alphaTest`) for a
  ragged clump silhouette.
- **Fence**: 2x2 fence motifs are grouped into one compact raised post with a
  live tile-art top cap; adjacent motifs get small connecting rails.
- **Post fence**: 8x16 post motifs (`14 / 85`) become slim raised posts with
  live tile-art front faces.
- **Flower**: the three animated flower frames are detected from live VRAM and
  rendered as small crossed transparent quads, so the 3D flowers animate with
  the 2D screen.
- **Billboard**: connected 2x2 sign tiles become one vertical board with live
  tile-art face panels, two posts, and a top rail.
- **House**: connected house-tile regions become a low tile-relief model. Each
  house tile is raised as a short textured block using the live 2D tile art.
- **Sprites/OAM**: visible hardware sprites are grouped into bounded 16x16-ish
  OAM components, composited into one live OBJ texture per character/NPC, then
  rendered as a Y-axis billboard facing the camera. The component bounds keep
  adjacent characters from merging when they stand next to each other.
- Everything uses `NearestFilter` + no mipmaps to keep the pixel-art look.
- Tile textures/materials are cached in `_matCache` keyed by tile content + BGP;
  sprite textures/materials are cached separately by tile bytes + OBJ palette.
- `OrbitController` is a small hand-rolled orbit/zoom/pan camera (no CDN
  `OrbitControls` dependency). Three.js itself is loaded from cdnjs r128.

### Integration points in `index.html`

- `<head>`: `three.min.js` (cdnjs r128) + `view3d.js` script tags.
- Layout: `<main>` now holds a `.stage` flex row with two `.viewport`s — the
  `#screen` 2D canvas and the `#screen3d` 3D canvas + `#detection-hud`.
- `main()`: constructs `view3d` after the PPU; `frame()` calls
  `view3d.update()` every frame (guarded in try/catch).

## Tile detection & signatures

A **signature** is one reference tile stored as its raw 16-byte 2bpp data in
`RAW_SIGNATURES` (top of `view3d.js`). `_classify()` decodes a candidate tile
and counts matching pixels against every signature; a match needs
`MATCH_THRESHOLD` (60) of 64 pixels. VRAM holds the exact tileset graphics, so
matches are normally pixel-perfect; the tolerance is just safety margin.

Each signature has a `category`; the renderer branches on category, not on the
individual signature. Fences are 2x2 tile motifs, so each variant contributes
four signatures all mapping to category `fence`.
The detector also includes the `42 43 / 58 59` round route-barrier variant
visible around many early-game grass patches.

### Asset catalog (Pokemon Red `overworld` tileset)

Source: `gfx/tilesets/overworld.png` (128×48, a 16×6 grid of 8×8 tiles).
Confirmed against `gfx/blocksets/overworld.bst` (4×4-tile blocks) and against
the Spanish "Edicion Roja" ROM.

| Asset | tile # in overworld.png | category | ROM offset* | Notes |
|---|---|---|---|---|
| Tall grass | 82 | `tallgrass` | `0x64520` | Blockset block 11 is 4×4 of tile 82. The wild-encounter grass. |
| Grass ground (detail) | 57 | `grass` | `0x64390` | The dotted ground texture. Blockset blocks 1 & 8. |
| Animated flower frame 1 | n/a | `flower` | `gfx/tilesets/flower/flower1.png` | VRAM animation frame; rendered as a small crossed flower prop. |
| Animated flower frame 2 | n/a | `flower` | `gfx/tilesets/flower/flower2.png` | |
| Animated flower frame 3 | n/a | `flower` | `gfx/tilesets/flower/flower3.png` | |
| Billboard/sign top-left | 70 | `billboard` | `0x64460` | Blockset block 8 uses `70 71 / 86 87` for the 2x2 map sign. |
| Billboard/sign top-right | 71 | `billboard` | `0x64470` | |
| Billboard/sign bottom-left | 86 | `billboard` | `0x64560` | |
| Billboard/sign bottom-right | 87 | `billboard` | `0x64570` | |
| House roof/facade set | 5-12, 21-28, 31, 37-38, 40-41, 75, 78-79 | `house` | varies | Grouped into connected regions before rendering one 3D house model. All-zero tile 29 is deliberately omitted. |
| Round fence top-left | 42 | `fence` | `0x642A0` | Blockset blocks 19-25 use `42 43 / 58 59` for the round route barriers around grass. |
| Round fence top-right | 43 | `fence` | `0x642B0` | |
| Round fence bottom-left | 58 | `fence` | `0x643A0` | |
| Round fence bottom-right | 59 | `fence` | `0x643B0` | |
| Grass ground (base) | 35 | — | `0x64000+35*16` | Plain lightest tile; **not** a signature (all-zero, would false-match blanks). The floor texture covers it. |
| Fence top-left | 64 | `fence` | `0x64400` | Blockset block 15 = `64 65 / 80 81` repeated → the round-topped post fence. |
| Fence top-right | 65 | `fence` | `0x64410` | |
| Fence bottom-left | 80 | `fence` | `0x64500` | |
| Fence bottom-right | 81 | `fence` | `0x64510` | |
| Post fence top | 14 | `postfence` | `0x640E0` | Blockset block 27 uses `14 / 85` as an 8x16 vertical post. |
| Post fence bottom | 85 | `postfence` | `0x64550` | |

\* ROM offsets are for `roms/Pokemon - Edicion Roja (Spain) (SGB Enhanced).gb`;
the `overworld` tileset graphics block starts at `0x64000` (96 tiles, `0x600`
bytes). Offsets differ between ROM revisions — **the pixel signatures do not**,
so detection is ROM-version independent.

## Adding a new asset (e.g. trees, water, ledges, signs)

1. Find the tile(s) in `gfx/tilesets/<tileset>.png`. Cross-check
   `gfx/blocksets/<tileset>.bst` (128 blocks × 16 bytes; each block is a 4×4
   grid of tile indices) to see which tiles form the asset.
2. Extract the 2bpp signature(s) — see the script below.
3. Add an entry per tile to `RAW_SIGNATURES` in `view3d.js` with a `category`.
4. In `_rebuild()`, add an `else if (match.category === "...")` branch, and add
   an `_addXxx()` method that builds or groups the geometry. Add a counter to
   `this.counts` and `_updateHud()`.
5. Run the headless test harness (below) to confirm it detects.

### Extracting a signature (reference script)

```python
# Run from the repo root. Prints the 16-byte 2bpp signature for a tile index.
from PIL import Image
im = Image.open('gfx/tilesets/overworld.png').convert('L')
LMAP = {255: 0, 170: 1, 85: 2, 0: 3}   # PNG grey -> GB colour index
def signature(idx, cols=16):
    tx, ty = idx % cols, idx // cols
    out = []
    for y in range(8):
        b1 = b2 = 0
        for x in range(8):
            ci = LMAP[im.getpixel((tx*8 + x, ty*8 + y))]
            bit = 7 - x
            b1 |= (ci & 1) << bit
            b2 |= ((ci >> 1) & 1) << bit
        out += [b1, b2]
    return out
print(signature(82))   # tall grass
```

To sanity-check a signature is real, search for the byte sequence in the ROM —
the overworld tiles all appear exactly once, clustered around `0x64000`.

## Testing without a browser

`view3d.js` is pure logic except for the Three.js calls. You can exercise the
**whole detector** headless by stubbing `THREE` + `document`, loading the real
file with `eval`, building a fake `mmu` whose `memory` array has the ROM's
overworld tileset loaded into `0x8000` and a tilemap at `0x9C00`, then calling
`new View3D(...).update()` and asserting on `getCounts()` /
`_grassGroup.children.length`. This was used to verify the pipeline end-to-end
(20×18 viewport). What it does **not**
cover: the actual WebGL render — that still needs a real browser check.

Quick syntax check: `node --check view3d.js`.

## Gotchas (these will bite you)

- **Line endings.** The working tree is checked out with **CRLF** on every
  file (Windows). The string-replace `Edit` tool mis-handles CRLF files and has
  **truncated files mid-write** here. Prefer: rewrite a whole file with `Write`,
  or edit via `python`/`sed` in bash. After any edit, verify with
  `wc -l` + `tail` + `node --check`. `index.html` and `view3d.js` were
  (re)written with **LF**.
- `git status` shows every file as modified — that is the pre-existing
  CRLF/LF mismatch vs `HEAD`, not your changes. Diff individual files you
  actually touched.
- `_matCache` is never evicted. Tile variety is tiny so it is fine in practice,
  but a very long multi-tileset session will slowly grow it.
- Fence grouping currently recognises the known 2x2 overworld motifs. Partial
  motifs clipped at the viewport edge are ignored until enough tiles are visible.
- The terrain detector only reads the **background** layer. OAM sprites are
  composited and rendered separately every frame, but sprite/background priority
  is still approximate.
- Three.js is pinned to **r128** from cdnjs. `THREE.CapsuleGeometry` does not
  exist in r128; stick to Box/Plane/Cylinder/Sphere.

## Roadmap ideas for future sessions

- Group the 2×2 fence motif into proper connected posts/rails.
- Detect & render more overworld assets: trees, water (animated), ledges,
  signs, and doors.
- Per-tileset signature sets (cave, forest, interiors, towns) — load the right
  set based on detected context, or just match across all of them.
- Replace flat billboards with nicer grass geometry; add simple wind sway.
- Camera presets (follow-player, fixed isometric) alongside free orbit.
- Make the 2D/3D split a toggle on small screens.
