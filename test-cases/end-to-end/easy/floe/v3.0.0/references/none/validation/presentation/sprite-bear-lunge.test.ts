// presentation/sprite-bear-lunge — the bear that catches the critter is drawn
// from the lunge frames on the tick it catches.
//
// specs/assets.md tabulates frames `16` and `17` of `assets/bear/` as the lunge,
// for any facing, and draws a bear that is "Catching the critter" from "The
// lunge frames". specs/hunter.md fixes the catch: it happens "when the
// straight-line distance between their centers ... is at most `BEAR_CATCH_DIST`
// (`18`) stage units".
//
// THE TICK OF THE CATCH IS THE ONLY TICK THIS CAN BE READ ON, and it is a busy
// one: specs/progression.md removes the critter and every bear on it. The
// scenario is therefore arranged so exactly one tick separates the pose from the
// catch — the bear is settled on the critter's own tile with the catch test
// still shut, the test is then opened, and the single tick `blitsOfFrame` runs
// is the tick the catch resolves on. What that frame drew is what this point
// reads. The snapshot afterwards confirms the catch really happened on that tick
// rather than the reading having been taken a tick early or a tick late.
//
// THE READING IS INCLUSIVE, unlike its two sibling points. A build is free to
// draw the bear itself one last time in the same frame it draws the lunge in,
// and specs/assets.md forbids nothing of the sort: what it requires is that the
// lunge frames are what the catch is drawn from. So the verdict is that a lunge
// frame WAS drawn where the two met, not that nothing else was.
//
// THE CATCH TEST IS THE ONE WORLD GATE THIS POINT OPENS, because the catch is
// exactly its requirement. Everything else stays as `startCrossing` left it: an
// empty strait, no emergence, no bonus catch and a timer that does not drain.
// The bear's routing and travel are off, so it holds the tile it was posed on
// and the distance this point rests on is the distance the pose set.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  BEAR_LUNGE_FRAMES,
  START_LIVES,
  TILE,
  tileCX,
  tileCY,
} from "../constants";
import {
  blitsOfFrame,
  captureReplay,
  createHarness,
  drawnFrom,
  frameIndexes,
  type Harness,
  poseBear,
  startCrossing,
  ticksFor,
} from "../harness";

/** Where the two meet: a tile in the middle of the ice band. */
const COL = 20;
const ROW = 15;

/** The seconds of the death hold kept as the item's evidence. */
const REPLAY_SECONDS = 0.4;

/**
 * How far the lunge's draw may sit from where the two met, in stage units.
 *
 * specs/assets.md draws a 32 x 32 frame "centered on its subject's own center",
 * and the subject here is the bear, whose centre is the tile centre both bodies
 * were posed on. Half a tile is the widest tolerance that still names that tile.
 */
const CENTRED_WITHIN = TILE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the catching bear from its lunge frames on the tick it catches", async () => {
  await startCrossing(h);
  await h.debug.setCritterTile(COL, ROW);
  await poseBear(h, COL, ROW, { routing: false, travel: false });
  // Zero units apart, well inside BEAR_CATCH_DIST, and the gate that makes that
  // a catch is opened last so no tick has run under it yet.
  await h.debug.setCatchTest(true);

  const blits = await blitsOfFrame(h);
  const after = await h.snapshot();
  // The hold the catch opened, as the item's evidence. Taken before the
  // assertions, so a failing reading still leaves the death it was taken from.
  await captureReplay(h, "catch", () => h.advance(ticksFor(REPLAY_SECONDS)));

  // The situation: the tick that was read is the tick the catch resolved on.
  assertEqual(
    after.phase,
    "dying",
    "the catch resolved on the one tick this reading covered " +
      "(specs/progression.md)",
  );
  assertEqual(
    after.lives,
    START_LIVES - 1,
    "the catch cost exactly one life (specs/progression.md)",
  );

  const met = { x: tileCX(COL), y: tileCY(ROW) };
  const indexes = frameIndexes(
    drawnFrom(blits, "bear", met, CENTRED_WITHIN),
    "bear",
  );
  assertGreaterThanOrEqual(
    indexes.length,
    1,
    `a frame of assets/bear/ drawn at (${met.x}, ${met.y}), where the bear ` +
      `caught the critter (specs/assets.md)`,
  );
  assertGreaterThanOrEqual(
    indexes.filter((index) => BEAR_LUNGE_FRAMES.includes(index)).length,
    1,
    `a lunge frame — ${BEAR_LUNGE_FRAMES.join(" or ")} of assets/bear/ — ` +
      `drawn where the catch happened (specs/assets.md); the frame drew ` +
      `${indexes.join(", ")} there`,
  );
});
