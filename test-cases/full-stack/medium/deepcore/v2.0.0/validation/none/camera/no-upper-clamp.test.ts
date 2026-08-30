// camera/no-upper-clamp — the view follows the miner up into the open sky.
//
// specs/world.md: "There is no ceiling above the surface, so the camera has no
// upper clamp and follows the miner up into the open sky". The vertical rule is
// `camY = clamp(my - VIEW_H / 2 + lead, -Infinity, (coreRow + 1) * TILE - VIEW_H)`
// — a stop at the bottom and none at the top. A miner thrusting well above the
// camp therefore stays in view, rather than the camera stopping at the ground
// line and leaving it behind.
//
// A REAL CLIMB. The jetpack key goes down through the surface's own input and the
// game's own thrust lifts the miner off the camp; specs/character.md fixes that
// the sky is unbounded and that the miner may thrust straight up out of the mine.
// The only pose is where it starts.
//
// ISOLATION. The camp's ground laid back as generation leaves it, so the miner
// stands rather than falling through an empty mine, the drill gated so the held
// key cuts nothing, and nothing else in the world.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLessThan } from "../assert";
import { SURFACE_Y, TILE, VIEW_H } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layCamp,
  minerCenter,
  minerFeet,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

/** The climb's length, and the frames it is driven in. */
const CLIMB_SECONDS = 1.5;
const CLIMB_FRAMES = 180;

/** How far above the ground line the climb must carry the miner, in tiles. */
const MIN_TILES_ABOVE = 3;

/** Half a unit either side: the specification fixes `camY` exactly. */
const TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("follows the miner above the ground line with no upper clamp", async () => {
  await openScene(h);
  await pinDrill(h);
  await layCamp(h);
  await standAtCamp(h);
  await h.advance(1);

  const onTheGround = await h.snapshot();

  await captureReplay(h, "sky", async () => {
    await h.hold(ACTION_KEY.up);
    try {
      await h.advanceSeconds(CLIMB_SECONDS, CLIMB_FRAMES);
    } finally {
      await h.release(ACTION_KEY.up);
    }
  });

  const aloft = await h.snapshot();
  // The arrangement's own reading: the thrust really did carry the miner well
  // clear of the camp, so what follows is a reading in the open sky.
  assertLessThan(
    minerFeet(aloft.miner),
    SURFACE_Y - MIN_TILES_ABOVE * TILE,
    `specs/character.md: the jetpack lifts the miner ${MIN_TILES_ABOVE} tiles above the ground line`,
  );

  const expected = minerCenter(aloft.miner).y - VIEW_H / 2 + aloft.camera.lead;
  assertBetween(
    aloft.camera.y,
    expected - TOLERANCE,
    expected + TOLERANCE,
    "specs/world.md: camY follows my - VIEW_H / 2 + lead with no upper clamp",
  );
  assertLessThan(
    aloft.camera.y,
    onTheGround.camera.y,
    "specs/world.md: the view rose with the miner rather than stopping at the ground line",
  );
});
