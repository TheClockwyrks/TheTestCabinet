// assets/base-effect-sprites-produced — every base weapon's effect is
// committed at its path, on its canvas, with its frame count, each frame
// painted.
//
// WHAT THIS DECIDES. Twenty-one files, the ten base weapons' effects: the
// seven single sprites `taper.png` (`120 x 40`), `ember.png` (`16 x 16`),
// `pin.png` (`12 x 12`), `lantern.png` (`28 x 28`), `halo.png`
// (`160 x 160`), `oil-splash.png` (`100 x 100`) and `shard.png` (`16 x 16`),
// and the three sheets `spark/0.png` to `3.png` (`80 x 80`), `sconce/0.png`
// to `3.png` (`24 x 24`) and `flare/0.png` to `5.png` (`128 x 128`), all
// under `assets/sprites/effects/`. Each is committed, decodes, sits on
// exactly the canvas its row states, and carries non-transparent paint.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"): the
// table gives every effect its weapon, its files, its form ("one sprite" or
// "a sheet of `4`"), and its canvas, and the paragraph opening the sprites
// fixes each canvas exactly and states that a sheet's frames are separate PNG
// files numbered from `0`. `EFFECT_SPRITES` in `src/constants.ts` carries the
// same path, frame count, and canvas for each.
//
// WHAT IT DELIBERATELY DOES NOT READ. The six evolved effects are
// `assets/evolved-effect-sprites-produced`, and that each differs from its
// base's is `assets/evolved-effects-differ-from-base`. That the game draws an
// effect over the live shape, scaled to it, for the flash or the life its row
// states, belongs to each weapon's own points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on.
//
// THE TOLERANCE. Each canvas is exact, because the specification states it
// exactly. The paint floor is `PAINT_MIN_SHARE`, one pixel in a thousand:
// seventeen pixels of a `128 x 128` burst frame, so even the faintest tail of
// a burst played once clears it, while a canvas nothing was drawn on fails.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  BASE_EFFECTS,
  readSprites,
  showSprites,
} from "./produced";

const FILES = BASE_EFFECTS.flatMap((effect) => effect.frames);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits every base weapon's effect at its canvas and frame count", async () => {
  const reads = await readSprites(FILES);
  await showSprites(h, FILES);
  captureStill(h, "effects");

  assertProduced(reads);
});
