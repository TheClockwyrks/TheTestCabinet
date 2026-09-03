// The frame's update, end to end, over the six reference designs.
//
// The engine cannot stand up in Node — it takes a `webgl2` context the moment
// it is created — so these drive `updateGame` directly over a stub `UpdateApi`,
// which is exactly what the engine hands it. `src/sim/designs.json` carries one
// worked crane and tape per site; posing each through the debug surface and
// then ticking the frame is the whole of the shell exercised at once: the
// transitions, the conversions both ways, the tick accumulation, the cues, and
// the verdict a clear records.

import { beforeAll, describe, expect, it } from "vitest";
import type { PointerSample, UpdateApi } from "@test-cabinet/simple-3d";
import { ORBIT_PER_PX, RUN_SPEEDS, TICK_HZ } from "./constants";
import { createDebugSurface } from "./debug";
import type { GantryDebugApi, GantryState } from "./game";
import { titleState } from "./state";
import { advanceTicks, TICK_DT, updateGame } from "./app-tick";

// ---- A stub of what the engine hands `update` ------------------------------

interface Stub {
  api: UpdateApi;
  cues: string[];
  loops: Set<string>;
  press: Set<string>;
  held: Set<string>;
  samples: PointerSample[];
  pointer: { x: number; y: number };
  muted: boolean;
}

function stub(): Stub {
  const s: Stub = {
    api: undefined as unknown as UpdateApi,
    cues: [],
    loops: new Set<string>(),
    press: new Set<string>(),
    held: new Set<string>(),
    samples: [],
    pointer: { x: 0, y: 0 },
    muted: false,
  };
  s.api = {
    input: {
      value: (name) => (s.held.has(name) ? 1 : 0),
      pressed: (name) => {
        if (!s.press.has(name)) return false;
        s.press.delete(name);
        return true;
      },
      pointer: () => ({
        x: s.pointer.x,
        y: s.pointer.y,
        down: false,
        device: "mouse",
        buttons: [],
      }),
      pointerPressed: () => false,
      pointerReleased: () => false,
      pointerSamples: () => s.samples.slice(),
      pointerContacts: () => [],
      wheel: () => ({ x: 0, y: 0 }),
    },
    audio: {
      play: (cue) => s.cues.push(cue),
      loop: (cue) => s.loops.add(cue),
      stop: (cue) => s.loops.delete(cue),
      place: () => undefined,
      looping: (cue) => s.loops.has(cue),
      setMuted: (muted) => {
        s.muted = muted;
      },
      muted: () => s.muted,
    },
    frame: () => ({ count: 0, timeMs: 0, lastDeltaMs: 0 }),
    viewport: () => ({
      width: 1280,
      height: 720,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }),
    view: () => {
      throw new Error("the stub has no view");
    },
  };
  return s;
}

/** One primary pointer sample, as the engine delivers it. */
const sample = (
  kind: "down" | "move" | "up",
  x: number,
  y: number,
): PointerSample => ({
  type: kind,
  x,
  y,
  id: 1,
  primary: true,
  device: "mouse",
  button: kind === "move" ? null : "primary",
  buttons: kind === "up" ? [] : ["primary"],
});

// ---- The reference designs -------------------------------------------------

type Node3 = [number, number, number];

interface Design {
  site: number;
  name: string;
  ring: Node3;
  counterweights: Node3[];
  members: [Node3, Node3, string][];
  tape: (
    | {
        kind: "move";
        commands: { axis: string; target: number; rate: number }[];
      }
    | { kind: "action"; action: string }
  )[];
}

/**
 * The committed designs. `tsconfig.json` is supplied and does not set
 * `resolveJsonModule`, so the file is read through a specifier the compiler
 * does not resolve rather than imported.
 */
async function loadDesigns(): Promise<Design[]> {
  const specifier = "node:fs/promises";
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    readFile(path: URL, encoding: string): Promise<string>;
  };
  const text = await fs.readFile(
    new URL("./sim/designs.json", import.meta.url),
    "utf8",
  );
  return (JSON.parse(text) as { sites: Design[] }).sites;
}

/** Pose one design onto the open site through the surface's own edits. */
function pose(
  debug: GantryDebugApi,
  state: GantryState,
  design: Design,
): GantryState {
  let s = debug.setScreen(state, "build");
  s = debug.setRing(s, ...design.ring);
  for (const [a, b, material] of design.members) {
    s = debug.addMember(s, ...a, ...b, material);
  }
  for (const node of design.counterweights) {
    s = debug.addCounterweight(s, ...node);
  }

  s = debug.setScreen(s, "program");
  for (const step of design.tape) {
    if (step.kind === "action") {
      s = debug.addActionStep(s, step.action);
      continue;
    }
    const index = debug.snapshot(s).program.length;
    const [first, ...rest] = step.commands;
    s = debug.addMoveStep(s, first.axis, first.target, first.rate);
    for (const c of rest)
      s = debug.addCommand(s, index, c.axis, c.target, c.rate);
  }
  return debug.setScreen(s, "build");
}

