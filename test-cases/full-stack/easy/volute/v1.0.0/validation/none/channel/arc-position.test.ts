// channel/arc-position — a core's field position is its arc distance walked
// along the channel polyline.
//
// THE SPEC LINE. `specs/channel.md`, "Arc positions": "A core's position on the
// channel is one number, its arc distance `s` from the inlet walked along the
// polyline. The leg an arc position lies on is the one whose starting vertex
// carries the greatest arc distance that does not exceed `s`, and the point for
// that position is that vertex plus the leg's unit direction times the
// remainder". The twelve vertices and their arc distances are the same file's
// table, and `specs/instrumentation.md` has the snapshot report the walk:
// "`train[].x`, `train[].y` | The core's arc position walked along the channel".
//
// THE FIVE POSITIONS are each a different leg of the polyline, so a build that
// walks only the first leg, drops a leg, or measures from the wrong end fails on
// one of them. Every expected point is recomputed here from the spec's own
// vertex table through `channelPoint`, rather than written out, so the check and
// the table cannot drift apart:
//
//     880 -> (920,  40)   vertex 1, the end of the first leg
//    1340 -> (920, 500)   vertex 2, a corner
//    3240 -> (840, 120)   vertex 5, five legs in
//    4360 -> (220, 220)   vertex 8, eight legs in
//    4990 -> (490, 320)   ten units short of the intake, mid-leg on the last leg
//
// THE TOLERANCE. +/- 1 unit on each coordinate. Nothing is stepped: the point is
// a pure function of the posed arc position, so a build computing it lands on it
// exactly, and the unit is there only for a build that keeps or reports its
// positions rounded to whole units. It is far tighter than any wrong walk — the
// nearest confusion, reading 4990 off the wrong leg, is more than a hundred
// units away.
//
// THE POSE DECIDES NOTHING and nothing is stepped, so this reads the placement
// alone: `poseTrain` "Replaces every core on the channel with the cores given"
// and "The cores are placed at exactly the arc positions given".

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { CHANNEL_POINT_TOL, CHARGE_IDS } from "../constants";
import {
  captureStill,
  channelPoint,
  createHarness,
  head,
  poseHall,
  type Harness,
  type PosedCore,
} from "../harness";

/**
 * The arc distances the review item names, one per leg of the polyline.
 *
 * The point each is expected at comes from `channelPoint`, which is the spec's
 * own walk over the spec's own vertex table.
 */
const WALKED = [880, 1340, 3240, 4360, 4990] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a core at the point its arc distance walks to", async () => {
  // An isolated hall: the level open, the inlet stopped, the train held, and
  // nothing on the channel but the one core each reading is about. The train is
  // held so the tick that draws the evidence below leaves the five where they
  // were posed.
  await poseHall(h, { feed: false });

  const readings: { s: number; x: number; y: number }[] = [];
  for (const s of WALKED) {
    await h.debug.poseTrain([[s, CHARGE_IDS[0], null] as PosedCore]);
    const posed = head(await h.snapshot());
    readings.push({ s, x: posed.x, y: posed.y });
  }

  // The evidence: all five standing on the channel at once. One tick is what
  // puts them on the canvas, since `step` runs "the full tick followed by a
  // render" (`specs/instrumentation.md`), and the readings above were taken
  // before it. Taken before the assertions, so a failing check still leaves the
  // picture that shows why.
  await h.debug.poseTrain(
    WALKED.map((s) => [s, CHARGE_IDS[0], null] as PosedCore),
  );
  await h.step(1);
  await captureStill(h, "walk");

  for (const reading of readings) {
    const expected = channelPoint(reading.s);
    assertNear(
      reading.x,
      expected.x,
      CHANNEL_POINT_TOL,
      `the x of a core at arc ${reading.s}`,
    );
    assertNear(
      reading.y,
      expected.y,
      CHANNEL_POINT_TOL,
      `the y of a core at arc ${reading.s}`,
    );
  }
});
