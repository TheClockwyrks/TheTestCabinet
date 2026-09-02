// Orrery — the drop and grab steps, grip persistence, and the agreement rule
// (specs/simulation.md, steps 2 and 3 of the cycle, and "Held more than once").
//
// Every scenario below is posed as a machine and run through whole cycles with
// the `step` action, so what is asserted is what the run leaves behind: which
// grippers hold what, which hexes the motes land on, and the tear a
// disagreement raises.

import { describe, expect, it } from "vitest";

import { createDebugApi, type OrreryDebugApi } from "./debug";
import { Bench } from "./harness";
import { stepOneCycle } from "./sim";
import type { Grip, MoteState, SimState, TapeCell } from "./types";

/** A game holding Extras 1, with the surface over it. */
function bench(): { game: Bench; api: OrreryDebugApi } {
  const game = new Bench();
  const api = createDebugApi(() => game);
  api.openChallenge("extras", 0);
  return { game, api };
}

/** The live run, or the failure that there is none. */
function runOf(game: Bench): SimState {
  const sim = game.state.sim;
  if (sim === null) throw new Error("no run is live");
  return sim;
}

/** Place one part with the tape given, and report its id. */
function withTape(
  game: Bench,
  api: OrreryDebugApi,
  kind: Parameters<OrreryDebugApi["placePart"]>[0],
  q: number,
  r: number,
  rotation: number,
  tape: TapeCell[],
): number {
  api.placePart(kind, q, r, rotation);
  const parts = game.state.editor.parts;
  const id = parts[parts.length - 1].id;
  for (const [col, cell] of tape.entries()) api.setTapeCell(id, col, cell);
  return id;
}

/** Spawn one `dust` mote and report its id. */
function spawn(game: Bench, api: OrreryDebugApi, q: number, r: number): number {
  api.spawnMote(q, r, "dust");
  const { motes } = runOf(game);
  return motes[motes.length - 1].id;
}

/** Where a mote rests now. */
function restingAt(game: Bench, mote: number): { q: number; r: number } {
  const found = runOf(game).motes.find((entry) => entry.id === mote);
  if (found === undefined) throw new Error(`no mote ${mote}`);
  return { q: found.q, r: found.r };
}

/** The run's grips, in the order it holds them. */
function gripsOf(game: Bench): Grip[] {
  return runOf(game).grips;
}

/** Carry the run through `count` whole cycles. */
function step(game: Bench, count = 1): void {
  for (let i = 0; i < count; i += 1) stepOneCycle(game);
}

describe("dropping (specs/simulation.md, step 2)", () => {
  it("opens every gripper of the part whose cell is `drop`", () => {
    const { game, api } = bench();
    const biarm = withTape(game, api, "biarm", 0, 0, 0, ["drop"]);
    api.startRun();
    const east = spawn(game, api, 1, 0);
    const west = spawn(game, api, -1, 0);
    api.setGrip(biarm, 0, east);
    api.setGrip(biarm, 3, west);
    step(game);
    expect(gripsOf(game)).toEqual([]);
  });

  it("leaves another part's grippers closed", () => {
    const { game, api } = bench();
    const opening = withTape(game, api, "arm", 0, 0, 0, ["drop"]);
    const holding = withTape(game, api, "arm", 3, 0, 3, []);
    api.startRun();
    const dropped = spawn(game, api, 1, 0);
    const kept = spawn(game, api, 2, 0);
    api.setGrip(opening, 0, dropped);
    api.setGrip(holding, 3, kept);
    step(game);
    expect(gripsOf(game)).toEqual([{ part: holding, spoke: 3, mote: kept }]);
  });
});

