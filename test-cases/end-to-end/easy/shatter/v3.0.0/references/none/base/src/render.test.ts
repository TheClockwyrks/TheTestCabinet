// What the build DRAWS, read back off a real 2D context.
//
// `specs/overview.md` fixes what a player must be able to read at a glance and
// leaves the palette, the type and every drawn dimension to the build, so every
// check here is one of PRESENCE and DISTINGUISHABILITY rather than a colour: a
// body is drawn where the state says it stands, and it is far enough from the
// field and from the other bodies to be told apart. Distances are Euclidean over
// the three channels, so the widest possible difference is 441.
//
// `@napi-rs/canvas` supplies the context, so this runs in process with no browser
// and nothing about the game changes: `src/render.ts` reads the state and draws,
// and the simulation never reads the renderer.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import {
  BULLET_R,
  CORE_R,
  FIELD_H,
  FIELD_W,
  GAMEOVER_ITEMS,
  HALO_R,
  PAUSE_ITEMS,
  SAUCER_BULLET_R,
  SAUCER_R,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TAU,
  TITLE_ITEMS,
  TRAIL_TICKS,
} from "./constants";
import { makeBullet, makeEnemyBullet, makeRock, makeSaucer } from "./entities";
import { posed } from "./harness.test-support";
import { renderGame } from "./render";
import { COLOR } from "./theme";
import type { ShatterState } from "./types";

/** One pixel, as three channels. */
type Rgb = [number, number, number];

/** The field's background, as the renderer clears it. */
const BACKGROUND: Rgb = [5, 7, 14];

/** The distance between two colours, out of a widest possible 441. */
function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A drawn frame, sampled by logical field coordinate. */
interface Frame {
  at(x: number, y: number): Rgb;
  /** How far the pixel at `(x, y)` is from the field's background. */
  fromBackground(x: number, y: number): number;
  /** The furthest any pixel in the box is from `reference`. */
  peak(
    box: { x: number; y: number; w: number; h: number },
    reference?: Rgb,
  ): number;
  /** How many pixels in the box differ from the background by more than `least`. */
  lit(
    box: { x: number; y: number; w: number; h: number },
    least?: number,
  ): number;
  /** The average colour of the pixels in the box that are not the background. */
  ink(box: { x: number; y: number; w: number; h: number }): Rgb;
  /** Every channel of every pixel in the box, for comparing two frames. */
  raw(box: { x: number; y: number; w: number; h: number }): number[];
}

/** How many pixels of two readings of the same box differ. */
function changedPixels(before: number[], after: number[]): number {
  let count = 0;
  for (let i = 0; i < before.length; i += 3) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2]
    ) {
      count += 1;
    }
  }
  return count;
}

/** Draw the state as it stands and return the pixels for reading. */
function draw(state: ShatterState): Frame {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  renderGame(state, ctx);
  const pixels = ctx.getImageData(0, 0, FIELD_W, FIELD_H).data;

  const at = (x: number, y: number): Rgb => {
    const px = Math.max(0, Math.min(FIELD_W - 1, Math.round(x)));
    const py = Math.max(0, Math.min(FIELD_H - 1, Math.round(y)));
    const i = (py * FIELD_W + px) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };

  const each = (
    box: { x: number; y: number; w: number; h: number },
    visit: (colour: Rgb) => void,
  ): void => {
    for (let y = box.y; y < box.y + box.h; y += 1) {
      for (let x = box.x; x < box.x + box.w; x += 1) visit(at(x, y));
    }
  };

  return {
    at,
    fromBackground: (x, y) => distance(at(x, y), BACKGROUND),
    peak(box, reference = BACKGROUND) {
      let most = 0;
      each(box, (colour) => {
        most = Math.max(most, distance(colour, reference));
      });
      return most;
    },
    lit(box, least = 20) {
      let count = 0;
      each(box, (colour) => {
        if (distance(colour, BACKGROUND) > least) count += 1;
      });
      return count;
    },
    ink(box) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      each(box, (colour) => {
        if (distance(colour, BACKGROUND) <= 40) return;
        r += colour[0];
        g += colour[1];
        b += colour[2];
        n += 1;
      });
      return n === 0 ? BACKGROUND : [r / n, g / n, b / n];
    },
    raw(box) {
      const channels: number[] = [];
      each(box, (colour) => channels.push(colour[0], colour[1], colour[2]));
      return channels;
    },
  };
}

