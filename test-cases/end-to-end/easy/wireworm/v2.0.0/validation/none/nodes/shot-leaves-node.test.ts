// nodes/shot-leaves-node — a segment killed by a bolt leaves an inert node.
//
// specs/nodes.md, under how the field grows: "Every worm segment destroyed by a
// bolt leaves a fresh node at charge `0` on the tile it died on." That is the
// field's only growth route the player drives, and it is what makes shooting a
// worm a trade rather than a clean win.
//
// THE WORM IS A TARGET AND NOTHING ELSE. Two segments, posed with the step
// faculty off (specs/instrumentation.md's `setWormStepping`), so the chain holds
// its tiles for the whole flight and the tile the bolt struck is the tile the
// segment died on. The bolt is aimed at the TAIL rather than the head, so the
// worm survives the hit and the level cannot clear underneath the reading; what a
// tail hit does to the chain's length is worm/shot-tail-shortens's requirement
// and is not asserted here.
//
// THE TILE IS POSED EMPTY. specs/nodes.md gives the other half of the rule its
// own sentence — "Where that tile already holds a node, no new node is laid and
// the standing node keeps the charge it had" — and nodes/shared-tile-keeps-charge
// is the point that reads it, so nothing stands on this tile before the bolt and
// the node found afterwards can only be the one the death laid.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER: nothing laid reads absent, a
// node laid already charged reads `1` or more, and a build that laid it on the
// wrong tile leaves this one absent as well.
//
// NO TOLERANCE APPLIES: a charge is a whole number and the comparison is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  shootTile,
  startPlaying,
  type Harness,
} from "../harness";

/** The head's tile, and with it the chain: the tail sits one column to its left. */
const HEAD = { c: 13, r: 10 } as const;

/** The tile the bolt is aimed at: the tail, so the worm survives the hit. */
const TAIL = { c: HEAD.c - 1, r: HEAD.r } as const;

/** The charge specs/nodes.md lays on the tile a shot-killed segment died on. */
const LEFT_CHARGE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays a fresh inert node on the tile a shot-killed segment died on", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    length: 2,
    dh: 1,
    dv: 1,
    stepping: false,
  });
  assertEqual(
    chargeAt(await h.snapshot(), TAIL.c, TAIL.r),
    null,
    "the tail's tile as posed, empty before the bolt",
  );

  await shootTile(h, TAIL.c, TAIL.r);
  await captureStill(h, "node");

  assertEqual(
    chargeAt(await h.snapshot(), TAIL.c, TAIL.r),
    LEFT_CHARGE,
    `the node left on (${TAIL.c}, ${TAIL.r}), where the segment died`,
  );
});
