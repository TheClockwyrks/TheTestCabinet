# Junction — Produced-asset manifest (ASSETS.md)

This is the production contract for every asset the reference build plays, derived from
`specs/assets.md`. **Every file below is produced during the build with one of the six
on-`PATH` tools** (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`)
and committed under `assets/`. At runtime the game only *loads* these files (page-relative
via `import.meta.glob`, `vite base "./"`); the tools are never invoked by `npm run build`.
No placeholder rectangles, no ad-hoc code-drawn art in place of a sprite, no downloaded
assets, no silence — that is the whole point of the case (`specs/assets.md`, the
Presentation & Assets domain).

Produce the sprites/sheets with a `scripts/gen-assets.sh` (the valence pattern: a
`draw`/`draw-sheet` config per sprite, one op per line) and the audio/particles with
companion scripts; the tools resolve from `PATH` or `/cargo-target/the-test-cabinet/release`.

## Environment constraint — audio must be synth-only

**In this build environment the baked `sfx-sample` pack and the `music` instrument bank are
EMPTY.** Therefore, exactly as the valence reference did:

- **All sound effects are authored with `sfx-synth`** (oscillator/noise voices + envelopes/
  filters), **not `sfx-sample`** — there is no sample pack to layer over.
- **The music bed is authored with `music` using SYNTH-WAVEFORM tracks** —
  `define-track --instrument sine|square|saw|triangle` — **never a bank instrument name**
  (there is no bank). `music` still emits both the `.wav` (played) and a companion `.mid`.

The game's asset-loader and audio layer are agnostic to how a `.wav` was made, so the wiring
is unchanged; only the authoring tool is constrained.

## Palette

All colors are from `specs/overview.md`. Sprites are **pixel art**: drawn at native size on
a transparent (straight-alpha) canvas and sampled **nearest-neighbor**
(`imageSmoothingEnabled=false`). Each zone must read by **form** as well as hue; roads vs
rail, and wire vs pipe, must be visibly distinct.

Key hexes referenced below: bg `#12161c`, earth `#2a2f26`, grass `#33502f`, water `#245a73`,
hill `#3a3630`, **res `#4caf6d`**, **com `#4a90d9`**, **ind `#e0a63c`**, road `#3c434d`,
**rail `#b061e6`**, station `#ece6db`, **power `#ffcb52`**, **water/pipe `#47c8e0`**,
congest `#ff7a3c`, pollution `#8a7d5a`, money `#7cd45a`, alert `#ff5a52`, text `#e6ebf0`.
(Tiers use a light/mid/bright ramp of the zone hue plus lit windows; `+`/`−` shades are
derived tints of these.)

---

## 1. Sprites — `draw` (one PNG per sprite)

### 1.1 Zone buildings, per density tier (9, the spec minimum)

Each `(zone, tier)` is its own building form; a higher tier reads denser/taller.
Loaded by `src/assets.ts` as `zoneSprite(zone, tier)`.

| Output path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `assets/zones/res_1.png` | draw | 32×32 | res `#4caf6d`, roof `#2f7a4a`, window `#eafff2` | Low-density house: small gabled cottage, one lit window, yard. |
| `assets/zones/res_2.png` | draw | 32×32 | res `#4caf6d` +lit `#7fd89b` | Mid-density: a low apartment block, two window rows. |
| `assets/zones/res_3.png` | draw | 32×32 | res `#4caf6d`, bright `#9be9b4` | High-density residential tower, tall footprint, many lit windows. |
| `assets/zones/com_1.png` | draw | 32×32 | com `#4a90d9`, sign `#bcdcff` | Corner shop: single storefront, awning, sign strip. |
| `assets/zones/com_2.png` | draw | 32×32 | com `#4a90d9` +lit `#7fb4ea` | Storefront row / mid retail block, glass front. |
| `assets/zones/com_3.png` | draw | 32×32 | com `#4a90d9`, bright `#a9d2ff` | Blue office tower, curtain-wall grid of lit windows. |
| `assets/zones/ind_1.png` | draw | 32×32 | ind `#e0a63c`, metal `#8a7d5a` | Small workshop: low shed, single roof vent. |
| `assets/zones/ind_2.png` | draw | 32×32 | ind `#e0a63c` +metal | Factory: saw-tooth roof, one smokestack. |
| `assets/zones/ind_3.png` | draw | 32×32 | ind `#e0a63c`, stack `#5b6570` | Heavy plant: large hall, two/three stacks (the pollution source). |

Empty zoned lots are drawn **in code** (a colored, cross-hatched tile in the zone hue), per
the spec's allowance — no sprite needed.

### 1.2 Transit tiles

Road drawn so tiles connect into continuous roads; `src/assets.ts` `roadSprite(mask)`
selects by the 4-neighbor road bitmask.

| Output path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `assets/transit/road_straight.png` | draw | 32×32 | road `#3c434d`, lane `#9aa4af` | Straight road segment with dashed centre line (rotated in code). |
| `assets/transit/road_corner.png` | draw | 32×32 | road `#3c434d`, lane | 90° corner segment. |
| `assets/transit/road_junction.png` | draw | 32×32 | road `#3c434d`, lane | 3/4-way intersection (signal sheet plays on top). |
| `assets/transit/road_end.png` | draw | 32×32 | road `#3c434d` | Dead-end / stub cap (start road stub uses it). |
| `assets/transit/rail.png` | draw | 32×32 | rail `#b061e6`, tie `#5b6570` | Metro line tile: two bright rails + ties — clearly not a road. |
| `assets/transit/station.png` | draw | 32×32 | station `#ece6db`, rail `#b061e6` | Station/stop: platform pad astride the rail, roof mark. |

### 1.3 Utility tiles

| Output path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `assets/utility/plant.png` | draw | 64×64 (2×2) | power `#ffcb52`, body `#3a3630` | Power plant: turbine hall + cooling stack, glowing amber core. |
| `assets/utility/wire.png` | draw | 32×32 | power `#ffcb52`, pole `#5b6570` | Power line: pylon + amber cable — reads as a wire. |
| `assets/utility/source.png` | draw | 64×64 (2×2) | water/pipe `#47c8e0`, body `#245a73` | Water source: pump-house + tower, cyan tank. |
| `assets/utility/pipe.png` | draw | 32×32 | pipe `#47c8e0` | Water pipe: cyan conduit run — distinct from the amber wire. |

### 1.4 Vehicles (small, moved along the network in code)

| Output path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `assets/vehicles/car.png` | draw | 16×16 | body `#bcdcff`, window `#e6ebf0` | Commuter car (rotated to heading in code). |
| `assets/vehicles/truck.png` | draw | 16×16 | body `#e0a63c`, cab `#9aa4af` | Goods truck (industry→commerce shipments). |
| `assets/vehicles/tram.png` | draw | 16×24 | body `#b061e6`, window `#f0e6ff` | Single tram/metro car (station-to-station rail). |

### 1.5 HUD icons (small marks inside the in-code HUD)

16×16 transparent glyphs; the only produced art the HUD uses (panels/bars/text are code).

| Output path | Tool | Size | Palette | Description |
| --- | --- | --- | --- | --- |
| `assets/icons/money.png` | draw | 16×16 | money `#7cd45a` | Coin / `$` mark (treasury + cost readout). |
| `assets/icons/pop.png` | draw | 16×16 | text `#e6ebf0` | Person silhouette (population). |
| `assets/icons/power.png` | draw | 16×16 | power `#ffcb52` | Lightning bolt (power balance). |
| `assets/icons/water.png` | draw | 16×16 | pipe `#47c8e0` | Droplet (water balance). |
| `assets/icons/zone_r.png` | draw | 16×16 | res `#4caf6d` | R glyph / house mark (RCI meter + palette). |
| `assets/icons/zone_c.png` | draw | 16×16 | com `#4a90d9` | C glyph / shop mark. |
| `assets/icons/zone_i.png` | draw | 16×16 | ind `#e0a63c` | I glyph / factory mark. |
| `assets/icons/alert.png` | draw | 16×16 | alert `#ff5a52` | Warning triangle (alert chip). |
| `assets/icons/road.png` | draw | 16×16 | road `#3c434d`, lane `#9aa4af` | Road tool glyph. |
| `assets/icons/rail.png` | draw | 16×16 | rail `#b061e6` | Rail tool glyph. |
| `assets/icons/station.png` | draw | 16×16 | station `#ece6db` | Station tool glyph. |
| `assets/icons/bulldoze.png` | draw | 16×16 | text2 `#9aa4af`, alert `#ff5a52` | Bulldoze / raze glyph. |

(The RES/COM/IND, PWR-plant, WIRE, WTR-source, PIPE palette buttons reuse the zone/utility
icons above.)

---

## 2. Animations — `draw-sheet` (one PNG per frame; ≥2 sheets required)

Each sheet is a short cycle, one separate PNG per frame under its own directory; played on
a timer in code. Three sheets (well above the minimum two):

| Output paths | Tool | Size × frames | Palette | Description |
| --- | --- | --- | --- | --- |
| `assets/anim/signal/{0..3}.png` | draw-sheet | 16×16 × 4 | green `#4caf6d`, amber `#e0a63c`, red `#ff5a52` | Traffic-signal cycle (green→amber→red→amber) played at road junctions (`specs/transit.md`). |
| `assets/anim/construction/{0..3}.png` | draw-sheet | 32×32 × 4 | scaffold `#9aa4af`, frame `#5b6570`, lit `#e6ebf0` | Building-under-construction sequence (empty pad → scaffold → framed → topped), played while a lot develops/upgrades before its finished `zones/*` sprite, paired with the dust particle (`specs/map.md`). |
| `assets/anim/tram/{0..3}.png` | draw-sheet | 16×24 × 4 | rail `#b061e6`, window `#f0e6ff` | Rolling tram/metro cycle (window lights + wheel shuffle) for the animated rail car (`specs/transit.md`). |

---

## 3. Particle systems — `particle-2d` (a `system.json` each; ≥3 required)

Authored with `particle-2d` (emitters + forces + per-particle size/opacity/color curves),
`render`ed to `system.json`, and played **live** through `@test-cabinet/particle-runtime`'s
`/canvas` binding (`src/particles.ts`) — simulated overlays that vary play to play, not
flat tints. Authored on a **128×128** field (the footprint each is scaled to on the map).

| Output path | Tool | Field | Palette | Kind | Description |
| --- | --- | --- | --- | --- | --- |
| `assets/fx/pollution.system.json` | particle-2d | 128×128 | pollution `#8a7d5a` | looping | Slow, drifting, **settling** smog haze. Driven by the tile pollution field: `src/particles.ts` spawns/scales it where pollution is present, thick over heavy industry and jammed corridors, thinning as pollution clears (`specs/economy.md`). |
| `assets/fx/dust.system.json` | particle-2d | 128×128 | earth `#2a2f26`, `#9aa4af` | one-shot | Short construction-dust puff thrown when a lot is developing/upgrading, played at the constructing tile (`specs/map.md`), paired with the construction sheet. |
| `assets/fx/fireworks.system.json` | particle-2d | 128×128 | money `#7cd45a`, com `#4a90d9`, power `#ffcb52` | one-shot | Celebratory milestone burst (first rail line, a population threshold, a maxed district — `specs/flow.md`), played on the milestone. |

---

## 4. Audio — `sfx-synth` + `music` (played via Web Audio)

Per the environment constraint above: **SFX from `sfx-synth`**, **music from `music` with
synth-waveform tracks**. Loaded page-relative, decoded with `decodeAudioData`, played on
events; **no autostart before a gesture**, **mute** toggle provided (`src/audio.ts`,
`specs/assets.md`, `specs/flow.md`).

| Output path | Tool | Palette/character | Description |
| --- | --- | --- | --- |
| `assets/audio/build.wav` | sfx-synth | short, dry | Build/place cue — a stamp/thunk when the player lays a road, tile, or building. |
| `assets/audio/chime.wav` | sfx-synth | bright, brief | Notification chime — a milestone or a completed development. |
| `assets/audio/alert.wav` | sfx-synth | tense, rasp | Alert — budget or utility trouble (losing money, near debt limit, network over-drawn). |
| `assets/audio/hum.wav` | sfx-synth | soft, loopable | Ambient city hum bed, looped quietly under the city. |
| `assets/audio/music.wav` (+ `assets/audio/music.mid`) | music | calm, warm, low-key | Slow ambient city music loop (synth-waveform tracks: e.g. a `sine` pad + `triangle` bass + sparse `saw` motif). Play the `.wav`; keep the `.mid` companion. |

---

## 5. What is NOT produced (drawn in code, `specs/assets.md`)

There is no `ui`/`paint`/`texture` tool, so all of this is code (canvas), in the
`specs/overview.md` palette — never a produced asset:

- The entire **HUD dashboard** — top-strip vitals, bottom-strip RCI meters, build palette,
  cost readout, tax stepper (only the small icons in §1.5 are produced sprites).
- All **menus, panels, and state screens** — title, how-to-play, pause, bankruptcy.
- The **data overlays** — traffic (per-link load → gridlock), utility (served/unserved),
  land-value — drawn from the computed sim fields. (The pollution *haze* is the produced
  §3 particle system; the toggleable analytic overlay tinting tiles is code.)
- **Selection & tool feedback** — zone/road/rail/utility previews, drag rectangle, hovered-
  tile cursor, illegal-placement refusal, cost readout.
- The **empty zoned lot** tile, and the logic that spawns/scales the produced haze from the
  tile pollution field.
