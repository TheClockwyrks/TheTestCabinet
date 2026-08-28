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
      pointer: { x: 0, y: 0, down: false },
      muted: false,
      simTime: 0,
    });
  });

  it("derives node centers, spends, completeness, and the live end", () => {
    let state = debug.loadBoard(fresh(), ["T1T", "S.S"]);
    const [x, y] = cellCenter({ col: 1, row: 0 }, state.board);
    state = debug.trace(state, [
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
      ...debug.startMode(fresh(), "campaign"),
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
    state = debug.trace(state, [
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

describe("startMode", () => {
  it("poses the same transition the title menu makes", () => {
    const campaign = debug.startMode(fresh(), "campaign");
    expect(campaign.screen).toBe("select");
    expect(campaign.mode).toBe("campaign");

    const cascade = debug.startMode(fresh(), "cascade");
    expect(cascade.screen).toBe("playing");
    expect(cascade.mode).toBe("cascade");
    expect(cascade.tier).toBe(1);
    expect(cascade.board.nodes.length).toBeGreaterThan(0);
  });

  it("leaves simTime as it is, so a clean run is reset followed by this", () => {
    const state = { ...fresh(), simTime: 4.5 };
    expect(debug.startMode(state, "campaign").simTime).toBe(4.5);
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
    expect(state.pointer).toEqual({ x: x0, y: y0, down: true });

    const [x1, y1] = cellCenter({ col: 1, row: 0 }, state.board);
    state = debug.pointerMove(state, x1, y1);
    expect(state.beams[0].cells).toHaveLength(2);

    state = debug.pointerUp(state);
    expect(state.tracing).toBeNull();
    expect(state.pointer.down).toBe(false);
  });
});

describe("trace", () => {
  it("draws a whole route and solves through the game's own rules", () => {
    let state = debug.loadBoard(fresh(), ["TtT"]);
    state = debug.trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(debug.snapshot(state).solved).toBe(true);
    expect(state.screen).toBe("solved");
  });

  it("stops at the last permitted segment when the limits refuse the rest", () => {
    let state = debug.loadBoard(fresh(), ["TtT", "SsS"]);
    state = debug.trace(state, [
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
    expect(debug.trace(state, [])).toEqual(state);
  });
});

describe("clear", () => {
  it("empties every beam on the playing screen alone", () => {
    let state = debug.loadBoard(fresh(), ["TtT"]);
    state = debug.trace(state, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    const cleared = debug.clear(state);
    expect(cleared.beams[0].cells).toEqual([]);

    const title = fresh();
    expect(debug.clear(title)).toBe(title);
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
    api.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(api.snapshot().solved).toBe(true);

    api.reset({ seed: 7 });
    expect(host.state.rngState).toBe(7);
    api.startMode("cascade");
    expect(host.state.mode).toBe("cascade");
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
