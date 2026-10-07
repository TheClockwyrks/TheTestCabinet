import { describe, expect, it } from "vitest";
import { GantryState } from "./game";
import * as editor from "./editor";
import * as st from "./state";
import { project } from "./view";

/** A fresh game on site 0's build screen, which is where the editor works. */
function building(): GantryState {
  const state = new GantryState();
  state.screen = "build";
  return state;
}

/** The four legs and the ring of a plain tower on site 0. */
function tower(state: GantryState): void {
  editor.setRing(state, [0, 2, 0]);
  editor.addMember(state, [0, 0, 0], [0, 2, 0], "strut");
  editor.addMember(state, [2, 0, 0], [2, 2, 0], "strut");
  editor.addMember(state, [0, 0, 2], [0, 2, 2], "strut");
  editor.addMember(state, [2, 0, 2], [2, 2, 2], "strut");
}

describe("addMember", () => {
  it("gives the member the structure's next id and advances it", () => {
    const s = building();
    expect(editor.addMember(s, [0, 0, 0], [0, 2, 0], "strut")).toEqual({
      cue: "place",
      refusal: null,
    });
    const structure = st.currentStructure(s);
    expect(structure.members).toHaveLength(1);
    expect(structure.members[0].id).toBe(0);
    expect(structure.members[0].a).toEqual({ x: 0, y: 0, z: 0 });
    expect(structure.nextMemberId).toBe(1);
    expect(s.history).toHaveLength(1);
  });

  it("is refused by the rules, silently, and pushes no history", () => {
    const s = building();
    const outcome = editor.addMember(s, [0, 0, 0], [40, 0, 0], "strut");
    expect(outcome.cue).toBeNull();
    expect(outcome.refusal).toBe("outside-envelope");
    expect(st.currentStructure(s).members).toHaveLength(0);
    expect(s.history).toHaveLength(0);
  });

  it("refuses a duplicate in either direction", () => {
    const s = building();
    editor.addMember(s, [0, 0, 0], [0, 2, 0], "strut");
    expect(editor.addMember(s, [0, 2, 0], [0, 0, 0], "cable").refusal).toBe(
      "duplicate",
    );
  });
});

describe("removeMember", () => {
  it("removes it, raises delete, and gives no id back", () => {
    const s = building();
    editor.addMember(s, [0, 0, 0], [0, 2, 0], "strut");
    expect(editor.removeMember(s, 0)).toEqual({
      cue: "delete",
      refusal: null,
    });
    expect(st.currentStructure(s).members).toHaveLength(0);
    expect(st.currentStructure(s).nextMemberId).toBe(1);
  });

  it("removes nothing, silently, for an id the structure has lost", () => {
    const s = building();
    expect(editor.removeMember(s, 3)).toEqual({ cue: null, refusal: null });
    expect(s.history).toHaveLength(0);
  });
});

describe("the ring", () => {
  it("is placed by its base corner and refused on the ground", () => {
    const s = building();
    expect(editor.setRing(s, [0, 0, 0]).refusal).toBe("ring-on-ground");
    expect(editor.setRing(s, [0, 2, 0])).toEqual({
      cue: "place",
      refusal: null,
    });
    expect(st.currentStructure(s).ring).toEqual({
      corner: { x: 0, y: 2, z: 0 },
    });
    expect(editor.setRing(s, [0, 4, 0]).refusal).toBe("ring-exists");
  });

  it("clears, and clearing none is silent and pushes no history", () => {
    const s = building();
    expect(editor.clearRing(s)).toEqual({ cue: null, refusal: null });
    expect(s.history).toHaveLength(0);
    editor.setRing(s, [0, 2, 0]);
    expect(editor.clearRing(s)).toEqual({ cue: "delete", refusal: null });
    expect(st.currentStructure(s).ring).toBeNull();
  });
});

