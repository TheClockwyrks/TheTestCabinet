import { describe, expect, it } from "vitest";
import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_START_DIST,
  HOIST_START,
  SITES,
  SITE_COUNT,
  TITLE_ITEMS,
} from "./constants";
import { GantryState } from "./game";
import * as st from "./state";

const fresh = (): GantryState => new GantryState();

describe("the vocabularies", () => {
  it("names the seven screens and the six tools", () => {
    expect(st.SCREENS).toHaveLength(7);
    expect(st.TOOLS).toHaveLength(6);
    expect(st.isScreen("build")).toBe(true);
    expect(st.isScreen("nowhere")).toBe(false);
    expect(st.isTool("delete")).toBe(true);
    expect(st.isTool("hammer")).toBe(false);
  });

  it("knows the three yard screens", () => {
    expect(st.isYardScreen("build")).toBe(true);
    expect(st.isYardScreen("program")).toBe(true);
    expect(st.isYardScreen("run")).toBe(true);
    expect(st.isYardScreen("title")).toBe(false);
  });
});

describe("the initial state", () => {
  it("opens on the title screen with site 0's yard", () => {
    const s = fresh();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.siteIndex).toBe(0);
    expect(s.cleared).toEqual(Array.from({ length: SITE_COUNT }, () => false));
    expect(s.best.every((b) => b === null)).toBe(true);
    expect(s.site.loads).toHaveLength(SITES[0].loads.length);
    expect(s.tool).toBe("strut");
    expect(s.run.phase).toBe("idle");
    expect(s.run.axes.hoist.value).toBe(HOIST_START);
    expect(s.simTime).toBe(0);
  });

  it("holds copies of the site table rather than pointing into it", () => {
    const s = fresh();
    expect(s.site.loads[0]).not.toBe(SITES[0].loads[0]);
    expect(s.site.loads[0].from).not.toBe(SITES[0].loads[0].from);
  });
});

describe("the camera", () => {
  it("wraps the yaw to at or above 0 and below 360", () => {
    expect(st.poseCamera(-45, 30, 40).yaw).toBeCloseTo(315, 9);
    expect(st.poseCamera(400, 30, 40).yaw).toBeCloseTo(40, 9);
    expect(st.poseCamera(360, 30, 40).yaw).toBeCloseTo(0, 9);
  });

  it("holds the pitch and the distance inside their limits", () => {
    expect(st.poseCamera(0, -90, 1).pitch).toBe(CAMERA_PITCH_MIN);
    expect(st.poseCamera(0, 900, 1).pitch).toBe(CAMERA_PITCH_MAX);
    expect(st.poseCamera(0, 30, 0).dist).toBe(CAMERA_DIST_MIN);
    expect(st.poseCamera(0, 30, 900).dist).toBe(CAMERA_DIST_MAX);
  });

  it("sets the pose through the same limits", () => {
    const s = fresh();
    st.setCamera(s, -10, 200, 1000);
    expect(s.camera).toEqual({
      yaw: 350,
      pitch: CAMERA_PITCH_MAX,
      dist: CAMERA_DIST_MAX,
    });
  });
});

describe("the menus", () => {
  it("counts the entries of the menu the screen shows", () => {
    const s = fresh();
    expect(st.menuLength(s)).toBe(TITLE_ITEMS.length);
    s.screen = "select";
    expect(st.menuLength(s)).toBe(SITE_COUNT);
    s.screen = "build";
    expect(st.menuLength(s)).toBe(0);
  });

  it("drops NEXT SITE on the last site's results menu", () => {
    expect(st.resultsItems(0)).toHaveLength(3);
    expect(st.resultsItems(SITE_COUNT - 1)).toHaveLength(2);
    expect(st.resultsItems(SITE_COUNT - 1)[0]).toBe("REPLAY");
  });

  it("highlights the last entry when the index is past the end", () => {
    const s = fresh();
    s.menuIndex = 9;
    expect(st.highlightedIndex(s)).toBe(TITLE_ITEMS.length - 1);
    s.screen = "build";
    expect(st.highlightedIndex(s)).toBe(9);
  });

  it("moves the highlight by one and wraps at both ends", () => {
    const s = fresh();
    st.moveMenu(s, -1);
    expect(s.menuIndex).toBe(TITLE_ITEMS.length - 1);
    st.moveMenu(s, 1);
    expect(s.menuIndex).toBe(0);
    s.screen = "build";
    s.menuIndex = 4;
    st.moveMenu(s, 1);
    expect(s.menuIndex).toBe(4);
  });
});

