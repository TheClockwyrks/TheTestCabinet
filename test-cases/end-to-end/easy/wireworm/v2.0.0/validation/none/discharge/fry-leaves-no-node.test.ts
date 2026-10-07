// discharge/fry-leaves-no-node — a fried segment leaves nothing behind.
//
// The two routes that destroy a segment differ in exactly this, and
// `specs/nodes.md` states both sides: "Every worm segment destroyed by a bolt
// leaves a fresh node at charge `0` on the tile it died on", while "A segment
// destroyed by a discharge leaves nothing, as `specs/discharge.md` states".
// `specs/discharge.md` says the same from its own side: "A segment destroyed by a
// discharge leaves nothing behind: no node is laid on the tile it stood on."
//
// So the tiles the discharge's fried segments stood on are read for a NODE, and
// on a correct build they hold none. That is the reading that names the wrong
// model: a build that runs the bolt's node-laying rule down the discharge path
// leaves a fresh node and the tiles answer `0`, not empty. Nothing on this board
// could have laid a node there by any other route — the tiles were empty when the
// worm was posed, and an inert node is not something a discharge creates.
//
// Two segments are fried rather than one, because the claim is about the tiles a
// discharge's fried segments stood on and a build that laid a node under only the
// second of them would pass a one-tile reading. Both stand one tile from the
// detonation, well inside the reach, so which tiles are read does not move with a
// build whose fry radius is a tile out; how far the fry reaches is
// discharge/fries-segments-in-reach and its opposite number. Two more segments
// trail behind them, the last of them three tiles out and so beyond the reach, so
// the worm survives the fry and this point is not decided by the level-clear rule
// (`specs/progression.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertUndefined } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  nodeAt,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { detonate, wormOn } from "./detonation";

/** The critical node the bolt is fired into, one row below the worm. */
const STRUCK = { c: 12, r: 9 };

/**
 * The two segments this point reads: a Chebyshev distance of `1` from the
 * detonation each, so both are destroyed on any build whose reach is
 * `DISCHARGE_RADIUS` (`2`) or anything close to it.
 */
const FRIED = [
  { c: 12, r: 8 },
  { c: 13, r: 8 },
];

/**
 * The segments trailing behind them, at distances `2` and `3`. The last is beyond
 * the reach and keeps the worm on the board; nothing here reads either of them.
 */
const BEHIND = [
  { c: 14, r: 8 },
  { c: 15, r: 8 },
];

/** Heading left, so the body trails to the right of the head, where it is posed. */
const HEADING = -1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the tiles its fried segments stood on empty", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: FRIED[0].c,
    r: FRIED[0].r,
    segments: [...FRIED, ...BEHIND],
    dh: HEADING,
    stepping: false,
    body: false,
  });

  await detonate(h, STRUCK.c, STRUCK.r);

  await captureStill(h, "empty");
  const after = await h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  for (const tile of FRIED) {
    assertUndefined(
      wormOn(after, tile.c, tile.r),
      `precondition: the segment on column ${tile.c} was fried`,
    );
    assertUndefined(
      nodeAt(after, tile.c, tile.r),
      `a node standing on the tile the fried segment on column ${tile.c} left`,
    );
  }
});
