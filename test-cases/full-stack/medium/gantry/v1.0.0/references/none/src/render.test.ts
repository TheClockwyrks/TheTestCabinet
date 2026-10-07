import { describe, expect, it } from "vitest";
import { NODE_PICK_PX, STAGE_H, STAGE_W } from "./constants";
import { SIM_SITES, type Vec3 } from "./sim";
import { pointerHint, project } from "./render";
import { addMember } from "./editor";
import {
  openSite,
  setPendingNode,
  setScreen,
  setTool,
  titleState,
  type GantryState,
} from "./state";

/**
 * A state with the pointer over a world position, on the build screen. The
 * pointer is read straight into the state here rather than through the runtime,
 * which is what the frame loop does every update.
 */
function pointingAt(state: GantryState, world: Vec3): GantryState {
  const point = project(state.camera, world);
  return { ...state, pointer: { ...state.pointer, x: point.x, y: point.y } };
}

const site = (): GantryState => setScreen(openSite(titleState(), 0), "build");

describe("pointerHint", () => {
  it("says nothing on a screen that is not the build screen", () => {
    for (const screen of [
      "title",
      "select",
      "program",
      "run",
      "results",
    ] as const) {
      const state = setScreen(openSite(titleState(), 0), screen);
      expect(pointerHint(state)).toEqual({ action: null, refusal: null });
    }
  });

  it("says nothing where the pointer picks nothing", () => {
    const state = {
      ...site(),
      pointer: { ...site().pointer, x: -400, y: -400 },
    };
    expect(pointerHint(state)).toEqual({ action: null, refusal: null });
  });

  it("offers to hold the first node of a member", () => {
    const state = pointingAt(setTool(site(), "strut"), [0, 0, 0]);
    const hint = pointerHint(state);
    expect(hint.refusal).toBeNull();
    expect(hint.action).toContain("HOLD");
    expect(hint.action).toContain("(0, 0, 0)");
  });

  it("offers to place the member once a node is held", () => {
    const held = setPendingNode(setTool(site(), "strut"), [0, 0, 0]);
    const hint = pointerHint(pointingAt(held, [0, 2, 0]));
    expect(hint.refusal).toBeNull();
    expect(hint.action).toBe("CLICK TO PLACE A STRUT");
  });

  it("offers to drop the held node when the pointer is back on it", () => {
    const held = setPendingNode(setTool(site(), "strut"), [0, 0, 0]);
    const hint = pointerHint(pointingAt(held, [0, 0, 0]));
    expect(hint.action).toBe("CLICK AGAIN TO DROP THE HELD NODE");
  });

  it("names the rule that would refuse the edit, before the click", () => {
    // A strut may not be longer than `STRUT_MAX_LEN`, which is `6`.
    const held = setPendingNode(setTool(site(), "strut"), [0, 0, 0]);
    const hint = pointerHint(pointingAt(held, [8, 0, 0]));
    expect(hint.action).toBeNull();
    expect(hint.refusal).toBe("too-long");
  });

  it("refuses a counterweight on a node the structure does not use", () => {
    const state = pointingAt(setTool(site(), "counterweight"), [0, 6, 0]);
    expect(pointerHint(state).refusal).toBe("node-unused");
  });

  it("offers a counterweight on a node the structure does use", () => {
    const built = addMember(site(), [0, 0, 0], [0, 2, 0], "strut").state;
    const state = pointingAt(setTool(built, "counterweight"), [0, 2, 0]);
    const hint = pointerHint(state);
    expect(hint.refusal).toBeNull();
    expect(hint.action).toContain("COUNTERWEIGHT");
  });

  it("refuses a ring on the ground, where a ring may not sit", () => {
    const state = pointingAt(setTool(site(), "ring"), [0, 0, 0]);
    expect(pointerHint(state).refusal).toBe("ring-on-ground");
  });

  it("offers to delete what the delete tool has picked", () => {
    const built = addMember(site(), [0, 0, 0], [0, 2, 0], "strut").state;
    const state = pointingAt(setTool(built, "delete"), [0, 2, 0]);
    expect(pointerHint(state).action).toContain("DELETE");
  });

  it("reads the state and writes nothing", () => {
    const held = setPendingNode(setTool(site(), "strut"), [0, 0, 0]);
    const state = pointingAt(held, [0, 2, 0]);
    const before = JSON.stringify(state);
    pointerHint(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("project, as the rest of the build reaches it", () => {
  it("is the same reading render-project gives", () => {
    const state = site();
    const point = project(state.camera, [0, 0, 0]);
    expect(point.visible).toBe(true);
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(STAGE_W);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(STAGE_H);
  });

  it("puts a pick within the pick radius of the node it projects", () => {
    // `specs/instrumentation.md`: a press at a visible node's projected point
    // picks that node, so the two must be the one projection.
    const state = site();
    for (const node of SIM_SITES[0].anchors) {
      const point = project(state.camera, node);
      const hint = pointerHint(
        setTool({ ...state, pointer: { ...state.pointer, ...point } }, "strut"),
      );
      expect(hint.action).toContain(`(${node[0]}, ${node[1]}, ${node[2]})`);
      expect(NODE_PICK_PX).toBeGreaterThan(0);
    }
  });
});
