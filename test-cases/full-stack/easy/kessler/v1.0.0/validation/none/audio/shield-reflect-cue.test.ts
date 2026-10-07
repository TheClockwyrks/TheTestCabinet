// audio/shield-reflect-cue — the shield-reflect cue sounds once, on the tick
// the shield reflects a ball, and on no tick before it.
//
// specs/pods.md: "While it is active, the first ball in spawn order whose
// center radius moves from `prev_r > 100` to `new_r <= 100` in a tick is
// reflected off the shield ... The reflection plays the `shield-reflect` cue
// and the impact spark particle system at the contact, and the shield
// disappears on it, so one shield reflects one ball." specs/assets.md ties
// the produced file to that event: "play a cue on its event". One reflection,
// one play, on the reflection's own tick; the ticks of plain inward flight
// before it belong to no event.
//
// THE DRIVE PROVES IT REACHED THE EVENT. The cue is read against the
// reflection the snapshot shows: the shield up and the ball inbound after the
// lead ticks, the ball outbound and the shield consumed after the crossing
// tick.
//
// THE POSE CROSSES STRICTLY. At the wave-1 speed of 240 units per second the
// ball covers 4 units of radius per tick, so from radius 118 it reads 102
// before the crossing tick and 98 after it — no reading lands on the 100
// contact boundary. The ball is posed already inside the deflector's contact
// radius, at an angle far from the deflector's span, so the shield crossing
// is the one contact on its way in.
//
// THE WORLD IS ONE BALL AND THE SHIELD. isolate() empties the rings, balls,
// and pods and holds both driver switches; setShield(true) raises the shield
// exactly as catching a shield pod does, without a cue of its own — no pose
// sounds a cue, so everything recorded comes from the drive.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser opens no audio context
// without a user gesture, so armAudio presses a key through Chromium's own
// input pipeline — UNBOUND_KEY, which specs/controls.md binds to nothing, so
// arming disturbs no game state — and waits for the produced files to decode,
// so a cue that sounds can be named from the file it came from.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
import { ballSpeed } from "../constants";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { driveToEvent, radialVelocity } from "./cues";

/** The cue specs/pods.md has the shield reflection play. */
const CUE = "shield-reflect";

/** Posed start radius: 118 - 4 * 4 = 102 before the crossing tick, 98 after. */
const START_RADIUS = 118;

/** A stage angle far from the deflector's span at its start angle of 90. */
const THETA_DEG = 270;

/** Ticks of plain inward flight before the reflection. */
const LEAD_TICKS = 4;

/** Ticks driven after the reflection, so the clip holds the aftermath. */
const TRAIL_TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds shield-reflect once, on the tick the shield reflects", async () => {
  await h.armAudio();
  await isolate(h);
  await h.debug.setShield(true);
  await spawnBallPolar(h, START_RADIUS, THETA_DEG, ballSpeed(1), 180);

  const cues = onCue(h);
  const drive = await captureReplay(h, "reflect", () =>
    driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
  );

  // The drive reached the reflection on the crossing tick and not before.
  assertTrue(
    drive.before.effects.shieldActive,
    "the shield still up after the lead ticks",
  );
  assertLength(drive.before.balls, 1, "the posed ball after the lead ticks");
  assertLessThan(
    radialVelocity(drive.before.balls[0]),
    0,
    "the ball still inbound after the lead ticks",
  );
  assertLength(drive.after.balls, 1, "the posed ball after the crossing tick");
  assertGreaterThan(
    radialVelocity(drive.after.balls[0]),
    0,
    "the ball outbound after the crossing tick: the shield reflected it",
  );
  assertEqual(
    drive.after.effects.shieldActive,
    false,
    "the shield after the crossing tick: consumed by its one reflection",
  );

  assertLength(
    cuesNamed(drive.quiet, CUE),
    0,
    `${CUE} cues sounded over the ${LEAD_TICKS} ticks of flight before the reflection`,
  );
  assertLength(
    cuesNamed(drive.played, CUE),
    1,
    `${CUE} cues sounded by the end of the tick the shield reflected on`,
  );
});
