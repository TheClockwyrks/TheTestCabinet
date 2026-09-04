// The debug and automation surface: the domains it refuses, the screens each
// pose applies on, the silence of a refusal, and the snapshot's fixed shape.

import { describe, expect, it } from "vitest";
import {
  GANTRY_DEBUG_VERSION,
  RUN_SPEEDS,
  SITE_COUNT,
  SITES,
  SITE_NAMES,
  TICK_HZ,
} from "./constants";
import { point } from "./convert";
import { createDebugSurface } from "./debug";
import type { GantryState } from "./game";
import { menuRects } from "./menus";
import { setScreen, titleState } from "./state";

const debug = createDebugSurface();

/**
 * Enter a site the way the select screen does: `openSite` carries the opening
 * `specs/state.md` fixes and leaves the screen alone, so the build screen is
 * the caller's second call (`specs/instrumentation.md`).
 */
const enterSite = (index: number): GantryState =>
  debug.setScreen(debug.openSite(titleState(), index), "build");

/** Site 0, opened on the build screen. */
const yard = (): GantryState => enterSite(0);

describe("the surface itself", () => {
  it("carries the version the constants fix", () => {
    expect(debug.version).toBe(GANTRY_DEBUG_VERSION);
    expect(debug.snapshot(titleState()).version).toBe(GANTRY_DEBUG_VERSION);
  });

  it("carries no operation for the clock, the input, or the projection", () => {
    const surface = debug as unknown as Record<string, unknown>;
    for (const absent of [
      "setAutoStep",
      "advance",
      "project",
      "pointerMove",
      "pointerDown",
      "pointerUp",
      "keyDown",
      "keyUp",
    ]) {
      expect(surface[absent]).toBeUndefined();
    }
  });
});

describe("an argument outside its domain", () => {
  it("fails loudly on a coordinate off the lattice", () => {
    expect(() => debug.setRing(yard(), 1, 2, 0)).toThrow(/lattice node/);
    expect(() => debug.addMember(yard(), 0, 0, 0, 0, 3, 0, "strut")).toThrow(
      /lattice node/,
    );
    expect(() => debug.addCounterweight(yard(), 0, 0, 0.5)).toThrow();
  });

  it("fails loudly on an index nothing carries", () => {
    expect(() => debug.openSite(titleState(), SITE_COUNT)).toThrow();
    expect(() => debug.openSite(titleState(), -1)).toThrow();
    expect(() => debug.setCleared(titleState(), 1.5, true)).toThrow();
    expect(() =>
      debug.setSpeedIndex(setScreen(titleState(), "run"), RUN_SPEEDS.length),
    ).toThrow();
  });

  it("fails loudly on an id no member carries", () => {
    expect(() => debug.removeMember(yard(), 3)).toThrow(/no member carries/);
  });

  it("fails loudly on a name outside its vocabulary", () => {
    expect(() => debug.setScreen(titleState(), "nowhere")).toThrow();
    expect(() => debug.setTool(yard(), "hammer")).toThrow();
    expect(() => debug.addMember(yard(), 0, 0, 0, 0, 2, 0, "rope")).toThrow();
    expect(() =>
      debug.addMoveStep(setScreen(titleState(), "program"), "boom", 1, 1),
    ).toThrow();
    expect(() =>
      debug.addActionStep(setScreen(titleState(), "program"), "grab"),
    ).toThrow();
  });

  it("fails loudly on a value that is not a finite number", () => {
    expect(() => debug.setCamera(titleState(), Number.NaN, 30, 40)).toThrow();
    expect(() =>
      debug.setBest(titleState(), 0, Number.POSITIVE_INFINITY, 1),
    ).toThrow();
  });

  it("fails loudly on a flag that is not a boolean", () => {
    expect(() =>
      debug.setCleared(titleState(), 0, "yes" as unknown as boolean),
    ).toThrow();
  });
});

