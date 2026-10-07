import { describe, expect, it } from "vitest";
import {
  CUES,
  HEADING_H,
  READOUT_X0,
  TRAY_SLOT_H,
  TRAY_X0,
  TRAY_Y0,
} from "./constants";
import { type Action } from "./figures";
import { parseChallenge } from "./formats";
import { hexX, hexY } from "./hex";
import { clearOutbox, pendingCues } from "./outbox";
import { Session } from "./session";
import { startRun } from "./sim";
import type { PartState, W } from "./types";

/** The tray entries the bench challenge derives, in order. */
const ENTRIES = [
  "arm",
  "biarm",
  "piston",
  "wheel",
  "track",
  "bind",
  "void",
  "rise",
  "set",
] as const;

/** A challenge offering enough kinds to exercise every drag shape. */
function benchChallenge(): unknown {
  const dust = { motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] };
  return {
    name: "Bench",
    reagents: [dust],
    products: [dust],
    // Deliberately out of PARTS order, which the tray sorts.
    permitted: ["bind", "wheel", "arm", "track", "void", "piston", "biarm"],
    target: 6,
  };
}

/** A game in the editor over the bench challenge, with an empty machine. */
function bench(): Session {
  // The cue outbox is shared by every session in this process, so a bench
  // starts from an empty one (`src/outbox.ts`).
  clearOutbox();
  const game = new Session();
  game.loadChallenge(parseChallenge(benchChallenge()));
  return game;
}

/** The stage position of a hex's center. */
function at(q: number, r: number): { x: number; y: number } {
  return { x: hexX(q, r), y: hexY(q, r) };
}

/** A position inside the field region that targets no hex at all. */
function betweenHexes(): { x: number; y: number } {
  return {
    x: (hexX(0, 0) + hexX(1, 0) + hexX(0, 1)) / 3,
    y: (hexY(0, 0) + hexY(1, 0) + hexY(0, 1)) / 3,
  };
}

/** A position inside tray entry `k`. */
function tray(k: number): { x: number; y: number } {
  return { x: TRAY_X0 + 4, y: TRAY_Y0 + k * TRAY_SLOT_H + 4 };
}

function press(game: Session, point: { x: number; y: number }): void {
  game.handlePointer({ type: "down", x: point.x, y: point.y });
}

function moveTo(game: Session, point: { x: number; y: number }): void {
  game.handlePointer({ type: "move", x: point.x, y: point.y });
}

function release(game: Session): void {
  const { x, y } = game.state.pointer;
  game.handlePointer({ type: "up", x, y });
}

/** Press an entry, drag it over `target`, and release there. */
function placeFromTray(
  game: Session,
  entry: number,
  target: { q: number; r: number },
  keys: Action[] = [],
): void {
  press(game, tray(entry));
  moveTo(game, at(target.q, target.r));
  for (const key of keys) game.handleAction(key);
  release(game);
}

/** The machine's parts. */
function parts(game: Session): W<PartState>[] {
  return game.state.editor.parts;
}

