// The debug and automation surface: every operation a pose or a reading over
// RefractState, exactly as specs/instrumentation.md fixes them. Here the pose
// operations are driven directly, state in and state out, and the installed
// `window.__refract` object is checked over a host of the test's own; the
// wiring over the real runtime — the clock included — is covered in
// game.test.ts.

import { describe, expect, it } from "vitest";
import { cellCenter } from "./board";
import { DEFAULT_SEED, REFRACT_DEBUG_VERSION } from "./constants";
import {
  createDebugApi,
  createWindowApi,
  installDebugApi,
  REFRACT_HANDLE,
  type DebugHost,
} from "./debug";
import { createInitialState } from "./flow";
import type { RefractState } from "./game";

const debug = createDebugApi();

function fresh(): RefractState {
  return createInitialState();
}

/**
 * A whole route drawn through the three pointer poses: a press at the first
 * cell's center, a move to each remaining center, then a release. The surface
 * carries no sugar for this — a route is a sequence, and a sequence belongs to
 * whoever is driving.
 */
function trace(
  state: RefractState,
  cells: readonly { col: number; row: number }[],
): RefractState {
  if (cells.length === 0) return state;
  const [firstX, firstY] = cellCenter(cells[0], state.board);
  let next = debug.pointerDown(state, firstX, firstY);
  for (const cell of cells.slice(1)) {
    const [x, y] = cellCenter(cell, next.board);
    next = debug.pointerMove(next, x, y);
  }
  return debug.pointerUp(next);
}

describe("the surface", () => {
  it("reports its version", () => {
    expect(debug.version).toBe(REFRACT_DEBUG_VERSION);
  });
});

describe("snapshot", () => {
  it("returns the fixed shape with resting values on the title screen", () => {
    const snapshot = debug.snapshot(fresh());
    expect(snapshot).toEqual({
      version: REFRACT_DEBUG_VERSION,
      screen: "title",
      mode: "campaign",
      menuIndex: 0,
      boardIndex: 0,
      solvedBoards: [],
      unlockedCount: 1,
      selectIndex: 0,
      solvedCount: 0,
      tier: 1,
      board: { cols: 1, rows: 1, nodes: [] },
      beams: {},
      solved: false,
      tracing: null,
      pointer: { x: 0, y: 0, down: false, device: "mouse" },
      targets: expect.any(Array),
      muted: false,
      simTime: 0,
      rngState: DEFAULT_SEED,
    });
  });

  it("derives node centers, spends, completeness, and the live end", () => {
    let state = debug.loadBoard(fresh(), ["T1T", "S.S"]);
    const [x, y] = cellCenter({ col: 1, row: 0 }, state.board);
    state = trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    state = debug.pointerDown(
      state,
      ...cellCenter({ col: 0, row: 1 }, state.board),
    );
    const snapshot = debug.snapshot(state);

    const crystal = snapshot.board.nodes.find(
      (node) => node.kind === "crystal",
    );
    expect(crystal).toMatchObject({ x, y, charges: 1, spent: 1 });
    const emitter = snapshot.board.nodes.find(
      (node) => node.kind === "emitter",
    );
    expect(emitter?.spent).toBeNull();

    expect(snapshot.beams.triangle).toEqual({
      cells: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
      complete: false,
    });
    expect(snapshot.beams.square).toMatchObject({ complete: false });
    expect(snapshot.beams.diamond).toBeUndefined();
    expect(snapshot.solved).toBe(false);
    expect(snapshot.tracing).toEqual({
      channel: "square",
      live: { col: 0, row: 1 },
    });
    expect(snapshot.pointer.down).toBe(true);
  });

  it("reports the live highlight indexes and their resting values", () => {
    const title = debug.snapshot({ ...fresh(), menuIndex: 2 });
    expect(title.menuIndex).toBe(2);

    const select = debug.snapshot({
      ...debug.setScreen(fresh(), "select"),
      selectIndex: 5,
    });
    expect(select.selectIndex).toBe(5);

    // On `playing` both rest at their documented values.
    const playing = debug.snapshot(debug.loadBoard(fresh(), ["TtT"]));
    expect(playing.menuIndex).toBe(0);
    expect(playing.selectIndex).toBe(0);

    for (const snapshot of [title, select, playing]) {
      expect(typeof snapshot.menuIndex).toBe("number");
      expect(typeof snapshot.selectIndex).toBe("number");
    }
  });
});

