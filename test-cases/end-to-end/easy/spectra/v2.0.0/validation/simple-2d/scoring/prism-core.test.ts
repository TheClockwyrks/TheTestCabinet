// scoring/prism-core — a Prism's exposed core pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Prism's exposed core, in any phase"
// pays `SCORE_PRISM_CORE` (`400`). specs/drones.md fixes what destroying it IS:
// with the shell broken the core is the exposed layer, it falls to "a shot whose
// effective band matches the core's" — always the opposite of the shell's stored
// band — and "destroying the exposed core destroys the Prism".
//
// THE PRISM IS POSED WITH ITS SHELL ALREADY GONE, WHICH IS WHAT MAKES THE READING
// THE CORE'S ALONE. `setDroneShell(id, false)` is the surface's own operation for
// exactly this (specs/instrumentation.md), so the shell's own `SCORE_PRISM_SHELL`
// was never paid and the score this check reads holds ONE payment: the core's.
// Breaking the shell first and subtracting would fold `scoring/prism-shell`'s
// figure into this point.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `400` tells the wrong models apart:
// a build that pays one flat Prism figure whichever layer fell reads `100`; one
// that pays the shell and the core together on the last shot reads `500`; one that
// pays a Shard's figure reads `50` or `100`; one that pays nothing reads `0`.
//
// THE SHOT CARRIES THE CORE'S BAND. The Prism stores cyan, so with the shell
// broken its exposed layer — and its `effectiveBand`, by specs/bands.md — is
// magenta, which the precondition below reads back before the shot is fired. A
// cyan shot here would break nothing, which is `bands`'s point rather than this
// one.
//
// WHY A BYSTANDER STANDS IN THE CORNER. This shot destroys the Prism.
// {@link poseBystander} states the reason in full: one inert drone standing keeps
// the wave live under either reading of "the last drone of its wave"
// (specs/stages.md), so no `SCORE_STAGE_CLEAR` lands in the number this check
// reads.
//
// WHAT THIS DOES NOT DECIDE. That the exposed core falls to a shot of its own band
// is `bands`'s and `drones`'s. What the SHELL pays is `scoring/prism-shell`.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PRISM_CORE_HALF,
  SCORE_PRISM_CORE,
} from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  SHOT_GAP,
  captureStill,
  createHarness,
  droneOf,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander } from "./wave";

/**
 * Where the Prism is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`slotY(4)`, `332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`),
 * and well clear of the corner the bystander holds.
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/** The shell's stored band, which the Prism keeps once the shell is gone. */
const SHELL_BAND = "cyan" as const;

/** The exposed core's band: always the opposite of the shell's (specs/drones.md). */
const CORE_BAND = "magenta" as const;

/**
 * How far below the Prism the shot starts: the harness's own {@link SHOT_GAP}.
 *
 * Geometry, not a tolerance. `SHOT_GAP` (`60`) clears the contact circle a Prism
 * with only its core left makes with a bullet — `PRISM_CORE_HALF` (`13`) plus
 * `PLAYER_BULLET_HALF` (`6`) is `19` — three times over.
 */
const CLEARANCE = SHOT_GAP - (PRISM_CORE_HALF + PLAYER_BULLET_HALF);

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
  const target = poseDrone(h, "prism", TARGET_AT.x, TARGET_AT.y, {
    band: SHELL_BAND,
    shell: false,
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  const posed = droneOf(before, target);
  assertEqual(
    posed.shellAlive,
    false,
    "precondition: the Prism's shell is already gone, so its core is the " +
      "exposed layer and no SCORE_PRISM_SHELL was ever paid (specs/drones.md)",
  );
  assertEqual(
    posed.effectiveBand,
    CORE_BAND,
    `precondition: a stored-${SHELL_BAND} Prism with its shell broken reads ` +
      `${CORE_BAND} (specs/bands.md)`,
  );

  await fireAt(h, TARGET_AT.x, TARGET_AT.y, CORE_BAND, SHOT_GAP);

  // The score the destroyed core paid, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
  assertNull(
    findDrone(after, target),
    `precondition: the ${CORE_BAND} shot destroyed the exposed ${CORE_BAND} ` +
      `core, and with it the Prism, having started ${CLEARANCE} units clear of ` +
      "its contact circle (specs/drones.md)",
  );
  assertEqual(
    after.score,
    SCORE_PRISM_CORE,
    "the score after a Prism's exposed core was destroyed (specs/scoring.md: " +
      "a Prism's exposed core, in any phase, pays SCORE_PRISM_CORE, " +
      `${SCORE_PRISM_CORE})`,
  );
});