/** A box centred on a field position. */
function around(x: number, y: number, radius: number) {
  return {
    x: Math.round(x - radius),
    y: Math.round(y - radius),
    w: Math.round(radius * 2),
    h: Math.round(radius * 2),
  };
}

/** A game in play with the ship parked in a corner, clear of every scene. */
function scene(): ReturnType<typeof posed> {
  const driven = posed();
  driven.state.ship.collision = false;
  driven.state.ship.x = 90;
  driven.state.ship.y = 90;
  return driven;
}

describe("the field's look", () => {
  it("reads as deep space where nothing is drawn", () => {
    const { state } = scene();
    const frame = draw(state);
    const [r, g, b] = frame.at(1180, 660);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    expect(luminance).toBeLessThan(0.25);
  });

  it("draws the star's core at its own radius", () => {
    const { state } = scene();
    const frame = draw(state);
    expect(frame.fromBackground(STAR_X, STAR_Y)).toBeGreaterThan(60);
    expect(frame.fromBackground(STAR_X + CORE_R - 4, STAR_Y)).toBeGreaterThan(
      60,
    );
  });

  it("fades the star's halo outward and draws nothing past 1.5 halo radii", () => {
    const { state } = scene();
    const frame = draw(state);
    let previous = Infinity;
    for (let r = CORE_R + 2; r <= HALO_R; r += 2) {
      const here = frame.fromBackground(STAR_X + r, STAR_Y);
      expect(here).toBeLessThanOrEqual(previous + 2);
      previous = here;
    }
    for (let r = HALO_R * 1.5; r <= HALO_R * 1.5 + 40; r += 4) {
      expect(frame.fromBackground(STAR_X + r, STAR_Y)).toBeLessThan(3);
      expect(frame.fromBackground(STAR_X, STAR_Y + r)).toBeLessThan(3);
    }
  });

  it("draws a body straddling a seam at both edges at once", () => {
    const { state } = scene();
    state.rocks.push(makeRock(state, "large", FIELD_W - 10, 300, 0, 0));
    const frame = draw(state);
    expect(
      frame.lit({ x: FIELD_W - 20, y: 270, w: 20, h: 60 }),
    ).toBeGreaterThan(100);
    expect(frame.lit({ x: 0, y: 270, w: 20, h: 60 })).toBeGreaterThan(100);
  });
});

