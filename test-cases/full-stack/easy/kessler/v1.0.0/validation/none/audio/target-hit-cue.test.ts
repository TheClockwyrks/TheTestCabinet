// audio/target-hit-cue — the target-hit cue sounds once, on the tick a hit
// leaves a target's hit points above zero, and on no tick before it.
//
// specs/rings.md: "A hit that leaves the target's hit points above zero plays
// the `target-hit` cue." The hit is a one-tick crossing event — a face hit
// lands "in a tick where the ball's center radius crosses a ring's contact
// radius toward the ring ... and the ball's center angle is within a live
// target's arc" — and specs/assets.md ties the produced file to exactly that
// event: "The event each cue plays on is fixed in the file that specifies the
// event"; "play a cue on its event". One event, one play, on the event's own
// tick.
//
// THE SURVIVING HIT IS A RING 2 TARGET AT FULL HIT POINTS. Ring 2 is the one
// ring whose targets hold 2 hit points, so a single face hit leaves the
// target live at 1 — the surviving hit this item is about. The drive proves
// it reached exactly that: the target still at 2 hit points after the lead
// ticks, at 1 and still live after the crossing tick.
//
// THE POSE CROSSES STRICTLY. At the wave-1 speed of 240 units per second the
// ball covers 4 units of radius per tick, so from radius 406 it reads 394
// before the crossing tick and 390 after it — on neither side of ring 2's
// outer contact radius of 392 does a reading land on the boundary. The ring
// is posed still (setRingSpeed(2, 0), its own review item) and the ball flies
// straight inward at the target arc's center, so the arc stands where the
// ball is aimed on the crossing tick.
//
// THE WORLD IS ONE BALL AND ONE TARGET. isolate() empties the rings, balls,
// and pods and holds both driver switches; the one posed target is the only
// thing the ball can touch.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser opens no audio context
// without a user gesture, so armAudio presses a key through Chromium's own
// input pipeline — UNBOUND_KEY, which specs/controls.md binds to nothing, so
// arming disturbs no game state — and waits for the produced files to decode,
// so a cue that sounds can be named from the file it came from.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLength } from "../assert";
import { ballSpeed, slotArcCenterDeg } from "../constants";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { driveToEvent } from "./cues";

/** The cue specs/rings.md has a surviving hit play. */
const CUE = "target-hit";

/** The posed target: ring 2, slot 0, at ring 2's full 2 hit points. */
const RING = 2;
const SLOT = 0;
const FULL_HP = 2;

/** Posed start radius: 406 - 4 * 3 = 394 before the crossing tick, 390 after. */
const START_RADIUS = 406;

/** Ticks of plain inward flight before the hit, on which no cue may sound. */
const LEAD_TICKS = 3;

/** Ticks driven after the hit, so the clip holds the aftermath as well. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds target-hit once, on the tick the surviving hit lands", async () => {
  await h.armAudio();
  await isolate(h);
  await h.debug.setRingSpeed(RING, 0);
  await h.debug.spawnTarget(RING, SLOT, FULL_HP);
  await spawnBallPolar(
    h,
    START_RADIUS,
    slotArcCenterDeg(RING, SLOT),
    ballSpeed(1),
    180,
  );

  const cues = onCue(h);
  const drive = await captureReplay(h, "hit", () =>
    driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
  );

  // The drive reached the surviving hit on the crossing tick and not before.
  const untouched = drive.before.rings[RING - 1].targets.find(
    (target) => target.slot === SLOT,
  );
  assertDefined(untouched, "the posed target after the lead ticks");
  assertEqual(
    untouched?.hp,
    FULL_HP,
    "the target's hit points after the lead ticks: not yet hit",
  );
  const survivor = drive.after.rings[RING - 1].targets.find(
    (target) => target.slot === SLOT,
  );
  assertDefined(survivor, "the target after the crossing tick: it survived");
  assertEqual(
    survivor?.hp,
    FULL_HP - 1,
    "the target's hit points after the crossing tick: the hit landed on it",
  );

  assertLength(
    cuesNamed(drive.quiet, CUE),
    0,
    `${CUE} cues sounded over the ${LEAD_TICKS} ticks of flight before the hit`,
  );
  assertLength(
    cuesNamed(drive.played, CUE),
    1,
    `${CUE} cues sounded by the end of the tick the hit landed on`,
  );
});
