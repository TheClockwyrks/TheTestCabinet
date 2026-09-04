// The picture: that it is drawn from the produced files, that the five charges
// are told apart where they stand, and that the HUD carries what specs/ui.md says
// it carries.
//
// The engine hands `render` the canvas already cleared to `BACKGROUND` and
// carrying the letterboxed fit, so a pixel read at a field coordinate is the
// pixel that field coordinate produced. The harness's context is a recorder, so a
// check can read the draw operations as well as the pixels — which is how "drawn
// from a produced sprite" is told from "drawn as a disc in code".

import { describe, expect, it } from "vitest";
import {
  CHARGE_IDS,
  CORE_RADIUS,
  INJECTOR_X,
  INJECTOR_Y,
  PRESSURE_MAX,
} from "./constants";
import type { ChargeId } from "./constants";
import { BACKGROUND } from "./game";
import {
  bare,
  callsTo,
  drawnText,
  harness,
  seatShot,
  topLegS,
  type Harness,
} from "./harness.test";
import { PLATE_WIDTH, sightlineEnd } from "./render";

/**
 * Five places along the straight leg at `y = 220`, which runs from `x = 220` to
 * `x = 620`, far enough apart that no two cores' halos meet.
 */
const SPREAD = [280, 350, 420, 490, 560];

/** The mean RGB over the disc of radius 13 around a field point. */
function meanRgb(
  h: Harness,
  x: number,
  y: number,
  radius = 13,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const [pr, pg, pb] = h.pixel(x + dx, y + dy);
      r += pr;
      g += pg;
      b += pb;
      n += 1;
    }
  }
  return [r / n, g / n, b / n];
}

/** The distance between two mean colors, on the 0-441 scale. */
function rgbDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A hall with one core of each charge standing on the straight top run. */
async function fiveCharges(): Promise<Harness> {
  const h = await bare();
  h.api.poseTrain(
    CHARGE_IDS.map((charge, index) => [topLegS(SPREAD[index]), charge, null]),
  );
  await h.step();
  return h;
}

