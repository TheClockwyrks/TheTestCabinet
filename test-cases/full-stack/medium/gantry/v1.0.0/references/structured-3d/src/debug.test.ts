import { describe, expect, it } from "vitest";
import {
  GANTRY_DEBUG_VERSION,
  RUN_SPEEDS,
  SITES,
  SITE_COUNT,
  SITE_NAMES,
} from "./constants";
import { createDebugSurface } from "./debug";
import { GantryState, type GantryDebugApi } from "./game";
import { silentIo } from "./io";
import { menuRects } from "./menus";
import * as st from "./state";

interface Harness {
  state: GantryState;
  debug: GantryDebugApi;
  cues: string[];
}

function harness(): Harness {
  const state = new GantryState();
  const cues: string[] = [];
  const base = silentIo();
  const debug = createDebugSurface({
    state: () => state,
    io: { ...base, playCue: (cue) => cues.push(cue) },
  });
  return { state, debug, cues };
}

/**
 * A harness on a site's build screen, which is where the editor poses land.
 *
 * `openSite` carries the opening `specs/state.md` fixes and leaves the screen
 * alone, so the build screen is the caller's second call
 * (`specs/instrumentation.md`) — the same pair entering a site from the select
 * screen is.
 */
function onSite(index = 0): Harness {
  const h = harness();
  h.debug.openSite(index);
  h.debug.setScreen("build");
  return h;
}

describe("the surface", () => {
  it("carries the documented version", () => {
    expect(harness().debug.version).toBe(GANTRY_DEBUG_VERSION);
  });
});

describe("snapshot", () => {
  it("reports the whole documented shape at its resting values", () => {
    const s = harness().debug.snapshot();
    expect(s.version).toBe(GANTRY_DEBUG_VERSION);
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.siteIndex).toBe(0);
    expect(s.cleared).toEqual(Array.from({ length: SITE_COUNT }, () => false));
    expect(s.best).toEqual(Array.from({ length: SITE_COUNT }, () => null));
    expect(s.site.name).toBe(SITE_NAMES[0]);
    expect(s.site.budget).toBe(SITES[0].budget);
    expect(s.site.par).toEqual({
      cost: SITES[0].par.cost,
      time: SITES[0].par.time,
    });
    expect(s.site.envelope.min).toEqual({
      x: SITES[0].envelope.x.min,
      y: SITES[0].envelope.y.min,
      z: SITES[0].envelope.z.min,
    });
    expect(s.site.anchors).toHaveLength(SITES[0].anchors.length);
    expect(s.site.loads[0].class).toBe(SITES[0].loads[0].class);
    expect(s.tool).toBe("strut");
    expect(s.pendingNode).toBeNull();
    expect(s.historyDepth).toBe(0);
    expect(s.camera).toEqual(st.startCamera());
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
    expect(s.run.phase).toBe("idle");
    expect(s.run.tick).toBe(0);
    expect(s.run.time).toBe(0);
    expect(s.run.loads).toEqual([]);
    expect(s.run.forces).toEqual([]);
    expect(s.run.broken).toEqual([]);
    expect(s.run.pivot).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.run.axes.slew).toEqual({ value: 0, rate: 0, command: null });
    expect(s.muted).toBe(false);
    expect(s.simTime).toBe(0);
  });

  it("hands back values the caller owns", () => {
    const h = harness();
    const first = h.debug.snapshot();
    first.cleared[0] = true;
    first.camera.yaw = 999;
    expect(h.state.cleared[0]).toBe(false);
    expect(h.debug.snapshot().camera.yaw).toBe(st.startCamera().yaw);
  });

  it("reports pick as nothing on every screen but build", () => {
    const h = onSite();
    h.debug.setScreen("program");
    expect(h.debug.snapshot().pick).toEqual({ node: null, member: null });
  });
});

describe("check", () => {
  it("reports the check and displays nothing", () => {
    const h = onSite();
    const result = h.debug.check();
    expect(result.issues).toEqual(["no-ring", "no-rail", "empty-program"]);
    expect(result.stable).toBe(false);
    expect(result.members).toEqual([]);
    expect(result.budget).toBe(SITES[0].budget);
    expect(h.debug.snapshot().checkResult).toBeNull();
  });
});

