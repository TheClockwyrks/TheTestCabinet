import { beforeEach, describe, expect, it, vi } from "vitest";

// The debug surface is tested against the seams it poses through rather than
// through them: the structure editor and the projection are stubbed here, so
// what is under test is the surface's own domain checks, screen gating, and
// reporting.
vi.mock("./editor", () => {
  const passthrough = (state: unknown) => ({
    state,
    cue: null,
    refusal: null,
  });
  return {
    pick: vi.fn(() => ({ node: null, member: null })),
    applyClick: vi.fn(passthrough),
    addMember: vi.fn(passthrough),
    removeMember: vi.fn(passthrough),
    setRing: vi.fn(passthrough),
    clearRing: vi.fn(passthrough),
    addCounterweight: vi.fn(passthrough),
    removeCounterweight: vi.fn(passthrough),
    clearStructure: vi.fn(passthrough),
    undo: vi.fn(passthrough),
    showCheck: vi.fn((state: unknown) => state),
  };
});

vi.mock("./render", () => ({
  CAMERA_FOV: 45,
  cameraPosition: vi.fn(),
  project: vi.fn(() => ({ x: 640, y: 360, visible: true })),
  createRenderer: vi.fn(),
}));

import { Game } from "./app";
import {
  CAMERA_DIST_MAX,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CLICK_SLOP,
  GANTRY_DEBUG_VERSION,
  HOIST_START,
  ORBIT_KEY_RATE,
  ORBIT_PER_PX,
  RUN_SPEEDS,
  SITE_COUNT,
  TICK_HZ,
  ZOOM_RATE,
  type ActionName,
  type CueName,
} from "./constants";
import { createDebugSurface, type GantryDebugApi } from "./debug";
import * as editor from "./editor";
import { project } from "./render";
import {
  SIM_SITES,
  type CheckResult,
  type Material,
  type TapeStep,
  type Vec3,
} from "./sim";
import type { Runtime, StagePointerEvent } from "./runtime";

// ---- A runtime that records instead of drawing, sounding, or listening -----

interface Harness {
  runtime: Runtime;
  game: Game;
  debug: GantryDebugApi;
  cues: CueName[];
  keys: string[];
  draws: number;
  motor(): boolean;
  diagnostics(): readonly string[];
  press(action: ActionName): void;
  hold(action: ActionName, down: boolean): void;
}

function harness(): Harness {
  const cues: CueName[] = [];
  const keys: string[] = [];
  let actions: ActionName[] = [];
  let pointer: StagePointerEvent[] = [];
  let muted = false;
  let motorOn = false;
  let px = 0;
  let py = 0;
  let source: () => readonly string[] = () => [];
  const down = new Set<ActionName>();

  const runtime: Runtime = {
    takeInput() {
      const frame = { actions, pointer };
      actions = [];
      pointer = [];
      return frame;
    },
    held: (action) => down.has(action),
    pointerX: () => px,
    pointerY: () => py,
    feedKeyDown(code) {
      keys.push(`down ${code}`);
    },
    feedKeyUp(code) {
      keys.push(`up ${code}`);
    },
    feedPointerMove(x, y) {
      px = x;
      py = y;
      pointer.push({ kind: "move", x, y });
    },
    feedPointerDown(x, y) {
      px = x;
      py = y;
      pointer.push({ kind: "down", x, y });
    },
    feedPointerUp() {
      pointer.push({ kind: "up", x: px, y: py });
    },
    playCue(cue) {
      cues.push(cue);
    },
    setMotor(on) {
      motorOn = on;
    },
    isMuted: () => muted,
    toggleMute() {
      muted = !muted;
    },
    installAudio() {},
    setDiagnostics(next) {
      source = next;
    },
  };

  const state = { draws: 0 };
  const game = new Game({
    runtime,
    draw: () => {
      state.draws += 1;
    },
  });
  return {
    runtime,
    game,
    debug: createDebugSurface(game),
    cues,
    keys,
    get draws() {
      return state.draws;
    },
    motor: () => motorOn,
    diagnostics: () => source(),
    press(action) {
      actions.push(action);
    },
    hold(action, isDown) {
      if (isDown) down.add(action);
      else down.delete(action);
    },
  };
}

// ---- A crane site 1 finds ready, stable, and worth a few ticks -------------

const strut = "strut" as Material;
const rail = "rail" as Material;
const cable = "cable" as Material;

