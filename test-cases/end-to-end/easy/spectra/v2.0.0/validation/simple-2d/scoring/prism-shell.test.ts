// scoring/prism-shell — a Prism's shell pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Prism's shell, in any phase" pays
// `SCORE_PRISM_SHELL` (`100`). specs/drones.md fixes what breaking the shell IS: a
// Prism wears "an outer shell of one band around an inner core of the other", the
// shell is the exposed layer while it stands, it falls to "a shot whose effective
// band matches the shell's", and "Breaking the shell leaves the Prism alive with
// its core exposed". So this point reads the score after ONE layer fell, with the
// Prism still standing.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `100` tells four models apart: a
// build that pays a broken shell nothing reads `0`; one that pays the core's
// figure for whatever layer it hit reads `400`; one that destroys the whole Prism
// on the first matching shot reads `500`, and leaves no Prism, which the
// precondition below names; and a build that has it right reads `100`.
//
// THE PRISM IS POSED WITH ITS SHELL INTACT AND NOTHING ELSE MOVING. `poseDrone`
// leaves every faculty off, so the Prism holds its centre and its phase while the
// bullet climbs, and the shot carries the shell's own band — the plain matching
// case specs/bands.md states. A Prism "can be broken while it rests in the
// formation, not only while it dives", and the figure is paid "in any phase", so
// the resting phase is the quietest place to read it.
//
// WHY A BYSTANDER STANDS IN THE CORNER. This shot leaves the Prism alive, so the
// wave still holds a drone either way — but the bystander costs nothing and keeps
// this check posed exactly like its neighbours, whose kills do empty the field.
// {@link poseBystander} states the reason in full.
//
// WHAT THIS DOES NOT DECIDE. That a shot of the shell's band breaks the shell is
// `bands`'s and `drones`'s, and it is read here as the precondition of a payment.
// What the exposed CORE pays is `scoring/prism-core`.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PRISM_HALF,
  SCORE_PRISM_SHELL,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  SHOT_GAP,
  captureStill,
  createHarness,
  droneOf,
  fireAt,
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

/**
 * The shell's stored band, which is also the band the shot carries.
 *
 * The core beneath it is therefore magenta: specs/drones.md makes the core's band
 * always the opposite of the shell's.
 */
const SHELL_BAND = "cyan" as const;

/**
 * How far below the Prism the shot starts: the harness's own {@link SHOT_GAP}.
 *
 * Geometry, not a tolerance. `SHOT_GAP` (`60`) clears the contact circle a Prism
 * at its full footprint makes with a bullet — `PRISM_HALF` (`28`) plus
 * `PLAYER_BULLET_HALF` (`6`) is `34` — so the bullet is in flight rather than
 * already in contact when it is placed.
 */
const CLEARANCE = SHOT_GAP - (PRISM_HALF + PLAYER_BULLET_HALF);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly SCORE_PRISM_SHELL when a Prism's shell is broken", async () => {
  startPosed(h);
  poseBystander(h);
  const target = poseDrone(h, "prism", TARGET_AT.x, TARGET_AT.y, {
    band: SHELL_BAND,
    shell: true,
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    droneOf(before, target).shellAlive,
    true,
    "precondition: the Prism's shell stands before the shot",
  );

  await fireAt(h, TARGET_AT.x, TARGET_AT.y, SHELL_BAND, SHOT_GAP);

  // The score the broken shell paid, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
  const struck = droneOf(after, target);
  assertEqual(
    struck.shellAlive,
    false,
    `precondition: the ${SHELL_BAND} shot broke the ${SHELL_BAND} shell, ` +
      `having started ${CLEARANCE} units clear of its contact circle, and left ` +
      "the Prism alive with its core exposed (specs/drones.md)",
  );
  assertEqual(
    after.score,
    SCORE_PRISM_SHELL,
    "the score after a Prism's shell was broken (specs/scoring.md: a Prism's " +
      `shell, in any phase, pays SCORE_PRISM_SHELL, ${SCORE_PRISM_SHELL})`,
  );
});
