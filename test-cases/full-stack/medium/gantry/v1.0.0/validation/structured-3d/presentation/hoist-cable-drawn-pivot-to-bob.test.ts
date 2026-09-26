// presentation/hoist-cable-drawn-pivot-to-bob — the hoist cable is drawn as the
// line from the pivot to the bob.
//
// `specs/overview.md` § Visual design: "An attached load VISIBLY HANGS FROM THE
// HOOK ON ITS CABLE …", and `specs/rigging.md` fixes the two ends: the cable runs
// from the pivot — the point it hangs from — to the bob at its end. Both are the
// run's own readings, `run.pivot` and `run.bob.pos` (`specs/state.md`).
//
// THE READING IS THE LENGTH AND THE MIDDLE. `specs/instrumentation.md` leaves a
// build to report a thing drawn along a line either as the box its two ends span
// or as the cross-section and length it was drawn with, and says that NEITHER
// CARRIES THE DIRECTION THE LINE LEANS IN — `yaw` turns a thing about the
// vertical and says nothing about a lean. What it fixes is the two figures the
// two conventions agree on: the extent's own length, and the middle of the two
// points a bar between them is drawn at. A cable drawn from the pivot to the bob
// is exactly that long and hangs exactly there, so the pair says it was drawn
// between the right two points without fixing how thick a build draws it, what it
// draws it in, or which of the two ways it writes the extent down.
//
// WHICH LEAVES THE DIRECTION UNREAD, and it is unread because the entry does not
// carry it: a cable of the right length about the right middle, drawn at some
// other angle through it, answers this the same way. Nothing in the account tells
// the two apart, so nothing here pretends to — what a build owes the reading is
// the length and the middle, and that is what is asserted.
//
// THE BOB IS PUT WELL OFF THE PIVOT'S VERTICAL, so the middle is somewhere a
// build could only draw the cable by drawing it between the two: an entry
// reported at either END of a two-unit cable is a whole unit from the middle,
// which the tolerance below is well short of.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertTrue } from "../assert";
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

/**
 * How far the drawn cable may fall from the line it stands for.
 *
 * An absolute span in world units, and generous against any profile a build
 * gives the cable: the extent of a bar drawn with a cross-section is longer than
 * the bare line by less than its own thickness, and the bob below sits two units
 * off the pivot, so this is far short of telling the two ends apart.
 */
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
  const drawn = cables[0]!;
  const length = Math.hypot(
    run.bob.pos.x - run.pivot.x,
    run.bob.pos.y - run.pivot.y,
    run.bob.pos.z - run.pivot.z,
  );
  assertClose(
    Math.hypot(drawn.size[0]!, drawn.size[1]!, drawn.size[2]!),
    length,
    TOLERANCE,
    "the length of the extent the cable reports covering, against the " +
      "pivot-to-bob distance (specs/rigging.md)",
  );
  const axes = ["x", "y", "z"] as const;
  const middle = {
    x: (run.bob.pos.x + run.pivot.x) / 2,
    y: (run.bob.pos.y + run.pivot.y) / 2,
    z: (run.bob.pos.z + run.pivot.z) / 2,
  };
  for (const axis of axes) {
    assertClose(
      drawn[axis],
      middle[axis],
      TOLERANCE,
      `the cable's drawn ${axis} against the middle of the pivot and the bob ` +
        "(specs/rigging.md)",
    );
  }
});
