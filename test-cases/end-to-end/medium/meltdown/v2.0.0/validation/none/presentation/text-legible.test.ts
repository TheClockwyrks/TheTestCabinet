// presentation/text-legible — every run of text the game draws reaches the
// finished picture.
//
// THE RULE. `specs/overview.md`'s legibility table: "Text — Every readout and
// every screen's text is legible against its background at the logical stage
// size." What a check can decide of that is that the ink ARRIVED: the run the
// build submitted left something on the frame a player sees. How readable the
// result is — the face, the size, the colour it chose against the panel behind it
// — is appearance, which the same specification hands to the build ("The palette,
// the type, the glow, and every other aspect of the look are yours") and the
// reviewer's presentation rating judges.
//
// WHY THIS IS NOT ALREADY CARRIED BY `hud/` AND `screens/`. Those groups read the
// runs the build SUBMITTED — what each screen and each readout says, and that it
// was drawn at all. A build that submits a run and then paints over it, or draws
// it in the exact colour of the ground under it, satisfies every one of them and
// puts nothing on the screen. This item is the one reading taken off the finished
// frame instead.
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
// THE INK, THE GROUND, AND WHERE THE BAR COMES FROM. `specs/overview.md` fixes no
// palette, so both are read off the picture. The ground is the colour that occurs
// MOST OFTEN in the run's own box — text covers a minority of the box it is laid
// in, whatever the face — and the ink is the pixel furthest from it. The bar is
// not a stated contrast: the same box is read on two consecutive frames, which is
// how much the build's own animation moves it, and the ink has to beat that by
// `NOISE_MARGIN`. A build that lays its text in the ground's own colour, or paints
// over it, leaves a box that reads as one flat colour and clears nothing.
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
import {
  NOISE_MARGIN,
  farthest,
  readPixels,
  showRgb,
  type Point,
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

it.each(SCENES)(
  "draws every run of text on $name onto the frame",
  async (scene) => {
    await scene.pose(h);

    const runs = textDraws(await h.frameCalls()).filter(onStage);
    if (scene.capture !== undefined) await captureStill(h, scene.capture);

    assertGreaterThan(
      runs.length,
      0,
      `${scene.name} draws at least one run of text ` +
        `(specs/overview.md: every readout and every screen's text is legible)`,
    );

    const points: Point[] = [];
    const boxes = runs.map((run) => {
      const box = runPoints(run);
      const from = points.length;
      points.push(...box);
      return { from, to: points.length };
    });

    const first = await readPixels(h, points);
    await h.advance(1);
    const second = await readPixels(h, points);

    for (const [index, run] of runs.entries()) {
      const { from, to } = boxes[index];
      const before = first.slice(from, to);
      const read = second.slice(from, to);
      const noise = Math.max(
        ...read.map((sample, at) => colorDistance(sample, before[at])),
      );
      const ground = modal(read);
      const ink = farthest(ground, read);
      assertGreaterThanOrEqual(
        colorDistance(ink, ground),
        noise + NOISE_MARGIN,
        `${scene.name}: the run "${run.text}", which the frame drew at ` +
          `(${Math.round(run.x)}, ${Math.round(run.y)}) — the strongest ink ` +
          `left on the finished picture there (${showRgb(ink)}) against the ` +
          `ground it is laid on (${showRgb(ground)}), past the ${noise} that ` +
          `box moved between two frames on its own. The reading is of the frame ` +
          `a player sees, so a run drawn in the ground's own colour and one ` +
          `drawn and then painted over both read as nothing ` +
          `(specs/overview.md: every readout and every screen's text is legible ` +
          `against its background at the logical stage size)`,
      );
    }
  },
);
