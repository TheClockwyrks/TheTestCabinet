// Spectra — what the build actually leaves on the canvas.
//
// Every test here renders a posed state through a real 2D context and measures the
// PIXELS, so a relationship the specification states about the look is checked
// against what a player would see rather than against a value the game reports.
// `specs/overview.md`'s legibility table is what the distances below come from.

import { beforeAll, describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  FIELD_BOTTOM,
  FIELD_TOP,
  FLUX_SIZE,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  OVERLOAD_AT,
  PRISM_CORE_SIZE,
  PRISM_SIZE,
  RESONANCE_MAX,
  SHARD_SIZE,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  STAGE_H,
  STAGE_W,
  STARFIELD_MIN,
  fluxHold,
  slotX,
  slotY,
} from "./constants";
import { COLOR } from "./theme";
import { render } from "./render";
import { freshState } from "./game";
import { addDrone, addPlayerBullet } from "./entities";
import { startBurst, useBurstSystem } from "./bursts";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { Sprites } from "./assets";
import type { Band, DroneKind, SpectraState } from "./types";
import { realSprites } from "./art.test-support";

let sprites: Sprites;

beforeAll(async () => {
  sprites = await realSprites();
});

/** Render `state` and hand back its pixels. */
function shoot(state: SpectraState): Uint8ClampedArray {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  render(state, ctx as unknown as CanvasRenderingContext2D, sprites);
  return ctx.getImageData(0, 0, STAGE_W, STAGE_H)
    .data as unknown as Uint8ClampedArray;
}

/** A live wave with nothing on it, at the run's opening figures. */
function live(): SpectraState {
  const state = freshState();
  state.screen = "inWave";
  state.phase = "live";
  return state;
}

/**
 * The empty field every measurement is taken against.
 *
 * The ship is parked far left, so a sample of the field's centre — where every posed
 * drone and the ship under test sit — carries nothing but the field and its
 * starfield.
 */
function fieldBaseline(): SpectraState {
  const state = live();
  state.ship.x = 120;
  return state;
}

type Rgb = [number, number, number];

/** The RGB distance between two colours, of a possible 441. */
function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function at(data: Uint8ClampedArray, x: number, y: number): Rgb {
  const offset = (y * STAGE_W + x) * 4;
  return [
    data[offset] as number,
    data[offset + 1] as number,
    data[offset + 2] as number,
  ];
}

/** The mean colour of the pixels `shot` paints over `baseline`, inside a box. */
function paintedMean(
  shot: Uint8ClampedArray,
  baseline: Uint8ClampedArray,
  cx: number,
  cy: number,
  size: number,
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const half = Math.ceil(size / 2);
  for (let y = Math.round(cy - half); y <= Math.round(cy + half); y += 1) {
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x += 1) {
      if (x < 0 || y < 0 || x >= STAGE_W || y >= STAGE_H) continue;
      const now = at(shot, x, y);
      if (distance(now, at(baseline, x, y)) <= 12) continue;
      r += now[0];
      g += now[1];
      b += now[2];
      count += 1;
    }
  }
  expect(count).toBeGreaterThan(0);
  return [r / count, g / count, b / count];
}

/** How many pixels of a box `shot` paints over `baseline`. */
function paintedCount(
  shot: Uint8ClampedArray,
  baseline: Uint8ClampedArray,
  cx: number,
  cy: number,
  size: number,
): number {
  let count = 0;
  const half = Math.ceil(size / 2);
  for (let y = Math.round(cy - half); y <= Math.round(cy + half); y += 1) {
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x += 1) {
      if (x < 0 || y < 0 || x >= STAGE_W || y >= STAGE_H) continue;
      if (distance(at(shot, x, y), at(baseline, x, y)) > 12) count += 1;
    }
  }
  return count;
}

/** The mean colour over a whole box, painted or not. */
function boxMean(
  shot: Uint8ClampedArray,
  cx: number,
  cy: number,
  size: number,
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const half = Math.ceil(size / 2);
  for (let y = Math.round(cy - half); y <= Math.round(cy + half); y += 1) {
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x += 1) {
      if (x < 0 || y < 0 || x >= STAGE_W || y >= STAGE_H) continue;
      const now = at(shot, x, y);
      r += now[0];
      g += now[1];
      b += now[2];
      count += 1;
    }
  }
  return [r / count, g / count, b / count];
}