describe("opening a site", () => {
  it("keeps the stored structure and tape and returns everything else", () => {
    const s = fresh();
    s.sites[3].program = [{ kind: "action", action: "attach" }];
    s.sites[3].structure.nextMemberId = 7;
    s.history = [st.emptyStructure()];
    s.checkResult = {
      issues: [],
      cost: 0,
      budget: 0,
      stable: true,
      members: [],
    };
    s.pendingNode = { x: 0, y: 2, z: 0 };
    st.setCamera(s, 100, 50, 20);
    st.openSite(s, 3);
    expect(s.siteIndex).toBe(3);
    expect(st.currentProgram(s)).toHaveLength(1);
    expect(st.currentStructure(s).nextMemberId).toBe(7);
    expect(s.history).toEqual([]);
    expect(s.checkResult).toBeNull();
    expect(s.pendingNode).toBeNull();
    expect(s.camera).toEqual(st.startCamera());
    expect(s.run.phase).toBe("idle");
    expect(s.site.loads).toHaveLength(SITES[3].loads.length);
  });

  it("does not itself change the screen", () => {
    const s = fresh();
    st.openSite(s, 1);
    expect(s.screen).toBe("title");
  });
});

describe("the site unlock rule", () => {
  it("opens site 0 always and site n + 1 once n is cleared", () => {
    const s = fresh();
    expect(st.siteUnlocked(s, 0)).toBe(true);
    expect(st.siteUnlocked(s, 1)).toBe(false);
    st.setCleared(s, 0, true);
    expect(st.siteUnlocked(s, 1)).toBe(true);
  });
});

describe("the best score", () => {
  it("records the first clear and then only an improvement", () => {
    const s = fresh();
    expect(st.beatsBest(null, { cost: 10, time: 10 })).toBe(true);
    st.recordBest(s, 0, { cost: 100, time: 20 });
    expect(s.best[0]).toEqual({ cost: 100, time: 20 });
    st.recordBest(s, 0, { cost: 120, time: 1 });
    expect(s.best[0]).toEqual({ cost: 100, time: 20 });
    st.recordBest(s, 0, { cost: 100, time: 19 });
    expect(s.best[0]).toEqual({ cost: 100, time: 19 });
    st.recordBest(s, 0, { cost: 90, time: 40 });
    expect(s.best[0]).toEqual({ cost: 90, time: 40 });
  });
});

describe("the tape", () => {
  it("accepts a rate above 0 and at most the axis's max", () => {
    expect(st.acceptableRate("slew", 0)).toBe(false);
    expect(st.acceptableRate("slew", 30)).toBe(true);
    expect(st.acceptableRate("slew", 31)).toBe(false);
    expect(st.acceptableRate("hoist", Number.NaN)).toBe(false);
  });

  it("appends a move step and refuses an unacceptable rate", () => {
    const s = fresh();
    st.addMoveStep(s, "slew", 90, 10);
    expect(st.currentProgram(s)).toHaveLength(1);
    st.addMoveStep(s, "slew", 90, 0);
    expect(st.currentProgram(s)).toHaveLength(1);
  });

  it("adds one command per axis to a move step and no more", () => {
    const s = fresh();
    st.addMoveStep(s, "slew", 90, 10);
    st.addCommand(s, 0, "hoist", 4, 2);
    expect(st.currentProgram(s)[0]).toEqual({
      kind: "move",
      commands: [
        { axis: "slew", target: 90, rate: 10 },
        { axis: "hoist", target: 4, rate: 2 },
      ],
    });
    st.addCommand(s, 0, "hoist", 6, 2);
    const step = st.currentProgram(s)[0];
    expect(step.kind === "move" ? step.commands.length : 0).toBe(2);
  });

  it("refuses a command on an action step and an index the tape lacks", () => {
    const s = fresh();
    st.addActionStep(s, "attach");
    st.addCommand(s, 0, "slew", 10, 10);
    expect(st.currentProgram(s)[0]).toEqual({
      kind: "action",
      action: "attach",
    });
    st.addCommand(s, 5, "slew", 10, 10);
    expect(st.currentProgram(s)).toHaveLength(1);
  });

  it("removes a step, and removes none for an index it does not carry", () => {
    const s = fresh();
    st.addActionStep(s, "attach");
    st.addActionStep(s, "release");
    st.removeStep(s, 5);
    expect(st.currentProgram(s)).toHaveLength(2);
    st.removeStep(s, 0);
    expect(st.currentProgram(s)).toEqual([
      { kind: "action", action: "release" },
    ]);
    st.clearProgram(s);
    expect(st.currentProgram(s)).toHaveLength(0);
  });

  it("clears the shown check result when the tape changes", () => {
    const s = fresh();
    s.checkResult = {
      issues: [],
      cost: 0,
      budget: 0,
      stable: true,
      members: [],
    };
    st.addActionStep(s, "attach");
    expect(s.checkResult).toBeNull();
  });
});

