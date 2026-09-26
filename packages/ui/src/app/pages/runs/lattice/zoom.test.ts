import { describe, expect, it } from "vitest";
import {
  fitZoom,
  MAX_FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  stepZoom,
  ZOOM_STEPS,
} from "./zoom";

// The three scored boards at their native size: one 32px cell per grid square. These
// are the sizes the player actually has to fit, so they are what the fit rules are
// stated against.
const SMALL = { width: 24 * 32, height: 12 * 32 };
const MEDIUM = { width: 48 * 32, height: 32 * 32 };
const LARGE = { width: 72 * 32, height: 40 * 32 };

describe("fitZoom", () => {
  it("shrinks the large factory until the whole board is on screen", () => {
    // The case this exists for: 2304x1280 native pixels in a laptop-sized stage.
    // Before, the board was drawn at a fixed 2x and most of it was off-screen.
    const stage = { width: 1440, height: 760 };
    const zoom = fitZoom(LARGE, stage);
    expect(LARGE.width * zoom).toBeLessThanOrEqual(stage.width);
    expect(LARGE.height * zoom).toBeLessThanOrEqual(stage.height);
  });

  it("is limited by whichever axis runs out first", () => {
    // The large board is wide and short; a tall narrow stage must be fit on width,
    // not on the height that has room to spare.
    const zoom = fitZoom(LARGE, { width: 1152, height: 4000 });
    expect(zoom).toBeCloseTo(0.5);
  });

  it("fills the stage as far as it can rather than merely fitting", () => {
    // Fitting is a maximum, not any scale that happens to fit: a board fitted at half
    // the size it could be is a legibility bug, not a conservative choice.
    const stage = { width: 1440, height: 760 };
    const zoom = fitZoom(MEDIUM, stage);
    const bigger = zoom * 1.01;
    expect(
      MEDIUM.width * bigger > stage.width ||
        MEDIUM.height * bigger > stage.height,
    ).toBe(true);
  });

  it("never magnifies the small factory past the player's old fixed scale", () => {
    // A board that already fits could be blown up without limit on a wide monitor.
    // Capping at 2x keeps the small factory at exactly the size the player drew every
    // board at before it could zoom.
    expect(fitZoom(SMALL, { width: 6000, height: 4000 })).toBe(MAX_FIT_ZOOM);
  });

  it("stops shrinking at the bottom of the ladder", () => {
    // Past this a 32px cell is a few screen pixels and the factory is unreadable —
    // scrolling a legible board beats staring at an illegible whole one.
    expect(fitZoom(LARGE, { width: 40, height: 20 })).toBe(MIN_ZOOM);
  });

  it("falls back to 1x when a size is unknown or degenerate", () => {
    // The board is unknown until the engine posts it, and jsdom (or a stage laid out
    // to nothing) reports zeroes. Neither may size the canvas to nothing.
    expect(fitZoom(null, { width: 800, height: 600 })).toBe(1);
    expect(fitZoom(LARGE, null)).toBe(1);
    expect(fitZoom(LARGE, { width: 0, height: 0 })).toBe(1);
    expect(fitZoom({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(
      1,
    );
  });
});

describe("stepZoom", () => {
  it("steps to the next rung past a scale between rungs", () => {
    // The usual case: the current scale is a fit scale, which lands wherever the
    // stage's aspect put it rather than on a rung.
    expect(stepZoom(0.6, 1)).toBe(0.75);
    expect(stepZoom(0.6, -1)).toBe(0.5);
  });

  it("moves off a scale that is already a rung", () => {
    // A tolerance guards this: rungs come back from a division a hair off themselves,
    // and a naive comparison would return the rung it is standing on.
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.5 + 1e-12, 1)).toBe(0.75);
    expect(stepZoom(0.5 - 1e-12, -1)).toBe(0.25);
  });

  it("saturates at the ends instead of running off the ladder", () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(stepZoom(99, -1)).toBe(MAX_ZOOM);
    expect(stepZoom(0.0001, 1)).toBe(MIN_ZOOM);
  });

  it("reaches both ends of the ladder from any fit scale", () => {
    // What makes the controls usable: from wherever Fit put the viewer, repeated
    // clicks arrive at full magnification and at the whole board, and stop there.
    let zoom = fitZoom(LARGE, { width: 1440, height: 760 });
    for (let i = 0; i < ZOOM_STEPS.length + 1; i += 1) zoom = stepZoom(zoom, 1);
    expect(zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < ZOOM_STEPS.length + 1; i += 1)
      zoom = stepZoom(zoom, -1);
    expect(zoom).toBe(MIN_ZOOM);
  });
});
