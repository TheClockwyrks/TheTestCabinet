import { describe, expect, it } from "vitest";

import { Bench } from "./harness";
import {
  beginEdit,
  commitEdit,
  machinesEqual,
  reconcileHands,
  redoEdit,
  undoEdit,
} from "./history";
import { createPart } from "./machine";
import { startRun } from "./sim";
import type { OrreryState } from "./state";
import { openChallenge } from "./flow";

/** Extras 1, opened, with an empty machine and an empty history. */
function opened(): OrreryState {
  const game = new Bench();
  openChallenge(game, "extras", 0);
  return game.state;
}

describe("machine equality (specs/editor.md)", () => {
  it("reads two copies of one machine as equal", () => {
    const a = [createPart(1, "arm", 0, 0, 2, { length: 3, tape: ["grab"] })];
    const b = [createPart(1, "arm", 0, 0, 2, { length: 3, tape: ["grab"] })];
    expect(machinesEqual(a, b)).toBe(true);
  });

  it("tells poses, paths, and tapes apart", () => {
    const base = createPart(1, "arm", 0, 0, 2, { length: 3, tape: ["grab"] });
    expect(machinesEqual([base], [{ ...base, rotation: 3 }])).toBe(false);
    expect(machinesEqual([base], [{ ...base, length: 1 }])).toBe(false);
    expect(machinesEqual([base], [{ ...base, tape: ["drop"] }])).toBe(false);
    expect(machinesEqual([base], [{ ...base, tape: [] }])).toBe(false);
    expect(machinesEqual([base], [])).toBe(false);
    const track = createPart(2, "track", 0, 0, 0, {
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
    });
    expect(
      machinesEqual([track], [{ ...track, cells: [{ q: 0, r: 0 }] }]),
    ).toBe(false);
    expect(machinesEqual([track], [{ ...track, closed: true }])).toBe(false);
  });
});

describe("the undo history (specs/editor.md)", () => {
  it("pushes nothing for an edit that changed nothing", () => {
    const state = opened();
    const before = beginEdit(state);
    expect(commitEdit(state, before)).toBe(false);
    expect(state.editor.undo).toHaveLength(0);
  });

  it("pushes one entry for a change and clears the redo side", () => {
    const state = opened();
    state.editor.redo = [[]];
    const before = beginEdit(state);
    state.editor.parts.push(createPart(1, "arm", 0, 0, 0));
    expect(commitEdit(state, before)).toBe(true);
    expect(state.editor.undo).toHaveLength(1);
    expect(state.editor.redo).toHaveLength(0);
  });

  it("restores the machine as it stood before the edit", () => {
    const state = opened();
    const before = beginEdit(state);
    state.editor.parts.push(createPart(1, "arm", 0, 0, 0));
    commitEdit(state, before);
    undoEdit(state);
    expect(state.editor.parts).toEqual([]);
    expect(state.editor.undo).toHaveLength(0);
    expect(state.editor.redo).toHaveLength(1);
    redoEdit(state);
    expect(state.editor.parts).toHaveLength(1);
    expect(state.editor.undo).toHaveLength(1);
    expect(state.editor.redo).toHaveLength(0);
  });

  it("does nothing with an empty history, either way", () => {
    const state = opened();
    undoEdit(state);
    redoEdit(state);
    expect(state.editor.parts).toEqual([]);
    expect(state.editor.undo).toHaveLength(0);
    expect(state.editor.redo).toHaveLength(0);
  });

  it("holds every edit of the visit, with no bound on its depth", () => {
    const state = opened();
    for (let i = 0; i < 40; i += 1) {
      const before = beginEdit(state);
      state.editor.parts.push(createPart(i + 1, "bind", 0, 0, 0));
      commitEdit(state, before);
    }
    expect(state.editor.undo).toHaveLength(40);
    for (let i = 0; i < 40; i += 1) undoEdit(state);
    expect(state.editor.parts).toEqual([]);
  });

  it("is inert while a run is live", () => {
    const game = new Bench();
    openChallenge(game, "extras", 0);
    const state = game.state;
    const before = beginEdit(state);
    state.editor.parts.push(createPart(1, "arm", 0, 0, 0));
    commitEdit(state, before);
    startRun(game);
    undoEdit(state);
    expect(state.editor.parts).toHaveLength(1);
    expect(state.editor.undo).toHaveLength(1);
    redoEdit(state);
    expect(state.editor.redo).toHaveLength(0);
  });

  it("clears a selection or cursor the machine no longer holds", () => {
    const state = opened();
    state.editor.parts.push(createPart(1, "arm", 0, 0, 0));
    state.editor.selected = 1;
    state.editor.cursor = { part: 1, col: 2 };
    reconcileHands(state);
    expect(state.editor.selected).toBe(1);
    state.editor.parts = [];
    reconcileHands(state);
    expect(state.editor.selected).toBeNull();
    expect(state.editor.cursor).toBeNull();
  });
});
