// presentation/overlay-hidden-by-a-second-backquote — a second backtick press
// hides the debug overlay again.
//
// specs/instrumentation.md § Diagnostics, for a build on no engine: "The
// overlay is part of the runtime layer you write. It draws the registered
// sources, IT IS SHOWN AND HIDDEN BY THE BACKTICK KEY (`KeyboardEvent.code`
// `Backquote`), it is off until toggled, and it reads the game without changing
// it."
//
// So this point is the second half of that toggle: with the panel up, the next
// press takes it off again, leaving the picture the game was drawing.
//
// AND IT ASKS NOTHING OF THE FIRST PRESS. The press that raises the panel is
// setup here, carrying no assertion and no capture: a build that draws no
// overlay at all passes this point vacuously and fails
// `overlay-shown-by-backquote`, which is the point that names that defect.
// Asserting the panel appeared would grade a build that never draws one exactly
// as hard as one that shows a panel it will not hide, which is the collapse the
// two points were split to avoid.
//
// THE READING IS THE WHOLE STAGE, counted rather than sampled, because where a
// build puts its panel is its own business — the specification asks only that
// it be "visually plain and clearly separate from the game's own display". What
// is fixed is that hiding it gives that part of the picture back, so what
// stands after the second press is the picture that was there before the first.
//
// IT IS TAKEN ON A STILL SCREEN. The build screen of an emptied site is drawn
// from state that nothing is changing: "Off the run screen nothing ticks"
// (specs/instrumentation.md § The clock), no run is under way and no pointer or
// key is held, so any pixel that differs between two of these pictures differs
// because of the toggle. The press itself is `keyDown`, a frame, `keyUp`, which
// is the press a build reading held keys at the top of a frame and one latching
// the event both see.
//
// THE FIGURE. The picture that comes back after the second press must be the
// one that stood before the first: the allowance below is noise, a twentieth of
// one per cent of a 1280 x 720 stage, and not room for a panel. The sources §
// Diagnostics asks a build to register — the screen and site, the structure's
// member count, cost and issue count, the run's phase, step, clock and cause,
// four axis values, the bob's position, the highest utilization, the broken
// count, and the camera pose, each "short enough to read on a line" — are a
// dozen legible lines, and a dozen legible lines do not fit inside it.

// WHY THIS ONE STILL READS THE PICTURE, when nothing else in this project does.
//
// Every other check about drawing asks `drawn()`, which is the frame's own
// account of what it put on screen. This one cannot: what it is about is the
// DEBUG OVERLAY, and `specs/instrumentation.md` gives the panel to a different
// owner on each engine — "The overlay is part of the runtime layer you write"
// with no engine, and "Drawing the panel, showing and hiding it with the
// backtick key … are the engine's" under both of them. So under two of the
// three engines the panel is not the build's drawing at all, and there is
// nothing for a build to report about it. Neither engine exposes whether its
// panel is up.
//
// The picture is therefore the only instrument that answers the same question
// on all three, and the question — is the panel there — is one a reader can
// settle at a glance from the still beside the verdict.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertEqual, assertLessThan } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The key the specification names, as a `KeyboardEvent.code`. */
const TOGGLE = "Backquote";

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;

/** The share of the stage a hidden panel may leave behind: noise, no more. */
const NOISE_SHARE = 0.0005;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

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

/** How many pixels two pictures are drawn differently at. */
function differing(a: Picture, b: Picture): number {
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const gap = Math.hypot(
      a.data[i]! - b.data[i]!,
      a.data[i + 1]! - b.data[i + 1]!,
      a.data[i + 2]! - b.data[i + 2]!,
    );
    if (gap > CHANGED) count += 1;
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

it("hides the overlay on a second backtick press", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).screen,
    "build",
    "the screen this reading is taken on, which nothing is ticking on " +
      "(specs/instrumentation.md § The clock)",
  );

  const before = await picture(h);
  const pixels = before.width * before.height;

  // Setup, and nothing is asked of it: putting the panel up is the other point.
  await h.press(TOGGLE);
  await h.advance(1);

  await h.press(TOGGLE);
  await h.advance(1);
  const hidden = await picture(h);
  await h.capture("off-again", "The stage after a second backtick press");

  assertLessThan(
    differing(before, hidden) / pixels,
    NOISE_SHARE,
    `the share of the stage still standing apart from the picture before the ` +
      `first press once ${TOGGLE} has been pressed a second time: the ` +
      "backtick key hides the overlay again, leaving the game's own display " +
      "(specs/instrumentation.md § Diagnostics)",
  );
});