const CRANE: [Vec3, Vec3, Material][] = [
  [[0, 0, 0], [0, 2, 0], strut],
  [[2, 0, 0], [2, 2, 0], strut],
  [[0, 0, 2], [0, 2, 2], strut],
  [[2, 0, 2], [2, 2, 2], strut],
  [[0, 2, 0], [2, 2, 0], strut],
  [[0, 2, 2], [2, 2, 2], strut],
  [[0, 2, 0], [0, 2, 2], strut],
  [[2, 2, 0], [2, 2, 2], strut],
  [[0, 2, 0], [2, 2, 2], strut],
  [[2, 2, 0], [0, 2, 2], strut],
  [[0, 0, 0], [2, 2, 0], strut],
  [[0, 0, 2], [2, 2, 2], strut],
  [[0, 0, 0], [0, 2, 2], strut],
  [[2, 0, 0], [2, 2, 2], strut],
  [[0, 4, 0], [2, 4, 0], strut],
  [[0, 4, 2], [2, 4, 2], strut],
  [[0, 4, 0], [0, 4, 2], strut],
  [[2, 4, 0], [2, 4, 2], strut],
  [[0, 4, 0], [2, 4, 2], strut],
  [[2, 4, 0], [0, 4, 2], strut],
  [[2, 4, 0], [4, 4, 0], rail],
  [[4, 4, 0], [6, 4, 0], rail],
  [[2, 4, 2], [4, 4, 0], strut],
  [[2, 4, 2], [4, 4, 2], strut],
  [[4, 4, 2], [6, 4, 0], strut],
  [[4, 4, 0], [4, 4, 2], strut],
  [[0, 4, 0], [0, 8, 0], strut],
  [[0, 4, 2], [0, 8, 0], strut],
  [[2, 4, 0], [0, 8, 0], strut],
  [[2, 4, 2], [0, 8, 0], strut],
  [[0, 8, 0], [4, 4, 0], cable],
  [[0, 8, 0], [6, 4, 0], cable],
  [[0, 8, 0], [4, 4, 2], cable],
];

const DEFAULT_TAPE: TapeStep[] = [
  { kind: "move", commands: [{ axis: "trolley", target: 4, rate: 2 }] },
  { kind: "move", commands: [{ axis: "slew", target: 45, rate: 20 }] },
];

/** Put the crane and a tape on the open site, past the editor. */
function rig(game: Game, tape: TapeStep[] = DEFAULT_TAPE): void {
  const members = CRANE.map(([a, b, material], id) => ({ id, a, b, material }));
  const state = game.state;
  game.state = {
    ...state,
    sites: state.sites.map((entry, i) =>
      i === state.siteIndex
        ? {
            structure: {
              members,
              nextMemberId: members.length,
              ring: { corner: [0, 2, 0] as Vec3 },
              counterweights: [],
            },
            program: tape,
          }
        : entry,
    ),
  };
}

let h: Harness;

beforeEach(() => {
  vi.clearAllMocks();
  h = harness();
});

describe("the surface", () => {
  it("carries its version", () => {
    expect(h.debug.version).toBe(GANTRY_DEBUG_VERSION);
    expect(h.debug.version).toBe(1);
  });

  it("installs nothing until it is called", () => {
    expect(h.cues).toEqual([]);
    expect(h.draws).toBe(0);
  });
});

