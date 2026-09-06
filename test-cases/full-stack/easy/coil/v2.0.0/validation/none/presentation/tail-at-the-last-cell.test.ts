// presentation/tail-at-the-last-cell — the last cell of the chain is painted
// with a different sprite from the run in front of it.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` gives "the last cell of the
// chain" its own produced sprite, "the tail sprite, turned toward its one
// neighbor", authored "with its one neighbor lying to the right". Every other
// body cell takes the straight or the corner, so the end of the snake is a
// different picture from the middle of it and the coil reads as a coil with an
// end rather than as a tube stopping.
//
// WHAT IS READ, AND WHAT IS NOT. That the image painted on the last cell is not
// the image painted on a middle cell of the same straight run. The harness's
// blit reading names a source by the identity the injected recorder gives it —
// one per bitmap the page holds — so two blits carry the same identity exactly
// when they painted the same picture. It is deliberately NOT read
// that the cell took `assets/snake/tail.png` by name — how a build names the
// images it loads its produced files into is the build's, and the file's own
// existence is `presentation/tail-sprite-produced`.
//
// THE CHAIN THIS POSES. Four cells laid in one straight line along row 8, so
// that the run holds a middle cell whose two neighbours lie opposite each other
// and the comparison is against the STRAIGHT sprite rather than the corner's.
// Index `1` is that middle cell and index `3` is the last.
//
// THE WORLD THIS POSES. The chain alone: the pellet cleared, the obstacle course
// cleared, travel switched off so the chain stays the chain that was posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertNotNull } from "../assert";
import {
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  poseScene,
  spriteOnCell,
  type Harness,
} from "../harness";

/** Head, two straight body cells, and the last cell. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the last cell with a different sprite from a middle cell", async () => {
  const chain = chainFrom(HOME_HEAD, "right", LENGTH);
  await poseScene(h, {
    snake: chain,
    dir: "right",
    pellet: null,
    travel: false,
  });

  const blits = await h.frameBlits();
  await captureStill(h, "tail");

  const last = chain[chain.length - 1];
  const middle = chain[1];
  const onLast = spriteOnCell(h, blits, last.col, last.row);
  const onMiddle = spriteOnCell(h, blits, middle.col, middle.row);
  assertNotNull(onLast, "the sprite painted on the last cell of the chain");
  assertNotNull(onMiddle, "the sprite painted on a middle cell of the run");

  assertNotEqual(
    onLast,
    onMiddle,
    "the sprite painted on the last cell, against the one on a middle cell",
  );
});
