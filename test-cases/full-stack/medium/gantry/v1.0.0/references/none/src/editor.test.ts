// The structure editor: picking, the six tools, the edits, and undo.
//
// The projection the picking is measured through belongs to `src/render.ts`,
// which needs a canvas for everything else, so it is mocked here with the
// camera maths that file's contract states: a perspective projection from the
// orbit pose, looking at `CAMERA_TARGET`, at `CAMERA_FOV` over the stage's
// aspect. Two of the tests want a projection they choose node by node, so the
// mock defers to a hook when one is installed.

import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  project: null as
    | null
    | ((
        camera: { yaw: number; pitch: number; dist: number },
        world: readonly [number, number, number],
      ) => { x: number; y: number; visible: boolean }),
  cameraPosition: null as
    | null
    | ((camera: {
        yaw: number;
        pitch: number;
        dist: number;
      }) => readonly [number, number, number]),
}));

vi.mock("./render", async () => {
  const { CAMERA_TARGET, STAGE_H, STAGE_W } = await import("./constants");
  type V = readonly [number, number, number];
  type C = { yaw: number; pitch: number; dist: number };
  const FOV = 45;
  const RAD = Math.PI / 180;
  const target: V = [CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z];
  const diff = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a: V): V => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: V, b: V): V => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const posed = (camera: C): V => [
    target[0] +
      camera.dist * Math.cos(camera.pitch * RAD) * Math.cos(camera.yaw * RAD),
    target[1] + camera.dist * Math.sin(camera.pitch * RAD),
    target[2] +
      camera.dist * Math.cos(camera.pitch * RAD) * Math.sin(camera.yaw * RAD),
  ];
  const eyeOf = (camera: C): V =>
    hooks.cameraPosition ? hooks.cameraPosition(camera) : posed(camera);
  const projected = (
    camera: C,
    world: V,
  ): { x: number; y: number; visible: boolean } => {
    const eye = eyeOf(camera);
    const forward = unit(diff(target, eye));
    const right = unit(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const rel = diff(world, eye);
    const depth = dot3(rel, forward);
    const half = Math.tan((FOV / 2) * RAD);
    const ndcX = dot3(rel, right) / (depth * half * (STAGE_W / STAGE_H));
    const ndcY = dot3(rel, up) / (depth * half);
    return {
      x: ((ndcX + 1) / 2) * STAGE_W,
      y: ((1 - ndcY) / 2) * STAGE_H,
      visible: depth > 0 && Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
    };
  };
  return {
    CAMERA_FOV: FOV,
    cameraPosition: (camera: C): V => eyeOf(camera),
    project: (camera: C, world: V) =>
      hooks.project ? hooks.project(camera, world) : projected(camera, world),
    createRenderer: vi.fn(),
  };
});

import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  MEMBER_PICK_PX,
  NODE_PICK_PX,
} from "./constants";
import {
  addCounterweight,
  addMember,
  applyClick,
  clearRing,
  clearStructure,
  pick,
  removeCounterweight,
  removeMember,
  setRing,
  showCheck,
  undo,
} from "./editor";
import { project } from "./render";
import { nodeKey, type Material, type Member, type Vec3 } from "./sim";
import {
  currentStructure,
  openSite,
  setCamera,
  setPendingNode,
  setScreen,
  setTool,
  titleState,
  type GantryState,
  type SiteStructure,
  type Tool,
} from "./state";

// ---- Fixtures --------------------------------------------------------------

/** Site `0`'s build screen, with nothing built. */
const build = (site = 0): GantryState =>
  setScreen(openSite(titleState(), site), "build");

const atPoint = (state: GantryState, x: number, y: number): GantryState => ({
  ...state,
  pointer: { ...state.pointer, x, y },
});

/** The pointer exactly where a world position is drawn. */
function atNode(state: GantryState, node: Vec3): GantryState {
  const point = project(state.camera, node);
  return atPoint(state, point.x, point.y);
}

const withTool = (state: GantryState, tool: Tool): GantryState =>
  setTool(state, tool);

/** Put a structure on the open site without going through the editor. */
const putStructure = (
  state: GantryState,
  structure: SiteStructure,
): GantryState => ({
  ...state,
  sites: state.sites.map((entry, i) =>
    i === state.siteIndex ? { ...entry, structure } : entry,
  ),
});

const member = (id: number, a: Vec3, b: Vec3, material: Material): Member => ({
  id,
  a,
  b,
  material,
});