describe("grabbing (specs/simulation.md, step 3)", () => {
  it("closes on the mote under the gripper", () => {
    const { game, api } = bench();
    const arm = withTape(game, api, "arm", 0, 0, 0, ["grab"]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    step(game);
    expect(gripsOf(game)).toEqual([{ part: arm, spoke: 0, mote }]);
  });

  it("closes on nothing over an empty hex", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 0, 0, 0, ["grab"]);
    api.startRun();
    step(game);
    expect(gripsOf(game)).toEqual([]);
  });

  it("closes on nothing over a fixture", () => {
    const { game, api } = bench();
    withTape(game, api, "wheel", 0, 0, 0, []);
    withTape(game, api, "arm", 2, 0, 3, ["grab"]);
    api.startRun();
    // The wheel's spoke-0 fixture rests on `(1, 0)`, under that gripper.
    expect(
      runOf(game).motes.some(
        (mote: MoteState) =>
          mote.q === 1 && mote.r === 0 && mote.wheel !== null,
      ),
    ).toBe(true);
    step(game);
    expect(gripsOf(game)).toEqual([]);
  });

  it("closes every gripper of the part, each on its own hex", () => {
    const { game, api } = bench();
    const biarm = withTape(game, api, "biarm", 0, 0, 0, ["grab"]);
    api.startRun();
    const east = spawn(game, api, 1, 0);
    const west = spawn(game, api, -1, 0);
    step(game);
    expect(gripsOf(game)).toEqual([
      { part: biarm, spoke: 0, mote: east },
      { part: biarm, spoke: 3, mote: west },
    ]);
  });

  it("runs after the drops, so a mote released this cycle is taken", () => {
    const { game, api } = bench();
    const opening = withTape(game, api, "arm", 0, 0, 0, ["drop"]);
    const closing = withTape(game, api, "arm", 2, 0, 3, ["grab"]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    api.setGrip(opening, 0, mote);
    step(game);
    expect(gripsOf(game)).toEqual([{ part: closing, spoke: 3, mote }]);
  });
});

describe("carrying (specs/simulation.md 'Motion and carrying')", () => {
  it("carries the mote under the gripper along the part's motion", () => {
    const { game, api } = bench();
    const arm = withTape(game, api, "arm", 0, 0, 0, ["grab", "rotate-cw"]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    step(game, 2);
    expect(restingAt(game, mote)).toEqual({ q: 0, r: 1 });
    expect(gripsOf(game)).toEqual([{ part: arm, spoke: 0, mote }]);
  });

  it("carries the whole constellation, rigidly", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 0, 0, 0, ["grab", "rotate-cw"]);
    api.startRun();
    const held = spawn(game, api, 1, 0);
    const linked = spawn(game, api, 1, 1);
    api.linkMotes(held, linked, 1);
    step(game, 2);
    expect(restingAt(game, held)).toEqual({ q: 0, r: 1 });
    expect(restingAt(game, linked)).toEqual({ q: -1, r: 2 });
  });

  it("keeps a grip across a resting cycle and carries it afterwards", () => {
    const { game, api } = bench();
    const arm = withTape(game, api, "arm", 0, 0, 0, [
      "grab",
      null,
      "rotate-cw",
    ]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    step(game);
    expect(gripsOf(game)).toEqual([{ part: arm, spoke: 0, mote }]);
    // The blank cell of cycle 1 is a rest: the grip stands and nothing moves.
    step(game);
    expect(gripsOf(game)).toEqual([{ part: arm, spoke: 0, mote }]);
    expect(restingAt(game, mote)).toEqual({ q: 1, r: 0 });
    step(game);
    expect(restingAt(game, mote)).toEqual({ q: 0, r: 1 });
  });

  it("leaves a mote held by nothing on its hex", () => {
    const { game, api } = bench();
    withTape(game, api, "arm", 0, 0, 0, ["rotate-cw"]);
    api.startRun();
    const loose = spawn(game, api, 1, 0);
    step(game);
    expect(restingAt(game, loose)).toEqual({ q: 1, r: 0 });
  });

  it("carries a wheel's fixtures on its rotation and rests them otherwise", () => {
    const { game, api } = bench();
    withTape(game, api, "wheel", 0, 0, 0, [null, "rotate-ccw"]);
    api.startRun();
    const spokeZero = runOf(game).motes[0];
    expect({ q: spokeZero.q, r: spokeZero.r }).toEqual({ q: 1, r: 0 });
    step(game);
    expect(restingAt(game, spokeZero.id)).toEqual({ q: 1, r: 0 });
    step(game);
    expect(restingAt(game, spokeZero.id)).toEqual({ q: 1, r: -1 });
  });
});

