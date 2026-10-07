// The seeded art, drawn for real, and the drone-burst played for real.
//
// The engine's loader reaches for `fetch` and `createImageBitmap`, and a Node
// process has neither a page to resolve a relative URL against nor a decoder, so
// this file stands both globals up over the project's own `assets/` directory for
// its own length. What is asserted below is therefore the pixels the seeded files
// actually carry and the particles the seeded system actually simulates.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  BURST_DURATION,
  BURST_SYSTEM,
  DISCHARGE_TIME,
  FLUX_SIZE,
  MAX_BURSTS,
  OVERLOAD_AT,
  PRISM_CORE_SIZE,
  PRISM_SIZE,
  RESONANCE_MAX,
  SHARD_SIZE,
  SHIP_W,
  SHIP_Y,
  SPRITES,
  fluxHold,
} from "./constants";
import {
  createHarness,
  droneOf,
  fireAt,
  installSeededArt,
  poseDrone,
  rgbDistance,
  startPosed,
  type Harness,
} from "./harness";

let restore: () => void;
let h: Harness;

beforeAll(() => {
  restore = installSeededArt();
});

afterAll(() => {
  restore();
});

beforeEach(async () => {
  h = await createHarness();
  h.pose((s, d) => d.reset(s));
  startPosed(h);
});

afterEach(() => {
  h.dispose();
});

/** Draw the frame as it stands, on a step too small to move anything. */
async function draw(): Promise<void> {
  h.setStep(0.000001);
  await h.frames(1);
  h.setStep(1 / 60);
}

/** Which pixels of a box differ from the field behind them. */
function mask(x: number, y: number, size: number): boolean[] {
  const data = h.region(x - size / 2, y - size / 2, size, size);
  const field = h.pixel(20, 500);
  const out: boolean[] = [];
  for (let i = 0; i < data.length; i += 4) {
    out.push(
      rgbDistance(
        [data[i] as number, data[i + 1] as number, data[i + 2] as number, 255],
        field,
      ) > 24,
    );
  }
  return out;
}

/** The mean colour of the pixels an entity actually paints, ignoring the field. */
function paintedColour(
  x: number,
  y: number,
  size: number,
): [number, number, number, number] {
  const data = h.region(x - size / 2, y - size / 2, size, size);
  const field = h.pixel(20, 500);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pixel: [number, number, number, number] = [
      data[i] as number,
      data[i + 1] as number,
      data[i + 2] as number,
      255,
    ];
    if (rgbDistance(pixel, field) <= 24) continue;
    r += pixel[0];
    g += pixel[1];
    b += pixel[2];
    n++;
  }
  return n === 0 ? field : [r / n, g / n, b / n, 255];
}

/** How much of `size` square around `(x, y)` is painted. */
function painted(x: number, y: number, size: number): number {
  return mask(x, y, size).filter(Boolean).length;
}

/** How closely two masks agree, as an intersection over their union. */
function agreement(a: boolean[], b: boolean[]): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === true && b[i] === true) both++;
    if (a[i] === true || b[i] === true) either++;
  }
  return either === 0 ? 0 : both / either;
}

describe("loading the seeded files", () => {
  it("asks the loader for each file under its own name", () => {
    for (const file of Object.values(SPRITES)) {
      expect(h.assetPaths).toContain(file);
    }
    expect(h.assetPaths).toContain(BURST_SYSTEM);
  });
});

