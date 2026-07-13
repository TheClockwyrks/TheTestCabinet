# Holdfast — Produced-asset manifest

This is the production contract for the reference build, derived from `specs/assets.md`.
**Every** file the game plays is produced during the build with the six on-`PATH` tools and
committed under `assets/`; the build only *loads* them (never invokes the tools). Every path
below is exact — `src/assets.ts` loads by these paths via `import.meta.glob('../assets/**')`
(page-relative, `?url`; never a root-absolute `/assets/…` URL). All colors are the
`specs/overview.md` palette. Sprites are **pixel art** drawn at native size and sampled
nearest-neighbor (`imageSmoothingEnabled = false`).

Paths are written relative to this directory
(`…/holdfast/v1.0.0/reference-impl/base/`), i.e. `assets/<category>/<file>`.

## Environment constraint — audio must be pure synth

**In this run image the baked `sfx-sample` pack and the `music` instrument bank are EMPTY.**
So, exactly as the valence reference did:

- All **SFX** are authored with **`sfx-synth`** (oscillator/noise voices), **not**
  `sfx-sample`.
- The **music** bed uses **synth-waveform tracks only** — `music define-track --instrument
  <sine|square|saw|triangle>` (a waveform name, **never** a bank instrument name). `music`
  still emits both a `.wav` (played) and a companion `.mid`.

The generation script is `scripts/gen-assets.sh` (re-runnable; resolves the tools from
`PATH` or `/cargo-target/the-test-cabinet/release`).

---

## 1. Sprites — `draw` (one PNG each)

Terrain/nodes/structures are **32×32** (tiling terrain sits flush against neighbors); item
and HUD icons are **16×16**. Backgrounds are transparent (straight-alpha) except tiling
terrain, which fills its 32×32.

### 1a. Terrain — `assets/terrain/`

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `terrain/soil.png` | 32×32 | `#5a4632` + darker `#4a3826` specks | Bare walkable ground, the common fill; subtle grain, tiles seamlessly. |
| `terrain/grass.png` | 32×32 | `#6a7638` base, `#7c8a44`/`#5a6630` blades | Fertile ground (best for farm plots); reads clearly distinct from soil. |
| `terrain/rock.png` | 32×32 | `#38332c` + `#2b271f` cracks, `#4a4238` highlight | Impassable outcrop / map border; rough, heavy, obviously blocked. |
| `terrain/floor.png` | 32×32 | `#4a3f30` planks + `#5a4c3a` seams | Built floor/path; clean, laid grid over wild ground. |

### 1b. Resource nodes — `assets/nodes/`

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `nodes/tree.png` | 32×32 | canopy `#3f6b3a`/`#4f7c46`, trunk `#5a4632` | Forest node on soil; rounded canopy + trunk, clearly a gatherable. |
| `nodes/ore.png` | 32×32 | vein `#c9a24a`/`#e0b85c`, matrix `#38332c` | Mineral vein; gold flecks embedded in dark rock, distinct from bare ground. |

### 1c. Structures — `assets/structures/`

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `structures/wall.png` | 32×32 | `#8a6a44` face, `#6e5436` mortar, `#a07e52` top | Solid built wall block; blocks movement + gives cover. |
| `structures/door.png` | 32×32 | `#8a6a44` frame, `#4a3f30` gap, `#a07e52` posts | Doorway in a wall line; visibly passable slot, still reads as part of the wall. |
| `structures/bed.png` | 32×32 | frame `#8a6a44`, bedding `#4f93c9`/`#3a6e97` | A bed; pillow + blanket in the colonist blue so it reads as theirs. |
| `structures/stove_idle.png` | 32×32 | body `#8a6a44`, plate `#38332c` | Cold stove/cook station. |
| `structures/stove_on.png` | 32×32 | body `#8a6a44`, fire `#ff5a52`/`#c9a24a`/`#7cc45a`-pot | Stove cooking — lit firebox + pot, reads active vs idle. |
| `structures/farm_empty.png` | 32×32 | tilled `#5a4632`/`#4a3826` rows | Sown, bare farm plot — furrows only. |
| `structures/farm_growing.png` | 32×32 | rows + sprouts `#7cc45a` (small) | Farm mid-growth — young green shoots in the rows. |
| `structures/farm_ripe.png` | 32×32 | rows + full crops `#7cc45a`/`#8fd66a` | Ripe farm ready to harvest — full crop tops. |
| `structures/turret_idle.png` | 32×32 | base `#8a6a44`, barrel `#38332c`, ore trim `#c9a24a` | Automated turret at rest — squat base + single barrel. |
| `structures/turret_firing.png` | 32×32 | as idle + muzzle `#ffcf6a`/`#ff5a52` glow | Turret firing variant — lit muzzle (the muzzle particle also plays). |

