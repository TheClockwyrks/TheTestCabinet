# Showcase capture driver

`capture.mjs` (re)records everything in `showcase/base/` — the leading
`gameplay.webm` and the three stills — from `references/none`, playing a REAL
take of site 3, **Over the Wall**.

Gantry is a 3D WebGL game, so the leading entry has to be **video**. A
draw-command recording carries a build's flat readout layer and nothing of the
yard: no crane, no load, no member coloring, none of the swing — which is the
whole of what this case is. Playwright records the page natively, and
`gameplay.webm` is cut out of that recording.

## Why site 3

Six sites, and the clip has to be one of them.

| Site | Lift | Run clock |
| --- | --- | --- |
| 1 First Lift | one crate, a quarter turn, no obstacle | 16.6 s |
| 2 Turnabout | two crates straight across | ~55 s (par) |
| **3 Over the Wall** | **one crate up, over an 8-high wall, and down** | **37.9 s** |
| 4 Long Reach | a heavy container far out, turned a quarter | ~47 s (par) |
| 5 High Shelf | a container onto a platform, then a crate | 95.9 s |
| 6 Heavy Haul | the game's heaviest load, then a light crate | ~107 s (par) |

Site 1 clears in sixteen and a half seconds and never leaves the ground plane —
too slight to carry a catalog preview. Site 5 is the richest lift in the game
and takes a minute and a half to play, which is twice the length the
[showcase guide](../../../../../../apps/docs/src/content/docs/guides/authoring/authoring-a-case-showcase.md)
asks for and far too long for a stage a visitor watches while deciding whether
to care. Site 3 is thirty-eight seconds, sits inside the guide's twenty-to-forty
band, and is the shortest site whose lift is a *shape* rather than a swing: the
crate is hooked on the far side of a wall it cannot go through, hoisted to the
jib, carried in, slewed a hundred and sixty degrees around the tower, and
lowered onto its pad. Its crane is a real tower crane — an 87-member truss with
a ring ten units up and two counterweights — rather than the four-legged stub
site 1 clears with.

## Running it

The reference build is a static site and the driver serves it, so the only
preparation is a build:

```sh
cd test-cases/full-stack/medium/gantry/v1.0.0/references/none
npm ci
npm run build          # writes dist/
node ../../showcase/capture/capture.mjs
```

It writes straight into `showcase/base/`. Point it somewhere else while
auditioning:

```sh
GANTRY_SHOWCASE_OUT=/tmp/gantry-showcase \
  node ../../showcase/capture/capture.mjs
```

`playwright` is a dev dependency of the reference workspace, which is why the
driver is run from there; it resolves the package out of that workspace itself,
so it does not matter what directory you are standing in. It also needs
`ffmpeg` on the path, for the cut and the VP9 encode.

**On Ubuntu 26.04** Playwright has no browser build of its own yet. Export the
platform override before running, per the repository's `playwright-26.04` skill:

```sh
export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64   # or -x64
```

## What is real, and what is posed

The header of `capture.mjs` states this in full. In short:

**Real**, delivered as browser input events:

- The menus. `Enter` takes SITES off the title screen, `ArrowDown` walks the
  site list to Over the Wall, `Enter` opens it.
- **The whole crane**: 87 members, each two real mouse clicks on the stage, plus
  one click for the slew ring and one for each counterweight, with the tool
  chosen by its real digit key first. `__gantry.project(x, y, z)` is a reading —
  it answers where a lattice node is *drawn* — so the driver clicks at that
  point, and reads `snapshot().pick` back to confirm the game picked the node it
  aimed at before it presses. Every edit passes the rules a player's click
  passes; the run refuses to continue if the yard did not take one.
- The static check, `C`, which is what colors the standing structure in
  `the-crane.png`.
- `G`, which starts the run.
- The orbit during the run: one real press-and-drag on the stage, moved a few
  pixels at a time so the yard turns slowly while the load travels.
- `REPLAY` on the results screen, taken with `ArrowDown` and `Enter`.

**Posed** through `window.__gantry`, and only these:

1. **The tape.** `clearProgram`, `addMoveStep`, `addCommand` and `addActionStep`
   append the site's reference program. `specs/controls.md` fixes what a player
   can *do* with the tape and leaves the widgets to the build — "the exact
   widgets are the build's design" — so clicking rows would be a script written
   against one build's layout rather than against the game, and the showcase is
   not about the editor. This is the one thing in the take that stands in for a
   player's own gesture. It poses an **input**; what the tape then does to the
   crane is entirely the simulation's.