describe("what the field draws from the art", () => {
  it("draws the ship and each drone kind at its own footprint", async () => {
    poseDrone(h, "shard", 300, 250, { phase: "formation" });
    poseDrone(h, "flux", 600, 250, { phase: "formation", bandClock: 0 });
    poseDrone(h, "prism", 900, 250, { phase: "formation" });
    await draw();
    expect(painted(300, 250, SHARD_SIZE)).toBeGreaterThan(20);
    expect(painted(600, 250, FLUX_SIZE)).toBeGreaterThan(20);
    expect(painted(900, 250, PRISM_SIZE)).toBeGreaterThan(60);
    expect(painted(h.state.ship.x, SHIP_Y, SHIP_W)).toBeGreaterThan(20);
  });

  it("draws both bands from one silhouette", async () => {
    poseDrone(h, "shard", 400, 250, { band: "cyan", phase: "formation" });
    await draw();
    const cyan = mask(400, 250, SHARD_SIZE);
    h.pose((s, d) => d.clearDrones(s));
    poseDrone(h, "shard", 400, 250, { band: "magenta", phase: "formation" });
    await draw();
    const magenta = mask(400, 250, SHARD_SIZE);
    expect(agreement(cyan, magenta)).toBeGreaterThan(0.9);
  });

  it("draws the two bands in colours a player tells apart", async () => {
    poseDrone(h, "shard", 400, 250, { band: "cyan", phase: "formation" });
    poseDrone(h, "shard", 800, 250, { band: "magenta", phase: "formation" });
    await draw();
    const cyan = h.average(392, 242, 16, 16);
    const magenta = h.average(792, 242, 16, 16);
    const field = h.average(200, 500, 16, 16);
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(60);
    expect(rgbDistance(cyan, field)).toBeGreaterThan(40);
    expect(rgbDistance(magenta, field)).toBeGreaterThan(40);
  });

  it("draws the three kinds apart from one another and from the ship", async () => {
    poseDrone(h, "shard", 300, 250, { band: "cyan", phase: "formation" });
    poseDrone(h, "flux", 600, 250, {
      band: "cyan",
      phase: "formation",
      bandClock: 0,
    });
    poseDrone(h, "prism", 900, 250, { band: "cyan", phase: "formation" });
    h.pose((s, d) => d.setShipX(s, 640));
    await draw();
    const shard = h.average(292, 242, 16, 16);
    const flux = h.average(592, 242, 16, 16);
    const prism = h.average(892, 242, 16, 16);
    const ship = h.average(632, SHIP_Y - 8, 16, 16);
    const field = h.average(200, 500, 16, 16);
    expect(rgbDistance(shard, flux)).toBeGreaterThan(40);
    expect(rgbDistance(flux, prism)).toBeGreaterThan(40);
    expect(rgbDistance(shard, prism)).toBeGreaterThan(40);
    expect(rgbDistance(shard, field)).toBeGreaterThan(40);
    expect(rgbDistance(ship, shard)).toBeGreaterThan(40);
    expect(rgbDistance(ship, field)).toBeGreaterThan(40);

    // The same reading, taken over every pixel each entity actually paints
    // rather than at its centre, so the kinds stay apart however a reader
    // samples them.
    const shardBox = paintedColour(300, 250, SHARD_SIZE);
    const fluxBox = paintedColour(600, 250, FLUX_SIZE);
    const prismBox = paintedColour(900, 250, PRISM_SIZE);
    const shipBox = paintedColour(640, SHIP_Y, SHIP_W);
    expect(rgbDistance(shardBox, fluxBox)).toBeGreaterThan(40);
    expect(rgbDistance(fluxBox, prismBox)).toBeGreaterThan(40);
    expect(rgbDistance(shardBox, prismBox)).toBeGreaterThan(40);
    expect(rgbDistance(shipBox, shardBox)).toBeGreaterThan(40);
    for (const painted of [shardBox, fluxBox, prismBox, shipBox]) {
      expect(rgbDistance(painted, field)).toBeGreaterThan(40);
    }
  });

  it("reads the ship's own band off the ship", async () => {
    await draw();
    const cyan = h.average(h.state.ship.x - 12, SHIP_Y - 10, 24, 20);
    h.pose((s, d) => d.setShipBand(s, "magenta"));
    await draw();
    const magenta = h.average(h.state.ship.x - 12, SHIP_Y - 10, 24, 20);
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(40);
  });

  it("draws a shimmering Flux differently from a settled one", async () => {
    const id = poseDrone(h, "flux", 500, 250, {
      band: "cyan",
      phase: "formation",
      bandClock: 0,
    });
    await draw();
    const held = h.average(486, 236, 28, 28);
    h.pose((s, d) => d.setDroneBandClock(s, id, fluxHold(1)));
    expect(droneOf(h, id)?.shimmer).toBe(true);
    await draw();
    const shimmering = h.average(486, 236, 28, 28);
    expect(rgbDistance(held, shimmering)).toBeGreaterThan(25);
  });

  it("draws a broken Prism as its core alone", async () => {
    const id = poseDrone(h, "prism", 500, 250, { phase: "formation" });
    await draw();
    const whole = painted(500, 250, PRISM_SIZE);
    h.pose((s, d) => d.setDroneShell(s, id, false));
    await draw();
    const core = painted(500, 250, PRISM_SIZE);
    expect(core).toBeLessThan(whole * 0.75);
    expect(painted(500, 250, PRISM_CORE_SIZE)).toBeGreaterThan(20);
  });

  it("draws a bullet in code, in its own band", async () => {
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 800, 400, "magenta"));
    await draw();
    const cyan = h.average(396, 394, 8, 12);
    const magenta = h.average(796, 394, 8, 12);
    const field = h.average(200, 500, 16, 16);
    expect(rgbDistance(cyan, field)).toBeGreaterThan(20);
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(60);
  });

  it("paints a code-drawn bullet in the band the art carries", async () => {
    poseDrone(h, "shard", 300, 250, { band: "cyan", phase: "formation" });
    poseDrone(h, "shard", 900, 250, { band: "magenta", phase: "formation" });
    h.pose((s, d) => d.addPlayerBullet(s, 500, 400, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 700, 400, "magenta"));
    await draw();
    const cyanDrone = h.average(294, 244, 12, 12);
    const magentaDrone = h.average(894, 244, 12, 12);
    const cyanBullet = h.average(497, 395, 6, 10);
    const magentaBullet = h.average(697, 395, 6, 10);
    expect(rgbDistance(cyanBullet, cyanDrone)).toBeLessThan(
      rgbDistance(cyanBullet, magentaDrone),
    );
    expect(rgbDistance(magentaBullet, magentaDrone)).toBeLessThan(
      rgbDistance(magentaBullet, cyanDrone),
    );
  });

  it("draws the Overload telegraph on a charged drone", async () => {
    const id = poseDrone(h, "shard", 500, 250, {
      band: "cyan",
      phase: "formation",
      charge: 0,
    });
    await draw();
    const none = h.average(486, 236, 28, 28);
    h.pose((s, d) => d.setDroneCharge(s, id, 1));
    await draw();
    const one = h.average(486, 236, 28, 28);
    h.pose((s, d) => d.setDroneCharge(s, id, 2));
    await draw();
    const two = h.average(486, 236, 28, 28);
    expect(rgbDistance(none, one)).toBeGreaterThan(25);
    expect(rgbDistance(one, two)).toBeGreaterThan(25);

    h.pose((s, d) => d.setDroneCharge(s, id, OVERLOAD_AT - 1));
    await fireAt(h, 500, 250, "magenta");
    h.pose((s, d) => d.setDronePosition(s, id, 500, 250));
    h.pose((s, d) => d.setDronePhase(s, id, "formation"));
    expect(droneOf(h, id)?.charge).toBe(0);
    await draw();
    expect(rgbDistance(none, h.average(486, 236, 28, 28))).toBeLessThan(25);
  });
});