describe("reset", () => {
  it("restores every declared field, seeds the generator, and keeps mute", () => {
    let state = debug.loadBoard(fresh(), ["TtT"]);
    state = trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    state = { ...state, muted: true, simTime: 12.5 };

    const reset = debug.reset(state, { seed: 99 });
    expect(reset).toEqual({
      ...createInitialState(),
      muted: true,
      rngState: 99,
    });

    expect(debug.reset(state).rngState).toBe(DEFAULT_SEED);
  });
});

describe("setMode", () => {
  it("sets the mode field alone", () => {
    const posed = debug.setMode({ ...fresh(), simTime: 4.5 }, "cascade");
    expect(posed.mode).toBe("cascade");
    expect(posed).toEqual({ ...fresh(), simTime: 4.5, mode: "cascade" });
  });
});

describe("setScreen", () => {
  it("sets the screen field alone, leaving the board it was posed over", () => {
    const playing = debug.loadBoard(fresh(), ["TtT"]);
    const posed = debug.setScreen(playing, "solved");
    expect(posed.screen).toBe("solved");
    expect(posed).toEqual({ ...playing, screen: "solved", armedTarget: null });
  });

  it("leaves no pointer target armed", () => {
    const armed: RefractState = { ...fresh(), armedTarget: "menu-1" };
    expect(debug.setScreen(armed, "howto").armedTarget).toBeNull();
  });
});

describe("setMenuIndex", () => {
  it("sets the highlighted item alone", () => {
    const posed = debug.setMenuIndex(fresh(), 2);
    expect(posed.menuIndex).toBe(2);
    expect(posed).toEqual({ ...fresh(), menuIndex: 2 });
  });
});

describe("loadBoard", () => {
  it("poses a board onto playing with every beam empty and no trace live", () => {
    const state = debug.loadBoard(fresh(), ["T.S", "1.s", "T.S"]);
    expect(state.screen).toBe("playing");
    expect(state.board.cols).toBe(3);
    expect(state.beams.map((beam) => beam.channel)).toEqual([
      "triangle",
      "square",
    ]);
    expect(state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(state.tracing).toBeNull();
  });

  it("refuses notation the board rules cannot make sense of", () => {
    expect(() => debug.loadBoard(fresh(), ["T?T"])).toThrow(/"\?"/);
    expect(() => debug.loadBoard(fresh(), ["T.t"])).toThrow(/emitters/);
    expect(() => debug.loadBoard(fresh(), ["T".repeat(8)])).toThrow(/columns/);
  });
});

describe("the pointer operations", () => {
  it("take effect immediately, so a route draws with no frame between calls", () => {
    let state = debug.loadBoard(fresh(), ["TtT"]);
    const [x0, y0] = cellCenter({ col: 0, row: 0 }, state.board);
    state = debug.pointerDown(state, x0, y0);
    expect(state.tracing).toEqual({ channel: "triangle" });
    expect(state.pointer).toEqual({
      x: x0,
      y: y0,
      down: true,
      device: "mouse",
    });

    const [x1, y1] = cellCenter({ col: 1, row: 0 }, state.board);
    state = debug.pointerMove(state, x1, y1);
    expect(state.beams[0].cells).toHaveLength(2);

    state = debug.pointerUp(state);
    expect(state.tracing).toBeNull();
    expect(state.pointer.down).toBe(false);
  });
});

describe("a route drawn through the pointer poses", () => {
  it("draws a whole route and solves through the game's own rules", () => {
    let state = debug.loadBoard(fresh(), ["TtT"]);
    state = trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(debug.snapshot(state).solved).toBe(true);
    expect(state.screen).toBe("solved");
  });

  it("stops at the last permitted segment when the limits refuse the rest", () => {
    let state = debug.loadBoard(fresh(), ["TtT", "SsS"]);
    state = trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 1, row: 1 }, // square's lens: refused, live end stays at (1,0)
      { col: 2, row: 1 }, // square's emitter: refused from (1,0) as well
    ]);
    expect(debug.snapshot(state).beams.triangle?.cells).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(state.tracing).toBeNull();
  });

  it("is a no-op for an empty route", () => {
    const state = debug.loadBoard(fresh(), ["TtT"]);
    expect(trace(state, [])).toEqual(state);
  });
});