### 1d. Item icons — `assets/items/` (stockpile / hauled marks)

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `items/wood.png` | 16×16 | `#b98b4e` logs, `#8a6a44` ends | A small stack of logs (hauled/stockpiled wood). |
| `items/ore.png` | 16×16 | `#c9a24a` chunks, `#38332c` shadow | Ore chunks. |
| `items/crops.png` | 16×16 | `#7cc45a`/`#8fd66a` | Raw harvested crops (bundle). |
| `items/meal.png` | 16×16 | plate `#a89e8d`, food `#7cc45a`/`#e0b85c` | A cooked meal (what settlers eat). |

### 1e. HUD icons — `assets/icons/`

Small marks the in-code dashboard/palette use (the panels/bars/text are code). Stock icons
are distinct from the ground-item icons so the HUD reads at strip scale.

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `icons/wood.png` | 16×16 | `#b98b4e` | HUD wood-stock glyph (log). |
| `icons/ore.png` | 16×16 | `#c9a24a` | HUD ore-stock glyph. |
| `icons/crops.png` | 16×16 | `#7cc45a` | HUD crops-stock glyph. |
| `icons/meal.png` | 16×16 | `#7cc45a`/`#e0b85c` | HUD meals-stock glyph. |
| `icons/settler.png` | 16×16 | `#4f93c9` body + `#cfe3f2` helmet | Colonist mark (living-settler count; friend side, named in words on HUD). |
| `icons/raider.png` | 16×16 | `#c0473f` + hostile stance | Raider/threat mark. |
| `icons/alert.png` | 16×16 | `#ff5a52` triangle + `#14110d` bang | Danger/alert glyph for the raid warning. |
| `icons/tool_designate.png` | 16×16 | `#ece6db` bracket + `#c9a24a` pick | Designate (chop/mine) tool glyph. |
| `icons/tool_cancel.png` | 16×16 | `#ff5a52` X | Cancel / deconstruct tool glyph. |
| `icons/build_wall.png` | 16×16 | `#8a6a44` | Palette glyph: wall. |
| `icons/build_door.png` | 16×16 | `#8a6a44`/`#4a3f30` | Palette glyph: door. |
| `icons/build_floor.png` | 16×16 | `#4a3f30` | Palette glyph: floor. |
| `icons/build_bed.png` | 16×16 | `#8a6a44`/`#4f93c9` | Palette glyph: bed. |
| `icons/build_stove.png` | 16×16 | `#8a6a44`/`#ff5a52` | Palette glyph: stove. |
| `icons/build_farm.png` | 16×16 | `#5a4632`/`#7cc45a` | Palette glyph: farm plot. |
| `icons/build_turret.png` | 16×16 | `#8a6a44`/`#c9a24a` | Palette glyph: turret. |

---

## 2. Animations — `draw-sheet` (one PNG per frame)

**24×24** frames (fit comfortably inside a 24 px tile), one facing produced (east) and
**mirrored/rotated in code** for other headings. `draw-sheet` emits one separate PNG per
frame (`--frame N`), so each frame is its own file `<dir>/N.png`. The game advances frames
on a timer and plays the cycle matching the character's activity.

### 2a. Settler — `assets/settler/` (colonist blue `#4f93c9`, helmet `#cfe3f2`)

Distinct silhouette + mark, kept apart from the raider below.

| Path (frames) | Frames | Palette | Description |
| --- | --- | --- | --- |
| `settler/walk/0.png … 3.png` | 4 | body `#4f93c9`, helmet `#cfe3f2`, boots `#2f5c85` | Top-down walk cycle — legs alternate, slight bob. |
| `settler/work/0.png … 3.png` | 4 | + tool `#b98b4e`/`#c9a24a` | Chop/mine/build swing — tool raises and strikes, looped while working. |
| `settler/fight/0.png … 3.png` | 4 | + gun `#38332c`, muzzle `#ffcf6a` | Shooting pose — braced, muzzle flashes on the fire frame. |
| `settler/downed/0.png … 1.png` | 2 | body `#4f93c9` dim, blood `#e05a6a` | Fallen/collapsed frame(s) for a downed (bleeding-out) settler. |

