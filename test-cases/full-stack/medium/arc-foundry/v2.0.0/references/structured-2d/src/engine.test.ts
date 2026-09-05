// Arc Foundry under the engine, in process.
//
// Every check here stands the game up on a real engine over an `@napi-rs/canvas` canvas
// and a `SurfaceMetrics` of its own (`src/harness.ts`), so it runs with no browser and
// no document behind it, and steps it with `engine.advance` against a fixed clock. Keys
// and the pointer are driven by dispatching keyboard-shaped and pointer-shaped events at
// the surface's event target, which is the same listener a player's input reaches, and
// what is read back is the world's own state, the debug surface `initialize` returned,
// the engine's cue events, and the pixels the render produced.
//
// The produced files do not resolve with no page behind the loader, so a headless run is
// exactly the case this build's fallbacks are for: every sprite is drawn from its own
// geometry and every cue plays its declared shape. That the game is fully playable this
// way is itself worth checking.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUES } from "./constants";
import { center, createHarness, FRAME_MS, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("initialization", () => {
  it("opens on the title screen with the surface in place", () => {
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.phase).toBeNull();
    expect(snap.version).toBe(3);
  });

  it("draws a frame without a produced file behind it", async () => {
    await h.step(2);
    expect(h.engine.frame().count).toBe(2);
  });
});

describe("the frame", () => {
  it("advances the simulation clock only on the playing screen", async () => {
    await h.step(10);
    expect(h.debug.snapshot().simTime).toBe(0);
    h.debug.startRun();
    await h.step(60);
    expect(h.debug.snapshot().simTime).toBeCloseTo(1, 2);
  });

  it("stops the clock under the in-place pause", async () => {
    h.debug.startRun();
    await h.step(30);
    const held = h.debug.snapshot().simTime;
    h.debug.setPaused(true);
    await h.step(30);
    expect(h.debug.snapshot().simTime).toBeCloseTo(held, 5);
  });

  it("reaches the same clock however the span is divided into frames", async () => {
    h.debug.startRun();
    await h.step(120);
    const twoSeconds = h.debug.snapshot().simTime;
    h.debug.reset();
    h.debug.startRun();
    h.engine.setClock(new ConstantClock(FRAME_MS * 4));
    await h.step(30);
    expect(h.debug.snapshot().simTime).toBeCloseTo(twoSeconds, 5);
  });
});

