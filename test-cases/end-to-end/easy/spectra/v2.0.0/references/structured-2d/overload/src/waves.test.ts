import { describe, expect, it } from "vitest";
import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  DIVE_FIRST_DELAY,
  ENTER_GROUP_GAP,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FORM_CENTER_X,
  isChallengeStage,
} from "./constants";
import { fluxWindowAt } from "./bands";
import { buildWave, composition, fluxCount, prismCount } from "./waves";
import { liveState, run, STEP } from "./fixtures";

/** How many freshly drawn waves a rule about the draw is checked over. */
const DRAWS = 5;

function stageWave(stage: number) {
  const state = liveState();
  state.stage = stage;
  buildWave(state);
  return state;
}

describe("a standard wave", () => {
  it("holds every drone of the wave from the moment it is built, all above the field", () => {
    const state = stageWave(1);
    expect(state.drones.length).toBeGreaterThan(10);
    expect(state.drones.every((drone) => drone.phase === "entering")).toBe(
      true,
    );
    expect(state.drones.every((drone) => drone.y < FIELD_TOP)).toBe(true);
  });

  it("fills a mirror-symmetric layout about the formation's centre", () => {
    for (const stage of [1, 2, 4, 7, 11]) {
      const state = stageWave(stage);
      const slots = state.drones.map((drone) => drone.slotX);
      for (const x of slots) {
        const mirror = 2 * FORM_CENTER_X - x;
        expect(slots.some((other) => Math.abs(other - mirror) < 1)).toBe(true);
      }
    }
  });

  it("is Shards of both bands with at least two Fluxes and a Prism", () => {
    for (const stage of [1, 2, 4, 7, 11]) {
      const state = stageWave(stage);
      const kinds = state.drones.map((drone) => drone.kind);
      expect(
        kinds.filter((kind) => kind === "flux").length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        kinds.filter((kind) => kind === "prism").length,
      ).toBeGreaterThanOrEqual(1);
      const shards = state.drones.filter((drone) => drone.kind === "shard");
      expect(shards.length).toBeGreaterThan(kinds.length / 2);
      expect(shards.some((drone) => drone.band === "cyan")).toBe(true);
      expect(shards.some((drone) => drone.band === "magenta")).toBe(true);
    }
  });

  it("holds both bands in the formation at every stage", () => {
    for (const stage of [1, 2, 4, 5, 7, 8, 10, 11]) {
      const state = stageWave(stage);
      const bands = new Set(state.drones.map((drone) => drone.band));
      expect(bands.has("cyan")).toBe(true);
      expect(bands.has("magenta")).toBe(true);
    }
  });

  it("gives the anchor Prism two Shards of opposite bands in its own group", () => {
    for (const stage of [1, 4, 7]) {
      const state = stageWave(stage);
      const prism = state.drones.find((drone) => drone.kind === "prism");
      expect(prism).toBeDefined();
      const escorts = state.drones.filter(
        (drone) =>
          drone.kind === "shard" &&
          drone.entryGroup === prism?.entryGroup &&
          Math.abs(drone.slotX - (prism?.slotX ?? 0)) <= 64.5,
      );
      expect(escorts.length).toBe(2);
      expect(new Set(escorts.map((drone) => drone.band)).size).toBe(2);
    }
  });

  it("releases its drones in between two and eight groups", () => {
    for (const stage of [1, 4, 7, 13]) {
      const state = stageWave(stage);
      const groups = new Set(state.drones.map((drone) => drone.entryGroup));
      expect(groups.size).toBeGreaterThanOrEqual(2);
      expect(groups.size).toBeLessThanOrEqual(8);
    }
  });

  it("leans further on Fluxes and Prisms at a later stage", () => {
    expect(fluxCount(10)).toBeGreaterThan(fluxCount(1));
    expect(prismCount(10)).toBeGreaterThan(prismCount(1));
    expect(stageWave(13).drones.length).toBeGreaterThan(
      stageWave(1).drones.length,
    );
  });

  it("returns the wave's own clocks to their fresh values", () => {
    const state = stageWave(1);
    expect(state.entryClock).toBe(0);
    expect(state.swayClock).toBe(0);
    expect(state.diveClock).toBe(0);
    expect(state.diveTarget).toBe(DIVE_FIRST_DELAY);
  });

  it("holds both bands and mirrors its block however the draw falls", () => {
    for (let draw = 0; draw < DRAWS; draw += 1) {
      const drones = stageWave(4).drones;
      expect(drones.some((drone) => drone.band === "cyan")).toBe(true);
      expect(drones.some((drone) => drone.band === "magenta")).toBe(true);
      for (const drone of drones) {
        const mirror = 2 * FORM_CENTER_X - drone.slotX;
        expect(
          drones.some(
            (other) => other.slotY === drone.slotY && other.slotX === mirror,
          ),
        ).toBe(true);
      }
    }
  });

  it("starts each Flux somewhere inside its own band window", () => {
    const clocks = new Set<number>();
    for (let draw = 0; draw < DRAWS; draw += 1) {
      for (const drone of stageWave(7).drones) {
        if (drone.kind === "flux") {
          expect(drone.bandClock).toBeGreaterThanOrEqual(0);
          expect(drone.bandClock).toBeLessThan(fluxWindowAt(7));
          clocks.add(drone.bandClock);
        }
      }
    }
    expect(clocks.size).toBeGreaterThan(3);
  });

  it("names one entry group per formation row, filled left to right", () => {
    const state = stageWave(1);
    for (const drone of state.drones) {
      const row = state.drones.filter(
        (other) => other.entryGroup === drone.entryGroup,
      );
      expect(row.every((other) => other.slotY === drone.slotY)).toBe(true);
    }
  });

  it("draws a composition that fills every slot of the block it lays out", () => {
    const state = liveState();
    state.stage = 5;
    const entries = composition(state);
    const slots = new Set(
      entries.map((entry) => `${entry.slot.col},${entry.slot.row}`),
    );
    expect(slots.size).toBe(entries.length);
  });
});

