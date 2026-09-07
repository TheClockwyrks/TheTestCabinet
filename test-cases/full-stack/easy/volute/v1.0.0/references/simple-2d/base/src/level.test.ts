// Opening a level, and the two pure rules around it: the angle every heading is
// folded through, and the cadence that decides which core the level delivers
// carries a mark.

import { describe, expect, it } from "vitest";
import { LEVELS, LEVEL_COUNT, MARK_INTERVAL, SEEDED_CORES } from "./constants";
import { createDraft } from "./level";
import {
  chargesOnChannel,
  levelSpec,
  markForNextDelivery,
  normalizeAngle,
  startLevel,
  startRun,
  toTitle,
} from "./level";

describe("normalizeAngle", () => {
  it("folds any heading into [0, 360)", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(359.5)).toBe(359.5);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(-720)).toBe(0);
  });

  it("answers zero for a heading that is not a number", () => {
    expect(normalizeAngle(Number.NaN)).toBe(0);
    expect(normalizeAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("levelSpec", () => {
  it("clamps a level number into the table", () => {
    expect(levelSpec(1)).toBe(LEVELS[0]);
    expect(levelSpec(LEVEL_COUNT)).toBe(LEVELS[LEVEL_COUNT - 1]);
    expect(levelSpec(0)).toBe(LEVELS[0]);
    expect(levelSpec(99)).toBe(LEVELS[LEVEL_COUNT - 1]);
    expect(levelSpec(2.4)).toBe(LEVELS[1]);
  });
});

describe("markForNextDelivery", () => {
  it("marks every twelfth core, cycling the four kinds", () => {
    const draft = createDraft();
    draft.level = 5;
    const quota = LEVELS[4].quota;
    const marks: (string | null)[] = [];
    for (let ordinal = 1; ordinal <= 60; ordinal += 1) {
      draft.quotaRemaining = quota - ordinal + 1;
      marks.push(markForNextDelivery(draft));
    }
    expect(marks.filter((mark) => mark !== null)).toEqual([
      "choke",
      "backflow",
      "bore",
      "sightline",
      "choke",
    ]);
    for (let i = 0; i < marks.length; i += 1) {
      if ((i + 1) % MARK_INTERVAL !== 0) expect(marks[i]).toBeNull();
    }
  });
});

describe("chargesOnChannel", () => {
  it("lists the distinct charges standing on it, in train order", () => {
    const draft = createDraft();
    draft.cores = [
      { charge: "garnet", s: 300, mark: null, hold: 0 },
      { charge: "halide", s: 272, mark: null, hold: 0 },
      { charge: "garnet", s: 244, mark: null, hold: 0 },
    ];
    expect(chargesOnChannel(draft)).toEqual(["garnet", "halide"]);
    expect(chargesOnChannel(createDraft())).toEqual([]);
  });
});

describe("opening and closing a run", () => {
  it("seeds the channel and draws a loaded and queued core", () => {
    const draft = createDraft();
    startLevel(draft, 2);
    expect(draft.screen).toBe("playing");
    expect(draft.cores).toHaveLength(SEEDED_CORES);
    expect(draft.quotaRemaining).toBe(LEVELS[1].quota - SEEDED_CORES);
    expect(draft.loaded).not.toBeNull();
    expect(draft.queued).not.toBeNull();
  });

  it("keeps the aim across a level change, and resets it on the way to the title", () => {
    const draft = createDraft();
    draft.aim = 123;
    startRun(draft);
    expect(draft.aim).toBe(123);
    expect(draft.level).toBe(1);
    toTitle(draft);
    expect(draft.aim).toBe(270);
    expect(draft.screen).toBe("title");
    expect(draft.cores).toEqual([]);
  });
});