describe("the tray's place drag (specs/editor.md)", () => {
  it("opens a place drag naming the entry's kind, at rotation 0 length 1", () => {
    const game = bench();
    press(game, tray(ENTRIES.indexOf("piston")));
    expect(game.state.editor.drag).toMatchObject({
      kind: "place",
      part: "piston",
      index: null,
      rotation: 0,
      length: 1,
    });
  });

  it("names the reagent or product a rise or set entry carries", () => {
    const game = bench();
    press(game, tray(ENTRIES.indexOf("rise")));
    expect(game.state.editor.drag).toMatchObject({ part: "rise", index: 0 });
    release(game);
    press(game, tray(ENTRIES.indexOf("set")));
    expect(game.state.editor.drag).toMatchObject({ part: "set", index: 0 });
  });

  it("retargets on each move, and reports no hex off every one", () => {
    const game = bench();
    press(game, tray(0));
    moveTo(game, at(0, 0));
    expect(game.state.editor.drag).toMatchObject({ at: { q: 0, r: 0 } });
    moveTo(game, at(2, -1));
    expect(game.state.editor.drag).toMatchObject({ at: { q: 2, r: -1 } });
    moveTo(game, betweenHexes());
    expect(game.state.editor.drag).toMatchObject({ at: null });
    moveTo(game, at(1, 0));
    expect(game.state.editor.drag).toMatchObject({ at: { q: 1, r: 0 } });
  });

  it("places and selects the part on a legal release", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 1, r: -2 });
    expect(parts(game)).toHaveLength(1);
    expect(parts(game)[0]).toMatchObject({ kind: "arm", q: 1, r: -2 });
    expect(game.state.editor.selected).toBe(parts(game)[0].id);
    expect(game.state.editor.drag).toBeNull();
    expect(pendingCues()).toContain(CUES.place);
  });

  it("lands the part at the ghost's pose", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 }, ["part-cw", "part-cw", "part-grow"]);
    expect(parts(game)[0]).toMatchObject({ rotation: 2, length: 2 });
  });

  it("keeps the ghost's length inside the arm bounds", () => {
    const game = bench();
    press(game, tray(0));
    game.handleAction("part-shrink");
    expect(game.state.editor.drag).toMatchObject({ length: 1 });
    for (let i = 0; i < 5; i += 1) game.handleAction("part-grow");
    expect(game.state.editor.drag).toMatchObject({ length: 3 });
  });

  it("leaves a non-arm ghost's length alone", () => {
    const game = bench();
    press(game, tray(ENTRIES.indexOf("bind")));
    game.handleAction("part-grow");
    expect(game.state.editor.drag).toMatchObject({ length: 1 });
  });

  it("places nothing on an illegal release, and nothing off every hex", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    placeFromTray(game, 0, { q: 0, r: 0 });
    expect(parts(game)).toHaveLength(1);
    press(game, tray(0));
    moveTo(game, betweenHexes());
    release(game);
    expect(parts(game)).toHaveLength(1);
    expect(game.state.editor.drag).toBeNull();
  });

  it("places a single open cell from the track entry", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("track"), { q: 0, r: 2 });
    expect(parts(game)[0]).toMatchObject({
      kind: "track",
      cells: [{ q: 0, r: 2 }],
      closed: false,
    });
  });

  it("spends a rise entry while its part is on the field", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("rise"), { q: -3, r: 0 });
    press(game, tray(ENTRIES.indexOf("rise")));
    expect(game.state.editor.drag).toBeNull();
    release(game);
    // Deleting the placed rise unspends it.
    press(game, at(-3, 0));
    release(game);
    game.handleAction("part-delete");
    press(game, tray(ENTRIES.indexOf("rise")));
    expect(game.state.editor.drag).toMatchObject({ kind: "place" });
  });

  it("places any number of copies from every other entry", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    placeFromTray(game, 0, { q: 2, r: 0 });
    expect(parts(game)).toHaveLength(2);
  });

  it("does nothing on a press in the tray outside every entry", () => {
    const game = bench();
    press(game, { x: TRAY_X0 - 4, y: TRAY_Y0 + 4 });
    expect(game.state.editor.drag).toBeNull();
    expect(game.state.editor.focus).toBe("field");
  });
});

describe("selection on the field (specs/editor.md)", () => {
  it("takes the arm over a track and over a sigil on a shared hex", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("track"), { q: 0, r: 0 });
    placeFromTray(game, 0, { q: 0, r: 0 });
    const arm = parts(game)[1];
    press(game, at(0, 0));
    expect(game.state.editor.selected).toBe(arm.id);
    release(game);

    const other = bench();
    placeFromTray(other, ENTRIES.indexOf("bind"), { q: 0, r: 0 });
    placeFromTray(other, 0, { q: 1, r: 0 });
    press(other, at(1, 0));
    expect(other.state.editor.selected).toBe(parts(other)[1].id);
  });

  it("takes the track over a sigil where no mechanism stands", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("bind"), { q: 0, r: 0 });
    // A track may not be laid on a footprint, so the sigil is reached alone.
    press(game, at(1, 0));
    expect(parts(game)[0].kind).toBe("bind");
    expect(game.state.editor.selected).toBe(parts(game)[0].id);
  });

  it("clears the selection on a bare hex and off every hex", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    press(game, at(3, 0));
    expect(game.state.editor.selected).toBeNull();
    release(game);
    press(game, at(0, 0));
    release(game);
    press(game, betweenHexes());
    expect(game.state.editor.selected).toBeNull();
  });

  it("selects one part at a time", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    placeFromTray(game, 0, { q: 2, r: 0 });
    press(game, at(0, 0));
    release(game);
    expect(game.state.editor.selected).toBe(parts(game)[0].id);
    press(game, at(2, 0));
    expect(game.state.editor.selected).toBe(parts(game)[1].id);
  });

  it("points the cursor at an arm's or a wheel's row, and leaves it otherwise", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("wheel"), { q: 0, r: 0 });
    placeFromTray(game, ENTRIES.indexOf("bind"), { q: 2, r: 0 });
    press(game, at(0, 0));
    release(game);
    expect(game.state.editor.cursor).toEqual({
      part: parts(game)[0].id,
      col: 0,
    });
    expect(game.state.editor.focus).toBe("field");
    press(game, at(2, 0));
    expect(game.state.editor.cursor).toEqual({
      part: parts(game)[0].id,
      col: 0,
    });
  });

  it("leaves the selection and the cursor standing for a heading or readout press", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    press(game, at(0, 0));
    release(game);
    const selected = game.state.editor.selected;
    press(game, { x: 640, y: HEADING_H - 1 });
    expect(game.state.editor.selected).toBe(selected);
    expect(game.state.editor.drag).toBeNull();
    release(game);
    press(game, { x: READOUT_X0 + 10, y: 300 });
    expect(game.state.editor.selected).toBe(selected);
    expect(game.state.editor.cursor).not.toBeNull();
    expect(game.state.editor.drag).toBeNull();
  });
});

