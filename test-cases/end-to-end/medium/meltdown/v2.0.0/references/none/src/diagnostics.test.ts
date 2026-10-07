// specs/instrumentation.md names the values the overlay must show. What is
// measured here is that every one of them is registered, that each is a LIVE
// read of the state it is handed rather than a value sampled at registration,
// and that reading them all leaves the game byte-for-byte as it was.
//
// The panel that draws them is `src/overlay.test.ts`.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { addTower } from "./build";
import { addUnit } from "./sim";
import { createState, startRun, type MeltdownState } from "./state";
import type { InitApi } from "./runtime";

/** Just enough of an `InitApi` to collect the sources the game registers. */
function collector(): {
  api: InitApi<MeltdownState>;
  read: (state: MeltdownState) => Record<string, unknown>;
} {
  const sources = new Map<string, (state: MeltdownState) => unknown>();
  const api = {
    diagnostics: {
      register: (name: string, source: (state: MeltdownState) => unknown) => {
        sources.set(name, source);
      },
    },
  } as unknown as InitApi<MeltdownState>;
  return {
    api,
    read: (state) =>
      Object.fromEntries(
        [...sources].map(([name, source]) => [name, source(state)]),
      ),
  };
}

/** A run in its wave phase, one tower down and one unit on the floor. */
function scene(): MeltdownState {
  const state = createState();
  startRun(state);
  state.screen = "playing";
  state.phase = "wave";
  addTower(state, "arc", 24, 17, 0);
  addUnit(state, "mote", "left");
  return state;
}

describe("registerDiagnostics", () => {
  it("names every value the specification asks for, in reading order", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    expect(Object.keys(read(createState()))).toEqual([
      "screen",
      "mode",
      "money",
      "lives",
      "wave",
      "score",
      "routes",
      "towers",
      "surge",
    ]);
  });

  it("reports the screen with its phase, and the mode with its difficulty", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    const state = createState();
    expect(read(state)["screen"]).toBe("title/opening");
    expect(read(state)["mode"]).toBe("containment/medium");

    state.screen = "playing";
    state.phase = "wave";
    state.mode = "bottleneck";
    state.difficulty = "hard";
    expect(read(state)["screen"]).toBe("playing/wave");
    expect(read(state)["mode"]).toBe("bottleneck/hard");
  });

  it("reads the live state at the call, not what stood at registration", () => {
    const state = createState();
    const { api, read } = collector();
    registerDiagnostics(api);
    expect(read(state)["money"]).toBe(250);

    state.money = 1234;
    state.lives = 3;
    state.score = 9876;
    state.wave = 7;
    expect(read(state)["money"]).toBe(1234);
    expect(read(state)["lives"]).toBe(3);
    expect(read(state)["score"]).toBe(9876);
    expect(read(state)["wave"]).toBe("7/20");
  });

  it("reports the wave against the count the mode fixes", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    const state = createState();
    state.difficulty = "hard";
    expect(read(state)["wave"]).toBe("1/26");
    state.mode = "hundred";
    expect(read(state)["wave"]).toBe("1/1");
  });

  it("reports both route lengths on one line", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    expect(read(createState())["routes"]).toBe("left 49.0  top 35.0");
  });

  it("names a tower by its id, type, level, heat, redline, trip and kills", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    const state = scene();
    const tower = state.towers[0];
    tower.heat = 42.25;
    tower.kills = 6;
    expect(read(state)["towers"]).toEqual(["#1 arc L1 h42.3/80 k6"]);

    tower.tripped = true;
    expect(read(state)["towers"]).toEqual(["#1 arc L1 h42.3/80 TRIPPED k6"]);
  });

  it("names a unit by its id, type, tile, hp, slow and exhaust", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    const state = scene();
    const unit = state.surge[0];
    unit.hp = 7.4;
    const lines = read(state)["surge"] as string[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^#2 mote \(\d+,\d+\) hp7 -> right$/);

    unit.slowFactor = 0.4;
    expect((read(state)["surge"] as string[])[0]).toContain(" slowed ");
  });

  it("stops listing long before a busy floor fills the panel", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    const state = scene();
    for (let i = 0; i < 20; i += 1) addUnit(state, "mote", "top");
    expect((read(state)["surge"] as string[]).length).toBe(12);
  });

  it("changes nothing it reads, however many times it is read", () => {
    const state = scene();
    const { api, read } = collector();
    registerDiagnostics(api);
    const before = JSON.stringify(state);
    read(state);
    read(state);
    read(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