/** A state carrying one drone of `kind` and `band` at the centre of the field. */
function droneAt(
  kind: DroneKind,
  band: Band,
  shellAlive = true,
  bandClock = 0,
  charge = 0,
): SpectraState {
  const state = fieldBaseline();
  const drone = addDrone(state, { kind, band, x: 640, y: 300 });
  drone.shellAlive = shellAlive;
  drone.bandClock = bandClock;
  drone.charge = charge;
  return state;
}

describe("the field and its strips", () => {
  it("carries a starfield of distinct marks behind an empty field", () => {
    const shot = shoot(live());
    const ground: Rgb = [
      Number.parseInt(COLOR.field.slice(1, 3), 16),
      Number.parseInt(COLOR.field.slice(3, 5), 16),
      Number.parseInt(COLOR.field.slice(5, 7), 16),
    ];
    // Count connected-enough marks by sampling distinct bright pixels.
    let marks = 0;
    for (let y = FIELD_TOP + 1; y < FIELD_BOTTOM - 1; y += 1) {
      for (let x = 1; x < STAGE_W - 1; x += 1) {
        const here = at(shot, x, y);
        if (distance(here, ground) < 8) continue;
        const left = at(shot, x - 1, y);
        const above = at(shot, x, y - 1);
        // Only the top-left pixel of a mark is counted.
        if (distance(left, ground) < 8 && distance(above, ground) < 8)
          marks += 1;
      }
    }
    expect(marks).toBeGreaterThanOrEqual(STARFIELD_MIN);
  });

  it("keeps the play out of both HUD strips", () => {
    const state = fieldBaseline();
    for (let column = 0; column < 5; column += 1) {
      addDrone(state, {
        kind: "shard",
        band: "cyan",
        x: slotX(column + 2),
        y: slotY(0),
      });
    }
    addPlayerBullet(state, 640, 500, "cyan");
    const shot = shoot(state);
    const empty = shoot(fieldBaseline());
    // The strips are drawn over the field, so nothing of the play reaches them.
    for (const [from, to] of [
      [0, HUD_TOP_H - 1],
      [HUD_BOTTOM_TOP + 2, STAGE_H - 1],
    ] as const) {
      for (let y = from; y <= to; y += 2) {
        for (let x = 0; x < STAGE_W; x += 4) {
          expect(distance(at(shot, x, y), at(empty, x, y))).toBeLessThan(24);
        }
      }
    }
  });

  it("marks the whole field while an inversion is active", () => {
    const plain = shoot(live());
    const inverted = live();
    inverted.inversion = 3;
    const shot = shoot(inverted);
    let worst = 0;
    for (let y = FIELD_TOP + 20; y < FIELD_BOTTOM - 20; y += 17) {
      for (let x = 20; x < STAGE_W - 20; x += 23) {
        worst = Math.max(worst, distance(at(shot, x, y), at(plain, x, y)));
      }
    }
    expect(worst).toBeGreaterThanOrEqual(20);
  });
});

