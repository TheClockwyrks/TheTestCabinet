// presentation/lamplighter-faces-left — with `facing` `"left"`, the
// lamplighter's sprite is laid down reflected across its vertical axis.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/world.md`, Facing: "the
// lamplighter's sprite is drawn facing the same way" as `facing`.
// `specs/assets.md`, Animation: "The sprite faces the way `facing` says:
// produce one facing and mirror it in code, or produce both", and its sprite
// table produces one lamplighter idle and one six-frame walk sheet, so the
// mirror is the code's. `specs/overview.md` says where that mirror lives under
// this engine: "The facing mirror lives on the lamplighter's own sprite
// component rather than on the followed actor's transform."
//
// WHAT IS READ. The transform in force at the blit. A reflection across the
// vertical axis is a negative determinant — the sprite component's
// `offset.scaleX` of `-1` composed into the transform the engine draws under —
// so the reading is the sign of that determinant, which is what "mirrored
// across its vertical axis" means at the canvas. It is read on the produced
// lamplighter file blitted at the stage centre `specs/ui.md` puts the
// lamplighter at, within `SPRITE_TOL` (2 device pixels) of it.
//
// THE BOUND. None: a sign. This suite reads the LEFT direction alone; the
// right-facing frame is its own item, and both are read here only so the
// failure names the pair.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with `facing` posed
// through `setFacing`, which `specs/instrumentation.md` makes a pose of that
// field alone, so no movement, no key, and no other actor is involved. No key
// is held, so the idle sprite is what both frames draw and the two differ in
// the mirror alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertTrue } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import {
  blitsNearStage,
  captureStill,
  createHarness,
  isolate,
  type Blit,
  type Harness,
} from "../harness";
import { LAMPLIGHTER_FILES, SPRITE_TOL } from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The topmost produced lamplighter sprite on the stage centre, or `null`. */
async function lamplighterBlit(): Promise<Blit | null> {
  const blits = await h.frameBlits();
  const drawn = blitsNearStage(h, blits, STAGE_CX, STAGE_CY, SPRITE_TOL).filter(
    (blit) => LAMPLIGHTER_FILES.includes(blit.id),
  );
  return drawn.length === 0 ? null : drawn[drawn.length - 1];
}

it("lays the lamplighter's sprite down reflected while facing left", async () => {
  isolate(h);

  h.debug.setFacing("right");
  const right = await lamplighterBlit();
  assertNotNull(right, "a produced lamplighter sprite while facing right");

  h.debug.setFacing("left");
  const left = await lamplighterBlit();
  captureStill(h, "left");
  assertNotNull(left, "a produced lamplighter sprite while facing left");

  assertTrue(
    (left as Blit).mirrored,
    "the lamplighter's sprite drawn reflected across its vertical axis while " +
      `facing left (the right-facing frame was drawn ` +
      `${(right as Blit).mirrored ? "reflected" : "unreflected"})`,
  );
});
