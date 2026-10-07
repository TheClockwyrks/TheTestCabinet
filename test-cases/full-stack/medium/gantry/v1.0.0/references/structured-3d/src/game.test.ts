// The shell, end to end, over the six reference designs.
//
// `src/sim/designs.json` carries one worked crane and tape per site. Posing
// each through the debug surface and running it with the frame the game mode
// runs exercises the whole of what this stage owns at once: the state's shape,
// every pose the surface carries, the conversions between the state and the
// simulation, the tick pipeline the frame consumes, and the cues and the score a
// run leaves behind.

import { beforeEach, describe, expect, it } from "vitest";
import { TICK_HZ } from "./constants";
import { createDebugSurface } from "./debug";
import { TICK_DT, updateFrame } from "./app-tick";
import { BACKGROUND, game, GantryState, type GantryDebugApi } from "./game";
import { silentIo, type GameIo } from "./io";

interface Harness {
  state: GantryState;
  debug: GantryDebugApi;
  io: GameIo;
  cues: string[];
}

function harness(): Harness {
  const state = new GantryState();
  const cues: string[] = [];
  const io: GameIo = {
    ...silentIo(),
    playCue: (cue) => cues.push(cue),
  };
  return {
    state,
    debug: createDebugSurface({ state: () => state, io }),
    io,
    cues,
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
function pose(debug: GantryDebugApi, design: Design): void {
  debug.setScreen("build");
  debug.setRing(...design.ring);
  for (const [a, b, material] of design.members) {
    debug.addMember(...a, ...b, material);
  }
  for (const node of design.counterweights) debug.addCounterweight(...node);

  debug.setScreen("program");
  for (const step of design.tape) {
    if (step.kind === "action") {
      debug.addActionStep(step.action);
      continue;
    }
    const index = debug.snapshot().program.length;
    const [first, ...rest] = step.commands;
    debug.addMoveStep(first.axis, first.target, first.rate);
    for (const c of rest) debug.addCommand(index, c.axis, c.target, c.rate);
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

// ---- The definition --------------------------------------------------------

describe("the game definition", () => {
  it("registers the single level the whole game runs in", () => {
    expect(Object.keys(game.levels)).toEqual(["yard"]);
    expect(game.startLevel).toBe("yard");
    expect(game.instance).toBeTypeOf("function");
    expect(game.levels.yard.mode).toBeTypeOf("function");
  });

  it("names the stage background as a CSS color", () => {
    expect(BACKGROUND).toMatch(/^#[0-9a-f]{3,8}$/i);
  });
});

// ---- The six sites ---------------------------------------------------------

describe("the six reference designs", () => {
  it.each(TABLE.map((want, i) => [i, want] as const))(
    "site %i clears at the cost and the clock the table gives",
    (i, want) => {
      const h = harness();
      h.debug.openSite(i);
      h.debug.setScreen("build");
      pose(h.debug, designs[i]);

      const check = h.debug.check();
      expect(`${want.name}: ${check.issues.join(",")}`).toBe(`${want.name}: `);
      expect(check.stable).toBe(true);
      expect(check.cost).toBeCloseTo(want.cost, 1);
      expect(check.cost).toBeLessThanOrEqual(check.budget);

      h.debug.startRun();
      expect(h.debug.snapshot().run.phase).toBe("running");
      // A start takes no tick of its own.
      expect(h.debug.snapshot().run.tick).toBe(0);

      // Long enough for the longest tape, and bounded so a regression that
      // never ends fails rather than hangs.
      for (let tick = 0; tick < 8000; tick++) {
        if (h.state.run.phase !== "running") break;
        updateFrame(h.state, TICK_DT, h.io);
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

// ---- What the frame does with a run ----------------------------------------

describe("the frame and the run", () => {
  /** Site 1, posed and started, ready to be ticked one at a time. */
  function firstLift(): Harness {
    const h = harness();
    h.debug.openSite(0);
    h.debug.setScreen("build");
    pose(h.debug, designs[0]);
    h.debug.startRun();
    h.cues.length = 0;
    return h;
  }

  it("consumes whole ticks and keeps the remainder for the next frame", () => {
    const h = firstLift();
    updateFrame(h.state, TICK_DT / 2, h.io);
    expect(h.state.run.tick).toBe(0);
    updateFrame(h.state, TICK_DT / 2, h.io);
    expect(h.state.run.tick).toBe(1);
  });

  it("covers as many ticks as the watch speed asks of one frame", () => {
    const h = firstLift();
    h.debug.setScreen("run");
    h.debug.setSpeedIndex(2);
    updateFrame(h.state, TICK_DT, h.io);
    expect(h.state.run.tick).toBe(4);
  });

  it("gathers simTime whatever the screen, and no tick outside a run", () => {
    const h = harness();
    updateFrame(h.state, 0.5, h.io);
    updateFrame(h.state, 0.25, h.io);
    expect(h.state.simTime).toBeCloseTo(0.75, 12);
    expect(h.state.run.tick).toBe(0);
  });

  it("plays attach and placed at most once on a tick", () => {
    const h = firstLift();
    while (h.state.run.phase === "running") {
      const before = h.cues.length;
      updateFrame(h.state, TICK_DT, h.io);
      const raised = h.cues.slice(before);
      expect(raised.filter((cue) => cue === "attach").length).toBeLessThan(2);
      expect(raised.filter((cue) => cue === "placed").length).toBeLessThan(2);
    }
  });

  it("leaves a finished run readable, and the structure untouched", () => {
    const h = firstLift();
    while (h.state.run.phase === "running") {
      updateFrame(h.state, TICK_DT, h.io);
    }
    const finished = h.debug.snapshot();
    expect(finished.run.phase).toBe("cleared");
    h.debug.setScreen("build");
    const still = h.debug.snapshot();
    expect(still.run.phase).toBe("cleared");
    expect(still.run.tick).toBe(finished.run.tick);
    expect(still.structure.members).toHaveLength(designs[0].members.length);
  });

  it("abandons a run's figures when the site is opened again", () => {
    const h = firstLift();
    updateFrame(h.state, TICK_DT * 20, h.io);
    expect(h.state.run.tick).toBe(20);
    h.debug.openSite(0);
    h.debug.setScreen("build");
    const s = h.debug.snapshot();
    expect(s.run.phase).toBe("idle");
    expect(s.run.tick).toBe(0);
    expect(s.structure.members).toHaveLength(designs[0].members.length);
  });
});
