import { describe, expect, it } from "vitest";
import type {
  InputReader,
  PointerSample,
  PointerSnapshot,
} from "@clockwyrks/structured-3d";
import {
  CLICK_SLOP,
  ORBIT_KEY_RATE,
  ORBIT_PER_PX,
  ZOOM_RATE,
} from "./constants";
import {
  advanceTicks,
  applyCameraKeys,
  applyPointerAct,
  diagnosticSources,
  noCapture,
  readInput,
  requestRun,
  TICK_DT,
  updateFrame,
} from "./app-tick";
import { GantryState } from "./game";
import { silentIo, type GameIo } from "./io";
import { startCamera } from "./state";

/** An io that records what it was asked to sound. */
function recordingIo(): GameIo & { cues: string[]; motor: boolean } {
  const base = silentIo();
  const io = {
    ...base,
    cues: [] as string[],
    motor: false,
    playCue(cue: string) {
      io.cues.push(cue);
    },
    setMotor(on: boolean) {
      io.motor = on;
    },
  };
  return io as GameIo & { cues: string[]; motor: boolean };
}

/** A reader that reports exactly what a test hands it. */
function reader(options: {
  values?: Record<string, number>;
  samples?: PointerSample[];
  at?: { x: number; y: number };
}): InputReader {
  return {
    value: (name) => options.values?.[name] ?? 0,
    pressed: () => false,
    pointer: (): PointerSnapshot => ({
      x: options.at?.x ?? 0,
      y: options.at?.y ?? 0,
      down: false,
      device: "mouse",
      buttons: [],
    }),
    pointerPressed: () => false,
    pointerReleased: () => false,
    pointerSamples: () => options.samples ?? [],
    pointerContacts: () => [],
    wheel: () => ({ x: 0, y: 0 }),
  };
}

const sample = (
  type: "down" | "move" | "up",
  x: number,
  y: number,
): PointerSample => ({
  type,
  x,
  y,
  id: 1,
  primary: true,
  device: "mouse",
  button: type === "move" ? null : "primary",
  buttons: type === "up" ? [] : ["primary"],
});

describe("the pointer", () => {
  it("records where a press went down", () => {
    const s = new GantryState();
    s.screen = "build";
    applyPointerAct(
      s,
      { kind: "down", x: 100, y: 50 },
      silentIo(),
      noCapture(),
    );
    expect(s.pointer).toEqual({
      x: 100,
      y: 50,
      down: true,
      pressX: 100,
      pressY: 50,
      dragging: false,
    });
  });

  it("stays a click while the press travels less than CLICK_SLOP", () => {
    const s = new GantryState();
    s.screen = "build";
    const press = noCapture();
    applyPointerAct(s, { kind: "down", x: 100, y: 50 }, silentIo(), press);
    applyPointerAct(
      s,
      { kind: "move", x: 100 + CLICK_SLOP - 1, y: 50 },
      silentIo(),
      press,
    );
    expect(s.pointer.dragging).toBe(false);
  });

  it("becomes a drag at CLICK_SLOP, and that move turns nothing", () => {
    const s = new GantryState();
    s.screen = "build";
    const press = noCapture();
    const before = { ...s.camera };
    applyPointerAct(s, { kind: "down", x: 100, y: 50 }, silentIo(), press);
    applyPointerAct(
      s,
      { kind: "move", x: 100 + CLICK_SLOP, y: 50 },
      silentIo(),
      press,
    );
    expect(s.pointer.dragging).toBe(true);
    expect(s.camera).toEqual(before);
  });

  it("turns the camera by ORBIT_PER_PX once it is a drag", () => {
    const s = new GantryState();
    s.screen = "build";
    s.camera = startCamera();
    const press = noCapture();
    applyPointerAct(s, { kind: "down", x: 100, y: 50 }, silentIo(), press);
    applyPointerAct(s, { kind: "move", x: 200, y: 50 }, silentIo(), press);
    const yaw = s.camera.yaw;
    applyPointerAct(s, { kind: "move", x: 240, y: 30 }, silentIo(), press);
    expect(s.camera.yaw - yaw).toBeCloseTo(40 * ORBIT_PER_PX, 9);
    expect(s.camera.pitch).toBeCloseTo(
      startCamera().pitch + 20 * ORBIT_PER_PX,
      9,
    );
  });

  it("turns nothing on a screen that is not the yard", () => {
    const s = new GantryState();
    const press = noCapture();
    const before = { ...s.camera };
    applyPointerAct(s, { kind: "down", x: 100, y: 50 }, silentIo(), press);
    applyPointerAct(s, { kind: "move", x: 300, y: 50 }, silentIo(), press);
    applyPointerAct(s, { kind: "move", x: 400, y: 90 }, silentIo(), press);
    expect(s.camera).toEqual(before);
  });

  it("ends the press on a release, leaving where it began", () => {
    const s = new GantryState();
    s.screen = "select";
    const press = noCapture();
    applyPointerAct(s, { kind: "down", x: 12, y: 34 }, silentIo(), press);
    applyPointerAct(s, { kind: "up", x: 12, y: 34 }, silentIo(), press);
    expect(s.pointer.down).toBe(false);
    expect(s.pointer.dragging).toBe(false);
    expect(s.pointer.pressX).toBe(12);
    expect(s.pointer.pressY).toBe(34);
  });
});