/**
 * A projection this test chooses: the listed world positions land on the points
 * given, and everything else lands far off the stage. The camera stands where
 * the test puts it, so the tie-breaks that read a distance from the camera are
 * exact.
 */
function stubView(
  eye: Vec3,
  points: readonly (readonly [Vec3, number, number])[],
): void {
  hooks.cameraPosition = () => eye;
  hooks.project = (_camera, world) => {
    for (const [at, x, y] of points) {
      if (nodeKey(at) === nodeKey(world)) return { x, y, visible: true };
    }
    return { x: 1e6, y: 1e6, visible: false };
  };
}

afterEach(() => {
  hooks.project = null;
  hooks.cameraPosition = null;
});

// ---- Picking ---------------------------------------------------------------

describe("pick", () => {
  it("takes the node the pointer is drawn over", () => {
    const state = atNode(build(), [2, 4, 0]);
    expect(pick(state).node).toEqual([2, 4, 0]);
  });

  it("follows the camera rather than a remembered screen point", () => {
    const first = atNode(build(), [2, 4, 0]);
    expect(pick(first).node).toEqual([2, 4, 0]);
    const turned = setCamera(first, 180, CAMERA_START_PITCH, CAMERA_START_DIST);
    expect(pick(turned).node).not.toEqual([2, 4, 0]);
    expect(pick(atNode(turned, [2, 4, 0])).node).toEqual([2, 4, 0]);
  });

  it("reports nothing on every screen but build", () => {
    const state = atNode(build(), [2, 4, 0]);
    for (const screen of ["title", "select", "program", "run"] as const) {
      expect(pick(setScreen(state, screen))).toEqual({
        node: null,
        member: null,
      });
    }
  });

  it("takes no node past NODE_PICK_PX and none behind the camera", () => {
    stubView([0, 6, 100], [[[0, 0, 0], 100, 100]]);
    expect(pick(atPoint(build(), 100 + NODE_PICK_PX, 100)).node).toEqual([
      0, 0, 0,
    ]);
    expect(pick(atPoint(build(), 100 + NODE_PICK_PX + 0.01, 100)).node).toBe(
      null,
    );
    // The same node, with the camera stood so that it falls behind the eye.
    stubView([0, 6, -2], [[[0, 0, -4], 100, 100]]);
    expect(pick(atPoint(build(), 100, 100)).node).toBe(null);
  });

  it("breaks a node tie by the camera, then by x, then y, then z", () => {
    const state = build();
    stubView(
      [0, 6, 100],
      [
        [[0, 0, 0], 100, 100],
        [[0, 0, 2], 100, 100],
      ],
    );
    expect(pick(atPoint(state, 100, 100)).node).toEqual([0, 0, 2]);

    stubView(
      [0, 6, 100],
      [
        [[-2, 6, 0], 100, 100],
        [[2, 6, 0], 100, 100],
      ],
    );
    expect(pick(atPoint(state, 100, 100)).node).toEqual([-2, 6, 0]);

    stubView(
      [0, 6, 100],
      [
        [[2, 4, 0], 100, 100],
        [[2, 8, 0], 100, 100],
      ],
    );
    expect(pick(atPoint(state, 100, 100)).node).toEqual([2, 4, 0]);

    stubView(
      [40, 6, 0],
      [
        [[0, 6, -2], 100, 100],
        [[0, 6, 2], 100, 100],
      ],
    );
    expect(pick(atPoint(state, 100, 100)).node).toEqual([0, 6, -2]);
  });

  it("takes the member whose projected segment is nearest, within reach", () => {
    const state = putStructure(build(), {
      members: [member(4, [0, 0, 0], [4, 0, 0], "strut")],
      nextMemberId: 5,
      ring: null,
      counterweights: [],
    });
    stubView(
      [0, 6, 100],
      [
        [[0, 0, 0], 100, 100],
        [[4, 0, 0], 140, 100],
      ],
    );
    expect(pick(atPoint(state, 120, 100)).member).toBe(4);
    expect(pick(atPoint(state, 120, 100 + MEMBER_PICK_PX)).member).toBe(4);
    expect(pick(atPoint(state, 120, 100 + MEMBER_PICK_PX + 0.01)).member).toBe(
      null,
    );
    // Off the end of the segment, so the distance is to the end itself.
    expect(pick(atPoint(state, 140 + MEMBER_PICK_PX, 100)).member).toBe(4);
  });

  it("breaks a member tie by the camera, then by the lower id", () => {
    const nearer = putStructure(build(), {
      members: [
        member(0, [0, 0, 0], [4, 0, 0], "strut"),
        member(1, [0, 0, 4], [4, 0, 4], "strut"),
      ],
      nextMemberId: 2,
      ring: null,
      counterweights: [],
    });
    stubView(
      [0, 6, 100],
      [
        [[0, 0, 0], 100, 100],
        [[4, 0, 0], 140, 100],
        [[0, 0, 4], 100, 100],
        [[4, 0, 4], 140, 100],
      ],
    );
    expect(pick(atPoint(nearer, 120, 100)).member).toBe(1);

    const same = putStructure(build(), {
      members: [
        member(7, [0, 0, 0], [4, 0, 0], "strut"),
        member(3, [0, 0, 0], [4, 0, 0], "strut"),
      ],
      nextMemberId: 8,
      ring: null,
      counterweights: [],
    });
    expect(pick(atPoint(same, 120, 100)).member).toBe(3);
  });
});

