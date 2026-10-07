import { describe, expect, it } from "vitest";

import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  HOIST_START,
  RESULTS_ITEMS,
  SITE_COUNT,
  SLEW_MAX_RATE,
  TITLE_ITEMS,
} from "./constants";
import { SIM_SITES, type Material, type Vec3 } from "./sim";
import {
  abortRun,
  addActionStep,
  addCommand,
  addLoad,
  addMoveStep,
  addObstacle,
  beatsBest,
  beginRun,
  clearLoads,
  clearObstacles,
  clearPendingNode,
  clearProgram,
  copyStructure,
  craneCost,
  currentProgram,
  currentSite,
  emptySiteStructure,
  highlightedIndex,
  idleRun,
  isScreen,
  isTool,
  menuLength,
  moveMenu,
  openSite,
  poseCamera,
  recordBest,
  removeStep,
  resultsItems,
  setAxis,
  setAxisRate,
  setBob,
  setBobVelocity,
  setCleared,
  setLoadPhase,
  setLoadPose,
  setLoadTarget,
  setPendingNode,
  setScreen,
  setTool,
  siteUnlocked,
  titleState,
  type GantryState,
} from "./state";

/**
 * The smallest crane site 1 finds ready: the ring on the tower's head and one
 * rail out of the top flange. Readiness is not stability, which is exactly what
 * a start is judged against (`specs/program.md`).
 */
function readyCrane(state: GantryState): GantryState {
  const members = [
    {
      id: 0,
      a: [2, 4, 0] as Vec3,
      b: [4, 4, 0] as Vec3,
      material: "rail" as Material,
    },
  ];
  return {
    ...state,
    sites: state.sites.map((entry, i) =>
      i === state.siteIndex
        ? {
            structure: {
              members,
              nextMemberId: 1,
              ring: { corner: [0, 2, 0] as Vec3 },
              counterweights: [],
            },
            program: entry.program,
          }
        : entry,
    ),
  };
}

const oneStepTape = (state: GantryState): GantryState =>
  addMoveStep(setScreen(state, "program"), "slew", 30, SLEW_MAX_RATE);

describe("the title state", () => {
  it("is the title screen with site 0 opened", () => {
    const state = titleState();
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
    expect(state.siteIndex).toBe(0);
    expect(state.tool).toBe("strut");
    expect(state.simTime).toBe(0);
    expect(state.muted).toBe(false);
    expect(state.pendingNode).toBeNull();
    expect(state.checkResult).toBeNull();
    expect(state.history).toEqual([]);
    expect(state.cleared).toEqual(new Array(SITE_COUNT).fill(false));
    expect(state.best).toEqual(new Array(SITE_COUNT).fill(null));
    expect(state.camera).toEqual({
      yaw: CAMERA_START_YAW,
      pitch: CAMERA_START_PITCH,
      dist: CAMERA_START_DIST,
    });
    expect(state.run).toEqual(idleRun());
  });

  it("gives every site an empty structure and tape", () => {
    const state = titleState();
    expect(state.sites).toHaveLength(SITE_COUNT);
    for (const entry of state.sites) {
      expect(entry.structure).toEqual(emptySiteStructure());
      expect(entry.program).toEqual([]);
    }
  });

  it("fills the open site with copies, not with the table's own records", () => {
    const state = titleState();
    const authored = SIM_SITES[0];
    expect(state.site.loads).toEqual(authored.loads);
    expect(state.site.loads[0]).not.toBe(authored.loads[0]);
    expect(state.site.loads[0].from.pos).not.toBe(authored.loads[0].from.pos);
    expect(state.site.obstacles).toEqual(authored.obstacles);
  });
});