describe("reconcile", () => {
  it("re-derives a stored reading from a posed board", () => {
    // `loadBoard` writes the very thing five readings are functions of: the
    // board's dimensions (a node's `x`/`y`), the drawn beams (a crystal's
    // `spent`, a beam's `complete`, `solved`), and the screen (`targets`).
    let state = debug.loadBoard(fresh(), ["TtT"]);
    state = debug.reconcile(state);
    let read = debug.snapshot(state);
    for (const node of read.board.nodes) {
      const [x, y] = cellCenter(node, state.board);
      expect([node.x, node.y]).toEqual([x, y]);
    }
    expect(read.solved).toBe(false);
    expect(read.beams.triangle?.complete).toBe(false);

    // Draw the route the board is solved by, then reconcile and read again.
    state = trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    state = debug.reconcile(state);
    read = debug.snapshot(state);
    expect(read.solved).toBe(true);
    expect(read.beams.triangle?.complete).toBe(true);

    // A larger board: the cell centres move with the dimensions, so a stored
    // copy of them would still answer for the board before this pose.
    state = debug.reconcile(debug.loadBoard(state, ["T.S", "1.s", "T.S"]));
    read = debug.snapshot(state);
    expect(read.board.cols).toBe(3);
    expect(read.board.rows).toBe(3);
    for (const node of read.board.nodes) {
      const [x, y] = cellCenter(node, state.board);
      expect([node.x, node.y]).toEqual([x, y]);
    }
  });

  it("advances nothing, and reconciling twice matches reconciling once", () => {
    let state = debug.loadBoard(fresh(), ["TtT"]);
    state = trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    const before = debug.snapshot(state);
    const once = debug.reconcile(state);
    expect(debug.snapshot(once)).toEqual(before);
    expect(debug.snapshot(debug.reconcile(once))).toEqual(before);
    // Named explicitly, because "equal snapshots" is only as strong as the
    // clock, the generator and the live trace being in it.
    expect(once.simTime).toBe(state.simTime);
    expect(once.rngState).toBe(state.rngState);
    expect(once.screen).toBe(state.screen);
    expect(once.tracing).toEqual(state.tracing);
    expect(once.board).toBe(state.board);
  });
});