describe("a pose off the screens its section names", () => {
  it("does nothing, and the state comes back equal", () => {
    const title = titleState();
    for (const posed of [
      debug.clearStructure(title),
      debug.addMember(title, 0, 0, 0, 0, 2, 0, "strut"),
      debug.setRing(title, 0, 2, 0),
      debug.clearRing(title),
      debug.setTool(title, "cable"),
      debug.setPendingNode(title, 0, 0, 0),
      debug.clearPendingNode(title),
      debug.clearProgram(title),
      debug.addMoveStep(title, "slew", 90, 10),
      debug.addActionStep(title, "attach"),
      debug.clearLoads(title),
      debug.clearObstacles(title),
      debug.addObstacle(title, 0, 0, 0, 1, 1, 1),
      debug.setAxis(title, "slew", 4),
      debug.setBob(title, 1, 1, 1),
      debug.setSpeedIndex(title, 1),
      debug.startRun(title),
      debug.abortRun(title),
    ]) {
      expect(posed).toEqual(title);
    }
  });

  it("leaves the menu index alone on the four screens with no menu", () => {
    const build = debug.setMenuIndex(yard(), 4);
    expect(build.menuIndex).toBe(titleState().menuIndex);
  });

  it("takes the menu index on the three screens that show one", () => {
    const select = debug.setMenuIndex(setScreen(titleState(), "select"), 3);
    expect(select.menuIndex).toBe(3);
    expect(() =>
      debug.setMenuIndex(setScreen(titleState(), "select"), SITE_COUNT),
    ).toThrow();
  });
});

describe("a pose the player's act would be refused", () => {
  it("is refused silently: nothing is placed and no cost is spent", () => {
    const before = yard();
    const after = debug.addMember(before, 0, 0, 0, 100, 0, 0, "strut");
    expect(debug.snapshot(after).structure).toEqual(
      debug.snapshot(before).structure,
    );
    expect(after.cues).toEqual([]);
  });

  it("refuses a start the readiness rules refuse, and begins no run", () => {
    const after = debug.startRun(yard());
    expect(after.run.phase).toBe("idle");
    expect(after.screen).toBe("build");
    expect(debug.check(after).issues).toContain("no-ring");
  });
});

describe("openSite", () => {
  it("opens a locked site and leaves the screen as it stands", () => {
    const s = debug.openSite(titleState(), 4);
    expect(s.siteIndex).toBe(4);
    // The call was made from the title screen, and `openSite` carries the
    // opening `specs/state.md` fixes and nothing else.
    expect(s.screen).toBe("title");
    expect(debug.snapshot(s).site.name).toBe(SITE_NAMES[4]);
    expect(debug.snapshot(s).site.budget).toBe(SITES[4].budget);
  });
});

describe("menuItemRect", () => {
  it("reports the hit region of an entry of the menu showing", () => {
    // The reading is the layout `src/menus.ts` draws at, so what it answers is
    // where the entry actually is (`specs/instrumentation.md`).
    const s = titleState();
    expect(debug.menuItemRect(s, 1)).toEqual(menuRects(s)[1]);
    // A screen showing no menu, and an index the menu has no entry at, are
    // both outside the domain.
    expect(() => debug.menuItemRect(s, 2)).toThrow();
    expect(() => debug.menuItemRect(s, -1)).toThrow();
    expect(() => debug.menuItemRect(setScreen(s, "howto"), 0)).toThrow();
  });
});

describe("showCheck", () => {
  it("leaves the check the action would show, on the build screen alone", () => {
    const shown = debug.showCheck(yard());
    expect(shown.checkResult).not.toBeNull();
    expect(debug.snapshot(shown).checkResult).toEqual(debug.check(shown));
    // The `check` action reaches the build screen and nothing else, and so
    // does this pose (`specs/instrumentation.md`).
    expect(debug.showCheck(titleState()).checkResult).toBeNull();
    expect(
      debug.showCheck(setScreen(yard(), "program")).checkResult,
    ).toBeNull();
  });
});

describe("reset", () => {
  it("restores every field but muted", () => {
    let s = enterSite(2);
    s = debug.setRing(s, 0, 2, 0);
    s = debug.setTool(s, "delete");
    s = debug.setCleared(s, 0, true);
    s = debug.setBest(s, 0, 10, 20);
    s = debug.setCamera(s, 123, 45, 30);
    s.muted = true;
    s.simTime = 99;

    const back = debug.reset(s);
    const fresh = titleState();
    expect(back.muted).toBe(true);
    back.muted = false;
    expect(back).toEqual(fresh);
  });
});

