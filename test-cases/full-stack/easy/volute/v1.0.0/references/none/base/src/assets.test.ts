/// <reference types="node" />
// The produced set as the bundler resolves it: that every file the game names is
// there, at the size `specs/assets.md` fixes, and that every URL is page-relative.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARGE_IDS, CUES, MACHINERY_KINDS } from "./constants";
import { PARTICLE_SYSTEMS, SHEETS, spriteUrl, type SheetName } from "./assets";

const ROOT = join(__dirname, "..", "assets");

/** The width and height of a PNG, read straight out of its header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(join(ROOT, path));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the produced sprites", () => {
  it("carries one core per charge, at 28 x 28", () => {
    for (const charge of CHARGE_IDS) {
      expect(pngSize(`cores/${charge}.png`)).toEqual({ width: 28, height: 28 });
      expect(spriteUrl(`cores/${charge}`)).toBeTruthy();
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

  it("reports no URL for a sprite the set does not carry", () => {
    expect(spriteUrl("cores/quartz")).toBeUndefined();
  });
});

describe("the produced systems and cues", () => {
  it("parses each system, with a field and emitters", () => {
    for (const name of PARTICLE_SYSTEMS) {
      const system = JSON.parse(
        readFileSync(join(ROOT, "fx", `${name}.system.json`), "utf8"),
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
    for (const cue of CUES) {
      const bytes = readFileSync(join(ROOT, "audio", `${cue}.wav`));
      expect(bytes.byteLength).toBeGreaterThan(1000);
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    }
  });
});
