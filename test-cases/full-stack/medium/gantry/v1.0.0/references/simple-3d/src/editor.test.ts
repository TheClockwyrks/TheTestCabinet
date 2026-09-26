// The build tools: what a click does with each one.
//
// A click is decided at the pointer's position, so each test puts the pointer
// exactly where `src/project.ts` says a node is drawn and then clicks.

import { describe, expect, it } from "vitest";
import { point, thaw } from "./convert";
import { applyClick } from "./editor";
import * as edits from "./edits";
import type { GantryState, Vec3 } from "./game";
import { project } from "./project";
import { openSite, setScreen, setTool, titleState } from "./state";

/** The build screen of site 0, with the pointer resting off every node. */
const yard = (): GantryState => setScreen(openSite(titleState(), 0), "build");

/** The same state with the pointer where a node is drawn, offset if asked. */
function aimedAt(state: GantryState, node: Vec3, dx = 0, dy = 0): GantryState {
  const s = thaw(state);
  const at = project({ ...s.camera }, node);
  s.pointer.x = at.x + dx;
  s.pointer.y = at.y + dy;
  return s;
}

const click = (state: GantryState, node: Vec3): GantryState =>
  applyClick(aimedAt(state, node)).state;

const structureOf = (state: GantryState) =>
  state.sites[state.siteIndex].structure;

describe("a click off the build screen", () => {
  it("changes nothing", () => {
    const elsewhere = setScreen(yard(), "program");
    expect(applyClick(elsewhere).state).toEqual(thaw(elsewhere));
  });
});

describe("the member tools", () => {
  it("hold the first node and place on the second", () => {
    const held = click(yard(), point(0, 4, 0));
    expect(held.pendingNode).toEqual(point(0, 4, 0));
    expect(structureOf(held).members).toHaveLength(0);

    const placed = click(held, point(2, 4, 0));
    expect(placed.pendingNode).toBeNull();
    expect(structureOf(placed).members).toHaveLength(1);
    expect(structureOf(placed).members[0].material).toBe("strut");
    expect(placed.cues.map((c) => c.cue)).toContain("place");
  });

  it("drop the held node when the second click is the same node", () => {
    const held = click(yard(), point(0, 4, 0));
    const dropped = click(held, point(0, 4, 0));
    expect(dropped.pendingNode).toBeNull();
    expect(structureOf(dropped).members).toHaveLength(0);
  });

  it("keep the node held when the rules refuse the placement", () => {
    const held = click(setTool(yard(), "rail"), point(0, 4, 0));
    // Rail must be horizontal, so a node at another height is refused.
    const outcome = applyClick(aimedAt(held, point(0, 6, 0)));
    expect(outcome.refusal).toBe("rail-not-horizontal");
    expect(outcome.state.pendingNode).toEqual(point(0, 4, 0));
  });

  it("do nothing where no node is in range", () => {
    const s = thaw(yard());
    s.pointer.x = 4;
    s.pointer.y = 4;
    expect(applyClick(s)).toEqual({ state: s, refusal: null });
  });

  it("place what the selected tool names", () => {
    let s = setTool(yard(), "cable");
    s = click(s, point(0, 4, 0));
    s = click(s, point(0, 8, 0));
    expect(structureOf(s).members[0].material).toBe("cable");
  });
});

describe("the ring tool", () => {
  it("sets the ring by the node clicked, and leaves a held node alone", () => {
    let s = setTool(click(yard(), point(0, 4, 0)), "ring");
    s = click(s, point(0, 2, 0));
    expect(structureOf(s).ring).toEqual({ corner: point(0, 2, 0) });
    expect(s.pendingNode).toEqual(point(0, 4, 0));
  });

  it("names the rule that refused it", () => {
    const s = setTool(yard(), "ring");
    const outcome = applyClick(aimedAt(s, point(0, 0, 0)));
    expect(outcome.refusal).toBe("ring-on-ground");
    expect(structureOf(outcome.state).ring).toBeNull();
  });
});

describe("the counterweight tool", () => {
  it("hangs one on a used node and takes it off again", () => {
    let s = click(yard(), point(0, 4, 0));
    s = click(s, point(2, 4, 0));
    s = setTool(s, "counterweight");
    const hung = click(s, point(2, 4, 0));
    expect(structureOf(hung).counterweights).toEqual([point(2, 4, 0)]);
    const off = click(hung, point(2, 4, 0));
    expect(structureOf(off).counterweights).toHaveLength(0);
  });

  it("refuses a node nothing uses", () => {
    const s = setTool(yard(), "counterweight");
    expect(applyClick(aimedAt(s, point(0, 4, 0))).refusal).toBe("node-unused");
  });
});

describe("the delete tool", () => {
  it("takes the member under the pointer", () => {
    let s = click(yard(), point(0, 4, 0));
    s = click(s, point(2, 4, 0));
    const id = structureOf(s).members[0].id;
    s = setTool(s, "delete");
    // The pointer sits on the middle of the member rather than on a node.
    const middle = point(1, 4, 0);
    const gone = click(s, middle);
    expect(structureOf(gone).members).toHaveLength(0);
    expect(gone.cues.map((c) => c.cue)).toContain("delete");
    expect(id).toBe(0);
  });

  it("leaves a counterweight where the member under it ties", () => {
    // A counterweight hangs on a node a member ends at, so a click on that node
    // is the same distance from both and the tie goes to the member.
    let s = click(yard(), point(0, 4, 0));
    s = click(s, point(0, 8, 0));
    s = setTool(s, "counterweight");
    s = click(s, point(0, 8, 0));
    s = setTool(s, "delete");
    const gone = click(s, point(0, 8, 0));
    expect(structureOf(gone).members).toHaveLength(0);
    expect(structureOf(gone).counterweights).toHaveLength(1);
  });

  it("takes a counterweight where it alone is in range", () => {
    let s = click(yard(), point(0, 4, 0));
    s = click(s, point(0, 8, 0));
    s = setTool(s, "counterweight");
    s = click(s, point(0, 8, 0));
    s = setTool(s, "delete");
    // Fifteen pixels off the vertical member: past MEMBER_PICK_PX, inside
    // NODE_PICK_PX.
    const gone = applyClick(aimedAt(s, point(0, 8, 0), 15, 0)).state;
    expect(structureOf(gone).counterweights).toHaveLength(0);
    expect(structureOf(gone).members).toHaveLength(1);
  });

  it("takes the ring at one of its flange nodes", () => {
    let s = edits.setRing(yard(), point(-4, 2, -4)).state;
    s = setTool(s, "delete");
    const gone = click(s, point(-4, 4, -4));
    expect(structureOf(gone).ring).toBeNull();
  });

  it("does nothing where nothing is in range", () => {
    const s = thaw(setTool(yard(), "delete"));
    s.pointer.x = 2;
    s.pointer.y = 2;
    expect(applyClick(s).state).toEqual(s);
  });
});
