// field/seam-drawn-both-sides — a rock posed straddling the right edge draws
// pixels distinct from the background within its radius of both the right edge
// and the left.
//
// THE RULE. `specs/field.md` states it in one sentence: "a body whose shape
// crosses a seam is drawn on both sides at once, its wrapped duplicate showing at
// the opposite edge". A build that draws each body once, at its own coordinates,
// is a build a player watches bodies vanish into the edge and pop out of the
// other — the field stops reading as a torus even though it simulates as one.
//
// WHAT IS READ, AND WHY IT IS PIXELS. The look is the build's: `specs/overview.md`
// fixes no palette, no rock shape and no line weight, only that a rock reads apart
// from the field. So this reads the canvas rather than the drawing calls, and it
// reads it as a DIFFERENCE against the same tick of the same seeded game with no
// rock on it (`paint.ts`), so the baseline is the field the build itself painted,
// whatever it painted there, and what is asserted is the rock's own contribution
// to it. Nothing here fixes a colour.
//
// WHY COLUMNS AND NOT POINTS. A rock may legitimately be drawn as a filled body
// or as an outline — `specs/overview.md` requires only that it read apart from
// the field — and a point sampled at the middle of an outlined rock reads the
// field through it. A column crossing the body's span meets the outline twice
// however it is drawn, and meets a filled body along its whole chord, so one
// reading serves both. Three columns to a side, so a jagged silhouette drawn
// inside its collision radius is still met by the inner ones.
//
// WHY THE ROCK IS A LARGE ON THIS SEAM. `ROCK_RADIUS.large` (`46`) is the widest
// body in the game, so posing its centre four units inside the right edge leaves
// a genuine straddle on both sides — 50 units of it inside the right edge and 42
// of it showing at the left. The row is clear of the star's whole drawn extent,
// of the ship at its safe point, and of the upper portion `specs/ui.md` draws the
// HUD in, so the only thing that changes between the two readings is the rock.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_W, ROCK_RADIUS } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  type Harness,
} from "../harness";
import {
  changedOver,
  paintedWithAndWithout,
  type Frame,
  type Span,
} from "./paint";

/** The row the rock is posed on. See the header for why this one. */
const ROW = 400;

/** How far inside the right edge the rock's centre is posed, in units. */
const INSET = 4;

/** The columns sampled inside the right edge, within a Large's radius of it. */
const RIGHT_COLUMNS = [1240, 1255, 1270];

/** The columns sampled inside the left edge, within a Large's radius of it. */
const LEFT_COLUMNS = [8, 20, 32];

/** The one tick that puts the posed field on the canvas. */
const DRAW_TICKS = 1;

/**
 * The sensing floor on a change: how far a reading must move between two frames
 * before the move can be called a redrawing, of the 441 an RGB distance can span.
 *
 * Eight. Below that a sampling cannot tell a redrawing from the rounding of an
 * 8-bit channel and the host's own anti-aliasing; above it nothing is decided
 * about how strongly the two readings differ. Anything the build drew differently
 * clears it, however faintly it drew it.
 */
const CHANGE_MIN = 8;

/**
 * How many such pixels a side must show, summed over its three columns.
 *
 * Two rather than one, so a single stray pixel cannot carry the reading. An
 * outlined rock crosses each column twice and a filled one covers the whole
 * chord, so the bar is met many times over by anything drawn there and not at all
 * by a build that drew the rock once.
 */
const CHANGED_MIN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The device column a logical `x` falls in, over the rock's own rows. */
function columnSpan(x: number): Span {
  return {
    axis: "column",
    line: h.device(x, ROW).x,
    from: h.device(x, ROW - ROCK_RADIUS.large).y,
    to: h.device(x, ROW + ROCK_RADIUS.large).y,
  };
}

/** How many pixels of those columns the rock drew, summed. */
function drewOver(
  bare: Frame,
  drawn: Frame,
  columns: readonly number[],
): number {
  return columns.reduce(
    (total, x) => total + changedOver(bare, drawn, columnSpan(x), CHANGE_MIN),
    0,
  );
}

it("draws a rock straddling the right seam on both sides of it", async () => {
  const { bare, drawn } = await paintedWithAndWithout(
    h,
    () => {
      poseRock(h, "large", FIELD_W - INSET, ROW);
    },
    DRAW_TICKS,
  );
  captureStill(h, "seam");

  assertGreaterThanOrEqual(
    drewOver(bare, drawn, RIGHT_COLUMNS),
    CHANGED_MIN,
    `pixels the rock drew within ${ROCK_RADIUS.large} of the right edge ` +
      "(specs/field.md)",
  );
  assertGreaterThanOrEqual(
    drewOver(bare, drawn, LEFT_COLUMNS),
    CHANGED_MIN,
    `pixels the rock's wrapped duplicate drew within ${ROCK_RADIUS.large} of ` +
      "the left edge (specs/field.md)",
  );
});
