import type { DiagnosticValue } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { describe, expect, it } from "vitest";
import { formatClock, registerDiagnostics } from "./diagnostics";
import { startRun } from "./flow";
import type { WickState } from "./game";
import { initialState, SWITCH_NAMES } from "./state";

type Source = (state: DeepReadonly<WickState>) => DiagnosticValue;

/** The registry the engine would hold, as a map of name to source. */
function registry(): Map<string, Source> {
  const sources = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register: (name, source) => sources.set(name, source),
    },
  });
  return sources;
}

/** Every source read against `state`, as a label-to-value map. */
function lines(
  sources: Map<string, Source>,
  state: DeepReadonly<WickState>,
): Map<string, DiagnosticValue> {
  return new Map(
    [...sources].map(([name, source]) => [name, source(state)] as const),
  );
}

describe("the run clock", () => {
  it("formats whole seconds as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9.99)).toBe("0:09");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(600)).toBe("10:00");
  });
});

describe("the game's sources", () => {
  it("report the facts the snapshot reports, read off the state handed in", () => {
    const sources = registry();
    const state = initialState();
    const idle = lines(sources, state);
    expect(idle.get("screen")).toBe("title");
    expect(idle.get("clock")).toBe("0:00 (tick 0)");
    expect(idle.get("weapons")).toBe("none");
    expect(idle.get("passives")).toBe("none");
    for (const name of SWITCH_NAMES) expect(idle.get(name)).toBe(true);
    expect(idle.get("muted")).toBe(false);

    startRun(state);
    state.run.tick = 90;
    state.run.kills = 7;
    state.run.pendingLevelUps = 2;
    state.run.passives.push({ id: "lure", level: 2 });
    state.spawning = false;
    state.muted = true;
    const live = lines(sources, state);
    expect(live.get("screen")).toBe("playing");
    expect(live.get("clock")).toBe("0:01 (tick 90)");
    expect(live.get("level")).toBe("1  xp 0.0 / 5");
    expect(live.get("hp")).toBe("100.0 / 100");
    expect(live.get("kills")).toBe(7);
    expect(live.get("lamplighter")).toBe("0.0, 0.0 right");
    expect(live.get("enemies")).toBe("0  window 0");
    expect(live.get("effects")).toBe("0 projectiles, 0 zones");
    expect(live.get("gems")).toBe(0);
    expect(live.get("weapons")).toBe("taper L1 0.00s");
    expect(live.get("passives")).toBe("lure L2");
    expect(live.get("pending")).toBe(2);
    expect(live.get("spawning")).toBe(false);
    expect(live.get("muted")).toBe(true);
  });

  it("leave the state as it is when read", () => {
    const sources = registry();
    const state = initialState();
    startRun(state);
    const before = JSON.stringify(state);
    lines(sources, state);
    lines(sources, state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