describe("a challenge stage", () => {
  it("is every third stage", () => {
    for (let stage = 1; stage <= 12; stage += 1) {
      expect(isChallengeStage(stage)).toBe(stage % 3 === 0);
    }
  });

  it("holds its groups of single-band drones, alternating band by group", () => {
    const state = stageWave(3);
    expect(state.drones.length).toBe(CHALLENGE_TOTAL);
    for (let group = 0; group < CHALLENGE_GROUPS; group += 1) {
      const members = state.drones.filter(
        (drone) => drone.entryGroup === group,
      );
      expect(members.length).toBe(CHALLENGE_PER_GROUP);
      expect(new Set(members.map((drone) => drone.band)).size).toBe(1);
      expect(members[0].band).toBe(group % 2 === 0 ? "cyan" : "magenta");
    }
  });

  it("starts each group outside the field on x and inside it on y", () => {
    const state = stageWave(3);
    for (const drone of state.drones) {
      expect(drone.x < 0 || drone.x > 1280).toBe(true);
      expect(drone.y).toBeGreaterThan(FIELD_TOP);
      expect(drone.y).toBeLessThan(FIELD_BOTTOM);
      expect(drone.slotX).toBe(drone.x);
      expect(drone.slotY).toBe(drone.y);
    }
  });

  it("returns the hit count to zero as it is built", () => {
    const state = liveState();
    state.stage = 3;
    state.challengeHits = 12;
    buildWave(state);
    expect(state.challengeHits).toBe(0);
  });
});

describe("a challenge flyover in play", () => {
  it("arrives as five single-band groups that alternate, and leaves", () => {
    const state = liveState();
    state.stage = 3;
    state.waveEntry = true;
    buildWave(state);

    const inside = (drone: (typeof state.drones)[number]): boolean =>
      drone.x > FIELD_LEFT &&
      drone.x < FIELD_RIGHT &&
      drone.y > FIELD_TOP &&
      drone.y < FIELD_BOTTOM;

    const arrivals: { at: number; band: string }[] = [];
    const seen = new Set<number>();
    for (let frame = 0; frame < 60 * 16; frame += 1) {
      run(state, STEP);
      for (const drone of state.drones) {
        if (inside(drone) && !seen.has(drone.id)) {
          seen.add(drone.id);
          arrivals.push({ at: state.simTime, band: drone.band });
        }
      }
      if (state.drones.length === 0 && arrivals.length > 0) break;
    }

    expect(arrivals.length).toBe(CHALLENGE_TOTAL);
    // Merge arrivals into runs of one band, as a player sees them.
    const merged: { band: string; count: number }[] = [];
    for (const arrival of arrivals) {
      const last = merged[merged.length - 1];
      if (last !== undefined && last.band === arrival.band) last.count += 1;
      else merged.push({ band: arrival.band, count: 1 });
    }
    expect(merged.length).toBe(CHALLENGE_GROUPS);
    expect(merged.every((group) => group.count === CHALLENGE_PER_GROUP)).toBe(
      true,
    );
    for (let index = 1; index < merged.length; index += 1) {
      expect(merged[index].band).not.toBe(merged[index - 1].band);
    }
    // Every one of them sweeps across and leaves rather than settling.
    expect(state.drones).toHaveLength(0);
    expect(state.simTime).toBeLessThan(
      ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1) + 8,
    );
  });

  it("fires nothing anywhere across a whole challenge stage", () => {
    const state = liveState();
    state.stage = 3;
    state.waveEntry = true;
    state.diveLaunching = true;
    buildWave(state);
    for (let frame = 0; frame < 60 * 16; frame += 1) {
      run(state, STEP);
      expect(state.bullets).toHaveLength(0);
      if (state.drones.length === 0) break;
    }
  });

  it("runs at the same speeds whatever stage it falls on", () => {
    const covered = (stage: number): number => {
      const state = liveState();
      state.stage = stage;
      state.waveEntry = true;
      buildWave(state);
      const drone = state.drones[0];
      run(state, 0.2);
      const from = drone.x;
      run(state, 1);
      return Math.abs(drone.x - from);
    };
    expect(covered(9)).toBeCloseTo(covered(3), 6);
  });
});