describe("the legibility table", () => {
  it("tells a cyan drone from a magenta one", () => {
    const empty = shoot(fieldBaseline());
    const cyan = paintedMean(
      shoot(droneAt("shard", "cyan")),
      empty,
      640,
      300,
      SHARD_SIZE,
    );
    const magenta = paintedMean(
      shoot(droneAt("shard", "magenta")),
      empty,
      640,
      300,
      SHARD_SIZE,
    );
    expect(distance(cyan, magenta)).toBeGreaterThanOrEqual(60);
  });

  it("stands each band apart from the field behind it", () => {
    const empty = shoot(fieldBaseline());
    for (const band of ["cyan", "magenta"] as const) {
      const shot = shoot(droneAt("shard", band));
      const painted = paintedMean(shot, empty, 640, 300, SHARD_SIZE);
      const ground = boxMean(empty, 640, 300, SHARD_SIZE);
      expect(distance(painted, ground)).toBeGreaterThanOrEqual(40);
    }
  });

  it("tells the three drones apart from one another", () => {
    const empty = shoot(fieldBaseline());
    const means = {
      shard: paintedMean(
        shoot(droneAt("shard", "cyan")),
        empty,
        640,
        300,
        SHARD_SIZE,
      ),
      flux: paintedMean(
        shoot(droneAt("flux", "cyan")),
        empty,
        640,
        300,
        FLUX_SIZE,
      ),
      prism: paintedMean(
        shoot(droneAt("prism", "cyan")),
        empty,
        640,
        300,
        PRISM_SIZE,
      ),
    };
    expect(distance(means.shard, means.flux)).toBeGreaterThan(40);
    expect(distance(means.shard, means.prism)).toBeGreaterThan(40);
    expect(distance(means.flux, means.prism)).toBeGreaterThan(40);
  });

  it("tells a shimmering Flux from one holding a band", () => {
    const empty = shoot(fieldBaseline());
    const holding = paintedMean(
      shoot(droneAt("flux", "cyan")),
      empty,
      640,
      300,
      FLUX_SIZE,
    );
    const shimmering = paintedMean(
      shoot(droneAt("flux", "cyan", true, fluxHold(1) + 0.1)),
      empty,
      640,
      300,
      FLUX_SIZE,
    );
    expect(distance(holding, shimmering)).toBeGreaterThan(25);
  });

  it("draws a broken Prism as its core alone, a smaller region", () => {
    const empty = shoot(fieldBaseline());
    const whole = paintedCount(
      shoot(droneAt("prism", "cyan", true)),
      empty,
      640,
      300,
      PRISM_SIZE,
    );
    const core = paintedCount(
      shoot(droneAt("prism", "cyan", false)),
      empty,
      640,
      300,
      PRISM_SIZE,
    );
    expect(core).toBeGreaterThan(0);
    expect(core).toBeLessThan(whole * 0.6);
    // And nothing of it is drawn outside the core's own footprint.
    const outside =
      core -
      paintedCount(
        shoot(droneAt("prism", "cyan", false)),
        empty,
        640,
        300,
        PRISM_CORE_SIZE,
      );
    expect(outside).toBeLessThan(core * 0.25);
  });

  it("reads the ship's band on the ship, and apart from the drones", () => {
    const empty = shoot(fieldBaseline());
    const shipShot = (band: Band): Uint8ClampedArray => {
      const state = live();
      state.ship.band = band;
      state.ship.x = 640;
      return shoot(state);
    };
    const cyanShip = paintedMean(shipShot("cyan"), empty, 640, SHIP_Y, SHIP_W);
    const magentaShip = paintedMean(
      shipShot("magenta"),
      empty,
      640,
      SHIP_Y,
      SHIP_W,
    );
    expect(distance(cyanShip, magentaShip)).toBeGreaterThanOrEqual(40);

    const drone = paintedMean(
      shoot(droneAt("shard", "cyan")),
      empty,
      640,
      300,
      SHARD_SIZE,
    );
    expect(distance(cyanShip, drone)).toBeGreaterThan(40);
    const ground = boxMean(empty, 640, SHIP_Y, SHIP_H);
    expect(distance(cyanShip, ground)).toBeGreaterThan(40);
  });

  it("draws a bullet in code, in its band, on the art's own palette", () => {
    const empty = shoot(fieldBaseline());
    const bulletShot = (band: Band): Uint8ClampedArray => {
      const state = fieldBaseline();
      addPlayerBullet(state, 640, 300, band);
      return shoot(state);
    };
    const cyanBullet = paintedMean(bulletShot("cyan"), empty, 640, 300, 20);
    const magentaBullet = paintedMean(
      bulletShot("magenta"),
      empty,
      640,
      300,
      20,
    );
    expect(distance(cyanBullet, magentaBullet)).toBeGreaterThanOrEqual(60);

    const cyanDrone = paintedMean(
      shoot(droneAt("shard", "cyan")),
      empty,
      640,
      300,
      SHARD_SIZE,
    );
    const magentaDrone = paintedMean(
      shoot(droneAt("shard", "magenta")),
      empty,
      640,
      300,
      SHARD_SIZE,
    );
    // One palette for both: a code-drawn band lands nearer its own art band.
    expect(distance(cyanBullet, cyanDrone)).toBeLessThan(
      distance(cyanBullet, magentaDrone),
    );
    expect(distance(magentaBullet, magentaDrone)).toBeLessThan(
      distance(magentaBullet, cyanDrone),
    );
  });
});

