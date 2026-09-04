// Orrery — the five steps of a cycle, in the order specs/simulation.md states
// them, and the collision rule as the run applies it.
//
// The order is the thing under test here: fetch halts before the grippers,
// drops open before grabs close, a grab taken this cycle rides this cycle's
// motion, the motion lands before the boundary reads the field, and the torn
// check precedes the collision samples. Each is posed as a machine and run
// with the `step` action, so the assertions are on what a whole cycle left.

import { describe, expect, it } from "vitest";

import { COLLISION_SAMPLES } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { Game } from "./game";
import { hexCenter, hexOnField, sameHex } from "./hex";
import { stepOneCycle } from "./sim";
import type { Hex, SimState, TapeCell } from "./types";

/** A game holding Extras 1, with the surface over it. */
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

/** Place one part with the tape given, and report its id. */
function withTape(
  game: Game,
  api: OrreryStateOps,
  kind: Parameters<OrreryStateOps["placePart"]>[0],
  q: number,
  r: number,
  rotation: number,
  tape: TapeCell[],
  length = 1,
): number {
  api.placePart(kind, q, r, rotation);
  const parts = game.state.editor.parts;
  const id = parts[parts.length - 1].id;
  // A wheel carries no length to set, so only a chosen one is written.
  if (length !== 1) api.setPartLength(id, length);
  for (const [col, cell] of tape.entries()) api.setTapeCell(id, col, cell);
  return id;
}

/** Spawn one `dust` mote and report its id. */
function spawn(game: Game, api: OrreryStateOps, q: number, r: number): number {
  api.spawnMote(q, r, "dust");
  const { motes } = runOf(game);
  return motes[motes.length - 1].id;
}

/** Where a mote rests now. */
function restingAt(game: Game, mote: number): Hex {
  const found = runOf(game).motes.find((entry) => entry.id === mote);
  if (found === undefined) throw new Error(`no mote ${mote}`);
  return { q: found.q, r: found.r };
}

/** Carry the run through `count` whole cycles. */
function step(game: Game, count = 1): void {
  for (let i = 0; i < count; i += 1) stepOneCycle(game);
}

describe("the five steps in order (specs/simulation.md)", () => {
  it("runs the motion before the boundary reads the field", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 0, 0, 0, ["grab", "rotate-cw"]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    step(game, 2);
    // The boundary of the carrying cycle banks the hex the motion landed on.
    expect(restingAt(game, mote)).toEqual({ q: 0, r: 1 });
    expect(
      runOf(game).areaHexes.some((cell) => sameHex(cell, { q: 0, r: 1 })),
    ).toBe(true);
  });

  it("lets a grab taken this cycle ride this cycle's motion", () => {
    // The rotating arm holds the mote already; the second arm's `grab` closes
    // on it this cycle, so the agreement check of this cycle sees two holders.
    const { game, api } = bench();
    const turning = withTape(game, api, "arm", 0, 0, 0, ["rotate-cw"]);
    const closing = withTape(game, api, "arm", 2, 0, 3, ["grab"]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    api.setGrip(turning, 0, mote);
    step(game);
    expect(runOf(game).fault).toEqual({
      kind: "torn",
      parts: [turning, closing],
      motes: [mote],
    });
  });

  it("lands every carried mote exactly on a hex center", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 0, 0, 0, ["grab", "rotate-cw"]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    step(game, 2);
    const reported = runOf(game).motes.find((entry) => entry.id === mote);
    const center = hexCenter({ q: 0, r: 1 });
    const snapshot = api.snapshot() as {
      sim: { motes: { id: number; x: number; y: number }[] };
    };
    const drawn = snapshot.sim.motes.find((entry) => entry.id === mote);
    expect(reported?.q).toBe(0);
    expect(reported?.r).toBe(1);
    expect(drawn?.x).toBeCloseTo(center.x, 9);
    expect(drawn?.y).toBeCloseTo(center.y, 9);
  });
});

