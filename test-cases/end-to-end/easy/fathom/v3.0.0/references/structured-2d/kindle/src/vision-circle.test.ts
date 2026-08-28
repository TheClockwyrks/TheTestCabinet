// Fathom — the vision circle, run on the real engine.
//
// The circle is a rendering mask and not a sense, so every test here reads two
// things about the same tile: what the snapshot says of it, which the circle
// must never touch, and what the pixel at its center says, which the circle
// decides. Each is posed as a fixture and driven through the debug surface, and
// every figure asserted is the one `specs/sensing.md` states.

import { describe, expect, it } from "vitest";
import {
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  TICK_HZ,
  TILE,
  VISION_MIN,
} from "./constants";
import { anchor, stampLayout } from "./fixtures";
import { tileCenterX, tileCenterY } from "./grid";
import { FLARE_FADE } from "./predators";
import { createHarness, type Harness } from "./harness";
import { PERCH, pose } from "./scenarios";

/**
 * How near two pixels have to be, over a full scale of 441, to read as one
 * color. The mask fills the fog's own color, so ground it covers matches the
 * fog exactly and this margin only absorbs a stray mark from another layer.
 */
const SAME = 4;

function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

type Pixel = [number, number, number];

function apart(one: Pixel, other: Pixel): number {
  return Math.hypot(one[0] - other[0], one[1] - other[1], one[2] - other[2]);
}

/** A harness in live play with the board posed, dark and stripped of plankton. */
async function posed(art: readonly string[]): Promise<Harness> {
  const harness = await createHarness();
  harness.debug.startDive();
  harness.debug.beginPlay();
  harness.debug.setCreatureAI(false);
  pose(harness.debug, art);
  harness.debug.clearPlankton();
  harness.debug.setBrightness(0);
  return harness;
}

function tilePixel(harness: Harness, tx: number, ty: number): Pixel {
  return harness.pixel(tileCenterX(tx), tileCenterY(ty));
}

/**
 * The flat fog, sampled off a tile that has never been revealed and that lies
 * beyond the circle, so neither the light pocket's glow nor the mask's own edge
 * can have touched it.
 */
function fogPixel(harness: Harness): Pixel {
  const snapshot = harness.debug.snapshot();
  const { x, y } = snapshot.forager;
  for (let ty = 0; ty < snapshot.grid.rows; ty++) {
    for (let tx = 0; tx < snapshot.grid.cols; tx++) {
      if (snapshot.visibility[ty][tx] !== "u") continue;
      const away = Math.hypot(tileCenterX(tx) - x, tileCenterY(ty) - y);
      if (away <= snapshot.windowRadius) continue;
      const pixel = tilePixel(harness, tx, ty);
      // The fog is dark but not empty, so a bare canvas is caught here rather
      // than read as fog and matched by everything.
      if (pixel[0] + pixel[1] + pixel[2] === 0) {
        throw new Error("the frame has not been drawn yet");
      }
      return pixel;
    }
  }
  throw new Error("no unrevealed tile lies beyond the circle");
}

/**
 * Reveals a run of one row by resting the forager along it in steps the light
 * pocket covers, and leaves the forager back where it started.
 */
async function sweep(
  harness: Harness,
  ty: number,
  from: number,
  to: number,
): Promise<void> {
  const stride = Math.floor(VISION_MIN / TILE);
  for (let tx = from; tx <= to; tx += stride) {
    harness.debug.setForagerTile(tx, ty);
    await harness.engine.advance(2);
  }
  harness.debug.setForagerTile(to, ty);
  await harness.engine.advance(2);
  harness.debug.setForagerTile(from, ty);
  await harness.engine.advance(2);
}

describe("the circle's radius", () => {
  it("runs from its resting radius to its full reach, always wider than the light", async () => {
    const harness = await createHarness();
    harness.debug.startDive();
    harness.debug.beginPlay();

    for (const brightness of [0, 0.25, 0.5, 0.75, 1]) {
      harness.debug.setBrightness(brightness);
      const snapshot = harness.debug.snapshot();
      expect(snapshot.windowRadius).toBeCloseTo(
        KINDLE_VISION_MIN + KINDLE_VISION_GAIN * brightness,
        6,
      );
      // Wider than the light pocket at every brightness.
      expect(snapshot.windowRadius).toBeGreaterThan(snapshot.visionRadius);
    }

    harness.debug.setBrightness(0);
    // 192 logical units, six tiles, at rest.
    expect(harness.debug.snapshot().windowRadius).toBeCloseTo(6 * TILE, 6);
    harness.debug.setBrightness(1);
    // 320 logical units, ten tiles, at full brightness.
    expect(harness.debug.snapshot().windowRadius).toBeCloseTo(10 * TILE, 6);
    harness.dispose();
  });
});

