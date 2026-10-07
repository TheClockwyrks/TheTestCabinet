// The pure transitions: what each one sets, and what it leaves alone.

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
  SITE_COUNT,
  SITES,
  SLEW_MAX_RATE,
} from "./constants";
import { point } from "./convert";
import type { GantryState } from "./game";
import * as st from "./state";

const title = (): GantryState => st.titleState();

describe("the title state", () => {
  it("is the title screen with site 0 opened and every field present", () => {
    const s = title();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.siteIndex).toBe(0);
    expect(s.cleared).toEqual(new Array<boolean>(SITE_COUNT).fill(false));
    expect(s.best).toEqual(new Array<null>(SITE_COUNT).fill(null));
    expect(s.sites).toHaveLength(SITE_COUNT);
    expect(s.tool).toBe("strut");
    expect(s.pendingNode).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.checkResult).toBeNull();
    expect(s.simTime).toBe(0);
    expect(s.muted).toBe(false);
    expect(s.cues).toEqual([]);
  });

  it("carries site 0's loads and obstacles, as its own copies", () => {
    const s = title();
    expect(s.site.loads).toEqual(SITES[0].loads);
    expect(s.site.loads[0]).not.toBe(SITES[0].loads[0]);
    expect(s.site.obstacles).toEqual(SITES[0].obstacles);
  });

  it("rests the run at the idle placeholder", () => {
    const { run } = title();
    expect(run.phase).toBe("idle");
    expect(run.cause).toBeNull();
    expect(run.tick).toBe(0);
    expect(run.speedIndex).toBe(0);
    expect(run.stepIndex).toBe(0);
    expect(run.stepLive).toBe(false);
    expect(run.axes.hoist.value).toBe(HOIST_START);
    expect(run.axes.slew).toEqual({ value: 0, rate: 0, command: null });
    expect(run.pivot).toEqual(point(0, 0, 0));
    expect(run.bob).toEqual({ pos: point(0, 0, 0), vel: point(0, 0, 0) });
    expect(run.attached).toBeNull();
    expect(run.loads).toEqual([]);
    expect(run.forces).toEqual([]);
    expect(run.broken).toEqual([]);
  });

  it("starts the camera at its start pose", () => {
    expect(title().camera).toEqual({
      yaw: CAMERA_START_YAW,
      pitch: CAMERA_START_PITCH,
      dist: CAMERA_START_DIST,
    });
  });
});

describe("opening a site", () => {
  it("keeps the stored structure and tape and clears the visit's own state", () => {
    let s = title();
    s = st.setScreen(s, "build");
    s = st.setPendingNode(s, point(0, 0, 0));
    s = st.setCamera(s, 100, 40, 20);
    s.history.push(s.sites[0].structure);
    s.sites[2].program = [{ kind: "action", action: "attach" }];

    const opened = st.openSite(s, 2);
    expect(opened.siteIndex).toBe(2);
    expect(opened.sites[2].program).toHaveLength(1);
    expect(opened.pendingNode).toBeNull();
    expect(opened.history).toEqual([]);
    expect(opened.checkResult).toBeNull();
    expect(opened.camera).toEqual(st.startCamera());
    expect(opened.run.phase).toBe("idle");
    expect(opened.site.obstacles).toEqual(SITES[2].obstacles);
    // The screen is not the opening's; entering a site is what shows `build`.
    expect(opened.screen).toBe("build");
  });

  it("leaves the state it was handed as it was", () => {
    const before = title();
    const copy = structuredClone(before);
    st.openSite(before, 3);
    expect(before).toEqual(copy);
  });
});

describe("the menus", () => {
  it("counts the entries of the screen showing, and none where there is no menu", () => {
    expect(st.menuLength(title())).toBe(2);
    expect(st.menuLength(st.setScreen(title(), "select"))).toBe(SITE_COUNT);
    expect(st.menuLength(st.setScreen(title(), "build"))).toBe(0);
    expect(st.menuLength(st.setScreen(title(), "howto"))).toBe(0);
  });

  it("drops NEXT SITE on the last site", () => {
    expect(st.resultsItems(0)).toHaveLength(3);
    expect(st.resultsItems(SITE_COUNT - 1)).toEqual(["REPLAY", "SITE SELECT"]);
  });

  it("wraps at both ends and leaves a menuless screen alone", () => {
    let s = title();
    s = st.moveMenu(s, -1);
    expect(s.menuIndex).toBe(1);
    s = st.moveMenu(s, 1);
    expect(s.menuIndex).toBe(0);
    const build = st.setMenuIndex(st.setScreen(title(), "build"), 4);
    expect(st.moveMenu(build, 1).menuIndex).toBe(4);
  });

  it("highlights the last entry where the index is past the menu", () => {
    const s = st.setMenuIndex(title(), 9);
    expect(st.highlightedIndex(s)).toBe(1);
    expect(st.highlightedIndex(st.setScreen(s, "build"))).toBe(9);
  });

  it("opens site 0 always, and site n+1 once site n is cleared", () => {
    const s = title();
    expect(st.siteUnlocked(s, 0)).toBe(true);
    expect(st.siteUnlocked(s, 1)).toBe(false);
    expect(st.siteUnlocked(st.setCleared(s, 0, true), 1)).toBe(true);
  });
});

