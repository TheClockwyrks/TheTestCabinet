# Hollowdeep — produced-asset manifest

Every asset the game plays is **produced during the build** with the six on-`PATH`
tools and committed under `assets/`, per `specs/assets.md`. This is the exact list the
engineers produce (via `scripts/gen-assets.sh`) and the game loads by these exact paths.
The runtime only *loads* them — `npm run build` never invokes the tools. No placeholder
rectangles, no ad-hoc code-drawn art in place of a sprite, no flat tint in place of the
gas particles, no downloaded assets, no silence.

## Environment constraint — audio (read first)

**In this environment the baked `sfx-sample` sample pack and the `music` instrument bank
are EMPTY.** So all sound is authored **without** them, exactly as valence did:

- Every SFX is produced with **`sfx-synth`** (oscillator/noise voices — `add-voice`,
  `set-envelope`, filters/FM/etc.), **not** `sfx-sample`.
- The music bed is produced with **`music` using SYNTH-WAVEFORM tracks**:
  `define-track --instrument <sine|square|saw|triangle>` (a waveform name, **never** a
  bank instrument name), then `add-note` / `set-track-fx` / `render`.

## Loading rule (page-relative, base-path safe)

Assets are loaded through Vite import globs so every URL resolves relative to the page
under any base path (`vite.config.ts` sets `base: "./"`) — never a root-absolute
`/assets/...` URL. `src/assets.ts` uses:

- `import.meta.glob("../assets/**/*.png",
  { eager: true, query: "?url", import: "default" })`
- `import.meta.glob("../assets/fx/*.system.json", { eager: true, import: "default" })`
- `import.meta.glob("../assets/audio/*.wav",
  { eager: true, query: "?url", import: "default" })`

All pixel-art PNGs sample nearest-neighbor (`imageSmoothingEnabled = false`). Palette
values are **exactly** `specs/overview.md`.

## Folder layout

```
assets/
  tiles/     world materials + built structure (draw, 32×32)
  machines/  generator/diffuser/pump/refinery/farm (draw, 32×32)
  items/     ore/material/fungus stock icons (draw, 16×16)
  icons/     HUD & tool glyphs (draw, 16×16)
  delver/    walk|dig|carry|idle sheets (draw-sheet, one PNG per frame, 32×32)
  fx/        gas overlays + dust + steam (particle-2d, *.system.json, field 128×128)
  audio/     dig/build/alarm/machine/music (sfx-synth + music)
```

---

## Sprites — `draw` (one PNG each)

