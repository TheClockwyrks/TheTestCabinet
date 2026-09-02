// presentation/text-legible — every word the game puts on the screen stands off
// the ground it is drawn on.
//
// THE RULE. specs/overview.md's legibility table: "Every readout and every
// screen's text is legible against its background at the logical stage size." So
// the item is not about what any screen SAYS — specs/screens.md and specs/hud.md
// own that, and the `screens` and `hud` groups check it — but about whether what
// it says can be read: a readout drawn a shade off its own panel, or a menu entry
// in the colour of the plate behind it, is a readout a player does not have.
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
// THE INK AND THE GROUND, AND WHY NEITHER IS A COLOUR. specs/overview.md fixes no
// palette, so both are read off the picture. The ground is the colour that occurs
// MOST OFTEN in the run's own box — text covers a minority of the box it is laid
// in, whatever the face — and the ink is the pixel furthest from it. The reading
// is symmetric in the two: a run whose glyphs happen to cover more of its box
// than its ground does reads the same distance the other way round, so a build is
// never failed for drawing large type. What it cannot survive is the two being
// the same colour.
//
// AND WHY IT IS A COLOUR DISTANCE AND NOT A LUMINANCE RATIO. A contrast ratio
// would demand that a build's text differ from its ground in BRIGHTNESS, and
// specs/overview.md gives the palette and the type to the build; a readout drawn
// in a saturated hue against an equally bright ground is a design choice the
// specification allows and a player reads. So the bar is the same one this whole
// group calls "plainly apart", applied to a run and its ground.
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
import { STAGE_H, STAGE_W } from "../constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
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
import { furthestFrom, modal, pixelAt, showRgb } from "./read";

/**
 * How far a run's ink must sit from the ground under it, out of the 441 the RGB
 * cube spans.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at: a build whose
 * readouts clear it has text a player picks out of its panel at a glance, and one
 * that does not has drawn a watermark.
 */
const CONTRAST_MIN = 50;

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

it.each(SCENES)("draws every run of text on $name legibly", async (scene) => {
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

  for (const run of runs) {
    const read: Rgb[] = runPoints(run).map((point) =>
      pixelAt(h, point.x, point.y),
    );
    const ground = modal(read);
    const ink = furthestFrom(read, ground);
    assertGreaterThanOrEqual(
      colorDistance(ink, ground),
      CONTRAST_MIN,
      `${scene.name}: the run "${run.text}", which the frame drew at ` +
        `(${Math.round(run.x)}, ${Math.round(run.y)}) — the strongest ink ` +
        `left on the finished picture there (${showRgb(ink)}) against the ` +
        `ground it is laid on (${showRgb(ground)}), out of 441 ` +
        `(specs/overview.md: every readout and every screen's text is legible ` +
        `against its background at the logical stage size)`,
    );
  }
});
