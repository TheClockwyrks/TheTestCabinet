// Spectra — scoring/prism-core: a Prism's exposed core pays its figure.
//
// THE RULE. `specs/scoring.md`'s first table: "A Prism's exposed core, in any
// phase" pays `SCORE_PRISM_CORE` (`400`). `specs/drones.md` fixes what
// destroying it is: with the shell broken the core is the exposed layer, it
// falls to "a shot whose effective band matches the core's" — always the
// opposite of the shell's stored band — and "destroying the exposed core
// destroys the Prism".
//
// THE PRISM IS POSED WITH ITS SHELL ALREADY GONE, WHICH IS WHAT MAKES THE
// READING THE CORE'S ALONE. `setDroneShell(id, false)` is the surface's own
// operation for exactly this (`specs/instrumentation.md`), so the shell's own
// `SCORE_PRISM_SHELL` was never paid and the score this check reads holds one
// payment: the core's. Breaking the shell first and subtracting would fold the
// shell's figure — `scoring/prism-shell`'s point — into this one.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `400` tells the wrong models
// apart: a build that pays one flat Prism figure whichever layer fell reads
// `100`; one that pays the shell and the core together on the last shot reads
// `500`; one that pays a Shard's figure reads `50` or `100`; one that pays
// nothing reads `0`.
//
// THE SHOT CARRIES THE CORE'S BAND. The Prism stores cyan, so with the shell
// broken its exposed layer — and its `effectiveBand`, by `specs/bands.md` — is
// magenta, which the precondition below reads back before the shot is fired. A
// cyan shot here would break nothing, which is `bands`'s point rather than this
// one.
//
// WHAT THIS DOES NOT DECIDE. That the exposed core falls to a shot of its own
// band is `bands`'s and `drones`'s. What the SHELL pays is
// `scoring/prism-shell`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { SCORE_PRISM_CORE } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  requireDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the Prism is posed: a clear stretch of the play field, below the
 * formation grid's lowest row (`332`) and its full sway, above the ship's lane
 * (`SHIP_Y`, `600`).
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/**
 * How far below the Prism the shot starts, in logical units.
 *
 * Clear of the footprint a Prism with only its core left is drawn at —
 * `PRISM_CORE_HALF` (`13`) plus the bullet's `PLAYER_BULLET_HALF` (`6`) is `19`
 * — with room to spare, and short enough to climb into a drone holding still.
 */
const SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("adds exactly SCORE_PRISM_CORE when a Prism's exposed core is destroyed", async () => {
  await startPosed(h);
  // Stored cyan with the shell already gone, so the exposed core is magenta.
  const target = await poseDrone(h, "prism", TARGET_AT.x, TARGET_AT.y, {
    band: "cyan",
    shell: false,
  });

  const before = await h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  const posed = requireDrone(before, target, "the Prism the shot destroys");
  assertEqual(
    posed.shellAlive,
    false,
    "precondition: the Prism's shell is already gone, so its core is the " +
      "exposed layer (specs/drones.md)",
  );
  assertEqual(
    posed.effectiveBand,
    "magenta",
    "precondition: a stored-cyan Prism with its shell broken reads magenta " +
      "(specs/bands.md)",
  );

  await shootDrone(h, target, "magenta", { below: SHOT_BELOW });

  // The score the destroyed core paid, on the frame the shot resolved.
  await captureStill(h, "paid");

  const after = await h.snapshot();
  assertUndefined(
    droneById(after, target),
    "precondition: the magenta shot destroyed the exposed magenta core, and " +
      "with it the Prism (specs/drones.md)",
  );
  assertEqual(
    after.score,
    SCORE_PRISM_CORE,
    `the score after a Prism's exposed core was destroyed (specs/scoring.md: ` +
      `a Prism's exposed core, in any phase, pays SCORE_PRISM_CORE, ` +
      `${SCORE_PRISM_CORE})`,
  );
});