describe("the bodies", () => {
  it("draws the ship apart from the field, with its facing legible", () => {
    const { state } = scene();
    state.ship.x = 400;
    state.ship.y = 200;
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      state.ship.angle = angle;
      const frame = draw(state);
      expect(frame.peak(around(400, 200, SHIP_R))).toBeGreaterThan(60);
      // Asymmetric along the facing: the nose reaches further than the tail.
      const ahead = around(
        400 + Math.cos(angle) * 26,
        200 + Math.sin(angle) * 26,
        4,
      );
      const behind = around(
        400 - Math.cos(angle) * 26,
        200 - Math.sin(angle) * 26,
        4,
      );
      expect(frame.lit(ahead)).toBeGreaterThan(frame.lit(behind));
    }
  });

  it("draws a rock apart from the field and from the ship", () => {
    const { state } = scene();
    state.ship.x = 300;
    state.ship.y = 200;
    state.rocks.push(makeRock(state, "large", 900, 200, 0, 0));
    const frame = draw(state);
    expect(frame.peak(around(900, 200, 20))).toBeGreaterThan(60);
    const rock = frame.ink(around(900, 200, 20));
    const ship = frame.ink(around(300, 200, 8));
    expect(distance(rock, ship)).toBeGreaterThan(40);
  });

  it("draws the saucer apart from the field and from a rock", () => {
    const { state } = scene();
    state.rocks.push(makeRock(state, "large", 300, 500, 0, 0));
    state.saucer = makeSaucer(state, 900, 500, 0);
    const frame = draw(state);
    expect(frame.peak(around(900, 500, SAUCER_R))).toBeGreaterThan(60);
    const saucer = frame.ink(around(900, 500, 10));
    const rock = frame.ink(around(300, 500, 20));
    expect(distance(saucer, rock)).toBeGreaterThan(40);
  });

  it("draws a bullet apart from the field", () => {
    const { state } = scene();
    state.bullets.push(makeBullet(state, 500, 240, 0, 0));
    const frame = draw(state);
    expect(frame.peak(around(500, 240, BULLET_R + 1))).toBeGreaterThan(60);
  });

  it("draws a saucer bullet apart from the field and from the ship's", () => {
    const { state } = scene();
    state.bullets.push(makeBullet(state, 400, 240, 0, 0));
    state.enemyBullets.push(makeEnemyBullet(state, 800, 240, 0, 0));
    const frame = draw(state);
    expect(frame.peak(around(800, 240, SAUCER_BULLET_R + 1))).toBeGreaterThan(
      60,
    );
    const mine = frame.ink(around(400, 240, BULLET_R + 1));
    const theirs = frame.ink(around(800, 240, SAUCER_BULLET_R + 1));
    expect(distance(mine, theirs)).toBeGreaterThan(40);
  });

  it("shows a flame at the tail while thrust is applied, and not after", () => {
    const { state, input, advance } = scene();
    state.ship.x = 400;
    state.ship.y = 300;
    state.ship.angle = 0;
    input.hold("thrust");
    advance(1);
    const tail = { x: 340, y: 288, w: 42, h: 24 };
    expect(draw(state).lit(tail)).toBeGreaterThan(20);
    input.release("thrust");
    advance(1);
    expect(draw(state).lit(tail)).toBe(0);
  });

  it("draws a ship inside its respawn grace differently at some instant", () => {
    const { state, advance } = scene();
    state.ship.x = 400;
    state.ship.y = 300;
    state.ship.invuln = 0;
    const steady = draw(state).ink(around(400, 300, SHIP_R));

    state.ship.invuln = 2.5;
    let differed = 0;
    let matched = 0;
    for (let i = 0; i < 60; i += 1) {
      advance(4);
      const now = draw(state).ink(around(400, 300, SHIP_R));
      if (distance(now, steady) > 20) differed += 1;
      else matched += 1;
    }
    expect(differed).toBeGreaterThan(0);
    expect(matched).toBeGreaterThan(0);
  });
});

describe("a bullet's trail", () => {
  /** A row clear of the ship, of the star's halo, and of both seams. */
  const ROW = 300;

  /** How far behind a bullet on `row` the drawn trail reaches, in units. */
  function trailReach(state: ShatterState, x: number, row: number): number {
    const frame = draw(state);
    let reach = 0;
    for (let back = 2; back < 200; back += 1) {
      const box = { x: Math.round(x - back), y: row - 6, w: 1, h: 12 };
      if (frame.lit(box, 12) > 0) reach = back;
    }
    return reach;
  }

  it("lays a tail along the path a moving bullet has just taken", () => {
    const { state, advance } = scene();
    state.bullets.push(makeBullet(state, 200, ROW, 600, 0));
    advance(TRAIL_TICKS);
    const bullet = state.bullets[0];
    expect(trailReach(state, bullet.x, ROW)).toBeGreaterThan(20);
  });

  it("spans a slice of time, so a faster shot draws a longer tail", () => {
    const slow = scene();
    slow.state.bullets.push(makeBullet(slow.state, 200, ROW, 300, 0));
    slow.advance(TRAIL_TICKS);
    const slowReach = trailReach(slow.state, slow.state.bullets[0].x, ROW);

    const fast = scene();
    fast.state.bullets.push(makeBullet(fast.state, 200, ROW, 900, 0));
    fast.advance(TRAIL_TICKS);
    const fastReach = trailReach(fast.state, fast.state.bullets[0].x, ROW);

    expect(fastReach).toBeGreaterThan(slowReach);
    expect(fastReach / slowReach).toBeGreaterThan(3 * 0.75);
    expect(fastReach / slowReach).toBeLessThan(3 * 1.25);
  });

  it("follows the bullet across a seam rather than smearing across the field", () => {
    const { state, advance } = scene();
    state.bullets.push(makeBullet(state, FIELD_W - 20, 90, 900, 0));
    advance(TRAIL_TICKS);
    const bullet = state.bullets[0];
    expect(bullet.x).toBeLessThan(200);
    const frame = draw(state);
    // The tail shows at the far edge, behind the bullet across the seam...
    expect(
      frame.lit({ x: FIELD_W - 60, y: 84, w: 60, h: 12 }, 12),
    ).toBeGreaterThan(0);
    // ...and nowhere near the middle of the field it never crossed.
    expect(frame.lit({ x: 300, y: 60, w: 200, h: 60 }, 12)).toBe(0);
  });
});