describe("the idle run", () => {
  it("is the placeholder `specs/state.md` fixes", () => {
    const run = idleRun();
    expect(run.phase).toBe("idle");
    expect(run.cause).toBeNull();
    expect(run.tick).toBe(0);
    expect(run.speedIndex).toBe(0);
    expect(run.stepIndex).toBe(0);
    expect(run.stepLive).toBe(false);
    expect(run.accumulator).toBe(0);
    expect(run.axes.slew).toEqual({ value: 0, rate: 0, command: null });
    expect(run.axes.trolley).toEqual({ value: 0, rate: 0, command: null });
    expect(run.axes.hoist).toEqual({
      value: HOIST_START,
      rate: 0,
      command: null,
    });
    expect(run.axes.grip).toEqual({ value: 0, rate: 0, command: null });
    expect(run.pivot).toEqual([0, 0, 0]);
    expect(run.bob).toEqual({ pos: [0, 0, 0], vel: [0, 0, 0] });
    expect(run.attached).toBeNull();
    expect(run.loads).toEqual([]);
    expect(run.forces).toEqual([]);
    expect(run.broken).toEqual([]);
  });
});

describe("opening a site", () => {
  it("does the seven things and leaves the screen alone", () => {
    let state = titleState();
    state = setPendingNode(state, [2, 2, 2]);
    state = {
      ...state,
      history: [emptySiteStructure()],
      checkResult: {
        issues: [],
        cost: 0,
        budget: 0,
        stable: true,
        members: [],
      },
      camera: poseCamera(120, 50, 20),
      screen: "select",
    };
    const opened = openSite(state, 2);
    expect(opened.siteIndex).toBe(2);
    expect(opened.site.loads).toEqual(SIM_SITES[2].loads);
    expect(opened.site.obstacles).toEqual(SIM_SITES[2].obstacles);
    expect(opened.history).toEqual([]);
    expect(opened.pendingNode).toBeNull();
    expect(opened.checkResult).toBeNull();
    expect(opened.camera).toEqual({
      yaw: CAMERA_START_YAW,
      pitch: CAMERA_START_PITCH,
      dist: CAMERA_START_DIST,
    });
    expect(opened.run).toEqual(idleRun());
    expect(opened.screen).toBe("select");
  });

  it("keeps the structure and the tape authored on that site", () => {
    let state = readyCrane(titleState());
    state = oneStepTape(state);
    const away = openSite(state, 1);
    const back = openSite(away, 0);
    expect(back.sites[0].structure.members).toHaveLength(1);
    expect(back.sites[0].program).toHaveLength(1);
  });
});

describe("starting a run", () => {
  it("is refused with no structure and with no tape", () => {
    expect(beginRun(titleState())).toBeNull();
    expect(beginRun(readyCrane(titleState()))).toBeNull();
    expect(beginRun(oneStepTape(titleState()))).toBeNull();
  });

  it("leaves what the start table gives", () => {
    const state = oneStepTape(readyCrane(titleState()));
    const started = beginRun(state);
    expect(started).not.toBeNull();
    const run = started!.run;
    expect(started!.screen).toBe("run");
    expect(run.phase).toBe("running");
    expect(run.cause).toBeNull();
    expect(run.tick).toBe(0);
    expect(run.speedIndex).toBe(0);
    expect(run.accumulator).toBe(0);
    expect(run.stepIndex).toBe(0);
    expect(run.stepLive).toBe(false);
    expect(run.axes).toEqual(idleRun().axes);
    // The trolley starts at the track origin, and the bob hangs HOIST_START
    // below it, at rest.
    expect(run.pivot).toEqual([2, 4, 0]);
    expect(run.bob).toEqual({ pos: [2, 4 - HOIST_START, 0], vel: [0, 0, 0] });
    expect(run.attached).toBeNull();
    expect(run.forces).toEqual([]);
    expect(run.broken).toEqual([]);
    expect(run.loads).toEqual(
      state.site.loads.map((l) => ({
        phase: "waiting",
        pos: l.from.pos,
        yaw: l.from.yaw,
      })),
    );
  });

  it("starts at speed 0 whatever the run before was watched at", () => {
    const state = oneStepTape(readyCrane(titleState()));
    const first = beginRun(state)!;
    const watched = { ...first, run: { ...first.run, speedIndex: 2 } };
    expect(beginRun(watched)!.run.speedIndex).toBe(0);
  });
});