describe("the produced art", () => {
  it("draws a core from its produced 28 x 28 sprite", async () => {
    const h = await bare();
    h.api.poseTrain([[topLegS(400), "halide", null]]);
    h.calls.length = 0;
    await h.step();

    // A nine-argument `drawImage` whose source rectangle is the whole 28 x 28
    // sprite, at the core's own place on the field.
    const cores = callsTo(h.calls, "drawImage").filter(
      (args) => args.length === 9 && args[3] === 28 && args[4] === 28,
    );
    expect(cores.length).toBeGreaterThan(0);
    h.dispose();
  });

  it("draws the injector, the maw, the plate and the HUD icons from produced files", async () => {
    const h = await harness();
    h.api.start();
    h.calls.length = 0;
    await h.step();

    const sizes = new Set(
      callsTo(h.calls, "drawImage")
        .filter((args) => args.length === 9)
        .map((args) => `${String(args[3])}x${String(args[4])}`),
    );
    // The core (28), the injector base (44) and barrel (44 x 20), the maw (64),
    // and the two HUD icons (24).
    expect(sizes).toContain("28x28");
    expect(sizes).toContain("44x44");
    expect(sizes).toContain("44x20");
    expect(sizes).toContain("64x64");
    expect(sizes).toContain("24x24");
    // The channel plate is a repeating pattern rather than a placed image.
    expect(callsTo(h.calls, "createPattern")).toHaveLength(1);
    h.dispose();
  });

  it("samples the produced pixel art nearest-neighbor", async () => {
    const h = await harness();
    h.api.start();
    h.calls.length = 0;
    await h.step();
    expect(
      h.calls.some(
        (call) =>
          call.kind === "set" &&
          call.property === "imageSmoothingEnabled" &&
          call.value === false,
      ),
    ).toBe(true);
    h.dispose();
  });

  it("plays the produced flash sheet over an extraction, frame by frame", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - 28, "halide", null],
        [head - 56, "cobalt", null],
      ],
      "halide",
    );

    // The flash is a 48 x 48 sheet; each frame is a distinct image, so the set of
    // images drawn at that size grows as the sheet plays.
    const seen = new Set<unknown>();
    for (let i = 0; i < 30; i += 1) {
      h.calls.length = 0;
      await h.step();
      for (const args of callsTo(h.calls, "drawImage")) {
        if (args.length === 9 && args[3] === 48 && args[4] === 48) {
          seen.add(args[0]);
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    h.dispose();
  });

  it("drops the effects still playing when the surface re-opens the hall", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - 28, "halide", null],
        [head - 56, "cobalt", null],
      ],
      "halide",
    );

    const flashes = (): number =>
      callsTo(h.calls, "drawImage").filter(
        (args) => args.length === 9 && args[3] === 48 && args[4] === 48,
      ).length;

    h.calls.length = 0;
    await h.step();
    expect(flashes()).toBeGreaterThan(0);

    // A `reset` puts a different hall on the field, so the burst still playing
    // over the old one goes with it (specs/instrumentation.md: after a reset,
    // anything the build keeps across ticks is derived from the declared fields).
    h.api.reset();
    h.calls.length = 0;
    await h.step();
    expect(flashes()).toBe(0);
    h.dispose();
  });

  it("plays the produced particle burst over an extraction", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - 28, "halide", null],
        [head - 56, "cobalt", null],
      ],
      "halide",
    );
    // The burst composites live particles as radial-gradient discs, which the
    // control hall below draws none of.
    h.calls.length = 0;
    await h.step(4);
    const gradients = callsTo(h.calls, "createRadialGradient").length;

    const control = await bare();
    control.api.poseTrain([[head, "halide", null]]);
    control.calls.length = 0;
    await control.step(4);
    expect(gradients).toBeGreaterThan(
      callsTo(control.calls, "createRadialGradient").length,
    );
    control.dispose();
    h.dispose();
  });

  it("swings the barrel back through the produced recoil sheet after a shot", async () => {
    const h = await bare();
    h.api.fireAt(270);
    const frames = new Set<unknown>();
    for (let i = 0; i < 12; i += 1) {
      h.calls.length = 0;
      await h.step();
      for (const args of callsTo(h.calls, "drawImage")) {
        if (args.length === 9 && args[3] === 44 && args[4] === 20) {
          frames.add(args[0]);
        }
      }
    }
    // Four recoil frames inside the 0.18 s cooldown, then the barrel sprite.
    expect(frames.size).toBeGreaterThanOrEqual(4);
    h.dispose();
  });
});

describe("the charges", () => {
  it("tells all five apart where they stand on the channel", async () => {
    const h = await fiveCharges();
    const means = h.api
      .snapshot()
      .train.map((core) => meanRgb(h, core.x, core.y));
    expect(means).toHaveLength(CHARGE_IDS.length);
    for (let i = 0; i < means.length; i += 1) {
      for (let j = i + 1; j < means.length; j += 1) {
        expect(rgbDistance(means[i], means[j])).toBeGreaterThan(50);
      }
    }
    h.dispose();
  });

  it("stands every charge off the field and off the plate", async () => {
    const h = await fiveCharges();
    // (320, 270) is empty field, 50 units clear of every leg; (320, 420) is bare
    // plate on the leg the posed cores are not on.
    const field = meanRgb(h, 320, 270, 4);
    const plate = meanRgb(h, 320, 420, 4);
    expect(rgbDistance(field, plate)).toBeGreaterThan(0);
    for (const core of h.api.snapshot().train) {
      const mean = meanRgb(h, core.x, core.y);
      expect(rgbDistance(mean, field)).toBeGreaterThan(50);
      expect(rgbDistance(mean, plate)).toBeGreaterThan(50);
    }
    h.dispose();
  });

  it("clears the field to the background the engine was given", async () => {
    const h = await harness();
    await h.step();
    expect(BACKGROUND).toBe("#0a0e12");
    // A point far from the channel, the injector, and every screen panel.
    expect(h.pixel(20, 300)).toEqual([0x0a, 0x0e, 0x12, 255]);
    h.dispose();
  });
});

