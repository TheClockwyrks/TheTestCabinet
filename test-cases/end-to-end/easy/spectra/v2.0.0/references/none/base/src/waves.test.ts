import { describe, expect, it } from "vitest";

import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  DIVE_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FORM_CENTER_X,
  FORM_COLS,
  PRISM_ESCORTS,
  fluxWindow,
  slotX,
  slotY,
} from "./constants";
import { createState } from "./game";
import { stubArt } from "./harness.test-support";
import { loopDivePath, returnPath, wrapDivePath } from "./swarm";
import {
  MAX_ENTRY_GROUPS,
  buildChallengeWave,
  buildLayout,
  buildStandardWave,
  challengeSweep,
  entrancePath,
  fluxCount,
  groupLayout,
  longestEntrance,
  prismCount,
  waveColumns,
  waveRows,
} from "./waves";

/** The stages a standard wave is built for, skipping the challenge stages. */
const STANDARD_STAGES = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 20, 30];

describe("a standard wave's formation", () => {
  it("fills a mirror-symmetric layout about the centre", () => {
    for (const stage of STANDARD_STAGES) {
      const filled = new Set(
        buildLayout(stage).map((slot) => `${slot.col},${slot.row}`),
      );
      for (const key of filled) {
        const [col, row] = key.split(",").map(Number);
        const mirrored = FORM_COLS - 1 - (col as number);
        expect(filled.has(`${mirrored},${row}`)).toBe(true);
        // And the mirror really is about FORM_CENTER_X.
        expect(slotX(col as number) + slotX(mirrored)).toBe(2 * FORM_CENTER_X);
      }
    }
  });

  it("holds Shards of both bands as its bulk, two Fluxes and a Prism", () => {
    for (const stage of STANDARD_STAGES) {
      const slots = buildLayout(stage);
      const kinds = slots.map((slot) => slot.kind);
      const shards = kinds.filter((kind) => kind === "shard").length;
      expect(
        kinds.filter((kind) => kind === "flux").length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        kinds.filter((kind) => kind === "prism").length,
      ).toBeGreaterThanOrEqual(1);
      expect(shards).toBeGreaterThan(slots.length / 2);
      const bands = new Set(slots.map((slot) => slot.band));
      expect(bands.has("cyan")).toBe(true);
      expect(bands.has("magenta")).toBe(true);
    }
  });

  it("grows with the stage, up to the grid's capacity", () => {
    let previous = 0;
    for (const stage of STANDARD_STAGES) {
      const total = buildLayout(stage).length;
      expect(total).toBeGreaterThanOrEqual(previous);
      expect(total).toBeLessThanOrEqual(FORM_COLS * 5);
      previous = total;
    }
    expect(buildLayout(1).length).toBeLessThan(buildLayout(20).length);
  });

  it("leans further on Fluxes and Prisms as the stage climbs", () => {
    expect(prismCount(1)).toBe(1);
    expect(prismCount(20)).toBe(3);
    expect(fluxCount(1)).toBe(2);
    expect(fluxCount(20)).toBe(6);
    for (const stage of STANDARD_STAGES) {
      expect(prismCount(stage)).toBeGreaterThanOrEqual(prismCount(1));
      expect(fluxCount(stage)).toBeGreaterThanOrEqual(fluxCount(1));
    }
  });

  it("keeps the block inside the grid", () => {
    for (const stage of STANDARD_STAGES) {
      for (const slot of buildLayout(stage)) {
        expect(slot.col).toBeGreaterThanOrEqual(0);
        expect(slot.col).toBeLessThan(FORM_COLS);
        expect(slot.row).toBeGreaterThanOrEqual(0);
        expect(slot.row).toBeLessThan(waveRows(stage));
        expect(waveColumns(stage)).toContain(slot.col);
      }
    }
  });
});

describe("a standard wave's entry groups", () => {
  it("releases the wave in between two and eight groups", () => {
    for (const stage of STANDARD_STAGES) {
      const groups = groupLayout(buildLayout(stage));
      expect(groups.length).toBeGreaterThanOrEqual(2);
      expect(groups.length).toBeLessThanOrEqual(MAX_ENTRY_GROUPS);
      // Every drone belongs to exactly one group.
      expect(groups.flat().length).toBe(buildLayout(stage).length);
    }
  });

  it("gives each Prism its own group, with two Shards of opposite bands", () => {
    for (const stage of STANDARD_STAGES) {
      const groups = groupLayout(buildLayout(stage));
      const prismGroups = groups.filter((group) =>
        group.some((slot) => slot.kind === "prism"),
      );
      expect(prismGroups.length).toBe(prismCount(stage));
      for (const group of prismGroups) {
        expect(group.filter((slot) => slot.kind === "prism").length).toBe(1);
        const escorts = group.filter((slot) => slot.kind === "shard");
        expect(escorts.length).toBe(PRISM_ESCORTS);
        expect(new Set(escorts.map((slot) => slot.band)).size).toBe(2);
      }
    }
  });
});

