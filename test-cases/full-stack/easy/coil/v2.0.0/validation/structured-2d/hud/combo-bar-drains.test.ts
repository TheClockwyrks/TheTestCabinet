// hud/combo-bar-drains — the combo bar shrinks as the window is spent.
//
// specs/ui.md: the combo readout carries "a bar beneath it", and "The bar drains
// from full to empty over the combo window as `specs/scoring.md` states, so a
// player reads at a glance how much of the window is left." A bar that never
// moves reads as a decoration, and the window is the one thing in Coil a player
// has to time.
//
// WHAT IS MEASURED, AND WHY IT IS THE ONLY FAIR MEASUREMENT. The bar may be any
// mark a build likes — a strip, a ring, a row of pips — so nothing about its shape
// or place can be assumed. What CAN be read is how much colour the combo readout
// puts into the HUD band, and the specification supplies the empty reference
// itself: "the combo area is empty at `M` of `1`", so a frame at a multiplier of
// one is the band with no combo readout on it at all. The same board is then
// rendered twice more at the same multiplier of three, once with a full window and
// once with the window nearly spent, and each is measured against that empty
// frame. Everything else in the band — the score, the best, the mode, the mute
// indicator, and the `x3` above the bar — is identical in both, so it cancels, and
// what is left is the bar.
//
// The board is posed identically for all three renders and the chain is held
// still, so nothing but the window differs between them.

import { afterEach, beforeEach, it } from "vitest";
import { COMBO_WINDOW } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
  type Scene,
} from "../harness";
import { bandInk, readBand } from "./band";

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

afterEach(() => {
  h?.dispose();
});

it("paints more of the HUD band at a full window than at a spent one", async () => {
  // The band with no combo readout on it: the reference both bars are counted
  // against (specs/ui.md, "the combo area is empty at M of 1").
  poseScene(h, { ...BOARD, combo: 1, comboWindow: 0 });
  await h.advance(1);
  const empty = readBand(h);

  const full = poseScene(h, {
    ...BOARD,
    combo: COMBO,
    comboWindow: COMBO_WINDOW,
  });
  await h.advance(1);
  const atFull = readBand(h);
  captureStill(h, "full");
  assertEqual(full.comboWindow, COMBO_WINDOW, "the window the bar is full at");

  const spent = poseScene(h, {
    ...BOARD,
    combo: COMBO,
    comboWindow: NEARLY_SPENT,
  });
  await h.advance(1);
  const atSpent = readBand(h);
  captureStill(h, "spent");
  assertEqual(spent.combo, COMBO, "the multiplier the spent bar is read at");

  assertGreaterThan(
    bandInk(empty, atFull),
    bandInk(empty, atSpent),
    "colour the combo readout put into the HUD band, full window against spent",
  );
});