describe("aborting", () => {
  it("puts the idle placeholder back and returns the build screen", () => {
    const started = beginRun(oneStepTape(readyCrane(titleState())))!;
    const aborted = abortRun(started);
    expect(aborted.run).toEqual(idleRun());
    expect(aborted.screen).toBe("build");
  });

  it("does nothing with no run in progress", () => {
    const state = titleState();
    expect(abortRun(state)).toBe(state);
  });
});

describe("the menus", () => {
  it("counts the entries of the screen showing", () => {
    const state = titleState();
    expect(menuLength(state)).toBe(TITLE_ITEMS.length);
    expect(menuLength(setScreen(state, "select"))).toBe(SITE_COUNT);
    expect(menuLength(setScreen(state, "results"))).toBe(RESULTS_ITEMS.length);
    expect(menuLength(setScreen(state, "howto"))).toBe(0);
    expect(menuLength(setScreen(state, "build"))).toBe(0);
    expect(menuLength(setScreen(state, "program"))).toBe(0);
    expect(menuLength(setScreen(state, "run"))).toBe(0);
  });

  it("drops NEXT SITE on the last site", () => {
    expect(resultsItems(0)).toEqual([...RESULTS_ITEMS]);
    expect(resultsItems(SITE_COUNT - 1)).toEqual([
      RESULTS_ITEMS[1],
      RESULTS_ITEMS[2],
    ]);
  });

  it("wraps at both ends", () => {
    let state = setScreen(titleState(), "select");
    expect(state.menuIndex).toBe(0);
    state = moveMenu(state, -1);
    expect(state.menuIndex).toBe(SITE_COUNT - 1);
    state = moveMenu(state, 1);
    expect(state.menuIndex).toBe(0);
    state = moveMenu(state, 1);
    expect(state.menuIndex).toBe(1);
  });

  it("moves from the last entry when the index has none", () => {
    const state = { ...setScreen(titleState(), "title"), menuIndex: 9 };
    expect(highlightedIndex(state)).toBe(TITLE_ITEMS.length - 1);
    expect(moveMenu(state, 1).menuIndex).toBe(0);
  });

  it("leaves the index alone on a screen with no menu", () => {
    const state = { ...setScreen(titleState(), "build"), menuIndex: 3 };
    expect(moveMenu(state, 1)).toBe(state);
    expect(highlightedIndex(state)).toBe(3);
  });
});

describe("progress", () => {
  it("opens site 0, and site n + 1 once site n is cleared", () => {
    let state = titleState();
    expect(siteUnlocked(state, 0)).toBe(true);
    expect(siteUnlocked(state, 1)).toBe(false);
    state = setCleared(state, 0, true);
    expect(siteUnlocked(state, 1)).toBe(true);
    expect(siteUnlocked(state, 2)).toBe(false);
  });

  it("records the first clear and replaces it only on a better score", () => {
    expect(beatsBest(null, { cost: 100, time: 10 })).toBe(true);
    expect(beatsBest({ cost: 100, time: 10 }, { cost: 99, time: 99 })).toBe(
      true,
    );
    expect(beatsBest({ cost: 100, time: 10 }, { cost: 100, time: 9 })).toBe(
      true,
    );
    expect(beatsBest({ cost: 100, time: 10 }, { cost: 100, time: 10 })).toBe(
      false,
    );
    expect(beatsBest({ cost: 100, time: 10 }, { cost: 101, time: 1 })).toBe(
      false,
    );
  });

  it("keeps the better of the two", () => {
    let state = recordBest(titleState(), 3, { cost: 500, time: 30 });
    expect(state.best[3]).toEqual({ cost: 500, time: 30 });
    state = recordBest(state, 3, { cost: 600, time: 1 });
    expect(state.best[3]).toEqual({ cost: 500, time: 30 });
    state = recordBest(state, 3, { cost: 500, time: 29 });
    expect(state.best[3]).toEqual({ cost: 500, time: 29 });
    state = recordBest(state, 3, { cost: 400, time: 90 });
    expect(state.best[3]).toEqual({ cost: 400, time: 90 });
    expect(state.best[2]).toBeNull();
  });
});