describe("a standard wave, built", () => {
  it("stands no drone inside the play field when the wave opens", () => {
    for (const stage of STANDARD_STAGES) {
      const state = createState(stubArt());
      state.stage = stage;
      const drones = buildStandardWave(state);
      expect(drones.length).toBe(buildLayout(stage).length);
      for (const drone of drones) {
        expect(drone.y).toBeLessThan(FIELD_TOP);
        expect(drone.phase).toBe("entering");
        expect(drone.released).toBe(false);
        expect(drone.shellAlive).toBe(true);
        expect(drone.travel).toBe(true);
        expect(drone.oscillation).toBe(true);
        expect(drone.fire).toBe(true);
      }
      // Every id is distinct.
      expect(new Set(drones.map((drone) => drone.id)).size).toBe(drones.length);
    }
  });

  it("draws each Flux's starting phase inside its band window", () => {
    const state = createState(stubArt());
    state.stage = 1;
    const drones = buildStandardWave(state);
    const clocks = drones
      .filter((drone) => drone.kind === "flux")
      .map((drone) => drone.bandClock);
    expect(clocks.length).toBeGreaterThanOrEqual(2);
    for (const clock of clocks) {
      expect(clock).toBeGreaterThanOrEqual(0);
      expect(clock).toBeLessThan(fluxWindow(1));
    }
    // Each Flux's clock is its own draw, so a fresh wave draws different ones.
    const other = createState(stubArt());
    other.stage = 1;
    const otherClocks = buildStandardWave(other)
      .filter((drone) => drone.kind === "flux")
      .map((drone) => drone.bandClock);
    expect(otherClocks).not.toEqual(clocks);
  });

  it("lays out the same block for a stage every time it is built", () => {
    const shape = (): string => {
      const state = createState(stubArt());
      state.stage = 5;
      return JSON.stringify(
        buildStandardWave(state).map((drone) => [
          drone.kind,
          drone.band,
          drone.slotX,
          drone.slotY,
          drone.entryGroup,
        ]),
      );
    };
    expect(shape()).toBe(shape());
  });

  it("numbers its entry groups from zero, with no gap", () => {
    const state = createState(stubArt());
    state.stage = 5;
    const groups = new Set(
      buildStandardWave(state).map((drone) => drone.entryGroup),
    );
    for (let i = 0; i < groups.size; i += 1) expect(groups.has(i)).toBe(true);
  });
});