describe("the snapshot", () => {
  it("reports the whole shape at its resting values", () => {
    const s = h.debug.snapshot();
    expect(s.version).toBe(GANTRY_DEBUG_VERSION);
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.siteIndex).toBe(0);
    expect(s.cleared).toEqual(new Array(SITE_COUNT).fill(false));
    expect(s.best).toEqual(new Array(SITE_COUNT).fill(null));
    expect(s.tool).toBe("strut");
    expect(s.pendingNode).toBeNull();
    expect(s.historyDepth).toBe(0);
    expect(s.camera).toEqual({
      yaw: CAMERA_START_YAW,
      pitch: CAMERA_START_PITCH,
      dist: CAMERA_START_DIST,
    });
    expect(s.pointer).toEqual({
      x: 0,
      y: 0,
      down: false,
      pressX: 0,
      pressY: 0,
      dragging: false,
    });
    expect(s.pick).toEqual({ node: null, member: null });
    expect(s.structure).toEqual({
      members: [],
      nextMemberId: 0,
      ring: null,
      counterweights: [],
      cost: 0,
      issues: ["no-ring", "no-rail"],
    });
    expect(s.program).toEqual([]);
    expect(s.checkResult).toBeNull();
    expect(s.muted).toBe(false);
    expect(s.simTime).toBe(0);
    expect(s.run).toEqual({
      phase: "idle",
      cause: null,
      tick: 0,
      time: 0,
      speedIndex: 0,
      stepIndex: 0,
      stepLive: false,
      axes: {
        slew: { value: 0, rate: 0, command: null },
        trolley: { value: 0, rate: 0, command: null },
        hoist: { value: HOIST_START, rate: 0, command: null },
        grip: { value: 0, rate: 0, command: null },
      },
      pivot: { x: 0, y: 0, z: 0 },
      bob: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
      attached: null,
      loads: [],
      forces: [],
      broken: [],
    });
  });

  it("reports the open site's own figures", () => {
    const s = h.debug.snapshot();
    const authored = SIM_SITES[0];
    expect(s.site.name).toBe(authored.name);
    expect(s.site.budget).toBe(authored.budget);
    expect(s.site.par).toEqual(authored.par);
    expect(s.site.anchors).toHaveLength(authored.anchors.length);
    expect(s.site.anchors[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.site.envelope.min).toEqual({ x: -8, y: 0, z: -8 });
    expect(s.site.loads[0].class).toBe("crate");
    expect(s.site.loads[0].from).toEqual({ x: 10, y: 2, z: 0, yaw: 0 });
    expect(s.site.obstacles).toEqual([]);
  });

  it("reports an obstacle as its minimum corner and its size", () => {
    h.debug.openSite(2);
    const s = h.debug.snapshot();
    expect(s.site.obstacles).toEqual([
      { min: { x: 5, y: 0, z: -6 }, size: { x: 1, y: 8, z: 12 } },
    ]);
  });

  it("reports what the picker found on the build screen alone", () => {
    vi.mocked(editor.pick).mockReturnValue({ node: [2, 0, 4], member: 7 });
    expect(h.debug.snapshot().pick).toEqual({ node: null, member: null });
    h.debug.openSite(0);
    expect(h.debug.snapshot().pick).toEqual({
      node: { x: 2, y: 0, z: 4 },
      member: 7,
    });
  });
});

