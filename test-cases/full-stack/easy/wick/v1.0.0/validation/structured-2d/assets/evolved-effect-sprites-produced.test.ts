// assets/evolved-effect-sprites-produced — every evolution's effect is
// committed at its path, on the canvas its base's effect uses, painted.
//
// WHAT THIS DECIDES. Six files: `assets/sprites/effects/pyre.png`
// (`120 x 40`), `beacon.png` (`16 x 16`), `hail.png` (`12 x 12`),
// `chandelier.png` (`28 x 28`), `corona.png` (`160 x 160`) and `blaze.png`
// (`100 x 100`) are committed, decode, sit on exactly those canvases, and
// each carries non-transparent paint.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "Each of the six evolved weapons has an effect of the same form, frame
// count, and canvas as its base's, at the path below", followed by the table
// naming each evolution's file. The base's canvas is the row above in the
// effect table — Pyre from Taper's `120 x 40`, Beacon from Ember's
// `16 x 16`, Hail from Pin's `12 x 12`, Chandelier from Lantern's `28 x 28`,
// Corona from Halo's `160 x 160`, Blaze from Oil Splash's `100 x 100` — and
// `EFFECT_SPRITES` in `src/constants.ts` carries the same figure for each.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each evolved effect is a different
// picture from its base's is `assets/evolved-effects-differ-from-base`; that
// the game swaps to it when the tool transforms belongs to the evolutions'
// own points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on.
//
// THE TOLERANCE. Each canvas is exact, because the specification states it
// exactly. The paint reading is presence: at least one pixel not clear.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  EVOLVED_EFFECTS,
  readSprites,
  showSprites,
} from "./produced";

const FILES = EVOLVED_EFFECTS.flatMap((effect) => effect.frames);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits all six evolved effects at their bases' canvases", async () => {
  const reads = await readSprites(FILES);
  await showSprites(h, FILES);
  captureStill(h, "evolved");

  assertProduced(reads);
});
