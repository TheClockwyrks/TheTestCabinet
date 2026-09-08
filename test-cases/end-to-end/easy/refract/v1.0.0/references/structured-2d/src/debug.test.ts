// The debug and automation surface: every operation a pose or a reading over
// the LIVE game, exactly as specs/instrumentation.md fixes them. The surface
// is read back off `engine.debug` — the one way a caller reaches it — and
// each operation acts on the open world at the call, with no frame advanced
// between calls, so what these checks prove is the immediate-effect contract.
// The keyboard-and-frames wiring around the game is covered in
// engine.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cellCenter, channelsOn } from "./board";
import { CHANNELS, REFRACT_DEBUG_VERSION, TIERS } from "./constants";
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
      pointer: { x: 0, y: 0, down: false, device: "mouse" },
      targets: expect.any(Array),
      muted: false,
      simTime: 0,
    });
  });

  it("reports the live highlights: menuIndex on a menu, selectIndex on select", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);

    h.debug.setScreen("select");
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
    h.trace([
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
  it("restores every declared field and keeps mute", () => {
    h.debug.loadBoard(["TtT"]);
    h.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.state.muted = true;
    h.state.simTime = 12.5;

    h.debug.reset();
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
      pointer: { x: 0, y: 0, down: false, device: "mouse" },
      targets: expect.any(Array),
      muted: true,
      simTime: 0,
    });
  });
});

describe("setSolvedCount and setTier", () => {
  it("each sets its own field alone", () => {
    h.debug.setMode("cascade");
    h.debug.loadBoard(["TtT"]);
    const posed = h.debug.snapshot();
    h.debug.setSolvedCount(7);
    expect(h.debug.snapshot()).toEqual({ ...posed, solvedCount: 7 });
    h.debug.setTier(4);
    expect(h.debug.snapshot()).toEqual({ ...posed, solvedCount: 7, tier: 4 });
  });
});