describe("the mask", () => {
  it("draws revealed ground inside the circle and paints the rest back to fog", async () => {
    const harness = await posed(PERCH);
    const start = anchor(stampLayout(PERCH), "F");
    await sweep(harness, start.ty, start.tx, start.tx + 14);

    const snapshot = harness.debug.snapshot();
    const radius = snapshot.windowRadius;
    expect(radius).toBeCloseTo(KINDLE_VISION_MIN, 6);
    const fog = fogPixel(harness);

    // The corridor five tiles out and the rock above it are 160 and 163 units
    // away, inside the circle; seven tiles out they are 224 and 226, beyond
    // it. The sweep revealed all four, so only the mask can tell them apart.
    const inside = start.tx + 5;
    const outside = start.tx + 7;
    const far = start.tx + 12;
    for (const tx of [inside, outside, far]) {
      expect(snapshot.visibility[start.ty][tx]).toBe("r");
      expect(snapshot.visibility[start.ty - 1][tx]).toBe("r");
      expect(snapshot.tiles[start.ty][tx]).toBe(".");
      expect(snapshot.tiles[start.ty - 1][tx]).toBe("#");
    }
    const away = (tx: number, ty: number): number =>
      Math.hypot(
        tileCenterX(tx) - snapshot.forager.x,
        tileCenterY(ty) - snapshot.forager.y,
      );
    expect(away(inside, start.ty)).toBeLessThan(radius);
    expect(away(inside, start.ty - 1)).toBeLessThan(radius);
    expect(away(outside, start.ty)).toBeGreaterThan(radius);
    expect(away(outside, start.ty - 1)).toBeGreaterThan(radius);

    // Inside the circle the corridor and the rock are each drawn as
    // themselves, so neither is the fog and the two do not read alike.
    const nearFloor = tilePixel(harness, inside, start.ty);
    const nearRock = tilePixel(harness, inside, start.ty - 1);
    expect(apart(nearFloor, fog)).toBeGreaterThan(SAME);
    expect(apart(nearRock, fog)).toBeGreaterThan(SAME);
    expect(apart(nearFloor, nearRock)).toBeGreaterThan(SAME);

    // Beyond it both are painted with the flat fog, so the corridor and the
    // rock become indistinguishable exactly as unexplored ground is.
    for (const tx of [outside, far]) {
      const floor = tilePixel(harness, tx, start.ty);
      const rock = tilePixel(harness, tx, start.ty - 1);
      expect(apart(floor, fog)).toBeLessThan(SAME);
      expect(apart(rock, fog)).toBeLessThan(SAME);
      expect(apart(floor, rock)).toBeLessThan(SAME);
    }
    harness.dispose();
  });

  it("hides ground without forgetting it, plankton and all", async () => {
    const harness = await posed(PERCH);
    const start = anchor(stampLayout(PERCH), "F");
    const stashed = start.tx + 12;
    await sweep(harness, start.ty, start.tx, start.tx + 14);
    harness.debug.setPlankton(stashed, start.ty, true);
    await harness.engine.advance(2);

    const hidden = harness.debug.snapshot();
    const fog = fogPixel(harness);
    // Beyond the circle: painted with the fog, and still remembered under it.
    expect(hidden.visibility[start.ty][stashed]).toBe("r");
    expect(hidden.planktonRemaining).toBe(1);
    expect(apart(tilePixel(harness, stashed, start.ty), fog)).toBeLessThan(
      SAME,
    );

    // Two tiles away is 64 units, well inside the circle: it is drawn again.
    harness.debug.setForagerTile(stashed - 2, start.ty);
    await harness.engine.advance(2);
    const back = harness.debug.snapshot();
    expect(back.planktonRemaining).toBe(1);
    expect(apart(tilePixel(harness, stashed, start.ty), fog)).toBeGreaterThan(
      SAME,
    );
    harness.dispose();
  });

  it("clips the amber lights to the circle", async () => {
    const harness = await posed(PERCH);
    const start = anchor(stampLayout(PERCH), "F");
    // Five tiles out is 160 units: past the light pocket's 96, so only the
    // amber mote can draw it, and inside the 192 the circle carries at rest.
    const near = start.tx + 5;
    // Eight tiles out is 256 units, beyond the circle.
    const far = start.tx + 8;
    harness.debug.spawnDrifter(near, start.ty);
    harness.debug.spawnDrifter(far, start.ty);
    await harness.engine.advance(2);

    const snapshot = harness.debug.snapshot();
    expect(snapshot.drifters).toHaveLength(2);
    const fog = fogPixel(harness);
    expect(apart(tilePixel(harness, near, start.ty), fog)).toBeGreaterThan(
      SAME,
    );
    expect(apart(tilePixel(harness, far, start.ty), fog)).toBeLessThan(SAME);
    harness.dispose();
  });

  it("leaves the hunters to the light pocket rather than the circle", async () => {
    const harness = await posed(PERCH);
    const start = anchor(stampLayout(PERCH), "F");
    // The Gloamfin carries no light of its own, so what is read here is the
    // body and nothing else.
    const dark = start.tx + 5;
    harness.debug.setPredatorTile(1, dark, start.ty);
    harness.debug.setPredatorState(1, "wander");
    await harness.engine.advance(2);

    const away = harness.debug.snapshot();
    const fog = fogPixel(harness);
    expect(away.predators[1].kind).toBe("gloamfin");
    // Inside the circle, past the light: unseen, and undrawn with it.
    expect(away.predators[1].lit).toBe(false);
    expect(apart(tilePixel(harness, dark, start.ty), fog)).toBeLessThan(SAME);

    // Two tiles out is 64 units, inside the light pocket, with rock nowhere
    // between: the light shows it.
    const near = start.tx + 2;
    harness.debug.setPredatorTile(1, near, start.ty);
    await harness.engine.advance(2);
    const shown = harness.debug.snapshot();
    expect(shown.predators[1].lit).toBe(true);
    // Read against the lit corridor beside it, which carries no body, so what
    // is measured is the Gloamfin and not the light it stands in.
    const empty = tilePixel(harness, near + 1, start.ty);
    expect(shown.visibility[start.ty][near]).toBe("l");
    expect(shown.visibility[start.ty][near + 1]).toBe("l");
    expect(apart(empty, fog)).toBeGreaterThan(SAME);
    expect(apart(tilePixel(harness, near, start.ty), empty)).toBeGreaterThan(
      SAME,
    );
    harness.dispose();
  });

  it("lets a flare draw the maze it blooms over, beyond the circle", async () => {
    const harness = await posed(PERCH);
    const fixture = stampLayout(PERCH);
    const start = anchor(fixture, "F");
    const pocket = anchor(fixture, "X");
    harness.debug.setForagerTile(start.tx, start.ty);
    harness.debug.setPredatorTile(2, pocket.tx, pocket.ty);
    harness.debug.setPredatorState(2, "wander");
    harness.debug.setCreatureAI(true);

    // Two tiles above the sealed pocket, and the rock two tiles to its left:
    // both inside the flare's 192 and both far beyond the forager's circle.
    const floor = { tx: pocket.tx, ty: pocket.ty - 2 };
    const rock = { tx: pocket.tx - 2, ty: pocket.ty };
    // One frame, so what is sampled below is a picture the engine has drawn.
    await harness.engine.advance(1);

    const snapshot = harness.debug.snapshot();
    for (const cell of [floor, rock]) {
      const away = Math.hypot(
        tileCenterX(cell.tx) - snapshot.forager.x,
        tileCenterY(cell.ty) - snapshot.forager.y,
      );
      expect(away).toBeGreaterThan(snapshot.windowRadius);
      expect(
        Math.hypot(
          tileCenterX(cell.tx) - tileCenterX(pocket.tx),
          tileCenterY(cell.ty) - tileCenterY(pocket.ty),
        ),
      ).toBeLessThan(FLARE_RADIUS);
    }

    const fog = fogPixel(harness);
    expect(apart(tilePixel(harness, floor.tx, floor.ty), fog)).toBeLessThan(
      SAME,
    );

    const blooming = await harness.until(
      () => harness.debug.snapshot().predators[2].flaring === true,
      ticks(FLARE_INTERVAL + FLARE_CHARGE + 1),
    );
    expect(blooming).toBe(true);
    await harness.engine.advance(2);

    // The bloom draws the trench inside its disc, so the two tiles read as the
    // floor and the rock they are rather than as one flat wash of light.
    const litFloor = tilePixel(harness, floor.tx, floor.ty);
    const litRock = tilePixel(harness, rock.tx, rock.ty);
    expect(apart(litFloor, fog)).toBeGreaterThan(SAME);
    expect(apart(litRock, fog)).toBeGreaterThan(SAME);
    expect(apart(litFloor, litRock)).toBeGreaterThan(SAME);

    const over = await harness.until(
      () => harness.debug.snapshot().predators[2].flaring === false,
      ticks(FLARE_BLOOM + 0.2),
    );
    expect(over).toBe(true);
    // Past this build's own fade of the bloom art, which is a flare effect and
    // draws over the blackout for as long as it burns down.
    await harness.engine.advance(ticks(FLARE_FADE) + 2);
    // The disc goes with the bloom: remembered underneath, fog on the screen.
    const after = harness.debug.snapshot();
    expect(after.visibility[floor.ty][floor.tx]).toBe("r");
    expect(apart(tilePixel(harness, floor.tx, floor.ty), fog)).toBeLessThan(
      SAME,
    );
    harness.dispose();
  });
});
