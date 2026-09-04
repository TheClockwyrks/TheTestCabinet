// Volute — the harness the rest of the tests drive the game through, and its own
// checks.
//
// The simulation is render-free and clock-free (specs/instrumentation.md), so a
// test needs no browser and no canvas: it builds a state, hands the tick a set of
// held actions, and runs a counted number of whole ticks. That is exactly what a
// validator does through `window.__volute`, one layer down.

import { describe, expect, it } from "vitest";
import { CELLS, CHARGE_IDS, TICK_DT } from "./constants";
import type { ChargeId, CueName, MachineryKind } from "./constants";
import { newReport, type FxEvent } from "./events";
import { createDebugApi, type DebugHost, type VoluteDebugApi } from "./debug";
import { createState } from "./state";
import { tick } from "./sim";
import { resegment } from "./train";
import type { VoluteState } from "./types";

/** A hall under test: the live state, the surface over it, and what it raised. */
export interface Harness {
  readonly state: VoluteState;
  readonly api: VoluteDebugApi;
  /** The cues every tick so far has raised, newest last. */
  readonly cues: CueName[];
  /** The effects every tick so far has raised. */
  readonly fx: FxEvent[];
  /** Hold an action down, or let it up. */
  hold(action: string, held?: boolean): void;
  /** Arm an action's press edge, for the next tick to consume. */
  press(action: string): void;
  /** Deliver a pointer position, in logical units. */
  point(x: number, y: number): void;
  /** Run whole ticks, exactly as the runtime's loop runs them. */
  step(ticks?: number): void;
  /** Whether the runtime's mute bit is set. */
  muted(): boolean;
  /** The cues raised since the marker, so one tick can be probed on its own. */
  since(marker: number): CueName[];
}

/** Build a hall under test, seeded. */
export function harness(seed = 1): Harness {
  const state = createState(seed);
  const held = new Set<string>();
  const edges = new Set<string>();
  let pointer: { x: number; y: number } | null = null;
  let muted = false;
  const cues: CueName[] = [];
  const fx: FxEvent[] = [];
  const pending = new Set<CueName>();

  const ports = {
    input: {
      value: (action: string) => (held.has(action) ? 1 : 0),
      pressed: (action: string) => edges.delete(action),
      pointer: () => {
        const at = pointer;
        pointer = null;
        return at;
      },
    },
    audio: {
      muted: () => muted,
      setMuted: (value: boolean) => {
        muted = value;
      },
    },
  };

  const host: DebugHost = {
    state,
    setAutoStep: () => undefined,
    step: (ticks: number) => run(ticks),
    queueCue: (cue: CueName) => {
      pending.add(cue);
    },
    spawnFx: (event: FxEvent) => {
      fx.push(event);
    },
    clearEffects: () => {
      fx.length = 0;
    },
  };

  function run(ticks = 1): void {
    for (let i = 0; i < ticks; i += 1) {
      const report = newReport();
      for (const cue of pending) report.cues.add(cue);
      pending.clear();
      state.simTime += TICK_DT;
      tick(state, ports, TICK_DT, report);
      for (const cue of report.cues) cues.push(cue);
      for (const event of report.fx) fx.push(event);
    }
  }

  return {
    state,
    api: createDebugApi(host),
    cues,
    fx,
    hold: (action, value = true) => {
      if (value) held.add(action);
      else held.delete(action);
    },
    press: (action) => {
      edges.add(action);
    },
    point: (x, y) => {
      pointer = { x, y };
    },
    step: run,
    muted: () => muted,
    since: (marker) => cues.slice(marker),
  };
}

/** Pose a train of evenly spaced cores, head first, and settle its segments. */
export function poseRun(
  state: VoluteState,
  headS: number,
  charges: readonly ChargeId[],
  marks: readonly (MachineryKind | null)[] = [],
): void {
  state.cores = charges.map((charge, index) => ({
    charge,
    s: headS - index * 28,
    mark: marks[index] ?? null,
    hold: 0,
  }));
  resegment(state);
}

/** The last entry of a list, which the ES2020 target has no `Array#at` for. */
export function last<T>(items: readonly T[]): T {
  return items[items.length - 1];
}

/**
 * The arc position of the point `(x, 220)` on the straight leg the intake side of
 * the hall runs along, where the channel's forward is `+x`.
 *
 * The injector stands at `(420, 330)`, 110 units below this leg, so a shot fired
 * straight up crosses it after ten ticks — short enough that a posed train has
 * barely ridden when the strike resolves.
 */
export function topLegS(x: number): number {
  return 4360 + (x - 220);
}

/**
 * Fire straight up, carry the shot to one tick short of the `y = 220` leg, pose a
 * train across its path, and let the strike resolve.
 *
 * This is how a scenario aims a shot at an exact core: the train is put in place
 * at the last moment, so the feed has not carried it anywhere between the pose and
 * the strike.
 */
export function seatShot(
  hall: Harness,
  cores: readonly [number, ChargeId, MachineryKind | null][],
  charge: ChargeId = "cobalt",
): void {
  const step = 620 / 60;
  hall.api.setLoaded(charge);
  hall.api.setAim(270);
  hall.api.fire();
  for (let i = 0; i < 60; i += 1) {
    const shot = hall.api.snapshot().projectiles[0];
    if (shot === undefined || shot.y - step <= 220) break;
    hall.step();
  }
  hall.api.poseTrain(cores as never);
  hall.step();
}

describe("the harness", () => {
  it("opens on the title with a complete state", () => {
    const hall = harness();
    expect(hall.state.screen).toBe("title");
    expect(hall.state.cores).toHaveLength(0);
    expect(hall.state.aim).toBe(270);
  });

  it("consumes a press edge on the tick that reads it", () => {
    const hall = harness();
    hall.press("confirm");
    hall.step();
    expect(hall.state.screen).toBe("playing");

    hall.api.reset();
    hall.step();
    expect(hall.state.screen).toBe("title");
  });

  it("poses a run of cores in one segment", () => {
    const hall = harness();
    poseRun(hall.state, 500, [CHARGE_IDS[0], CHARGE_IDS[0], CHARGE_IDS[1]]);
    expect(hall.state.segments).toEqual([{ count: 3, hold: 0 }]);
  });
});

/**
 * What the start control on the title poses, assembled from single-field poses.
 *
 * The surface carries no compound `start`: a run opened from code is the score,
 * the cells, and level 1 opened as an interlude opens it.
 */
export function startRun(hall: Harness): void {
  hall.api.setScore(0);
  hall.api.setCells(CELLS);
  hall.api.startLevel(1);
}
