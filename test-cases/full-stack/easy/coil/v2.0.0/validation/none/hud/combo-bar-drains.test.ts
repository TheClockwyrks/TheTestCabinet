// hud/combo-bar-drains — the combo bar tracks the window it is drawn for.
//
// specs/ui.md: the combo readout carries "a bar beneath it", and "The bar drains
// from full to empty over the combo window as `specs/scoring.md` states, so a
// player reads at a glance how much of the window is left." A bar that never
// moves reads as a decoration, and the window is the one thing in Coil a player
// has to time.
//
// WHAT IS READ. The bar may be any mark a build likes — a strip, a ring, a row of
// pips, a dim track with a bright fill over it — so nothing about its shape, its
// place, its colour or how much of the band it covers can be assumed, and how far
// a bar moved is the presentation domain's aesthetic rating. What CAN be read is
// that it moved at all: the same board is rendered twice at the same multiplier,
// once with a full window and once with the window nearly spent, and the two
// bands are compared point by point. Everything else in the band — the score, the
// best, the mode, the mute indicator, and the `x3` above the bar — is identical
// in the two frames, so it cancels, and what is left is the bar. A bar drawn for
// the window it is under differs between the two; one that ignores the window
// comes back the same picture twice.
//
// The board is posed identically for both renders and the chain is held still, so
// nothing but the window differs between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { COMBO_WINDOW } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
  type Scene,
} from "../harness";
import { bandDifferences, readBand } from "./band";

/** The multiplier both bar renders are taken at. */
const COMBO = 3;

/** A window with a fourteenth of itself left: drawn as near empty as it gets. */
const NEARLY_SPENT = COMBO_WINDOW / 14;

/** The board every render is taken over, so only the window differs. */
const BOARD: Scene = {
  snake: chainFrom(HOME_HEAD, "right", 4),
  dir: "right",
  pellet: null,
  travel: false,
  score: 480,
  best: 960,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a different HUD band at a full window than at a spent one", async () => {
  const full = await poseScene(h, {
    ...BOARD,
    combo: COMBO,
    comboWindow: COMBO_WINDOW,
  });
  await h.advance(1);
  const atFull = await readBand(h);
  await captureStill(h, "full");
  assertEqual(full.comboWindow, COMBO_WINDOW, "the window the bar is full at");

  const spent = await poseScene(h, {
    ...BOARD,
    combo: COMBO,
    comboWindow: NEARLY_SPENT,
  });
  await h.advance(1);
  const atSpent = await readBand(h);
  await captureStill(h, "spent");
  assertEqual(spent.combo, COMBO, "the multiplier the spent bar is read at");

  assertGreaterThan(
    bandDifferences(atFull, atSpent),
    0,
    "points of the HUD band that differ between a full window and a spent one",
  );
});
