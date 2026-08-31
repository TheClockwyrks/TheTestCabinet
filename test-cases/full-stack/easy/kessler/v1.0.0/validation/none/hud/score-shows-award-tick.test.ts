// hud/score-shows-award-tick — the score readout shows the new value on the
// tick an award resolves rather than counting up toward it.
//
// specs/screens.md fixes the score readout as "The score, in digits, as
// specs/scoring.md fixes it", and specs/scoring.md awards "Hitting a target
// that survives — 50" on the tick the hit resolves. So the frame rendered by
// the award's own tick must already show the new figure.
//
// THE AWARD IS ONE SURVIVING HIT. A ring 3 target is posed with 2 hit points
// and a ball is spawned just outside its outer contact radius (462), inbound
// at 240 units per second, so the crossing lands on the ball's third tick
// (471 -> 467 -> 463 -> 459) with nothing at a posed boundary. A hit changes
// no other readout — no pod (podSpawn is held), no effect, no life — so the
// award's tick differs from the one before it only in the score.
//
// The direct reading is the award frame's text runs showing 1050. A build
// that paints digits as glyph sprites is read differentially instead, with
// evidence confined outside radius 470: past the ball, the rings, and the
// deflector, where only the HUD can answer. The fallback shows the readout
// CHANGED on the award tick; only the text reading can also see the value.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { HIT_POINTS, slotArcCenterDeg } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import {
  assertReadoutChanged,
  digitsShown,
  keepOutside,
  readFrame,
  type FrameRead,
} from "./readouts";

/** The score posed before the award, chosen so 1050 appears nowhere else. */
const POSED_SCORE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the new score on the award's own tick", async () => {
  const opened = await isolate(h);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.spawnTarget(3, 0, 2);
  const aim = slotArcCenterDeg(3, 0, opened.rings[2].angleDeg);
  await spawnBallPolar(h, 471, aim, 240, 180);

  const reads: FrameRead[] = [];
  let score = POSED_SCORE;
  await captureReplay(h, "award", async () => {
    for (let i = 0; i < 6 && score === POSED_SCORE; i += 1) {
      reads.push(await readFrame(h));
      score = (await h.snapshot()).score;
    }
  });

  const awarded = POSED_SCORE + HIT_POINTS;
  assertEqual(score, awarded, "the surviving hit's 50-point award landing");

  const award = reads[reads.length - 1];
  if (digitsShown(award.calls, String(awarded))) return;

  assertGreaterThanOrEqual(
    reads.length,
    3,
    "two pre-award frames to subtract animation with (the ball is posed to cross the target's contact on its third tick)",
  );
  assertReadoutChanged(
    reads[reads.length - 3],
    reads[reads.length - 2],
    award,
    keepOutside(h, 470),
    `the award tick's own frame showing the new score (${awarded})`,
  );
});