describe("the field's part verbs (specs/editor.md)", () => {
  it("turns an arm, a wheel, and a sigil, and leaves a track alone", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    game.handleAction("part-cw");
    expect(parts(game)[0].rotation).toBe(1);
    game.handleAction("part-ccw");
    game.handleAction("part-ccw");
    expect(parts(game)[0].rotation).toBe(5);

    placeFromTray(game, ENTRIES.indexOf("track"), { q: 0, r: 3 });
    const before = parts(game)[1];
    game.handleAction("part-cw");
    expect(parts(game)[1]).toEqual(before);
  });

  it("lengthens and shortens an arm within its bounds", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    game.handleAction("part-shrink");
    expect(parts(game)[0].length).toBe(1);
    game.handleAction("part-grow");
    game.handleAction("part-grow");
    game.handleAction("part-grow");
    expect(parts(game)[0].length).toBe(3);
  });

  it("leaves a wheel's length alone", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("wheel"), { q: 0, r: 0 });
    game.handleAction("part-grow");
    expect(parts(game)[0].length).toBe(1);
  });

  it("refuses a rotation that would break a placement rule", () => {
    const game = bench();
    // Two binds side by side: turning the first onto the second's footprint
    // would break the disjointness rule, so it does not happen.
    placeFromTray(game, ENTRIES.indexOf("bind"), { q: 2, r: 0 });
    placeFromTray(game, ENTRIES.indexOf("bind"), { q: 2, r: 1 });
    press(game, at(2, 0));
    release(game);
    const depth = game.state.editor.undo.length;
    game.handleAction("part-cw");
    expect(parts(game)[0].rotation).toBe(0);
    expect(game.state.editor.undo).toHaveLength(depth);
    // The other way round is legal, and pushes one entry.
    game.handleAction("part-ccw");
    expect(parts(game)[0].rotation).toBe(5);
    expect(game.state.editor.undo).toHaveLength(depth + 1);
  });

  it("removes the selected part, its whole path and its tape with it", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("track"), { q: 0, r: 0 });
    press(game, at(0, 0));
    moveTo(game, at(1, 0));
    moveTo(game, at(2, 0));
    release(game);
    expect(parts(game)[0].cells).toHaveLength(3);
    press(game, at(1, 0));
    release(game);
    game.handleAction("part-delete");
    expect(parts(game)).toEqual([]);
    expect(game.state.editor.selected).toBeNull();
    expect(pendingCues()).toContain(CUES.erase);
  });

  it("does nothing with no part selected", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    press(game, at(3, 0));
    release(game);
    game.handleAction("part-delete");
    expect(parts(game)).toHaveLength(1);
  });
});