describe("the domains", () => {
  it("refuses an argument outside its domain", () => {
    expect(() => h.debug.setScreen("nowhere")).toThrow();
    expect(() => h.debug.openSite(SITE_COUNT)).toThrow();
    expect(() => h.debug.openSite(-1)).toThrow();
    expect(() => h.debug.openSite(1.5)).toThrow();
    expect(() => h.debug.setCleared(0, 1 as unknown as boolean)).toThrow();
    expect(() => h.debug.setBest(0, Number.NaN, 1)).toThrow();
    expect(() => h.debug.setCamera(0, 0, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => h.debug.setTool("hammer")).toThrow();
    expect(() => h.debug.setAxis("elbow", 0)).toThrow();
    expect(() => h.debug.addActionStep("grab")).toThrow();
    expect(() => h.debug.addLoad("barrel", 1, 0, 0, 0, 0)).toThrow();
    expect(() => h.debug.setLoadPhase(0, "hovering")).toThrow();
    expect(() => h.debug.advance(-1)).toThrow();
    expect(() => h.debug.setSpeedIndex(RUN_SPEEDS.length)).toThrow();
    expect(() => h.debug.keyDown("")).toThrow();
  });

  it("refuses a coordinate that is not a lattice node", () => {
    h.debug.openSite(0);
    expect(() => h.debug.setRing(1, 2, 0)).toThrow();
    expect(() => h.debug.addCounterweight(0, 2.5, 0)).toThrow();
    expect(() => h.debug.setPendingNode(0, 0, 3)).toThrow();
    expect(() => h.debug.addMember(0, 0, 0, 0, 1, 0, "strut")).toThrow();
    expect(vi.mocked(editor.setRing)).not.toHaveBeenCalled();
    // A node on the pitch is fine, negatives included.
    h.debug.setPendingNode(-4, 0, 2);
    expect(h.debug.snapshot().pendingNode).toEqual({ x: -4, y: 0, z: 2 });
  });

  it("refuses an index or a member id nothing carries", () => {
    h.debug.openSite(0);
    expect(() => h.debug.removeMember(0)).toThrow();
    expect(() => h.debug.setLoadTarget(1, 0, 0, 0, 0)).toThrow();
    h.debug.setScreen("program");
    expect(() => h.debug.removeStep(0)).toThrow();
    expect(() => h.debug.addCommand(0, "slew", 0, 1)).toThrow();
  });

  it("takes the menu index only inside the menu showing", () => {
    expect(() => h.debug.setMenuIndex(2)).toThrow();
    h.debug.setMenuIndex(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    h.debug.setScreen("select");
    h.debug.setMenuIndex(5);
    expect(h.debug.snapshot().menuIndex).toBe(5);
    expect(() => h.debug.setMenuIndex(6)).toThrow();
    // A screen with no menu does nothing, whatever the index.
    h.debug.setScreen("build");
    h.debug.setMenuIndex(99);
    expect(h.debug.snapshot().menuIndex).toBe(5);
  });
});

describe("the screens and the run", () => {
  it("shows a screen and sets nothing else", () => {
    h.debug.setScreen("select");
    h.debug.setMenuIndex(3);
    h.debug.setScreen("howto");
    const s = h.debug.snapshot();
    expect(s.screen).toBe("howto");
    expect(s.menuIndex).toBe(3);
    expect(s.siteIndex).toBe(0);
  });

  it("opens a site, locked or not, and shows the build screen", () => {
    h.debug.setCamera(200, 60, 70);
    h.debug.openSite(5);
    const s = h.debug.snapshot();
    expect(s.screen).toBe("build");
    expect(s.siteIndex).toBe(5);
    expect(s.site.name).toBe(SIM_SITES[5].name);
    expect(s.site.loads).toHaveLength(SIM_SITES[5].loads.length);
    expect(s.camera).toEqual({
      yaw: CAMERA_START_YAW,
      pitch: CAMERA_START_PITCH,
      dist: CAMERA_START_DIST,
    });
    expect(s.historyDepth).toBe(0);
  });

  it("records progress and scores apart from one another", () => {
    h.debug.setCleared(2, true);
    h.debug.setBest(2, 1234, 56.5);
    let s = h.debug.snapshot();
    expect(s.cleared[2]).toBe(true);
    expect(s.best[2]).toEqual({ cost: 1234, time: 56.5 });
    // `setBest` records whatever it is given, however the site stood.
    h.debug.setBest(2, 9999, 999);
    expect(h.debug.snapshot().best[2]).toEqual({ cost: 9999, time: 999 });
    h.debug.clearBest(2);
    s = h.debug.snapshot();
    expect(s.best[2]).toBeNull();
    expect(s.cleared[2]).toBe(true);
  });

  it("poses the camera as the orbit controls do", () => {
    h.debug.setCamera(-45, 120, 500);
    expect(h.debug.snapshot().camera).toEqual({
      yaw: 315,
      pitch: 80,
      dist: CAMERA_DIST_MAX,
    });
  });

  it("refuses a start the `run` action refuses, silently", () => {
    h.debug.openSite(0);
    h.debug.startRun();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("build");
    expect(s.run.phase).toBe("idle");
    expect(h.cues).toEqual([]);
  });

  it("starts the ordinary run, with nothing ticked at the call", () => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.startRun();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("run");
    expect(s.run.phase).toBe("running");
    expect(s.run.tick).toBe(0);
    expect(s.run.time).toBe(0);
    expect(s.run.speedIndex).toBe(0);
    expect(s.run.stepLive).toBe(false);
    expect(s.run.pivot).toEqual({ x: 2, y: 4, z: 0 });
    expect(s.run.bob.pos).toEqual({ x: 2, y: 4 - HOIST_START, z: 0 });
    expect(s.run.loads).toHaveLength(1);
    expect(s.run.loads[0].phase).toBe("waiting");
    expect(h.cues).toEqual(["run-start"]);
  });

  it("does not start from a screen the `run` action has no reach on", () => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.setScreen("title");
    h.debug.startRun();
    expect(h.debug.snapshot().run.phase).toBe("idle");
  });

  it("aborts a run in progress with no verdict", () => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.startRun();
    h.debug.advance(5);
    h.debug.abortRun();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("build");
    expect(s.run.phase).toBe("idle");
    expect(s.run.tick).toBe(0);
  });
});

