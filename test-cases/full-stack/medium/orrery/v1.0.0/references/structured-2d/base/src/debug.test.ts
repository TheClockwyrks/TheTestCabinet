import { describe, expect, it } from "vitest";

import { challengeCount } from "./challenges";
import {
  ORRERY_DEBUG_VERSION,
  TAPE_Y0,
  TITLE_ITEMS,
  TRAY_REGION_W,
} from "./constants";
import { createDebugApi, type OrreryDebugApi } from "./debug";
import { Bench } from "./harness";
import { hexX, hexY } from "./hex";
import { advanceFrame } from "./flow";
import { stashedMachine } from "./state";

/** A game with the state operations over it. */
function bench(): { game: Bench; api: OrreryDebugApi } {
  const game = new Bench();
  return { game, api: createDebugApi(() => game) };
}

/** Extras 1, opened, with an empty machine. */
function opened(): { game: Bench; api: OrreryDebugApi } {
  const made = bench();
  made.api.openChallenge("extras", 0);
  return made;
}

describe("the surface itself (specs/instrumentation.md)", () => {
  it("carries every operation the specification names, as a function", () => {
    const { api } = bench();
    const operations = [
      "reset",
      "snapshot",
      "reconcile",
      "setCompletion",
      "setScreen",
      "setMode",
      "setMenuIndex",
      "setSelectIndex",
      "setHowtoPage",
      "setUnlockedCount",
      "setSolved",
      "setRecord",
      "setLast",
      "menuItemRect",
      "openChallenge",
      "loadChallenge",
      "referenceSolution",
      "clearMachine",
      "placePart",
      "placeRise",
      "placeSet",
      "placeTrack",
      "extendTrack",
      "closeTrack",
      "removePart",
      "setPartRotation",
      "setPartLength",
      "movePart",
      "setTapeCell",
      "loadSolution",
      "readSolution",
      "setSelected",
      "setFocus",
      "setCursor",
      "pointerDown",
      "pointerMove",
      "pointerUp",
      "startRun",
      "stopRun",
      "setPaused",
      "setSpeed",
      "setCycle",
      "setTally",
      "clearMotes",
      "spawnMote",
      "removeMote",
      "linkMotes",
      "unlinkMotes",
      "setGrip",
      "releaseGrip",
      "setPoseRotation",
      "setPoseLength",
      "setPoseCell",
    ] as const;
    for (const name of operations) {
      expect(typeof api[name], name).toBe("function");
    }
  });

  it("reports its version, and the snapshot reports the same figure", () => {
    const { api } = bench();
    expect(api.version).toBe(ORRERY_DEBUG_VERSION);
    expect(api.snapshot().version).toBe(ORRERY_DEBUG_VERSION);
  });

  it("carries no clock operation: the engine owns the clock", () => {
    const { api } = bench();
    const surface = api as unknown as Record<string, unknown>;
    expect(surface.setAutoStep).toBeUndefined();
    expect(surface.advance).toBeUndefined();
    expect(api.snapshot().autoStep).toBeUndefined();
  });

  it("fails loudly on an argument outside its stated domain", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    const part = game.state.editor.parts[0].id;
    api.startRun();
    expect(() => api.setSpeed(4)).toThrow();
    expect(() => api.setPartRotation(part, 6)).toThrow();
    expect(() => api.setPartLength(part, 4)).toThrow();
    expect(() => api.setHowtoPage(5)).toThrow();
    expect(() =>
      api.setTapeCell(part, 0, "grabb" as unknown as null),
    ).toThrow();
    expect(game.state.sim?.speed).toBe(1);
    expect(game.state.editor.parts[0].rotation).toBe(0);
    expect(game.state.editor.parts[0].tape).toEqual([]);
  });
});

