// Orrery — the eleven worked examples of specs/simulation.md "Collision",
// replayed verbatim through the run.
//
// The specification pins the collision rule with a table of eleven
// configurations, each stating the geometry, the first sample within the
// threshold, the nearest sampled approach, and the verdict. This file poses
// each one as a machine on the field, runs the cycle it describes, and asserts
// all three: the sample fractions the rule visits, the distances it measures
// there, and where the run ends up.
//
// The distances are read off the CYCLE'S OWN PLAN rather than recomputed from
// the geometry, so a sample here is the same point the collision rule tested
// and the same point a frame would draw the mote at. A cycle is begun with a
// frame too small to reach any sample, its eight samples are read, and
// `stepOneCycle` then carries it exactly to its boundary or to the fault it
// names — the `step` action of specs/editor.md, which is the one path that
// runs a whole cycle and stops.

import { describe, expect, it } from "vitest";

import { separation } from "./collision";
import { COLLISION_SAMPLES, MOTE_COLLIDE_R } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { Game } from "./game";
import { hexCenter } from "./hex";
import { gripperHex } from "./parts";
import { stepOneCycle } from "./sim";
import type { Fault, Hex, SimState, SimStatus } from "./types";

/** The threshold the specification's table is written against: `38`. */
const THRESHOLD = 2 * MOTE_COLLIDE_R;

/** A first frame small enough to begin the cycle without reaching a sample. */
const PROBE = 1e-9;

/** A game holding Extras 1, with the surface over it and no run started. */
function bench(): { game: Game; api: OrreryStateOps } {
  const game = new Game();
  const api = createStateOps(game);
  api.openChallenge("extras", 0);
  return { game, api };
}

/** The live run, or the failure that there is none. */
function runOf(game: Game): SimState {
  const sim = game.state.sim;
  if (sim === null) throw new Error("no run is live");
  return sim;
}

/** The id of the part placed last. */
function lastPart(game: Game): number {
  const parts = game.state.editor.parts;
  return parts[parts.length - 1].id;
}

/** Spawn one `dust` mote on a hex and report its id. */
function spawn(game: Game, api: OrreryStateOps, q: number, r: number): number {
  api.spawnMote(q, r, "dust");
  const { motes } = runOf(game);
  return motes[motes.length - 1].id;
}

/** A distance as the specification's table writes one: two decimal places. */
function to2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * The nearest pair distance at each of the eight sample fractions, in order,
 * taken from the running cycle's plan.
 */
function sampleDistances(game: Game): number[] {
  const sim = runOf(game);
  const plan = sim.pending;
  if (plan === null) throw new Error("no cycle is pending");
  const distances: number[] = [];
  for (let k = 1; k <= COLLISION_SAMPLES; k += 1) {
    const points = sim.motes.map(
      (mote) =>
        plan.position(mote.id, k / COLLISION_SAMPLES) ?? hexCenter(mote),
    );
    let nearest = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        nearest = Math.min(nearest, separation(points[i], points[j]));
      }
    }
    distances.push(nearest);
  }
  return distances;
}

/** One sample of the table: which one it is, and how close the field came. */
interface Approach {
  /** The sample's index `k`, whose fraction is `k / 8`. */
  readonly k: number;
  /** The nearest pair distance there, to two decimal places. */
  readonly distance: number;
}

/** What one replayed example reports, in the terms the table uses. */
interface Verdict {
  /** The nearest pair distance at each sample, to two decimal places. */
  readonly distances: number[];
  /** The first sample within the threshold, or `null` when the sweep is clear. */
  readonly first: Approach | null;
  /** The nearest sampled approach, and the first sample that reaches it. */
  readonly nearest: Approach;
  /** The run's status once the cycle has been carried as far as it goes. */
  readonly status: SimStatus;
  /** The fraction the run stands at. */
  readonly fraction: number;
  /** The cycle count the run stands at. */
  readonly cycle: number;
  /** The fault the run raised, or `null`. */
  readonly fault: Fault | null;
}

/** Run the posed cycle, reading its samples and then its outcome. */
function replay(game: Game, api: OrreryStateOps): Verdict {
  api.setSpeed(0);
  game.update(PROBE);
  const distances = sampleDistances(game).map(to2);
  stepOneCycle(game);
  const sim = runOf(game);
  const under = distances.findIndex((distance) => distance < THRESHOLD);
  const closest = Math.min(...distances);
  return {
    distances,
    first: under < 0 ? null : { k: under + 1, distance: distances[under] },
    nearest: {
      k: distances.indexOf(closest) + 1,
      distance: closest,
    },
    status: sim.status,
    fraction: sim.fraction,
    cycle: sim.cycle,
    fault: sim.fault,
  };
}