// ---- The tools -------------------------------------------------------------

describe("the member tools", () => {
  it("holds the first node and places on the second", () => {
    let state = atNode(build(), [0, 0, 0]);
    const first = applyClick(state);
    expect(first.cue).toBe(null);
    expect(first.state.pendingNode).toEqual([0, 0, 0]);
    expect(currentStructure(first.state).members).toHaveLength(0);
    expect(first.state.history).toHaveLength(0);

    state = atNode(first.state, [0, 2, 0]);
    const second = applyClick(state);
    expect(second.cue).toBe("place");
    expect(second.refusal).toBe(null);
    expect(second.state.pendingNode).toBe(null);
    expect(currentStructure(second.state).members).toEqual([
      { id: 0, a: [0, 0, 0], b: [0, 2, 0], material: "strut" },
    ]);
    expect(currentStructure(second.state).nextMemberId).toBe(1);
    expect(second.state.history).toHaveLength(1);
  });

  it("clears the pending node on a click on the pending node itself", () => {
    const held = setPendingNode(build(), [0, 0, 0]);
    const outcome = applyClick(atNode(held, [0, 0, 0]));
    expect(outcome.state.pendingNode).toBe(null);
    expect(outcome.cue).toBe(null);
    expect(currentStructure(outcome.state).members).toHaveLength(0);
    expect(outcome.state.history).toHaveLength(0);
  });

  it("keeps the pending node when the rules refuse the placement", () => {
    const held = setPendingNode(build(), [0, 0, 0]);
    const outcome = applyClick(atNode(held, [0, 12, 0]));
    expect(outcome.refusal).toBe("too-long");
    expect(outcome.cue).toBe(null);
    expect(outcome.state.pendingNode).toEqual([0, 0, 0]);
    expect(currentStructure(outcome.state).members).toHaveLength(0);
    expect(outcome.state.history).toHaveLength(0);
  });

  it("carries the pending node across a tool switch", () => {
    const held = withTool(setPendingNode(build(), [0, 0, 0]), "cable");
    const outcome = applyClick(atNode(held, [0, 6, 0]));
    expect(outcome.cue).toBe("place");
    expect(currentStructure(outcome.state).members[0].material).toBe("cable");
  });

  it("does nothing with no node in range", () => {
    stubView([0, 6, 100], []);
    const state = atPoint(build(), 100, 100);
    expect(applyClick(state)).toEqual({
      state,
      cue: null,
      refusal: null,
    });
  });

  it("does nothing on any screen but build", () => {
    const state = setScreen(atNode(build(), [0, 0, 0]), "program");
    expect(applyClick(state).state.pendingNode).toBe(null);
  });
});

