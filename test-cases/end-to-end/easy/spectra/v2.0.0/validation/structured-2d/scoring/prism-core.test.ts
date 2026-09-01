// scoring/prism-core — a Prism's exposed core pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Prism's exposed core, in any
// phase" pays `SCORE_PRISM_CORE` (`400`). specs/drones.md fixes what destroying
// it is: with the shell broken the core is the exposed layer, it falls to a shot
// whose effective band matches the core's — always the opposite of the shell's
// stored band — and "destroying the exposed core destroys the Prism".
//
// THE PRISM IS POSED WITH ITS SHELL ALREADY GONE, WHICH IS WHAT MAKES THE READING
// THE CORE'S ALONE. `setDroneShell(id, false)` is the surface's own operation for
// exactly this (specs/instrumentation.md), so the shell's own `SCORE_PRISM_SHELL`
// was never paid and the score this check reads holds one payment: the core's.
// Breaking the shell first and subtracting would fold `scoring.prism-shell`'s
// point into this one.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `400` tells the wrong models apart:
// a build that pays one flat Prism figure whichever layer fell reads `100`; one
// that pays the shell and the core together on the last shot reads `500`; one
// that pays a Shard's figure reads `50` or `100`; one that pays nothing reads
// `0`.
//
// THE SHOT CARRIES THE CORE'S BAND. The Prism stores cyan, so with the shell
// broken its exposed layer — and its `effectiveBand`, by specs/bands.md — is
// magenta, which the precondition below reads back before the shot is fired. A
// cyan shot here would break nothing, which is `bands`'s point rather than this
// one.
//
// WHY A BYSTANDER STANDS IN THE CORNER. See `scene.ts`: this shot destroys the
// Prism, so without one the wave could be cleared under the kill and pay
// `SCORE_STAGE_CLEAR` into the number this check reads.
//
// WHAT THIS DOES NOT DECIDE. That the exposed core falls to a shot of its own
// band is `bands`'s and `drones`'s. What the SHELL pays is
// `scoring.prism-shell`.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_PRISM_CORE } from "../../src/constants";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander, requireDrone, shootDrone } from "./scene";

/**
 * Where the Prism is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`), and well
 * clear of the corner the bystander holds.
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/** The shell's stored band. Its core is the opposite (specs/drones.md). */
const SHELL_BAND = "cyan" as const;

/** The band the exposed core reads as, and the band the shot therefore carries. */
const CORE_BAND = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly SCORE_PRISM_CORE when a Prism's exposed core is destroyed", async () => {
  startPosed(h);
  poseBystander(h);
  // Stored cyan with the shell already gone, so the exposed core is magenta.
  const target = poseDrone(h, "prism", TARGET_AT.x, TARGET_AT.y, {
    band: SHELL_BAND,
    shell: false,
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  const posed = requireDrone(before, target, "the Prism the shot destroys, as posed");
  assertEqual(
    posed.shellAlive,
    false,
    "precondition: the Prism's shell is already gone, so its core is the " +
      "exposed layer (specs/drones.md)",
  );
  assertEqual(
    posed.effectiveBand,
    CORE_BAND,
    "precondition: a stored-cyan Prism with its shell broken reads magenta " +
      "(specs/bands.md)",
  );

  await shootDrone(h, target, CORE_BAND);

  // The score the destroyed core paid, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
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