/** A one-shot of the seeded system's shape, so a burst has particles to draw. */
const BURST: ParticleSystem = {
  dimensions: 2,
  field: { width: 128, height: 128 },
  durationMs: 700,
  fps: 60,
  loop: false,
  emitters: [
    {
      name: "sparks",
      shape: "point",
      position: [64, 64, 0],
      extent: { radius: 1, size: [1, 1, 0] },
      emission: { mode: "burst", count: 60, atMs: 0 },
      lifetimeMs: 500,
      speed: 90,
      direction: [0, 1, 0],
      coneAngle: 360,
      particle: {
        sizeCurve: { interp: "linear", from: 10, to: 2 },
        opacityCurve: { interp: "linear", from: 1, to: 0.4 },
        colorGradient: [{ color: "#ffffff", at: 0 }],
      },
    },
  ],
};

describe("the drone-burst", () => {
  it("paints the particles its own simulation reports, inside its footprint", () => {
    useBurstSystem(BURST);
    try {
      const empty = shoot(fieldBaseline());
      const state = fieldBaseline();
      startBurst(state, 99, 640, 300, PRISM_SIZE);
      const shot = shoot(state);
      expect(paintedCount(shot, empty, 640, 300, PRISM_SIZE)).toBeGreaterThan(
        20,
      );
      // Nothing of it is painted far outside the footprint it is played at.
      const near = paintedCount(shot, empty, 640, 300, PRISM_SIZE * 1.4);
      const wide = paintedCount(shot, empty, 640, 300, PRISM_SIZE * 4);
      expect(wide - near).toBeLessThan(near * 0.2);
    } finally {
      useBurstSystem(null);
    }
  });
});

describe("the charge telegraph", () => {
  it("shows nothing at zero and a visible step at each charge", () => {
    const shots = [0, 1, 2].map((charge) =>
      shoot(droneAt("shard", "cyan", true, 0, charge)),
    );
    const means = shots.map((shot) => boxMean(shot, 640, 300, SHARD_SIZE));
    expect(distance(means[0] as Rgb, means[1] as Rgb)).toBeGreaterThanOrEqual(
      25,
    );
    expect(distance(means[1] as Rgb, means[2] as Rgb)).toBeGreaterThanOrEqual(
      25,
    );
  });

  it("draws none at all once the drone has overloaded back to zero", () => {
    const plain = shoot(droneAt("shard", "cyan", true, 0, 0));
    const again = shoot(droneAt("shard", "cyan", true, 0, 0));
    expect(
      distance(
        boxMean(plain, 640, 300, SHARD_SIZE),
        boxMean(again, 640, 300, SHARD_SIZE),
      ),
    ).toBe(0);
    const charged = shoot(droneAt("shard", "cyan", true, 0, 1));
    expect(
      distance(
        boxMean(plain, 640, 300, SHARD_SIZE),
        boxMean(charged, 640, 300, SHARD_SIZE),
      ),
    ).toBeGreaterThan(0);
  });
});