/** The six-site table the reference designs clear at. */
const TABLE = [
  { name: "First Lift", cost: 2238.9, time: 16.63 },
  { name: "Turnabout", cost: 2278.9, time: 52.35 },
  { name: "Over the Wall", cost: 3369.6, time: 37.92 },
  { name: "Long Reach", cost: 4992.4, time: 44.1 },
  { name: "High Shelf", cost: 3982.6, time: 95.87 },
  { name: "Heavy Haul", cost: 4507.8, time: 101.57 },
];

let designs: Design[] = [];

beforeAll(async () => {
  designs = await loadDesigns();
});

const debug = createDebugSurface();

/** A site posed and ready to run, with the stub the frame is driven through. */
function readied(index: number): { s: GantryState; io: Stub } {
  const io = stub();
  let s = debug.openSite(titleState(), index);
  s = pose(debug, s, designs[index]);
  return { s, io };
}

describe("the six reference designs", () => {
  it.each(TABLE.map((want, i) => [i, want] as const))(
    "site %i clears at the cost and the clock the table gives",
    (i, want) => {
      const { s: readiedState, io } = readied(i);
      let s = readiedState;

      const check = debug.check(s);
      expect(`${want.name}: ${check.issues.join(",")}`).toBe(`${want.name}: `);
      expect(check.stable).toBe(true);
      expect(check.cost).toBeCloseTo(want.cost, 1);
      expect(check.cost).toBeLessThanOrEqual(check.budget);

      s = debug.startRun(s);
      expect(s.run.phase).toBe("running");
      expect(s.run.tick).toBe(0);

      // Long enough for the longest tape, and bounded so a regression that
      // never ends fails rather than hangs.
      for (let tick = 0; tick < 8000; tick++) {
        if (s.run.phase !== "running") break;
        s = updateGame(s, io.api, TICK_DT);
      }

      const snapshot = debug.snapshot(s);
      expect(
        `${want.name}: ${snapshot.run.phase} ${snapshot.run.cause ?? ""}`,
      ).toBe(`${want.name}: cleared `);
      expect(snapshot.run.tick).toBe(Math.round(want.time * TICK_HZ));
      expect(snapshot.run.time).toBeCloseTo(want.time, 2);
      expect(snapshot.screen).toBe("results");
      expect(snapshot.best[i]?.cost).toBeCloseTo(want.cost, 1);
      expect(snapshot.best[i]?.time).toBeCloseTo(want.time, 2);
      expect(snapshot.cleared[i]).toBe(true);
      for (const cue of ["run-start", "attach", "placed", "complete"]) {
        expect(io.cues).toContain(cue);
      }
      expect(io.loops.has("motor")).toBe(false);
    },
    30000,
  );
});

describe("the cues a run raises", () => {
  it("plays attach and placed at most once on a tick", () => {
    const { s: readiedState, io } = readied(0);
    let s = debug.startRun(readiedState);
    io.cues.length = 0;
    while (s.run.phase === "running") {
      const before = io.cues.length;
      s = updateGame(s, io.api, TICK_DT);
      const raised = io.cues.slice(before);
      expect(raised.filter((c) => c === "attach").length).toBeLessThan(2);
      expect(raised.filter((c) => c === "placed").length).toBeLessThan(2);
    }
  });

  it("loops the motor while an axis turns and stops it when the run ends", () => {
    const { s: readiedState, io } = readied(0);
    let s = debug.startRun(readiedState);
    let looped = false;
    while (s.run.phase === "running") {
      s = updateGame(s, io.api, TICK_DT);
      if (io.loops.has("motor")) looped = true;
    }
    expect(looped).toBe(true);
    expect(io.loops.has("motor")).toBe(false);
  });

  it("plays fail once, and stays on the run screen, on a failure", () => {
    const { s: readiedState, io } = readied(0);
    // The reference crane, driven by a tape whose hoist target is past
    // `HOIST_MAX`: the first tick ends the run as `command-out-of-range`.
    let s = debug.setScreen(readiedState, "program");
    s = debug.clearProgram(s);
    s = debug.addMoveStep(s, "hoist", 999, 1);
    s = debug.setScreen(s, "build");
    s = debug.startRun(s);
    expect(s.run.phase).toBe("running");
    io.cues.length = 0;
    while (s.run.phase === "running") s = updateGame(s, io.api, TICK_DT);
    expect(s.run.cause).toBe("command-out-of-range");
    expect(io.cues.filter((c) => c === "fail")).toHaveLength(1);
    expect(io.cues).not.toContain("collapse");
    expect(s.screen).toBe("run");
    expect(s.run.tick).toBe(1);
  });
});