describe("session (specs/instrumentation.md)", () => {
  it("restores every declared field to its title-screen value", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.setCompletion(false);
    api.setSolved("extras", 3, true);
    api.setRecord("extras", 3, "cost", 40);
    api.setLast("extras", 3);
    advanceFrame(game, 0.5);
    api.reset();
    const snapshot = api.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.mode).toBe("campaign");
    expect(snapshot.howtoPage).toBe(0);
    expect(snapshot.challenge).toBeNull();
    expect(snapshot.sim).toBeNull();
    expect(snapshot.completion).toBe(true);
    expect(snapshot.simTime).toBe(0);
    expect(snapshot.pointer).toEqual({ x: 0, y: 0, down: false });
    expect(snapshot.extras).toMatchObject({
      solved: [],
      stashed: [],
      last: 0,
    });
    expect(snapshot.campaign).toMatchObject({ unlockedCount: 1 });
    expect(snapshot.editor).toMatchObject({
      parts: [],
      cost: 0,
      period: 1,
      selected: null,
      cursor: null,
      focus: "field",
      drag: null,
      undoDepth: 0,
      redoDepth: 0,
    });
  });

  it("leaves the mute bit as it stands: the engine owns muting", () => {
    const { game, api } = bench();
    game.state.muted = true;
    api.reset();
    expect(game.state.muted).toBe(true);
  });

  it("reads without changing: a snapshotted session matches an unwatched one", () => {
    const watched = opened();
    const quiet = opened();
    watched.api.placePart("arm", 0, 0, 0);
    quiet.api.placePart("arm", 0, 0, 0);
    watched.api.startRun();
    quiet.api.startRun();
    for (let frame = 0; frame < 20; frame += 1) {
      advanceFrame(watched.game, 1 / 60);
      watched.api.snapshot();
      advanceFrame(quiet.game, 1 / 60);
    }
    expect(watched.api.snapshot()).toEqual(quiet.api.snapshot());
  });

  it("reconciles every derived reading to the world a pose left", () => {
    const { api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.spawnMote(3, 0, "sol");
    api.reconcile();
    const snapshot = api.snapshot();
    const editor = snapshot.editor as { parts: unknown[]; cost: number };
    const sim = snapshot.sim as {
      motes: { q: number; r: number; x: number; y: number }[];
    };
    // The cost follows from the parts, and a resting mote's drawn position from
    // the hex it was posed on — both for the machine and the field as they are
    // NOW, with no frame having been advanced to make them so.
    expect(editor.parts).toHaveLength(1);
    expect(editor.cost).toBeGreaterThan(0);
    expect(sim.motes[0]).toMatchObject({
      q: 3,
      r: 0,
      x: hexX(3, 0),
      y: hexY(3, 0),
    });
  });

  it("advances nothing, and twice leaves what once leaves", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.spawnMote(3, 0, "sol");
    const before = api.snapshot();
    api.reconcile();
    const once = api.snapshot();
    api.reconcile();
    const twice = api.snapshot();
    // The clock is exactly where it was: no cycle ran, no fraction moved, no
    // frame time accumulated, nothing faulted, and no mote went anywhere.
    expect(once.simTime).toBe(before.simTime);
    expect(once.sim).toMatchObject({
      status: "running",
      cycle: (before.sim as { cycle: number }).cycle,
      fraction: (before.sim as { fraction: number }).fraction,
      fault: null,
    });
    expect(game.state.sim?.motes).toHaveLength(1);
    // This build works every derived reading out at the read, so there is
    // nothing for the call to rewrite and the whole snapshot matches.
    expect(once).toEqual(before);
    expect(twice).toEqual(once);
  });
});

describe("navigation and progress (specs/instrumentation.md)", () => {
  it("enters each screen exactly as the real transition does", () => {
    const { game, api } = bench();
    api.setScreen("howto");
    expect(game.state.screen).toBe("howto");
    expect(game.state.howtoPage).toBe(0);
    api.setMode("extras");
    api.setLast("extras", 4);
    api.setScreen("select");
    expect(game.state.selectIndex).toBe(4);
    api.setScreen("title");
    expect(game.state.menuIndex).toBe(0);
  });

  it("throws entering the editor with no challenge open", () => {
    const { game, api } = bench();
    expect(() => api.setScreen("editor")).toThrow(/no challenge/);
    expect(game.state.screen).toBe("title");
  });

  it("stops the run and stashes the machine on leaving the editor", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.setScreen("select");
    expect(game.state.sim).toBeNull();
    expect(game.state.challenge).toBeNull();
    expect(api.snapshot().extras).toMatchObject({ stashed: [0] });
    expect(stashedMachine(game.state, "extras", 0)).toHaveLength(1);
  });

  it("keeps the solved set ascending and free of duplicates", () => {
    const { api } = bench();
    api.setSolved("extras", 5, true);
    api.setSolved("extras", 1, true);
    api.setSolved("extras", 5, true);
    expect(api.snapshot().extras).toMatchObject({ solved: [1, 5] });
    api.setSolved("extras", 1, false);
    expect(api.snapshot().extras).toMatchObject({ solved: [5] });
  });

  it("creates a missing records entry with its other two metrics at zero", () => {
    const { api } = bench();
    api.setRecord("extras", 2, "cycles", 17);
    const records = (api.snapshot().extras as { records: unknown[] }).records;
    expect(records[2]).toEqual({ cost: 0, cycles: 17, area: 0 });
  });

  it("names the bounds for an index outside a mode's course", () => {
    const { api } = bench();
    expect(() => api.setSolved("extras", 10, true)).toThrow(/0 to 9/);
    expect(() => api.setRecord("extras", -1, "cost", 0)).toThrow(/0 to 9/);
    expect(() => api.setLast("extras", 99)).toThrow(/0 to 9/);
    expect(() => api.openChallenge("extras", 10)).toThrow(/0 to 9/);
  });
});

