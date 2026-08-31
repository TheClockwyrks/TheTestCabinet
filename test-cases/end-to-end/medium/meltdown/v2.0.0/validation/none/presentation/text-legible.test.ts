// presentation/text-legible — every word the game puts on the screen stands off
// the ground it is drawn on.
//
// THE RULE. `specs/overview.md`'s legibility table: "Text — Every readout and
// every screen's text is legible against its background at the logical stage
// size." So the item is not about what any screen SAYS — `specs/screens.md` and
// `specs/hud.md` own that, and `screens/` and `hud/` check it — but about whether
// what it says can be read: a readout drawn a shade off its own panel, or a menu
// entry in the colour of the plate behind it, is a readout a player does not have.
//
// WHY EVERY RUN, AND WHY IT IS FOUND RATHER THAN LISTED. `specs/hud.md` leaves
// where each element sits "entirely to the build", and `specs/screens.md` fixes
// what a screen names rather than how it is laid out. So nothing here names a
// position: the frame is asked which runs of text it drew and where it drew them,
// through the transform in force at each call, and EVERY one of them is read. A
// build that adds a readout of its own is held to the same bar as the ones the
// specification asked for, which is what "every readout" says.
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
// THE INK AND THE GROUND, AND WHY NEITHER IS A COLOUR. `specs/overview.md` fixes
// no palette, so both are read off the picture. The ground is the colour that
// occurs MOST OFTEN in the run's own box — text covers a minority of the box it is
// laid in, whatever the face — and the ink is the pixel furthest from it. That is
// a comparison between two things the same build drew, and it holds equally for
// dark text on a light panel and light text on a dark one.
//
// WHY THE FIGURE IS A COLOUR DISTANCE AND NOT A LUMINANCE RATIO. A contrast ratio
// would demand that a build's text differ from its ground in BRIGHTNESS, and
// `specs/overview.md` gives the palette and the type to the build; a readout drawn
// in a saturated hue against an equally bright ground is a design choice the
// specification allows and a player reads. So the bar is the same one this whole
// group calls "plainly apart", applied to a run and its ground.
//
// WHAT IT DOES NOT DECIDE. What each screen and each readout must SAY, which
// `screens/` and `hud/` own; where they sit, which `floor/panel-strip` and
// `hud/touch-targets` own; and whether a control's state reads, which
// `hud/mute-read` owns.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTower,
  startRun,
  textDraws,
  type Harness,
  type Rgb,
  type TextDraw,
} from "../harness";
import { farthest, readPixels, showRgb, type Point } from "./read";

/**
 * How far a run's ink must sit from the ground under it, out of the 441 the RGB
 * cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same one it
 * holds a tower against the floor and a vent against an exhaust to. 60 is about a
 * seventh of the scale: a build whose readouts clear it has text a player picks
 * out of its panel at a glance, and one that does not has drawn a watermark.
 */
const CONTRAST_MIN = 60;

/**
 * The rows a run is read on, in logical units from its anchor.
 *
 * Spread eight units either side of it, which is where the glyphs are under every
 * `textBaseline` a build may have set — above the anchor with the default
 * alphabetic baseline, about it with `middle`, below it with `top` — at any size
 * from the smallest readout to a title.
 */
const ROWS: readonly number[] = [-8, -4, 0, 4, 8];

/** How much of a long run is read, in logical units: the leading stretch. */
const MAX_WIDTH = 60;

/** How wide a box a run whose width the recorder could not measure is read in. */
const UNMEASURED_WIDTH = 12;

/** Every point one run of text is read at. */
function runPoints(run: TextDraw): Point[] {
  const measured = run.right - run.left;
  const from = measured >= 1 ? run.left : run.x - UNMEASURED_WIDTH / 2;
  const to =
    measured >= 1
      ? Math.min(run.right, run.left + MAX_WIDTH)
      : run.x + UNMEASURED_WIDTH / 2;
  const points: Point[] = [];
  for (let x = Math.ceil(from); x <= Math.floor(to); x += 1) {
    for (const dy of ROWS) points.push({ x, y: run.y + dy });
  }
  return points;
}