describe("the camera", () => {
  it("wraps the yaw and clamps the pitch and the distance", () => {
    const s = st.setCamera(title(), -30, 200, 1000);
    expect(s.camera.yaw).toBe(330);
    expect(s.camera.pitch).toBe(CAMERA_PITCH_MAX);
    expect(s.camera.dist).toBe(CAMERA_DIST_MAX);
    const low = st.setCamera(title(), 720, -50, 0);
    expect(low.camera.yaw).toBe(0);
    expect(low.camera.pitch).toBe(CAMERA_PITCH_MIN);
    expect(low.camera.dist).toBe(CAMERA_DIST_MIN);
  });
});

describe("the best score", () => {
  it("records the first clear, and then only an improvement", () => {
    let s = st.recordBest(title(), 0, { cost: 100, time: 10 });
    expect(s.best[0]).toEqual({ cost: 100, time: 10 });
    s = st.recordBest(s, 0, { cost: 120, time: 5 });
    expect(s.best[0]).toEqual({ cost: 100, time: 10 });
    s = st.recordBest(s, 0, { cost: 100, time: 9 });
    expect(s.best[0]).toEqual({ cost: 100, time: 9 });
    s = st.recordBest(s, 0, { cost: 90, time: 30 });
    expect(s.best[0]).toEqual({ cost: 90, time: 30 });
  });

  it("beats nothing, a higher cost, and an equal cost with a longer time", () => {
    expect(st.beatsBest(null, { cost: 1, time: 1 })).toBe(true);
    expect(st.beatsBest({ cost: 2, time: 2 }, { cost: 1, time: 9 })).toBe(true);
    expect(st.beatsBest({ cost: 2, time: 2 }, { cost: 2, time: 1 })).toBe(true);
    expect(st.beatsBest({ cost: 2, time: 2 }, { cost: 2, time: 2 })).toBe(
      false,
    );
  });
});

describe("the tape editor's rules", () => {
  const program = (s: GantryState) => s.sites[s.siteIndex].program;

  it("takes a rate above zero and at most the axis's max", () => {
    expect(st.acceptableRate("slew", SLEW_MAX_RATE)).toBe(true);
    expect(st.acceptableRate("slew", SLEW_MAX_RATE + 0.1)).toBe(false);
    expect(st.acceptableRate("slew", 0)).toBe(false);
    expect(st.acceptableRate("slew", -1)).toBe(false);
  });

  it("refuses a move step whose rate the editor refuses", () => {
    const s = st.addMoveStep(title(), "slew", 90, 0);
    expect(program(s)).toHaveLength(0);
  });

  it("appends a move step and adds a second axis to it", () => {
    let s = st.addMoveStep(title(), "slew", 90, 10);
    s = st.addCommand(s, 0, "hoist", 6, 2);
    const step = program(s)[0];
    expect(step.kind).toBe("move");
    if (step.kind === "move") {
      expect(step.commands.map((c) => c.axis)).toEqual(["slew", "hoist"]);
    }
  });

  it("refuses a second command on an axis the step already commands", () => {
    let s = st.addMoveStep(title(), "slew", 90, 10);
    s = st.addCommand(s, 0, "slew", 45, 5);
    const step = program(s)[0];
    if (step.kind === "move") expect(step.commands).toHaveLength(1);
  });

  it("refuses a command added to an action step", () => {
    let s = st.addActionStep(title(), "attach");
    s = st.addCommand(s, 0, "slew", 45, 5);
    expect(program(s)[0]).toEqual({ kind: "action", action: "attach" });
  });

  it("removes a step, and removes none at an index the tape does not carry", () => {
    let s = st.addActionStep(title(), "attach");
    s = st.addActionStep(s, "release");
    expect(program(st.removeStep(s, 5))).toHaveLength(2);
    s = st.removeStep(s, 0);
    expect(program(s)).toEqual([{ kind: "action", action: "release" }]);
    expect(program(st.clearProgram(s))).toEqual([]);
  });

  it("clears the shown check result whenever the tape changes", () => {
    const s = title();
    s.checkResult = {
      issues: [],
      cost: 0,
      budget: 0,
      stable: true,
      members: [],
    };
    expect(st.addActionStep(s, "attach").checkResult).toBeNull();
  });
});

