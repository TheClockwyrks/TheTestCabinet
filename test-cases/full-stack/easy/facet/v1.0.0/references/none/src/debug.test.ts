import { afterEach, describe, expect, it } from "vitest";
import {
  FACET_HANDLE,
  createDebugApi,
  createWindowApi,
  installDebugApi,
} from "./debug";
import type { DebugHost, FacetWindowApi } from "./debug";
import { FACET_DEBUG_VERSION, GRID_COLS, GRID_ROWS } from "./constants";
import { cellCenter, createInitialState, type FacetState } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";

/** A host over one state value, which is what the runtime is to the surface. */
function host(initial: FacetState = createInitialState()) {
  let state = initial;
  const advanced: [number, number | undefined][] = [];
  const stepping: boolean[] = [];
  const debugHost: DebugHost = {
    get state() {
      return state;
    },
    apply(pose) {
      state = pose(state);
    },
    setAutoStep(enabled) {
      stepping.push(enabled);
    },
    advance(seconds, frames) {
      advanced.push([seconds, frames]);
    },
  };
  return {
    host: debugHost,
    advanced,
    stepping,
    get state() {
      return state;
    },
  };
}

/** The installed surface over a fresh host. */
function surface(initial?: FacetState) {
  const bench = host(initial);
  const api: FacetWindowApi = createWindowApi(bench.host, createDebugApi());
  return { api, bench };
}

describe("the pose surface", () => {
  it("reports the version specs/instrumentation.md fixes", () => {
    expect(createDebugApi().version).toBe(FACET_DEBUG_VERSION);
    expect(FACET_DEBUG_VERSION).toBe(1);
  });

  it("bundles the core's own poses rather than a second implementation", () => {
    const api = createDebugApi();
    const posed = api.loadBoard(createInitialState(), quietRows());
    // A board posed through the surface obeys the same rules as any other: a
    // swap on the quiet board is refused, because nothing it makes matches.
    const refused = api.requestSwap(posed, 0, 0, 1, 0);
    expect(refused.board).toEqual(posed.board);
    expect(refused.refusal).toEqual({
      a: { col: 0, row: 0 },
      b: { col: 1, row: 0 },
    });
  });
});

describe("the installed surface", () => {
  it("applies every pose to the live state", () => {
    const { api, bench } = surface();
    api.start();
    expect(bench.state.screen).toBe("playing");
    api.pause();
    expect(bench.state.screen).toBe("paused");
    api.resume();
    expect(bench.state.screen).toBe("playing");
    api.quit();
    expect(bench.state.screen).toBe("title");
    api.openHowTo();
    expect(bench.state.screen).toBe("howto");
  });

  it("seeds the generator on reset and keeps the mute bit", () => {
    const { api, bench } = surface({ ...createInitialState(), muted: true });
    api.setScore(999);
    api.reset({ seed: 77 });
    expect(bench.state.rngState).toBe(77);
    expect(bench.state.score).toBe(0);
    expect(bench.state.muted).toBe(true);
    api.reset();
    expect(bench.state.rngState).toBe(1);
  });

  it("reads the state without changing it", () => {
    const { api, bench } = surface();
    api.loadBoard(quietRows());
    const before = JSON.stringify(bench.state);
    const snapshot = api.snapshot();
    expect(JSON.stringify(bench.state)).toBe(before);
    expect(snapshot.version).toBe(1);
    expect(snapshot.board.cols).toBe(GRID_COLS);
    expect(snapshot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    expect(snapshot.legalSwap).toBe(false);
  });

  it("poses the round's figures one at a time", () => {
    const { api, bench } = surface();
    api.setScore(1234);
    api.setLevel(4);
    api.setLevelScore(500);
    expect(bench.state.score).toBe(1234);
    expect(bench.state.level).toBe(4);
    expect(bench.state.levelScore).toBe(500);
    expect(api.snapshot().levelTarget).toBe(8000);
  });

  it("poses the board, one cell of it, the cursor, and the selection", () => {
    const { api, bench } = surface();
    api.loadBoard(quietRows());
    api.setGem(2, 3, "S1b");
    api.setCursor(5, 6);
    api.setSelection(1, 1);
    const cell = api
      .snapshot()
      .board.cells.find((each) => each.col === 2 && each.row === 3);
    expect(cell).toMatchObject({
      kind: "sapphire",
      cut: "brilliant",
      strain: 1,
    });
    expect(bench.state.cursor).toEqual({ col: 5, row: 6 });
    expect(bench.state.selection).toEqual({ col: 1, row: 1 });
    api.clearSelection();
    expect(bench.state.selection).toBeNull();
  });

  it("puts a requested swap through the acceptance path, refusal and all", () => {
    const { api, bench } = surface();
    api.loadBoard(quietRows());
    api.requestSwap(0, 0, 4, 4);
    expect(bench.state.refusal).not.toBeNull();
    expect(bench.state.phase).toBe("idle");
  });

  it("accepts a productive swap and resolves its first step on the spot", () => {
    const { api, bench } = surface();
    api.loadBoard(
      quietRowsWith({ "2,4": "R0", "3,4": "R0", "4,5": "R0", "4,4": "J0" }),
    );
    api.requestSwap(4, 5, 4, 4);
    expect(bench.state.phase).toBe("resolving");
    expect(bench.state.chainStep).toBe(1);
    expect(bench.state.score).toBeGreaterThan(0);
  });

  it("feeds the pointer through the very path a player's pointer takes", () => {
    const { api, bench } = surface();
    api.loadBoard(
      quietRowsWith({ "2,4": "R0", "3,4": "R0", "4,5": "R0", "4,4": "J0" }),
    );
    const [x, y] = cellCenter({ col: 4, row: 5 });
    api.pointerDown(x, y);
    expect(bench.state.selection).toEqual({ col: 4, row: 5 });
    const [bx, by] = cellCenter({ col: 4, row: 4 });
    api.pointerMove(bx, by);
    expect(bench.state.phase).toBe("resolving");
    api.pointerUp();
    expect(bench.state.pointer.down).toBe(false);
  });

  it("leaves the board alone on a press far from every cell", () => {
    const { api, bench } = surface();
    api.loadBoard(quietRows());
    const board = bench.state.board;
    api.pointerDown(10, 10);
    expect(bench.state.board).toBe(board);
    expect(bench.state.selection).toBeNull();
    api.pointerUp();
  });

  it("hands the clock straight to the runtime", () => {
    const { api, bench } = surface();
    api.setAutoStep(false);
    api.setAutoStep(true);
    expect(bench.stepping).toEqual([false, true]);
    api.advance(0.5);
    api.advance(1, 60);
    expect(bench.advanced).toEqual([
      [0.5, 1],
      [1, 60],
    ]);
  });
});

describe("installDebugApi", () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)[FACET_HANDLE];
  });

  it("publishes the surface on window.__facet", () => {
    const bench = host();
    installDebugApi(bench.host, createDebugApi());
    const installed = (globalThis as unknown as Record<string, FacetWindowApi>)[
      FACET_HANDLE
    ];
    expect(installed.version).toBe(1);
    installed.start();
    expect(bench.state.screen).toBe("playing");
  });

  it("removes only the object the same call published", () => {
    const bench = host();
    const remove = installDebugApi(bench.host, createDebugApi());
    installDebugApi(bench.host, createDebugApi());
    remove();
    expect(
      (globalThis as unknown as Record<string, unknown>)[FACET_HANDLE],
    ).toBeDefined();
  });
});
