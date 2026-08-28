// The debug and automation surface: every operation a pose or a reading over
// the LIVE game, exactly as specs/instrumentation.md fixes them. The surface
// is read back off `engine.debug` — the one way a caller reaches it — and
// each operation acts on the open world at the call, with no frame advanced
// between calls, so what these checks prove is the immediate-effect contract.
// The keyboard-and-frames wiring around the game is covered in
// engine.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cellCenter } from "./board";
import { DEFAULT_SEED, REFRACT_DEBUG_VERSION } from "./constants";
import { createHarness, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the surface", () => {
  it("is returned from initialize and held at engine.debug", () => {
    expect(h.engine.debug).toBe(h.debug);
    expect(h.debug.version).toBe(REFRACT_DEBUG_VERSION);
  });
});

describe("snapshot", () => {
  it("returns the fixed shape with resting values on the title screen", () => {
    expect(h.debug.snapshot()).toEqual({
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
      board: { cols: 0, rows: 0, nodes: [] },
      beams: {},
      solved: false,
      tracing: null,
      pointer: { x: 0, y: 0, down: false },
      muted: false,
      simTime: 0,
    });
  });

  it("reports the live highlights: menuIndex on a menu, selectIndex on select", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);

    h.debug.startMode("campaign");
    h.tap("ArrowRight");
    await h.engine.advance(1);
    expect(h.debug.snapshot().selectIndex).toBe(1);

    // On playing, menuIndex rests at 0 and selectIndex keeps the highlight.
    h.debug.loadBoard(["TtT"]);
    const snapshot = h.debug.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.selectIndex).toBe(1);
  });

  it("derives node centers, spends, completeness, and the live end", () => {
    h.debug.loadBoard(["T1T", "S.S"]);
    const [x, y] = cellCenter({ col: 1, row: 0 }, h.state.board);
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.debug.pointerDown(...cellCenter({ col: 0, row: 1 }, h.state.board));
    const snapshot = h.debug.snapshot();

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

  it("changes nothing", () => {
    h.debug.loadBoard(["T1T", "S.S"]);
    const before = JSON.stringify(h.debug.snapshot());
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });
});

describe("reset", () => {
  it("restores every declared field, seeds the generator, and keeps mute", () => {
    h.debug.loadBoard(["TtT"]);
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.state.muted = true;
    h.state.simTime = 12.5;

    h.debug.reset({ seed: 99 });
    expect(h.debug.snapshot()).toEqual({
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
      board: { cols: 0, rows: 0, nodes: [] },
      beams: {},
      solved: false,
      tracing: null,
      pointer: { x: 0, y: 0, down: false },
      muted: true,
      simTime: 0,
    });
    expect(h.state.rngState).toBe(99);

    h.debug.reset();
    expect(h.state.rngState).toBe(DEFAULT_SEED);
  });
});

describe("startMode", () => {
  it("poses the same transition the title menu makes", () => {
    h.debug.startMode("campaign");
    expect(h.state.screen).toBe("select");
    expect(h.state.mode).toBe("campaign");

    h.debug.reset();
    h.debug.startMode("cascade");
    expect(h.state.screen).toBe("playing");
    expect(h.state.mode).toBe("cascade");
    expect(h.state.tier).toBe(1);
    expect(h.state.board.nodes.length).toBeGreaterThan(0);
  });

  it("leaves simTime as it is, so a clean run is reset followed by this", () => {
    h.state.simTime = 4.5;
    h.debug.startMode("campaign");
    expect(h.state.simTime).toBe(4.5);
  });
});

describe("loadBoard", () => {
  it("poses a board onto playing with every beam empty and no trace live", () => {
    h.debug.loadBoard(["T.S", "1.s", "T.S"]);
    expect(h.state.screen).toBe("playing");
    expect(h.state.board.cols).toBe(3);
    expect(h.state.beams.map((beam) => beam.channel)).toEqual([
      "triangle",
      "square",
    ]);
    expect(h.state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(h.state.tracing).toBeNull();
  });

  it("refuses notation the board rules cannot make sense of", () => {
    expect(() => h.debug.loadBoard(["T?T"])).toThrow(/"\?"/);
    expect(() => h.debug.loadBoard(["T.t"])).toThrow(/emitters/);
    expect(() => h.debug.loadBoard(["T".repeat(8)])).toThrow(/columns/);
  });
});

describe("the pointer operations", () => {
  it("take effect immediately, so a route draws with no frame between calls", () => {
    h.debug.loadBoard(["TtT"]);
    const [x0, y0] = cellCenter({ col: 0, row: 0 }, h.state.board);
    h.debug.pointerDown(x0, y0);
    expect(h.state.tracing).toEqual({ channel: "triangle" });
    expect(h.state.pointer).toEqual({ x: x0, y: y0, down: true });

    const [x1, y1] = cellCenter({ col: 1, row: 0 }, h.state.board);
    h.debug.pointerMove(x1, y1);
    expect(h.state.beams[0].cells).toHaveLength(2);
    expect(h.cues.map((play) => play.cue)).toEqual(["connect"]);

    h.debug.pointerUp();
    expect(h.state.tracing).toBeNull();
    expect(h.state.pointer.down).toBe(false);
  });
});

describe("trace", () => {
  it("draws a whole route, solves through the game's own rules, and plays the solved cue", () => {
    h.debug.loadBoard(["TtT"]);
    h.cues.length = 0;
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(h.debug.snapshot().solved).toBe(true);
    expect(h.state.screen).toBe("solved");
    // One batch, so each cue plays at most once for the call.
    expect(h.cues.map((play) => play.cue)).toEqual([
      "connect",
      "channel-complete",
      "solved",
    ]);
  });

  it("stops at the last permitted segment when the limits refuse the rest", () => {
    h.debug.loadBoard(["TtT", "SsS"]);
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 1, row: 1 }, // square's lens: refused, live end stays at (1,0)
      { col: 2, row: 1 }, // square's emitter: refused from (1,0) as well
    ]);
    expect(h.debug.snapshot().beams.triangle?.cells).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(h.state.tracing).toBeNull();
  });

  it("is a no-op for an empty route", () => {
    h.debug.loadBoard(["TtT"]);
    const before = JSON.stringify(h.debug.snapshot());
    h.debug.trace([]);
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });
});

describe("clear", () => {
  it("empties every beam on the playing screen alone, playing the cue once", () => {
    h.debug.loadBoard(["TtT"]);
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.cues.length = 0;
    h.debug.clear();
    expect(h.state.beams[0].cells).toEqual([]);
    expect(h.cues.map((play) => play.cue)).toEqual(["clear"]);

    // With nothing to remove, and off the playing screen, the cue stays quiet.
    h.debug.clear();
    h.debug.reset();
    h.debug.clear();
    expect(h.cues.map((play) => play.cue)).toEqual(["clear"]);
    expect(h.state.screen).toBe("title");
  });
});