/** Assert one row of the table: its two sampled figures and its verdict. */
function expectRow(
  verdict: Verdict,
  row: {
    readonly first: Approach | null;
    readonly nearest: Approach;
    readonly faults: boolean;
    readonly motes?: number[];
  },
): void {
  expect(verdict.first).toEqual(row.first);
  expect(verdict.nearest).toEqual(row.nearest);
  if (!row.faults) {
    // A clear cycle lands and the boundary that closes it leaves the run at
    // the next cycle, paused, with the fraction back at `0`.
    expect(verdict.status).toBe("paused");
    expect(verdict.fault).toBeNull();
    expect(verdict.fraction).toBe(0);
    expect(verdict.cycle).toBe(1);
    return;
  }
  // A faulting run freezes at the first sample within the threshold.
  expect(verdict.status).toBe("faulted");
  expect(verdict.fraction).toBe((row.first?.k ?? 0) / COLLISION_SAMPLES);
  expect(verdict.cycle).toBe(0);
  expect(verdict.fault?.kind).toBe("collision");
  expect(verdict.fault?.parts).toEqual([]);
  if (row.motes !== undefined) expect(verdict.fault?.motes).toEqual(row.motes);
}

/**
 * An arm at `(0, 0)` facing east, carrying one mote on its one gripper with
 * `instruction` on cell `0` of its tape, and one mote resting where the
 * example puts it.
 */
function carryAndRest(
  kind: "arm" | "piston",
  length: number,
  instruction: "rotate-cw" | "extend",
  rest: Hex,
): { game: Game; api: OrreryStateOps; carried: number; resting: number } {
  const { game, api } = bench();
  api.placePart(kind, 0, 0, 0);
  const arm = lastPart(game);
  api.setPartLength(arm, length);
  api.setTapeCell(arm, 0, instruction);
  api.startRun();
  const held = gripperHex({ q: 0, r: 0 }, 0, length);
  const carried = spawn(game, api, held.q, held.r);
  api.setGrip(arm, 0, carried);
  const resting = spawn(game, api, rest.q, rest.r);
  return { game, api, carried, resting };
}

