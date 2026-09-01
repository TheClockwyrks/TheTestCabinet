// assets/icons-distinct — the twenty-seven icons are twenty-seven pictures
// rather than one picture under several names.
//
// WHAT THIS DECIDES. That no two of the twenty-seven committed icons are the
// same picture.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The icons"): "Each is
// told from every other at a glance, and an evolved weapon's icon reads as a
// transformed version of its base's." Two icons drawn as the same picture are
// told from each other by nothing at all, so pixel identity is the floor that
// sentence puts under the set — an offer screen showing three of them, and a
// HUD showing twelve, only informs a player when each stands for one item.
// Whether two different pictures are different ENOUGH to read at 24 pixels is
// the art bar and the presentation domain's aesthetic rating, which is a
// person's to make.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the twenty-seven icons
// side by side.
//
// THE TOLERANCE. `PIXEL_CHANNEL_EPS`, eight levels of 255 per channel: a PNG
// carries its pixels losslessly, so one icon shipped under two names differs
// by exactly nothing, and eight levels sits far below any difference a player
// could see. That each icon exists at `24 x 24` and carries paint is
// `assets/icons-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNoTwoIdentical,
  ICON_SPRITES,
  readSprites,
  requireImages,
  showSprites,
} from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws each of the twenty-seven icons as a different picture", async () => {
  const reads = await readSprites(ICON_SPRITES);
  await showSprites(h, ICON_SPRITES);
  captureStill(h, "distinct");

  const icons = requireImages(reads);
  assertNoTwoIdentical(
    icons,
    ICON_SPRITES.map((sprite) => sprite.path),
  );
});