describe("the camera", () => {
  it("clamps the pitch and the distance and wraps the yaw", () => {
    expect(poseCamera(-30, 0, 0)).toEqual({
      yaw: 330,
      pitch: CAMERA_PITCH_MIN,
      dist: CAMERA_DIST_MIN,
    });
    expect(poseCamera(725, 200, 500)).toEqual({
      yaw: 5,
      pitch: CAMERA_PITCH_MAX,
      dist: CAMERA_DIST_MAX,
    });
  });
});

describe("the editor's selection", () => {
  it("selects a tool and holds a pending node", () => {
    let state = setTool(titleState(), "rail");
    expect(state.tool).toBe("rail");
    state = setPendingNode(state, [2, 0, 4]);
    expect(state.pendingNode).toEqual([2, 0, 4]);
    // A pending node belongs to the placement, so it survives a tool switch.
    state = setTool(state, "delete");
    expect(state.pendingNode).toEqual([2, 0, 4]);
    state = clearPendingNode(state);
    expect(state.pendingNode).toBeNull();
  });

  it("names its vocabularies", () => {
    expect(isScreen("results")).toBe(true);
    expect(isScreen("nowhere")).toBe(false);
    expect(isTool("counterweight")).toBe(true);
    expect(isTool("hammer")).toBe(false);
  });

  it("copies a structure deeply enough for the undo stack", () => {
    const structure = {
      members: [
        {
          id: 0,
          a: [0, 0, 0] as Vec3,
          b: [0, 2, 0] as Vec3,
          material: "strut" as Material,
        },
      ],
      nextMemberId: 1,
      ring: { corner: [0, 2, 0] as Vec3 },
      counterweights: [[0, 2, 0] as Vec3],
    };
    const copy = copyStructure(structure);
    expect(copy).toEqual(structure);
    expect(copy.members[0]).not.toBe(structure.members[0]);
    expect(copy.ring).not.toBe(structure.ring);
    expect(copy.counterweights[0]).not.toBe(structure.counterweights[0]);
  });
});

describe("the tape", () => {
  const program = (state: GantryState) => currentProgram(state);

  it("takes a move step and refuses a rate the editor refuses", () => {
    const base = setScreen(titleState(), "program");
    expect(program(addMoveStep(base, "slew", 90, SLEW_MAX_RATE))).toEqual([
      { kind: "move", commands: [{ axis: "slew", target: 90, rate: 30 }] },
    ]);
    expect(addMoveStep(base, "slew", 90, 0)).toBe(base);
    expect(addMoveStep(base, "slew", 90, -1)).toBe(base);
    expect(addMoveStep(base, "slew", 90, SLEW_MAX_RATE + 1)).toBe(base);
  });

  it("takes at most one command per axis, and none on an action step", () => {
    let state = addMoveStep(setScreen(titleState(), "program"), "slew", 90, 10);
    state = addCommand(state, 0, "hoist", 4, 2);
    expect(program(state)[0]).toEqual({
      kind: "move",
      commands: [
        { axis: "slew", target: 90, rate: 10 },
        { axis: "hoist", target: 4, rate: 2 },
      ],
    });
    const twice = addCommand(state, 0, "slew", 10, 5);
    expect(twice).toBe(state);
    const badRate = addCommand(state, 0, "grip", 10, 0);
    expect(badRate).toBe(state);

    let actions = addActionStep(state, "attach");
    expect(program(actions)[1]).toEqual({ kind: "action", action: "attach" });
    const onAction = addCommand(actions, 1, "slew", 10, 5);
    expect(onAction).toBe(actions);
    actions = removeStep(actions, 0);
    expect(program(actions)).toEqual([{ kind: "action", action: "attach" }]);
    expect(program(clearProgram(actions))).toEqual([]);
  });

  it("clears the check result the build screen is showing", () => {
    const base: GantryState = {
      ...setScreen(titleState(), "program"),
      checkResult: {
        issues: [],
        cost: 1,
        budget: 2,
        stable: true,
        members: [],
      },
    };
    expect(addActionStep(base, "release").checkResult).toBeNull();
  });
});