describe("the HUD", () => {
  it("grows the meter's fill with the meter and marks a full one", () => {
    const meterShot = (resonance: number): Uint8ClampedArray => {
      const state = live();
      state.resonance = resonance;
      return shoot(state);
    };
    const fill = (data: Uint8ClampedArray): number => {
      let painted = 0;
      const y = HUD_BOTTOM_TOP + 39;
      const ground = at(meterShot(0), 690, y);
      for (let x = 300; x < 700; x += 1) {
        if (distance(at(data, x, y), ground) > 12) painted += 1;
      }
      return painted;
    };
    const empty = fill(meterShot(0));
    const half = fill(meterShot(RESONANCE_MAX / 2));
    const full = fill(meterShot(RESONANCE_MAX));
    expect(half).toBeGreaterThan(empty + 100);
    expect(full).toBeGreaterThan(half + 100);
    // A full meter reads differently from one a point below full.
    const nearlyFull = meterShot(RESONANCE_MAX - 1);
    const brimming = meterShot(RESONANCE_MAX);
    let worst = 0;
    for (let x = 290; x < 720; x += 3) {
      for (let y = HUD_BOTTOM_TOP + 20; y < HUD_BOTTOM_TOP + 56; y += 3) {
        worst = Math.max(
          worst,
          distance(at(nearlyFull, x, y), at(brimming, x, y)),
        );
      }
    }
    expect(worst).toBeGreaterThan(30);
  });

  it("reports the ship's band in the polarity indicator", () => {
    const shot = (band: Band): Uint8ClampedArray => {
      const state = live();
      state.ship.band = band;
      return shoot(state);
    };
    const cyan = shot("cyan");
    const magenta = shot("magenta");
    let worst = 0;
    for (let x = 856; x < 1060; x += 2) {
      for (let y = HUD_BOTTOM_TOP + 18; y < HUD_BOTTOM_TOP + 52; y += 2) {
        worst = Math.max(worst, distance(at(cyan, x, y), at(magenta, x, y)));
      }
    }
    expect(worst).toBeGreaterThan(40);
  });

  it("shows the lives, and changes with them", () => {
    const shot = (lives: number): Uint8ClampedArray => {
      const state = live();
      state.lives = lives;
      return shoot(state);
    };
    const painted = (
      data: Uint8ClampedArray,
      baseline: Uint8ClampedArray,
    ): number => {
      let count = 0;
      for (let x = 20; x < 180; x += 1) {
        for (let y = HUD_BOTTOM_TOP + 26; y < HUD_BOTTOM_TOP + 52; y += 1) {
          if (distance(at(data, x, y), at(baseline, x, y)) > 12) count += 1;
        }
      }
      return count;
    };
    const none = shot(0);
    expect(painted(shot(1), none)).toBeGreaterThan(0);
    expect(painted(shot(3), none)).toBeGreaterThan(painted(shot(1), none));
  });

  it("shows a mute indicator only while sound is muted", () => {
    const loud = shoot(live());
    const quiet = live();
    quiet.muted = true;
    const shot = shoot(quiet);
    let worst = 0;
    for (let x = 1100; x < STAGE_W - 10; x += 1) {
      for (let y = HUD_BOTTOM_TOP + 20; y < HUD_BOTTOM_TOP + 50; y += 1) {
        worst = Math.max(worst, distance(at(shot, x, y), at(loud, x, y)));
      }
    }
    expect(worst).toBeGreaterThan(20);
    // Nothing else about the HUD changes.
    for (let x = 0; x < 1080; x += 3) {
      for (let y = HUD_BOTTOM_TOP; y < STAGE_H; y += 3) {
        expect(distance(at(shot, x, y), at(loud, x, y))).toBeLessThan(12);
      }
    }
  });
});

describe("every screen draws", () => {
  it("renders each of the seven screens without a throw and paints something", () => {
    const screens: SpectraState["screen"][] = [
      "title",
      "howto",
      "stageIntro",
      "inWave",
      "paused",
      "stageCleared",
      "gameOver",
    ];
    for (const screen of screens) {
      const state = live();
      state.screen = screen;
      if (screen === "stageCleared") state.stage = 3;
      const shot = shoot(state);
      const ground: Rgb = [
        Number.parseInt(COLOR.bg.slice(1, 3), 16),
        Number.parseInt(COLOR.bg.slice(3, 5), 16),
        Number.parseInt(COLOR.bg.slice(5, 7), 16),
      ];
      let changed = 0;
      for (let x = 0; x < STAGE_W; x += 7) {
        for (let y = 0; y < STAGE_H; y += 7) {
          if (distance(at(shot, x, y), ground) > 10) changed += 1;
        }
      }
      expect(changed).toBeGreaterThan(400);
    }
  });

  it("draws the ready banner only during the ready phase", () => {
    const plain = shoot(live());
    const holding = live();
    holding.phase = "ready";
    const shot = shoot(holding);
    let worst = 0;
    for (let x = 300; x < 1000; x += 3) {
      for (let y = 320; y < 400; y += 3) {
        worst = Math.max(worst, distance(at(shot, x, y), at(plain, x, y)));
      }
    }
    expect(worst).toBeGreaterThan(0);
  });

  it("draws a discharge wave while one is live", () => {
    const plain = shoot(live());
    const wave = live();
    wave.discharge = { active: true, elapsed: 0.2, radius: 200 };
    const shot = shoot(wave);
    let worst = 0;
    for (let x = 400; x < 900; x += 3) {
      worst = Math.max(worst, distance(at(shot, x, 420), at(plain, x, 420)));
    }
    expect(worst).toBeGreaterThan(20);
  });

  it("draws every charge of the overload telegraph on all three kinds", () => {
    const empty = shoot(fieldBaseline());
    for (const kind of ["shard", "flux", "prism"] as const) {
      for (let charge = 1; charge <= OVERLOAD_AT - 1; charge += 1) {
        const shot = shoot(droneAt(kind, "cyan", true, 0, charge));
        expect(paintedCount(shot, empty, 640, 300, PRISM_SIZE)).toBeGreaterThan(
          0,
        );
      }
    }
  });
});