describe("reset", () => {
  it("restores every field but `muted`", () => {
    h.debug.openSite(3);
    h.debug.setCleared(1, true);
    h.debug.setBest(1, 10, 20);
    h.debug.setCamera(100, 50, 30);
    h.debug.setTool("rail");
    h.debug.setPendingNode(0, 2, 0);
    h.debug.setScreen("program");
    h.debug.addActionStep("attach");
    h.runtime.toggleMute();
    h.game.frame(1 / TICK_HZ);
    expect(h.debug.snapshot().muted).toBe(true);

    h.debug.reset();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.siteIndex).toBe(0);
    expect(s.cleared.every((c) => !c)).toBe(true);
    expect(s.best.every((b) => b === null)).toBe(true);
    expect(s.site.loads).toHaveLength(SIM_SITES[0].loads.length);
    expect(s.site.loads[0].from).toEqual({ x: 10, y: 2, z: 0, yaw: 0 });
    expect(s.tool).toBe("strut");
    expect(s.pendingNode).toBeNull();
    expect(s.historyDepth).toBe(0);
    expect(s.checkResult).toBeNull();
    expect(s.program).toEqual([]);
    expect(s.camera.yaw).toBe(CAMERA_START_YAW);
    expect(s.run.phase).toBe("idle");
    expect(s.simTime).toBe(0);
    // The one field left alone: a player's preference is not a game fact.
    expect(s.muted).toBe(true);
  });
});

describe("the readings", () => {
  it("computes the check on the spot and displays nothing", () => {
    h.debug.openSite(0);
    const shown: CheckResult = {
      issues: ["no-rail"],
      cost: 1,
      budget: 2,
      stable: false,
      members: [],
    };
    h.game.state = { ...h.game.state, checkResult: shown };
    const result = h.debug.check();
    expect(result.issues).toEqual(["no-ring", "no-rail", "empty-program"]);
    expect(result.budget).toBe(SIM_SITES[0].budget);
    expect(result.stable).toBe(false);
    expect(result.members).toEqual([]);
    expect(h.debug.snapshot().checkResult).toEqual(shown);
  });

  it("projects a world position through the camera as it stands", () => {
    const point = h.debug.project(1, 2, 3);
    expect(point).toEqual({ x: 640, y: 360, visible: true });
    expect(vi.mocked(project)).toHaveBeenCalledWith(
      h.game.state.camera,
      [1, 2, 3],
    );
    expect(() => h.debug.project(Number.NaN, 0, 0)).toThrow();
  });
});

describe("the structure poses", () => {
  it("reach the editor's rule pipeline with the arguments as read", () => {
    h.debug.openSite(0);
    h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
    expect(vi.mocked(editor.addMember)).toHaveBeenCalledWith(
      h.game.state,
      [0, 0, 0],
      [0, 2, 0],
      "strut",
    );
    h.debug.setRing(0, 2, 0);
    expect(vi.mocked(editor.setRing)).toHaveBeenCalledWith(
      h.game.state,
      [0, 2, 0],
    );
    h.debug.addCounterweight(2, 2, 0);
    expect(vi.mocked(editor.addCounterweight)).toHaveBeenCalled();
    h.debug.removeCounterweight(2, 2, 0);
    expect(vi.mocked(editor.removeCounterweight)).toHaveBeenCalled();
    h.debug.clearRing();
    expect(vi.mocked(editor.clearRing)).toHaveBeenCalled();
    h.debug.clearStructure();
    expect(vi.mocked(editor.clearStructure)).toHaveBeenCalled();
  });

  it("plays the cue the edit raises", () => {
    h.debug.openSite(0);
    vi.mocked(editor.setRing).mockImplementation((state) => ({
      state,
      cue: "place",
      refusal: null,
    }));
    h.debug.setRing(0, 2, 0);
    expect(h.cues).toEqual(["place"]);
  });

  it("apply on the build screen and nowhere else", () => {
    h.debug.openSite(0);
    h.debug.setScreen("program");
    h.debug.setRing(0, 2, 0);
    h.debug.clearStructure();
    h.debug.setTool("cable");
    h.debug.setPendingNode(0, 2, 0);
    h.debug.clearPendingNode();
    expect(vi.mocked(editor.setRing)).not.toHaveBeenCalled();
    expect(vi.mocked(editor.clearStructure)).not.toHaveBeenCalled();
    const s = h.debug.snapshot();
    expect(s.tool).toBe("strut");
    expect(s.pendingNode).toBeNull();
  });
});

