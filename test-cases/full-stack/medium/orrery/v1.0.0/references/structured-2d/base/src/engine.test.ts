// Orrery under the engine, in process.
//
// Every check here drives a real engine through `src/harness.ts`: the frame
// loop, the cycles the game mode advances inside it, the keyboard and the
// pointer the player controller reads, the cue bus and the looping bed, the
// actors the reconciler keeps mirroring the state, the diagnostic sources the
// overlay reads, and the pixels the pipeline's draw components produced.
// Nothing is reimplemented — what runs is the same `GameDefinition`
// `src/main.ts` binds to the engine in a browser.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACTIONS,
  CUES,
  ORRERY_DEBUG_VERSION,
  STAGE_H,
  STAGE_W,
  TAGS,
  TITLE_ITEMS,
} from "./constants";
import { menuItemRect } from "./flow";
import { createHarness, type Harness } from "./harness";
import { hexX, hexY } from "./hex";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("boot (specs/overview.md, specs/instrumentation.md)", () => {
  it("opens on the title, in the one level, with the surface off the engine", async () => {
    await h.step(1);
    expect(h.engine.world.level).toBe("sky");
    expect(h.debug.version).toBe(ORRERY_DEBUG_VERSION);
    const snapshot = h.debug.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(TITLE_ITEMS[0]).toBe("CAMPAIGN");
    expect(h.state.sim).toBeNull();
  });

  it("adds one player, possessing nothing, and never leaves the level", async () => {
    await h.step(3);
    expect(h.engine.world.players()).toHaveLength(1);
    expect(h.engine.world.players()[0].pawn).toBeNull();
    h.debug.openChallenge("extras", 0);
    await h.step(1);
    expect(h.engine.world.level).toBe("sky");
    expect(h.debug.snapshot().screen).toBe("editor");
  });

  it("draws a real picture, not a blank canvas", async () => {
    await h.step(1);
    const { data } = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H);
    let painted = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] + data[at + 1] + data[at + 2] > 120) painted += 1;
    }
    expect(painted).toBeGreaterThan(3000);
  });

  it("stays running with every produced file unavailable", async () => {
    // Nothing in this process can fetch or decode one, so this whole suite is
    // that check; the frame still draws and the cues still sound.
    await h.step(5);
    expect(h.loops).toContain(CUES.music);
    expect(h.debug.snapshot().screen).toBe("title");
  });
});