describe("the drone-burst", () => {
  it("plays one burst where a destroyed drone stood, at its footprint", async () => {
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    const bursts = h.snapshot().bursts;
    expect(bursts).toHaveLength(1);
    expect(Math.abs((bursts[0]?.x ?? 0) - 500)).toBeLessThan(SHARD_SIZE);
    expect(Math.abs((bursts[0]?.y ?? 0) - 300)).toBeLessThan(SHARD_SIZE);
    expect(bursts[0]?.size).toBeCloseTo(SHARD_SIZE, 5);
  });

  it("holds the particle count the seeded system's own emitters give", async () => {
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    await h.advance(0.1);
    const burst = h.snapshot().bursts[0];
    expect(burst?.particles).toBeGreaterThan(180);
    expect(burst?.particles).toBeLessThan(260);
  });

  it("scales to the drone it popped", async () => {
    poseDrone(h, "prism", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    const shell = h.snapshot().bursts[0];
    expect(shell?.size).toBeCloseTo(PRISM_SIZE, 5);
    expect(shell?.size).toBeGreaterThan(SHARD_SIZE);
  });

  it("detonates a Prism twice, once per layer", async () => {
    poseDrone(h, "prism", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().bursts).toHaveLength(1);
    await fireAt(h, 500, 300, "magenta");
    expect(h.snapshot().bursts).toHaveLength(2);
  });

  it("pops every drone a discharge destroys", async () => {
    for (const x of [300, 500, 700]) {
      poseDrone(h, "shard", x, 300, { phase: "diving" });
    }
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(DISCHARGE_TIME + 0.05);
    expect(h.snapshot().bursts).toHaveLength(3);
  });

  it("is a one-shot that leaves the roster", async () => {
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().bursts).toHaveLength(1);
    await h.advance(BURST_DURATION * 0.6);
    expect(h.snapshot().bursts).toHaveLength(1);
    await h.advance(BURST_DURATION * 0.6);
    expect(h.snapshot().bursts).toHaveLength(0);
  });

  it("paints pixels where it plays", async () => {
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    await h.advance(0.08);
    await draw();
    expect(painted(500, 300, SHARD_SIZE)).toBeGreaterThan(20);
  });

  it("scatters differently from one burst to the next", async () => {
    // Where each spark of the burst landed a tenth of a second in, read off the
    // burst's own simulation rather than off the picture, so the reading is the
    // scatter itself and not how two scatters happened to average.
    const capture = async (): Promise<string> => {
      startPosed(h);
      poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
      await fireAt(h, 500, 300, "cyan");
      h.pose((s, d) => d.clearDrones(s));
      await h.advance(0.12);
      await draw();
      const burst = h.state.bursts[0];
      expect(burst).toBeDefined();
      return JSON.stringify(
        burst?.sim.capture().map((particle) => particle.position) ?? [],
      );
    };
    const first = await capture();
    const second = await capture();
    expect(first).not.toBe(second);
  });

  it("caps how many play at once", async () => {
    for (let i = 0; i < MAX_BURSTS + 8; i++) {
      poseDrone(h, "shard", 100 + i * 8, 300, { phase: "diving" });
    }
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(DISCHARGE_TIME + 0.05);
    expect(h.snapshot().bursts.length).toBeLessThanOrEqual(MAX_BURSTS);
  });
});
