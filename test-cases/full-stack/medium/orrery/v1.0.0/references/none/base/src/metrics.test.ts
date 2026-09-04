// Orrery — the three metrics a completed run records (specs/simulation.md
// "Completion and metrics").
//
// `cost` is the machine's, as specs/parts.md computes it; `cycles` is
// `sim.cycle + 1` at the completing boundary; and `area` is the size of the
// area bank, which opens holding every hex of every placed part, every fixture
// hex and every gripper hex at rest, and then takes the hex of every mote and
// of every gripper after every boundary, the settle included, BEFORE that
// boundary's completion check reads it.
//
// A completion is posed by setting the one set's tally to the target and
// stepping one cycle, so the run completes at a boundary the case chose rather
// than after however many cycles a working machine would have taken.

import { describe, expect, it } from "vitest";

import { CONSTELLATION_TARGET } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { Game } from "./game";
import { hexOnField, sameHex } from "./hex";
import { stepOneCycle } from "./sim";
import type { Hex, Metrics, SimState } from "./types";

/** One `dust` in, one `dust` out: the smallest challenge a run can complete. */
const ONE_DUST = {
  name: "One Dust",
  reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
  products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
  permitted: ["arm", "bind", "track"],
  target: CONSTELLATION_TARGET,
};

/** A game holding `ONE_DUST` on an empty machine, with no run started. */
function bench(): { game: Game; api: OrreryStateOps } {
  const game = new Game();
  const api = createStateOps(game);
  api.loadChallenge(ONE_DUST);
  api.clearMachine();
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
  const { parts } = game.state.editor;
  return parts[parts.length - 1].id;
}

/** The metrics a completed run recorded, or the failure that it did not. */
function metricsOf(game: Game): Metrics {
  const sim = runOf(game);
  if (sim.status !== "complete" || sim.metrics === null) {
    throw new Error(`the run is ${sim.status}, not complete`);
  }
  return sim.metrics;
}

/** Whether the area bank holds a hex. */
function banked(game: Game, cell: Hex): boolean {
  return runOf(game).areaHexes.some((hex) => sameHex(hex, cell));
}

/** Satisfy the one set's target, then run the cycle that completes the run. */
function completeNow(game: Game, api: OrreryStateOps): void {
  api.setTally(0, CONSTELLATION_TARGET);
  stepOneCycle(game);
}

describe("cost (specs/simulation.md)", () => {
  it("records the sum of PART_COSTS over the machine, a track by the cell", () => {
    const { game, api } = bench();
    api.placePart("arm", 0, -2, 0);
    api.placePart("bind", 0, 0, 0);
    api.placeTrack(0, 2);
    const track = lastPart(game);
    api.extendTrack(track, 1, 2);
    api.extendTrack(track, 2, 2);
    api.placeSet(0, 4, 0, 0);
    api.startRun();
    completeNow(game, api);
    // 20 for the arm, 10 for the bind, 5 per cell of a three-cell track.
    expect(metricsOf(game).cost).toBe(45);
  });
});

describe("cycles (specs/simulation.md)", () => {
  it("records 1 for a run completing at the boundary of cycle 0", () => {
    const { game, api } = bench();
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    completeNow(game, api);
    expect(runOf(game).cycle).toBe(0);
    expect(metricsOf(game).cycles).toBe(1);
  });

  it("records 12 for a run completing at the boundary of cycle 11", () => {
    const { game, api } = bench();
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    api.setCycle(11);
    completeNow(game, api);
    expect(runOf(game).cycle).toBe(11);
    expect(runOf(game).fraction).toBe(0);
    expect(metricsOf(game).cycles).toBe(12);
  });
});

describe("the area bank (specs/simulation.md)", () => {
  it("opens holding every part hex and every fixture hex", () => {
    const { game, api } = bench();
    api.placePart("wheel", 0, 0, 0);
    api.startRun();
    // The hub, and the six spoke hexes its fixtures rest on.
    expect(runOf(game).areaHexes).toHaveLength(7);
    expect(banked(game, { q: 0, r: 0 })).toBe(true);
    expect(banked(game, { q: 1, r: -1 })).toBe(true);
  });

  it("opens holding every gripper hex at rest, on the field or off it", () => {
    const { game, api } = bench();
    api.placePart("arm", 4, 0, 0);
    api.setPartLength(lastPart(game), 3);
    api.startRun();
    expect(runOf(game).areaHexes).toHaveLength(2);
    expect(banked(game, { q: 4, r: 0 })).toBe(true);
    // Three hexes east of (4, 0) is off the field, and banked like any other.
    expect(hexOnField({ q: 7, r: 0 })).toBe(false);
    expect(banked(game, { q: 7, r: 0 })).toBe(true);
  });

  it("takes every mote's hex and every gripper's hex at every boundary", () => {
    const { game, api } = bench();
    api.placePart("arm", 0, 0, 0);
    const arm = lastPart(game);
    api.setTapeCell(arm, 0, "rotate-cw");
    api.setCompletion(false);
    api.startRun();
    // The anchor and the resting gripper's hex.
    expect(runOf(game).areaHexes).toHaveLength(2);
    // A mote resting off the field is banked at the next boundary.
    api.spawnMote(5, 5, "dust");
    expect(hexOnField({ q: 5, r: 5 })).toBe(false);
    stepOneCycle(game);
    expect(banked(game, { q: 5, r: 5 })).toBe(true);
    expect(banked(game, { q: 0, r: 1 })).toBe(true);
    expect(runOf(game).areaHexes).toHaveLength(4);
    // Six turns bring the gripper back round, and each hex counts once.
    for (let turn = 0; turn < 6; turn += 1) stepOneCycle(game);
    expect(runOf(game).areaHexes).toHaveLength(8);
  });

  it("is read at the completing boundary before the completion check", () => {
    const { game, api } = bench();
    api.placePart("arm", 0, 0, 0);
    api.setTapeCell(lastPart(game), 0, "rotate-cw");
    api.placeSet(0, 3, 0, 0);
    api.startRun();
    // The anchor, the resting gripper's hex, and the set's one footprint hex.
    expect(runOf(game).areaHexes).toHaveLength(3);
    completeNow(game, api);
    // The completing boundary banked the hex the gripper turned onto first.
    expect(banked(game, { q: 0, r: 1 })).toBe(true);
    expect(metricsOf(game).area).toBe(4);
  });
});