describe("check", () => {
  it("is pure: it never sets the result the build screen is showing", () => {
    const s = yard();
    const report = debug.check(s);
    expect(report.issues).toContain("no-ring");
    expect(s.checkResult).toBeNull();
    expect(debug.snapshot(s).checkResult).toBeNull();
  });

  it("reports the cost against the site's budget", () => {
    expect(debug.check(yard()).budget).toBe(SITES[0].budget);
    expect(debug.check(yard()).cost).toBe(0);
  });
});

describe("the snapshot", () => {
  it("reports the whole documented shape at its resting values", () => {
    const snapshot = debug.snapshot(titleState());
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "best",
        "camera",
        "checkResult",
        "cleared",
        "historyDepth",
        "menuIndex",
        "muted",
        "pendingNode",
        "pick",
        "pointer",
        "program",
        "run",
        "screen",
        "simTime",
        "site",
        "siteIndex",
        "structure",
        "tool",
        "version",
      ].sort(),
    );
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.pendingNode).toBeNull();
    expect(snapshot.historyDepth).toBe(0);
    expect(snapshot.pointer).toEqual({
      x: 0,
      y: 0,
      down: false,
      pressX: 0,
      pressY: 0,
      dragging: false,
    });
    expect(snapshot.pick).toEqual({ node: null, member: null });
    expect(snapshot.checkResult).toBeNull();
    expect(snapshot.run.phase).toBe("idle");
    expect(snapshot.run.time).toBe(0);
    expect(snapshot.run.loads).toEqual([]);
    expect(snapshot.muted).toBe(false);
    expect(snapshot.simTime).toBe(0);
  });

  it("reports the open site's own figures and the yard as it stands", () => {
    const s = enterSite(2);
    const site = debug.snapshot(s).site;
    expect(site.name).toBe(SITE_NAMES[2]);
    expect(site.envelope.min).toEqual(point(-10, 0, -8));
    expect(site.envelope.max).toEqual(point(12, 18, 8));
    expect(site.anchors).toHaveLength(SITES[2].anchors.length);
    expect(site.par).toEqual(SITES[2].par);
    expect(site.loads[0].class).toBe("crate");
    expect(site.obstacles).toEqual([
      { min: point(5, 0, -6), size: point(1, 8, 12) },
    ]);
  });

  it("reports the structure, its cost, and its readiness issues", () => {
    let s = debug.setRing(yard(), 0, 2, 0);
    s = debug.addMember(s, 0, 0, 0, 0, 2, 0, "strut");
    const structure = debug.snapshot(s).structure;
    expect(structure.ring).toEqual({ corner: point(0, 2, 0) });
    expect(structure.members).toHaveLength(1);
    expect(structure.nextMemberId).toBe(1);
    expect(structure.cost).toBeGreaterThan(0);
    expect(structure.issues).toContain("no-rail");
    expect(structure.issues).not.toContain("empty-program");
  });

  it("reports a pick only on the build screen", () => {
    const s = yard();
    s.pointer.x = 640;
    s.pointer.y = 360;
    expect(debug.snapshot(s).pick.node).not.toBeNull();
    expect(debug.snapshot(setScreen(s, "program")).pick).toEqual({
      node: null,
      member: null,
    });
  });

  it("reports the run clock as tick over TICK_HZ", () => {
    const s = titleState();
    s.run.tick = 90;
    expect(debug.snapshot(s).run.time).toBeCloseTo(90 / TICK_HZ, 12);
  });

  it("is a value of its own: writing it changes nothing", () => {
    const s = yard();
    const snapshot = debug.snapshot(s);
    snapshot.cleared[0] = true;
    snapshot.camera.yaw = 0;
    expect(s.cleared[0]).toBe(false);
    expect(s.camera.yaw).not.toBe(0);
  });
});