describe("counterweights", () => {
  it("needs a node the structure uses, and takes one per node", () => {
    const s = building();
    expect(editor.addCounterweight(s, [6, 6, 6]).refusal).toBe("node-unused");
    tower(s);
    expect(editor.addCounterweight(s, [0, 2, 0])).toEqual({
      cue: "place",
      refusal: null,
    });
    expect(editor.addCounterweight(s, [0, 2, 0]).refusal).toBe(
      "counterweight-exists",
    );
    expect(editor.carriesCounterweight(s, [0, 2, 0])).toBe(true);
    expect(editor.removeCounterweight(s, [0, 2, 0]).cue).toBe("delete");
    expect(editor.removeCounterweight(s, [0, 2, 0])).toEqual({
      cue: null,
      refusal: null,
    });
  });
});

describe("clearStructure", () => {
  it("empties it, returns the next id to 0, and pushes one history entry", () => {
    const s = building();
    tower(s);
    const depth = s.history.length;
    expect(editor.clearStructure(s)).toEqual({ cue: "delete", refusal: null });
    const structure = st.currentStructure(s);
    expect(structure.members).toHaveLength(0);
    expect(structure.ring).toBeNull();
    expect(structure.nextMemberId).toBe(0);
    expect(s.history).toHaveLength(depth + 1);
  });

  it("on an empty structure removes nothing and pushes no history", () => {
    const s = building();
    expect(editor.clearStructure(s)).toEqual({ cue: null, refusal: null });
    expect(s.history).toHaveLength(0);
  });
});

describe("undo", () => {
  it("reverses the most recent edit and never hands an id back", () => {
    const s = building();
    editor.addMember(s, [0, 0, 0], [0, 2, 0], "strut");
    editor.addMember(s, [2, 0, 0], [2, 2, 0], "strut");
    expect(editor.undo(s)).toEqual({ cue: "delete", refusal: null });
    expect(st.currentStructure(s).members).toHaveLength(1);
    expect(st.currentStructure(s).nextMemberId).toBe(2);
    expect(s.history).toHaveLength(1);
    editor.undo(s);
    expect(st.currentStructure(s).members).toHaveLength(0);
    expect(editor.undo(s)).toEqual({ cue: null, refusal: null });
  });
});

describe("showCheck", () => {
  it("leaves the result showing on the build screen", () => {
    const s = building();
    editor.showCheck(s);
    expect(s.checkResult?.issues).toContain("no-ring");
    expect(s.checkResult?.stable).toBe(false);
    expect(s.checkResult?.members).toEqual([]);
  });
});

