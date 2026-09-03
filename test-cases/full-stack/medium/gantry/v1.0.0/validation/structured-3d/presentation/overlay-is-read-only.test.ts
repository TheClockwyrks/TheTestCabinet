// presentation/overlay-is-read-only — showing the overlay leaves the game as it
// is.
//
// specs/instrumentation.md § Diagnostics: "The debug overlay shows the values the
// game registers with it as diagnostic sources... Keep each one short enough to
// read on a line, and KEEP EVERY SOURCE A PURE READ, SO WATCHING THE OVERLAY
// LEAVES THE GAME AS IT IS." The engineless paragraph says it again of the panel
// itself: "it reads the game without changing it."
//
// A SOURCE THAT WROTE would be read once a frame while the panel is up, so the
// reading has to be taken over a game that is MOVING and over many frames of it.
// The scenario is therefore a real run — the smallest crane that stands, an
// emptied yard, and a tape driving the trolley and then the slew — watched for a
// second of run clock. The verdict is the whole state compared EXACTLY, so a
// source that wrote is caught on the frame it wrote on rather than once its
// nudge has compounded into something visible; what the span buys is the number
// of frames the panel is read over, and sixty of them over a run whose axes are
// ramping and whose bob is swinging is what this reading needs.
//
// TWO GAMES, one watching the overlay and one not, are what makes "leaves the
// game as it is" a comparison rather than a guess. A run is deterministic — "a
// tape replayed over the same structure produces the same swing, the same
// tensions, and the same verdicts, tick for tick" (specs/rigging.md
// § Determinism), and nothing anywhere in the game reads randomness or the wall
// clock — so two identical runs stand in identical states, field for field, and
// the only difference between these two is that one of them was asked to draw the
// panel. The other is given a press of a key the game binds to nothing
// (specs/controls.md), so the two are driven frame for frame alike.
//
// THE VERDICT IS THE WHOLE SNAPSHOT, compared as a value: the screen, the site,
// the structure, the tape, the camera, the pointer, the pick, the run with its
// axes, pivot, bob, loads, forces and broken members, and the clock. That is the
// widest reading the surface offers of "the game as it is", and a source that
// wrote anywhere in it is caught wherever it wrote.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { UNBOUND_KEY } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The key the specification names, as a `KeyboardEvent.code`. */
const TOGGLE = "Backquote";

/** A tape that keeps the run moving for far longer than this reading watches. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "trolley", target: 3, rate: 2 }] },
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 10 }] },
];

/** Ticks watched: one second of run clock at TICK_HZ. */
const WATCHED = 60;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** The share of the stage a shown panel must cover. */
const PANEL_SHARE = 0.002;

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

/** Stand the crane up, append the tape, and start the run. */
async function stageRun(harness: Harness): Promise<void> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await standMinimalCrane(harness);
  await poseTape(harness, TAPE);
  await startRun(harness);
}

let watching: Harness;
let unwatched: Harness;

beforeEach(async () => {
  watching = await createHarness();
  unwatched = await createHarness();
});

afterEach(async () => {
  await watching.dispose();
  await unwatched.dispose();
});

it("leaves the game as it is while the overlay is shown", async () => {
  await stageRun(watching);
  await stageRun(unwatched);

  const before = await picture(watching);
  await watching.press(TOGGLE);
  await watching.advance(1);
  const shown = await picture(watching);
  await watching.capture("read-only", "The stage with the overlay shown");

  // The other game is driven frame for frame alike, on a key bound to nothing.
  await unwatched.press(UNBOUND_KEY);
  await unwatched.advance(1);

  assertGreaterThan(
    differing(before, shown) / (before.width * before.height),
    PANEL_SHARE,
    `the share of the stage the ${TOGGLE} key drew over, which this reading ` +
      "needs so that the game below really is being watched " +
      "(specs/instrumentation.md § Diagnostics)",
  );

  const watched = await runTicks(watching, WATCHED);
  const quiet = await runTicks(unwatched, WATCHED);

  assertEqual(
    watched.run.phase,
    "running",
    `the run after ${WATCHED} watched ticks, which this reading needs still ` +
      "under way so that the overlay was read over a moving game",
  );
  assertGreaterThan(
    watched.run.tick,
    WATCHED - 1,
    "the ticks the watched run covered (specs/instrumentation.md § The clock)",
  );

  assertDeepEqual(
    watched,
    quiet,
    `the whole state of the game after ${WATCHED} ticks with the overlay ` +
      "shown, against the same run driven identically without it: every " +
      "diagnostic source is a pure read, so watching the overlay leaves the " +
      "game as it is (specs/instrumentation.md § Diagnostics)",
  );
});
