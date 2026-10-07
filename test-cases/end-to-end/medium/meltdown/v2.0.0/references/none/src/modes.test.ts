import { describe, expect, it } from "vitest";
import { MODES } from "./constants";
import { MODE_BLURBS, modeFigures } from "./modes";

describe("the derived figures", () => {
  it("gives Containment its three difficulties and nothing else", () => {
    expect(modeFigures("containment", "easy")).toEqual({
      startMoney: 350,
      waveCount: 15,
      startLives: 20,
      interest: true,
      buildPhases: true,
      buildZone: null,
    });
    expect(modeFigures("containment", "medium")).toMatchObject({
      startMoney: 250,
      waveCount: 20,
    });
    expect(modeFigures("containment", "hard")).toMatchObject({
      startMoney: 200,
      waveCount: 26,
    });
  });

  it("runs The Hundred as one wave with no interest", () => {
    expect(modeFigures("hundred", "medium")).toMatchObject({
      startMoney: 600,
      waveCount: 1,
      startLives: 20,
      interest: false,
      buildPhases: false,
      buildZone: null,
    });
  });

  it("opens Deep Pockets rich and pays it no interest", () => {
    expect(modeFigures("deeppockets", "medium")).toMatchObject({
      startMoney: 10000,
      waveCount: 20,
      interest: false,
    });
  });

  it("restricts Bottleneck to its marked zone", () => {
    expect(modeFigures("bottleneck", "medium")).toMatchObject({
      startMoney: 300,
      buildZone: { col0: 13, row0: 8, col1: 36, row1: 27 },
    });
  });

  it("opens Sudden Death on one life", () => {
    expect(modeFigures("suddendeath", "medium")).toMatchObject({
      startMoney: 300,
      startLives: 1,
      waveCount: 20,
    });
  });

  it("ignores the difficulty on every mode but Containment", () => {
    for (const mode of MODES) {
      if (mode === "containment") continue;
      const easy = modeFigures(mode, "easy");
      const hard = modeFigures(mode, "hard");
      expect(easy).toEqual(hard);
    }
  });

  it("describes every mode before it is chosen", () => {
    for (const mode of MODES) {
      expect(MODE_BLURBS[mode].length).toBeGreaterThan(20);
    }
  });
});
