// Spectra — presentation/prism-core-alone: a broken Prism draws only its core.
//
// `specs/assets.md`: "When the shell is broken, only the core is drawn: the inner
// layer alone, at `PRISM_CORE_SIZE`, so a Prism with its shell intact and one
// with only its core left are told apart at a glance."
// `specs/drones.md` puts the figures beside each other: `PRISM_SIZE` (`56`) with
// the shell standing, `PRISM_CORE_SIZE` (`26`) with only the core left. It is not
// decoration — the two states fall to shots of OPPOSITE bands, so a player who
// cannot see that a shell has broken keeps firing the band that no longer works.
//
// SO THE READING IS THE DESTINATION BOX, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` the frame issued is captured with the box it drew into, in logical
// stage units, and the box drawn for the shell-broken Prism is held against
// `PRISM_CORE_SIZE`, the one figure the specification fixes for that state. The
// pixels would not do: `specs/overview.md` fixes no palette and `specs/assets.md`
// lets a build lay a glow of its own around a body, so the lit patch a broken
// Prism leaves is wider than its core by however much the build chose — a figure
// the specification does not fix and this point must not demand.
//
// WHICH DRAW IS THE CORE'S. A build is free to blit a halo, a shadow or a
// pre-rendered glow beside the body, so the draw this point is about is the one
// whose source looks most like `prism.png`, among the draws centred within the
// core's own footprint. Whether that source really is the seeded art is
// `presentation/prism-from-sprite`'s question and is not asked again here, and
// the INTACT Prism's `PRISM_SIZE` box is `presentation/drone-scaled-to-footprint`'s.
//
// THE TWO ARE POSED SIDE BY SIDE IN ONE FRAME, both storing cyan — the band
// `prism.png` is seeded in — and both props with every faculty off, so neither
// moves, fires or is drawn into a dive between the pose and the frame that is
// read; the whole Prism stands beside the broken one so the still carries the
// pair a reviewer compares. Nothing here breaks a shell by shooting it: what a
// matching shot does to a shell is `bands/prism-shell-flips-effective-band`'s
// question, and this point poses the two states directly so that a build whose
// shot rules are broken still has its drawing graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, fail } from "../assert";
import { PRISM_CORE_SIZE, SPRITE_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { bestBlit, blitsNear, blitsOfFrame, describeBlits } from "./reading";

/**
 * How far the drawn box may stand from the core's own footprint, as a fraction
 * of it.
 *
 * The same 15% `presentation/drone-scaled-to-footprint` holds every drone's box
 * to, so a `PRISM_CORE_SIZE` (`26`) core may be drawn between `22.1` and `29.9`
 * units across. Wide enough for a build that insets a sprite's transparent
 * border or rounds a box to whole device pixels, and far too narrow to admit the
 * `PRISM_SIZE` (`56`) box a build that kept drawing the whole Prism would issue.
 */
const SCALE_TOLERANCE = 0.15;

/** The row the two stand on: inside the play field, clear of the ship's lane. */
const ROW_Y = 400;

/**
 * Where the two stand, `440` units apart — nearly eight whole Prisms — so no draw
 * a build issues for one can be attributed to the other.
 */
const WHOLE_X = 420;
const BROKEN_X = 860;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a shell-broken Prism into a box the size of its core", async () => {
  startPosed(h);
  const whole = poseDrone(h, "prism", WHOLE_X, ROW_Y, {
    band: "cyan",
    shell: true,
  });
  const broken = poseDrone(h, "prism", BROKEN_X, ROW_Y, {
    band: "cyan",
    shell: false,
  });

  const blits = await blitsOfFrame(h);
  const posed = h.snapshot();

  // A whole Prism beside a shell-broken one.
  captureStill(h, "pair");

  assertEqual(
    droneOf(posed, whole).shellAlive,
    true,
    "precondition: the first Prism is posed with its outer shell standing " +
      "(specs/drones.md)",
  );
  const core = droneOf(posed, broken);
  assertEqual(
    core.shellAlive,
    false,
    "precondition: the second Prism is posed with its outer shell gone " +
      "(specs/drones.md)",
  );

  const at = { x: core.x, y: core.y };
  // Half the core's own footprint: a box whose centre left it is drawn somewhere
  // other than on the Prism (specs/assets.md: centred on its position).
  const near = blitsNear(blits, at, PRISM_CORE_SIZE / 2);
  const drawn = bestBlit(near, "prism");
  if (drawn === undefined) {
    fail(
      `a bitmap blitted within ${PRISM_CORE_SIZE / 2} units of the ` +
        `shell-broken Prism's centre at (${at.x.toFixed(0)}, ` +
        `${at.y.toFixed(0)}) (specs/assets.md: when the shell is broken, only ` +
        `the core is drawn — the inner layer alone, at PRISM_CORE_SIZE)`,
      describeBlits(blitsNear(blits, at, SPRITE_SIZE)),
    );
  }
  const low = PRISM_CORE_SIZE * (1 - SCALE_TOLERANCE);
  const high = PRISM_CORE_SIZE * (1 + SCALE_TOLERANCE);
  const where =
    `the shell-broken Prism drawn PRISM_CORE_SIZE (${PRISM_CORE_SIZE}) units ` +
    `across, within ${SCALE_TOLERANCE * 100}% (specs/assets.md: when the ` +
    `shell is broken, only the core is drawn — the inner layer alone, at ` +
    `PRISM_CORE_SIZE)`;
  assertBetween(drawn.w, low, high, `${where}: the box's width`);
  assertBetween(drawn.h, low, high, `${where}: the box's height`);
});