describe("the run in progress", () => {
  /** A run posed as in progress, with two loads standing in the yard. */
  const running = (): GantryState => {
    const s = enterSite(0);
    s.screen = "run";
    s.run.phase = "running";
    s.run.loads = [{ phase: "waiting", pos: point(10, 2, 0), yaw: 0 }];
    return s;
  };

  it("sets an axis, its rate, the bob, and a load's pose", () => {
    let s = debug.setAxis(running(), "hoist", 9);
    expect(debug.snapshot(s).run.axes.hoist).toEqual({
      value: 9,
      rate: 0,
      command: null,
    });
    s = debug.setAxisRate(s, "hoist", -2);
    expect(debug.snapshot(s).run.axes.hoist.rate).toBe(-2);
    s = debug.setBob(s, 1, 8, 2);
    s = debug.setBobVelocity(s, 0, -1, 0);
    expect(debug.snapshot(s).run.bob).toEqual({
      pos: point(1, 8, 2),
      vel: point(0, -1, 0),
    });
    s = debug.setLoadPose(s, 0, 3, 4, 5, 45);
    expect(debug.snapshot(s).run.loads[0]).toEqual({
      phase: "waiting",
      pos: point(3, 4, 5),
      yaw: 45,
    });
  });

  it("hangs a load on the hook and takes it off again", () => {
    let s = debug.setLoadPhase(running(), 0, "attached");
    expect(debug.snapshot(s).run.attached).toBe(0);
    s = debug.setLoadPhase(s, 0, "placed");
    expect(debug.snapshot(s).run.attached).toBeNull();
    expect(debug.snapshot(s).run.loads[0].pos).toEqual(point(0, 2, 10));
  });

  it("sets the watch speed on the run screen, ended or not", () => {
    const ended = enterSite(0);
    ended.screen = "run";
    ended.run.phase = "failed";
    expect(debug.setSpeedIndex(ended, 2).run.speedIndex).toBe(2);
  });

  it("refuses a run pose while no run is in progress", () => {
    const idle = enterSite(0);
    idle.screen = "run";
    expect(debug.setAxis(idle, "hoist", 9)).toEqual(idle);
    expect(debug.setBob(idle, 1, 1, 1)).toEqual(idle);
  });

  it("refuses a site pose while a run is in progress", () => {
    const s = running();
    s.screen = "build";
    expect(debug.clearLoads(s)).toEqual(s);
    expect(debug.addObstacle(s, 0, 0, 0, 1, 1, 1)).toEqual(s);
  });

  it("aborts a run in progress back to the build screen", () => {
    const back = debug.abortRun(running());
    expect(back.run.phase).toBe("idle");
    expect(back.screen).toBe("build");
  });
});

describe("the site poses", () => {
  it("hold only what a scenario is about", () => {
    let s = enterSite(4);
    s = debug.clearLoads(s);
    s = debug.clearObstacles(s);
    expect(debug.snapshot(s).site.loads).toEqual([]);
    expect(debug.snapshot(s).site.obstacles).toEqual([]);
    s = debug.addLoad(s, "drum", 50, 2, 3, 4, 90);
    s = debug.setLoadTarget(s, 0, -2, 3, -4, 0);
    s = debug.addObstacle(s, 1, 0, 1, 2, 3, 4);
    const site = debug.snapshot(s).site;
    expect(site.loads[0]).toEqual({
      class: "drum",
      mass: 50,
      from: { x: 2, y: 3, z: 4, yaw: 90 },
      to: { x: -2, y: 3, z: -4, yaw: 0 },
    });
    expect(site.obstacles[0]).toEqual({
      min: point(1, 0, 1),
      size: point(2, 3, 4),
    });
  });

  it("are the site's, so nothing built is disturbed", () => {
    let s = debug.setRing(enterSite(0), 0, 2, 0);
    const before = debug.snapshot(s).structure;
    s = debug.addObstacle(s, 0, 0, 0, 4, 4, 4);
    expect(debug.snapshot(s).structure).toEqual(before);
  });
});

describe("every pose", () => {
  it("leaves the state it was handed exactly as it was", () => {
    const before = yard();
    const copy = structuredClone(before);
    debug.setRing(before, 0, 2, 0);
    debug.setTool(before, "rail");
    debug.setCamera(before, 10, 20, 30);
    debug.setCleared(before, 1, true);
    debug.reset(before);
    expect(before).toEqual(copy);
  });
});