describe("the screens", () => {
  it("shows a named screen and sets nothing else", () => {
    const h = harness();
    h.debug.setMenuIndex(1);
    h.debug.setScreen("select");
    expect(h.debug.snapshot().screen).toBe("select");
    expect(h.debug.snapshot().menuIndex).toBe(1);
  });

  it("refuses a screen outside the seven", () => {
    expect(() => harness().debug.setScreen("yard")).toThrow(/screen/);
  });

  it("sets the menu index only on the three screens with a menu", () => {
    const h = harness();
    h.debug.setMenuIndex(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    expect(() => h.debug.setMenuIndex(9)).toThrow(/index/);
    h.debug.setScreen("build");
    h.debug.setMenuIndex(9);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    expect(() => h.debug.setMenuIndex(1.5)).toThrow(/integer/);
  });

  it("opens a site and leaves the screen as it stands", () => {
    const h = harness();
    h.debug.openSite(2);
    const s = h.debug.snapshot();
    // The call was made on the title screen, and `openSite` carries the
    // opening `specs/state.md` fixes and nothing else.
    expect(s.screen).toBe("title");
    expect(s.siteIndex).toBe(2);
    expect(s.site.name).toBe(SITE_NAMES[2]);
    expect(s.site.obstacles).toHaveLength(SITES[2].obstacles.length);
    expect(() => h.debug.openSite(SITE_COUNT)).toThrow(/index/);
  });

  it("reports the hit region of an entry of the menu showing", () => {
    // The reading is the layout `src/menus.ts` draws at, so what it answers is
    // where the entry actually is (`specs/instrumentation.md`).
    const h = harness();
    expect(h.debug.menuItemRect(1)).toEqual(menuRects(h.state)[1]);
    // A screen showing no menu, and an index the menu has no entry at, are
    // both outside the domain.
    expect(() => h.debug.menuItemRect(2)).toThrow();
    expect(() => h.debug.menuItemRect(-1)).toThrow();
    h.debug.setScreen("howto");
    expect(() => h.debug.menuItemRect(0)).toThrow();
  });

  it("poses the check action on the build screen alone", () => {
    const h = onSite(0);
    h.debug.showCheck();
    expect(h.debug.snapshot().checkResult).toEqual(h.debug.check());
    // The `check` action reaches the build screen and nothing else, and so
    // does this pose (`specs/instrumentation.md`).
    const elsewhere = harness();
    elsewhere.debug.showCheck();
    expect(elsewhere.debug.snapshot().checkResult).toBeNull();
  });

  it("sets and clears a site's cleared flag and its best score", () => {
    const h = harness();
    h.debug.setCleared(1, true);
    h.debug.setBest(1, 100, 20);
    expect(h.debug.snapshot().cleared[1]).toBe(true);
    expect(h.debug.snapshot().best[1]).toEqual({ cost: 100, time: 20 });
    h.debug.clearBest(1);
    expect(h.debug.snapshot().best[1]).toBeNull();
    expect(() => h.debug.setCleared(0, 1 as unknown as boolean)).toThrow(
      /boolean/,
    );
  });

  it("sets the camera through the orbit's own limits", () => {
    const h = harness();
    h.debug.setCamera(-30, 500, 5);
    expect(h.debug.snapshot().camera).toEqual({
      yaw: 330,
      pitch: 80,
      dist: 10,
    });
    expect(() => h.debug.setCamera(Number.NaN, 0, 0)).toThrow(/yaw/);
  });

  it("returns to the title state on reset, leaving muted alone", () => {
    const h = onSite(3);
    h.state.muted = true;
    h.debug.setTool("delete");
    h.debug.setCleared(0, true);
    h.debug.reset();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("title");
    expect(s.siteIndex).toBe(0);
    expect(s.tool).toBe("strut");
    expect(s.cleared[0]).toBe(false);
    expect(s.muted).toBe(true);
  });
});

describe("the structure poses", () => {
  it("places a member, giving it the next id, and pushes the history", () => {
    const h = onSite();
    h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
    const s = h.debug.snapshot();
    expect(s.structure.members).toEqual([
      {
        id: 0,
        a: { x: 0, y: 0, z: 0 },
        b: { x: 0, y: 2, z: 0 },
        material: "strut",
      },
    ]);
    expect(s.structure.nextMemberId).toBe(1);
    expect(s.historyDepth).toBe(1);
    expect(h.cues).toEqual(["place"]);
  });

  it("fails loudly on a coordinate off the lattice", () => {
    const h = onSite();
    expect(() => h.debug.addMember(0, 1, 0, 0, 2, 0, "strut")).toThrow(
      /lattice node/,
    );
    expect(() => h.debug.setRing(1, 2, 0)).toThrow(/lattice node/);
    expect(() => h.debug.addCounterweight(0, 0, 3)).toThrow(/lattice node/);
  });

  it("fails loudly on a material and an id nothing carries", () => {
    const h = onSite();
    expect(() => h.debug.addMember(0, 0, 0, 0, 2, 0, "rope")).toThrow(
      /material/,
    );
    expect(() => h.debug.removeMember(4)).toThrow(/no member carries id 4/);
  });

  it("is refused silently where the editor refuses the edit", () => {
    const h = onSite();
    h.debug.addMember(0, 0, 0, 40, 0, 0, "strut");
    expect(h.debug.snapshot().structure.members).toEqual([]);
    expect(h.debug.snapshot().historyDepth).toBe(0);
    expect(h.cues).toEqual([]);
  });

  it("does nothing on a screen that is not build", () => {
    const h = onSite();
    h.debug.setScreen("program");
    h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
    h.debug.setRing(0, 2, 0);
    h.debug.setTool("delete");
    h.debug.setPendingNode(0, 2, 0);
    const s = h.debug.snapshot();
    expect(s.structure.members).toEqual([]);
    expect(s.structure.ring).toBeNull();
    expect(s.tool).toBe("strut");
    expect(s.pendingNode).toBeNull();
  });

  it("holds and clears a pending node", () => {
    const h = onSite();
    h.debug.setPendingNode(0, 2, 0);
    expect(h.debug.snapshot().pendingNode).toEqual({ x: 0, y: 2, z: 0 });
    h.debug.clearPendingNode();
    expect(h.debug.snapshot().pendingNode).toBeNull();
  });

  it("empties the structure and returns the next id to 0", () => {
    const h = onSite();
    h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
    h.debug.clearStructure();
    const s = h.debug.snapshot();
    expect(s.structure.members).toEqual([]);
    expect(s.structure.nextMemberId).toBe(0);
    h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
    expect(h.debug.snapshot().structure.members[0].id).toBe(0);
  });
});

describe("the tape poses", () => {
  it("appends steps and commands on the program screen alone", () => {
    const h = onSite();
    h.debug.addMoveStep("slew", 90, 10);
    expect(h.debug.snapshot().program).toEqual([]);
    h.debug.setScreen("program");
    h.debug.addMoveStep("slew", 90, 10);
    h.debug.addCommand(0, "hoist", 6, 2);
    h.debug.addActionStep("attach");
    expect(h.debug.snapshot().program).toEqual([
      {
        kind: "move",
        commands: [
          { axis: "slew", target: 90, rate: 10 },
          { axis: "hoist", target: 6, rate: 2 },
        ],
      },
      { kind: "action", action: "attach" },
    ]);
    h.debug.removeStep(0);
    h.debug.clearProgram();
    expect(h.debug.snapshot().program).toEqual([]);
  });

  it("fails loudly on an axis, an action, and an index nothing carries", () => {
    const h = onSite();
    h.debug.setScreen("program");
    expect(() => h.debug.addMoveStep("boom", 1, 1)).toThrow(/axis/);
    expect(() => h.debug.addActionStep("grab")).toThrow(/action/);
    expect(() => h.debug.addCommand(0, "slew", 1, 1)).toThrow(/index/);
    expect(() => h.debug.removeStep(0)).toThrow(/index/);
  });

  it("is refused silently on a rate the editor refuses", () => {
    const h = onSite();
    h.debug.setScreen("program");
    h.debug.addMoveStep("slew", 90, 90);
    expect(h.debug.snapshot().program).toEqual([]);
  });
});

describe("the site poses", () => {
  it("clears and adds loads and obstacles on build and program", () => {
    const h = onSite();
    h.debug.clearLoads();
    h.debug.clearObstacles();
    h.debug.addLoad("drum", 90, 4, 3, 0, 45);
    h.debug.setLoadTarget(0, -4, 3, 0, 90);
    h.debug.addObstacle(1, 0, 2, 3, 4, 5);
    const s = h.debug.snapshot();
    expect(s.site.loads).toEqual([
      {
        class: "drum",
        mass: 90,
        from: { x: 4, y: 3, z: 0, yaw: 45 },
        to: { x: -4, y: 3, z: 0, yaw: 90 },
      },
    ]);
    expect(s.site.obstacles).toEqual([
      { min: { x: 1, y: 0, z: 2 }, size: { x: 3, y: 4, z: 5 } },
    ]);
  });

  it("fails loudly on a class and an index nothing carries", () => {
    const h = onSite();
    expect(() => h.debug.addLoad("barrel", 1, 0, 0, 0, 0)).toThrow(/cls/);
    expect(() => h.debug.setLoadTarget(9, 0, 0, 0, 0)).toThrow(/index/);
  });

  it("does nothing on the title screen", () => {
    const h = harness();
    const before = h.debug.snapshot().site.loads.length;
    h.debug.clearLoads();
    expect(h.debug.snapshot().site.loads).toHaveLength(before);
  });
});

describe("the run poses", () => {
  it("do nothing with no run in progress", () => {
    const h = onSite();
    h.debug.setAxis("slew", 45);
    h.debug.setAxisRate("slew", 3);
    h.debug.setBob(1, 2, 3);
    h.debug.setBobVelocity(1, 2, 3);
    const s = h.debug.snapshot();
    expect(s.run.axes.slew).toEqual({ value: 0, rate: 0, command: null });
    expect(s.run.bob.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("pose the axes and the bob while one is running", () => {
    const h = onSite();
    h.state.run.phase = "running";
    h.debug.setAxis("slew", 45);
    h.debug.setAxisRate("hoist", -2);
    h.debug.setBob(1, 2, 3);
    h.debug.setBobVelocity(4, 5, 6);
    const s = h.debug.snapshot();
    expect(s.run.axes.slew).toEqual({ value: 45, rate: 0, command: null });
    expect(s.run.axes.hoist.rate).toBe(-2);
    expect(s.run.bob).toEqual({
      pos: { x: 1, y: 2, z: 3 },
      vel: { x: 4, y: 5, z: 6 },
    });
  });

  it("pose a load's pose and its phase, index-checked", () => {
    const h = onSite();
    h.state.run.phase = "running";
    h.state.run.loads = [
      { phase: "waiting", pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    ];
    h.debug.setLoadPose(0, 1, 2, 3, 90);
    h.debug.setLoadPhase(0, "attached");
    const s = h.debug.snapshot();
    expect(s.run.loads[0]).toEqual({
      phase: "attached",
      pos: { x: 1, y: 2, z: 3 },
      yaw: 90,
    });
    expect(s.run.attached).toBe(0);
    expect(() => h.debug.setLoadPhase(0, "hanging")).toThrow(/phase/);
    expect(() => h.debug.setLoadPose(1, 0, 0, 0, 0)).toThrow(/index/);
  });

  it("sets the watch speed on the run screen alone", () => {
    const h = onSite();
    h.debug.setSpeedIndex(2);
    expect(h.debug.snapshot().run.speedIndex).toBe(0);
    h.debug.setScreen("run");
    h.debug.setSpeedIndex(2);
    expect(h.debug.snapshot().run.speedIndex).toBe(2);
    expect(() => h.debug.setSpeedIndex(RUN_SPEEDS.length)).toThrow(/index/);
  });
});

describe("startRun and abortRun", () => {
  it("refuses a start the run action would refuse, changing nothing", () => {
    const h = onSite();
    h.debug.startRun();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("build");
    expect(s.run.phase).toBe("idle");
    expect(h.cues).toEqual([]);
  });

  it("does nothing on a screen the run action does not apply on", () => {
    const h = harness();
    h.debug.startRun();
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("aborts only a run in progress", () => {
    const h = onSite();
    h.debug.setScreen("run");
    h.debug.abortRun();
    expect(h.debug.snapshot().screen).toBe("run");
    h.state.run.phase = "running";
    h.state.run.tick = 12;
    h.debug.abortRun();
    const s = h.debug.snapshot();
    expect(s.screen).toBe("build");
    expect(s.run.phase).toBe("idle");
    expect(s.run.tick).toBe(0);
  });
});
