// Wick — assets/lamplighter-idle-produced: the lamplighter's idle sprite is a
// committed file on its stated canvas, carrying paint.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): the table's first row, "Lamplighter, idle
//     | `assets/sprites/lamplighter/idle.png` | `draw` | `1` | `24 x 32`", and
//     "Every sprite is pixel art drawn at one unit per pixel on a transparent,
//     straight-alpha canvas of exactly the size its row states".
//   - specs/assets.md (Where the files land): "Every produced file sits under
//     `assets/` at the root of this repository, at the path named below, and is
//     committed."
//   - `constants.ts` carries both figures as `LAMPLIGHTER_IDLE_PATH` and
//     `LAMPLIGHTER_SPRITE_WIDTH` / `LAMPLIGHTER_SPRITE_HEIGHT`.
//
// WHAT IS READ. The committed file at that path decodes as an image, its canvas
// is exactly `24 x 32`, and at least one of its pixels is not fully transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the six walk frames ship is
// `assets/lamplighter-walk-produced`; that the canvas is authored on
// transparency is `assets/sprites-on-transparent-ground`; and whether the
// picture reads as a lamplighter at a glance is the art bar the presentation
// domain's rating judges.
//
// WHY NO NIGHT IS POSED. This point is about a FILE, not about a frame the game
// drew, so nothing is posed and no game is driven. The evidence is a picture of
// the file itself, magnified with smoothing off on a dark ground.
//
// TOLERANCE. None. The canvas is an exact pair of whole numbers and the paint
// reading is a count; `specs/assets.md` fixes no coverage figure, so presence
// is all a check may honestly assert of what is drawn.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import { IDLE_SPRITE, assertProduced, readSprite, sheetOf } from "./produced";

it("commits the idle lamplighter at 24 x 32, carrying paint", async () => {
  const read = await readSprite(IDLE_SPRITE);

  captureCanvas(
    await sheetOf([IDLE_SPRITE], { title: "assets/sprites/lamplighter" }),
    "idle",
  );

  assertProduced(read);
});
