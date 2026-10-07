// camera/vertical-clamp-at-the-bottom — the view stops with the Core chamber at
// the foot of the screen.
//
// specs/world.md: `camY` is clamped above by `(coreRow + 1) * TILE - VIEW_H`, so
// the deepest the view ever reaches is the one that puts the bottom of the Core
// chamber row on the bottom edge of the mine viewport. Below that row is the
// bedrock the world ends in, and the camera never scrolls into it.
//
// ISOLATION. An empty mine with the miner posed at the bottom of it, its body and
// its drill both gated so it holds that position and cuts nothing. The pose is
// deep enough that the unclamped answer is past the stop, which the check states
// as its own arithmetic before reading the build.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { CORE_COL, TILE, VIEW_H } from "../constants";
import {
  captureStill,
  createHarness,
  minerCenter,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** Half a unit: the specification fixes the stop exactly. */
const TOLERANCE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clamps camY to (coreRow + 1) * TILE - VIEW_H at the bottom of the mine", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);

  const { coreRow } = await h.snapshot();
  assertEqual(
    (await h.tileAt(CORE_COL, coreRow)).kind,
    "core",
    "specs/world.md: the Core sits at (CORE_COL, coreRow)",
  );

  await standOn(h, CORE_COL, coreRow);
  await h.advance(1);

  const snapshot = await h.snapshot();
  const stop = (coreRow + 1) * TILE - VIEW_H;
  // The arrangement's own arithmetic: standing on the Core chamber puts the
  // unclamped answer below the stop, so an unclamped build scrolls past it.
  assertGreaterThan(
    minerCenter(snapshot.miner).y - VIEW_H / 2,
    stop,
    "the pose is past the vertical stop",
  );
  assertCloseTo(
    snapshot.camera.y,
    stop,
    TOLERANCE_DIGITS,
    "specs/world.md: camY is clamped to (coreRow + 1) * TILE - VIEW_H",
  );

  await captureStill(h, "bottom");
});