/** The colour a set of samples shows most often: a run's own ground. */
function modal(colors: readonly Rgb[]): Rgb {
  const counts = new Map<string, { colour: Rgb; n: number }>();
  for (const colour of colors) {
    const key = `${colour.r},${colour.g},${colour.b}`;
    const seen = counts.get(key);
    if (seen === undefined) counts.set(key, { colour, n: 1 });
    else seen.n += 1;
  }
  let best = { colour: colors[0], n: 0 };
  for (const entry of counts.values()) if (entry.n > best.n) best = entry;
  return best.colour;
}

/** Whether a run has glyphs on the stage at all, so there is something to read. */
function onStage(run: TextDraw): boolean {
  return (
    run.text.trim().length > 0 &&
    run.y >= 0 &&
    run.y <= STAGE_H &&
    run.right >= 0 &&
    run.left <= STAGE_W
  );
}

/** One state to read: a name, and how to pose it. */
interface Scene {
  name: string;
  pose: (h: Harness) => Promise<void>;
  /** The review output this scene's picture is kept as, where it is kept. */
  capture?: string;
}

const SCENES: readonly Scene[] = [
  {
    name: "the title screen",
    pose: async (h) => {
      await h.debug.reset();
      await h.debug.setScreen("title");
    },
  },
  {
    name: "the mode-select screen",
    pose: async (h) => {
      await h.debug.reset();
      await h.debug.setScreen("modeselect");
    },
  },
  {
    name: "the difficulty-select screen",
    pose: async (h) => {
      await h.debug.reset();
      await h.debug.setScreen("difficultyselect");
    },
  },
  {
    name: "the how-to screen",
    pose: async (h) => {
      await h.debug.reset();
      await h.debug.setScreen("howto");
    },
  },
  {
    name: "the panel over a live floor",
    pose: async (h) => {
      await startRun(h);
    },
    capture: "text",
  },
  {
    name: "the panel with a shop entry hovered and a preview held",
    pose: async (h) => {
      await startRun(h);
      await h.debug.setHoverShop("lance");
      await h.debug.setArmed("lance");
      await h.debug.setPreview(20, 20);
    },
  },
  {
    name: "the inspector on a selected tower",
    pose: async (h) => {
      await startRun(h);
      const id = await poseTower(h, "rime", 12, 8);
      await h.debug.setSelected(id);
    },
  },
  {
    name: "the pause screen",
    pose: async (h) => {
      await startRun(h);
      await h.debug.setScreen("paused");
    },
  },
  {
    name: "the victory screen",
    pose: async (h) => {
      await startRun(h);
      await h.debug.setScreen("victory");
    },
  },
  {
    name: "the game-over screen",
    pose: async (h) => {
      await startRun(h);
      await h.debug.setScreen("gameover");
    },
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it.each(SCENES)("draws every run of text on $name legibly", async (scene) => {
  await scene.pose(h);

  const runs = textDraws(await h.frameCalls()).filter(onStage);
  if (scene.capture !== undefined) await captureStill(h, scene.capture);

  assertGreaterThan(
    runs.length,
    0,
    `${scene.name} draws at least one run of text ` +
      `(specs/overview.md: every readout and every screen's text is legible)`,
  );

  for (const run of runs) {
    const points = runPoints(run);
    const read = await readPixels(h, points);
    const ground = modal(read);
    const ink = farthest(ground, read);
    assertGreaterThanOrEqual(
      colorDistance(ink, ground),
      CONTRAST_MIN,
      `${scene.name}: the run "${run.text}", which the frame drew at ` +
        `(${Math.round(run.x)}, ${Math.round(run.y)}) — the strongest ink ` +
        `left on the finished picture there (${showRgb(ink)}) against the ` +
        `ground it is laid on (${showRgb(ground)}). The reading is of the ` +
        `frame a player sees, so a run drawn in the ground's own colour and ` +
        `one drawn and then painted over both read as nothing ` +
        `(specs/overview.md: every readout and every screen's text is legible ` +
        `against its background at the logical stage size)`,
    );
  }
});