describe("the camera keys", () => {
  it("turns and zooms against the frame's delta on a yard screen", () => {
    const s = new GantryState();
    s.screen = "build";
    s.camera = startCamera();
    applyCameraKeys(
      s,
      reader({ values: { right: 1, up: 1, "zoom-in": 1 } }),
      0.5,
    );
    expect(s.camera.yaw).toBeCloseTo(
      startCamera().yaw + ORBIT_KEY_RATE * 0.5,
      9,
    );
    expect(s.camera.pitch).toBeCloseTo(
      Math.min(80, startCamera().pitch + ORBIT_KEY_RATE * 0.5),
      9,
    );
    expect(s.camera.dist).toBeCloseTo(startCamera().dist - ZOOM_RATE * 0.5, 9);
  });

  it("does nothing off the yard screens", () => {
    const s = new GantryState();
    const before = { ...s.camera };
    applyCameraKeys(s, reader({ values: { right: 1 } }), 1);
    expect(s.camera).toEqual(before);
  });
});

describe("readInput", () => {
  it("reads the pointer's current position every frame", () => {
    const s = new GantryState();
    s.screen = "build";
    readInput(
      s,
      reader({ samples: [sample("move", 5, 6)], at: { x: 7, y: 8 } }),
      TICK_DT,
      silentIo(),
      noCapture(),
    );
    expect(s.pointer.x).toBe(7);
    expect(s.pointer.y).toBe(8);
  });
});

describe("the frame", () => {
  it("accumulates simTime whatever the screen and mirrors the mute bit", () => {
    const s = new GantryState();
    const io = recordingIo();
    io.toggleMute();
    updateFrame(s, 0.25, io);
    expect(s.simTime).toBeCloseTo(0.25, 12);
    expect(s.muted).toBe(true);
    expect(io.motor).toBe(false);
  });

  it("ticks nothing outside a run", () => {
    const s = new GantryState();
    advanceTicks(s, 1, silentIo());
    expect(s.run.tick).toBe(0);
  });

  it("refuses a run the structure is not ready for, silently", () => {
    const s = new GantryState();
    s.screen = "build";
    const io = recordingIo();
    expect(requestRun(s, io)).toBe(false);
    expect(s.screen).toBe("build");
    expect(s.run.phase).toBe("idle");
    expect(io.cues).toEqual([]);
  });
});

describe("the diagnostic sources", () => {
  it("names the values the overlay shows and reads them purely", () => {
    const s = new GantryState();
    const sources = diagnosticSources(() => s);
    const names = sources.map(([name]) => name);
    expect(names).toContain("screen");
    expect(names).toContain("site");
    expect(names).toContain("members");
    expect(names).toContain("cost");
    expect(names).toContain("issues");
    expect(names).toContain("run");
    expect(names).toContain("step");
    expect(names).toContain("clock");
    expect(names).toContain("cause");
    expect(names).toContain("slew");
    expect(names).toContain("bob");
    expect(names).toContain("util");
    expect(names).toContain("broken");
    expect(names).toContain("camera");

    const before = JSON.stringify(s);
    const read = sources.map(([, source]) => source());
    expect(JSON.stringify(s)).toBe(before);
    for (const value of read) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });
});
