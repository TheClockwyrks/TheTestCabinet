import { beforeEach, describe, expect, it } from "vitest";

import {
  FIELD_BOTTOM,
  FIELD_TOP,
  FLUX_SIZE,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  PRISM_CORE_SIZE,
  PRISM_SIZE,
  RESONANCE_MAX,
  SHARD_SIZE,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  STAGE_H,
  STAGE_W,
  fluxHold,
} from "./constants";
import { createDebugApi, type SpectraDebugApi } from "./debug";
import { LANE_CENTER } from "./game";
import { harness, rgbDistance, type Harness } from "./harness.test-support";
import { BAND_RGB, COLOR } from "./theme";

let h: Harness;
let d: SpectraDebugApi;

beforeEach(async () => {
  h = await harness();
  d = createDebugApi(h.state, h.clock);
  d.reset();
  d.setScreen("inWave");
  d.setWaveEntry(false);
  d.setDiveLaunching(false);
});

/** Draw one frame and forget the previous frame's recorded sources. */
function frame(): void {
  h.clearDrawn();
  h.draw();
}

/** The mean colour of a square patch of the last drawn frame. */
function patch(
  cx: number,
  cy: number,
  half: number,
): [number, number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let x = cx - half; x <= cx + half; x += 1) {
    for (let y = cy - half; y <= cy + half; y += 1) {
      const pixel = h.read(x, y);
      r += pixel[0];
      g += pixel[1];
      b += pixel[2];
      a += pixel[3];
      n += 1;
    }
  }
  return [r / n, g / n, b / n, a / n];
}

/** The brightest pixel of a square patch, as `[r, g, b, a]`. */
function brightest(
  cx: number,
  cy: number,
  half: number,
): [number, number, number, number] {
  let best: [number, number, number, number] = [0, 0, 0, 0];
  for (let x = cx - half; x <= cx + half; x += 1) {
    for (let y = cy - half; y <= cy + half; y += 1) {
      const pixel = h.read(x, y);
      if (pixel[0] + pixel[1] + pixel[2] > best[0] + best[1] + best[2]) {
        best = pixel;
      }
    }
  }
  return best;
}

/** How many pixels of a region differ from the field's own colour. */
function marks(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  threshold = 12,
): number {
  const field: [number, number, number, number] = [8, 11, 24, 255];
  let count = 0;
  for (let x = x0; x < x1; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      if (rgbDistance(h.read(x, y), field) > threshold) count += 1;
    }
  }
  return count;
}

/** The `drawImage` sources of the last frame, as their own dimensions. */
function drawnSizes(): Array<[number, number]> {
  return h.drawn.map((entry) => [entry.dw, entry.dh]);
}

describe("the stage's three regions", () => {
  it("draws the play field between the two HUD strips", () => {
    frame();
    const top = h.read(4, 4);
    const field = h.read(4, Math.floor((FIELD_TOP + FIELD_BOTTOM) / 2));
    const bottom = h.read(4, STAGE_H - 4);
    expect(rgbDistance(top, bottom)).toBeLessThan(4);
    expect(rgbDistance(top, field)).toBeGreaterThan(0);
    expect(top[3]).toBe(255);
    expect(HUD_TOP_H).toBe(FIELD_TOP);
    expect(HUD_BOTTOM_TOP).toBe(FIELD_BOTTOM);
  });

  it("draws a starfield of at least the required marks behind the field", () => {
    d.clearDrones();
    frame();
    // Count the distinct marks rather than the pixels: each is a small disc.
    const seen = new Set<string>();
    for (const star of h.state.stars) {
      seen.add(`${Math.round(star.x)},${Math.round(star.y)}`);
      expect(star.y).toBeGreaterThan(FIELD_TOP);
      expect(star.y).toBeLessThan(FIELD_BOTTOM);
    }
    expect(seen.size).toBeGreaterThanOrEqual(40);
    expect(
      marks(0, FIELD_TOP + 1, STAGE_W, FIELD_BOTTOM - 1, 8),
    ).toBeGreaterThan(200);
  });

  it("keeps a starfield mark dimmer than a drone of either band", () => {
    for (const star of [COLOR.star, COLOR.starBright]) {
      const value = Number.parseInt(star.slice(1), 16);
      const rgb: [number, number, number, number] = [
        (value >> 16) & 255,
        (value >> 8) & 255,
        value & 255,
        255,
      ];
      const sum = rgb[0] + rgb[1] + rgb[2];
      for (const band of [BAND_RGB.cyan, BAND_RGB.magenta]) {
        expect(sum).toBeLessThan(band[0] + band[1] + band[2]);
      }
    }
  });

  it("leaves the HUD strips clear of the drones and the bullets", () => {
    d.addDrone("shard", 400, 200);
    d.addDrone("prism", 700, 300);
    d.addPlayerBullet(500, 400, "cyan");
    d.addEnemyBullet(900, 500, "magenta");
    frame();
    // Whatever the strips carry, it is the HUD's, not the field's: the field's
    // content is clipped to the field.
    const strip = new Set<string>();
    for (let x = 380; x < 420; x += 1) {
      for (let y = 0; y < HUD_TOP_H; y += 1) strip.add(h.read(x, y).join(","));
    }
    expect(strip.size).toBeLessThan(4);
  });
});

