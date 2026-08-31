// saucer/fires-every-1p6s — the saucer takes one shot every SAUCER_FIRE_INTERVAL.
//
// THE RULE. `specs/saucer.md`, Firing: "Every `SAUCER_FIRE_INTERVAL` (`1.6`
// seconds) on the field, the saucer fires one saucer bullet aimed at the ship's
// current position." `specs/instrumentation.md` has `addSaucer` bring a craft on
// with "its fire clock at `SAUCER_FIRE_INTERVAL`", so the first shot is due one
// whole interval after the pose and the clock is started where the pose is.
//
// WHAT IS READ. The game time each of five rounds first appears on the saucer's
// roster, and the five gaps between them — the first measured from the pose. Each
// is held to `1.6` s within ten percent. Every gap is asserted rather than their
// mean, so a build that fires on the right average with a wandering clock fails on
// the gap that wandered.
//
// TEN PERCENT IS `0.16` s. It is a tolerance on the reading, not room on the
// figure: a round is caught on the tick it joins the roster, which is a
// hundred-and-twentieth of a second, so the allowance is entirely for a build
// whose interval accumulates a tick of drift a shot. It is far short of the gap to
// any other figure in the specification — `1.0` s for the weave, `1.4` s for a
// round's life, `12` s for a visit.
//
// EXACTLY FIVE ROUNDS, and no more. The window driven is five intervals and a
// fifth of one; a build that fires twice as often puts ten rounds into it and
// fails the count rather than sliding through on gaps that happen to be right.
// Five is also inside `SAUCER_LIFETIME` (`12` s), so the visit does not end under
// the reading.
//
// THE MIND AND THE TRAVEL ARE SHUT, as the item states — see `shots.ts`. The gun
// is the requirement; where the craft is and what it decides are not. The velocity
// is posed to rest so the rounds it fires are the plain aimed shots
// `saucer/aims-at-the-ship` reads, though nothing here reads a bearing at all.
//
// A ROUND'S LIFE IS `SAUCER_BULLET_LIFE` (`1.4` s), which is shorter than the
// interval, so at most one is in flight at a time and a fresh id on the roster is
// always a fresh shot.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRE_INTERVAL } from "../../src/constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { collectShots, poseGunner } from "./shots";

/** Where the gunner stands: clear of the star, and clear of the ship. */
const GUN_POSE = { x: 200, y: 120, vx: 0, vy: 0 };

/** How many shots the cadence is read over. */
const SHOTS = 5;

/** The window driven, in seconds: five intervals and a fifth of one. */
const WINDOW = (SHOTS + 0.2) * SAUCER_FIRE_INTERVAL;

/** The ten percent of SAUCER_FIRE_INTERVAL the item allows each gap. */
const TOLERANCE = 0.1 * SAUCER_FIRE_INTERVAL;

let h: Harness;

beforeEach(async () => {
  // The default clock: one tick a frame, so a round is caught on the tick it
  // joins the roster and a gap is read to a hundred-and-twentieth of a second.
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts SAUCER_FIRE_INTERVAL between the pose and each of five shots", async () => {
  startPlaying(h);
  poseGunner(h, GUN_POSE);

  const posedAt = h.snapshot().simTime;
  // One more than the window can hold, so a build that fires twice as often is
  // read as the count it is rather than stopped at five.
  const shots = await collectShots(h, GUN_POSE, SHOTS * 2, ticksFor(WINDOW));
  // Five shots taken on the saucer's cadence.
  captureStill(h, "cadence");

  assertLength(
    shots,
    SHOTS,
    `rounds the saucer fired over ${WINDOW.toFixed(2)} s of game time — one ` +
      `every SAUCER_FIRE_INTERVAL (${SAUCER_FIRE_INTERVAL} s) (specs/saucer.md)`,
  );

  let previous = posedAt;
  for (const [index, shot] of shots.entries()) {
    assertLessThanOrEqual(
      Math.abs(shot.seenAt - previous - SAUCER_FIRE_INTERVAL),
      TOLERANCE,
      `how far gap ${index + 1} between shots (${previous.toFixed(3)} s to ` +
        `${shot.seenAt.toFixed(3)} s of game time) missed SAUCER_FIRE_INTERVAL ` +
        `(${SAUCER_FIRE_INTERVAL} s) by (specs/saucer.md)`,
    );
    previous = shot.seenAt;
  }
});