describe("the move drag (specs/editor.md)", () => {
  it("translates the part by the drag's offset, not onto the pointer", () => {
    const game = bench();
    // A bind is pressed away from its anchor: its footprint holds (1, 0) too.
    placeFromTray(game, ENTRIES.indexOf("bind"), { q: 0, r: 0 });
    press(game, at(1, 0));
    expect(game.state.editor.drag).toMatchObject({
      kind: "move",
      from: { q: 1, r: 0 },
    });
    moveTo(game, at(3, 0));
    release(game);
    expect(parts(game)[0]).toMatchObject({ q: 2, r: 0 });
    expect(game.state.editor.selected).toBe(parts(game)[0].id);
  });

  it("moves an arm pressed on its anchor, keeping the ghost's length", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 }, ["part-grow"]);
    press(game, at(0, 0));
    moveTo(game, at(2, 0));
    release(game);
    expect(parts(game)[0]).toMatchObject({ q: 2, r: 0, length: 2 });
  });

  it("carries a track's whole path and its closed flag", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("track"), { q: 0, r: 0 });
    press(game, at(0, 0));
    moveTo(game, at(1, 0));
    moveTo(game, at(1, -1));
    moveTo(game, at(0, 0));
    release(game);
    expect(parts(game)[0].closed).toBe(true);
    press(game, at(0, 0));
    moveTo(game, at(0, 1));
    release(game);
    expect(parts(game)[0].cells).toEqual([
      { q: 0, r: 1 },
      { q: 1, r: 1 },
      { q: 1, r: 0 },
    ]);
    expect(parts(game)[0].closed).toBe(true);
  });

  it("commits no move on a release at the hex the press grabbed", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    const depth = game.state.editor.undo.length;
    press(game, at(0, 0));
    release(game);
    expect(parts(game)[0]).toMatchObject({ q: 0, r: 0 });
    expect(game.state.editor.undo).toHaveLength(depth);
  });

  it("leaves the part in place when the result would be illegal", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    placeFromTray(game, 0, { q: 2, r: 0 });
    const depth = game.state.editor.undo.length;
    press(game, at(2, 0));
    moveTo(game, at(0, 0));
    release(game);
    expect(parts(game)[1]).toMatchObject({ q: 2, r: 0 });
    expect(game.state.editor.undo).toHaveLength(depth);
    expect(game.state.editor.selected).toBe(parts(game)[1].id);
  });

  it("commits nothing on a release off every hex, and stays selected", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    press(game, at(0, 0));
    moveTo(game, betweenHexes());
    release(game);
    expect(parts(game)[0]).toMatchObject({ q: 0, r: 0 });
    expect(game.state.editor.selected).toBe(parts(game)[0].id);
    expect(game.state.editor.drag).toBeNull();
  });

  it("keeps a ghost rotation and length through a refused move", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    placeFromTray(game, 0, { q: 2, r: 0 });
    press(game, at(2, 0));
    moveTo(game, at(0, 0));
    game.handleAction("part-cw");
    game.handleAction("part-grow");
    release(game);
    expect(parts(game)[1]).toMatchObject({
      q: 2,
      r: 0,
      rotation: 1,
      length: 2,
    });
  });

  it("keeps a moved arm's tape and its place in placement order", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    placeFromTray(game, 0, { q: 3, r: 0 });
    game.state.editor.parts[0] = {
      ...parts(game)[0],
      tape: ["grab", null, "drop"],
    };
    press(game, at(0, 0));
    moveTo(game, at(0, 2));
    release(game);
    expect(parts(game)[0]).toMatchObject({
      q: 0,
      r: 2,
      tape: ["grab", null, "drop"],
    });
    expect(parts(game)[1]).toMatchObject({ q: 3, r: 0 });
  });

  it("reads no other action while a drag is live", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    press(game, at(0, 0));
    game.handleAction("part-delete");
    game.handleAction("undo");
    game.handleAction("play");
    expect(parts(game)).toHaveLength(1);
    expect(game.state.sim).toBeNull();
    expect(game.state.editor.drag).not.toBeNull();
  });
});