describe("the ship", () => {
  it("is drawn from the seeded fighter art at its own footprint", () => {
    d.setShipX(LANE_CENTER);
    d.clearDrones();
    frame();
    const ship = h.drawn.find(
      (entry) => entry.dw === SHIP_W && entry.dh === SHIP_H,
    );
    expect(ship).toBeDefined();
    expect(ship?.dx).toBeCloseTo(LANE_CENTER - SHIP_W / 2, 4);
    expect(ship?.dy).toBeCloseTo(SHIP_Y - SHIP_H / 2, 4);
    expect(ship?.source).toBe(h.state.art.fighter.cyan);
  });

  it("draws the band it holds, and follows a flip", () => {
    d.setShipBand("magenta");
    frame();
    expect(
      h.drawn.some((entry) => entry.source === h.state.art.fighter.magenta),
    ).toBe(true);
    d.setShipBand("cyan");
    frame();
    expect(
      h.drawn.some((entry) => entry.source === h.state.art.fighter.cyan),
    ).toBe(true);
  });

  it("reads its band on the ship itself, in the band's own colour", () => {
    d.clearDrones();
    d.setShipX(LANE_CENTER);
    d.setShipBand("cyan");
    frame();
    const cyan = patch(LANE_CENTER, SHIP_Y, 6);
    d.setShipBand("magenta");
    frame();
    const magenta = patch(LANE_CENTER, SHIP_Y, 6);
    // The hull itself never changes, so the two readings differ only by the
    // band's own colour and its accent — cyan leaning blue, magenta leaning red.
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(12);
    expect(cyan[2]).toBeGreaterThan(cyan[0]);
    expect(magenta[0]).toBeGreaterThan(magenta[2]);
  });

  it("is not on the field during the ready hold", () => {
    d.setPhase("ready");
    d.setPhaseTimer(1);
    d.clearDrones();
    frame();
    expect(
      h.drawn.some((entry) => entry.dw === SHIP_W && entry.dh === SHIP_H),
    ).toBe(false);
  });
});

