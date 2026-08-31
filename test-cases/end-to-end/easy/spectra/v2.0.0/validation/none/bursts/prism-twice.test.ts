// Spectra — bursts/prism-twice: a Prism detonates twice.
//
// `specs/assets.md`, the drone-burst's "When" rule, states the Prism's case
// outright: "A Prism struck by bullets starts one when its shell breaks and a
// second when its core is destroyed". `specs/drones.md` fixes what the two shots
// have to be: a Prism wears "an outer shell of one band around an inner core of
// the other", exactly one layer is exposed at a time, and each layer "falls to a
// single matching shot" — so the shell goes to a shot of the shell's band and
// the core, once exposed, to a shot of the opposite one.
//
// THE READING IS THE ROSTER, COUNTED TWICE. One burst after the shell falls, two
// after the core does. Counting at both moments rather than only at the end is
// what tells the three wrong models apart: a build that pops only when the drone
// leaves the field reports `0` then `1`, one that pops only the shell reports
// `1` then `1`, and one that pops the whole Prism on the first shot reports `1`
// then `1` with no Prism left to shoot. Each fails on a different reading, so
// the failure names which model the build implemented.
//
// THE TWO SHOTS ARE THE ONLY THINGS THAT HAPPEN. The Prism is posed with every
// faculty off, holding its centre, so the second shot is aimed where the first
// left it; `BURST_DURATION` (`0.7`) seconds is many times the fifth of a second
// the two shots take together, so the shell's burst is still playing when the
// core's starts and the count of `2` is a count of two LIVE bursts. The
// bystander in the far corner keeps a drone standing, so a build that reads "its
// wave" as the drones on the field does not clear the stage under the second
// shot (see `poseBystander`).
//
// WHAT THIS DOES NOT DECIDE. That a shot of the shell's band breaks the shell
// and one of the core's destroys the core is `bands/prism-shell-flips-effective-band`
// and the Prism's own items, and it is read here as the precondition of each
// pop. What each burst is scaled to is `bursts/scaled-to-drone`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  poseBystander,
  poseDrone,
  requireDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the Prism is posed: a clear stretch of the play field, below the
 * formation grid and its full sway, above the ship's lane, clear of the corner
 * the bystander holds.
 */
const PRISM_AT = { x: 900, y: 460 } as const;

/**
 * How far below the Prism each shot starts, in logical units.
 *
 * The first clears `PRISM_HALF` (`28`) plus the bullet's `PLAYER_BULLET_HALF`
 * (`6`); the second clears the `PRISM_CORE_HALF` (`13`) the Prism is left with
 * once its shell is gone, and is fired from further off than that so it is in
 * flight rather than already in contact.
 */
const SHELL_SHOT_BELOW = 90;
const CORE_SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("starts one burst when the shell breaks and a second when the core dies", async () => {
  await startPosed(h);
  await poseBystander(h);
  // Cyan shell, so its core is magenta (specs/drones.md: the core's band is
  // always the opposite of the shell's).
  const prism = await poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: "cyan",
    shell: true,
  });
  assertLength(
    (await h.snapshot()).bursts,
    0,
    "precondition: no burst is playing yet",
  );

  await shootDrone(h, prism, "cyan", { below: SHELL_SHOT_BELOW });

  const afterShell = await h.snapshot();
  assertEqual(
    requireDrone(afterShell, prism, "the Prism after the shell shot")
      .shellAlive,
    false,
    "precondition: the cyan shot broke the cyan shell (specs/drones.md)",
  );
  assertLength(
    afterShell.bursts,
    1,
    `the bursts playing once the shell broke (specs/assets.md: a Prism struck ` +
      `by bullets starts one when its shell breaks)`,
  );

  await shootDrone(h, prism, "magenta", { below: CORE_SHOT_BELOW });

  // The second burst, beside the first the shell left.
  await captureStill(h, "twice");

  const afterCore = await h.snapshot();
  assertUndefined(
    droneById(afterCore, prism),
    `precondition: the magenta shot destroyed the exposed magenta core ` +
      `(specs/drones.md)`,
  );
  assertLength(
    afterCore.bursts,
    2,
    `the bursts playing once the core was destroyed (specs/assets.md: and a ` +
      `second when its core is destroyed)`,
  );
});
