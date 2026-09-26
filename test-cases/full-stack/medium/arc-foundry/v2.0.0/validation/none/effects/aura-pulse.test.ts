// Arc Foundry — effects/aura-pulse: a structure carrying an aura is marked by one.
//
// THE REQUIREMENT, from `specs/assets.md`: the aura pulse is spawned while "a
// structure carrying an aura stands on the yard", it carries "a slow pulse ring at
// the source, marking the aura it projects", and it is spawned "at the position of
// the event that raised it: ... the aura pulse at its source". `specs/components.md`
// gives the aura to the Regulator, which "never fires: it has no range, no damage,
// no firing head, no projectile, and no targeting priority, and its aura is its
// whole reach".
//
// THE READING IS A COMPARISON, BECAUSE THE PULSE IS NOT AN EVENT. Every other
// effect has a frame it is raised on and a frame before it; this one is played the
// whole time the source stands. So the same anchor is stood on twice, once by a
// Regulator and once by a Capacitor of the same tier, and the ground around it read
// both times. A Capacitor carries no aura (`specs/components.md` gives the aura to
// the Regulator alone), so what the two readings differ by is the mark on the aura
// source.
//
// WHAT IS READ, AND WHY IT IS OUTSIDE THE FOOTPRINT. `specs/assets.md` also gives
// the Regulator a cycle at `components/regulator/fire/`, "the Regulator's slow aura
// pulse, played as a loop rather than on a shot" — which is drawn on the mount, a
// `40 x 40` sprite on a `2` by `2` footprint. Reading inside the footprint would
// therefore read that cycle rather than the pulse the aura projects, and pass a
// build that animated the mount and marked nothing. So the band sampled starts
// outside the footprint.
//
// AND WHY IT IS READ AS A SET OF BANDS ACROSS THE WHOLE AURA. What the pulse marks
// is "the aura it projects", and `specs/components.md` fixes that reach:
// `REGULATOR_AURA` gives a Scrap Regulator a radius of `90`. Where inside that
// reach the mark is drawn is the build's — a ring travelling out to `90` and
// fading at the edge marks the aura exactly as one filling the disc near the
// source does, and nothing in `specs/assets.md` chooses between them. So the
// ground from outside the footprint out to the radius is read as concentric
// bands, and what is asked is that SOME band move more under the Regulator than
// under the Capacitor. One band across the whole reach would ask for a build that
// marks it everywhere; a band stopping short of the radius would ask for one of
// the two builds above by name. Reading the bands apart also keeps a build free
// to animate the ground out at the reach for reasons of its own: such a band is
// the same under both structures and simply decides nothing, where folded into
// one reading it would swallow the band that does.
//
// AND WHY THE WINDOW IS LONG. The item is "a SLOW pulse ring", and nothing fixes
// its period. A window of a fifth of a second is shorter than the gap between two
// pulses of any pulse a reader would call slow, so it reads a conforming build as
// a still one; the window below is long enough to hold a pulse and the wait for
// it. It is one window each for the Regulator and for the Capacitor, so the two
// readings stay the comparison the point is.

//
// AND BOTH POSES ARE LET SETTLE FIRST. `specs/assets.md` spawns the build spark
// "at the stamped footprint" when "a rock lands", so the ground around a
// structure that has JUST been stood up is ground with an effect playing on it —
// under both poses, which turns the comparison into a race between two copies of
// the same spark. Each structure is therefore left standing until that has
// finished before its window is read, so what the two windows hold is the
// standing state of each: a Regulator projecting an aura, and a Capacitor
// projecting none.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { REGULATOR_AURA, structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  openYard,
  standComponent,
  ticks,
  type Harness,
} from "../harness";
import { annulus, motionEach } from "./region";

/** One window, in seconds of simulation: long enough to hold a slow pulse. */
const WINDOW_SECONDS = 1.5;

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 24, row: 17 };

/** Outside the `2` by `2` footprint, out to the Scrap aura radius of `90`. */
const BANDS = 4;
const INSIDE = 26;
const REACH = REGULATOR_AURA[0]!.radius;
const REGIONS = Array.from({ length: BANDS }, (_unused, i) =>
  annulus(
    structureCenter(ANCHOR.col, ANCHOR.row),
    INSIDE + ((REACH - INSIDE) * i) / BANDS,
    INSIDE + ((REACH - INSIDE) * (i + 1)) / BANDS,
    4,
  ),
);

const WINDOW = ticks(WINDOW_SECONDS);

/** How long each structure stands before its window is read. */
const SETTLE = ticks(1.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the ground around a Regulator and not around a Capacitor", async () => {
  await openYard(h, { wave: 1 });

  // The control first: a firing component of the same tier at the same anchor,
  // with nothing in range so it never fires.
  await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  await h.advance(SETTLE);
  const unmarked = await motionEach(h, REGIONS, WINDOW);

  await emptyYard(h);
  const marked = await captureReplay(h, "aura", async () => {
    await standComponent(h, "regulator", 1, ANCHOR.col, ANCHOR.row);
    await h.advance(SETTLE);
    return motionEach(h, REGIONS, WINDOW);
  });

  const rose = marked.some((frames, at) => frames > unmarked[at]!);
  assertEqual(
    rose,
    true,
    "whether any band of the ground a Scrap Regulator's aura reaches changed " +
      "on more frames under it than under a Capacitor standing at the same " +
      "anchor, so the aura it projects is marked (specs/assets.md); the " +
      `Capacitor's bands read ${unmarked.join(", ")} of ${WINDOW} frames and ` +
      `the Regulator's read ${marked.join(", ")}`,
  );
});