describe("the keyboard", () => {
  it("walks the title menu and takes the highlighted entry", async () => {
    h.tap("ArrowDown");
    await h.step();
    expect(h.debug.snapshot().menuIndex).toBe(1);
    h.tap("Enter");
    await h.step();
    expect(h.debug.snapshot().screen).toBe("howto");
  });

  it("backs out of a screen with the back action", async () => {
    h.debug.setScreen("mapselect");
    h.tap("Escape");
    await h.step();
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("arms a rock from the press key during a build phase", async () => {
    h.debug.startRun();
    h.tap("KeyB");
    await h.step();
    expect(h.debug.snapshot().held.active).toBe(true);
  });

  it("cycles the speed multiplier one step per press", async () => {
    h.debug.startRun();
    h.tap("KeyF");
    await h.step();
    expect(h.debug.snapshot().speed).toBe(2);
    h.tap("KeyF");
    await h.step();
    expect(h.debug.snapshot().speed).toBe(4);
  });

  it("mutes from any screen, and the bar reads it", async () => {
    h.tap("KeyM");
    await h.step();
    expect(h.debug.snapshot().muted).toBe(true);
  });
});

describe("the pointer", () => {
  it("activates the control its press lands in", async () => {
    h.debug.startRun();
    await h.step();
    const speed = h.debug.statusControls().find((c) => c.action === "speed")!;
    await h.press(...center(speed));
    await h.step();
    expect(h.debug.snapshot().speed).toBe(2);
  });

  it("takes a menu entry at the rectangle the reading reports", async () => {
    const salvage = h.debug.menuButtons().find((c) => c.action === "salvage")!;
    await h.press(...center(salvage));
    await h.step();
    expect(h.debug.snapshot().screen).toBe("mapselect");
  });

  it("adds a structure to the combine set while the modifier is held", async () => {
    h.debug.startRun();
    h.debug.placeComponent("coil", 1, 10, 10);
    h.debug.placeComponent("coil", 1, 14, 10);
    const [first, second] = h.debug.snapshot().structures;
    // The first press selects; the second, with the modifier held across it, adds.
    await h.press(first!.cx, first!.cy);
    await h.step();
    h.hold("ShiftLeft");
    await h.press(second!.cx, second!.cy);
    await h.step();
    h.release("ShiftLeft");
    expect(h.debug.snapshot().selected).toBe(first!.id);
    expect(h.debug.snapshot().combineSet).toEqual([first!.id, second!.id]);
  });

  it("reads the modifier as a level, so a held key still modifies later presses", async () => {
    h.debug.startRun();
    h.debug.placeComponent("coil", 1, 10, 10);
    h.debug.placeComponent("coil", 1, 14, 10);
    h.debug.placeComponent("coil", 1, 18, 10);
    const [first, second, third] = h.debug.snapshot().structures;
    await h.press(first!.cx, first!.cy);
    await h.step();
    h.hold("ShiftLeft");
    // Two presses across one hold: an edge would have been spent by the first.
    await h.press(second!.cx, second!.cy);
    await h.step();
    await h.press(third!.cx, third!.cy);
    await h.step();
    h.release("ShiftLeft");
    expect(h.debug.snapshot().combineSet).toEqual([
      first!.id,
      second!.id,
      third!.id,
    ]);
  });

  it("drops a held rock where the press lands", async () => {
    h.debug.startRun();
    h.tap("KeyB");
    await h.step();
    await h.press(300, 300);
    await h.step();
    const snap = h.debug.snapshot();
    expect(snap.structures).toHaveLength(1);
    expect(snap.structures[0]!.kind).toBe("candidate");
  });
});

describe("the screens", () => {
  it("opens the pause menu with the back action and resumes from its choice", async () => {
    h.debug.startRun();
    h.tap("Escape");
    await h.step();
    expect(h.debug.snapshot().screen).toBe("paused");
    const resume = h.debug.menuButtons().find((c) => c.action === "resume")!;
    await h.press(...center(resume));
    await h.step();
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.paused).toBe(false);
  });

  it("holds the simulation clock still while a menu screen is showing", async () => {
    h.debug.startRun();
    await h.step(30);
    const held = h.debug.snapshot().simTime;
    h.tap("Escape");
    await h.step(30);
    expect(h.debug.snapshot().simTime).toBeCloseTo(held, 5);
  });
});

describe("audio", () => {
  it("plays the stamp cue when a rock lands", async () => {
    h.debug.startRun();
    h.cues.length = 0;
    h.debug.placeRock(10, 10);
    await h.step();
    expect(h.cues.map((c) => c.cue)).toContain(CUES.stamp);
  });

  it("plays a firing cue when a structure shoots", async () => {
    h.debug.startRun();
    h.debug.placeComponent("capacitor", 5, 10, 10);
    h.debug.spawnUnit("mote");
    const at = h.debug.snapshot().structures[0]!;
    const unit = h.debug.snapshot().units[0]!;
    h.debug.setUnitPosition(unit.id, at.cx + 20, at.cy);
    h.debug.setUnitFrozen(unit.id, true);
    h.cues.length = 0;
    await h.step(30);
    expect(h.cues.map((c) => c.cue)).toContain(CUES.fireBolt);
  });
});

describe("rendering", () => {
  it("clears the stage to the background it declares", async () => {
    await h.step();
    const { data } = h.ctx.getImageData(2, 2, 1, 1);
    expect([data[0], data[1], data[2]]).toEqual([5, 8, 12]);
  });

  it("draws the yard once a run has begun", async () => {
    h.debug.startRun();
    await h.step();
    const { data } = h.ctx.getImageData(400, 400, 1, 1);
    // The substrate is lighter than the letterbox void behind the stage.
    expect(data[0] + data[1] + data[2]).toBeGreaterThan(5 + 8 + 12);
  });
});