describe("the worked examples of specs/simulation.md", () => {
  it("A: a length 1 sweep past a mote on (1, 1) faults at 3/8", () => {
    const { game, api, carried, resting } = carryAndRest(
      "arm",
      1,
      "rotate-cw",
      { q: 1, r: 1 },
    );
    expectRow(replay(game, api), {
      first: { k: 3, distance: 36.1 },
      nearest: { k: 4, distance: 35.14 },
      faults: true,
      motes: [carried, resting].sort((a, b) => a - b),
    });
  });

  it("B: the same sweep past a mote on (1, -1) is clear", () => {
    const { game, api } = carryAndRest("arm", 1, "rotate-cw", {
      q: 1,
      r: -1,
    });
    expectRow(replay(game, api), {
      first: null,
      nearest: { k: 1, distance: 53.33 },
      faults: false,
    });
  });

  it("C: a length 2 sweep past a mote on (1, 0) is clear", () => {
    const { game, api } = carryAndRest("arm", 2, "rotate-cw", {
      q: 1,
      r: 0,
    });
    expectRow(replay(game, api), {
      first: null,
      nearest: { k: 1, distance: 48.81 },
      faults: false,
    });
  });

  it("D: the same sweep past a mote on (1, 1) faults at 1/8", () => {
    const { game, api, carried, resting } = carryAndRest(
      "arm",
      2,
      "rotate-cw",
      { q: 1, r: 1 },
    );
    expectRow(replay(game, api), {
      first: { k: 1, distance: 37.16 },
      nearest: { k: 4, distance: 12.86 },
      faults: true,
      motes: [carried, resting].sort((a, b) => a - b),
    });
  });

  it("E: a piston extending past a mote on (2, -1) is clear", () => {
    const { game, api } = carryAndRest("piston", 1, "extend", {
      q: 2,
      r: -1,
    });
    expectRow(replay(game, api), {
      first: null,
      nearest: { k: 4, distance: 41.57 },
      faults: false,
    });
  });

  it("E2: the same slide past a mote on (1, 1) is clear", () => {
    const { game, api } = carryAndRest("piston", 1, "extend", {
      q: 1,
      r: 1,
    });
    expectRow(replay(game, api), {
      first: null,
      nearest: { k: 4, distance: 41.57 },
      faults: false,
    });
  });

  it("F: the same slide past a mote on (3, -1) is clear", () => {
    const { game, api } = carryAndRest("piston", 1, "extend", {
      q: 3,
      r: -1,
    });
    const verdict = replay(game, api);
    expectRow(verdict, {
      first: null,
      nearest: { k: 8, distance: 48 },
      faults: false,
    });
    // The slide closes on the resting mote throughout, so the nearest approach
    // is the last sample rather than one in the middle.
    expect(verdict.distances[0]).toBe(78);
  });

  it("G: two arms swapping two motes fault at 1/8", () => {
    const { game, api } = bench();
    api.placePart("arm", 0, 0, 0);
    const first = lastPart(game);
    api.setTapeCell(first, 0, "rotate-cw");
    api.placePart("arm", 1, 1, 3);
    const second = lastPart(game);
    api.setTapeCell(second, 0, "rotate-cw");
    api.startRun();
    const east = spawn(game, api, 1, 0);
    const south = spawn(game, api, 0, 1);
    api.setGrip(first, 0, east);
    api.setGrip(second, 3, south);
    expectRow(replay(game, api), {
      first: { k: 1, distance: 37.16 },
      nearest: { k: 4, distance: 12.86 },
      faults: true,
      motes: [east, south].sort((a, b) => a - b),
    });
  });

  it("H: two resting motes on adjacent hexes are clear at every sample", () => {
    const { game, api } = bench();
    api.startRun();
    spawn(game, api, 0, 0);
    spawn(game, api, 1, 0);
    const verdict = replay(game, api);
    expectRow(verdict, {
      first: null,
      nearest: { k: 1, distance: 48 },
      faults: false,
    });
    expect(verdict.distances).toEqual([48, 48, 48, 48, 48, 48, 48, 48]);
  });

  it("I: a track arm advancing past a mote on (1, -1) is clear", () => {
    const { game, api } = bench();
    api.placeTrack(-1, 0);
    const track = lastPart(game);
    api.extendTrack(track, 0, 0);
    api.placePart("arm", -1, 0, 0);
    const arm = lastPart(game);
    api.setTapeCell(arm, 0, "advance");
    api.startRun();
    const carried = spawn(game, api, 0, 0);
    api.setGrip(arm, 0, carried);
    spawn(game, api, 1, -1);
    expectRow(replay(game, api), {
      first: null,
      nearest: { k: 4, distance: 41.57 },
      faults: false,
    });
  });

  it("J: two arms on one track advancing together are clear", () => {
    const { game, api } = bench();
    api.placeTrack(-1, 0);
    const track = lastPart(game);
    api.extendTrack(track, 0, 0);
    api.extendTrack(track, 1, 0);
    api.placePart("arm", -1, 0, 0);
    const trailing = lastPart(game);
    api.setTapeCell(trailing, 0, "advance");
    api.placePart("arm", 0, 0, 0);
    const leading = lastPart(game);
    api.setTapeCell(leading, 0, "advance");
    api.startRun();
    const behind = spawn(game, api, 0, 0);
    const ahead = spawn(game, api, 1, 0);
    api.setGrip(trailing, 0, behind);
    api.setGrip(leading, 0, ahead);
    const verdict = replay(game, api);
    expectRow(verdict, {
      first: null,
      nearest: { k: 1, distance: 48 },
      faults: false,
    });
    expect(verdict.distances).toEqual([48, 48, 48, 48, 48, 48, 48, 48]);
  });

  it("K: two arms closing on one hex fault at 5/8, meeting at 8/8", () => {
    const { game, api } = bench();
    api.placeTrack(-1, 0);
    const track = lastPart(game);
    for (const q of [0, 1, 2, 3]) api.extendTrack(track, q, 0);
    api.placePart("arm", -1, 0, 0);
    const west = lastPart(game);
    api.setTapeCell(west, 0, "advance");
    api.placePart("arm", 3, 0, 3);
    const east = lastPart(game);
    api.setTapeCell(east, 0, "recede");
    api.startRun();
    const carriedWest = spawn(game, api, 0, 0);
    const carriedEast = spawn(game, api, 2, 0);
    api.setGrip(west, 0, carriedWest);
    api.setGrip(east, 3, carriedEast);
    const verdict = replay(game, api);
    expectRow(verdict, {
      first: { k: 5, distance: 36 },
      nearest: { k: 8, distance: 0 },
      faults: true,
      motes: [carriedWest, carriedEast].sort((a, b) => a - b),
    });
    // A move ending on a hex another mote rests on is a collision at `0`, but
    // the run froze three samples earlier.
    expect(verdict.distances[COLLISION_SAMPLES - 1]).toBe(0);
    expect(verdict.fraction).toBe(5 / COLLISION_SAMPLES);
  });
});