describe("the HUD", () => {
  it("draws the score in the upper field, clear of the centre", () => {
    const { state } = scene();
    state.score = 4820;
    const frame = draw(state);
    expect(frame.lit({ x: 30, y: 20, w: 240, h: 70 })).toBeGreaterThan(60);
    expect(frame.lit(around(STAR_X, STAR_Y, HALO_R * 1.5))).toBeGreaterThan(0);
  });

  it("draws one ship glyph per ship in reserve", () => {
    /** Groups of lit columns in the reserve row: one per drawn glyph. */
    const glyphs = (lives: number): number => {
      const { state } = scene();
      state.lives = lives;
      state.ship.x = 640;
      state.ship.y = 620;
      const frame = draw(state);
      let count = 0;
      let inside = false;
      for (let x = 20; x < 220; x += 1) {
        const on = frame.lit({ x, y: 74, w: 1, h: 34 }) > 0;
        if (on && !inside) count += 1;
        inside = on;
      }
      return count;
    };
    expect(glyphs(3)).toBe(2);
    expect(glyphs(2)).toBe(1);
    expect(glyphs(1)).toBe(0);
  });

  it("draws the wave banner only while it is running", () => {
    const { state } = scene();
    state.wave = 7;
    // The banner is centred, so the star stands behind it: what is measured is
    // the CHANGE the banner makes to that band, and its complete absence once
    // the banner has run out.
    const band = { x: 420, y: 306, w: 440, h: 108 };
    state.waveBanner = 0;
    const quiet = draw(state).raw(band);
    state.waveBanner = 1.2;
    const showing = draw(state).raw(band);
    expect(changedPixels(quiet, showing)).toBeGreaterThan(2000);
    state.waveBanner = 0;
    expect(changedPixels(quiet, draw(state).raw(band))).toBe(0);
  });

  it("announces an awarded ship on the field", () => {
    const { state } = scene();
    const award = { x: 500, y: 546, w: 280, h: 48 };
    const before = draw(state).lit(award);
    state.extraLifeShow = 2;
    expect(draw(state).lit(award)).toBeGreaterThan(before + 200);
  });
});

