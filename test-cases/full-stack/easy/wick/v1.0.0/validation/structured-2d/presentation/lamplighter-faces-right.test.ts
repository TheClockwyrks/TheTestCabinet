// presentation/lamplighter-faces-right — with `facing` `"right"`, the
// lamplighter's sprite is laid down unreflected, the way the produced file is
// authored.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/world.md`, Facing: `facing` "starts
// as `"right"`" and "the lamplighter's sprite is drawn facing the same way".
// `specs/assets.md`, Animation: "The sprite faces the way `facing` says:
// produce one facing and mirror it in code, or produce both", and its sprite
// table produces one lamplighter idle and one six-frame walk sheet, so one
// facing is drawn as authored and the other is the mirror of it. The authored
// facing is the run's own starting facing, `"right"`, so the right-facing frame
// carries no reflection and the left-facing one does.
//
// WHAT IS READ. The transform in force at the blit. A reflection across the
// vertical axis is a negative determinant — the sprite component's
// `offset.scaleX` of `-1` composed into the transform the engine draws under
// (`specs/overview.md`: "The facing mirror lives on the lamplighter's own
// sprite component") — so an unreflected sprite is a positive determinant. It
// is read on the produced lamplighter file blitted at the stage centre
// `specs/ui.md` puts the lamplighter at, within `SPRITE_TOL` (2 device pixels)
// of it.
//
// THE BOUND. None: a sign. This suite reads the RIGHT direction alone; the
// left-facing frame is its own item.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with `facing` posed
// through `setFacing`, which `specs/instrumentation.md` makes a pose of that
// field alone, so no movement, no key, and no other actor is involved. No key
// is held, so the idle sprite is what the frame draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertFalse, assertNotNull } from "../assert";
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

it("lays the lamplighter's sprite down unreflected while facing right", async () => {
  isolate(h);
  h.debug.setFacing("right");

  const blits = await h.frameBlits();
  captureStill(h, "right");
  const drawn = blitsNearStage(h, blits, STAGE_CX, STAGE_CY, SPRITE_TOL).filter(
    (blit) => LAMPLIGHTER_FILES.includes(blit.id),
  );
  const sprite = drawn.length === 0 ? null : drawn[drawn.length - 1];
  assertNotNull(sprite, "a produced lamplighter sprite while facing right");

  assertFalse(
    (sprite as Blit).mirrored,
    "the lamplighter's sprite drawn reflected across its vertical axis while " +
      "facing right",
  );
});
