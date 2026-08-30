// building/rotate-turns-the-preview — the held rotation moves through the four
// steps, and what the preview draws on the floor follows it.
//
// specs/building.md, Rotating the preview: "While a preview is held, rotating
// advances the held rotation one step through 0, 1, 2, 3 and back to 0, turning its
// radiator faces as specs/towers.md states. Rotating changes only the held
// preview." And, from The preview follows the pointer, the held preview is drawn on
// the floor with "its radiator faces at the held rotation".
//
// TWO READINGS, BECAUSE THE RULE HAS TWO HALVES. The held rotation is read back at
// each of the four steps, and the type and the footprint are read with it, so a
// build that moved the preview or dropped the type while turning it is caught —
// "rotating changes only the held preview". Then the FLOOR is read.
//
// WHY ROTATION 0 AGAINST ROTATION 1 AND NOT 0 AGAINST 2. An Arc's radiators are
// local N and S (specs/towers.md), and a rotation turns a local face
// `N -> E -> S -> W`, so rotation 2 turns local N into world S and local S into
// world N — the same PAIR of world faces. Rotation 0 and rotation 2 are therefore
// indistinguishable on this tower by design, and only the quarter turn moves
// anything. `building/placed-at-the-held-rotation` is where the full four-way
// mapping is decided, on a tower whose faces are asymmetric.
//
// HOW THE DRAWN HALF AVOIDS DEMANDING A LOOK. Nothing in the specification says
// what a radiator face looks like — no colour, no mark, no thickness — and a build
// is free to draw one however it likes, under a transform or not. So what is
// compared is the frame's own drawing against itself: the operations it issued over
// the patch of floor the footprint occupies, each carried through the transform in
// force and stamped with the fill and stroke in force, which is what makes both
// conformant shapes visible — a build that turns its geometry, and a build that
// draws four fixed bars and changes which of them is painted as a radiator. First
// two frames at the SAME rotation, which measures whatever the build's own drawing
// does between frames on its own, and then the frame after the turn. The turn has
// to move more than that, which is true of any build that draws the faces at the
// held rotation and false of one that draws them the same way whatever it holds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TILE, tileLeft, tileTop } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  DRAW_METHODS,
  applyMatrix,
  captureStill,
  createHarness,
  startRun,
  walkTransforms,
  type DrawCall,
  type Harness,
} from "../harness";
import { heldPreview, sizeOf } from "./preview";

/** The type held. Its radiators are local N and S, which one step turns to E and W. */
const HELD = "arc";
const SIZE = sizeOf(HELD);

/** A quiet anchor: clear of every opening and of both corridors. */
const AT = FREE_SITE;

/** The four steps, in the order specs/building.md states them. */
const STEPS = [0, 1, 2, 3] as const;

/** Enough money that the preview reads valid throughout, so its tint holds. */
const PURSE = 1000;

/**
 * The patch of floor read: the footprint, plus a tile of margin on every side, so
 * a build that draws its face marks just outside the block is read too.
 */
const PATCH = {
  x0: tileLeft(AT.col) - TILE,
  y0: tileTop(AT.row) - TILE,
  x1: tileLeft(AT.col) + (SIZE + 1) * TILE,
  y1: tileTop(AT.row) + (SIZE + 1) * TILE,
};

/** A number rounded to a tenth, so float noise in a transform is not a change. */
function tenth(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/**
 * Every drawing operation the frame issued over {@link PATCH}, as a sorted list of
 * signatures: the method, where its leading point landed once the transform in
 * force was applied, its remaining numbers, the transform's own linear part, and
 * the fill and stroke in force at it.
 *
 * Sorted rather than kept in order because the ORDER a build draws its faces in is
 * its own business; what is compared is the SET of marks it left.
 */
function marksOver(calls: readonly DrawCall[]): string[] {
  const marks: string[] = [];
  let fill = "";
  let stroke = "";
  walkTransforms(calls, (call, m) => {
    if (call.kind === "set") {
      if (call.property === "fillStyle") fill = String(call.value);
      if (call.property === "strokeStyle") stroke = String(call.value);
      return;
    }
    if (!DRAW_METHODS.includes(call.method)) return;
    const nums = call.args.filter(
      (arg): arg is number => typeof arg === "number",
    );
    if (nums.length < 2) return;
    const at = applyMatrix(m, nums[0], nums[1]);
    if (at.x < PATCH.x0 || at.x > PATCH.x1) return;
    if (at.y < PATCH.y0 || at.y > PATCH.y1) return;
    marks.push(
      [
        call.method,
        tenth(at.x),
        tenth(at.y),
        ...nums.slice(2).map(tenth),
        ...m.slice(0, 4).map(tenth),
        fill,
        stroke,
      ].join("|"),
    );
  });
  return marks.sort();
}

/** How many marks the two frames do not share, counted both ways. */
function moved(before: readonly string[], after: readonly string[]): number {
  const left = [...before];
  let unmatched = 0;
  for (const mark of after) {
    const at = left.indexOf(mark);
    if (at < 0) unmatched += 1;
    else left.splice(at, 1);
  }
  return unmatched + left.length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("turns the held rotation and the preview drawn at it", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);
  await h.debug.setArmed(HELD);
  await h.debug.setPreview(AT.col, AT.row);

  for (const step of STEPS) {
    await h.debug.setPreviewRotation(step);
    const build = await heldPreview(h);
    assertEqual(build.rotation, step, `the held rotation set to ${step}`);
    assertEqual(build.type, HELD, `the type held at rotation ${step}`);
    assertEqual(
      build.col,
      AT.col,
      `the footprint's column at rotation ${step}`,
    );
    assertEqual(build.row, AT.row, `the footprint's row at rotation ${step}`);
  }

  await h.debug.setPreviewRotation(0);
  const first = marksOver(await h.frameCalls());
  const second = marksOver(await h.frameCalls());
  const drift = moved(first, second);

  await h.debug.setPreviewRotation(1);
  const turned = marksOver(await h.frameCalls());
  await captureStill(h, "rotated");

  assertGreaterThan(
    moved(second, turned),
    drift,
    "the marks the preview left on the floor once its radiator faces turn from " +
      `world N and S to world E and W, against the ${drift} the same frame ` +
      "moves on its own",
  );
});