describe("the drones", () => {
  it("draws each kind from its own seeded silhouette, at its footprint", () => {
    d.addDrone("shard", 300, 200);
    d.addDrone("flux", 500, 200);
    d.addDrone("prism", 700, 200);
    frame();
    const sizes = drawnSizes();
    expect(sizes).toContainEqual([SHARD_SIZE, SHARD_SIZE]);
    expect(sizes).toContainEqual([FLUX_SIZE, FLUX_SIZE]);
    expect(sizes).toContainEqual([PRISM_SIZE, PRISM_SIZE]);
    const sources = h.drawn.map((entry) => entry.source);
    expect(sources).toContain(h.state.art.shard.cyan);
    expect(sources).toContain(h.state.art.prismFull.cyan);
  });

  it("centres each sprite on the drone's own centre", () => {
    d.addDrone("shard", 640, 300);
    frame();
    const drone = h.drawn.find((entry) => entry.dw === SHARD_SIZE);
    expect(drone?.dx).toBeCloseTo(640 - SHARD_SIZE / 2, 4);
    expect(drone?.dy).toBeCloseTo(300 - SHARD_SIZE / 2, 4);
  });

  it("tells a cyan drone from a magenta one, and each from the field", () => {
    const id = d.addDrone("shard", 640, 300);
    d.setDroneBand(id, "cyan");
    frame();
    const cyan = patch(640, 300, 8);
    d.setDroneBand(id, "magenta");
    frame();
    const magenta = patch(640, 300, 8);
    const field = patch(200, 560, 8);
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(40);
    expect(rgbDistance(cyan, field)).toBeGreaterThan(40);
    expect(rgbDistance(magenta, field)).toBeGreaterThan(40);
  });

  it("tells the three kinds apart", () => {
    const shot = (kind: "shard" | "flux" | "prism"): string => {
      d.clearDrones();
      const id = d.addDrone(kind, 640, 300);
      if (kind === "flux") d.setDroneOscillation(id, false);
      frame();
      const rows: string[] = [];
      for (let y = 300 - 24; y <= 300 + 24; y += 3) {
        let row = "";
        for (let x = 640 - 30; x <= 640 + 30; x += 3) {
          row +=
            h.read(x, y)[3] > 0 && h.read(x, y)[0] + h.read(x, y)[1] > 60
              ? "#"
              : ".";
        }
        rows.push(row);
      }
      return rows.join("\n");
    };
    const shard = shot("shard");
    const flux = shot("flux");
    const prism = shot("prism");
    expect(shard).not.toBe(flux);
    expect(flux).not.toBe(prism);
    expect(shard).not.toBe(prism);
  });

  it("draws a shimmering Flux differently from one holding a band", () => {
    const id = d.addDrone("flux", 640, 300);
    d.setDroneOscillation(id, false);
    d.setDroneBandClock(id, 0);
    frame();
    const held = patch(640, 300, 12);
    const heldSource = h.drawn.find((entry) => entry.dw === FLUX_SIZE)?.source;
    d.setDroneBandClock(id, fluxHold(1) + 0.1);
    frame();
    const shimmer = patch(640, 300, 12);
    const shimmerSource = h.drawn.find(
      (entry) => entry.dw === FLUX_SIZE,
    )?.source;
    expect(rgbDistance(held, shimmer)).toBeGreaterThan(10);
    expect(heldSource).toBe(h.state.art.fluxHeld.cyan);
    expect(shimmerSource).toBe(h.state.art.fluxShimmer);
  });

  it("draws a Prism with only its core left apart from an intact one", () => {
    const id = d.addDrone("prism", 640, 300);
    frame();
    expect(drawnSizes()).toContainEqual([PRISM_SIZE, PRISM_SIZE]);
    const whole = marks(640 - 30, 300 - 30, 640 + 30, 300 + 30, 20);
    d.setDroneShell(id, false);
    frame();
    expect(drawnSizes()).toContainEqual([PRISM_CORE_SIZE, PRISM_CORE_SIZE]);
    const core = marks(640 - 30, 300 - 30, 640 + 30, 300 + 30, 20);
    expect(core).toBeLessThan(whole * 0.8);
    expect(
      h.drawn.some((entry) => entry.source === h.state.art.prismCore.magenta),
    ).toBe(true);
  });

  it("repaints every drone under an inversion", () => {
    const id = d.addDrone("shard", 640, 300);
    d.setDroneBand(id, "cyan");
    frame();
    const normal = patch(640, 300, 8);
    d.setInversion(3);
    frame();
    const inverted = patch(640, 300, 8);
    expect(rgbDistance(normal, inverted)).toBeGreaterThan(30);
  });
});