describe("the HUD", () => {
  /** Every string drawn on one frame of a hall in play. */
  async function drawn(h: Harness): Promise<string[]> {
    h.calls.length = 0;
    await h.step();
    return drawnText(h.calls);
  }

  it("carries the score in digits, updated on the tick it changes", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - 28, "halide", null],
        [head - 56, "halide", null],
        [head - 84, "halide", null],
        [head - 112, "cobalt", null],
      ],
      "halide",
    );
    expect(h.api.snapshot().score).toBe(50);
    expect(await drawn(h)).toContain("50");
    h.dispose();
  });

  it("carries the level in play", async () => {
    const h = await bare(4);
    h.api.poseTrain([[1000, "halide", null]]);
    expect(await drawn(h)).toContain("4");
    h.dispose();
  });

  it("draws one produced cell icon per cell remaining", async () => {
    const h = await harness();
    h.api.start();
    h.calls.length = 0;
    await h.step();
    const icons = callsTo(h.calls, "drawImage").filter(
      (args) => args.length === 9 && args[3] === 24 && args[4] === 24,
    );
    // Three cells, plus the one pressure icon.
    expect(icons).toHaveLength(4);
    h.dispose();
  });

  it("fills the gauge in proportion to the pressure", async () => {
    const widths: number[] = [];
    for (const pressure of [0, 50, PRESSURE_MAX]) {
      const h = await bare();
      h.api.poseTrain([[1000, "halide", null]]);
      h.api.setPressure(pressure);
      h.calls.length = 0;
      await h.step();
      // The gauge's fill is the only `fillRect` inside the HUD band whose height
      // is the bar's 14 units.
      const fills = callsTo(h.calls, "fillRect").filter(
        (args) => args[3] === 14,
      );
      widths.push(fills.length === 0 ? 0 : Number(fills[0][2]));
      h.dispose();
    }
    expect(widths[0]).toBe(0);
    expect(widths[1]).toBeGreaterThan(0);
    expect(widths[2]).toBeGreaterThan(widths[1]);
  });

  it("draws the loaded and the queued charge as their own cores", async () => {
    const h = await bare();
    h.api.poseTrain([[1000, "halide", null]]);
    h.api.setLoaded("garnet");
    h.api.setQueued("olivine");
    h.calls.length = 0;
    await h.step();

    // The HUD's loaded slot is drawn at 26 units and the queued at 20, so the two
    // are never mistaken for one another; both are produced core sprites.
    const sizes = callsTo(h.calls, "drawImage")
      .filter((args) => args.length === 9 && args[3] === 28)
      .map((args) => Number(args[7]));
    expect(sizes).toContain(26);
    expect(sizes).toContain(20);
    h.dispose();
  });
});

describe("the screens", () => {
  it("draws the title, its prompt, and the controls", async () => {
    const h = await harness();
    h.calls.length = 0;
    await h.step();
    // A tracked label is drawn glyph by glyph, so the frame's text is read as
    // one run rather than as a list of words.
    const text = drawnText(h.calls).join("");
    for (const glyph of "VOLUTE") expect(text).toContain(glyph);
    expect(text).toContain("PRESS ENTER TO BEGIN");
    expect(text).toContain("AIM");
    expect(text).toContain("FIRE");
    expect(text).toContain("SWAP");
    expect(text).toContain("PAUSE");
    expect(text).toContain("MUTE");
    h.dispose();
  });

  it("draws each of the other six screens", async () => {
    const cases: [() => Promise<Harness>, string][] = [
      [
        async () => {
          const h = await bare();
          h.api.poseTrain([[1000, "halide", null]]);
          h.api.pause();
          return h;
        },
        "PAUSED",
      ],
      [
        async () => {
          const h = await bare();
          const head = topLegS(430);
          await seatShot(
            h,
            [
              [head, "halide", null],
              [head - 28, "halide", null],
            ],
            "halide",
            () => {
              h.api.setQuotaRemaining(0);
            },
          );
          return h;
        },
        "CLEAR",
      ],
      [
        async () => {
          const h = await bare();
          h.api.poseTrain([[5000, "halide", null]]);
          await h.step();
          return h;
        },
        "CELL SPENT",
      ],
      [
        async () => {
          const h = await bare(5);
          const head = topLegS(430);
          await seatShot(
            h,
            [
              [head, "halide", null],
              [head - 28, "halide", null],
            ],
            "halide",
            () => {
              h.api.setQuotaRemaining(0);
            },
          );
          return h;
        },
        "HALL RUN CLEAN",
      ],
    ];

    for (const [build, copy] of cases) {
      const h = await build();
      h.calls.length = 0;
      await h.step();
      expect(drawnText(h.calls).join("")).toContain(copy);
      h.dispose();
    }
  });

  it("draws the danger warning while the head is near the intake", async () => {
    const h = await bare();
    h.api.poseTrain([[4500, "halide", null]]);
    h.calls.length = 0;
    await h.step();
    expect(drawnText(h.calls).join("")).toContain("DANGER");

    h.api.poseTrain([[1000, "halide", null]]);
    h.calls.length = 0;
    await h.step();
    expect(drawnText(h.calls).join("")).not.toContain("DANGER");
    h.dispose();
  });
});

