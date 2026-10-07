// Wick — assets/lamplighter-walk-frames-distinct: the walk sheet is six poses
// of a stride rather than one picture shipped more than once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): the walk row is produced with
//     `draw-sheet`, "everything that moves on its own: the walk cycles, the
//     death puff, and the animated effects".
//   - specs/assets.md (Animation): "The lamplighter draws the walk sheet on a
//     tick with a non-zero movement direction ... the cycle advances one frame
//     per `WALK_FRAME_TIME` seconds of movement and wraps", so the six frames
//     are six steps of a cycle a player watches run.
//   - The review item states the floor read here: "No two of the six
//     lamplighter walk frames are pixel-identical."
//
// WHAT IS READ. The fifteen pairs the six frames make, compared pixel for
// pixel. A file shipped twice differs by exactly nothing, since a PNG carries
// its pixels losslessly, so what this separates is six poses from a cycle
// padded with repeats.
//
// HOW TWO FRAMES ARE COMPARED. Two fully transparent pixels count as the same
// pixel whatever colour bytes sit under them: a straight-alpha canvas leaves
// those undefined and a player sees nothing either way, so a frame re-exported
// with different rubbish beneath its clear pixels is still the same picture.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each frame exists on its canvas and
// carries paint is `assets/lamplighter-walk-produced`; whether the six read as
// one continuous stride is the art bar the presentation domain's rating judges.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the six frames laid side by side.
//
// TOLERANCE. None. Pixel identity is exact.

import { it } from "vitest";
import { fail } from "../assert";
import { captureCanvas } from "../harness";
import {
  WALK_SPRITES,
  committed,
  firstIdenticalPair,
  readSprites,
  requireAll,
  sheetOf,
} from "./produced";

it("draws each of the six walk frames differently from the rest", async () => {
  const pixels = requireAll(await readSprites(WALK_SPRITES));

  captureCanvas(
    await sheetOf(WALK_SPRITES, { title: "assets/sprites/lamplighter/walk" }),
    "distinct",
  );

  const pair = firstIdenticalPair(WALK_SPRITES, pixels);
  if (pair !== null) {
    fail(
      "six walk frames, no two of them the same picture",
      `${committed(pair[0])} and ${committed(pair[1])} are pixel-identical`,
    );
  }
});
