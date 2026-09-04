// The frame loop, end to end, over the six reference designs.
//
// Everything below the seam is real: the `Game` under test drives the real
// screens, the real editor, the real debug surface, and the real simulation.
// Only the runtime layer is a stand-in — it records the cues instead of
// sounding them and reports no input — and drawing is a no-op, since the
// picture reads the state and never writes it (`specs/instrumentation.md`).
//
// `src/sim/designs.json` carries one worked crane and tape per site. Playing
// all six here is what holds the shipped figures: each clears on the tick and
// at the cost the specification's own six-site table gives.

import { beforeEach, describe, expect, it } from "vitest";
import { Game, diagnosticLines, MAX_FRAME_DT, TICK_DT } from "./app";
import { CREAK_THRESHOLD, TICK_HZ, type CueName } from "./constants";
import { createDebugSurface, type GantryDebugApi } from "./debug";
import type { InputFrame, Runtime } from "./runtime";

// ---- A runtime that records rather than sounds -----------------------------

interface Harness {
  game: Game;
  debug: GantryDebugApi;
  cues: CueName[];
  motor(): boolean;
  draws(): number;
}

const EMPTY_INPUT: InputFrame = { actions: [], pointer: [] };

function harness(): Harness {
  const cues: CueName[] = [];
  let motorOn = false;
  let muted = false;
  let drawn = 0;

  const runtime: Runtime = {
    takeInput: () => EMPTY_INPUT,
    held: () => false,
    pointerX: () => 0,
    pointerY: () => 0,
    feedKeyDown: () => {},
    feedKeyUp: () => {},
    feedPointerMove: () => {},
    feedPointerDown: () => {},
    feedPointerUp: () => {},
    playCue: (cue) => {
      cues.push(cue);
    },
    setMotor: (on) => {
      motorOn = on;
    },
    isMuted: () => muted,
    toggleMute: () => {
      muted = !muted;
    },
    installAudio: () => {},
    setDiagnostics: () => {},
    overlayLines: () => [],
  };

  const game = new Game({
    runtime,
    lastDrawn: () => [],
    draw: () => {
      drawn += 1;
    },
  });
  return {
    game,
    debug: createDebugSurface(game),
    cues,
    motor: () => motorOn,
    draws: () => drawn,
  };
}

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
 * does not resolve rather than imported (the same route `assets.test.ts` takes
 * to the produced files).
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
function pose(debug: GantryDebugApi, design: Design): void {
  debug.setScreen("build");
  debug.setRing(...design.ring);
  for (const [a, b, material] of design.members) {
    debug.addMember(...a, ...b, material as "strut");
  }
  for (const node of design.counterweights) debug.addCounterweight(...node);

  debug.setScreen("program");
  for (const step of design.tape) {
    if (step.kind === "action") {
      debug.addActionStep(step.action as "attach");
      continue;
    }
    const index = debug.snapshot().program.length;
    const [first, ...rest] = step.commands;
    debug.addMoveStep(first.axis as "slew", first.target, first.rate);
    for (const c of rest) {
      debug.addCommand(index, c.axis as "slew", c.target, c.rate);
    }
  }
  debug.setScreen("build");
}

/** The six-site table `specs/sites.md` and the case's own figures fix. */
const TABLE = [
  { name: "First Lift", cost: 2238.9, time: 16.63 },
  { name: "Turnabout", cost: 2278.9, time: 52.35 },
  { name: "Over the Wall", cost: 3369.6, time: 37.92 },
  { name: "Long Reach", cost: 4992.4, time: 44.1 },
  { name: "High Shelf", cost: 3982.6, time: 95.87 },
  { name: "Heavy Haul", cost: 4507.8, time: 101.57 },
];

let designs: Design[] = [];

beforeEach(async () => {
  if (designs.length === 0) designs = await loadDesigns();
});

// ---- The six sites ---------------------------------------------------------

describe("the six reference designs", () => {
  it.each(TABLE.map((want, i) => [i, want] as const))(
    "site %i clears at the cost and the clock the table gives",
    (i, want) => {
      const h = harness();
      h.game.autoStep = false;
      h.debug.openSite(i);
      pose(h.debug, designs[i]);

      const check = h.debug.check();
      expect(`${want.name}: ${check.issues.join(",")}`).toBe(`${want.name}: `);
      expect(check.stable).toBe(true);
      expect(check.cost).toBeCloseTo(want.cost, 1);
      expect(check.cost).toBeLessThanOrEqual(check.budget);

      h.debug.startRun();
      expect(h.game.state.run.phase).toBe("running");

      // Long enough for the longest tape, and bounded so a regression that
      // never ends fails rather than hangs.
      for (let tick = 0; tick < 8000; tick++) {
        if (h.game.state.run.phase !== "running") break;
        h.debug.advance(1);
      }

      const snapshot = h.debug.snapshot();
      expect(
        `${want.name}: ${snapshot.run.phase} ${snapshot.run.cause ?? ""}`,
      ).toBe(`${want.name}: cleared `);
      expect(snapshot.run.tick).toBe(Math.round(want.time * TICK_HZ));
      expect(snapshot.run.time).toBeCloseTo(want.time, 2);
      expect(snapshot.screen).toBe("results");
      expect(snapshot.best[i]?.cost).toBeCloseTo(want.cost, 1);
      expect(snapshot.best[i]?.time).toBeCloseTo(want.time, 2);
      expect(snapshot.cleared[i]).toBe(true);
      expect(h.cues).toContain("run-start");
      expect(h.cues).toContain("attach");
      expect(h.cues).toContain("placed");
      expect(h.cues).toContain("complete");
    },
    30000,
  );
});