describe("the menu layout (specs/instrumentation.md)", () => {
  it("reports a region for every item the current screen's menu shows", () => {
    const { game, api } = bench();
    for (let index = 0; index < TITLE_ITEMS.length; index += 1) {
      const rect = api.menuItemRect(index);
      expect(rect, `title item ${index}`).not.toBeNull();
      expect(rect?.w).toBeGreaterThan(0);
      expect(rect?.h).toBeGreaterThan(0);
    }
    api.setScreen("howto");
    expect(api.menuItemRect(0)).not.toBeNull();
    api.setScreen("select");
    expect(
      api.menuItemRect(challengeCount(game.state.mode) - 1),
    ).not.toBeNull();
  });

  it("answers null for an index that names no item of that menu", () => {
    const { api } = bench();
    expect(api.menuItemRect(TITLE_ITEMS.length)).toBeNull();
    expect(api.menuItemRect(-1)).toBeNull();
    expect(api.menuItemRect(1.5)).toBeNull();
    api.setScreen("howto");
    expect(api.menuItemRect(1)).toBeNull();
  });

  it("answers null on the editor, which shows a menu only when solved", () => {
    const { game, api } = opened();
    expect(api.menuItemRect(0)).toBeNull();
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    expect(api.menuItemRect(0)).toBeNull();
    api.setPaused(true);
    expect(api.menuItemRect(0)).toBeNull();
    api.setPaused(false);
    api.setTally(0, 6);
    advanceFrame(game, 1);
    expect(game.state.sim?.status).toBe("complete");
    expect(api.menuItemRect(0)).not.toBeNull();
  });

  it("changes nothing, as a read of the state, and fails on a non-number", () => {
    const { api } = bench();
    const before = api.snapshot();
    api.menuItemRect(0);
    api.menuItemRect(TITLE_ITEMS.length);
    expect(api.snapshot()).toEqual(before);
    expect(() => api.menuItemRect("0" as unknown as number)).toThrow(/number/);
  });
});

describe("the challenge (specs/instrumentation.md)", () => {
  it("opens a shipped challenge, reporting its mode and index", () => {
    const { game, api } = opened();
    expect(game.state.screen).toBe("editor");
    const challenge = api.snapshot().challenge as Record<string, unknown>;
    expect(challenge.name).toBe("First Light");
    expect(challenge.source).toBe("extras");
    expect(challenge.index).toBe(0);
    expect(game.state.editor.parts).toEqual([]);
  });

  it("reports a directly loaded challenge as custom, with a null index", () => {
    const { api } = bench();
    api.loadChallenge({
      name: "Posed",
      reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      products: [{ motes: [{ q: 0, r: 0, type: "sol" }], filaments: [] }],
      permitted: ["arm", "wheel"],
      target: 2,
    });
    const challenge = api.snapshot().challenge as Record<string, unknown>;
    expect(challenge.source).toBe("custom");
    expect(challenge.index).toBeNull();
    expect(challenge.target).toBe(2);
    expect(challenge.permitted).toEqual(["arm", "wheel"]);
  });

  it("refuses a malformed document and changes nothing", () => {
    const { game, api } = opened();
    expect(() => api.loadChallenge({ name: "x", reagents: [] })).toThrow();
    expect(game.state.challenge?.name).toBe("First Light");
  });

  it("leaves every progress figure alone", () => {
    const { game, api } = bench();
    api.setSolved("extras", 2, true);
    api.setUnlockedCount(1);
    api.setLast("extras", 4);
    api.openChallenge("extras", 7);
    expect(game.state.extrasSolved).toEqual([2]);
    expect(game.state.unlockedCount).toBe(1);
    expect(game.state.extrasLast).toBe(4);
  });

  it("stashes nothing: a per-challenge stash stands as it stood", () => {
    const { api } = bench();
    api.openChallenge("extras", 3);
    api.placePart("arm", 0, 0, 0);
    api.openChallenge("extras", 5);
    api.loadChallenge({
      name: "Posed",
      reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      permitted: ["arm"],
      target: 1,
    });
    expect(api.snapshot().extras).toMatchObject({ stashed: [] });
  });

  it("leaves the how-to's page at rest away from the how-to", () => {
    const { api } = bench();
    api.setScreen("howto");
    api.setHowtoPage(3);
    api.openChallenge("extras", 0);
    expect(api.snapshot().howtoPage).toBe(0);
  });
});

