// Spectra — scoring/prism-shell: a Prism's shell pays its figure.
//
// THE RULE. `specs/scoring.md`'s first table: "A Prism's shell, in any phase"
// pays `SCORE_PRISM_SHELL` (`100`). `specs/drones.md` fixes what breaking the
// shell is: a Prism wears "an outer shell of one band around an inner core of
// the other", the shell is the exposed layer while it stands, it "falls to a
// single matching shot", and "Breaking the shell leaves the Prism alive with its
// core exposed". So this point reads the score after ONE layer fell, with the
// Prism still standing.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `100` tells four models apart: a
// build that pays the shell nothing reads `0`; one that pays the core's figure
// for whatever it hit reads `400`; one that destroys the whole Prism on the first
// matching shot reads `500` (and leaves no Prism, which the precondition below
// catches); and a build that pays the shell figure reads `100`. The failure
// therefore names which model the build implemented.
//
// THE PRISM IS POSED WITH ITS SHELL INTACT AND NOTHING ELSE MOVING. `poseDrone`
// leaves every faculty off, so the Prism holds its centre and its phase while the
// bullet climbs, and the shot carries the shell's own band — the plain matching
// case `specs/bands.md` states. A Prism "can be broken while it rests in the
// formation, not only while it dives" (`specs/drones.md`), and the figure is paid
// "in any phase", so the resting phase is the quietest place to read it.
//
// WHAT THIS DOES NOT DECIDE. That a shot of the shell's band breaks the shell is
// `bands`'s and `drones`'s, and it is read here as the precondition of a payment.
// What the exposed CORE pays is `scoring/prism-core`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_PRISM_SHELL } from "../constants";
import {
  captureStill,
  createHarness,
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
 * Clear of the drone at its full footprint — `PRISM_HALF` (`28`) plus the
 * bullet's `PLAYER_BULLET_HALF` (`6`) is `34` — with room to spare, so the
 * bullet is in flight rather than already in contact.
 */
const SHOT_BELOW = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("adds exactly SCORE_PRISM_SHELL when a Prism's shell is broken", async () => {
  await startPosed(h);
  // A cyan shell, so the core beneath it is magenta (specs/drones.md: the
  // core's band is always the opposite of the shell's).
  const target = await poseDrone(h, "prism", TARGET_AT.x, TARGET_AT.y, {
    band: "cyan",
    shell: true,
  });

  const before = await h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Prism the shot strikes").shellAlive,
    true,
    "precondition: the Prism's shell stands before the shot",
  );

  await shootDrone(h, target, "cyan", { below: SHOT_BELOW });

  // The score the broken shell paid, on the frame the shot resolved.
  await captureStill(h, "paid");

  const after = await h.snapshot();
  const struck = requireDrone(
    after,
    target,
    "the Prism the shot struck; breaking the shell leaves it alive " +
      "(specs/drones.md)",
  );
  assertEqual(
    struck.shellAlive,
    false,
    "precondition: the cyan shot broke the cyan shell (specs/drones.md)",
  );
  assertEqual(
    after.score,
    SCORE_PRISM_SHELL,
    `the score after a Prism's shell was broken (specs/scoring.md: a Prism's ` +
      `shell, in any phase, pays SCORE_PRISM_SHELL, ${SCORE_PRISM_SHELL})`,
  );
});
