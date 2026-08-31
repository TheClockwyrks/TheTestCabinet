// audio/target-break-cue — the target-break cue sounds once, on the tick a
// target is destroyed, a pierce destruction included.
//
// specs/rings.md: "A hit that brings them to zero destroys the target: the
// target is removed, the destruction burst particle system spawns at the
// target's arc center as posed that tick, the `target-break` cue plays, the
// ring's destroy score is awarded ... and the salvage pod draw in
// `specs/pods.md` runs." And under pierce, specs/pods.md: "A piercing ball's
// target contact, face or edge, destroys the target outright whatever its hit
// points ... The destruction otherwise resolves exactly as `specs/rings.md`
// states, so it plays its cue and particle." specs/assets.md ties the
// produced file to that event: "play a cue on its event". One destruction,
// one play, on the destruction's own tick.
//
// TWO DRIVES, ONE RULE. The ordinary drive destroys a ring 1 target — 1 hit
// point, so the single face hit is the destroying hit. The pierce drive poses
// the pierce effect and a ring 2 target at its FULL 2 hit points; only a
// piercing contact destroys that outright, so the target vanishing on the
// crossing tick proves the destruction the cue is read against was pierce's.
//
// THE POSES CROSS STRICTLY. At 240 units per second the ball covers 4 units
// of radius per tick: from 336 it reads 324 then 320 across ring 1's outer
// contact radius of 322, and from 406 it reads 394 then 390 across ring 2's
// 392 — no reading lands on a boundary. Each moving ring is posed still and
// each ball aimed at its target arc's center. The pod draw is held off by
// isolate()'s podSpawn switch, so the destruction sheds nothing into the
// world.
//
// THE WORLD IS ONE BALL AND ONE TARGET, per drive, with both driver switches
// held by isolate().
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser opens no audio context
// without a user gesture, so armAudio presses a key through Chromium's own
// input pipeline — UNBOUND_KEY, which specs/controls.md binds to nothing, so
// arming disturbs no game state — and waits for the produced files to decode,
// so a cue that sounds can be named from the file it came from.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertLength, assertUndefined } from "../assert";
import { ballSpeed, PIERCE_TICKS, slotArcCenterDeg } from "../constants";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { driveToEvent, type CueDrive } from "./cues";

/** The cue specs/rings.md has a destruction play. */
const CUE = "target-break";

/** Ticks of plain inward flight before each destroying hit. */
const LEAD_TICKS = 3;

/** Ticks driven after each destruction, so the clips hold the aftermath. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** The posed target of `drive`'s snapshot `which`, or undefined once gone. */
function posedTarget(drive: CueDrive, which: "before" | "after", ring: number) {
  return drive[which].rings[ring - 1].targets.find(
    (target) => target.slot === 0,
  );
}

it("sounds target-break once, on an ordinary and on a pierce destruction", async () => {
  await h.armAudio();

  // The ordinary destruction: ring 1 holds 1 hit point, one face hit destroys.
  await isolate(h);
  await h.debug.spawnTarget(1, 0, 1);
  await spawnBallPolar(h, 336, slotArcCenterDeg(1, 0), ballSpeed(1), 180);
  const plainCues = onCue(h);
  const plain = await captureReplay(h, "break", () =>
    driveToEvent(h, plainCues, LEAD_TICKS, TRAIL_TICKS),
  );

  assertDefined(
    posedTarget(plain, "before", 1),
    "the ring 1 target after the lead ticks: not yet destroyed",
  );
  assertUndefined(
    posedTarget(plain, "after", 1),
    "the ring 1 target after the crossing tick: destroyed",
  );
  assertLength(
    cuesNamed(plain.quiet, CUE),
    0,
    `${CUE} cues sounded before the ordinary destruction`,
  );
  assertLength(
    cuesNamed(plain.played, CUE),
    1,
    `${CUE} cues sounded by the end of the ordinary destruction's tick`,
  );

  // The pierce destruction: a full-hit-point ring 2 target, gone in one
  // contact only because the posed pierce destroys outright.
  await isolate(h);
  await h.debug.setEffectTicks("pierce", PIERCE_TICKS);
  await h.debug.setRingSpeed(2, 0);
  await h.debug.spawnTarget(2, 0, 2);
  await spawnBallPolar(h, 406, slotArcCenterDeg(2, 0), ballSpeed(1), 180);
  const pierceCues = onCue(h);
  const pierced = await captureReplay(h, "pierce-break", () =>
    driveToEvent(h, pierceCues, LEAD_TICKS, TRAIL_TICKS),
  );

  assertDefined(
    posedTarget(pierced, "before", 2),
    "the ring 2 target after the lead ticks: not yet destroyed",
  );
  assertUndefined(
    posedTarget(pierced, "after", 2),
    "the full-hit-point ring 2 target after the crossing tick: the pierce " +
      "destruction removed it outright",
  );
  assertLength(
    cuesNamed(pierced.quiet, CUE),
    0,
    `${CUE} cues sounded before the pierce destruction`,
  );
  assertLength(
    cuesNamed(pierced.played, CUE),
    1,
    `${CUE} cues sounded by the end of the pierce destruction's tick`,
  );
});