### Tiles — `assets/tiles/`, 32×32, tiling flush against neighbors

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `tiles/dirt.png` | 32×32 | `#4a3524` base, `#3a2a1c` speckle | Common packed-earth fill (quick dig). |
| `tiles/ore.png` | 32×32 | `#4a3524` dirt, `#d9a441` vein, `#f0c86a` glint | Dirt veined with mineral — yields ore. |
| `tiles/rock.png` | 32×32 | `#2b2620` base, `#38322a` cracks | Dense stone (slowest dig, no yield). |
| `tiles/bedrock.png` | 32×32 | `#201c17` base, `#2b2620` chevron border | Indestructible world-seal border. |
| `tiles/open.png` | 32×32 | `#191410` backing, `#221a12` vignette | Dug/hollow space backing wall (reads as a lit interior, not a hole). |
| `tiles/wall.png` | 32×32 | `#566073` body, `#6b7788` bevel, `#3d4552` shade | Built wall — blocks gas, not walkable. |
| `tiles/floor.png` | 32×32 | transparent + `#566073` top plate, `#6b7788` highlight | Walkable floor surface (top-of-tile plate). |
| `tiles/ladder.png` | 32×32 | transparent + `#c9862f` rails/rungs, `#e0a24a` highlight | Climbable ladder (vertical movement). |
| `tiles/wire.png` | 32×32 | transparent + `#c9862f` conduit, `#ffcb52` spark node | Power wire (carries power; doesn't block gas). |

### Machines & farm — `assets/machines/`, 32×32

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `machines/generator.png` | 32×32 | `#566073` body, `#2b2620` hopper, `#ffcb52` ember glow | Coal/fuel generator (adds power supply). |
| `machines/diffuser.png` | 32×32 | `#566073` body, `#47e0c8` emitter vents, `#eaf7f3` glint | Oxygen diffuser (emits O2 while powered). |
| `machines/pump.png` | 32×32 | `#566073` body, `#c9862f` ducts, `#a89e8d` intake | Gas pump (moves gas intake→output). |
| `machines/refinery.png` | 32×32 | `#566073` body, `#d9a441` crucible glow, `#ff5a52` heat | Operated ore refinery (ore→material). |
| `machines/farm.png` | 32×32 | `#2b2620` bed, `#7cd45a` young caps | Planted fungus farm (growing). |
| `machines/farm_ripe.png` | 32×32 | `#2b2620` bed, `#a6e87a` ripe caps, `#c9862f` spore glow | Ripe fungus farm (harvestable variant). |

### Resource items — `assets/items/`, 16×16 (stockpile/HUD icons)

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `items/ore.png` | 16×16 | `#d9a441` chunk, `#f0c86a` facet, `#8a6420` shade | Raw ore stock icon. |
| `items/material.png` | 16×16 | `#566073` block, `#6b7788` edge | Refined material stock icon. |
| `items/fungus.png` | 16×16 | `#7cd45a` cap, `#5aa83e` stem | Harvested food stock icon. |

### HUD & tool glyphs — `assets/icons/`, 16×16

| Path | Size | Palette | Description |
| --- | --- | --- | --- |
| `icons/oxygen.png` | 16×16 | `#47e0c8` rising bubble/arrow | Oxygen vitals glyph. |
| `icons/co2.png` | 16×16 | `#b6c24a` settling molecule | CO2 vitals glyph. |
| `icons/power.png` | 16×16 | `#ffcb52` lightning bolt | Power vitals glyph. |
| `icons/food.png` | 16×16 | `#7cd45a` cap | Food stock glyph. |
| `icons/alert.png` | 16×16 | `#ff5a52` triangle, `#12100c` bang | Low-oxygen / starving alert glyph. |
| `icons/dig.png` | 16×16 | `#a89e8d` pick head, `#c9862f` handle | Dig-tool palette glyph. |
| `icons/cancel.png` | 16×16 | `#ff5a52` crossed slash / X | Cancel/deconstruct-tool glyph. |
| `icons/priority.png` | 16×16 | `#ffcb52` double up-chevron | Priority-toggle glyph. |

The **building** palette entries reuse the produced `tiles/*` and `machines/*` sprites
as their glyphs (they are already produced sprites); only the two tools and the priority
toggle get dedicated glyph icons.

---

## Animations — `draw-sheet` (one PNG per frame)

The delver (the one thing on screen that must feel alive) is drawn ~20×20 inside a
32×32 frame — suit `#e08a3c`, helmet lamp glow `#ffcb52`, visor `#47e0c8`, boots
`#3d4552`. One facing is produced and **mirrored in code** by `facing`. The game plays
the cycle matching the delver's action, advancing frames on a timer.

| Path (frames) | Frames | Size | Description |
| --- | --- | --- | --- |
| `delver/walk/{0..5}.png` | 6 | 32×32 | Side-view walk cycle (leg stride + arm swing). |
| `delver/dig/{0..3}.png` | 4 | 32×32 | Mining swing — pick arcs down, played while digging. |
| `delver/carry/{0..3}.png` | 4 | 32×32 | Hauling walk — carries a crate (`#566073`/`#d9a441`). |
| `delver/idle/{0..3}.png` | 4 | 32×32 | Small breathing/looking idle for a jobless delver. |

---

## Particle systems — `particle-2d` (played live via `@test-cabinet/particle-runtime`)

Each writes a `system.json` on a **128×128** authored field. The gas overlays are driven
from tile concentration by `src/particles.ts` (`GasOverlay`) — spawned/scaled where a gas
is present and by how much; the dust is a one-shot at a mined tile; the steam loops at a
running machine's vent (`Bursts`). Because they are simulated, they vary play to play.

| Path | Field | Loop | Palette / motion | Description |
| --- | --- | --- | --- | --- |
| `fx/oxygen_haze.system.json` | 128×128 | yes | `#47e0c8`→`#a6f0e4`, fine small particles, **upward** force (negative gravity), low opacity | Breathable-air overlay — a fine **rising** haze, denser where oxygen is concentrated. |
| `fx/co2_plume.system.json` | 128×128 | yes | `#b6c24a`→`#d0d97a`, larger slower particles, **downward** gravity, heavier opacity | Waste-gas overlay — a heavier plume that **settles low**, denser where CO2 pools. |
| `fx/dig_dust.system.json` | 128×128 | no (one-shot) | `#4a3524`/`#6b6355` dust, outward burst + gravity, short | Puff thrown when a tile is mined. |
| `fx/machine_steam.system.json` | 128×128 | yes | `#a89e8d`/`#eaf7f3` warm steam, gentle upward drift | Small looping vent for a running generator/diffuser/pump. |

The oxygen haze (rising) and CO2 plume (settling) must read as the buoyancy in
`specs/gas.md` — oxygen up, CO2 low — by **motion and form**, not color alone.

---

## Audio — `sfx-synth` + `music` (played via Web Audio)

All SFX via `sfx-synth`; the bed via `music` with **synth-waveform** tracks (bank/pack
are empty here — see the constraint above). Loaded page-relative, decoded with
`decodeAudioData`, played on the matching event; the machine hum and music bed loop.
Never autostart before a user gesture; a mute toggle is provided.

| Path | Tool | Description |
| --- | --- | --- |
| `audio/dig.wav` | `sfx-synth` | Pick/impact cue on a mined tile — short filtered noise burst + a low `triangle` thunk, fast decay. |
| `audio/build.wav` | `sfx-synth` | Build/place cue on a completed build — a two-tone `square`+`triangle` clunk with a click transient. |
| `audio/alarm.wav` | `sfx-synth` | Low-oxygen alarm — an urgent repeating `saw`/`square` warble (~1 s) with vibrato; plays when oxygen goes critical or the colony is starving. |
| `audio/machine.wav` | `sfx-synth` | Soft machine hum **loop** — a low `sine`/`triangle` drone with a slow LFO, seamless for looping under a running machine. |
| `audio/music.wav` (+ `audio/music.mid`) | `music` | Ambient underground **bed** — a slow, low, atmospheric loop from synth-waveform tracks (a `sine` pad + `triangle` sub-bass + a sparse `saw` motif). Play the `.wav`; the `.mid` is a portable companion. |

---

## Not produced — drawn in code (no tool for these)

There is no `ui`/`paint` tool in this image, so all HUD/dashboard chrome is drawn in code
(`src/render.ts`) in the palette: the top-strip vitals and bottom-strip roster + build
palette, every menu/overlay/state screen (title, how-to-play, pause, colony-lost),
selection & tool feedback (dig designations, build ghosts, hovered-tile cursor, priority
marks), and the **driving** of the gas overlay (deciding where/how strongly to play the
produced haze/plume systems from tile concentrations). The small HUD/palette **icons**
above are the only produced sprites inside the in-code HUD.
