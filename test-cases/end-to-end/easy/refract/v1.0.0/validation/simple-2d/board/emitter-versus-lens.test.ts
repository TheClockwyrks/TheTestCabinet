// Refract — board/emitter-versus-lens: an emitter reads as outlined against a
// lens's fill.
//
// specs/board.md: an emitter and a lens of the same channel share one
// silhouette and differ only by outline against fill, so a player reads a
// node's channel and its role in the same glance. The check poses both roles
// of one channel on one board (R3_REDRAW, "TtT") and reads the difference the
// specification states, in the review item's figures:
//
//   - the lens is FILLED: its center cluster differs from the background
//     sample by more than 50 of 441;
//   - the emitter is OPEN: its center cluster stays within 25 of 441 of the
//     background at its center;
//   - yet the emitter is THERE: somewhere on a sweep of the radii inside
//     NODE_R (30), a pixel differs from the background by more than 50 — the
//     outline.
//
// WHICH BACKGROUND THE OPEN CENTER IS HELD TO. "The background at its
// center": an open center shows through whatever ground the build laid
// there, and specs/board.md lets that ground carry quiet texture — the
// empty-cells item allows it a full 50 of drift from the far-field
// background sample, which is twice this item's 25. So the open reading is
// taken against the LOCAL ground, sampled just outside the emitter's hit
// radius, where the same texture sits; the far-field sample would fail a
// perfectly open emitter for the bench's own legal shading. The loud
// checks (the fill, the outline) stay against the background sample: they
// clear 50 over any ground within the empty-cells allowance.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { R3_REDRAW } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleBackground,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { NODE_R } from "../notation";

/** The review item's distance: clearly apart from the background. */
const APART_MIN = 50;

/** The review item's distance: an open center reads as background. */
const OPEN_MAX = 25;

/** Radii swept for the emitter's outline: inside NODE_R, clear of the exact
 * center pixel the open check already read. */
const SWEEP_RADII_FROM = 2;

/** How far from the emitter's center its local ground is sampled: outside
 * NODE_HIT_R (44), clear of the neighbouring lens's NODE_R box. */
const GROUND_R = 64;

/** Pixels sampled around each swept radius. */
const SWEEP_ANGLES = 48;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The single rendered pixel at a logical point, as an Rgb. */
function pixelColor(x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

it("fills the lens, leaves the emitter's center open, and draws its outline", async () => {
  await resetTo(h, 1);
  // R3_REDRAW, "TtT": an emitter at (0,0) and a lens at (1,0) of one channel.
  await loadBoard(h, R3_REDRAW);
  captureStill(h, "pair");

  const background = sampleBackground(h);
  const emitter = nodeCenter(0, 0, 3, 1);
  const lens = nodeCenter(1, 0, 3, 1);

  // The lens is filled: its center is clearly apart from the background.
  assertGreaterThan(
    colorDistance(sampleColor(h, lens.x, lens.y), background),
    APART_MIN,
    "the lens's filled center (specs/board.md: a lens is the filled " +
      "silhouette of its channel)",
  );

  // The emitter's center is open: it reads as the ground it sits on. The
  // local ground is the average of three samples just outside the hit
  // radius, away from the lens beside it.
  const grounds = [
    sampleColor(h, emitter.x - GROUND_R, emitter.y),
    sampleColor(h, emitter.x, emitter.y - GROUND_R),
    sampleColor(h, emitter.x, emitter.y + GROUND_R),
  ];
  const ground = {
    r: (grounds[0].r + grounds[1].r + grounds[2].r) / 3,
    g: (grounds[0].g + grounds[1].g + grounds[2].g) / 3,
    b: (grounds[0].b + grounds[1].b + grounds[2].b) / 3,
  };
  assertLessThanOrEqual(
    colorDistance(sampleColor(h, emitter.x, emitter.y), ground),
    OPEN_MAX,
    "the emitter's open center against the background at its center " +
      "(specs/board.md: an emitter is the OUTLINED silhouette, so its " +
      "center shows the background through)",
  );

  // Yet the emitter is drawn: somewhere inside NODE_R its outline stands
  // apart from the background.
  let loudest = 0;
  for (let radius = SWEEP_RADII_FROM; radius < NODE_R; radius += 1) {
    for (let step = 0; step < SWEEP_ANGLES; step += 1) {
      const angle = (2 * Math.PI * step) / SWEEP_ANGLES;
      const sample = pixelColor(
        emitter.x + radius * Math.cos(angle),
        emitter.y + radius * Math.sin(angle),
      );
      loudest = Math.max(loudest, colorDistance(sample, background));
    }
  }
  assertGreaterThan(
    loudest,
    APART_MIN,
    "the emitter's outline somewhere on the radius sweep inside NODE_R (30)",
  );
});
