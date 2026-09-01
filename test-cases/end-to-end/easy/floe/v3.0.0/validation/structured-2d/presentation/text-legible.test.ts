// Floe — presentation/text-legible: every word the game puts on the screen can be
// read against what is behind it.
//
// specs/ui.md requires of the HUD's readouts that "each is inside the bar and
// legible against it", and it puts words on all six screens — the title's name,
// tagline and menu, the how-to screen's six subjects, the pause menu's three
// entries, and the two end screens' figures and entries.
// specs/overview.md's visual-design table says the same of all of it: "Every HUD
// readout and every screen's text is legible against its background at the
// logical stage size." Text a player cannot read is the failure this point exists
// to catch, and it is the one a screenshot review misses most easily, because a
// reviewer knows what the words say.
//
// WHAT IS READ. Every run of text the frame drew, wherever it drew it: the run's
// own box — its horizontal extent as the harness measured it on the real context
// at the call, its vertical extent measured under the `font` and `textBaseline`
// in force there (`./text.ts`) — and the pixels the build actually painted inside
// that box. What they are measured AGAINST is the commonest colour of the ring
// immediately around the box — the background BEHIND the run, taken as the mode
// rather than the mean so that a neighbouring line, a border or a shadow cannot
// drag the reading toward the ink it is supposed to be told apart from.
//
// A DISTANCE, NEVER A COLOUR. Floe fixes no palette (specs/overview.md: "The
// palette, the type, and every other aspect of the look are yours"), so the
// reading is between two things the build itself drew: the run's own pixels and
// the ground it set them on. No hue, no channel and no palette entry is asserted
// anywhere here, and a build is free to set white on navy, black on amber or
// anything else that clears the distance.
//
// PER PIXEL, AND AS A SHARE. A glyph does not fill its box — the counters, the
// spaces between words and the gaps between letters are all background showing
// through — so averaging a run's box together with the ground behind it would
// wash out exactly the reading being taken (the same argument `./body.ts` makes
// for a sprite). So every pixel of the box is read on its own, and what the point
// asserts is how much of the box stands clear of the ground.
//
// SIX SITUATIONS, AND EVERY RUN IN EACH. The HUD on a live crossing, and the five
// screens that carry copy. A failure names the situation and the run, so a build
// whose how-to screen is unreadable is told which screen and which line.
//
// THE HUD IS READ ON THE SITUATION WHERE IT IS A READOUT, WHICH IS THE LIVE
// CROSSING. On every other screen the bar is BACKGROUND, and specs/ui.md says so:
// the title carries "a dim slice of the strait ... behind it", and `paused` shows
// "the strait, visible and frozen, behind a menu". A build that dims that slice
// under a scrim has done exactly what the specification invites, and its bar runs
// are then low-contrast on purpose — so a run whose anchor sits inside the bar is
// read on the crossing and left to the scrim elsewhere. Every run anchored
// OUTSIDE the bar is that screen's own text and is read on every one of the six.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, TOTAL_LEVELS } from "../../src/constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { fractionAtLeast } from "./body";
import { renderFrame } from "./frame";
import { colorsWhere, modalColor, readRaster } from "./raster";
import { textBoxes, type TextBox } from "./text";

/**
 * How far a pixel of a run must sit from the ground behind it to count as ink, as
 * an RGB distance out of about `441`.
 *
 * `60` — a seventh of the cube's longest diagonal. It is the figure this review
 * item states, the same one the three "reads apart" points hold a body to, and it
 * is comfortably above the shading or texture a build may give a panel and
 * comfortably below what type a player reads at a glance measures against its
 * ground.
 */
const LEGIBLE_MIN = 60;

/**
 * How much of a run's box must stand that far clear of the ground behind it.
 *
 * A twentieth. A run's measured box is tight around its glyphs, and set type
 * covers a good quarter of such a box — but the share falls with the spaces in a
 * line, the counters of its letters and a light weight at a large size, and no
 * honest reading can ask for the whole of it. A twentieth is far below what any
 * set line covers and far above the stray antialiased pixel a build could leave
 * behind while painting nothing a player could see.
 */
const INK_COVERAGE_MIN = 0.05;

/**
 * How far around a run's box the ground behind it is sampled, in stage units.
 *
 * Eight — a quarter of a tile, enough of a frame around even a short run to read
 * what it was set on, and close enough that what is read is the ground BEHIND the
 * run rather than the next panel over.
 */
