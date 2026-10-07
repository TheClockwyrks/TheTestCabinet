// presentation/text-legible — every run of text the game draws reaches the
// finished picture.
//
// THE RULE. specs/overview.md's legibility table: "Every readout and every
// screen's text is legible against its background at the logical stage size."
// What a check can decide of that is that the ink ARRIVED: the run the build
// submitted left something on the frame a player sees. How readable the result is
// — the face, the size, the colour it chose against the panel behind it — is
// appearance, which the same specification hands to the build ("The palette, the
// type, the glow, and every other aspect of the look are yours") and the
// reviewer's presentation rating judges. So the point is not about what any
// screen SAYS — specs/screens.md and specs/hud.md own that, and the `screens` and
// `hud` groups check it.
//
// WHY THIS IS NOT ALREADY CARRIED BY `hud` AND `screens`. Those groups read the
// runs the build SUBMITTED. A build that submits a run and then paints over it,
// or draws it in the exact colour of the ground under it, satisfies every one of
// them and puts nothing on the screen. This point is the one reading taken off
// the finished frame instead.
//
// WHY EVERY RUN, AND WHY IT IS FOUND RATHER THAN LISTED. specs/hud.md leaves
// where each element sits entirely to the build, and specs/screens.md fixes what
// a screen names rather than how it is laid out. So nothing here names a
// position: the frame is asked which runs of text it drew and where it drew them,
// through the transform in force at each call (`drawnTextSpans` in harness.ts),
// and EVERY one of them is read. A build that adds a readout of its own is held
// to the same bar as the ones the specification asked for, which is what "every
// readout" says.
//
// WHERE A RUN'S PIXELS ARE, WITHOUT KNOWING THE TYPE. A canvas run is drawn from
// an anchor whose vertical meaning is the build's `textBaseline` — the glyphs may
// sit above it, on it, or below it — and at a size no specification fixes. So the
// run is read across five rows spread eight units either side of its anchor, and
// along the horizontal extent the context itself measured for it, laid out about
// the anchor as its alignment places it. Whichever baseline convention a build
// uses, and at any size from a readout's to a title's, those rows cross the body
// of the glyphs.
//
// THE INK, THE GROUND, AND WHERE THE BAR COMES FROM. specs/overview.md fixes no
// palette, so both are read off the picture. The ground is the colour that occurs
// MOST OFTEN in the run's own box — text covers a minority of the box it is laid
// in, whatever the face — and the ink is the pixel furthest from it. The bar is
// not a stated contrast: the same box is read on two consecutive frames, which is
// how much the build's own animation moves it, and the ink has to beat that by
// `NOISE_MARGIN`. A build that lays its text in the ground's own colour, or
// paints over it, leaves a box that reads as one flat colour and clears nothing.
//
// THE READING IS OF THE FINISHED FRAME. The pixels are read after the frame has
// been drawn, not at the moment of the call, so a run drawn in the ground's own
// colour and a run drawn and then painted over both read as nothing — which is
// what a player gets from either.
//
// WHAT IT DOES NOT DECIDE. What each screen and each readout must SAY, which the
// `screens` and `hud` groups own; where they sit, which `floor.panel-strip` and
// `hud.touch-targets` own; and whether a control's state reads, which
// `hud.mute-read` owns.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextSpans,
  renderFrame,
  startRun,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";
import { poseStillTower } from "./pose";
import {
  NOISE_MARGIN,
  furthestFrom,
  largestShift,
  modal,
  pixelAt,
  showRgb,
} from "./read";

/**
 * The rows a run is read on, in logical units from its anchor.
 *
 * Spread eight units either side of it, which is where the glyphs are under every
 * `textBaseline` a build may have set — above the anchor with the default
 * alphabetic baseline, about it with `middle`, below it with `top` — at any size
 * from the smallest readout to a title.
 */
const ROWS: readonly number[] = [-8, -4, 0, 4, 8];

/**
 * How much of a long run is read, in logical units: the leading stretch.
 *
 * A run's own first characters are drawn in the same ink on the same ground as
 * the rest of it, and reading a full screen-width line of prose at every row
 * would read the whole stage rather than the run.
 */
const MAX_WIDTH = 60;

/** The narrowest measured run that is read at all, in logical units. */
const MIN_WIDTH = 1;