describe("the keyboard path (specs/controls.md)", () => {
  it("moves the title highlight with wrap-around", async () => {
    await h.step(1);
    h.tap("ArrowUp");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    h.tap("ArrowDown");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(0);
  });

  it("opens the campaign select screen on Enter, and returns on Escape", async () => {
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("select");
    expect(h.debug.snapshot().mode).toBe("campaign");
    h.tap("Escape");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("reads one press edge per press, not one per frame the key is held", async () => {
    await h.step(1);
    h.press("ArrowDown");
    await h.step(5);
    h.release("ArrowDown");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
  });

  it("answers only the actions the screen reads", async () => {
    await h.step(1);
    // `play` is a run control; the title screen does not read it.
    h.tap("Space");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("registers every action the specification names", async () => {
    // A key bound to an unregistered action would move nothing; every one of
    // these moves the editor, which is the observable form of the registry.
    await h.step(1);
    h.debug.openChallenge("extras", 0);
    h.debug.placePart("arm", 0, 0, 0);
    const arm = h.state.editor.parts[0].id;
    h.debug.setSelected(arm);
    h.tap("KeyE");
    await h.step(1);
    expect(h.state.editor.parts[0].rotation).toBe(1);
    expect(ACTIONS).toContain("part-cw");
  });

  it("toggles the engine's mute bit, and mirrors it into the state", async () => {
    await h.step(1);
    expect(h.state.muted).toBe(false);
    h.tap("KeyM");
    await h.step(1);
    expect(h.engine.world.audio.muted()).toBe(true);
    expect(h.debug.snapshot().muted).toBe(true);
    h.tap("KeyM");
    await h.step(1);
    expect(h.debug.snapshot().muted).toBe(false);
  });
});

describe("the pointer path (specs/controls.md, specs/editor.md)", () => {
  it("takes a press on the tray and a release on the field as a placement", async () => {
    h.debug.openChallenge("extras", 0);
    await h.step(1);
    h.pointer("pointerdown", 20, 62);
    await h.step(1);
    expect(h.state.editor.drag?.kind).toBe("place");
    h.pointer("pointermove", hexX(0, 0), hexY(0, 0));
    h.pointer("pointerup", hexX(0, 0), hexY(0, 0));
    await h.step(1);
    expect(h.state.editor.parts).toHaveLength(1);
    expect(h.state.editor.parts[0].kind).toBe("arm");
    expect(h.cues).toContain(CUES.place);
  });

  it("mirrors the pointer into the state the snapshot reports", async () => {
    await h.step(1);
    h.pointer("pointermove", 300, 200);
    await h.step(1);
    expect(h.debug.snapshot().pointer).toEqual({ x: 300, y: 200, down: false });
    h.pointer("pointerdown", 300, 200);
    await h.step(1);
    expect(h.debug.snapshot().pointer).toEqual({ x: 300, y: 200, down: true });
  });

  it("resolves every sample of a frame in order, so a lay follows the hexes", async () => {
    h.debug.openChallenge("extras", 0);
    h.debug.placeTrack(0, 0);
    const track = h.state.editor.parts[0].id;
    await h.step(1);
    h.pointer("pointerdown", hexX(0, 0), hexY(0, 0));
    h.pointer("pointermove", hexX(1, 0), hexY(1, 0));
    h.pointer("pointermove", hexX(2, 0), hexY(2, 0));
    h.pointer("pointerup", hexX(2, 0), hexY(2, 0));
    await h.step(1);
    const laid = h.state.editor.parts.find((part) => part.id === track);
    expect(laid?.cells).toHaveLength(3);
  });
});

describe("the frame's own bookkeeping (specs/state.md, specs/ui.md)", () => {
  it("accumulates simTime whatever the screen", async () => {
    await h.step(6);
    expect(h.debug.snapshot().simTime).toBeCloseTo(6 / 60, 6);
  });

  it("loops the music bed from the first frame, on every screen", async () => {
    await h.step(1);
    expect(h.loops).toEqual([CUES.music]);
    h.debug.setScreen("howto");
    await h.step(1);
    expect(h.engine.world.audio.looping(CUES.music)).toBe(true);
    expect(h.stops).toEqual([]);
  });

  it("plays a cue an edit raised on the next frame advanced, once", async () => {
    h.debug.openChallenge("extras", 0);
    h.debug.placeRise(0, -3, 0, 0);
    h.debug.placeSet(0, 3, 0, 0);
    await h.step(1);
    const before = h.cues.filter((cue) => cue === CUES.start).length;
    h.tap("Space");
    await h.step(1);
    expect(h.cues.filter((cue) => cue === CUES.start)).toHaveLength(before + 1);
    await h.step(3);
    expect(h.cues.filter((cue) => cue === CUES.start)).toHaveLength(before + 1);
  });

  it("sounds nothing at a pose, and the cue it committed on the next frame", async () => {
    h.debug.openChallenge("extras", 0);
    await h.step(1);
    const before = h.cues.length;
    // A whole placement made from code, with no frame between the calls.
    h.debug.pointerDown(20, 62);
    h.debug.pointerMove(hexX(0, 0), hexY(0, 0));
    h.debug.pointerUp();
    expect(h.state.editor.parts).toHaveLength(1);
    expect(h.cues).toHaveLength(before);
    await h.step(1);
    expect(h.cues.slice(before)).toEqual([CUES.place]);
  });

  it("advances a run by SPEEDS[speed] cycles per second of frame time", async () => {
    h.debug.openChallenge("extras", 0);
    h.debug.placePart("arm", 0, 0, 0);
    h.debug.setTapeCell(h.state.editor.parts[0].id, 0, "rotate-cw");
    h.debug.startRun();
    h.debug.setSpeed(0);
    await h.step(60);
    // One cycle per second at speed 0, and sixty frames of 1/60 s.
    expect(h.state.sim?.cycle).toBe(1);
  });
});

describe("the actor population (specs/state.md)", () => {
  it("opens with the field and the effects layer, and no field things", async () => {
    await h.step(1);
    expect(h.engine.world.byTag(TAGS.field)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.effect)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.part)).toHaveLength(0);
    expect(h.engine.world.byTag(TAGS.mote)).toHaveLength(0);
    expect(h.engine.world.byTag(TAGS.filament)).toHaveLength(0);
  });

  it("mirrors the machine, the motes, and the filaments the state holds", async () => {
    h.debug.openChallenge("extras", 1);
    h.debug.placePart("arm", 0, 0, 0);
    h.debug.placeSet(0, 3, 0, 0);
    h.debug.startRun();
    h.debug.clearMotes();
    h.debug.spawnMote(0, 1, "luna");
    h.debug.spawnMote(1, 1, "luna");
    const motes = h.state.sim?.motes ?? [];
    h.debug.linkMotes(motes[0].id, motes[1].id, 1);
    await h.step(1);
    expect(h.engine.world.byTag(TAGS.part)).toHaveLength(2);
    expect(h.engine.world.byTag(TAGS.mote)).toHaveLength(2);
    expect(h.engine.world.byTag(TAGS.filament)).toHaveLength(1);

    h.debug.removePart(h.state.editor.parts[0].id);
    h.debug.clearMotes();
    await h.step(1);
    expect(h.engine.world.byTag(TAGS.part)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.mote)).toHaveLength(0);
    expect(h.engine.world.byTag(TAGS.filament)).toHaveLength(0);
  });
});

describe("the overlay's sources (specs/instrumentation.md)", () => {
  it("registers the facts the snapshot reports, read live", async () => {
    await h.step(1);
    const named = new Map(
      h.engine.diagnostics().map((entry) => [entry.name, entry.value]),
    );
    for (const name of [
      "screen",
      "mode",
      "challenge",
      "source",
      "parts",
      "cost",
      "period",
      "status",
      "cycle",
      "fraction",
      "speed",
      "tallies",
      "motes",
      "area",
      "fault",
      "focus",
      "pointer",
    ]) {
      expect(named.has(name), name).toBe(true);
    }
    expect(named.get("screen")).toBe("title");

    h.debug.openChallenge("extras", 1);
    await h.step(1);
    const live = new Map(
      h.engine.diagnostics().map((entry) => [entry.name, entry.value]),
    );
    expect(live.get("screen")).toBe("editor");
    expect(live.get("challenge")).toBe("Twin Moons");
    expect(live.get("source")).toBe("extras 2");
  });
});

describe("one frame's keyboard edges beside its pointer samples (specs/ui.md)", () => {
  /** The middle of the region the current menu reports for `index`. */
  function middleOf(index: number): { x: number; y: number } {
    const rect = menuItemRect(h.state, index);
    if (rect === null) throw new Error(`no region for menu item ${index}`);
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  /** A press and its release at one position: a click, or a tap. */
  function clickAt(at: { x: number; y: number }): void {
    h.pointer("pointerdown", at.x, at.y);
    h.pointer("pointerup", at.x, at.y);
  }

  it("leaves the highlight on the item the pointer named", async () => {
    const onExtras = middleOf(1);
    h.tap("ArrowDown");
    h.pointer("pointermove", onExtras.x, onExtras.y);
    await h.step(1);
    expect(h.state.menuIndex).toBe(1);
    expect(h.state.screen).toBe("title");
  });

  it("takes the keyboard's item alone when a click lands on the same frame", async () => {
    h.debug.setMenuIndex(1);
    // An ordinary click on a title item, whose region overlaps a row of the
    // select screen EXTRAS opens: the rows run from y 120 down the stage.
    const onExtras = middleOf(1);
    h.tap("Enter");
    clickAt(onExtras);
    await h.step(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.mode).toBe("extras");
    // The click moved the highlight down the list it landed on, as any sample
    // does, and took nothing: no challenge was opened.
    expect(h.state.challenge).toBeNull();
    expect(h.state.challengeRef).toBeNull();
  });

  it("takes that same click one frame later, so the click is a live one", async () => {
    h.debug.setMenuIndex(1);
    const onExtras = middleOf(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.state.screen).toBe("select");

    clickAt(onExtras);
    await h.step(1);
    expect(h.state.screen).toBe("editor");
    expect(h.state.challengeRef).toEqual({
      mode: "extras",
      index: h.state.selectIndex,
    });
  });
});