describe("the collision rule through a run (specs/simulation.md)", () => {
  it("checks a wheel's fixtures like any other mote", () => {
    const { game, api } = bench();
    withTape(game, api, "wheel", 0, 0, 0, []);
    const piston = withTape(game, api, "piston", 3, 0, 3, ["grab", "extend"]);
    api.startRun();
    // The wheel's spoke-0 fixture rests on `(1, 0)`, where the slide ends.
    const fixture = runOf(game).motes.find(
      (mote) => mote.q === 1 && mote.r === 0,
    );
    const carried = spawn(game, api, 2, 0);
    step(game);
    expect(runOf(game).grips).toEqual([
      { part: piston, spoke: 3, mote: carried },
    ]);
    step(game);
    const sim = runOf(game);
    expect(sim.status).toBe("faulted");
    expect(sim.fault?.kind).toBe("collision");
    expect(sim.fault?.motes).toEqual(
      [carried, fixture?.id ?? 0].sort((a, b) => a - b),
    );
    // Closing from 48 apart, the first sample within `38` is `36.00` at 2/8.
    expect(sim.fraction).toBe(2 / COLLISION_SAMPLES);
  });

  it("names every pair within the threshold at that sample", () => {
    const { game, api } = bench();
    // Two copies of example D, far enough apart to be independent.
    withTape(game, api, "arm", 0, 0, 0, ["rotate-cw"], 2);
    withTape(game, api, "arm", 0, 3, 0, ["rotate-cw"], 2);
    api.startRun();
    const near = [spawn(game, api, 2, 0), spawn(game, api, 1, 1)];
    const far = [spawn(game, api, 2, 3), spawn(game, api, 1, 4)];
    api.setGrip(game.state.editor.parts[0].id, 0, near[0]);
    api.setGrip(game.state.editor.parts[1].id, 0, far[0]);
    step(game);
    const sim = runOf(game);
    expect(sim.fraction).toBe(1 / COLLISION_SAMPLES);
    expect(sim.fault?.motes).toEqual([...near, ...far].sort((a, b) => a - b));
    // No part is at fault, whichever arms were carrying what met.
    expect(sim.fault?.parts).toEqual([]);
  });

  it("lets an empty gripper come to rest on a hex a mote rests on", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 0, 0, 0, ["rotate-cw"]);
    api.startRun();
    const resting = spawn(game, api, 0, 1);
    step(game);
    expect(runOf(game).status).toBe("paused");
    expect(runOf(game).fault).toBeNull();
    expect(restingAt(game, resting)).toEqual({ q: 0, r: 1 });
  });

  it("reports torn rather than collision when a cycle is both", () => {
    const { game, api } = bench();
    const turning = withTape(game, api, "arm", 0, 0, 0, ["rotate-cw"]);
    const holding = withTape(game, api, "arm", 2, 0, 3, []);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    // Example A's resting mote: the sweep would be within `38` at 3/8.
    spawn(game, api, 1, 1);
    api.setGrip(turning, 0, mote);
    api.setGrip(holding, 3, mote);
    step(game);
    const sim = runOf(game);
    expect(sim.fault?.kind).toBe("torn");
    expect(sim.fraction).toBe(0);
    expect(restingAt(game, mote)).toEqual({ q: 1, r: 0 });
  });

  it("freezes the run where it stood, whatever time passes afterwards", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 0, 0, 0, ["rotate-cw"], 2);
    api.startRun();
    const carried = spawn(game, api, 2, 0);
    spawn(game, api, 1, 1);
    api.setGrip(game.state.editor.parts[0].id, 0, carried);
    step(game);
    const sim = runOf(game);
    const frozen = {
      cycle: sim.cycle,
      fraction: sim.fraction,
      motes: sim.motes.map((mote) => ({ q: mote.q, r: mote.r })),
      grips: [...sim.grips],
    };
    api.setSpeed(3);
    game.update(10);
    expect(sim.status).toBe("faulted");
    expect(sim.cycle).toBe(frozen.cycle);
    expect(sim.fraction).toBe(frozen.fraction);
    expect(sim.motes.map((mote) => ({ q: mote.q, r: mote.r }))).toEqual(
      frozen.motes,
    );
    expect(sim.grips).toEqual(frozen.grips);
  });
});

describe("hexes off the field (specs/simulation.md)", () => {
  it("carries a mote onto a hex off the field and rests it there", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 5, 0, 4, ["grab", "rotate-cw"]);
    api.startRun();
    const mote = spawn(game, api, 5, -1);
    step(game, 2);
    expect(restingAt(game, mote)).toEqual({ q: 6, r: -1 });
    expect(hexOnField({ q: 6, r: -1 })).toBe(false);
    // And it stays there over the cycles that follow.
    step(game, 2);
    expect(hexOnField(restingAt(game, mote))).toBe(false);
  });

  it("collides off the field exactly as on it", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 5, 0, 4, ["grab", "rotate-cw"]);
    api.startRun();
    const carried = spawn(game, api, 5, -1);
    const waiting = spawn(game, api, 6, -1);
    step(game, 2);
    const sim = runOf(game);
    expect(sim.status).toBe("faulted");
    expect(sim.fault?.kind).toBe("collision");
    expect(sim.fault?.motes).toEqual([carried, waiting].sort((a, b) => a - b));
  });
});