const RING_MARGIN = 8;

/**
 * The smallest box that is read at all, in stage units on a side.
 *
 * A run measured as occupying less than a unit in either direction — a space, a
 * zero-width joiner, a glyph the font has nothing for — painted nothing there is
 * any point reading.
 */
const BOX_MIN = 1;

/** One of the six places specs/ui.md puts words in front of a player. */
interface Situation {
  what: string;
  pose: () => void | Promise<void>;
  /** Whether the HUD bar is a readout here, rather than the ground behind a menu. */
  hudIsReadout?: boolean;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The six places specs/ui.md puts words in front of a player. */
function situations(): Situation[] {
  return [
    {
      what: "the HUD on a live crossing",
      hudIsReadout: true,
      pose: () => {
        startCrossing(h);
      },
    },
    {
      what: "the title screen",
      // `reset` restores the title (specs/instrumentation.md), which is also
      // where a freshly loaded build opens (specs/ui.md).
      pose: () => {
        h.debug.reset();
      },
    },
    {
      what: "the how-to screen",
      pose: () => {
        h.debug.reset();
        h.debug.setScreen("howto");
      },
    },
    {
      what: "the pause menu",
      pose: () => {
        startCrossing(h);
        h.debug.setScreen("paused");
      },
    },
    {
      what: "the victory screen",
      pose: () => {
        startCrossing(h, TOTAL_LEVELS);
        h.debug.setScore(1240);
        h.debug.setLives(2);
        h.debug.setScreen("victory");
      },
    },
    {
      what: "the game-over screen",
      pose: () => {
        startCrossing(h);
        h.debug.setScore(870);
        h.debug.setReachedLevel(4);
        h.debug.setLives(0);
        h.debug.setScreen("gameover");
      },
    },
  ];
}

/** What one run of text measured: how much of its box stands clear of its ground. */
interface Reading {
  what: string;
  text: string;
  coverage: number;
  distance: number;
}

/** Read one run of text against the ground immediately around it. */
function readRun(what: string, box: TextBox): Reading | null {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (width < BOX_MIN || height < BOX_MIN) return null;

  const raster = readRaster(
    h,
    box.left - RING_MARGIN,
    box.top - RING_MARGIN,
    width + 2 * RING_MARGIN,
    height + 2 * RING_MARGIN,
  );
  const within = (at: { x: number; y: number }): boolean =>
    at.x >= box.left &&
    at.x <= box.right &&
    at.y >= box.top &&
    at.y <= box.bottom;
  const ink = colorsWhere(raster, within);
  const ring = colorsWhere(raster, (at) => !within(at));
  if (ink.length === 0 || ring.length === 0) return null;

  const ground = modalColor(ring);
  const distances = ink.map((color) => colorDistance(color, ground));
  return {
    what,
    text: box.text,
    coverage: fractionAtLeast(distances, LEGIBLE_MIN),
    distance: Math.max(...distances),
  };
}

it("draws every readout and every screen's text clear of the ground behind it", async () => {
  const readings: Reading[] = [];
  const drawn: { what: string; runs: number }[] = [];

  for (const situation of situations()) {
    await situation.pose();
    await renderFrame(h);
    const boxes = textBoxes(h).filter(
      // The bar's own readouts are read on the live crossing; elsewhere the bar
      // is the dim slice specs/ui.md puts behind a screen.
      (box) =>
        situation.hudIsReadout === true || box.anchor < 0 || box.anchor > HUD_H,
    );
    drawn.push({ what: situation.what, runs: boxes.length });
    for (const box of boxes) {
      const reading = readRun(situation.what, box);
      if (reading !== null) readings.push(reading);
    }
  }
  // Before the assertions, so a failing verdict still leaves the last screen.
  captureStill(h, "text");

  for (const { what, runs } of drawn) {
    assertGreaterThan(
      runs,
      0,
      `the runs of text ${what} drew — it carries words a player has to read ` +
        `(specs/ui.md)`,
    );
  }

  for (const reading of readings) {
    assertGreaterThanOrEqual(
      reading.coverage,
      INK_COVERAGE_MIN,
      `the share of ${JSON.stringify(reading.text)} on ${reading.what} drawn ` +
        `at least ${LEGIBLE_MIN} of 441 from the ground behind it — every ` +
        `readout and every screen's text is legible against its background ` +
        `(specs/ui.md); its farthest pixel measured ` +
        `${reading.distance.toFixed(0)}`,
    );
  }
});