describe("an entrance path", () => {
  it("crosses FIELD_TOP within a second of release, at stage-1 speed", () => {
    for (const col of [0, 2, 4, 6, 8]) {
      for (const row of [0, 2, 4]) {
        for (const fromLeft of [true, false]) {
          const path = entrancePath(slotX(col), slotY(row), fromLeft);
          let crossed = Infinity;
          for (let d = 0; d <= path.length; d += 2) {
            if (path.at(d).y >= FIELD_TOP) {
              crossed = d;
              break;
            }
          }
          expect(crossed / ENTER_SPEED).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("ends on the slot within six seconds of release", () => {
    for (const col of [0, 4, 8]) {
      for (const row of [0, 4]) {
        for (const fromLeft of [true, false]) {
          const path = entrancePath(slotX(col), slotY(row), fromLeft);
          expect(path.length / ENTER_SPEED).toBeLessThanOrEqual(6);
          const end = path.at(path.length);
          expect(end.x).toBeCloseTo(slotX(col), 3);
          expect(end.y).toBeCloseTo(slotY(row), 3);
        }
      }
    }
  });

  it("keeps the longest entrance of every stage inside its six seconds", () => {
    for (const stage of STANDARD_STAGES) {
      expect(longestEntrance(stage)).toBeLessThanOrEqual(6);
      expect(longestEntrance(stage)).toBeGreaterThan(1);
    }
  });

  it("staggers the groups by ENTER_GROUP_GAP", () => {
    expect(ENTER_GROUP_GAP).toBe(0.6);
    // The last group of the largest wave is still released well inside the
    // stage's own life.
    const state = createState(stubArt());
    state.stage = 20;
    const groups = Math.max(
      ...buildStandardWave(state).map((drone) => drone.entryGroup),
    );
    expect((groups + 1) * ENTER_GROUP_GAP).toBeLessThanOrEqual(
      MAX_ENTRY_GROUPS * ENTER_GROUP_GAP,
    );
  });
});

describe("a dive path", () => {
  it("runs no longer than eight seconds at stage-1 speed", () => {
    for (const y of [140, 240, 332]) {
      for (const shipX of [40, 640, 1240]) {
        expect(
          loopDivePath(500, y, shipX, 500).length / DIVE_SPEED,
        ).toBeLessThanOrEqual(8);
        expect(
          wrapDivePath(500, y, shipX).length / DIVE_SPEED,
        ).toBeLessThanOrEqual(8);
      }
    }
  });

  it("keeps a looping dive out of the bottom HUD strip", () => {
    for (const y of [140, 240, 332]) {
      for (const shipX of [40, 400, 640, 900, 1240]) {
        const path = loopDivePath(500, y, shipX, 500);
        let deepest = 0;
        for (let d = 0; d <= path.length; d += 2) {
          deepest = Math.max(deepest, path.at(d).y);
        }
        expect(deepest).toBeLessThan(FIELD_BOTTOM);
      }
    }
  });

  it("carries a wrapping dive below the field, to be wrapped there", () => {
    for (const shipX of [40, 640, 1240]) {
      const path = wrapDivePath(500, 200, shipX);
      expect(path.at(path.length).y).toBeGreaterThan(FIELD_BOTTOM + 40);
    }
  });

  it("bends toward the ship rather than running a fixed track", () => {
    const left = wrapDivePath(640, 200, 120);
    const right = wrapDivePath(640, 200, 1160);
    const at = (path: typeof left): number => path.at(path.length * 0.6).x;
    expect(at(left)).toBeLessThan(at(right) - 300);
  });

  it("returns a drone to its slot within four seconds", () => {
    for (const from of [
      [200, 620],
      [1100, 600],
      [640, 24],
    ] as const) {
      const path = returnPath(from[0], from[1], slotX(4), slotY(0));
      expect(path.length / DIVE_SPEED).toBeLessThanOrEqual(4);
      const end = path.at(path.length);
      expect(end.x).toBeCloseTo(slotX(4), 3);
      expect(end.y).toBeCloseTo(slotY(0), 3);
    }
  });
});

describe("a challenge stage's flyover", () => {
  it("holds five groups of eight, forty in all", () => {
    const state = createState(stubArt());
    state.stage = 3;
    const drones = buildChallengeWave(state);
    expect(drones.length).toBe(CHALLENGE_TOTAL);
    for (let group = 0; group < CHALLENGE_GROUPS; group += 1) {
      expect(drones.filter((drone) => drone.entryGroup === group).length).toBe(
        CHALLENGE_PER_GROUP,
      );
    }
  });

  it("gives every drone of a group one band, alternating group to group", () => {
    const state = createState(stubArt());
    state.stage = 3;
    const drones = buildChallengeWave(state);
    const bands: string[] = [];
    for (let group = 0; group < CHALLENGE_GROUPS; group += 1) {
      const inGroup = new Set(
        drones
          .filter((drone) => drone.entryGroup === group)
          .map((drone) => drone.band),
      );
      expect(inGroup.size).toBe(1);
      bands.push([...inGroup][0] as string);
    }
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]).not.toBe(bands[i - 1]);
    }
  });

  it("starts every drone off the play field", () => {
    const state = createState(stubArt());
    state.stage = 3;
    for (const drone of buildChallengeWave(state)) {
      expect(drone.x < FIELD_LEFT || drone.x > FIELD_RIGHT).toBe(true);
      expect(drone.phase).toBe("entering");
    }
  });

  it("sweeps across the field and leaves it within eight seconds", () => {
    for (const fromLeft of [true, false]) {
      for (let index = 0; index < CHALLENGE_PER_GROUP; index += 1) {
        const path = challengeSweep(150, index, fromLeft);
        expect(path.length / ENTER_SPEED).toBeLessThanOrEqual(8);
        const end = path.at(path.length);
        expect(end.x < FIELD_LEFT || end.x > FIELD_RIGHT).toBe(true);
        // And it really is inside the field along the way.
        let inside = 0;
        for (let d = 0; d <= path.length; d += 4) {
          const point = path.at(d);
          if (
            point.x > FIELD_LEFT &&
            point.x < FIELD_RIGHT &&
            point.y > FIELD_TOP &&
            point.y < FIELD_BOTTOM
          ) {
            inside += 1;
          }
        }
        expect(inside).toBeGreaterThan(50);
      }
    }
  });
});