describe("the machine (specs/instrumentation.md)", () => {
  it("places a part at length 1 with an empty tape, last in placement order", () => {
    const { game, api } = opened();
    api.placePart("triarm", 1, 0, 2);
    const parts = game.state.editor.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      kind: "triarm",
      q: 1,
      r: 0,
      rotation: 2,
      length: 1,
      tape: [],
    });
  });

  it("refuses a track, rise, or set through placePart", () => {
    const { api } = opened();
    expect(() => api.placePart("track", 0, 0, 0)).toThrow(/placeTrack/);
    expect(() => api.placePart("rise", 0, 0, 0)).toThrow(/placeRise/);
    expect(() => api.placePart("set", 0, 0, 0)).toThrow(/placeSet/);
  });

  it("lays a track cell by cell and closes it into a loop", () => {
    const { game, api } = opened();
    api.placeTrack(0, 0);
    const track = game.state.editor.parts[0].id;
    api.extendTrack(track, 1, 0);
    api.extendTrack(track, 0, 1);
    expect(game.state.editor.parts[0].cells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ]);
    api.closeTrack(track);
    expect(game.state.editor.parts[0].closed).toBe(true);
    expect(() => api.extendTrack(track, 5, 0)).toThrow();
  });

  it("translates a whole part, a track's path included", () => {
    const { game, api } = opened();
    api.placeTrack(0, 0);
    const track = game.state.editor.parts[0].id;
    api.extendTrack(track, 1, 0);
    api.movePart(track, 0, 2);
    expect(game.state.editor.parts[0].cells).toEqual([
      { q: 0, r: 2 },
      { q: 1, r: 2 },
    ]);
  });

  it("clears a selection and a cursor the removal invalidates", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.placePart("arm", 3, 0, 0);
    const [first, second] = game.state.editor.parts.map((part) => part.id);
    api.setSelected(first);
    api.setCursor(first, 2);
    api.removePart(second);
    expect(game.state.editor.selected).toBe(first);
    api.removePart(first);
    expect(game.state.editor.selected).toBeNull();
    expect(game.state.editor.cursor).toBeNull();
  });

  it("writes a tape cell, filling the gap with blanks and trimming after", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.setTapeCell(arm, 5, "grab");
    expect(game.state.editor.parts[0].tape).toEqual([
      null,
      null,
      null,
      null,
      null,
      "grab",
    ]);
    api.setTapeCell(arm, 5, null);
    expect(game.state.editor.parts[0].tape).toEqual([]);
  });

  it("places a part the challenge's permitted list does not offer", () => {
    const { game, api } = opened();
    api.placePart("hexarm", 0, 0, 0);
    expect(game.state.editor.parts).toHaveLength(1);
  });

  it("names the first placement rule a refused placement breaks", () => {
    const { api } = opened();
    expect(() => api.placePart("arm", 6, 0, 0)).toThrow(/on the field/);
    api.placePart("bind", 0, 0, 0);
    expect(() => api.placePart("wane", 1, 0, 0)).toThrow(/engraving/);
    api.placePart("arm", 3, 0, 0);
    expect(() => api.placePart("wheel", 3, 0, 0)).toThrow(/already stands/);
  });

  it("throws for every operation of the group with no challenge open", () => {
    const { api } = bench();
    expect(() => api.clearMachine()).toThrow(/no challenge/);
    expect(() => api.placePart("arm", 0, 0, 0)).toThrow(/no challenge/);
    expect(() => api.placeRise(0, 0, 0, 0)).toThrow(/no challenge/);
    expect(() => api.placeSet(0, 0, 0, 0)).toThrow(/no challenge/);
    expect(() => api.placeTrack(0, 0)).toThrow(/no challenge/);
    expect(() => api.extendTrack(1, 0, 0)).toThrow(/no challenge/);
    expect(() => api.closeTrack(1)).toThrow(/no challenge/);
    expect(() => api.removePart(1)).toThrow(/no challenge/);
    expect(() => api.setPartRotation(1, 0)).toThrow(/no challenge/);
    expect(() => api.setPartLength(1, 1)).toThrow(/no challenge/);
    expect(() => api.movePart(1, 0, 0)).toThrow(/no challenge/);
    expect(() => api.setTapeCell(1, 0, null)).toThrow(/no challenge/);
    expect(() => api.loadSolution({ parts: [] })).toThrow(/no challenge/);
    expect(() => api.readSolution()).toThrow(/no challenge/);
  });

  it("pushes no undo entry, so the depths move under the pointer alone", () => {
    const { api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.placeTrack(0, 2);
    api.clearMachine();
    const editor = api.snapshot().editor as Record<string, unknown>;
    expect(editor.undoDepth).toBe(0);
    expect(editor.redoDepth).toBe(0);
  });

  it("empties the machine and the hands, and leaves the challenge and run", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.spawnMote(3, 0, "sol");
    api.clearMachine();
    expect(game.state.editor.parts).toEqual([]);
    expect(game.state.challenge).not.toBeNull();
    expect(game.state.sim?.status).toBe("running");
    expect(game.state.sim?.motes).toHaveLength(1);
  });

  it("round trips a machine through readSolution and loadSolution", () => {
    const { game, api } = opened();
    api.placePart("piston", 0, 0, 1);
    api.placeTrack(0, 2);
    api.placeRise(0, -3, 0, 0);
    const piston = game.state.editor.parts[0].id;
    api.setPartLength(piston, 3);
    api.setTapeCell(piston, 0, "extend");
    const document = api.readSolution();
    api.clearMachine();
    api.loadSolution(document);
    // A solution carries no ids: a reloaded machine is the same parts, in the
    // same order, at the same poses, with the same paths and tapes.
    expect(api.readSolution()).toEqual(document);
    expect(game.state.editor.parts.map((part) => part.kind)).toEqual([
      "piston",
      "track",
      "rise",
    ]);
  });
});