### 2b. Raider — `assets/raider/` (hostile red `#c0473f`, aggressive stance)

Readable by silhouette, not color alone.

| Path (frames) | Frames | Palette | Description |
| --- | --- | --- | --- |
| `raider/walk/0.png … 3.png` | 4 | body `#c0473f`, dark `#7a2b26`, mask `#38332c` | Advancing walk cycle — hunched, hostile stance distinct from the settler. |
| `raider/fight/0.png … 3.png` | 4 | + gun `#38332c`, muzzle `#ffcf6a` | Firing pose — muzzle flash on the fire frame. |

---

## 3. Particle systems — `particle-2d` (each emits a `system.json`)

Authored as systems (emitters, forces, per-particle size/opacity/color curves) and played
**live** via `@test-cabinet/particle-runtime`'s `ParticleCanvasPlayer` (see `src/particles.ts`,
DESIGN §4). Field **128×128** (matching valence, composited scaled to the on-board footprint).
One-shots are non-looping; `fire` loops. Land under `assets/fx/`.

| Path | Loop | Field | Palette | Description |
| --- | --- | --- | --- | --- |
| `fx/muzzle.system.json` | one-shot | 128×128 | `#ffcf6a`/`#ffffff`/`#ff8646` | Short bright flash at a shooter's barrel when it fires (warm). |
| `fx/blood.system.json` | one-shot | 128×128 | `#e05a6a`/`#c0473f` | Red spray when a shot hits a **person** (settler/raider). |
| `fx/impact.system.json` | one-shot | 128×128 | `#a89e8d`/`#8a6a44`/`#38332c` | Duller chip/spark burst when a shot hits a **wall/turret**. |
| `fx/fire.system.json` | **loop** | 128×128 | `#ff5a52`/`#ffcf6a`/`#6b6355` smoke | Rising, flickering flame played while something burns (struck structure / explosion aftermath). |
| `fx/explosion.system.json` | one-shot | 128×128 | `#ffcf6a`/`#ff5a52`/`#6b6355` | Fast expanding puff of smoke + sparks for a heavy hit (destroyed turret). |
| `fx/dust.system.json` | one-shot | 128×128 | `#b98b4e`/`#5a4632`/`#a89e8d` | Short construction/impact puff when a node is worked or a build completes. |

---

## 4. Audio — `sfx-synth` (SFX) + `music` (bed), Web Audio playback

Land under `assets/audio/`. Played via the Web Audio API (`src/audio.ts`): cues on their
events, the ambient + music beds looped; music **lifts/ducks** when a raid lands. No
autostart before a user gesture; a **mute** toggle is provided. **Pure synth only** (packs
empty — see the constraint above).

| Path | Tool | Description |
| --- | --- | --- |
| `audio/gunshot.wav` | `sfx-synth` | Sharp percussive shot — noise burst + fast pitch-down tone; plays on every shot fired. |
| `audio/hit.wav` | `sfx-synth` | Short blunt impact — filtered noise thud; plays when a shot lands. |
| `audio/build.wav` | `sfx-synth` | Woody place/complete clunk — low tone + click; plays on a finished build/place. |
| `audio/alarm.wav` | `sfx-synth` | Rising two-tone raid alarm — square/saw sweep; plays when a raid is announced. |
| `audio/ambient.wav` | `sfx-synth` | Soft looping frontier wind / low turret hum bed under the colony. |
| `audio/music.wav` (+ `audio/music.mid`) | `music` | Ambient/tension music bed — low, sparse frontier atmosphere on **synth-waveform tracks** (`define-track --instrument sine/triangle/saw`) that lifts into tension when a raid lands (duck/filter one bed, or cross-fade calm↔tense). Play the `.wav`; `.mid` kept as a companion. |

---

## 5. Load wiring (recap)

`src/assets.ts` globs `../assets/**/*.png` (`?url`), `../assets/fx/*.system.json` (eager
JSON), and `../assets/audio/*.wav` (`?url`), keying each by its path under `assets/`. Sheet
frames are grouped by prefix (`settler/walk/0..3`, `raider/fight/0..3`, …). Vite `base: "./"`
makes every emitted URL page-relative, so the built `dist/` loads with no 404s under a
per-run sub-path. Nothing here is drawn in code except the HUD/menu chrome that
`specs/assets.md` reserves for code (panels, bars, meters, the work grid, text, day/night
lighting, selection/ghost cursors) — every sprite, sheet frame, particle system, and sound
above is a genuinely tool-produced file.