2. `setCleared` on sites 1 and 2. Sites unlock in order; this stands for a
   player who has already cleared them and touches nothing that is on screen.
3. `setCamera`, twice, before the run starts — one pose for the build, one for
   the lift. The default camera frames the whole build envelope, which leaves a
   crane small. Once the run is running the camera moves only under the real
   drag.

Nothing is posed mid-play: `setAxis`, `setAxisRate`, `setBob`,
`setBobVelocity`, `setLoadPose`, `setLoadPhase` and `setSpeedIndex` are never
called. The run plays at watch speed 1 — the driver never touches `S` — and
every swing, every member color and the clear at the end are the simulation's.

## The two passes

The take is the crane and the tape, and the run advances on its fixed tick at
any frame rate. So the take is played twice, once on the wall clock and once
off it, and the stills are taken at the ticks the video's camera track marks.

- **Pass 1, the video.** Wall-clock play with Playwright's recorder on. The
  camera pose is sampled as the run goes, so a still can be framed exactly as
  the video framed that moment. Chromium's software GL presents this scene at
  around thirty frames a second here, and the build's frame loop is a fixed-tick
  accumulator, so the run takes the same wall-clock time it takes on the run
  clock — 38 s against 37.92 s on the take that was committed.
- **Pass 2, the stills.** The same crane, built by the same clicks, and the same
  tape, replayed off the wall clock with the surface's own clock —
  `setAutoStep(false)` and `advance`, which exist only under the engineless
  engine because nothing outside such a build owns its loop. Stepping tick by
  tick is what lets a still land on an exact tick rather than near one.

Pass 2 first scouts the whole run tick by tick — utilization, the hook, the
bob — and the still ticks are read off that scout rather than written down:

| Still | Tick it is taken at |
| --- | --- |
| `the-crane.png` | the build screen after `C`, before the run |
| `over-the-wall.png` | the tick the hardest-worked member works hardest with the load on the hook |
| `setting-down.png` | the last tick the load is still `SET_DOWN_PAD_GAP` short of its pad |

## The knobs

| Variable | Default | Does |
| --- | --- | --- |
| `GANTRY_SHOWCASE_OUT` | `showcase/base` | Where the media is written. |
| `GANTRY_SHOWCASE_SITE` | `3` | Which site is captured. |
| `GANTRY_SHOWCASE_WORK` | `$TMPDIR/gantry-showcase` | Scratch for the raw recording. Never inside the version directory. |
| `GANTRY_SHOWCASE_QA` | unset | `1` writes a frame a second of the run to the work directory, for eyeballing a take. |
| `GANTRY_SHOWCASE_BUILD_YAW` / `_PITCH` / `_DIST` | `300` / `21` / `29` | The build framing. The yaw is a starting point: the driver searches outward from it for one every lattice node can be clicked from unambiguously (see below) and reports what it settled on. |
| `GANTRY_SHOWCASE_RUN_YAW` / `_PITCH` / `_DIST` | `62` / `22` / `31` | The framing the run is watched from, before the drag starts turning it. The distance is set by the crane's height, not the load's size: pulled in closer the mast head and the jib's tie cables leave the top of the frame, and a tower crane with its head cut off is not what a reader came to see. |
| `GANTRY_SHOWCASE_SET_DOWN_GAP` | `4.5` | How far short of its pad the load still is in `setting-down.png`, in world units along the ground. The camera looks down the line the trolley carries the load in on, so a load close to its pad is drawn on top of it; back this off and the pad stays lit in the clear beside the crate. |

## Two things that will bite a re-run

**The yaw decides whether a click is unambiguous.** A click picks the nearest
lattice node within `NODE_PICK_PX` (20) of it, and the driver aims at the node's
own projected position — distance zero — so it wins against anything not drawn
on top of it. But on an axis-aligned lattice the obvious yaws stack nodes onto
one ray: at yaw 45 every node two along in `x` and two along in `z` projects to
the same point, and which one a click takes is then a tie rule rather than the
aim. So the driver measures, at the build camera, how near the nearest *other*
lattice node comes to each node it must click, refuses to work below a couple of
pixels, and searches the yaw outward from the one asked for until it finds one
that clears. It prints the pose and the margin it found.

**The stage has to be 1:1 with the page.** The build fits its fixed 1280×720
logical stage into the window itself, with a uniform scale and letterbox bars,
and `project` answers in stage units. The driver runs a 1280×720 viewport at
device pixel ratio 1 so the two coincide and a projected point can be clicked
directly; it asserts the canvas rect before it clicks anything, rather than
silently building a different crane.
