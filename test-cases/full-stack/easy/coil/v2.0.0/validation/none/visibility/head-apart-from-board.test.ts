// visibility/head-apart-from-board — the head cell is not the colour of the
// board under it.
//
// WHAT THE SPECIFICATION FIXES. `specs/overview.md` requires that a player reads
// the snake's head at a glance: "the head cell is drawn distinctly from every
// body cell, so the leading cell is unmistakable at any length", over a board
// that is "a dark field carrying bright, saturated pieces". It fixes no palette
// — "the palette, the type, any glow, and every other aspect of the look are
// yours" — so the only thing a check may read is SEPARATION, and the case's
// figure for clearly apart is `DISTINCT_MIN`: more than 50 of the 441 the RGB
// cube spans.
//
// THE WORLD THIS POSES. The snake is the one body the board always holds
// (`specs/instrumentation.md`), so it cannot be taken off; everything else can
// and is. The pellet is cleared, the obstacle course is cleared (`poseScene`
// does that by default, so this reads the same under either mode), and travel is
// switched off, because a check on a colour exercises no faculty of the snake's
// and a chain that walked away between the pose and the sample would be read at
// the wrong cell.
//
// WHERE IT SAMPLES. The head cell's centre, against the centre of an interior
// cell the posed world leaves empty. A cell is `CELL` (32) units across, so its
// centre is sixteen units from the nearest edge — outside any anti-aliased rim,
// and out of reach of a build's own per-cell ruling. The empty cell is chosen
// well inside the interior rather than in the ring against the wall, so a build
// that glows its border is read on the field it actually lays.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import type { Cell } from "../constants";
import { DISTINCT_MIN } from "../constants";
import {
  captureStill,
  chainFrom,
  colorDistance,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  type Harness,
} from "../harness";

/** The interior cell the posed world leaves empty, far from the chain and the wall. */
const BOARD_CELL: Cell = { col: 20, row: 12 };

/** Long enough that the head has a body behind it, as it does in play. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the head apart from an empty interior cell", async () => {
  await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", LENGTH),
    dir: "right",
    pellet: null,
    travel: false,
  });
  // One frame, so what is sampled is the picture this posed world drew.
  await h.advance(1);
  await captureStill(h, "scene");

  const [head, board] = await sampleCells(h, [HOME_HEAD, BOARD_CELL]);

  assertGreaterThan(
    colorDistance(head, board),
    DISTINCT_MIN,
    "the RGB distance between the head cell's centre and an empty interior cell's",
  );
});
