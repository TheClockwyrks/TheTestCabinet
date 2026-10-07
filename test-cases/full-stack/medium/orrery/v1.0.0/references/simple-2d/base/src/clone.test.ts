// The draft a transition builds (specs/state.md "The contract").
//
// One property carries the whole by-value model: the copy shares nothing with
// the state it was taken from. If it shared one array, a pose that was refused
// part way through would leave the engine's state half-written, and a caller
// that kept an earlier state would watch it change under a later frame.

import { describe, expect, it } from "vitest";

import { cloneState } from "./clone";
import { createStateOps } from "./debug";
import { Session } from "./session";
import { createState } from "./state";

/** A session posed with a challenge, a machine, and a live run. */
function posed(): Session {
  const game = new Session();
  const api = createStateOps(game);
  api.openChallenge("extras", 0);
  api.placePart("arm", 0, 0, 0);
  api.placeTrack(2, 0);
  api.extendTrack(game.state.editor.parts[1].id, 3, 0);
  api.setTapeCell(game.state.editor.parts[0].id, 0, "rotate-cw");
  api.startRun();
  api.spawnMote(1, 0, "dust");
  api.spawnMote(1, 1, "dust");
  const motes = game.state.sim?.motes ?? [];
  api.linkMotes(motes[motes.length - 2].id, motes[motes.length - 1].id, 1);
  api.setRecord("extras", 0, "cost", 40);
  api.setSolved("extras", 0, true);
  return game;
}

describe("cloning the state (specs/state.md)", () => {
  it("copies every field of a fresh state exactly", () => {
    const fresh = createState();
    expect(cloneState(fresh)).toEqual(fresh);
  });

  it("copies a posed state exactly", () => {
    const game = posed();
    expect(cloneState(game.state)).toEqual(game.state);
  });

  it("shares no array or object with the state it was taken from", () => {
    const game = posed();
    const draft = cloneState(game.state);

    // Writing into the draft must leave the original exactly as it stood.
    draft.editor.parts[0].rotation = 3;
    draft.editor.parts[0].tape?.push("grab");
    draft.editor.parts[1].cells?.push({ q: 4, r: 0 });
    draft.sim?.motes.push({ id: 99, q: 5, r: 0, type: "sol", wheel: null });
    draft.sim?.filaments.splice(0, 1);
    if (draft.sim !== null) draft.sim.poses[0].cell.q = 4;
    draft.sim?.tallies.push(1);
    draft.sim?.areaHexes.push({ q: 4, r: 4 });
    draft.extrasSolved.push(7);
    const record = draft.extrasRecords[0];
    if (record !== null) record.cost = 1;
    draft.challenge?.permitted.push("void");
    draft.challenge?.products[0].motes.push({ q: 9, r: 9, type: "sol" });
    draft.pointer.x = 12;

    const original = game.state;
    expect(original.editor.parts[0].rotation).toBe(0);
    expect(original.editor.parts[0].tape).toEqual(["rotate-cw"]);
    expect(original.editor.parts[1].cells).toHaveLength(2);
    expect(original.sim?.motes.some((mote) => mote.id === 99)).toBe(false);
    expect(original.sim?.filaments).toHaveLength(1);
    expect(original.sim?.poses[0].cell.q).toBe(0);
    expect(original.sim?.tallies).toHaveLength(1);
    expect(original.sim?.areaHexes.some((at) => at.q === 4)).toBe(false);
    expect(original.extrasSolved).toEqual([0]);
    expect(original.extrasRecords[0]?.cost).toBe(40);
    expect(original.challenge?.permitted).not.toContain("void");
    expect(original.challenge?.products[0].motes).toHaveLength(1);
    expect(original.pointer.x).toBe(0);
  });

  it("carries the cycle's plan whole rather than copying it", () => {
    const game = posed();
    game.update(0.01);
    const draft = cloneState(game.state);
    // The plan is derived data a boundary replaces outright, so the draft
    // shares it, and applying it writes into whichever run it is handed.
    expect(draft.sim?.pending).toBe(game.state.sim?.pending);
  });

  it("copies the stashes, so a stashed machine cannot be edited in place", () => {
    const game = posed();
    const api = createStateOps(game);
    api.setScreen("select");
    const draft = cloneState(game.state);
    draft.extrasMachines[0]?.push({
      id: 99,
      kind: "arm",
      q: 0,
      r: 0,
      rotation: 0,
      length: 1,
      cells: null,
      closed: null,
      index: null,
      tape: [],
    });
    expect(game.state.extrasMachines[0]).toHaveLength(2);
  });
});