describe("the tick accumulation", () => {
  it("takes whole ticks and carries the remainder", () => {
    const { s: readiedState, io } = readied(0);
    let s = debug.startRun(readiedState);
    s = updateGame(s, io.api, TICK_DT / 2);
    expect(s.run.tick).toBe(0);
    s = updateGame(s, io.api, TICK_DT / 2);
    expect(s.run.tick).toBe(1);
  });

  it("is empty when a run starts, whatever waited before it", () => {
    const { s: readiedState, io } = readied(0);
    let s = updateGame(readiedState, io.api, 0.9);
    s = debug.startRun(s);
    expect(s.run.internals.accumulator).toBe(0);
    s = updateGame(s, io.api, TICK_DT / 2);
    expect(s.run.tick).toBe(0);
  });

  it("covers more ticks per second at a higher watch speed", () => {
    const { s: readiedState } = readied(0);
    const started = debug.startRun(readiedState);
    const slow = advanceTicks(structuredClone(started), 1);
    const fast = advanceTicks(
      debug.setSpeedIndex(structuredClone(started), 2),
      1,
    );
    expect(fast.run.tick).toBeGreaterThan(slow.run.tick);
    expect(fast.run.tick / slow.run.tick).toBeCloseTo(RUN_SPEEDS[2], 0);
  });

  it("ticks nothing off a run", () => {
    const io = stub();
    const s = updateGame(titleState(), io.api, 1);
    expect(s.run.tick).toBe(0);
    expect(s.run.phase).toBe("idle");
  });
});

describe("what every update does", () => {
  it("accumulates simTime whatever the screen", () => {
    const io = stub();
    let s = updateGame(titleState(), io.api, 0.25);
    expect(s.simTime).toBeCloseTo(0.25, 12);
    s = updateGame(s, io.api, 0.5);
    expect(s.simTime).toBeCloseTo(0.75, 12);
  });

  it("reads the pointer's position into the state", () => {
    const io = stub();
    io.pointer = { x: 321, y: 123 };
    const s = updateGame(titleState(), io.api, TICK_DT);
    expect(s.pointer.x).toBe(321);
    expect(s.pointer.y).toBe(123);
  });

  it("mirrors the engine's mute bit", () => {
    const io = stub();
    io.muted = true;
    expect(updateGame(titleState(), io.api, TICK_DT).muted).toBe(true);
    io.muted = false;
    expect(updateGame(titleState(), io.api, TICK_DT).muted).toBe(false);
  });

  it("loops the music bed under the title and select screens alone", () => {
    const io = stub();
    const title = updateGame(titleState(), io.api, TICK_DT);
    expect(io.loops.has("music")).toBe(true);
    updateGame(debug.setScreen(title, "build"), io.api, TICK_DT);
    expect(io.loops.has("music")).toBe(false);
  });

  it("orbits the camera against the frame's delta while a key is held", () => {
    const io = stub();
    io.held.add("right");
    const start = debug.openSite(titleState(), 0);
    const s = updateGame(start, io.api, 1);
    expect(s.camera.yaw).toBeCloseTo((start.camera.yaw + 90) % 360, 9);
  });

  it("leaves the camera alone off the yard screens", () => {
    const io = stub();
    io.held.add("right");
    const s = updateGame(titleState(), io.api, 1);
    expect(s.camera.yaw).toBe(titleState().camera.yaw);
  });

  it("follows a press into an orbit drag once it passes CLICK_SLOP", () => {
    const io = stub();
    const start = debug.openSite(titleState(), 0);
    io.samples = [
      sample("down", 600, 300),
      sample("move", 602, 300),
      sample("move", 660, 300),
      sample("move", 700, 300),
    ];
    const s = updateGame(start, io.api, TICK_DT);
    expect(s.pointer.down).toBe(true);
    expect(s.pointer.pressX).toBe(600);
    expect(s.pointer.dragging).toBe(true);
    // The move that carried the press across the boundary turns nothing; the
    // one after it turns the camera by its own travel alone.
    expect(s.camera.yaw).toBeCloseTo(
      start.camera.yaw + (700 - 660) * ORBIT_PER_PX,
      9,
    );
  });

  it("ends a drag on release without taking it for a click", () => {
    const io = stub();
    io.samples = [
      sample("down", 600, 300),
      sample("move", 700, 300),
      sample("up", 700, 300),
    ];
    const s = updateGame(debug.openSite(titleState(), 0), io.api, TICK_DT);
    expect(s.pointer.down).toBe(false);
    expect(s.pointer.dragging).toBe(false);
  });

  it("leaves the state it was handed exactly as it was", () => {
    const io = stub();
    const before = titleState();
    const copy = structuredClone(before);
    updateGame(before, io.api, 0.5);
    expect(before).toEqual(copy);
  });
});
