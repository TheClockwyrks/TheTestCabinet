// The pure pieces the rest of the build rests on: the channel's arc-length
// measure, the seeded generator, the two numeric helpers, and the produced files
// on disk.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INLET, INTAKE, LEGS, forwardAt, legAt, pointAt } from "./channel";
import {
  CHANNEL,
  CHARGE_IDS,
  CUES,
  MACHINERY_KINDS,
  PATH_LENGTH,
} from "./constants";
import { clamp, normalizeAngle, radians } from "./math";
import { nextFloat, nextInt, pick, seedState } from "./rng";
import { PARTICLE_SYSTEMS, SHEETS, type SheetName } from "./assets";

/** The produced files, where the build serves them from. */
const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "assets",
);

/** The width and height of a PNG, read straight out of its header. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(path.join(ASSETS, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the channel", () => {
  it("derives the arc distance the specification tabulates at each vertex", () => {
    const tabulated = [
      0, 880, 1340, 2140, 2520, 3240, 3540, 4160, 4360, 4760, 4860,
    ];
    expect(LEGS.map((leg) => leg.at)).toEqual(tabulated);
    expect(LEGS.length).toBe(CHANNEL.length - 1);
    const total = LEGS.reduce((sum, leg) => sum + leg.length, 0);
    expect(total).toBe(PATH_LENGTH);
  });

  it("puts the inlet at the first vertex and the intake at the last", () => {
    expect(INLET).toEqual(CHANNEL[0]);
    expect(INTAKE).toEqual(CHANNEL[CHANNEL.length - 1]);
  });

  it("selects the leg whose start carries the greatest arc distance under s", () => {
    expect(legAt(0)).toBe(LEGS[0]);
    expect(legAt(879.9)).toBe(LEGS[0]);
    expect(legAt(880)).toBe(LEGS[1]);
    expect(legAt(PATH_LENGTH)).toBe(LEGS[LEGS.length - 1]);
    // An arc position below zero selects the first leg as well.
    expect(legAt(-40)).toBe(LEGS[0]);
  });

  it("draws a core below the inlet at the inlet", () => {
    expect(pointAt(-100)).toEqual(INLET);
    expect(forwardAt(-100)).toEqual({ x: 1, y: 0 });
  });

  it("walks a point along the leg it lies on", () => {
    expect(pointAt(440)).toEqual({ x: 480, y: 40 });
    expect(pointAt(1100)).toEqual({ x: 920, y: 260 });
    expect(forwardAt(1100)).toEqual({ x: 0, y: 1 });
    expect(forwardAt(3600)).toEqual({ x: -1, y: 0 });
  });
});

describe("the seeded generator", () => {
  it("carries its whole state in one word", () => {
    expect(seedState(7)).toBe(7);
    expect(seedState(-1)).toBe(0xffffffff);
    expect(seedState(Number.NaN)).toBe(0);
  });

  it("answers the same sequence from the same seed", () => {
    const first = [0, 0, 0].reduce<number[]>(
      (out) => {
        const drawn = nextFloat(out[out.length - 1]);
        return [...out, drawn.state];
      },
      [5],
    );
    const second = [0, 0, 0].reduce<number[]>(
      (out) => {
        const drawn = nextFloat(out[out.length - 1]);
        return [...out, drawn.state];
      },
      [5],
    );
    expect(second).toEqual(first);
  });

  it("draws inside the bound it is given", () => {
    let state = 1;
    for (let i = 0; i < 200; i += 1) {
      const drawn = nextInt(state, 5);
      expect(drawn.value).toBeGreaterThanOrEqual(0);
      expect(drawn.value).toBeLessThan(5);
      state = drawn.state;
    }
    expect(nextInt(state, 1).value).toBe(0);
  });

  it("refuses to draw from an empty set", () => {
    expect(() => pick(1, [])).toThrow(RangeError);
  });

  it("reaches every charge over enough draws", () => {
    const seen = new Set<string>();
    let state = 1;
    for (let i = 0; i < 400; i += 1) {
      const drawn = pick(state, CHARGE_IDS);
      seen.add(drawn.value);
      state = drawn.state;
    }
    expect(seen.size).toBe(CHARGE_IDS.length);
  });
});

describe("the numeric helpers", () => {
  it("clamps into a closed range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it("folds an angle into a single turn", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(725)).toBe(5);
    expect(normalizeAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("turns degrees into radians", () => {
    expect(radians(180)).toBeCloseTo(Math.PI, 12);
  });
});

describe("the produced set on disk", () => {
  it("carries one core per charge, at 28 x 28", () => {
    for (const charge of CHARGE_IDS) {
      expect(pngSize(`cores/${charge}.png`)).toEqual({ width: 28, height: 28 });
    }
  });

  it("carries one badge per machinery kind, at 16 x 16", () => {
    for (const kind of MACHINERY_KINDS) {
      expect(pngSize(`marks/${kind}.png`)).toEqual({ width: 16, height: 16 });
    }
  });

  it("carries the machine and the HUD icons at their stated sizes", () => {
    expect(pngSize("machine/injector-base.png")).toEqual({
      width: 44,
      height: 44,
    });
    expect(pngSize("machine/injector-barrel.png")).toEqual({
      width: 44,
      height: 20,
    });
    expect(pngSize("machine/intake-maw.png")).toEqual({
      width: 64,
      height: 64,
    });
    expect(pngSize("machine/channel-plate.png")).toEqual({
      width: 64,
      height: 64,
    });
    expect(pngSize("hud/cell.png")).toEqual({ width: 24, height: 24 });
    expect(pngSize("hud/pressure.png")).toEqual({ width: 24, height: 24 });
  });

  it("carries every sheet frame at the sheet's own canvas", () => {
    const canvases: Record<SheetName, { width: number; height: number }> = {
      "fire-recoil": { width: 44, height: 20 },
      "maw-swallow": { width: 64, height: 64 },
      "extraction-flash": { width: 48, height: 48 },
    };
    for (const name of Object.keys(SHEETS) as SheetName[]) {
      for (let frame = 0; frame < SHEETS[name]; frame += 1) {
        expect(pngSize(`sheets/${name}/${frame}.png`)).toEqual(canvases[name]);
      }
    }
  });

  it("parses each produced system, with a field and emitters", () => {
    for (const name of PARTICLE_SYSTEMS) {
      const system = JSON.parse(
        readFileSync(path.join(ASSETS, "fx", `${name}.system.json`), "utf8"),
      ) as {
        field: { width: number };
        emitters: unknown[];
        durationMs: number;
      };
      expect(system.field.width).toBeGreaterThan(0);
      expect(system.emitters.length).toBeGreaterThan(0);
      expect(system.durationMs).toBeGreaterThan(0);
    }
  });

  it("carries a real, non-empty file for every one of the fifteen cues", () => {
    for (const cue of Object.values(CUES)) {
      const bytes = readFileSync(path.join(ASSETS, "audio", `${cue}.wav`));
      expect(bytes.byteLength).toBeGreaterThan(1000);
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    }
  });

  it("carries a portable MIDI beside each produced bed", () => {
    for (const bed of ["hall-loop", "danger-loop"]) {
      const bytes = readFileSync(path.join(ASSETS, "audio", `${bed}.mid`));
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("MThd");
    }
  });
});
