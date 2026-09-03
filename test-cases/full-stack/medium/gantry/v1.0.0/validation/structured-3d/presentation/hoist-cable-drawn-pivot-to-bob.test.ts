// presentation/hoist-cable-drawn-pivot-to-bob — the hoist cable is drawn as the
// line from the pivot to the bob.
//
// `specs/overview.md` § Visual design: "An attached load VISIBLY HANGS FROM THE
// HOOK ON ITS CABLE …", and `specs/rigging.md` fixes the two ends: the cable runs
// from the pivot — the point it hangs from — to the bob at its end. Both are the
// run's own readings, `run.pivot` and `run.bob.pos` (`specs/state.md`).
//
// THE READING IS THE SPAN. `drawn()` reports the extent a thing covered, and a
// line from the pivot to the bob covers exactly the box between them — so the
// cable's own extent is what says it was drawn between the right two points,
// without fixing how thick a build draws it or what it draws it in.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  entriesOf,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A move that keeps the run running and moves nothing (`specs/rigging.md`). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Where the bob is put, so the cable spans something worth measuring. */
const BOB = { x: 3, y: 4, z: -2 };

/** How far the drawn span may fall from the pivot-to-bob span. */
const TOLERANCE = 0.6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the hoist cable from the pivot to the bob", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.advance(1);

  const { run } = await h.snapshot();
  const cables = entriesOf(await h.drawn(), "cable", "hoist");

  await h.capture("cable", "The hoist cable, pivot to bob");

  assertTrue(cables.length > 0, "a hoist cable among what the frame drew");
  const span: readonly [number, number, number] = [
    Math.abs(run.bob.pos.x - run.pivot.x),
    Math.abs(run.bob.pos.y - run.pivot.y),
    Math.abs(run.bob.pos.z - run.pivot.z),
  ];
  const drawn = cables[0]!.size;
  const axes = ["x", "y", "z"] as const;
  for (let i = 0; i < 3; i += 1) {
    assertCloseTo(
      drawn[i]!,
      span[i]!,
      TOLERANCE,
      `the cable's drawn ${axes[i]} extent against the pivot-to-bob span ` +
        "(specs/rigging.md)",
    );
  }
});