describe("a part added or removed mid-run (specs/instrumentation.md)", () => {
  it("enters the run at its rest pose, holding nothing", () => {
    const { game, api } = opened();
    api.startRun();
    api.placePart("arm", 0, 0, 3);
    const arm = game.state.editor.parts[0].id;
    expect(game.state.sim?.poses).toEqual([
      { part: arm, rotation: 3, length: 1, cell: { q: 0, r: 0 } },
    ]);
    expect(game.state.sim?.grips).toEqual([]);
  });

  it("raises a wheel's six fixtures as it enters", () => {
    const { game, api } = opened();
    api.startRun();
    api.placePart("wheel", 0, 0, 0);
    expect(game.state.sim?.motes).toHaveLength(6);
  });

  it("takes a part's pose, grips, and fixtures off with it", () => {
    const { game, api } = opened();
    api.startRun();
    api.placePart("wheel", 0, 0, 0);
    api.placePart("arm", 0, 3, 0);
    const [wheel, arm] = game.state.editor.parts.map((part) => part.id);
    api.spawnMote(1, 3, "sol");
    const motes = game.state.sim?.motes ?? [];
    const mote = motes[motes.length - 1].id;
    api.setGrip(arm, 0, mote);
    api.removePart(wheel);
    expect(game.state.sim?.motes.map((entry) => entry.id)).toEqual([mote]);
    api.removePart(arm);
    expect(game.state.sim?.poses).toEqual([]);
    expect(game.state.sim?.grips).toEqual([]);
    expect(game.state.sim?.motes).toHaveLength(1);
  });

  it("keeps the rest pose and the live pose apart", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.startRun();
    api.setPartRotation(arm, 4);
    api.setPartLength(arm, 3);
    api.movePart(arm, 1, 0);
    expect(game.state.sim?.poses[0]).toEqual({
      part: arm,
      rotation: 0,
      length: 1,
      cell: { q: 0, r: 0 },
    });
    expect(game.state.editor.parts[0]).toMatchObject({
      rotation: 4,
      length: 3,
      q: 1,
    });
  });
});