describe("the tape poses", () => {
  beforeEach(() => {
    h.debug.openSite(0);
    h.debug.setScreen("program");
  });

  it("append, extend, and remove steps under the editor's rules", () => {
    h.debug.addMoveStep("slew", 90, 30);
    h.debug.addCommand(0, "hoist", 6, 4);
    h.debug.addActionStep("attach");
    expect(h.debug.snapshot().program).toEqual([
      {
        kind: "move",
        commands: [
          { axis: "slew", target: 90, rate: 30 },
          { axis: "hoist", target: 6, rate: 4 },
        ],
      },
      { kind: "action", action: "attach" },
    ]);
    h.debug.removeStep(0);
    expect(h.debug.snapshot().program).toEqual([
      { kind: "action", action: "attach" },
    ]);
    h.debug.clearProgram();
    expect(h.debug.snapshot().program).toEqual([]);
  });

  it("are refused silently where the editor refuses them", () => {
    h.debug.addMoveStep("slew", 90, 0);
    expect(h.debug.snapshot().program).toEqual([]);
    h.debug.addMoveStep("slew", 90, 1000);
    expect(h.debug.snapshot().program).toEqual([]);
    h.debug.addMoveStep("slew", 90, 30);
    h.debug.addCommand(0, "slew", 10, 5);
    expect(h.debug.snapshot().program[0]).toEqual({
      kind: "move",
      commands: [{ axis: "slew", target: 90, rate: 30 }],
    });
  });

  it("do nothing off the program screen", () => {
    h.debug.setScreen("build");
    h.debug.addActionStep("release");
    expect(h.debug.snapshot().program).toEqual([]);
  });
});

describe("the site poses", () => {
  it("hold only what a scenario is about", () => {
    h.debug.openSite(4);
    h.debug.clearLoads();
    h.debug.clearObstacles();
    h.debug.addLoad("drum", 120, 7, 3, 0, 0);
    h.debug.setLoadTarget(0, -7, 3, 0, 90);
    h.debug.addObstacle(5, 0, -6, 1, 8, 12);
    const s = h.debug.snapshot();
    expect(s.site.loads).toEqual([
      {
        class: "drum",
        mass: 120,
        from: { x: 7, y: 3, z: 0, yaw: 0 },
        to: { x: -7, y: 3, z: 0, yaw: 90 },
      },
    ]);
    expect(s.site.obstacles).toEqual([
      { min: { x: 5, y: 0, z: -6 }, size: { x: 1, y: 8, z: 12 } },
    ]);
    // The site's own figures are not the yard's, so they stand as they were.
    expect(s.site.budget).toBe(SIM_SITES[4].budget);
    expect(s.site.name).toBe(SIM_SITES[4].name);
  });

  it("put the authored set back on a reopen", () => {
    h.debug.openSite(2);
    h.debug.clearObstacles();
    expect(h.debug.snapshot().site.obstacles).toEqual([]);
    h.debug.openSite(2);
    expect(h.debug.snapshot().site.obstacles).toHaveLength(1);
  });

  it("do nothing with a run in progress", () => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.startRun();
    h.debug.clearLoads();
    expect(h.debug.snapshot().site.loads).toHaveLength(1);
  });
});

