// sprites/blocker-sprite — the inert rock an unharvested candidate hardens into.
//
// `specs/assets.md`: `blocker.png` at `40 x 40`, "the inert fused rock an
// unharvested candidate hardens into", and it has to read as dead — "no head, no
// muzzle, no glow". `specs/scrap-press.md` is what produces one: every candidate
// but the level's harvest hardens into a blocker at the wave's start.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
} from "../harness";
import { BLOCKER, canvasOf } from "./png";

it("produces the blocker at the size specs/assets.md fixes", async () => {
  const canvas = canvasOf(BLOCKER);
  assertEqual(
    canvas.width,
    BLOCKER.width,
    `the width of assets/${BLOCKER.path}`,
  );
  assertEqual(
    canvas.height,
    BLOCKER.height,
    `the height of assets/${BLOCKER.path}`,
  );

  const h = await createHarness();
  try {
    openYard(h);
    standBlocker(h, 10, 10);
    h.debug.clearSelection();
    await h.advance(1);
    captureStill(h, "blocker");
  } finally {
    h.dispose();
  }
});