describe("the open site", () => {
  it("adds a load whose target starts equal to its start", () => {
    let state = clearLoads(titleState());
    expect(state.site.loads).toEqual([]);
    state = addLoad(state, "drum", 55, [4, 3, 0], 90);
    expect(state.site.loads).toEqual([
      {
        cls: "drum",
        mass: 55,
        from: { pos: [4, 3, 0], yaw: 90 },
        to: { pos: [4, 3, 0], yaw: 90 },
      },
    ]);
    state = setLoadTarget(state, 0, [-4, 3, 0], 180);
    expect(state.site.loads[0].to).toEqual({ pos: [-4, 3, 0], yaw: 180 });
    expect(state.site.loads[0].from).toEqual({ pos: [4, 3, 0], yaw: 90 });
  });

  it("adds an obstacle as the box with that corner and size", () => {
    let state = clearObstacles(titleState());
    expect(state.site.obstacles).toEqual([]);
    state = addObstacle(state, [5, 0, -6], [1, 8, 12]);
    expect(state.site.obstacles).toEqual([{ min: [5, 0, -6], max: [6, 8, 6] }]);
    // The open site's own figures reach the simulation.
    expect(currentSite(state).obstacles).toEqual(state.site.obstacles);
    expect(currentSite(state).name).toBe(SIM_SITES[0].name);
  });

  it("costs the crane off the open site's structure", () => {
    expect(craneCost(titleState())).toBe(0);
    expect(craneCost(readyCrane(titleState()))).toBeGreaterThan(0);
  });
});

describe("posing a run", () => {
  const started = (): GantryState =>
    beginRun(oneStepTape(readyCrane(titleState())))!;

  it("sets an axis stopped with no command, and a rate on its own", () => {
    let state = setAxis(started(), "slew", 45);
    expect(state.run.axes.slew).toEqual({
      value: 45,
      rate: 0,
      command: null,
    });
    state = setAxisRate(state, "slew", -3);
    expect(state.run.axes.slew).toEqual({
      value: 45,
      rate: -3,
      command: null,
    });
  });

  it("puts the bob where it is asked for", () => {
    let state = setBob(started(), [1, 2, 3]);
    expect(state.run.bob.pos).toEqual([1, 2, 3]);
    state = setBobVelocity(state, [0, -1, 0]);
    expect(state.run.bob).toEqual({ pos: [1, 2, 3], vel: [0, -1, 0] });
  });

  it("poses a load and hangs it on the hook", () => {
    let state = setLoadPose(started(), 0, [3, 2, 1], 45);
    expect(state.run.loads[0]).toEqual({
      phase: "waiting",
      pos: [3, 2, 1],
      yaw: 45,
    });
    state = setLoadPhase(state, 0, "attached");
    expect(state.run.attached).toBe(0);
    expect(state.run.loads[0].phase).toBe("attached");
    // The grip is left as it is.
    expect(state.run.axes.grip.value).toBe(0);
  });

  it("sets a placed load at exactly its target pose, and clears the hook", () => {
    let state = setLoadPhase(started(), 0, "attached");
    state = setLoadPhase(state, 0, "placed");
    const target = state.site.loads[0].to;
    expect(state.run.loads[0]).toEqual({
      phase: "placed",
      pos: target.pos,
      yaw: target.yaw,
    });
    expect(state.run.attached).toBeNull();
  });

  it("refuses `attached` while another load is attached", () => {
    let state = started();
    state = addLoad({ ...state, screen: "build" }, "crate", 40, [0, 2, 0], 0);
    // The run's loads are the ones it started with, so pose two on the run.
    state = {
      ...state,
      screen: "run",
      run: {
        ...state.run,
        loads: [
          { phase: "waiting", pos: [0, 0, 0], yaw: 0 },
          { phase: "waiting", pos: [1, 0, 0], yaw: 0 },
        ],
      },
    };
    state = setLoadPhase(state, 0, "attached");
    expect(state.run.attached).toBe(0);
    const refused = setLoadPhase(state, 1, "attached");
    expect(refused).toBe(state);
    // Taking the hanging load off any other way clears the attachment.
    const lost = setLoadPhase(state, 0, "lost");
    expect(lost.run.attached).toBeNull();
    expect(lost.run.loads[0].phase).toBe("lost");
  });
});
