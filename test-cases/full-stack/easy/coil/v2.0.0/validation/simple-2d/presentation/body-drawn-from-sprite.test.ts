// presentation/body-drawn-from-sprite — a straight body cell is painted with a
// bitmap, not with a shape drawn in code.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` requires the snake "drawn from
// produced sprites rather than from shapes drawn in code", and gives "a body cell
// whose two neighbors lie opposite each other" the straight sprite, "turned to
// that run's axis". It states the consequence too: "a body cell is never drawn as
// a bare square". The closing table of things that stay drawn in code does not
// hold the snake.
//
// WHAT IS READ. Whether an image draw landed on a body cell of a straight run.
// The harness records every `drawImage` with the transform in force at the call
// and maps its destination rectangle through it, so the cell a blit belongs to is
// the cell its centre falls in whatever transform or quarter turn the build drew
// under. Which file was painted is not read here: that a bend and a straight are
// painted with DIFFERENT files is `presentation/corner-at-a-bend`, and that the
// last cell is painted with another is `presentation/tail-at-the-last-cell`.
//
// THE CELL IT READS. Index `1` of a chain of four laid in one straight line: its
// two neighbours are the head ahead of it and a body cell behind it, lying
// opposite each other, and it is not the last cell of the chain — so it is the
// straight run's own case rather than the bend's or the tail's.
//
// THE WORLD THIS POSES. The chain alone: the pellet cleared, the obstacle course
// cleared, travel switched off, so nothing else could have blitted on that cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull } from "../assert";
import {
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  poseScene,
  spriteOnCell,
  type Harness,
} from "../harness";

/** Head, two straight body cells, and the tail. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints a straight body cell with an image draw", async () => {
  const chain = chainFrom(HOME_HEAD, "right", LENGTH);
  poseScene(h, {
    snake: chain,
    dir: "right",
    pellet: null,
    travel: false,
  });

  const blits = await h.frameBlits();
  captureStill(h, "body");

  const body = chain[1];
  assertNotNull(
    spriteOnCell(h, blits, body.col, body.row),
    "the sprite an image draw painted on a straight body cell",
  );
});