describe("the bullets", () => {
  it("draws every bullet in code, with no seeded art at all", () => {
    d.clearDrones();
    d.setPhase("ready");
    d.setPhaseTimer(1);
    d.addPlayerBullet(400, 300, "cyan");
    d.addEnemyBullet(700, 300, "magenta");
    frame();
    // The only sprites a frame with no ship and no drone draws are the lives.
    for (const entry of h.drawn) {
      expect(entry.source).toBe(h.state.art.fighter.cyan);
      expect(entry.dy).toBeGreaterThan(HUD_BOTTOM_TOP);
    }
  });

  it("reads a bullet apart from the field, in its band's colour", () => {
    d.clearDrones();
    d.addPlayerBullet(400, 300, "cyan");
    d.addPlayerBullet(700, 300, "magenta");
    frame();
    const cyan = brightest(400, 300, 10);
    const magenta = brightest(700, 300, 10);
    const field = patch(550, 300, 6);
    expect(rgbDistance(cyan, field)).toBeGreaterThan(60);
    expect(rgbDistance(magenta, field)).toBeGreaterThan(60);
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(20);
  });
});

describe("the HUD", () => {
  it("draws the score, the stage, the lives, the meter and the polarity", () => {
    d.clearDrones();
    d.setScore(0);
    frame();
    const zero = marks(0, 0, 400, HUD_TOP_H, 20);
    d.setScore(987654);
    frame();
    expect(marks(0, 0, 400, HUD_TOP_H, 20)).not.toBe(zero);

    d.setStage(1);
    frame();
    const stageOne = marks(STAGE_W - 300, 0, STAGE_W, HUD_TOP_H, 20);
    d.setStage(17);
    frame();
    expect(marks(STAGE_W - 300, 0, STAGE_W, HUD_TOP_H, 20)).not.toBe(stageOne);

    // The lives readout is a row of fighters, and it changes with the lives.
    d.setLives(3);
    frame();
    const three = h.drawn.filter((entry) => entry.dy > HUD_BOTTOM_TOP).length;
    d.setLives(1);
    frame();
    expect(h.drawn.filter((entry) => entry.dy > HUD_BOTTOM_TOP).length).toBe(
      three - 2,
    );
  });

  it("fills the meter with the reading, and marks a full one distinctly", () => {
    d.clearDrones();
    d.setResonance(0);
    frame();
    const empty = marks(250, 678, 590, 694, 30);
    d.setResonance(50);
    frame();
    const half = marks(250, 678, 590, 694, 30);
    d.setResonance(RESONANCE_MAX);
    frame();
    const full = marks(250, 678, 590, 694, 30);
    expect(half).toBeGreaterThan(empty);
    expect(full).toBeGreaterThan(half);
    // A full meter reads differently from one a point below.
    d.setResonance(RESONANCE_MAX - 1);
    frame();
    const nearlyFull = patch(600, 686, 4);
    d.setResonance(RESONANCE_MAX);
    frame();
    expect(rgbDistance(nearlyFull, patch(600, 686, 4))).toBeGreaterThan(10);
  });

  it("draws the polarity indicator in the ship's band, following a flip", () => {
    d.clearDrones();
    d.setShipBand("cyan");
    frame();
    const cyan = brightest(760, 686, 26);
    d.setShipBand("magenta");
    frame();
    const magenta = brightest(760, 686, 26);
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(60);
  });

  it("draws the mute indicator only while sound is muted", () => {
    d.clearDrones();
    frame();
    const loud = marks(STAGE_W - 120, HUD_BOTTOM_TOP, STAGE_W, STAGE_H, 20);
    h.press("mute");
    h.advance(1 / 60, 1);
    frame();
    const muted = marks(STAGE_W - 120, HUD_BOTTOM_TOP, STAGE_W, STAGE_H, 20);
    expect(muted).toBeGreaterThan(loud);
  });
});

