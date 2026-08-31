// audio/field-bounce-cue — the field-bounce cue sounds once, on the tick a
// ball reflects off the containment field, and on no tick before it.
//
// specs/field.md: "In a tick where a ball's center radius moves from below
// `472` to `472` or above with outward radial velocity (`v . n > 0`), the ball
// reflects off the containment field. The reflection is a face contact
// resolved by the reflection pipeline in `specs/deflector-and-ball.md`, it
// plays the `field-bounce` cue, and it spawns the impact spark particle system
// at the contact." specs/assets.md ties the produced file to exactly that
// event: "The event each cue plays on is fixed in the file that specifies the
// event"; "play a cue on its event". One event, one play, on the event's own
// tick; the ticks of plain outward flight before it belong to no event.
//
// THE DRIVE PROVES IT REACHED THE EVENT. The cue is read against the
// reflection the snapshot shows: still outbound after the lead ticks, still
// below the contact radius, then radially inbound after the crossing tick.
//
// THE POSE CROSSES STRICTLY. At the wave-1 speed of 240 units per second the
// ball covers 4 units of radius per tick, so from radius 458 it reads 470
// before the crossing tick and 474 after it — no reading lands on the 472
// boundary. The ball flies straight outward at an angle far from the
// deflector, and the emptied rings put nothing in its way.
//
// THE WORLD IS ONE BALL AND THE FIELD. isolate() empties the rings, balls,
// and pods and holds both driver switches, so the containment crossing is the
// only event the drive can resolve.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength, assertLessThan } from "../assert";
import { ballSpeedAtWave, FIELD_CONTACT_RADIUS } from "../constants";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { driveToEvent, radialVelocity, radiusOf } from "./cues";

/** The cue specs/field.md has the containment reflection play. */
const CUE = "field-bounce";

/** Posed start radius: 458 + 4 * 3 = 470 before the crossing tick, 474 after. */
const START_RADIUS = 458;

/** A stage angle far from the deflector's span, with the rings emptied. */
const THETA_DEG = 200;

/** Ticks of plain outward flight before the reflection. */
const LEAD_TICKS = 3;

/** Ticks driven after the reflection, so the clip holds the aftermath. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds field-bounce once, on the tick the reflection resolves", async () => {
  isolate(h);
  spawnBallPolar(h, START_RADIUS, THETA_DEG, ballSpeedAtWave(1));

  const cues = onCue(h);
  const drive = await captureReplay(h, "reflect", () =>
    driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
  );

  // The drive reached the reflection on the crossing tick and not before.
  assertLength(drive.before.balls, 1, "the posed ball after the lead ticks");
  assertGreaterThan(
    radialVelocity(drive.before.balls[0]),
    0,
    "the ball still outbound after the lead ticks",
  );
  assertLessThan(
    radiusOf(drive.before.balls[0]),
    FIELD_CONTACT_RADIUS,
    "the ball still below the contact radius after the lead ticks",
  );
  assertLength(drive.after.balls, 1, "the posed ball after the crossing tick");
  assertLessThan(
    radialVelocity(drive.after.balls[0]),
    0,
    "the ball inbound after the crossing tick: the reflection resolved on it",
  );

  assertLength(
    cuesNamed(drive.quiet, CUE),
    0,
    `${CUE} cues sounded over the ${LEAD_TICKS} ticks of flight before the reflection`,
  );
  assertLength(
    cuesNamed(drive.played, CUE),
    1,
    `${CUE} cues sounded by the end of the tick the reflection resolved on`,
  );
});
