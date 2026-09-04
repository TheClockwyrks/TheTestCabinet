// drilling/side-cut-starts-at-the-edge — a side cut begins at the tile edge.
//
// specs/character.md: holding left or right first walks the miner across the
// cell it stands in, and the cut into the neighboring cell begins only once the
// miner's box is flush against it. So lateral movement inside a wider tunnel
// costs nothing until the player commits to the dig.
//
// The scene is a floor to walk along, one rock cell standing as the wall, and
// open ground between the miner and it. The miner starts three cells back, which
// is `172` units of walk at `WALK_SPEED` — over half a second, and so several
// `DRILL_HIT_INTERVAL`s. That matters: a run-up shorter than one hit interval
// would pass on a build that starts its cut on the keypress, simply because the
// first hit could not have landed yet.
//
// The reading is where the miner was on the frame the wall first lost health. It
// must be in the cell beside the wall — that is the specification's sentence
// exactly, and it is what a cut begun on the keypress fails — with its box up
// against the wall's face. `specs/character.md` states "flush" and fixes no
// margin, so the second reading allows a quarter of a tile: comfortably more
// than the contact epsilon a build resolves a wall with, and comfortably less
// than the three cells a cut begun on the keypress would leave.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, MINER_W, TILE } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  standOn,
  type Harness,
} from "../harness";

/** The column the wall stands in, and the row the miner walks along. */
const WALL_COL = 11;
const ROW = 12;

/** Where the walk starts: three cells back from the wall. */
const START_COL = WALL_COL - 3;

/** The wall's face, in world units: the left edge of its column. */
const FACE = WALL_COL * TILE;

/** How far the box may sit from the wall's face and still count as flush. */
const FLUSH = TILE / 4;

/** Frames the walk and the first hit together may spend. */
const MAX_FRAMES = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("cuts into the wall only once the miner is flush against it", async () => {
  openScene(h);
  layFloor(h, ROW);
  // The wall the cut is aimed at: the cell beside the miner's box, not the
  // floor it walks on.
  h.debug.setTile(WALL_COL, ROW - 1, "rock");
  standOn(h, START_COL, ROW, "east");

  const opening = h.tileAt(WALL_COL, ROW - 1);
  assertEqual(opening.health, BAND_HEALTH.topsoil, "specs/world.md");

  const walk = await captureReplay(h, "walk-then-cut", async () => {
    h.hold(ACTION_KEY.right);
    try {
      for (let frame = 0; frame < MAX_FRAMES; frame += 1) {
        await h.advance(1);
        const tile = h.tileAt(WALL_COL, ROW - 1);
        if ((tile.health ?? 0) < BAND_HEALTH.topsoil) {
          const at = h.snapshot().miner;
          return { x: at.x, col: at.col, cut: true };
        }
      }
      const at = h.snapshot().miner;
      return { x: at.x, col: at.col, cut: false };
    } finally {
      h.release(ACTION_KEY.right);
    }
  });

  // The cut did start once the miner arrived, so the walk is a delay rather
  // than a refusal.
  assertEqual(walk.cut, true, "specs/character.md");
  // And the box was against the wall's face when the first hit landed, rather
  // than back where the key went down.
  assertEqual(walk.col, WALL_COL - 1, "specs/character.md");
  assertBetween(walk.x + MINER_W, FACE - FLUSH, FACE, "specs/character.md");
});
