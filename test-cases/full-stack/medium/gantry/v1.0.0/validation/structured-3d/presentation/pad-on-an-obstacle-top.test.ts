// presentation/pad-on-an-obstacle-top — a pad whose target stands on an
// obstacle's top face is drawn up there, not down on the ground.
//
// `specs/world.md` puts a load's pad at its target pose, and a target's `y` is
// part of that pose — so a pad wanted on a shelf is a pad at the shelf's height.
// `specs/overview.md` asks that "each pad's footprint and required yaw are marked
// so a site is readable before anything is built", and a site whose shelf pad was
// drawn on the floor would be read wrong before a single member went in.
//
// THE READING IS THE HEIGHT THE FRAME DREW IT AT, against the height the site
// says the target is. Both are the build's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertTrue } from "../assert";
import {
  addOneLoad,
  addOneObstacle,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

const CLASS = "crate" as const;
const FROM = { x: 7, y: 0, z: -3, yaw: 0 };

/** A shelf, and the pad wanted on its top face. */
const SHELF_MIN = { x: -7, y: 0, z: 7 };
const SHELF_SIZE = { x: 4, y: 3, z: 4 };
const TARGET = { x: -5, y: SHELF_MIN.y + SHELF_SIZE.y, z: 9, yaw: 0 };

/** How far the pad may be drawn from the height its target names. */
const TOLERANCE = 0.75;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a pad wanted on an obstacle's top at that height", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("build");
  await addOneObstacle(h, SHELF_MIN, SHELF_SIZE);
  await addOneLoad(h, CLASS, 40, FROM, TARGET);
  await h.advance(1);

  const pads = entriesOf(await h.drawn(), "mark", "pad");

  await h.capture("shelf-pad", "The pad marked on the obstacle's top face");

  assertTrue(pads.length > 0, "a pad mark among what the frame drew");
  assertCloseTo(
    pads[0]!.y,
    TARGET.y,
    TOLERANCE,
    `the pad drawn at the height its target names (${TARGET.y}) rather than ` +
      "on the ground (specs/world.md)",
  );
});