/** Every point one run of text is read at. */
function runPoints(run: TextSpan): { x: number; y: number }[] {
  const to = Math.min(run.right, run.left + MAX_WIDTH);
  const points: { x: number; y: number }[] = [];
  for (let x = Math.ceil(run.left); x <= Math.floor(to); x += 1) {
    for (const dy of ROWS) points.push({ x, y: run.y + dy });
  }
  return points;
}

/** Whether a run has glyphs on the stage at all, so there is something to read. */
function onStage(run: TextSpan): boolean {
  return (
    run.text.trim().length > 0 &&
    run.right - run.left >= MIN_WIDTH &&
    run.y >= 0 &&
    run.y <= STAGE_H &&
    run.right >= 0 &&
    run.left <= STAGE_W
  );
}

/** One state to read: a name, and how to pose it. */
interface Scene {
  name: string;
  pose: (h: Harness) => void;
  /** The review output this scene's picture is kept as, where it is kept. */
  capture?: string;
}

/**
 * Every state of the game that puts words on the screen: the four screens with no
 * floor behind them, the panel in its three states, the pause menu over a live
 * floor, and the two end screens. Between them they cover every run of text
 * specs/screens.md and specs/hud.md ask for.
 */
const SCENES: readonly Scene[] = [
  {
    name: "the title screen",
    pose: (h) => {
      h.debug.reset();
      h.debug.setScreen("title");
    },
  },
  {
    name: "the mode-select screen",
    pose: (h) => {
      h.debug.reset();
      h.debug.setScreen("modeselect");
    },
  },
  {
    name: "the difficulty-select screen",
    pose: (h) => {
      h.debug.reset();
      h.debug.setScreen("difficultyselect");
    },
  },
  {
    name: "the how-to screen",
    pose: (h) => {
      h.debug.reset();
      h.debug.setScreen("howto");
    },
  },
  {
    name: "the panel over a live floor",
    pose: (h) => {
      startRun(h);
    },
    capture: "text",
  },
  {
    name: "the panel with a shop entry hovered and a preview held",
    pose: (h) => {
      startRun(h);
      h.debug.setHoverShop("lance");
      h.debug.setArmed("lance");
      h.debug.setPreview(20, 20);
    },
  },
  {
    name: "the inspector on a selected tower",
    pose: (h) => {
      startRun(h);
      const id = poseStillTower(h, "rime", 12, 8, 0, 40);
      h.debug.setSelected(id);
    },
  },
  {
    name: "the pause screen",
    pose: (h) => {
      startRun(h);
      h.debug.setScreen("paused");
    },
  },
  {
    name: "the victory screen",
    pose: (h) => {
      startRun(h);
      h.debug.setScreen("victory");
    },
  },
  {
    name: "the game-over screen",
    pose: (h) => {
      startRun(h);
      h.debug.setScreen("gameover");
    },
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(SCENES)(
  "draws every run of text on $name onto the frame",
  async (scene) => {
    scene.pose(h);
    await renderFrame(h);
    if (scene.capture !== undefined) captureStill(h, scene.capture);

    const runs = drawnTextSpans(h).filter(onStage);
    assertGreaterThan(
      runs.length,
      0,
      `${scene.name} draws at least one run of text (specs/overview.md: every ` +
        `readout and every screen's text is legible)`,
    );

    const boxes = runs.map(runPoints);
    const before = boxes.map((box) =>
      box.map((point) => pixelAt(h, point.x, point.y)),
    );
    await renderFrame(h);

    for (const [index, run] of runs.entries()) {
      const read: Rgb[] = boxes[index].map((point) =>
        pixelAt(h, point.x, point.y),
      );
      const noise = largestShift(before[index], read);
      const ground = modal(read);
      const ink = furthestFrom(read, ground);
      assertGreaterThanOrEqual(
        colorDistance(ink, ground),
        noise + NOISE_MARGIN,
        `${scene.name}: the run "${run.text}", which the frame drew at ` +
          `(${Math.round(run.x)}, ${Math.round(run.y)}) — the strongest ink ` +
          `left on the finished picture there (${showRgb(ink)}) against the ` +
          `ground it is laid on (${showRgb(ground)}), past the ${noise} that ` +
          `box moved between two frames on its own ` +
          `(specs/overview.md: every readout and every screen's text is legible ` +
          `against its background at the logical stage size)`,
      );
    }
  },
);
