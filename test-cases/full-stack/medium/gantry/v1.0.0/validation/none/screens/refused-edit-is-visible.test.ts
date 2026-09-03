// screens/refused-edit-is-visible — a refused edit shows on the build screen in
// the moment it is refused.
//
// specs/ui.md § Build: "A refused edit is visible in the moment it is refused, in
// whatever form suits the look, so a player is never left wondering why a click
// did nothing." specs/controls.md § The build tools says the same from the
// editor's side: "Every edit passes through the rules in specs/structure.md, and a
// refused edit changes nothing on screen beyond the refusal being visible in the
// moment (specs/ui.md)."
//
// THE REFUSAL IS THE ONE THAT NEEDS NO PARTICULAR NODE. specs/structure.md refuses
// a second slew ring — "A ring placement is refused when the structure already has
// one" — so with a ring standing and the ring tool selected, a click that picks
// ANY node is refused, and the check does not have to reason about which node a
// build's picking rules take. That the click picked a node at all is read from
// `pick` before it is delivered, because a click that picks nothing "does nothing"
// and would leave the point undecided rather than failed.
//
// AND THE YARD HOLDS THE RING AND NOTHING ELSE. What this point is about is the
// editor answering a refused click, so the structure is exactly what makes the
// click a refusal: one ring, placed on the empty site, which specs/structure.md
// accepts there (its flange nodes are inside site 1's envelope, its base corner's
// `y` is not `0`, no member joins anything to anything, and `RING_COST` (`300`) is
// well inside the budget of `3000`). A crane standing behind it would be sixty
// more members whose drawing this point never reads, and every one of them
// another way for a build to fail this item for a reason belonging elsewhere.
//
// WHAT IS ASSERTED IS THAT THE PICTURE CHANGED, and nothing about the form: the
// specification leaves that to the build ("in whatever form suits the look"). The
// frame is compared with a baseline taken with the pointer already parked over the
// node, so the pointer's own highlight is in both pictures and only the refusal
// separates them; the release is over before the frames are read, so a cursor
// drawn differently while a button is held is in neither. A build whose build
// screen is never still — an idle animation, a drifting light — would differ from
// its own baseline for reasons of its own, so ten frames of the same screen with
// no input are taken FIRST and every pixel they move is set aside.
//
// AND THE FRAMES AFTER THE CLICK ARE READ ONLY UNTIL ONE OF THEM SHOWS IT. What
// the specification asks for is that the refusal be visible, so the first frame
// that draws it settles the point and there is nothing further to learn from the
// nine behind it. A build that never shows it is the only one that reads all ten.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertEqual, assertNotNull, fail } from "../assert";
import {
  clearAll,
  createHarness,
  nodePoint,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** A ring's base corner as one comparable value, or the absence of a ring. */
function ringOf(ring: { corner: Vec3 } | null): string {
  return ring === null
    ? "no ring"
    : `(${ring.corner.x}, ${ring.corner.y}, ${ring.corner.z})`;
}

/** The lattice node the click is aimed at: inside every site's envelope. */
const AIM = { x: 4, y: 0, z: 4 } as const;

/** The one thing standing in the yard: the ring the second click is refused by. */
const RING = { x: 0, y: 2, z: 0 } as const;

/** How many frames after the refusal are looked at, at most. */
const FRAMES = 10;

/** A picture of the page, RGBA, four bytes per pixel, row-major. */
interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The page as it stands, composited: the 3D yard with the readouts over it. */
async function picture(harness: Harness): Promise<Picture> {
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await harness.paintFrame();
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

/** Every pixel `shot` draws differently from `baseline`, as a mask. */
function differences(baseline: Picture, shot: Picture): Uint8Array {
  const mask = new Uint8Array(baseline.width * baseline.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const i = pixel * 4;
    if (
      baseline.data[i] !== shot.data[i] ||
      baseline.data[i + 1] !== shot.data[i + 1] ||
      baseline.data[i + 2] !== shot.data[i + 2]
    ) {
      mask[pixel] = 1;
    }
  }
  return mask;
}

/** How many pixels `shot` moves that `moving` does not already move. */
function movedBeyond(
  baseline: Picture,
  shot: Picture,
  moving: Uint8Array,
): number {
  const mask = differences(baseline, shot);
  let count = 0;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] === 1 && moving[pixel] !== 1) count += 1;
  }
  return count;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows a refused edit in the moment it is refused", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.setTool("ring");

  const standing = await h.snapshot();
  assertNotNull(
    standing.structure.ring,
    `the slew ring at (${RING.x}, ${RING.y}, ${RING.z}), which the empty site ` +
      "accepts and which is what makes the click below a refused one " +
      "(specs/structure.md § The slew ring)",
  );

  const aim = await nodePoint(h, AIM);
  await h.pointerMove(aim.x, aim.y);
  await h.advance(2);

  const parked = await h.snapshot();
  assertNotNull(
    parked.pick.node,
    "a node under the pointer, so the click below is one the editor refuses " +
      "rather than one that picks nothing (specs/controls.md § Clicks and " +
      "drags)",
  );

  const baseline = await picture(h);
  const moving = new Uint8Array(baseline.width * baseline.height);
  for (let frame = 0; frame < FRAMES; frame += 1) {
    await h.advance(1);
    const still = differences(baseline, await picture(h));
    for (let pixel = 0; pixel < moving.length; pixel += 1) {
      if (still[pixel] === 1) moving[pixel] = 1;
    }
  }

  await h.pointerDown(aim.x, aim.y);
  await h.advance(1);
  await h.pointerUp();

  let shown = 0;
  for (let frame = 0; frame < FRAMES && shown === 0; frame += 1) {
    await h.advance(1);
    shown = movedBeyond(baseline, await picture(h), moving);
    if (frame === 0) {
      await h.capture("refusal", "The frame showing a refused edit");
    }
  }

  const refused = await h.snapshot();
  assertEqual(
    ringOf(refused.structure.ring),
    ringOf(standing.structure.ring),
    "the ring the structure still carries, so the click was refused and " +
      "moved nothing (specs/structure.md § Editing)",
  );
  assertEqual(
    refused.structure.members.length,
    0,
    "the members the structure holds, so the refused click placed nothing " +
      "(specs/structure.md § Editing)",
  );
  assertEqual(
    refused.historyDepth,
    parked.historyDepth,
    "the undo history the refused click left, which a refused edit does not " +
      "push to (specs/structure.md § Editing)",
  );
  if (shown === 0) {
    fail(
      "the refused click to show on the build screen in the moment it was " +
        "refused, so a player is never left wondering why a click did " +
        `nothing (specs/ui.md § Build): some of the ${FRAMES} frames after ` +
        "it differs from the frame before it",
      "every one of them is drawn exactly as the screen was before the click",
    );
  }
});