describe("clear", () => {
  it("empties every beam, from wherever the game stands", () => {
    let state = debug.loadBoard(fresh(), ["TtT"]);
    state = trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    const cleared = debug.clear(state);
    expect(cleared.beams[0].cells).toEqual([]);

    // The screen is how a PLAYER reaches the clear action, not a condition of
    // the operation: the beams go from the title screen too, and the screen is
    // left exactly where it was (specs/instrumentation.md, "The operations").
    let drawn = debug.loadBoard(fresh(), ["TtT"]);
    drawn = trace(drawn, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    const titled = debug.setScreen(drawn, "title");
    const off = debug.clear(titled);
    expect(off.beams[0].cells).toEqual([]);
    expect(off.tracing).toBeNull();
    expect(off.screen).toBe("title");
  });
});

// ---- The installed surface -----------------------------------------------

/** A host of the test's own: a held state and a clock that writes itself down. */
function fakeHost(): DebugHost & {
  held: { state: RefractState };
  clock: { autoStep: boolean[]; advanced: [number, number | undefined][] };
} {
  const held = { state: fresh() };
  const clock = {
    autoStep: [] as boolean[],
    advanced: [] as [number, number | undefined][],
  };
  return {
    held,
    clock,
    get state() {
      return held.state;
    },
    apply(pose) {
      held.state = pose(held.state);
    },
    setAutoStep(enabled) {
      clock.autoStep.push(enabled);
    },
    advance(seconds, frames) {
      clock.advanced.push([seconds, frames]);
    },
  };
}

describe("the installed surface", () => {
  it("applies each pose to the live state and reads the snapshot from it", () => {
    const host = fakeHost();
    const api = createWindowApi(host, debug);
    expect(api.version).toBe(REFRACT_DEBUG_VERSION);

    api.loadBoard(["TtT"]);
    expect(host.state.screen).toBe("playing");
    for (const [col, row] of [
      [0, 0],
      [1, 0],
      [2, 0],
    ] as const) {
      const [x, y] = cellCenter({ col, row }, host.state.board);
      if (col === 0) api.pointerDown(x, y);
      else api.pointerMove(x, y);
    }
    api.pointerUp();
    expect(api.snapshot().solved).toBe(true);

    api.reset({ seed: 7 });
    expect(host.state.rngState).toBe(7);
    expect(api.snapshot().rngState).toBe(7);
    api.setMode("cascade");
    expect(host.state.mode).toBe("cascade");
    api.setScreen("howto");
    expect(host.state.screen).toBe("howto");
    api.setMenuIndex(2);
    expect(host.state.menuIndex).toBe(2);
  });

  it("forwards reconcile through apply, changing nothing this build holds", () => {
    const host = fakeHost();
    const api = createWindowApi(host, debug);
    api.loadBoard(["TtT"]);
    const before = api.snapshot();
    api.reconcile();
    expect(api.snapshot()).toEqual(before);
    expect(host.state.simTime).toBe(before.simTime);
    expect(host.state.rngState).toBe(before.rngState);
    expect(host.clock.advanced).toEqual([]);
  });

  it("draws a route through the immediate pointer operations", () => {
    const host = fakeHost();
    const api = createWindowApi(host, debug);
    api.loadBoard(["TtT"]);
    const [x0, y0] = cellCenter({ col: 0, row: 0 }, host.state.board);
    const [x1, y1] = cellCenter({ col: 1, row: 0 }, host.state.board);
    api.pointerDown(x0, y0);
    expect(host.state.tracing).toEqual({ channel: "triangle" });
    api.pointerMove(x1, y1);
    expect(host.state.beams[0].cells).toHaveLength(2);
    api.pointerUp();
    expect(host.state.tracing).toBeNull();
    api.clear();
    expect(host.state.beams[0].cells).toEqual([]);
  });

  it("hands the two clock operations straight to the runtime", () => {
    const host = fakeHost();
    const api = createWindowApi(host, debug);
    api.setAutoStep(false);
    api.setAutoStep(true);
    api.advance(0.5, 30);
    api.advance(1);
    expect(host.clock.autoStep).toEqual([false, true]);
    expect(host.clock.advanced).toEqual([
      [0.5, 30],
      [1, 1],
    ]);
  });

  it("installs on the global handle and uninstalls only its own object", () => {
    const host = fakeHost();
    const globals = globalThis as unknown as Record<string, unknown>;
    const uninstall = installDebugApi(host, debug);
    const installed = globals[REFRACT_HANDLE] as { version: number };
    expect(installed.version).toBe(REFRACT_DEBUG_VERSION);

    const second = installDebugApi(host, debug);
    uninstall(); // the first install's object is gone; the second's stands
    expect(globals[REFRACT_HANDLE]).toBeDefined();
    second();
    expect(globals[REFRACT_HANDLE]).toBeUndefined();
  });
});
