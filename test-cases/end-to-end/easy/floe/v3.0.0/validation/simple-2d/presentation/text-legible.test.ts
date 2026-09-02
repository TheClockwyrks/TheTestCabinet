// presentation/text-legible — every readout and every screen's text can be read
// against whatever the build drew behind it.
//
// specs/overview.md's visual-design table: "Every HUD readout and every screen's
// text is legible against its background at the logical stage size."
// specs/ui.md says the same of the bar — "each is inside the bar and legible
// against it" — and fixes the six screens this point walks: the title, the how-to,
// the live crossing's HUD, the pause menu, and the two ending screens.
//
// EVERY SCREEN, AND EVERY RUN ON IT. A build that gets its HUD right and draws its
// pause menu in dark grey on a dark scrim is exactly the build this point exists
// to catch, and a failure names the screen and the words that could not be read.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette and no
// typeface (specs/overview.md: "The palette, the type, and every other aspect of
// the look are yours"), so both sides of the reading are things the build itself
// drew: the commonest colour inside the run's own box is the background behind it,
// and the reading is how far the glyph pixels sit from that. See `./text.ts` for
// how the box and the reading are taken.
//
// THE READING IS OF THE FINISHED FRAME, so a build that draws a shadow pass under
// its text, or strokes an outline around it, is read as the player sees it: what
// is sampled is what ended up on the canvas, not what any one call put there.
//
// THE HUD IS READ ON THE SCREEN WHERE IT IS A READOUT, WHICH IS `playing`. On
// every other screen the bar is BACKGROUND, and specs/ui.md says so: the title
// carries "a dim slice of the strait ... behind it", the pause screen the strait
// "visible and frozen, behind a menu". A build that dims that slice under a scrim
// has done what the specification invites, so a run whose baseline sits inside the
// bar is read on `playing` and left to the scrim elsewhere. Every run OUTSIDE the
// bar is that screen's own text and is read on every screen.
//
// THE STRAIT IS THE EMPTY ONE `startCrossing` POSES. What this point decides is
// text against the background the build chose to draw behind it; that a readout
// stays legible with traffic sliding under the bar is `strait/hud-above-strait`'s
// business, which keeps the strait out of the bar altogether.
//
// A SCREEN THAT DRAWS NO TEXT DECIDES NOTHING, so each screen is required to draw
// at least one run before its runs are read. What each screen must SAY is the
// `screens` group's; this is only what keeps a build that draws no words at all
// from passing a point about words.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startCrossing,
  type Harness,
} from "../harness";
import { rasterOf } from "./raster";
import { legibilityOf, textBoxes, type TextBox } from "./text";

/**
 * How far a run's glyphs must sit from the background behind them, as an RGB
 * distance.
 *
 * The RGB cube's longest diagonal is about `441`, so `60` is a seventh of the
 * whole range: below any pairing a designer would call contrasting, and far above
 * the dark-on-dark and mid-on-mid pairings a player cannot read at a glance. It is
 * the figure this review item states, and it is a DISTANCE — no colour and no
 * palette entry is asserted here.
 */
const DISTINCT_MIN = 60;

/** The score and the level the two ending screens are posed to report. */
const SCORE = 1234;
const REACHED_LEVEL = 5;

/** One run of one screen, and how far it read from its background. */
interface Reading {
  screen: string;
  box: TextBox;
  distance: number;
  painted: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every readout and every screen's text apart from its background", async () => {
  // Each screen is posed through the surface, so this point reaches each of the
  // six directly rather than through the menus that also lead to them.
  const screens: readonly { name: string; pose: () => void }[] = [
    {
      name: "title",
      pose: () => {
        h.debug.reset();
      },
    },
    {
      name: "howto",
      pose: () => {
        h.debug.reset();
        h.debug.setScreen("howto");
      },
    },
    {
      name: "playing",
      pose: () => {
        startCrossing(h);
      },
    },
    {
      name: "paused",
      pose: () => {
        startCrossing(h);
        h.debug.setScreen("paused");
      },
    },
    {
      name: "victory",
      pose: () => {
        startCrossing(h);
        h.debug.setScore(SCORE);
        h.debug.setScreen("victory");
      },
    },
    {
      name: "gameover",
      pose: () => {
        startCrossing(h);
        h.debug.setScore(SCORE);
        h.debug.setReachedLevel(REACHED_LEVEL);
        h.debug.setScreen("gameover");
      },
    },
  ];

  const readings: Reading[] = [];
  const drew = new Map<string, number>();
  for (const screen of screens) {
    screen.pose();
    const calls = await drawFrame(h);
    // The how-to screen carries the most words of any of the six: the picture of
    // it is the one worth keeping. Taken before the assertions below.
    if (screen.name === "howto") captureStill(h, "text");
    const raster = rasterOf(h);
    const boxes = textBoxes(h, calls).filter(
      (box) =>
        box.text.trim() !== "" &&
        // The bar's own readouts are read on `playing`; elsewhere the bar is the
        // dim slice specs/ui.md puts behind a screen.
        (screen.name === "playing" || box.baseline > HUD_H),
    );
    drew.set(screen.name, boxes.length);
    for (const box of boxes) {
      const read = legibilityOf(raster, box);
      readings.push({
        screen: screen.name,
        box,
        distance: read.distance,
        painted: read.painted,
      });
    }
  }

  for (const screen of screens) {
    assertGreaterThanOrEqual(
      drew.get(screen.name) ?? 0,
      1,
      `runs of the ${screen.name} screen's own text this point could read — ` +
        `specs/ui.md gives every one of the six words of its own`,
    );
  }

  for (const reading of readings) {
    assertGreaterThanOrEqual(
      reading.distance,
      DISTINCT_MIN,
      `how far ${JSON.stringify(reading.box.text)} on the ${reading.screen} ` +
        `screen was drawn from the background behind it, of 441 — every HUD ` +
        `readout and every screen's text is legible against its background ` +
        `(specs/overview.md); ${reading.painted} pixels of its box were ` +
        `painted at all`,
    );
  }
});