describe("the open site's yard", () => {
  it("clears and appends loads, whose target starts at their start", () => {
    const s = fresh();
    st.clearLoads(s);
    expect(s.site.loads).toHaveLength(0);
    st.addLoad(s, "crate", 40, { x: 4, y: 2, z: 0 }, 90);
    expect(s.site.loads[0]).toEqual({
      class: "crate",
      mass: 40,
      from: { x: 4, y: 2, z: 0, yaw: 90 },
      to: { x: 4, y: 2, z: 0, yaw: 90 },
    });
    st.setLoadTarget(s, 0, { x: -4, y: 2, z: 0 }, 0);
    expect(s.site.loads[0].to).toEqual({ x: -4, y: 2, z: 0, yaw: 0 });
    expect(s.site.loads[0].from).toEqual({ x: 4, y: 2, z: 0, yaw: 90 });
  });

  it("clears and appends obstacles by their corner and size", () => {
    const s = fresh();
    st.clearObstacles(s);
    st.addObstacle(s, { x: 1, y: 0, z: 2 }, { x: 3, y: 4, z: 5 });
    expect(s.site.obstacles).toEqual([
      { min: { x: 1, y: 0, z: 2 }, size: { x: 3, y: 4, z: 5 } },
    ]);
  });
});

describe("the run poses", () => {
  it("sets an axis stopped with no command, and a rate on its own", () => {
    const s = fresh();
    st.setAxis(s, "slew", 45);
    expect(s.run.axes.slew).toEqual({ value: 45, rate: 0, command: null });
    st.setAxisRate(s, "slew", -3);
    expect(s.run.axes.slew).toEqual({ value: 45, rate: -3, command: null });
  });

  it("puts the bob where it is asked for, and sets its velocity apart", () => {
    const s = fresh();
    st.setBob(s, { x: 1, y: 2, z: 3 });
    st.setBobVelocity(s, { x: 4, y: 5, z: 6 });
    expect(s.run.bob).toEqual({
      pos: { x: 1, y: 2, z: 3 },
      vel: { x: 4, y: 5, z: 6 },
    });
  });

  it("refuses attaching a second load while one is on the hook", () => {
    const s = fresh();
    s.run.loads = [
      { phase: "waiting", pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      { phase: "waiting", pos: { x: 1, y: 0, z: 0 }, yaw: 0 },
    ];
    st.setLoadPhase(s, 0, "attached");
    expect(s.run.attached).toBe(0);
    st.setLoadPhase(s, 1, "attached");
    expect(s.run.attached).toBe(0);
    expect(s.run.loads[1].phase).toBe("waiting");
  });

  it("takes a load off the hook on every other phase", () => {
    const s = fresh();
    s.run.loads = [{ phase: "waiting", pos: { x: 0, y: 0, z: 0 }, yaw: 0 }];
    st.setLoadPhase(s, 0, "attached");
    st.setLoadPhase(s, 0, "lost");
    expect(s.run.attached).toBeNull();
  });

  it("sets a placed load down at exactly its target pose", () => {
    const s = fresh();
    s.run.loads = [{ phase: "waiting", pos: { x: 0, y: 0, z: 0 }, yaw: 0 }];
    const target = s.site.loads[0].to;
    st.setLoadPhase(s, 0, "placed");
    expect(s.run.loads[0].pos).toEqual({
      x: target.x,
      y: target.y,
      z: target.z,
    });
    expect(s.run.loads[0].yaw).toBe(target.yaw);
  });
});

describe("aborting", () => {
  it("does nothing with no run in progress", () => {
    const s = fresh();
    s.screen = "run";
    st.abortRun(s);
    expect(s.screen).toBe("run");
  });

  it("puts the idle placeholder back and returns the build screen", () => {
    const s = fresh();
    s.screen = "run";
    s.run.phase = "running";
    s.run.tick = 40;
    st.abortRun(s);
    expect(s.screen).toBe("build");
    expect(s.run.phase).toBe("idle");
    expect(s.run.tick).toBe(0);
  });
});

describe("reset", () => {
  it("returns every field to its title value bar muted", () => {
    const s = fresh();
    s.screen = "run";
    s.menuIndex = 2;
    s.muted = true;
    s.tool = "delete";
    st.setCleared(s, 0, true);
    st.setBest(s, 0, { cost: 1, time: 2 });
    st.openSite(s, 4);
    st.addActionStep(s, "attach");
    s.simTime = 12;
    st.resetState(s);
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.siteIndex).toBe(0);
    expect(s.cleared.every((c) => !c)).toBe(true);
    expect(s.best.every((b) => b === null)).toBe(true);
    expect(st.currentProgram(s)).toHaveLength(0);
    expect(s.tool).toBe("strut");
    expect(s.camera.dist).toBe(CAMERA_START_DIST);
    expect(s.simTime).toBe(0);
    expect(s.muted).toBe(true);
  });
});