describe("generateBoard", () => {
  it("poses a board the generator emits at the tier named, the run untouched", () => {
    h.debug.setMode("cascade");
    h.debug.setSolvedCount(2);
    h.debug.setTier(1);
    h.debug.generateBoard(4);
    expect(h.state.screen).toBe("playing");
    expect(h.state.tracing).toBeNull();
    expect(channelsOn(h.state.board)).toEqual([
      ...CHANNELS.slice(0, TIERS[3].channels),
    ]);
    expect(h.state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(h.state.solvedCount).toBe(2);
    expect(h.state.tier).toBe(1);
    expect(h.state.mode).toBe("cascade");
  });
});

describe("setMode", () => {
  it("sets the mode field alone, generating no board and moving no screen", () => {
    h.state.simTime = 4.5;
    h.debug.setMode("cascade");
    expect(h.state.mode).toBe("cascade");
    expect(h.state.screen).toBe("title");
    expect(h.state.board.nodes).toHaveLength(0);
    expect(h.state.simTime).toBe(4.5);
  });
});

describe("setScreen", () => {
  it("sets the screen field alone, leaving the board it was posed over", () => {
    h.debug.loadBoard(["TtT"]);
    const board = h.debug.snapshot().board;
    h.debug.setScreen("solved");
    expect(h.state.screen).toBe("solved");
    expect(h.debug.snapshot().board).toEqual(board);
    expect(h.state.mode).toBe("campaign");
  });

  it("leaves no pointer target armed", () => {
    h.state.armedTarget = "menu-1";
    h.debug.setScreen("howto");
    expect(h.state.armedTarget).toBeNull();
  });
});

describe("setMenuIndex", () => {
  it("sets the highlighted item alone", () => {
    h.debug.setMenuIndex(2);
    expect(h.state.menuIndex).toBe(2);
    expect(h.state.screen).toBe("title");
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
    expect(h.state.pointer).toEqual({
      x: x0,
      y: y0,
      down: true,
      device: "mouse",
    });

    const [x1, y1] = cellCenter({ col: 1, row: 0 }, h.state.board);
    h.debug.pointerMove(x1, y1);
    expect(h.state.beams[0].cells).toHaveLength(2);
    expect(h.cues.map((play) => play.cue)).toEqual(["connect"]);

    h.debug.pointerUp();
    expect(h.state.tracing).toBeNull();
    expect(h.state.pointer.down).toBe(false);
  });
});

describe("a route drawn through the pointer poses", () => {
  it("draws a whole route, solves through the game's own rules, and plays the solved cue", () => {
    h.debug.loadBoard(["TtT"]);
    h.cues.length = 0;
    h.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(h.debug.snapshot().solved).toBe(true);
    expect(h.state.screen).toBe("solved");
    // Each pose announces the events it raised, in the order they happened.
    expect(h.cues.map((play) => play.cue)).toEqual([
      "connect",
      "connect",
      "channel-complete",
      "solved",
    ]);
  });

  it("stops at the last permitted segment when the limits refuse the rest", () => {
    h.debug.loadBoard(["TtT", "SsS"]);
    h.trace([
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
    h.trace([]);
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });
});

describe("reconcile", () => {
  it("re-derives a stored reading from a posed board", () => {
    // `loadBoard` writes the very thing five readings are functions of: the
    // board's dimensions (a node's `x`/`y`), the drawn beams (a crystal's
    // `spent`, a beam's `complete`, `solved`), and the screen (`targets`).
    h.debug.loadBoard(["TtT"]);
    h.debug.reconcile();
    let read = h.debug.snapshot();
    for (const node of read.board.nodes) {
      const [x, y] = cellCenter(node, h.state.board);
      expect([node.x, node.y]).toEqual([x, y]);
    }
    expect(read.solved).toBe(false);
    expect(read.beams.triangle?.complete).toBe(false);

    // Draw the route the board is solved by, then reconcile and read again.
    h.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    h.debug.reconcile();
    read = h.debug.snapshot();
    expect(read.solved).toBe(true);
    expect(read.beams.triangle?.complete).toBe(true);

    // A larger board: the cell centres move with the dimensions, so a stored
    // copy of them would still answer for the board before this pose.
    h.debug.loadBoard(["T.S", "1.s", "T.S"]);
    h.debug.reconcile();
    read = h.debug.snapshot();
    expect(read.board.cols).toBe(3);
    expect(read.board.rows).toBe(3);
    for (const node of read.board.nodes) {
      const [x, y] = cellCenter(node, h.state.board);
      expect([node.x, node.y]).toEqual([x, y]);
    }
  });

  it("advances nothing, and reconciling twice matches reconciling once", () => {
    h.debug.loadBoard(["TtT"]);
    h.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    const before = h.debug.snapshot();
    const board = h.state.board;
    h.cues.length = 0;
    h.debug.reconcile();
    expect(h.debug.snapshot()).toEqual(before);
    h.debug.reconcile();
    expect(h.debug.snapshot()).toEqual(before);
    // Named explicitly, because "equal snapshots" is only as strong as the
    // clock, the live trace and the cues being in it.
    expect(h.state.simTime).toBe(before.simTime);
    expect(h.state.screen).toBe(before.screen);
    expect(h.state.board).toBe(board);
    expect(h.cues).toEqual([]);
  });
});

describe("clear", () => {
  it("empties every beam from wherever the game stands, playing the cue once", () => {
    h.debug.loadBoard(["TtT"]);
    h.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.cues.length = 0;
    h.debug.clear();
    expect(h.state.beams[0].cells).toEqual([]);
    expect(h.cues.map((play) => play.cue)).toEqual(["clear"]);

    // With nothing to remove the cue stays quiet, whatever the screen.
    h.debug.clear();
    h.debug.reset();
    h.debug.clear();
    expect(h.cues.map((play) => play.cue)).toEqual(["clear"]);
    expect(h.state.screen).toBe("title");
  });

  it("empties a drawn board off the playing screen, leaving the screen alone", () => {
    // The screen is how a PLAYER reaches the clear action, not a condition of
    // the operation (specs/instrumentation.md, "The operations").
    h.debug.loadBoard(["TtT"]);
    h.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.debug.setScreen("title");
    h.debug.clear();
    expect(h.state.beams[0].cells).toEqual([]);
    expect(h.state.tracing).toBeNull();
    expect(h.state.screen).toBe("title");
  });
});