describe("laying track (specs/editor.md)", () => {
  /** A game whose only part is an open track along `r = 0` of `count` cells. */
  function laid(count: number): Session {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("track"), { q: 0, r: 0 });
    press(game, at(0, 0));
    for (let q = 1; q < count; q += 1) moveTo(game, at(q, 0));
    release(game);
    return game;
  }

  it("opens a lay from either end of an open track", () => {
    const game = laid(3);
    press(game, at(2, 0));
    expect(game.state.editor.drag).toMatchObject({ kind: "lay", end: "last" });
    release(game);
    press(game, at(0, 0));
    expect(game.state.editor.drag).toMatchObject({ kind: "lay", end: "first" });
  });

  it("lays a one-cell track from its last end", () => {
    const game = laid(1);
    press(game, at(0, 0));
    expect(game.state.editor.drag).toMatchObject({ kind: "lay", end: "last" });
  });

  it("appends each adjacent hex the pointer visits", () => {
    const game = laid(3);
    expect(parts(game)[0].cells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ]);
  });

  it("grows the front of the path when laying from the first end", () => {
    const game = laid(2);
    press(game, at(0, 0));
    moveTo(game, at(-1, 0));
    release(game);
    expect(parts(game)[0].cells).toEqual([
      { q: -1, r: 0 },
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
    expect(parts(game)[0]).toMatchObject({ q: -1, r: 0 });
  });

  it("appends neither an illegal hex nor a hex that is not adjacent", () => {
    const game = laid(2);
    placeFromTray(game, ENTRIES.indexOf("bind"), { q: 2, r: 0 });
    press(game, at(1, 0));
    moveTo(game, at(2, 0));
    expect(parts(game)[0].cells).toHaveLength(2);
    moveTo(game, at(4, 0));
    expect(parts(game)[0].cells).toHaveLength(2);
    release(game);
    expect(parts(game)[0].cells).toHaveLength(2);
  });

  it("removes the end cell on a move back onto the cell behind it", () => {
    const game = laid(3);
    press(game, at(2, 0));
    moveTo(game, at(1, 0));
    expect(parts(game)[0].cells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
  });

  it("closes the path on a move onto its other end, and ends the lay there", () => {
    const game = bench();
    placeFromTray(game, ENTRIES.indexOf("track"), { q: 0, r: 0 });
    press(game, at(0, 0));
    moveTo(game, at(1, 0));
    moveTo(game, at(1, -1));
    moveTo(game, at(0, 0));
    expect(parts(game)[0].closed).toBe(true);
    expect(game.state.editor.drag).toBeNull();
    // A further move appends nothing, without waiting for the release.
    moveTo(game, at(0, -1));
    expect(parts(game)[0].cells).toHaveLength(3);
  });

  it("shortens rather than closes a path of exactly two cells", () => {
    const game = laid(2);
    press(game, at(1, 0));
    moveTo(game, at(0, 0));
    expect(parts(game)[0].closed).toBe(false);
    expect(parts(game)[0].cells).toEqual([{ q: 0, r: 0 }]);
  });

  it("opens a move from an interior cell and from a closed track", () => {
    const game = laid(3);
    press(game, at(1, 0));
    expect(game.state.editor.drag).toMatchObject({ kind: "move" });
    release(game);

    const loop = bench();
    placeFromTray(loop, ENTRIES.indexOf("track"), { q: 0, r: 0 });
    press(loop, at(0, 0));
    moveTo(loop, at(1, 0));
    moveTo(loop, at(1, -1));
    moveTo(loop, at(0, 0));
    release(loop);
    expect(parts(loop)[0].closed).toBe(true);
    press(loop, at(1, 0));
    expect(loop.state.editor.drag).toMatchObject({ kind: "move" });
  });

  it("commits one entry for a lay that changed the path, and none for one that did not", () => {
    const game = laid(1);
    const depth = game.state.editor.undo.length;
    press(game, at(0, 0));
    moveTo(game, at(1, 0));
    moveTo(game, at(2, 0));
    moveTo(game, at(3, 0));
    release(game);
    expect(game.state.editor.undo).toHaveLength(depth + 1);
    press(game, at(3, 0));
    release(game);
    expect(game.state.editor.undo).toHaveLength(depth + 1);
    game.handleAction("undo");
    expect(parts(game)[0].cells).toEqual([{ q: 0, r: 0 }]);
  });
});

describe("the editor while a run is live (specs/editor.md)", () => {
  it("reads a press for the focus alone", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    press(game, at(3, 0));
    release(game);
    startRun(game);
    press(game, at(0, 0));
    expect(game.state.editor.selected).toBeNull();
    expect(game.state.editor.drag).toBeNull();
    expect(game.state.editor.focus).toBe("field");
  });

  it("holds the part verbs and the tape writes inert", () => {
    const game = bench();
    placeFromTray(game, 0, { q: 0, r: 0 });
    startRun(game);
    game.handleAction("part-cw");
    game.handleAction("part-delete");
    expect(parts(game)).toHaveLength(1);
    expect(parts(game)[0].rotation).toBe(0);
  });
});