describe("the editor's hands (specs/instrumentation.md)", () => {
  it("selects a part, and clears the selection with null", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.setSelected(arm);
    expect(game.state.editor.selected).toBe(arm);
    api.setSelected(null);
    expect(game.state.editor.selected).toBeNull();
  });

  it("sets the focus, and points and clears the tape cursor", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.setFocus("tape");
    expect(game.state.editor.focus).toBe("tape");
    api.setCursor(arm, 3);
    expect(game.state.editor.cursor).toEqual({ part: arm, col: 3 });
    api.setCursor(null);
    expect(game.state.editor.cursor).toBeNull();
  });

  it("throws pointing the cursor at a part with no tape row", () => {
    const { game, api } = opened();
    api.placePart("bind", 0, 0, 0);
    const sigil = game.state.editor.parts[0].id;
    expect(() => api.setCursor(sigil, 0)).toThrow(/no tape row/);
    expect(game.state.editor.cursor).toBeNull();
  });

  it("resolves a press, a move, and a release before the call returns", () => {
    const { game, api } = opened();
    api.pointerDown(hexX(0, 0), hexY(0, 0));
    expect(game.state.pointer).toEqual({
      x: hexX(0, 0),
      y: hexY(0, 0),
      down: true,
    });
    api.pointerMove(hexX(1, 0), hexY(1, 0));
    expect(game.state.pointer).toMatchObject({ x: hexX(1, 0), down: true });
    api.pointerUp();
    expect(game.state.pointer.down).toBe(false);
    expect(api.snapshot().pointer).toEqual(game.state.pointer);
  });

  it("sets the focus by where a press lands, as specs/controls.md routes it", () => {
    const { game, api } = opened();
    api.pointerDown(TRAY_REGION_W + 10, TAPE_Y0 + 10);
    expect(game.state.editor.focus).toBe("tape");
    api.pointerUp();
    api.pointerDown(TRAY_REGION_W + 10, TAPE_Y0 - 10);
    expect(game.state.editor.focus).toBe("field");
    api.pointerUp();
    api.pointerDown(TRAY_REGION_W - 10, TAPE_Y0 + 10);
    expect(game.state.editor.focus).toBe("field");
  });

  it("sounds nothing at the call, however much it poses", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.pointerDown(hexX(0, 0), hexY(0, 0));
    api.pointerUp();
    expect(game.cues).toEqual([]);
  });
});

