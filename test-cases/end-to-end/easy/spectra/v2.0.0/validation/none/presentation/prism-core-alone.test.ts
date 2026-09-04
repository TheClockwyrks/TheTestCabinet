// Spectra — presentation/prism-core-alone: a broken Prism draws only its core.
//
// `specs/assets.md`: "When the shell is broken, only the core is drawn: the inner
// layer alone, at `PRISM_CORE_SIZE`, so a Prism with its shell intact and one
// with only its core left are told apart at a glance."
// `specs/overview.md`'s legibility table carries the same row, and
// `specs/drones.md` puts the figures beside each other: `PRISM_SIZE` (`56`) with
// the shell standing, `PRISM_CORE_SIZE` (`26`) with only the core left. It is not
// decoration — the two states fall to shots of OPPOSITE bands, so a player who
// cannot see that a shell has broken keeps firing the band that no longer works.
//
// THE READING IS HOW MUCH OF THE SQUARE EACH ONE PAINTS. `specs/overview.md`
// fixes no palette and `specs/assets.md` lets a build lay a glow of its own
// around a body, so what a broken Prism is drawn IN is not a question this point
// may ask. What it may ask is the one thing the specification does fix: the
// broken Prism draws the inner layer ALONE, which is a smaller region. Each Prism
// is read through a square of the whole Prism's own `PRISM_SIZE` (`56`)
// footprint, and the places that moved from a reading of that same square with
// the Prisms gone are counted — see `presentation/reading`. Held against the same
// squares of the same field, so a build's own starfield is in both readings and
// cannot be what was counted.
//
// WHY A SHARE RATHER THAN A FIGURE. The specification fixes the two footprints
// but not how much of either square the art inside it inks, nor how far a build's
// glow reaches, so no absolute count is available to assert. The ratio of the two
// AREAS is: `PRISM_CORE_SIZE` squared over `PRISM_SIZE` squared is `0.22`, so a
// build drawing the inner layer alone paints about a fifth of what the whole
// Prism does, and the ceiling below is set well above that so a build that rings
// its lone core in light still passes.
//
// THE TWO ARE POSED SIDE BY SIDE IN ONE FRAME, both storing cyan — the band
// `prism.png` is seeded in — and both props with every faculty off, so neither
// moves, fires or is drawn into a dive between the pose and the frame that is
// read. Nothing here breaks a shell by shooting it: what a matching shot does to
// a shell is `bands/prism-shell-flips-effective-band`'s question, and this point
// poses the two states directly so that a build whose shot rules are broken still
// has its drawing graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { PRISM_CORE_SIZE, PRISM_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  footprint,
  poseDrone,
  readRegion,
  requireDrone,
  startPosed,
  type Harness,
  type Rgb,
} from "../harness";
import { paintedCount } from "./reading";

/**
 * The most of the whole Prism's painted region a broken one may paint, as a
 * share of it.
 *
 * `specs/drones.md` draws the two at `PRISM_SIZE` (`56`) and `PRISM_CORE_SIZE`
 * (`26`), whose areas stand at `(26/56)^2 = 0.22`, so the inner layer alone is
 * about a fifth of the whole. `0.6` is nearly three times that — room for a build
 * that lays a wide glow around its lone core, or inks the core densely and the
 * shell sparsely — and still far below the `1.0` a build that draws the same
 * picture for both states scores.
 */
const MAX_CORE_SHARE = 0.6;

/** The row the two stand on: inside the play field, clear of the ship's lane. */
const ROW_Y = 400;

/**
 * Where the two stand, `440` units apart — nearly eight whole Prisms — so no glow
 * a build lays around one can reach the square the other is read through.
 */
const WHOLE_X = 420;
const BROKEN_X = 860;

/**
 * The lattice each square is read on, in logical units.
 *
 * One sample per logical unit, which is one device pixel at this harness's own
 * viewport, so a `PRISM_SIZE` (`56`) square is every one of its `3136` pixels and
 * a shell drawn as a thin ring is counted rather than falling between samples.
 */
const READ_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("paints a visibly smaller region for a Prism whose shell is gone", async () => {
  await startPosed(h);
  const whole = await poseDrone(h, "prism", WHOLE_X, ROW_Y, {
    band: "cyan",
    shell: true,
  });
  const broken = await poseDrone(h, "prism", BROKEN_X, ROW_Y, {
    band: "cyan",
    shell: false,
  });
  await h.advance(1);

  // A whole Prism beside a shell-broken one.
  await captureStill(h, "pair");

  const posed = await h.snapshot();
  const read = [
    { id: whole, name: "the whole Prism", shellAlive: true },
    { id: broken, name: "the shell-broken Prism", shellAlive: false },
  ].map(({ id, name, shellAlive }) => {
    const drone = requireDrone(posed, id, name);
    assertEqual(
      drone.shellAlive,
      shellAlive,
      `precondition: ${name} is posed with its outer shell ` +
        `${shellAlive ? "standing" : "gone"} (specs/drones.md)`,
    );
    return { name, square: footprint(drone.x, drone.y, PRISM_SIZE) };
  });

  const drawn: Rgb[][] = [];
  for (const { square } of read) {
    drawn.push(await readRegion(h, square, READ_STEP));
  }

  // The same two squares of the same field with no Prism on them: the control
  // every place counted above is held against.
  await h.debug.clearDrones();
  await h.advance(1);
  const bare: Rgb[][] = [];
  for (const { square } of read) {
    bare.push(await readRegion(h, square, READ_STEP));
  }

  const wholeCount = paintedCount(bare[0], drawn[0]);
  const brokenCount = paintedCount(bare[1], drawn[1]);
  assertGreaterThan(
    wholeCount,
    0,
    `precondition: the whole Prism painted the PRISM_SIZE (${PRISM_SIZE}) ` +
      `square it stands on at all`,
  );
  assertLessThan(
    brokenCount / wholeCount,
    MAX_CORE_SHARE,
    `the shell-broken Prism to paint less than ${MAX_CORE_SHARE} of what the ` +
      `whole one paints inside the same PRISM_SIZE (${PRISM_SIZE}) square ` +
      `(specs/assets.md: when the shell is broken, only the core is drawn — ` +
      `the inner layer alone, at PRISM_CORE_SIZE (${PRISM_CORE_SIZE})); it ` +
      `painted ${brokenCount} places against the whole Prism's ${wholeCount}`,
  );
});
