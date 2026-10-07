// assets/evolved-effects-differ-from-base — an evolved tool's effect is a
// different picture from the one its base drew.
//
// WHAT THIS DECIDES. Six pairs: `pyre.png` against `taper.png`, `beacon.png`
// against `ember.png`, `hail.png` against `pin.png`, `chandelier.png` against
// `lantern.png`, `corona.png` against `halo.png`, and `blaze.png` against
// `oil-splash.png`. In each pair the two files are not the same picture.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// each evolution's effect is "visibly distinct from its base's so a player
// sees at a glance that the tool has transformed". Two files that are the
// same picture are distinct in nothing, so pixel identity is the floor that
// sentence puts under each pair. Whether the two are distinct ENOUGH to read
// at a glance in play is the art bar and the presentation domain's aesthetic
// rating, which is a person's to make.
//
// WHY THE PAIRS ARE THESE. `EVOLUTIONS` in `src/constants.ts` gives each
// evolution the base it comes `from`, which is the recipe
// `specs/evolutions.md` states, and the effect table lands each of the two on
// the same canvas — so a pair is two files a player sees one after the other
// for the same tool.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the six pairs side by
// side.
//
// THE TOLERANCE. `PIXEL_CHANNEL_EPS`, eight levels of 255 per channel: a PNG
// carries its pixels losslessly, so a base's file shipped again under the
// evolution's name differs by exactly nothing. That each of the twelve files
// exists at its canvas and carries paint is the two effect-produced points.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import { EVOLUTION_IDS, EVOLUTIONS } from "../constants";
import {
  assertNoTwoIdentical,
  effectSprites,
  readSprites,
  requireImages,
  showSprites,
} from "./produced";

/** Each evolution's effect beside the effect of the base it comes from. */
const PAIRS = EVOLUTION_IDS.map((id) => ({
  evolved: effectSprites(id)[0],
  base: effectSprites(EVOLUTIONS[id].from)[0],
}));

const FILES = PAIRS.flatMap((pair) => [pair.base, pair.evolved]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws each evolved effect as a different picture from its base's", async () => {
  await showSprites(h, FILES);
  captureStill(h, "pairs");

  for (const pair of PAIRS) {
    const images = requireImages(await readSprites([pair.base, pair.evolved]));
    assertNoTwoIdentical(images, [pair.base.path, pair.evolved.path]);
  }
});