describe("the run (specs/instrumentation.md)", () => {
  it("throws for every operation of the group with no run live", () => {
    const { api } = opened();
    expect(() => api.stopRun()).toThrow(/no run/);
    expect(() => api.setPaused(true)).toThrow(/no run/);
    expect(() => api.setSpeed(0)).toThrow(/no run/);
    expect(() => api.setCycle(0)).toThrow(/no run/);
    expect(() => api.setTally(0, 0)).toThrow(/no run/);
    expect(() => api.clearMotes()).toThrow(/no run/);
    expect(() => api.spawnMote(0, 0, "dust")).toThrow(/no run/);
    expect(() => api.removeMote(1)).toThrow(/no run/);
    expect(() => api.linkMotes(1, 2, 1)).toThrow(/no run/);
    expect(() => api.unlinkMotes(1, 2)).toThrow(/no run/);
    expect(() => api.setGrip(1, 0, 1)).toThrow(/no run/);
    expect(() => api.releaseGrip(1, 0)).toThrow(/no run/);
    expect(() => api.setPoseRotation(1, 0)).toThrow(/no run/);
    expect(() => api.setPoseLength(1, 1)).toThrow(/no run/);
    expect(() => api.setPoseCell(1, 0, 0)).toThrow(/no run/);
  });

  it("refuses to step out of a faulted or complete run", () => {
    const { game, api } = opened();
    api.startRun();
    const sim = game.state.sim;
    if (sim === null) throw new Error("no run");
    sim.status = "faulted";
    expect(() => api.setPaused(false)).toThrow(/faulted/);
    sim.status = "complete";
    expect(() => api.setPaused(true)).toThrow(/complete/);
  });

  it("empties the motes, filaments, and grips, and banks the area still", () => {
    const { game, api } = opened();
    api.placePart("wheel", 0, 0, 0);
    api.startRun();
    const banked = game.state.sim?.areaHexes.length ?? 0;
    api.clearMotes();
    expect(game.state.sim?.motes).toEqual([]);
    expect(game.state.sim?.filaments).toEqual([]);
    expect(game.state.sim?.grips).toEqual([]);
    expect(game.state.sim?.areaHexes).toHaveLength(banked);
  });

  it("spawns a mote with a fresh id, off the field like any other", () => {
    const { game, api } = opened();
    api.startRun();
    api.spawnMote(0, 0, "mercury");
    api.spawnMote(9, 0, "aether");
    const motes = game.state.sim?.motes ?? [];
    expect(motes.map((mote) => mote.type)).toEqual(["mercury", "aether"]);
    expect(motes[1].id).not.toBe(motes[0].id);
    expect(motes[1].wheel).toBeNull();
    expect(() => api.spawnMote(0, 0, "dust")).toThrow(/already holds/);
    expect(() => api.spawnMote(4, 0, "star" as never)).toThrow();
  });

  it("removes a mote with every filament and grip touching it", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.startRun();
    api.spawnMote(1, 0, "dust");
    api.spawnMote(2, 0, "dust");
    const [first, second] = (game.state.sim?.motes ?? []).map((m) => m.id);
    api.linkMotes(first, second, 3);
    api.setGrip(arm, 0, first);
    expect(game.state.sim?.filaments).toEqual([
      { a: first, b: second, weight: 3 },
    ]);
    api.removeMote(first);
    expect(game.state.sim?.filaments).toEqual([]);
    expect(game.state.sim?.grips).toEqual([]);
    expect(game.state.sim?.motes).toHaveLength(1);
  });

  it("refuses a filament that is not one filament between two adjacent motes", () => {
    const { game, api } = opened();
    api.placePart("wheel", 0, 3, 0);
    api.startRun();
    api.spawnMote(0, 0, "dust");
    api.spawnMote(2, 0, "dust");
    const loose = (game.state.sim?.motes ?? []).filter((m) => m.wheel === null);
    const fixture = (game.state.sim?.motes ?? []).find((m) => m.wheel !== null);
    expect(() => api.linkMotes(loose[0].id, loose[1].id, 1)).toThrow(
      /adjacent/,
    );
    expect(() => api.linkMotes(loose[0].id, fixture?.id ?? 0, 1)).toThrow(
      /fixture/,
    );
    expect(() => api.linkMotes(loose[0].id, loose[1].id, 2)).toThrow(/1 or 3/);
    api.spawnMote(1, 0, "dust");
    const all = game.state.sim?.motes ?? [];
    const middle = all[all.length - 1].id;
    api.linkMotes(loose[0].id, middle, 1);
    expect(() => api.linkMotes(middle, loose[0].id, 1)).toThrow(/already/);
    expect(() => api.unlinkMotes(loose[1].id, middle)).toThrow(/no filament/);
    api.unlinkMotes(middle, loose[0].id);
    expect(game.state.sim?.filaments).toEqual([]);
  });

  it("takes and opens a gripper's hold with no grab ever running", () => {
    const { game, api } = opened();
    api.placePart("biarm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.startRun();
    api.spawnMote(1, 0, "sol");
    const mote = game.state.sim?.motes[0].id ?? 0;
    api.setGrip(arm, 0, mote);
    expect(game.state.sim?.grips).toEqual([{ part: arm, spoke: 0, mote }]);
    api.releaseGrip(arm, 0);
    expect(game.state.sim?.grips).toEqual([]);
  });

  it("refuses a grip on a spoke with no gripper, a mote elsewhere, or a fixture", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.placePart("wheel", 0, 3, 0);
    const [arm, wheel] = game.state.editor.parts.map((part) => part.id);
    api.startRun();
    api.spawnMote(1, 0, "sol");
    const motes = game.state.sim?.motes ?? [];
    const mote = motes[motes.length - 1].id;
    const fixture = game.state.sim?.motes[0].id ?? 0;
    expect(() => api.setGrip(arm, 1, mote)).toThrow(/no gripper on spoke/);
    expect(() => api.setGrip(wheel, 0, mote)).toThrow(/no gripper/);
    api.spawnMote(2, 0, "sol");
    const withAway = game.state.sim?.motes ?? [];
    const away = withAway[withAway.length - 1].id;
    expect(() => api.setGrip(arm, 0, away)).toThrow(/does not rest/);
    expect(() => api.setGrip(arm, 0, fixture)).toThrow(/fixture/);
  });

  it("poses a live rotation, length, and base cell", () => {
    const { game, api } = opened();
    api.placeTrack(0, 0);
    const track = game.state.editor.parts[0].id;
    api.extendTrack(track, 1, 0);
    api.placePart("piston", 0, 0, 0);
    const piston = game.state.editor.parts[1].id;
    api.startRun();
    api.setPoseRotation(piston, 4);
    api.setPoseLength(piston, 3);
    api.setPoseCell(piston, 1, 0);
    expect(game.state.sim?.poses[0]).toEqual({
      part: piston,
      rotation: 4,
      length: 3,
      cell: { q: 1, r: 0 },
    });
    expect(() => api.setPoseCell(piston, 3, 0)).toThrow(/not a cell/);
    expect(() => api.setPoseCell(track, 0, 0)).toThrow();
  });

  it("sets the cycle, so the next cycle reads that cell of every tape", () => {
    const { game, api } = opened();
    api.startRun();
    api.setCycle(9);
    expect(game.state.sim?.cycle).toBe(9);
    expect(() => api.setCycle(-1)).toThrow(/at least 0/);
  });

  it("sets one product's tally", () => {
    const { game, api } = opened();
    api.startRun();
    api.setTally(0, 4);
    expect(game.state.sim?.tallies).toEqual([4]);
    expect(() => api.setTally(1, 0)).toThrow();
    expect(() => api.setTally(0, -1)).toThrow(/at least 0/);
  });
});