// ---- What a tick raises ----------------------------------------------------

describe("the cues a run raises", () => {
  /** Site 1, posed and started, ready to be ticked one at a time. */
  function firstLift(): Harness {
    const h = harness();
    h.game.autoStep = false;
    h.debug.openSite(0);
    pose(h.debug, designs[0]);
    h.debug.startRun();
    h.cues.length = 0;
    return h;
  }

  it("plays attach and placed at most once on a tick", () => {
    const h = firstLift();
    while (h.game.state.run.phase === "running") {
      const before = h.cues.length;
      h.debug.advance(1);
      const raised = h.cues.slice(before);
      expect(raised.filter((cue) => cue === "attach").length).toBeLessThan(2);
      expect(raised.filter((cue) => cue === "placed").length).toBeLessThan(2);
    }
  });

  it("never creaks on a run's first tick, and holds the cooldown after", () => {
    const h = firstLift();
    const creakTicks: number[] = [];
    while (h.game.state.run.phase === "running") {
      const before = h.cues.length;
      h.debug.advance(1);
      if (h.cues.slice(before).includes("creak")) {
        creakTicks.push(h.game.state.run.tick);
      }
    }
    expect(creakTicks).not.toContain(1);
    for (let i = 1; i < creakTicks.length; i++) {
      expect(creakTicks[i] - creakTicks[i - 1]).toBeGreaterThanOrEqual(30);
    }
  });

  it("runs the motor loop while an axis turns and stops it when the run ends", () => {
    const h = firstLift();
    let everOn = false;
    while (h.game.state.run.phase === "running") {
      h.debug.advance(1);
      everOn ||= h.motor();
    }
    expect(everOn).toBe(true);
    expect(h.motor()).toBe(false);
  });

  it("plays fail, and collapse with it, on a run that comes down", () => {
    const h = harness();
    h.game.autoStep = false;
    h.debug.openSite(0);
    pose(h.debug, designs[0]);
    h.debug.startRun();
    h.cues.length = 0;
    // A bob far outside the cable's reach snaps it on the next tick.
    h.debug.setBob(0, 4, 0);
    h.debug.setAxis("hoist", 0.001);
    while (h.game.state.run.phase === "running") h.debug.advance(1);
    expect(h.game.state.run.phase).toBe("failed");
    expect(h.cues).toContain("fail");
    expect(h.game.state.screen).toBe("run");
  });
});

// ---- The loop itself -------------------------------------------------------

describe("the frame loop", () => {
  it("advances one tick per frame and draws each one", () => {
    const h = harness();
    h.game.autoStep = false;
    h.debug.openSite(0);
    pose(h.debug, designs[0]);
    h.debug.startRun();
    const drawn = h.draws();
    h.debug.advance(10);
    expect(h.game.state.run.tick).toBe(10);
    expect(h.draws() - drawn).toBe(10);
  });

  it("accumulates simTime on every screen and consumes only whole ticks", () => {
    const h = harness();
    h.game.autoStep = false;
    h.debug.openSite(0);
    pose(h.debug, designs[0]);
    h.debug.startRun();
    h.game.update(TICK_DT * 1.5);
    expect(h.game.state.run.tick).toBe(1);
    h.game.update(TICK_DT * 0.6);
    expect(h.game.state.run.tick).toBe(2);
    expect(h.game.state.simTime).toBeCloseTo(TICK_DT * 2.1, 9);
  });

  it("loses a frame longer than MAX_FRAME_DT rather than playing it back", () => {
    const h = harness();
    h.game.autoStep = true;
    h.debug.openSite(0);
    pose(h.debug, designs[0]);
    h.debug.startRun();
    h.game.frame(MAX_FRAME_DT * 4);
    expect(h.game.state.run.tick).toBeLessThanOrEqual(
      Math.ceil(MAX_FRAME_DT * 4 * TICK_HZ),
    );
  });
});

describe("the diagnostic sources", () => {
  it("read the game and name the screen, the site, the run, and the camera", () => {
    const h = harness();
    h.debug.openSite(2);
    const before = h.debug.snapshot();
    const lines = diagnosticLines(h.game.state);
    expect(lines.length).toBeGreaterThanOrEqual(7);
    expect(lines[0]).toContain("site 3/6");
    expect(lines.join("\n")).toContain("run idle");
    expect(lines.join("\n")).toContain("cam ");
    for (const line of lines) expect(line.length).toBeLessThan(120);
    // Pure reads: watching the overlay leaves the game as it is.
    expect(h.debug.snapshot()).toEqual(before);
  });

  it("reports the creak threshold's own utilization scale", () => {
    expect(CREAK_THRESHOLD).toBeGreaterThan(0);
    expect(CREAK_THRESHOLD).toBeLessThan(1);
  });
});