describe("the run poses", () => {
  beforeEach(() => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.startRun();
  });

  it("set what they name and leave the rest of the run", () => {
    h.debug.setAxis("slew", 30);
    h.debug.setAxisRate("hoist", -2);
    h.debug.setBob(1, 2, 3);
    h.debug.setBobVelocity(0, -1, 0);
    h.debug.setLoadPose(0, 4, 2, 1, 15);
    const s = h.debug.snapshot();
    expect(s.run.axes.slew).toEqual({ value: 30, rate: 0, command: null });
    expect(s.run.axes.hoist.rate).toBe(-2);
    expect(s.run.axes.hoist.value).toBe(HOIST_START);
    expect(s.run.bob).toEqual({
      pos: { x: 1, y: 2, z: 3 },
      vel: { x: 0, y: -1, z: 0 },
    });
    expect(s.run.loads[0]).toEqual({
      phase: "waiting",
      pos: { x: 4, y: 2, z: 1 },
      yaw: 15,
    });
    expect(s.run.phase).toBe("running");
  });

  it("hang a load on the hook and set one down on its pad", () => {
    h.debug.setLoadPhase(0, "attached");
    expect(h.debug.snapshot().run.attached).toBe(0);
    h.debug.setLoadPhase(0, "placed");
    const s = h.debug.snapshot();
    expect(s.run.attached).toBeNull();
    expect(s.run.loads[0]).toEqual({
      phase: "placed",
      pos: { x: 0, y: 2, z: 10 },
      yaw: 0,
    });
  });

  it("cycle the watch speed on the run screen", () => {
    h.debug.setSpeedIndex(2);
    expect(h.debug.snapshot().run.speedIndex).toBe(2);
    h.debug.setScreen("build");
    h.debug.setSpeedIndex(0);
    expect(h.debug.snapshot().run.speedIndex).toBe(2);
  });

  it("do nothing with no run in progress", () => {
    h.debug.abortRun();
    h.debug.setAxis("slew", 90);
    h.debug.setBob(9, 9, 9);
    const s = h.debug.snapshot();
    expect(s.run.axes.slew.value).toBe(0);
    expect(s.run.bob.pos).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("the clock", () => {
  it("advances whole frames, each covering one tick", () => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.setAutoStep(false);
    h.debug.startRun();
    h.debug.advance(10);
    const s = h.debug.snapshot();
    expect(s.run.tick).toBe(10);
    expect(s.run.time).toBeCloseTo(10 / TICK_HZ, 12);
    expect(h.draws).toBe(10);
  });

  it("scales what a frame covers by the watch speed", () => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.startRun();
    h.debug.setSpeedIndex(2);
    h.debug.advance(1);
    expect(h.debug.snapshot().run.tick).toBe(RUN_SPEEDS[2]);
  });

  it("ticks nothing outside a run, and still accumulates `simTime`", () => {
    h.debug.advance(6);
    const s = h.debug.snapshot();
    expect(s.run.tick).toBe(0);
    expect(s.simTime).toBeCloseTo(6 / TICK_HZ, 12);
    expect(h.motor()).toBe(false);
  });

  it("carries no time measured elsewhere into a run", () => {
    h.debug.openSite(0);
    rig(h.game);
    // Half a tick's worth of frame time on the build screen.
    h.game.frame(1 / (TICK_HZ * 2));
    h.debug.startRun();
    h.debug.advance(1);
    expect(h.debug.snapshot().run.tick).toBe(1);
  });

  it("takes the run's own step and the tape with it", () => {
    h.debug.openSite(0);
    rig(h.game);
    h.debug.startRun();
    h.debug.advance(1);
    const s = h.debug.snapshot();
    expect(s.run.stepIndex).toBe(0);
    expect(s.run.stepLive).toBe(true);
    expect(s.run.axes.trolley.command).toEqual({ target: 4, rate: 2 });
    expect(s.run.forces.length).toBeGreaterThan(0);
    expect(h.motor()).toBe(true);
  });

  it("reports the diagnostics the overlay draws", () => {
    h.debug.openSite(0);
    rig(h.game);
    const lines = h.diagnostics();
    expect(lines.length).toBeGreaterThanOrEqual(7);
    expect(lines[0]).toContain("build");
    expect(lines[0]).toContain(SIM_SITES[0].name);
  });
});

describe("input", () => {
  it("delivers a key act to the same path the runtime feeds", () => {
    h.debug.keyDown("KeyC");
    h.debug.keyUp("KeyC");
    expect(h.keys).toEqual(["down KeyC", "up KeyC"]);
  });

  it("follows a press as a click when it stays inside CLICK_SLOP", () => {
    h.debug.setScreen("select");
    h.debug.pointerDown(100, 100);
    h.debug.pointerMove(100 + CLICK_SLOP - 1, 100);
    h.game.frame(0);
    let s = h.debug.snapshot();
    expect(s.pointer.down).toBe(true);
    expect(s.pointer.dragging).toBe(false);
    expect(s.pointer.pressX).toBe(100);
    expect(s.pointer.x).toBe(105);
    h.debug.pointerUp();
    h.game.frame(0);
    s = h.debug.snapshot();
    expect(s.pointer.down).toBe(false);
    expect(s.pointer.pressX).toBe(100);
  });

  it("turns a press that reaches CLICK_SLOP into an orbit drag", () => {
    h.debug.openSite(0);
    h.debug.setScreen("run");
    h.debug.pointerDown(100, 100);
    // The move that carries the press across the boundary turns nothing.
    h.debug.pointerMove(100 + CLICK_SLOP, 100);
    h.game.frame(0);
    let s = h.debug.snapshot();
    expect(s.pointer.dragging).toBe(true);
    expect(s.camera.yaw).toBe(CAMERA_START_YAW);
    h.debug.pointerMove(100 + CLICK_SLOP + 10, 100);
    h.game.frame(0);
    s = h.debug.snapshot();
    expect(s.camera.yaw).toBeCloseTo(CAMERA_START_YAW + 10 * ORBIT_PER_PX, 12);
    h.debug.pointerUp();
    h.game.frame(0);
    expect(h.debug.snapshot().pointer.dragging).toBe(false);
  });

  it("reads the pointer's position into the state on every update", () => {
    h.debug.pointerMove(400, 300);
    h.game.frame(0);
    expect(h.debug.snapshot().pointer.x).toBe(400);
    h.debug.reset();
    // A reset shows in the pointer only until the next update.
    expect(h.debug.snapshot().pointer.x).toBe(0);
    h.game.frame(0);
    expect(h.debug.snapshot().pointer.x).toBe(400);
  });
});

describe("a run ending", () => {
  /** A tape whose one step is done on the tick that issues it. */
  const instant: TapeStep[] = [
    { kind: "move", commands: [{ axis: "trolley", target: 0, rate: 2 }] },
  ];

  it("clears the site, records the score, and shows the results", () => {
    h.debug.openSite(0);
    rig(h.game, instant);
    h.debug.startRun();
    const cost = h.debug.check().cost;
    h.debug.setLoadPhase(0, "placed");
    h.debug.advance(4);
    const s = h.debug.snapshot();
    expect(s.run.phase).toBe("cleared");
    expect(s.run.cause).toBeNull();
    expect(s.screen).toBe("results");
    expect(s.menuIndex).toBe(0);
    expect(s.cleared[0]).toBe(true);
    expect(s.best[0]).not.toBeNull();
    expect(s.best[0]?.cost).toBeCloseTo(cost, 9);
    expect(s.best[0]?.time).toBeCloseTo(s.run.tick / TICK_HZ, 12);
    expect(h.cues).toContain("complete");
    expect(h.motor()).toBe(false);
  });

  it("stays on the run screen with its cause when it fails", () => {
    h.debug.openSite(0);
    rig(h.game, instant);
    h.debug.startRun();
    h.debug.advance(4);
    const s = h.debug.snapshot();
    expect(s.run.phase).toBe("failed");
    expect(s.run.cause).toBe("loads-unplaced");
    expect(s.screen).toBe("run");
    expect(s.cleared[0]).toBe(false);
    expect(s.best[0]).toBeNull();
    expect(h.cues).toContain("fail");
  });

  it("leaves the run it ended readable, and ticks it no further", () => {
    h.debug.openSite(0);
    rig(h.game, instant);
    h.debug.startRun();
    h.debug.advance(4);
    const ended = h.debug.snapshot().run;
    h.debug.advance(30);
    expect(h.debug.snapshot().run).toEqual(ended);
  });
});

describe("the camera against the frame's delta", () => {
  it("orbits and zooms while its action is held, on the yard screens", () => {
    h.debug.openSite(0);
    h.hold("right", true);
    h.hold("zoom-in", true);
    h.game.frame(1);
    let s = h.debug.snapshot();
    expect(s.camera.yaw).toBeCloseTo(CAMERA_START_YAW + ORBIT_KEY_RATE, 9);
    expect(s.camera.dist).toBeCloseTo(CAMERA_START_DIST - ZOOM_RATE, 9);
    h.hold("right", false);
    h.hold("zoom-in", false);
    h.hold("up", true);
    h.game.frame(0.5);
    s = h.debug.snapshot();
    expect(s.camera.pitch).toBeCloseTo(
      CAMERA_START_PITCH + ORBIT_KEY_RATE * 0.5,
      9,
    );
  });

  it("leaves the camera alone off the yard screens", () => {
    h.hold("right", true);
    h.game.frame(1);
    expect(h.debug.snapshot().camera.yaw).toBe(CAMERA_START_YAW);
  });
});