describe("the snapshot's shape (specs/instrumentation.md)", () => {
  it("carries every field whatever the screen, at its resting value", () => {
    const { api } = bench();
    const snapshot = api.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "campaign",
        "challenge",
        "completion",
        "editor",
        "extras",
        "howtoPage",
        "menuIndex",
        "mode",
        "muted",
        "pointer",
        "screen",
        "selectIndex",
        "sim",
        "simTime",
        "titleIndex",
        "version",
      ].sort(),
    );
    expect(snapshot.completion).toBe(true);
    expect(snapshot.challenge).toBeNull();
    expect(snapshot.sim).toBeNull();
    expect(snapshot.extras).toMatchObject({ count: 10 });
  });

  it("reports a mote's hex and its drawn position at the fraction", () => {
    const { game, api } = opened();
    api.startRun();
    api.spawnMote(1, -1, "nova");
    const sim = api.snapshot().sim as { motes: Record<string, number>[] };
    expect(sim.motes[0]).toMatchObject({
      q: 1,
      r: -1,
      x: hexX(1, -1),
      y: hexY(1, -1),
    });
    expect(game.state.sim?.motes).toHaveLength(1);
  });

  it("derives the cost, the period, and the banked area", () => {
    const { game, api } = opened();
    api.placePart("hexarm", 0, 0, 0);
    api.placeTrack(0, 3);
    const arm = game.state.editor.parts[0].id;
    api.setTapeCell(arm, 3, "grab");
    const editor = api.snapshot().editor as Record<string, number>;
    expect(editor.cost).toBe(65);
    expect(editor.period).toBe(4);
    api.startRun();
    const sim = api.snapshot().sim as Record<string, number>;
    expect(sim.area).toBe(game.state.sim?.areaHexes.length);
  });

  it("reports each mode's stashed challenges in ascending order", () => {
    const { api } = bench();
    api.openChallenge("extras", 3);
    api.setScreen("title");
    api.openChallenge("extras", 1);
    api.setScreen("title");
    expect(api.snapshot().extras).toMatchObject({ stashed: [1, 3] });
  });
});
