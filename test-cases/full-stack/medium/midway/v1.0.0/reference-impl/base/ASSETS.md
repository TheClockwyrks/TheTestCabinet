# Midway — produced-asset manifest

This is the production manifest derived from `specs/assets.md`: **every** asset file
the reference build produces with the six on-`PATH` tools and commits under `assets/`.
The engineers load assets **only** by the exact paths below, so they must match what
the implementation references (`src/assets.ts`). Reproduce them with
`scripts/gen-assets.sh`, which puts the tools on `PATH` and records the exact operations
(the tools are `/cargo-target/the-test-cabinet/release/{draw,draw-sheet,particle-2d,
sfx-synth,sfx-sample,music}`; add that dir to `PATH`).

All paths are under
`test-cases/full-stack/medium/midway/v1.0.0/reference-impl/base/assets/`.

## Rules (from `specs/assets.md` + `overview.md`)

- **Six tools only** — `draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
  `music`. No `ui`/`paint`/`texture`/voxel/mesh tool exists in this image, so **all
  HUD/menu/panel chrome is drawn in code**; only the small **icons** are produced
  sprites.
- **Pixel art, straight alpha.** Every `draw`/`draw-sheet` canvas is transparent
  (`"background": "transparent"`), drawn at native size, sampled **nearest-neighbor**
  in-game (`imageSmoothingEnabled = false`). `24×24` matches the tile; multi-tile
  bodies are sized to their footprint; icons are `16×16`.
- **`draw-sheet` emits one PNG per frame** (`--frame <i>` on every op), never a strip.
- **Particle systems** are authored with `particle-2d` and its `render` step emits the
  `system.json`; they are **simulated live** in-game through
  `@test-cabinet/particle-runtime`'s `/canvas` binding — never baked frames or flat
  shapes.
- **Page-relative loading.** Assets are loaded via Vite `import.meta.glob('../assets/
  **/*.{png,wav}', …)` / glob of `fx/*.system.json`, with `base: "./"` — never a
  root-absolute `/assets/…` URL, so `dist/` works under a per-run sub-path.
- Palette hexes below are from `overview.md`; every asset stays in that palette.

### ⚠ Environment constraint — audio must be pure `sfx-synth` / synth-waveform `music`

In **this** environment the baked **`sfx-sample` sample pack and the `music`
instrument bank are EMPTY**. Therefore, exactly as the valence reference did:

- **All sound effects are authored with `sfx-synth`** (oscillator/noise voices +
  envelopes/filters/FX) — do **not** use `sfx-sample` (no pack to sample).
- **The music bed is authored with `music` using SYNTH-WAVEFORM tracks** —
  `define-track --instrument sine|square|saw|triangle` (a waveform name), **not** a
  bank-instrument name. `music` still emits both the `.wav` (played) and the `.mid`
  companion.

---

## 1. Sprites — `draw` (one PNG each)

### 1a. Ground & path tiles — `assets/tiles/` (24×24)

| Path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `tiles/grass.png` | draw | 24×24 | grass `#4f8f4a`, dark tuft `#2f7d3a` | Open buildable ground; a couple of darker tufts, tiles seamlessly. |
| `tiles/water.png` | draw | 24×24 | water `#37a0c4`, hi `#45c6f0` | Pond/stream tile with a lighter ripple; not buildable/pathable. |
| `tiles/fence.png` | draw | 24×24 | ride-structure `#8b93a7`, dark `#6d7789` | The sealed border post-and-rail; reads as the plot edge. |
| `tiles/gate.png` | draw | 24×24 | roof `#e0603c`, structure `#8b93a7` | The single entrance gate/arch in the fence where guests enter/leave. |
| `tiles/path.png` | draw | 24×24 | path `#cdae7d`, edge `#b2925f` | Straight paved walkway, drawn to **tile flush** into runs (edge seam matched). |
| `tiles/path_corner.png` | draw | 24×24 | path `#cdae7d`, edge `#b2925f` | Right-angle corner piece so laid paths bend cleanly. |
| `tiles/path_junction.png` | draw | 24×24 | path `#cdae7d`, edge `#b2925f` | 3/4-way junction so path runs join without seams. |

### 1b. Rides — `assets/rides/` (static structure; motion is §2c)

| Path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `rides/carousel.png` | draw | 72×72 (3×3) | structure `#8b93a7`, roof `#e0603c`, trim `#ffcb52` | Round carousel base + striped conical roof; gentle family ride. |
| `rides/coaster.png` | draw | 96×72 (4×3) | structure `#8b93a7`, track `#8b93a7`, accent `#c46bff` | Coaster station + a length of track; high-thrill draw. |
| `rides/drop_tower.png` | draw | 48×48 (2×2) | structure `#8b93a7`, cap `#e0603c`, thrill `#c46bff` | Tall drop-tower mast + base; the car (§2c) rides it. |

### 1c. Stalls — `assets/stalls/` (48×24, 2×1 footprint)

| Path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `stalls/food.png` | draw | 48×24 | roof `#e0603c`, hunger `#f59042`, body `#cdae7d` | Food stall (counter + awning); reads as food; steam vents when serving. |
| `stalls/drink.png` | draw | 48×24 | roof `#e0603c`, thirst `#45c6f0`, body `#cdae7d` | Drink stall with a cup/tap motif in the thirst blue. |
| `stalls/souvenir.png` | draw | 48×24 | roof `#e0603c`, happiness `#ffd24a`, body `#cdae7d` | Souvenir/gift stall (balloons/flags); a want, not a need. |
| `stalls/restroom.png` | draw | 48×24 | structure `#8b93a7`, thirst `#45c6f0`, body `#cdae7d` | Restroom hut with a clear WC glyph; relieves bladder. |

### 1d. Scenery — `assets/scenery/`

| Path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `scenery/tree.png` | draw | 24×24 | foliage `#2f7d3a`, trunk `#6d4a2f` | Round leafy tree; raises nearby path appeal. |
| `scenery/flowerbed.png` | draw | 24×24 | foliage `#2f7d3a`, hunger `#f59042`, thrill `#c46bff` | Low bed of mixed-color blooms. |
| `scenery/bench.png` | draw | 24×24 | wood `#b2925f`, structure `#8b93a7` | Park bench; appeal **and** a rest spot for tired guests. |
| `scenery/lamp.png` | draw | 24×24 | post `#8b93a7`, glow `#ffcb52` | Lamp post with a warm golden-hour glow. |
| `scenery/fountain.png` | draw | 48×48 (2×2) | stone `#8b93a7`, water `#37a0c4`, hi `#45c6f0` | Stone fountain (nice extra); strong appeal. |

### 1e. HUD icons — `assets/icons/` (16×16)

| Path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `icons/cash.png` | draw | 16×16 | cash `#5fce6e` | Coin/banknote mark for the cash vital. |
| `icons/guest.png` | draw | 16×16 | guest `#ff8fb0` | Little guest head for the guest-count vital. |
| `icons/star.png` | draw | 16×16 | rating `#ffcb52` | Star for the park-rating row. |
| `icons/happiness.png` | draw | 16×16 | happiness `#ffd24a` | Smiley mood face for the happiness vital. |
| `icons/thrill.png` | draw | 16×16 | thrill `#c46bff` | Coaster/lightning glyph for the thrill desire. |
| `icons/hunger.png` | draw | 16×16 | hunger `#f59042` | Food glyph for the hunger desire. |
| `icons/thirst.png` | draw | 16×16 | thirst `#45c6f0` | Cup/drop glyph for the thirst desire. |
| `icons/bladder.png` | draw | 16×16 | thirst `#45c6f0` | WC/drop glyph for the bladder desire. |
| `icons/energy.png` | draw | 16×16 | happiness `#ffd24a` | Bolt/boot glyph for the energy reserve. |
| `icons/litter.png` | draw | 16×16 | tertiary `#6d7789` | Crumpled-litter glyph for the cleanliness alert. |
| `icons/alert.png` | draw | 16×16 | alert `#ff5a52` | Warning triangle for HUD alerts (broken ride, low cash). |
| `icons/tool_path.png` | draw | 16×16 | path `#cdae7d` | Path-tool palette glyph. |
| `icons/tool_build.png` | draw | 16×16 | roof `#e0603c` | Build-tool palette glyph. |
| `icons/tool_staff.png` | draw | 16×16 | guest `#ff8fb0` | Staff-tool palette glyph. |
| `icons/tool_price.png` | draw | 16×16 | cash `#5fce6e` | Price/manage-tool palette glyph. |
| `icons/tool_demolish.png` | draw | 16×16 | alert `#ff5a52` | Demolish-tool palette glyph. |

---

## 2. Animations — `draw-sheet` (one PNG per frame)

### 2a. Guests — `assets/guest/` (16×16, 4 frames each; guest color `#ff8fb0`)

The crowd is animated, not dots; the **mood/action** set is chosen per guest so a
glance reads the crowd (`specs/guests.md`). Reuse one body and recolor/repose per state.

| Path (frames) | Tool | Frames | Palette | Description |
| --- | --- | --- | --- | --- |
| `guest/walk/0.png … 3.png` | draw-sheet | 4 | body `#ff8fb0`, dark `#c46b86` | Neutral walk cycle (leg swing), the default. |
| `guest/happy/0.png … 3.png` | draw-sheet | 4 | body `#ff8fb0`, happiness `#ffd24a` | Beaming walk/idle — upbeat pose, smile, sparkle. |
| `guest/angry/0.png … 3.png` | draw-sheet | 4 | body `#ff8fb0`, alert `#ff5a52` | Fuming walk/idle — red flush, stomping pose. |
| `guest/eating/0.png … 3.png` | draw-sheet | 4 | body `#ff8fb0`, hunger `#f59042` | Eating pose (raising food to mouth), used after a food buy. |

### 2b. Staff — `assets/staff/` (16×16, 4-frame walk each; distinct from a guest)

| Path (frames) | Tool | Frames | Palette | Description |
| --- | --- | --- | --- | --- |
| `staff/janitor/0.png … 3.png` | draw-sheet | 4 | uniform `#37a0c4`, broom `#b2925f` | Janitor walking with a broom; clears litter. |
| `staff/mechanic/0.png … 3.png` | draw-sheet | 4 | uniform `#f59042`, wrench `#8b93a7` | Mechanic walking with a wrench; repairs/inspects rides. |
| `staff/entertainer/0.png … 3.png` | draw-sheet | 4 | costume `#c46bff`, trim `#ffcb52` | Mascot entertainer; lifts nearby mood. |

### 2c. Rides — `assets/ride/` (moving parts, sized to footprint; played while running)

| Path (frames) | Tool | Frames | Palette | Description |
| --- | --- | --- | --- | --- |
| `ride/carousel/0.png … 5.png` | draw-sheet | 6 | horses `#ffcb52`/`#e0603c`, pole `#8b93a7` | Carousel spin — horses rotate around the center; loops while running. |
| `ride/coaster/0.png … 3.png` | draw-sheet | 4 | car `#c46bff`, track `#8b93a7` | Coaster car moving along the station/track; loops while running. |
| `ride/drop_tower/0.png … 5.png` | draw-sheet | 6 | car `#e0603c`, mast `#8b93a7` | Drop-tower car rising up the mast then dropping; plays the run cycle. |

Rides play these frames **only** while `state` is loading/running and freeze on frame 0
when idle or broken, so a running ride is visibly alive and a dead one visibly still.

---

## 3. Particle systems — `particle-2d` (→ `system.json`, played live)

Authored with `particle-2d` (`add-emitter`/`set-forces`/`set-particle`/
`add-subemitter`/`set-timeline`, then `render`). Field ~`128×128`; the game composites
them at the event's world position via `@test-cabinet/particle-runtime`. Fireworks and
cleanup are **one-shots**; steam and sparkle are **looping overlays** (`set-timeline
--loop`) played while a stall/ride is active.

| Path | Tool | Loop? | Palette | Description |
| --- | --- | --- | --- | --- |
| `fx/fireworks.system.json` | particle-2d | one-shot | rating `#ffcb52`, thrill `#c46bff`, thirst `#45c6f0`, cash `#5fce6e` | Celebratory multi-color burst over the park at a milestone (new ride, 5-star day, guest-count). |
| `fx/steam.system.json` | particle-2d | loop | primary text `#f2efe8`, secondary `#aeb6c6` | Small rising steam/aroma vent over a **running food/drink stall**. |
| `fx/sparkle.system.json` | particle-2d | loop | rating `#ffcb52`, happiness `#ffd24a` | Light sparkle at a **running ride** (carousel lights / coaster sparks). |
| `fx/cleanup.system.json` | particle-2d | one-shot | grass `#4f8f4a`, secondary `#aeb6c6` | Short puff thrown when a **janitor clears litter** (or litter is dropped). |

---

## 4. Audio — `sfx-synth` (SFX) + `music` synth-waveform (bed) → Web Audio

Played via the Web Audio API (`decodeAudioData`); cues on their events, crowd hum +
music looped; **no autostart before a user gesture**; a **mute** toggle. See the
environment constraint above — **all SFX are `sfx-synth`; the music bed is `music`
with synth-waveform tracks**; `sfx-sample` is not used.

| Path | Tool | Palette / character | Description |
| --- | --- | --- | --- |
| `audio/coin.wav` | sfx-synth | bright, short | Purchase/coin cue on a ride ticket or a stall sale (two quick ascending blips). |
| `audio/ding.wav` | sfx-synth | bell-like | Ride-start ding/bell when a ride begins a run. |
| `audio/alarm.wav` | sfx-synth | harsh, attention | Low-cash / ride-broken alarm (two-tone buzzer). |
| `audio/crowd.wav` | sfx-synth | soft, loopable | Gentle crowd/park hum bed (filtered noise + low tone), looped under play. |
| `audio/music.wav` | music | bright, bouncy | Cheerful carnival/fairground loop (synth-waveform tracks: a `square` lead, a `triangle`/`sine` bass, a `saw` counter-melody), looped under the park. **Play this.** |
| `audio/music.mid` | music | — | Portable `.mid` companion emitted alongside `music.wav` (kept, not required for playback). |

---

## 5. Load-mapping summary (`src/assets.ts`)

- `pngUrls = import.meta.glob('../assets/**/*.png',
  { eager: true, query: '?url', import: 'default' })`
  → keyed by path minus `../assets/` and `.png` (e.g. `tiles/grass`, `icons/cash`).
- Animation frame arrays via a `frames(prefix, count)` helper reading
  `guest/walk/0…3`, `ride/carousel/0…5`, `staff/janitor/0…3`, etc.
- `fxJson = import.meta.glob('../assets/fx/*.system.json',
  { eager: true, import: 'default' })`
  → `ParticleSystem` per `FxKind`.
- `wavUrls = import.meta.glob('../assets/audio/*.wav',
  { eager: true, query: '?url', import: 'default' })`
  → URL per `Cue` (`coin`/`ding`/`alarm`/`crowd`) plus `music`.

Every file the game shows or plays traces back to one of the rows above (produced with a
tool) or to HUD/menu chrome drawn in code (`specs/assets.md` "What you draw in code") —
no placeholder rectangles, ad-hoc code-drawn sprites, flat particle stand-ins,
downloaded art, or silence.
