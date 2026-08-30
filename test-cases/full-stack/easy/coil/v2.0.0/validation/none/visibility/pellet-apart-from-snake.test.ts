// visibility/pellet-apart-from-snake — the pellet is not the colour of the snake
// it is being chased with.
//
// WHAT THE SPECIFICATION FIXES. `specs/overview.md` requires that "the pellet
// stands apart from the field, the border, and the snake". The palette is the
// build's, so what is read is separation alone, against the case's figure for
// clearly apart: more than `DISTINCT_MIN` (50) of the 441 the RGB cube spans.
// This suite decides the snake half of that requirement, and it takes both
// pieces of the snake a player has to tell the pellet from: the head, which is
// drawn its own way, and a body cell, which is drawn another.
//
// THE WORLD THIS POSES. The chain and the pellet, and nothing else: the obstacle
// course is cleared and travel is switched off, so the head stays one cell short
// of nothing and the pellet is never eaten out from under the sample.

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

/** Where the pellet is placed: an interior cell clear of the posed chain. */
const PELLET_CELL: Cell = { col: 20, row: 5 };

/** Head, a straight body cell, another, and the tail. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the pellet apart from the head and from a body cell", async () => {
  const chain = chainFrom(HOME_HEAD, "right", LENGTH);
  await poseScene(h, {
    snake: chain,
    dir: "right",
    pellet: PELLET_CELL,
    travel: false,
  });
  await h.advance(1);
  await captureStill(h, "scene");

  const [pellet, head, body] = await sampleCells(h, [
    PELLET_CELL,
    chain[0],
    chain[1],
  ]);

  assertGreaterThan(
    colorDistance(pellet, head),
    DISTINCT_MIN,
    "the RGB distance between the pellet cell's centre and the head cell's",
  );
  assertGreaterThan(
    colorDistance(pellet, body),
    DISTINCT_MIN,
    "the RGB distance between the pellet cell's centre and a body cell's",
  );
});
