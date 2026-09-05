# Orrery

A machine-building puzzle for the browser, played on a dark hex field under a
celestial fiction. A challenge names reagents and products — constellations of
motes, from bare stardust and the four essences up the planetary ladder from
Saturn to Sol. You engrave sigils on the field, stand brass arms over them,
write each arm a looping tape of instructions, and set the machine turning.
Rises deliver reagents, arms grab and swing whole constellations, sigils bind,
wane, mirror, ascend, conjoin, eclipse and disperse whatever rests on them, and
sets consume the finished constellations until every product has been delivered
six times.

A finished machine is scored three ways at once — on cost, on cycles, and on
the area of field it touched — and the game keeps a per-challenge record of the
best of each, so one challenge has cheap answers, fast answers, and compact
answers. The other pressure is physical: every arm moves at once, carried motes
sweep real arcs across the field, and two motes coming too close at any of the
cycle's sample points halt the machine on the spot.

There are two ways to play, both reached from the title menu. **Extras** is a
fixed shelf of ten standalone challenges, all open from the start. **Campaign**
is a course of thirteen hand-designed challenges worked through in order, each
unlocked by the one before it: it teaches the machine one idea at a time, from a
single arm carrying a single mote up to a turning zodiac wheel feeding four
essences into one quintessence.

This build runs on the **Simple 2D** engine (`@clockwyrks/simple-2d`), which
owns the frame loop and the delta time, the letterboxed fit of the fixed
1280 × 720 logical stage, the input actions and the pointer, the audio cue bus,
the asset loader, and the diagnostics overlay. The game owns everything else:
the state it holds by value, the simulation, the editor, the drawing, the debug
and automation surface it returns beside its state, and the art and the sound it
plays, which it produces itself.

## Running it

```sh
npm ci        # install the dependencies
npm run dev   # serve the game with hot reload
```

`npm run dev` prints a local URL; open it and the game starts on the title
screen.

## Building the static site

```sh
npm ci
npm run build     # type-checks, then emits the static site into dist/
npm run preview   # serves dist/ for a final check
```

`dist/` is complete and self-contained: every URL it emits is page-relative, so
it runs from the root of a static host and from a sub-path alike, and it fetches
nothing from outside itself. The build never invokes an asset-generation tool —
the produced files under `assets/` are committed, and the build only bundles
them.

## The checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run --coverage
```

The unit tests live beside the sources as `src/**/*.test.ts` and run in Node,
with no browser: `src/engine.test.ts` stands a real engine up over an
`@napi-rs/canvas` canvas and a surface of its own, dispatches keyboard and
pointer events at it, and steps it a counted number of frames.

## The reference solutions

Every challenge in the build — the ten Extras and the thirteen of the campaign
course — ships a machine that solves it. They live in `src/solutions.ts` in the
solution format of `specs/formats.md`, and they are reachable only through the
debug surface, which `initialize` returns beside the state and the engine hands
back from `engine.debug`. Every operation is written in the shape of `update` —
a pose takes the current state and returns the next — so a caller drives one
through `engine.apply`:

```js
const solution = engine.debug.referenceSolution(engine.state, "campaign", 12);
engine.apply((s) => engine.debug.openChallenge(s, "campaign", 12));
engine.apply((s) => engine.debug.loadSolution(s, solution));
engine.apply((s) => engine.debug.startRun(s));
await engine.advance(600);
```

`src/solutions.test.ts` runs all twenty-three end to end: it opens each
challenge, loads its reference solution through the surface, steps whole cycles
until the run stops, and asserts that it completed without faulting inside the
600 cycles `specs/modes/campaign.md` allows. The `cost`, `cycles` and `area`
each machine records are asserted too, so a change in the simulation that leaves
a run still completing but spending differently is a red test naming the
challenge it moved.

## The art and the sound

Orrery ships no third-party art and no third-party audio. The fifteen mote
sprites, the two filament strips, the twelve engraved sigils, the ten
instruction glyphs, the machine's hubs, grippers, wheel and mount, the two
six-frame aperture sheets, the three particle systems, the six cues and the
music bed were all produced with the asset-generation tools during this build
and committed under `assets/`. `ASSET-LAYOUT.md` maps every file: where it
lands, its realized size, count and duration, which script produces it, and the
loader key it is consumed under. The build bundles the committed files and never
invokes a tool, so the project builds wherever the tools are absent.

Regenerating them, when the tools are on the `PATH`:

```sh
bash scripts/gen-sprites.sh    # 45 sprites + 2 sheets (draw, draw-sheet)
bash scripts/gen-fx.sh         # deliver, fault, complete (particle-2d)
bash scripts/gen-audio.sh      # the six cues and the bed (sfx-sample, sfx-synth, music)
```

`gen-audio.sh` reads the baked sample pack and instrument bank through
`TCAB_SAMPLE_PACK_DIR` and `TCAB_INSTRUMENT_BANK_DIR`.

## Controls

The editor is worked with the pointer and the keyboard together, and every
menu is worked from the keyboard, from a pointer, and from touch alike: a
mouse, a pen and a finger all reach the game the same way.

### Everywhere

| Key | Does |
| --- | --- |
| `M` | Mutes and unmutes the sound. |
| `` ` `` | Shows and hides the engine's diagnostics overlay. |

### Menus and the challenge lists

| Input | Does |
| --- | --- |
| `↑` `↓` | Moves the highlight. |
| `←` `→` | Turns the how-to's pages. |
| `Enter` | Takes the highlighted item. |
| `Esc` | Leaves the screen. |
| Pointer or touch | Moving onto an item highlights it; pressing and releasing inside one takes it. |

### The editor, while you are building

| Input | Does |
| --- | --- |
| Pointer | Drags a part out of the tray onto the field, moves a placed part, lays a track hex by hex, and points the tape cursor. |
| `Q` `E` | Turns the selected or dragged part one step. |
| `W` `S` | Lengthens and shortens the selected or dragged arm. |
| `X` | Removes the selected part. |
| `U` `I` | Undo and redo. |
| `Space` | Starts the run. |
| `N` | Starts the run paused, one cycle at a time. |
| `Esc` | Returns to the challenge list. |

### The editor, with the tape panel focused

A press inside the tape panel focuses it; a press anywhere else on the editor
returns the focus to the field.

| Key | Writes at the cursor |
| --- | --- |
| `G` `V` | `grab`, `drop` |
| `A` `D` | `rotate-ccw`, `rotate-cw` |
| `Z` `C` | `pivot-ccw`, `pivot-cw` |
| `W` `S` | `extend`, `retract` |
| `T` `B` | `advance`, `recede` |
| `Delete` | A blank cell. |
| `Backspace` | Blanks the cell before the cursor. |
| `R` | The `reset` macro: the run of instructions that returns the arm to its rest pose. |
| `Y` | The `repeat` macro: a copy of the tape up to the cursor. |
| `↑` `↓` `←` `→` | Moves the cursor between rows and cells. |

### While a machine is running

| Key | Does |
| --- | --- |
| `Space` | Pauses and resumes. |
| `N` | Runs one more cycle and pauses. |
| `,` `.` | Slows down and speeds up. |
| `Esc` | Stops the run and returns to editing. |