describe("the sightline ray", () => {
  it("ends at the field edge when it crosses no core", async () => {
    const h = await bare();
    h.api.clearTrain();
    h.api.fireAt(0);
    const end = sightlineEnd(h.state);
    expect(end.x).toBeCloseTo(960, 6);
    expect(end.y).toBeCloseTo(INJECTOR_Y, 6);
    h.dispose();
  });

  it("finds the field edge in every direction", async () => {
    const h = await bare();
    h.api.clearTrain();
    for (const [aim, x, y] of [
      [180, 0, INJECTOR_Y],
      [270, INJECTOR_X, 0],
      [90, INJECTOR_X, 540],
    ] as const) {
      h.api.fireAt(aim);
      const end = sightlineEnd(h.state);
      expect(end.x).toBeCloseTo(x, 6);
      expect(end.y).toBeCloseTo(y, 6);
    }
    h.dispose();
  });

  it("ends at the near edge of the first core it crosses", async () => {
    const h = await bare();
    // A core directly above the injector, on the leg at y = 220.
    h.api.poseTrain([[topLegS(INJECTOR_X), "halide", null]]);
    h.api.fireAt(270);
    const end = sightlineEnd(h.state);
    expect(end.x).toBeCloseTo(INJECTOR_X, 6);
    expect(end.y).toBeCloseTo(220 + CORE_RADIUS, 6);
    h.dispose();
  });

  it("draws the ray only while sightline is active", async () => {
    const h = await bare();
    h.api.poseTrain([[1000, "halide", null]]);
    h.calls.length = 0;
    await h.step();
    const before = callsTo(h.calls, "stroke").length;

    h.api.grantMachinery("sightline");
    h.calls.length = 0;
    await h.step();
    expect(callsTo(h.calls, "stroke").length).toBeGreaterThan(before);
    h.dispose();
  });
});

describe("the plate", () => {
  it("is wide enough to carry a core", async () => {
    expect(PLATE_WIDTH).toBeGreaterThan(CORE_RADIUS * 2);
  });
});

describe("a host that can decode nothing", () => {
  it("still runs, still draws, and still tells the charges apart", async () => {
    const h = await harness({ assets: false });
    expect(h.assetFailures.length).toBeGreaterThan(0);
    h.api.startLevel(1);
    h.api.setQuotaRemaining(0);
    h.api.poseTrain(
      CHARGE_IDS.map((charge: ChargeId, index): [number, string, null] => [
        topLegS(SPREAD[index]),
        charge,
        null,
      ]),
    );
    h.calls.length = 0;
    await h.step();
    // No produced image was drawn, and the hall was drawn all the same.
    expect(callsTo(h.calls, "drawImage")).toHaveLength(0);
    expect(callsTo(h.calls, "arc").length).toBeGreaterThan(0);

    const means = h.api
      .snapshot()
      .train.map((core) => meanRgb(h, core.x, core.y));
    for (let i = 0; i < means.length; i += 1) {
      for (let j = i + 1; j < means.length; j += 1) {
        expect(rgbDistance(means[i], means[j])).toBeGreaterThan(50);
      }
    }
    h.dispose();
  });
});
