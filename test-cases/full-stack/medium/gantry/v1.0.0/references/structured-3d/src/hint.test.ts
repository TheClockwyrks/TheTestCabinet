import { describe, expect, it } from "vitest";
import { GantryState } from "./game";
import * as editor from "./editor";
import { hasHint, NO_HINT, pointerHint } from "./hint";
import { currentStructure, setPendingNode, setScreen } from "./state";
import { project } from "./view";

function building(): GantryState {
  const state = new GantryState();
  setScreen(state, "build");
  return state;
}

/** Put the pointer where a world position is drawn. */
function aimAt(state: GantryState, at: [number, number, number]): void {
  const point = project(state.camera, at);
  state.pointer.x = point.x;
  state.pointer.y = point.y;
}

describe("pointerHint", () => {
  it("says nothing on any screen but build", () => {
    const state = new GantryState();
    aimAt(state, [0, 2, 0]);
    expect(pointerHint(state)).toEqual(NO_HINT);
    expect(hasHint(NO_HINT)).toBe(false);
  });

  it("says nothing with nothing under the pointer", () => {
    const state = building();
    state.pointer.x = -900;
    state.pointer.y = -900;
    expect(pointerHint(state)).toEqual(NO_HINT);
  });

  it("names the node a first click would hold", () => {
    const state = building();
    aimAt(state, [0, 2, 0]);
    const hint = pointerHint(state);
    expect(hint.action).toBe("CLICK TO HOLD (0, 2, 0)");
    expect(hasHint(hint)).toBe(true);
  });

  it("says what a second click would place", () => {
    const state = building();
    setPendingNode(state, { x: 0, y: 0, z: 0 });
    aimAt(state, [0, 2, 0]);
    expect(pointerHint(state).action).toBe("CLICK TO PLACE A STRUT");
  });

  it("names the rule that would refuse the click", () => {
    const state = building();
    setPendingNode(state, { x: 0, y: 0, z: 0 });
    aimAt(state, [8, 0, 8]);
    expect(pointerHint(state).refusal).toBe("too-long");
  });

  it("leaves the state exactly as it found it", () => {
    const state = building();
    editor.addMember(state, [0, 0, 0], [0, 2, 0], "strut");
    const structure = currentStructure(state);
    const history = state.history.length;
    aimAt(state, [2, 0, 0]);
    pointerHint(state);
    aimAt(state, [0, 2, 0]);
    setPendingNode(state, { x: 2, y: 0, z: 0 });
    pointerHint(state);
    expect(currentStructure(state)).toBe(structure);
    expect(currentStructure(state).members).toHaveLength(1);
    expect(state.history).toHaveLength(history);
    expect(state.pendingNode).toEqual({ x: 2, y: 0, z: 0 });
  });

  it("speaks for the ring, the counterweight, and the delete tools", () => {
    const state = building();
    state.tool = "ring";
    aimAt(state, [0, 0, 0]);
    expect(pointerHint(state).refusal).toBe("ring-on-ground");
    aimAt(state, [0, 2, 0]);
    expect(pointerHint(state).action).toBe("CLICK TO SET THE SLEW RING HERE");

    editor.addMember(state, [0, 0, 0], [0, 2, 0], "strut");
    state.tool = "counterweight";
    aimAt(state, [0, 2, 0]);
    expect(pointerHint(state).action).toBe(
      "CLICK TO HANG A COUNTERWEIGHT HERE",
    );
    editor.addCounterweight(state, [0, 2, 0]);
    expect(pointerHint(state).action).toBe(
      "CLICK TO TAKE THIS COUNTERWEIGHT OFF",
    );

    state.tool = "delete";
    aimAt(state, [0, 1, 0]);
    expect(pointerHint(state).action).toBe(
      "CLICK TO DELETE WHAT IS UNDER THE POINTER",
    );
  });
});