describe("the screens", () => {
  /** Every piece of drawn ink on a screen stands off what sits behind it. */
  function textReads(
    state: ShatterState,
    box: { x: number; y: number; w: number; h: number },
  ): number {
    const frame = draw(state);
    const backing = frame.at(box.x + 2, box.y + 2);
    return frame.peak(box, backing);
  }

  it("shows the title, the tagline and both entries in order", () => {
    const { state } = scene();
    state.screen = "title";
    const frame = draw(state);
    expect(frame.lit({ x: 400, y: 170, w: 480, h: 80 })).toBeGreaterThan(400);
    expect(frame.lit({ x: 440, y: 266, w: 400, h: 28 })).toBeGreaterThan(100);
    const first = frame.lit({ x: 460, y: 400, w: 360, h: 40 });
    const second = frame.lit({ x: 460, y: 458, w: 360, h: 40 });
    expect(first).toBeGreaterThan(50);
    expect(second).toBeGreaterThan(50);
    expect(TITLE_ITEMS).toHaveLength(2);
  });

  it("marks the highlighted entry, and moves the mark with the selection", () => {
    const { state } = scene();
    state.screen = "title";
    state.menuIndex = 0;
    const firstInk = draw(state).ink({ x: 460, y: 400, w: 360, h: 40 });
    const secondInk = draw(state).ink({ x: 460, y: 458, w: 360, h: 40 });
    expect(distance(firstInk, secondInk)).toBeGreaterThan(20);

    state.menuIndex = 1;
    const movedFirst = draw(state).ink({ x: 460, y: 400, w: 360, h: 40 });
    const movedSecond = draw(state).ink({ x: 460, y: 458, w: 360, h: 40 });
    expect(distance(movedFirst, firstInk)).toBeGreaterThan(20);
    expect(distance(movedSecond, secondInk)).toBeGreaterThan(20);
  });

  it("names every bound key on the how-to screen", () => {
    const { state } = scene();
    state.screen = "howto";
    const frame = draw(state);
    expect(frame.lit({ x: 180, y: 180, w: 800, h: 400 })).toBeGreaterThan(2000);
  });

  it("keeps the frozen field visible behind the pause menu", () => {
    const { state } = scene();
    state.rocks.push(makeRock(state, "large", 240, 560, 0, 0));
    const playing = draw(state).lit(around(240, 560, 30), 40);
    state.screen = "paused";
    const paused = draw(state);
    expect(paused.lit(around(240, 560, 30), 40)).toBeGreaterThan(playing * 0.5);
    for (let i = 0; i < PAUSE_ITEMS.length; i += 1) {
      expect(
        paused.lit({ x: 460, y: 332 + i * 58, w: 360, h: 36 }),
      ).toBeGreaterThan(50);
    }
  });

  it("shows the final score and the wave reached when the game is over", () => {
    const { state } = scene();
    state.screen = "gameover";
    state.score = 3140;
    state.wave = 9;
    const frame = draw(state);
    expect(frame.lit({ x: 540, y: 296, w: 200, h: 44 })).toBeGreaterThan(120);
    expect(frame.lit({ x: 580, y: 384, w: 120, h: 44 })).toBeGreaterThan(40);
    for (let i = 0; i < GAMEOVER_ITEMS.length; i += 1) {
      expect(
        frame.lit({ x: 460, y: 452 + i * 52, w: 360, h: 36 }),
      ).toBeGreaterThan(50);
    }
  });

  it("draws legible text on every one of the five screens", () => {
    const boxes = {
      title: { x: 400, y: 180, w: 480, h: 60 },
      howto: { x: 460, y: 100, w: 360, h: 40 },
      playing: { x: 30, y: 24, w: 200, h: 60 },
      paused: { x: 520, y: 240, w: 240, h: 44 },
      gameover: { x: 500, y: 190, w: 280, h: 44 },
    } as const;
    for (const [screen, box] of Object.entries(boxes)) {
      const { state } = scene();
      state.screen = screen as ShatterState["screen"];
      state.score = 1234;
      expect(textReads(state, box)).toBeGreaterThan(80);
    }
  });
});

describe("the renderer itself", () => {
  it("changes nothing about the game it draws", () => {
    const { state, advance } = scene();
    state.rocks.push(makeRock(state, "large", 400, 400, 40, 20));
    state.bullets.push(makeBullet(state, 300, 300, 300, 0));
    state.saucer = makeSaucer(state, 800, 200, 140);
    advance(20);
    const before = JSON.stringify(state);
    draw(state);
    draw(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("draws the whole field inside the logical bounds it is given", () => {
    const { state } = scene();
    // A body's drawn extent stays with the body: nothing is drawn outside a
    // wrapped copy's own reach, so the corner opposite every body is untouched.
    state.rocks.push(makeRock(state, "large", 640, 360 + HALO_R * 2, 0, 0));
    const frame = draw(state);
    expect(frame.fromBackground(FIELD_W - 4, FIELD_H - 4)).toBeLessThan(3);
    expect(TAU).toBeCloseTo(Math.PI * 2, 12);
    expect(COLOR.bg).toBe("#05070e");
  });
});