describe("the site poses", () => {
  it("adds a load whose target pose starts equal to its starting pose", () => {
    const s = st.addLoad(
      st.clearLoads(title()),
      "drum",
      12,
      point(1, 2, 3),
      45,
    );
    expect(s.site.loads).toHaveLength(1);
    expect(s.site.loads[0].from).toEqual({ x: 1, y: 2, z: 3, yaw: 45 });
    expect(s.site.loads[0].to).toEqual({ x: 1, y: 2, z: 3, yaw: 45 });
  });

  it("sets a load's target, and leaves its start alone", () => {
    let s = st.addLoad(st.clearLoads(title()), "crate", 10, point(0, 2, 0), 0);
    s = st.setLoadTarget(s, 0, point(4, 2, 4), 90);
    expect(s.site.loads[0].from).toEqual({ x: 0, y: 2, z: 0, yaw: 0 });
    expect(s.site.loads[0].to).toEqual({ x: 4, y: 2, z: 4, yaw: 90 });
  });

  it("adds an obstacle by its minimum corner and its size", () => {
    const s = st.addObstacle(
      st.clearObstacles(title()),
      point(1, 0, 2),
      point(3, 4, 5),
    );
    expect(s.site.obstacles).toEqual([
      { min: { x: 1, y: 0, z: 2 }, size: { x: 3, y: 4, z: 5 } },
    ]);
  });
});

describe("the run poses", () => {
  const running = (): GantryState => {
    const s = title();
    s.run.phase = "running";
    s.run.loads = [
      { phase: "waiting", pos: point(1, 2, 3), yaw: 0 },
      { phase: "waiting", pos: point(4, 2, 5), yaw: 0 },
    ];
    s.site.loads = [
      {
        class: "crate",
        mass: 10,
        from: { x: 1, y: 2, z: 3, yaw: 0 },
        to: { x: 7, y: 2, z: 8, yaw: 30 },
      },
      {
        class: "crate",
        mass: 10,
        from: { x: 4, y: 2, z: 5, yaw: 0 },
        to: { x: 9, y: 2, z: 9, yaw: 0 },
      },
    ];
    return s;
  };

  it("sets an axis's value, stopping it with no command", () => {
    const s = st.setAxis(running(), "slew", 42);
    expect(s.run.axes.slew).toEqual({ value: 42, rate: 0, command: null });
  });

  it("sets an axis's rate, leaving its value and command as they are", () => {
    const posed = running();
    posed.run.axes.trolley = {
      value: 3,
      rate: 0,
      command: { target: 5, rate: 1 },
    };
    const s = st.setAxisRate(posed, "trolley", -2);
    expect(s.run.axes.trolley).toEqual({
      value: 3,
      rate: -2,
      command: { target: 5, rate: 1 },
    });
  });

  it("attaches a load, and refuses one while another is attached", () => {
    let s = st.setLoadPhase(running(), 0, "attached");
    expect(s.run.attached).toBe(0);
    const refused = st.setLoadPhase(s, 1, "attached");
    expect(refused.run.attached).toBe(0);
    expect(refused.run.loads[1].phase).toBe("waiting");
    s = st.setLoadPhase(s, 0, "waiting");
    expect(s.run.attached).toBeNull();
  });

  it("places a load at exactly its target pose", () => {
    const s = st.setLoadPhase(running(), 0, "placed");
    expect(s.run.loads[0].pos).toEqual(point(7, 2, 8));
    expect(s.run.loads[0].yaw).toBe(30);
  });

  it("leaves a load where it stands when it comes off the hook", () => {
    let s = st.setLoadPhase(running(), 1, "attached");
    s = st.setLoadPose(s, 1, point(0, 9, 0), 15);
    s = st.setLoadPhase(s, 1, "lost");
    expect(s.run.loads[1].pos).toEqual(point(0, 9, 0));
    expect(s.run.loads[1].yaw).toBe(15);
    expect(s.run.attached).toBeNull();
  });

  it("aborts a run in progress and leaves an idle one alone", () => {
    const aborted = st.abortRun(running());
    expect(aborted.run.phase).toBe("idle");
    expect(aborted.screen).toBe("build");
    const idle = st.setScreen(title(), "run");
    expect(st.abortRun(idle).screen).toBe("run");
  });

  it("refuses a run the readiness rules would refuse", () => {
    expect(st.beginRun(title())).toBeNull();
  });
});