describe("the ring and counterweight tools", () => {
  it("places the ring by its base corner and leaves a pending node held", () => {
    const held = withTool(setPendingNode(build(), [0, 0, 0]), "ring");
    const outcome = applyClick(atNode(held, [0, 4, 0]));
    expect(outcome.cue).toBe("place");
    expect(currentStructure(outcome.state).ring).toEqual({
      corner: [0, 4, 0],
    });
    expect(outcome.state.pendingNode).toEqual([0, 0, 0]);
    expect(outcome.state.history).toHaveLength(1);
  });

  it("refuses a second ring, and shows why", () => {
    const one = applyClick(atNode(withTool(build(), "ring"), [0, 4, 0])).state;
    const two = applyClick(atNode(one, [4, 4, 4]));
    expect(two.refusal).toBe("ring-exists");
    expect(two.cue).toBe(null);
    expect(currentStructure(two.state).ring).toEqual({ corner: [0, 4, 0] });
    expect(two.state.history).toHaveLength(1);
  });

  it("toggles a counterweight on a used node", () => {
    const built = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    const tool = withTool(built, "counterweight");
    const placed = applyClick(atNode(tool, [0, 2, 0]));
    expect(placed.cue).toBe("place");
    expect(currentStructure(placed.state).counterweights).toEqual([[0, 2, 0]]);

    const removed = applyClick(atNode(placed.state, [0, 2, 0]));
    expect(removed.cue).toBe("delete");
    expect(currentStructure(removed.state).counterweights).toEqual([]);
    expect(removed.state.history).toHaveLength(3);
  });

  it("refuses a counterweight on a node the structure does not use", () => {
    const tool = withTool(build(), "counterweight");
    const outcome = applyClick(atNode(tool, [0, 2, 0]));
    expect(outcome.refusal).toBe("node-unused");
    expect(outcome.state.history).toHaveLength(0);
  });
});

describe("the delete tool", () => {
  it("removes the member under the pointer", () => {
    const built = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    const outcome = applyClick(atNode(withTool(built, "delete"), [0, 2, 0]));
    expect(outcome.cue).toBe("delete");
    expect(currentStructure(outcome.state).members).toEqual([]);
    // No removal gives an id back.
    expect(currentStructure(outcome.state).nextMemberId).toBe(1);
  });

  it("prefers the member, then the counterweight, then the ring", () => {
    const base = putStructure(build(), {
      members: [member(0, [0, 0, 0], [0, 2, 0], "strut")],
      nextMemberId: 1,
      ring: { corner: [4, 2, 4] },
      counterweights: [[4, 2, 4]],
    });
    const project = (): void =>
      stubView(
        [0, 6, 100],
        [
          [[0, 0, 0], 100, 100],
          [[0, 2, 0], 100, 100],
          [[4, 2, 4], 100, 100],
        ],
      );
    project();
    const tool = withTool(atPoint(base, 100, 100), "delete");

    const first = applyClick(tool);
    expect(currentStructure(first.state).members).toEqual([]);
    expect(currentStructure(first.state).counterweights).toHaveLength(1);
    expect(currentStructure(first.state).ring).not.toBe(null);

    const second = applyClick(first.state);
    expect(currentStructure(second.state).counterweights).toEqual([]);
    expect(currentStructure(second.state).ring).not.toBe(null);

    const third = applyClick(second.state);
    expect(currentStructure(third.state).ring).toBe(null);
    expect(third.cue).toBe("delete");

    expect(applyClick(third.state).state).toBe(third.state);
  });

  it("removes nothing with everything out of reach", () => {
    const built = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    stubView([0, 6, 100], []);
    const state = withTool(atPoint(built, 100, 100), "delete");
    expect(applyClick(state).state).toBe(state);
  });
});

// ---- The edits themselves ---------------------------------------------------

describe("the edits", () => {
  it("gives every member a new id and never hands one back", () => {
    let state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    state = addMember(state, [0, 2, 0], [0, 4, 0], "strut").state;
    expect(currentStructure(state).nextMemberId).toBe(2);
    state = removeMember(state, 0).state;
    expect(currentStructure(state).nextMemberId).toBe(2);
    state = addMember(state, [0, 0, 0], [0, 2, 0], "strut").state;
    expect(currentStructure(state).members.map((m) => m.id)).toEqual([1, 2]);
  });

  it("refuses an edit the rules refuse and pushes no history", () => {
    const state = build();
    const outside = addMember(state, [0, 0, 0], [0, 2, 20], "strut");
    expect(outside.refusal).toBe("outside-envelope");
    expect(outside.state).toBe(state);
    expect(outside.state.history).toHaveLength(0);
  });

  it("is silent when a removal has nothing to remove", () => {
    const state = build();
    for (const outcome of [
      removeMember(state, 3),
      clearRing(state),
      removeCounterweight(state, [0, 0, 0]),
      clearStructure(state),
    ]) {
      expect(outcome).toEqual({ state, cue: null, refusal: null });
      expect(outcome.state.history).toHaveLength(0);
    }
  });

  it("empties the structure whole and returns the id to zero", () => {
    let state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    state = setRing(state, [4, 4, 4]).state;
    state = addCounterweight(state, [4, 4, 4]).state;
    const outcome = clearStructure(state);
    expect(outcome.cue).toBe("delete");
    expect(currentStructure(outcome.state)).toEqual({
      members: [],
      nextMemberId: 0,
      ring: null,
      counterweights: [],
    });
    expect(outcome.state.history).toHaveLength(4);
  });

  it("returns the id to zero on an empty structure without pushing history", () => {
    let state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    state = removeMember(state, 0).state;
    expect(currentStructure(state).nextMemberId).toBe(1);
    const depth = state.history.length;
    const outcome = clearStructure(state);
    expect(outcome.cue).toBe(null);
    expect(currentStructure(outcome.state).nextMemberId).toBe(0);
    expect(outcome.state.history).toHaveLength(depth);
  });
});