describe("the field-wide marks", () => {
  it("carries an unmistakable inversion mark, absent otherwise", () => {
    d.clearDrones();
    d.setInversion(0);
    frame();
    const quiet = marks(0, FIELD_TOP, STAGE_W, FIELD_BOTTOM, 20);
    d.setInversion(4);
    frame();
    const inverted = marks(0, FIELD_TOP, STAGE_W, FIELD_BOTTOM, 20);
    expect(inverted).toBeGreaterThan(quiet * 3);
    // And it really is field-wide: both far corners carry it.
    expect(
      rgbDistance(patch(30, FIELD_TOP + 40, 6), patch(30, 30, 6)),
    ).toBeGreaterThan(6);
  });

  it("draws the discharge wave out of the ship", () => {
    d.clearDrones();
    d.setResonance(RESONANCE_MAX);
    h.press("discharge");
    h.advance(0.1, 6);
    frame();
    expect(d.snapshot().discharge.active).toBe(true);
    const radius = d.snapshot().discharge.radius;
    expect(radius).toBeGreaterThan(20);
    const onRing = brightest(
      Math.round(LANE_CENTER),
      Math.round(SHIP_Y - radius),
      6,
    );
    expect(onRing[0] + onRing[1] + onRing[2]).toBeGreaterThan(120);
  });

  it("draws the ready banner over the field during the hold", () => {
    d.clearDrones();
    frame();
    const live = marks(400, 320, 880, 400, 40);
    d.setPhase("ready");
    d.setPhaseTimer(1);
    frame();
    expect(marks(400, 320, 880, 400, 40)).toBeGreaterThan(live + 200);
  });
});

describe("the screens", () => {
  it("draws the title, its tagline and its menu", () => {
    d.setScreen("title");
    frame();
    expect(marks(300, 160, 980, 240, 40)).toBeGreaterThan(400);
    expect(marks(300, 250, 980, 280, 30)).toBeGreaterThan(150);
    expect(marks(300, 380, 980, 470, 30)).toBeGreaterThan(150);
  });

  it("marks the highlighted menu item apart from the others", () => {
    d.setScreen("title");
    d.setMenuIndex(0);
    frame();
    const first = marks(300, 380, 980, 410, 30);
    d.setMenuIndex(1);
    frame();
    expect(marks(300, 380, 980, 410, 30)).not.toBe(first);
  });

  it("draws how-to-play", () => {
    d.setScreen("howto");
    frame();
    expect(marks(100, 120, 1180, 620, 30)).toBeGreaterThan(2000);
  });

  it("draws the stage intro, and names a challenge stage", () => {
    d.setScreen("stageIntro");
    d.setStage(1);
    frame();
    const standard = marks(300, 300, 980, 420, 40);
    expect(standard).toBeGreaterThan(300);
    d.setStage(3);
    frame();
    expect(marks(300, 300, 980, 420, 40)).toBeGreaterThan(standard);
  });

  it("draws the pause menu over the frozen field", () => {
    d.addDrone("shard", 400, 200);
    d.setScreen("paused");
    frame();
    expect(marks(300, 230, 980, 300, 40)).toBeGreaterThan(300);
    expect(marks(300, 340, 980, 470, 30)).toBeGreaterThan(200);
  });

  it("reports a cleared standard stage and a perfect challenge stage", () => {
    d.setScreen("stageCleared");
    d.setStage(1);
    frame();
    expect(marks(300, 300, 980, 400, 40)).toBeGreaterThan(300);
    d.setStage(3);
    frame();
    const missed = marks(300, 300, 980, 400, 40);
    expect(missed).toBeGreaterThan(300);
    // A perfect flyover reports something else.
    h.state.challengeHits = 40;
    frame();
    expect(marks(300, 300, 980, 400, 40)).not.toBe(missed);
  });

  it("draws the game-over screen with the run's score and stage", () => {
    d.setScreen("gameOver");
    d.setScore(4242);
    d.setStage(6);
    frame();
    expect(marks(300, 220, 980, 360, 40)).toBeGreaterThan(400);
    expect(marks(300, 400, 980, 490, 30)).toBeGreaterThan(150);
  });
});
