// Meltdown — heat/two-phase-resolution: every flow resolves from the frame's opening heats.
//
// specs/heat.md states the rule that every other figure in the group rests on:
// for each frame, with `H_T` the heat each emitter carried WHEN THE FRAME OPENED,
// every term is computed from those heats, and "only when every `dH_T` is known
// are the new heats written". A build that instead resolves tower by tower, each
// reading whatever heats have been written so far, gets a different answer — one
// that depends on the order its roster happens to be in, so two touching guns
// settle somewhere decided by which was placed first.
//
// THE ARRANGEMENT IS BUILT TO SEPARATE THE TWO MODELS BY A WIDE MARGIN. Four Arcs
// in a flush chain, opening at `95`, `5`, `95` and `5`, advanced ONE frame of
// `1/30` s. The alternating gradient means every tower in the chain has a large
// difference across each of its contacts, and the frame is long enough for one
// frame's worth of that flow to be tens of heat points, so a sequential in-place
// resolution diverges from the two-phase answer by between five and nine heat
// points on three of the four towers — more than a hundred times the bound below.
// (The first tower a sequential pass touches agrees with the two-phase answer by
// construction, whichever end it starts from, which is why all four are read: no
// order agrees on more than one of them.)
//
// A `1/30` s FRAME IS A LEGAL FRAME, AND IT IS THE BUILD'S OWN CLOCK THAT CARRIES
// IT. Meltdown mandates no fixed timestep: every rate is per second and
// integrated against the game time the frame hands the game, and this engine's
// runtime is what measures that time. So the frame size is the harness's `Clock`
// and nothing on the debug surface — the check hands the runtime a
// `ConstantClock` of `1/30` s and lets the engine run its own frame, rather than
// asking the game to step itself. The two-phase rule is exactly what makes one
// frame's result independent of how the time was divided.
//
// AND THE EXPECTATION IS THE WHOLE `dH`, NOT A BALANCE OF FLOWS. Each tower's
// observed change is compared against what specs/heat.md's own arithmetic —
// `thermal.ts` beside this file — computes for it from the frame's opening heats,
// with the air term, the conduction term and the mass all in. A weaker check that
// only asked whether the chain's flows balanced would pass a sequential build: it
// is only because the air terms differ from tower to tower, the ends of the chain
// having an extra open radiator face, that the middle tower's loss never equals
// its neighbours' gains in a conformant build either.

import { ConstantClock } from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  sizeOf,
  startRun,
  type Harness,
} from "../harness";
import { towerOf } from "./roster";
import { BOXED_SITE } from "./sites";
import { floorOf, termsFor } from "./thermal";

/** The chain, and the alternating heats it opens with. */
const TOWER = "arc";
const OPENING_HEATS: readonly number[] = [95, 5, 95, 5];

/**
 * The frame the chain is advanced by, in milliseconds.
 *
 * Geometry, not a tolerance: it says how long the one frame is, not how far a
 * build may miss by. A thirtieth of a second is long enough that one frame's
 * worth of the chain's flow is tens of heat points, which is what puts the
 * sequential answer a hundred times the bound away from the two-phase one.
 */
const FRAME_MS = 1000 / 30;
const DT = FRAME_MS / 1000;

/**
 * How close each tower's change must come, as decimal places of a heat point.
 *
 * Two places is `0.005` of a heat point on a scale of `100`. The expectation is
 * the specification's own arithmetic over the heats this check posed, evaluated
 * from the same constants a conformant build evaluates, so agreement is float
 * slack — many orders below this. The bound has to be far smaller than the gap to
 * the wrong model, and it is: a sequential in-place resolution differs by at
 * least five heat points on this chain, a thousand times the bound.
 */
const HEAT_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(FRAME_MS) });
});

afterEach(() => {
  h?.dispose();
});

it("Every flow resolves from the frame's opening heats", async () => {
  startRun(h);
  const ids = OPENING_HEATS.map((heat, index) =>
    poseIdleTower(
      h,
      TOWER,
      BOXED_SITE.col,
      BOXED_SITE.row + index * sizeOf(TOWER),
      0,
      heat,
    ),
  );

  const opened = h.snapshot();
  const chain = floorOf(opened);
  const expected = new Map(
    chain.map((tower) => [tower.id, termsFor(chain, tower.id, DT).delta]),
  );

  await h.advance(1);
  captureStill(h, "chain");
  const resolved = h.snapshot();

  for (const [index, id] of ids.entries()) {
    const before = towerOf(opened, id).heat;
    const after = towerOf(resolved, id).heat;
    assertCloseTo(
      after - before,
      expected.get(id) ?? Number.NaN,
      HEAT_DIGITS,
      `the change one ${FRAME_MS.toFixed(2)}ms frame makes to link ` +
        `${index + 1} of the chain, opening at ${OPENING_HEATS[index]}`,
    );
  }
});