// ---- Undo -------------------------------------------------------------------

describe("undo", () => {
  it("restores the structure as it stood before the last edit", () => {
    let state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    state = addMember(state, [0, 2, 0], [0, 4, 0], "strut").state;
    const outcome = undo(state);
    expect(outcome.cue).toBe("delete");
    expect(currentStructure(outcome.state).members.map((m) => m.id)).toEqual([
      0,
    ]);
    expect(outcome.state.history).toHaveLength(1);
    // An undone placement gives no id back.
    expect(currentStructure(outcome.state).nextMemberId).toBe(2);
  });

  it("goes back as far as the site was opened and no further", () => {
    let state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    state = setRing(state, [4, 4, 4]).state;
    state = undo(state).state;
    state = undo(state).state;
    expect(currentStructure(state).members).toEqual([]);
    expect(currentStructure(state).ring).toBe(null);
    expect(state.history).toHaveLength(0);
    const outcome = undo(state);
    expect(outcome).toEqual({ state, cue: null, refusal: null });
  });

  it("restores a member with the id it was placed with", () => {
    let state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    state = addMember(state, [0, 2, 0], [0, 4, 0], "strut").state;
    state = removeMember(state, 0).state;
    state = undo(state).state;
    expect(currentStructure(state).members.map((m) => m.id)).toEqual([0, 1]);
    state = addMember(state, [0, 4, 0], [0, 6, 0], "strut").state;
    expect(currentStructure(state).members.map((m) => m.id)).toEqual([0, 1, 2]);
  });

  it("keeps ids unique across an undone clearStructure", () => {
    let state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    state = addMember(state, [0, 2, 0], [0, 4, 0], "strut").state;
    state = clearStructure(state).state;
    expect(currentStructure(state).nextMemberId).toBe(0);
    state = undo(state).state;
    expect(currentStructure(state).members.map((m) => m.id)).toEqual([0, 1]);
    state = addMember(state, [0, 4, 0], [0, 6, 0], "strut").state;
    expect(currentStructure(state).members.map((m) => m.id)).toEqual([0, 1, 2]);
  });

  it("leaves the pending node held", () => {
    const state = setPendingNode(
      addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state,
      [4, 0, 0],
    );
    expect(undo(state).state.pendingNode).toEqual([4, 0, 0]);
  });

  it("keeps the history the site opened with, per site", () => {
    const state = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    expect(openSite(state, 1).history).toHaveLength(0);
  });
});

// ---- The static check -------------------------------------------------------

describe("showCheck", () => {
  it("shows what the check found", () => {
    const result = showCheck(build()).checkResult;
    expect(result).not.toBe(null);
    expect(result?.issues).toEqual(["no-ring", "no-rail", "empty-program"]);
    expect(result?.stable).toBe(false);
    expect(result?.members).toEqual([]);
    expect(result?.budget).toBe(3000);
  });

  it("stops showing once the structure changes", () => {
    const shown = showCheck(build());
    expect(shown.checkResult).not.toBe(null);
    const edited = addMember(shown, [0, 0, 0], [0, 2, 0], "strut");
    expect(edited.state.checkResult).toBe(null);
  });

  it("keeps showing when an edit is refused", () => {
    const shown = showCheck(build());
    const refused = addMember(shown, [0, 0, 0], [0, 40, 0], "strut");
    expect(refused.refusal).not.toBe(null);
    expect(refused.state.checkResult).toBe(shown.checkResult);
  });

  it("keeps showing when an undo restores the structure", () => {
    const built = addMember(build(), [0, 0, 0], [0, 2, 0], "strut").state;
    const shown = showCheck(built);
    expect(undo(shown).state.checkResult).toBe(null);
  });
});