describe("held more than once (specs/simulation.md)", () => {
  /** Two arms whose one gripper each stands on `(1, 0)`, holding one mote. */
  function contested(
    west: TapeCell,
    east: TapeCell,
  ): { game: Bench; api: OrreryDebugApi; parts: number[]; mote: number } {
    const { game, api } = bench();
    const left = withTape(game, api, "arm", 0, 0, 0, [west]);
    const right = withTape(game, api, "arm", 2, 0, 3, [east]);
    api.startRun();
    const mote = spawn(game, api, 1, 0);
    api.setGrip(left, 0, mote);
    api.setGrip(right, 3, mote);
    return { game, api, parts: [left, right], mote };
  }

  it("agrees when both holders impose no motion", () => {
    const { game, mote } = contested(null, null);
    step(game);
    expect(runOf(game).fault).toBeNull();
    expect(restingAt(game, mote)).toEqual({ q: 1, r: 0 });
  });

  it("agrees when both holders pivot about the one gripper hex", () => {
    const { game, mote } = contested("pivot-cw", "pivot-cw");
    step(game);
    expect(runOf(game).status).toBe("paused");
    expect(runOf(game).fault).toBeNull();
    expect(restingAt(game, mote)).toEqual({ q: 1, r: 0 });
  });

  it("tears when the two holders rotate about different bases", () => {
    const { game, parts, mote } = contested("rotate-cw", "rotate-cw");
    step(game);
    const sim = runOf(game);
    expect(sim.status).toBe("faulted");
    expect(sim.fault).toEqual({ kind: "torn", parts, motes: [mote] });
    // A tear freezes the field exactly as the boundary left it.
    expect(sim.fraction).toBe(0);
    expect(sim.cycle).toBe(0);
    expect(restingAt(game, mote)).toEqual({ q: 1, r: 0 });
  });

  it("tears when one holder moves and the other rests", () => {
    const { game, parts, mote } = contested("pivot-ccw", null);
    step(game);
    expect(runOf(game).fault).toEqual({ kind: "torn", parts, motes: [mote] });
  });

  it("tears when the two holders pivot in opposite directions", () => {
    const { game, parts, mote } = contested("pivot-cw", "pivot-ccw");
    step(game);
    expect(runOf(game).fault).toEqual({ kind: "torn", parts, motes: [mote] });
  });

  it("names every mote of the torn constellation", () => {
    const { game, api } = bench();
    const left = withTape(game, api, "arm", 0, 0, 0, ["rotate-cw"]);
    const right = withTape(game, api, "arm", 2, 1, 4, ["rotate-ccw"]);
    api.startRun();
    const first = spawn(game, api, 1, 0);
    const second = spawn(game, api, 2, 0);
    api.linkMotes(first, second, 1);
    api.setGrip(left, 0, first);
    api.setGrip(right, 4, second);
    step(game);
    expect(runOf(game).fault).toEqual({
      kind: "torn",
      parts: [left, right],
      motes: [first, second],
    });
  });

  it("agrees when two holders on one track impose the same translation", () => {
    const { game, api } = bench();
    api.placeTrack(-1, 0);
    const parts = game.state.editor.parts;
    const path = parts[parts.length - 1].id;
    api.extendTrack(path, 0, 0);
    api.extendTrack(path, 1, 0);
    const trailing = withTape(game, api, "arm", -1, 0, 0, ["advance"]);
    const leading = withTape(game, api, "arm", 0, 0, 0, ["advance"]);
    api.startRun();
    const behind = spawn(game, api, 0, 0);
    const ahead = spawn(game, api, 1, 0);
    api.linkMotes(behind, ahead, 1);
    api.setGrip(trailing, 0, behind);
    api.setGrip(leading, 0, ahead);
    step(game);
    expect(runOf(game).fault).toBeNull();
    expect(restingAt(game, behind)).toEqual({ q: 1, r: 0 });
    expect(restingAt(game, ahead)).toEqual({ q: 2, r: 0 });
  });

  it("agrees when one part holds a constellation on two of its grippers", () => {
    const { game, api } = bench();
    const biarm = withTape(game, api, "biarm", 0, 0, 0, ["rotate-cw"]);
    api.startRun();
    const east = spawn(game, api, 1, 0);
    const west = spawn(game, api, -1, 0);
    const joint = spawn(game, api, 0, 0);
    api.linkMotes(east, joint, 1);
    api.linkMotes(west, joint, 1);
    api.setGrip(biarm, 0, east);
    api.setGrip(biarm, 3, west);
    step(game);
    expect(runOf(game).fault).toBeNull();
    expect(restingAt(game, east)).toEqual({ q: 0, r: 1 });
    expect(restingAt(game, west)).toEqual({ q: 0, r: -1 });
    expect(restingAt(game, joint)).toEqual({ q: 0, r: 0 });
  });
});