describe("the member tool", () => {
  it("holds the first node, places on the second, and clears the pending", () => {
    const s = building();
    editor.applyMemberTool(s, "strut", [0, 0, 0]);
    expect(s.pendingNode).toEqual({ x: 0, y: 0, z: 0 });
    editor.applyMemberTool(s, "strut", [0, 2, 0]);
    expect(s.pendingNode).toBeNull();
    expect(st.currentStructure(s).members).toHaveLength(1);
  });

  it("clears the pending node on a second click on it, without placing", () => {
    const s = building();
    editor.applyMemberTool(s, "strut", [0, 0, 0]);
    editor.applyMemberTool(s, "strut", [0, 0, 0]);
    expect(s.pendingNode).toBeNull();
    expect(st.currentStructure(s).members).toHaveLength(0);
  });

  it("leaves the pending node held when the rules refuse the second", () => {
    const s = building();
    editor.applyMemberTool(s, "strut", [0, 0, 0]);
    const outcome = editor.applyMemberTool(s, "strut", [0, 8, 0]);
    expect(outcome.refusal).toBe("too-long");
    expect(s.pendingNode).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("pick", () => {
  it("takes nothing on any screen but build", () => {
    const s = new GantryState();
    expect(editor.pick(s)).toEqual({ node: null, member: null });
  });

  it("takes the node under the pointer at the point it is drawn", () => {
    const s = building();
    const at = project(s.camera, [0, 2, 0]);
    s.pointer.x = at.x;
    s.pointer.y = at.y;
    expect(editor.pick(s).node).toEqual({ x: 0, y: 2, z: 0 });
  });

  it("takes nothing with the pointer off the stage entirely", () => {
    const s = building();
    s.pointer.x = -900;
    s.pointer.y = -900;
    expect(editor.pick(s)).toEqual({ node: null, member: null });
  });

  it("takes the member whose drawn segment the pointer is over", () => {
    const s = building();
    editor.addMember(s, [0, 0, 0], [0, 2, 0], "strut");
    const a = project(s.camera, [0, 0, 0]);
    const b = project(s.camera, [0, 2, 0]);
    s.pointer.x = (a.x + b.x) / 2;
    s.pointer.y = (a.y + b.y) / 2;
    expect(editor.pick(s).member).toBe(0);
  });
});

describe("deleteTarget", () => {
  it("prefers the member, then the counterweight, then the ring", () => {
    const s = building();
    tower(s);
    editor.addCounterweight(s, [2, 2, 2]);
    const at = project(s.camera, [0, 1, 0]);
    s.pointer.x = at.x;
    s.pointer.y = at.y;
    expect(editor.deleteTarget(s)).toEqual({ kind: "member", id: 0 });
    s.pointer.x = -900;
    s.pointer.y = -900;
    expect(editor.deleteTarget(s)).toBeNull();
  });
});

describe("applyClick", () => {
  /** Put the pointer where a world position is drawn. */
  function aimAt(state: GantryState, at: [number, number, number]): void {
    const point = project(state.camera, at);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
  }

  it("changes nothing on any screen but build", () => {
    const s = new GantryState();
    aimAt(s, [0, 2, 0]);
    expect(editor.applyClick(s)).toEqual({ cue: null, refusal: null });
    expect(s.pendingNode).toBeNull();
  });

  it("changes nothing with no candidate in range", () => {
    const s = building();
    s.pointer.x = -900;
    s.pointer.y = -900;
    expect(editor.applyClick(s)).toEqual({ cue: null, refusal: null });
    expect(st.currentStructure(s).members).toHaveLength(0);
  });

  it("holds the first node and places the member on the second", () => {
    const s = building();
    aimAt(s, [0, 0, 0]);
    expect(editor.applyClick(s).cue).toBeNull();
    expect(s.pendingNode).toEqual({ x: 0, y: 0, z: 0 });
    aimAt(s, [0, 2, 0]);
    expect(editor.applyClick(s).cue).toBe("place");
    expect(s.pendingNode).toBeNull();
    expect(st.currentStructure(s).members).toHaveLength(1);
  });

  it("reports the rule that refuses a placement", () => {
    const s = building();
    aimAt(s, [0, 0, 0]);
    editor.applyClick(s);
    // A strut reaches at most STRUT_MAX_LEN, and this pair is further apart.
    aimAt(s, [8, 0, 8]);
    expect(editor.applyClick(s).refusal).toBe("too-long");
    // A refused second click leaves the pending node held.
    expect(s.pendingNode).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("sets the ring under the ring tool, leaving a held node held", () => {
    const s = building();
    tower(s);
    editor.clearRing(s);
    st.setPendingNode(s, { x: 0, y: 0, z: 0 });
    s.tool = "ring";
    aimAt(s, [0, 2, 0]);
    expect(editor.applyClick(s).cue).toBe("place");
    expect(st.currentStructure(s).ring).toEqual({
      corner: { x: 0, y: 2, z: 0 },
    });
    expect(s.pendingNode).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("toggles a counterweight on the node it picks", () => {
    const s = building();
    tower(s);
    s.tool = "counterweight";
    aimAt(s, [2, 2, 2]);
    expect(editor.applyClick(s).cue).toBe("place");
    expect(st.currentStructure(s).counterweights).toHaveLength(1);
    expect(editor.applyClick(s).cue).toBe("delete");
    expect(st.currentStructure(s).counterweights).toHaveLength(0);
  });

  it("removes what the delete tool picks", () => {
    const s = building();
    tower(s);
    s.tool = "delete";
    aimAt(s, [0, 1, 0]);
    expect(editor.applyClick(s).cue).toBe("delete");
    expect(st.currentStructure(s).members).toHaveLength(3);
  });
});
