// presentation/overlay-toggled-by-backquote — the backtick key shows and hides
// the debug overlay.
//
// specs/instrumentation.md § Diagnostics, for a build on no engine: "The overlay
// is part of the runtime layer you write. It draws the registered sources, IT IS
// SHOWN AND HIDDEN BY THE BACKTICK KEY (`KeyboardEvent.code` `Backquote`), it is
// off until toggled, and it reads the game without changing it."
//
// So this point is the toggle itself: one press puts the panel on the stage, and
// the next takes it off again, leaving the picture the game was drawing.
//
// THE READING IS THE WHOLE STAGE, counted rather than sampled, because where a
// build puts its panel is its own business — the specification asks only that it
// be "visually plain and clearly separate from the game's own display". What is
// fixed is that showing it changes a substantial part of the picture and hiding
// it gives that part back.
//
// IT IS TAKEN ON A STILL SCREEN. The build screen of an emptied site is drawn
// from state that nothing is changing: "Off the run screen nothing ticks"
// (specs/instrumentation.md § The clock), no run is under way and no pointer or
// key is held, so any pixel that differs between two of these pictures differs
// because of the toggle. The press itself is `keyDown`, a frame, `keyUp`, which
// is the press a build reading held keys at the top of a frame and one latching
// the event both see.
//
// THE TWO FIGURES. A panel carrying the sources § Diagnostics asks a build to
// register — the screen and site, the structure's member count, cost and issue
// count, the run's phase, step, clock and cause, four axis values, the bob's
// position, the highest utilization, the broken count, and the camera pose, each
// "short enough to read on a line" — is a dozen legible lines, which cannot cover
// less than a fifth of one per cent of a 1280 x 720 stage. And the picture that
// comes back after the second press must be the first one: the allowance below is
// noise, a twentieth of one per cent, not room for a panel.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The key the specification names, as a `KeyboardEvent.code`. */
const TOGGLE = "Backquote";

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;

/** The share of the stage a shown panel must cover, and the noise allowed. */
const PANEL_SHARE = 0.002;
const NOISE_SHARE = 0.0005;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * The screen layer as this frame drew it.
 *
 * THE SCREEN LAYER AND NOT THE WHOLE FRAME, and for this point that is the
 * sharper reading rather than a weaker one. The engine draws the yard through
 * WebGL and composites its 2D screen layer over the result, and the debug overlay
 * is chrome on that layer — so what this picture holds is the readouts, the menus
 * and the panel, over transparency where the yard would be. There is no
 * rasterizer for the other half in this project (`validation/host.ts` gives three
 * a WebGL2 context that answers every call and draws nothing), and the yard is
 * not what this point is about.
 */
async function picture(harness: Harness): Promise<Picture> {
  const png = await harness.screenPng();
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

it("shows the overlay on the backtick key and hides it on the next", async () => {
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

  await h.press(TOGGLE);
  await h.advance(1);
  const shown = await picture(h);
  await h.capture("on", "The stage with the overlay shown");

  await h.press(TOGGLE);
  await h.advance(1);
  const hidden = await picture(h);

  assertGreaterThan(
    differing(before, shown) / pixels,
    PANEL_SHARE,
    `the share of the stage that the ${TOGGLE} key draws over, on a screen ` +
      "where nothing else is changing: the overlay is shown by the backtick " +
      "key and draws the diagnostic sources the specification asks a build to " +
      "register (specs/instrumentation.md § Diagnostics)",
  );

  assertLessThan(
    differing(before, hidden) / pixels,
    NOISE_SHARE,
    `the share of the stage still standing apart from the picture before the ` +
      `first press once ${TOGGLE} has been pressed a second time: the ` +
      "backtick key hides the overlay again, leaving the game's own display " +
      "(specs/instrumentation.md § Diagnostics)",
  );
});
