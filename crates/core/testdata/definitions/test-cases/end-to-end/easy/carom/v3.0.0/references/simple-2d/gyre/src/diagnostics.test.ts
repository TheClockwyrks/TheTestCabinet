// specs/instrumentation.md names the values the engine's overlay must show. What
// is checked here is that every one is registered and that each is a pure read
// of whatever state it is handed, rather than a value sampled once at
// registration or read off the state that existed then.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { parkedBall } from "./entities";
import { createInitialState, type CaromState } from "./game";
import type { DeepReadonly } from "ts-essentials";
import type { InitApi } from "@clockwyrks/simple-2d";

type Source = (state: DeepReadonly<CaromState>) => unknown;

/** Just enough of an `InitApi` to collect the sources a game registers. */
function collector(): {
  api: InitApi<CaromState>;
  read: (state: DeepReadonly<CaromState>) => Record<string, unknown>;
} {
  const sources = new Map<string, Source>();
  const api = {
    diagnostics: {
      register: (name: string, source: Source) => {
        sources.set(name, source);
      },
    },
  } as unknown as InitApi<CaromState>;
  return {
    api,
    read: (state) =>
      Object.fromEntries(
        [...sources].map(([name, source]) => [name, source(state)]),
      ),
  };
}

describe("registerDiagnostics", () => {
  it("registers the screen, mode, scores, ball, and both paddles", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    expect(Object.keys(read(createInitialState()))).toEqual([
      "screen",
      "mode",
      "score",
      "ball pos",
      "ball vel",
      "ball spin",
      "paddle L",
      "paddle R",
    ]);
  });

  it("reads the state it is handed on every read", () => {
    const opening = createInitialState();
    const { api, read } = collector();
    registerDiagnostics(api);

    expect(read(opening)["screen"]).toBe("title");
    expect(read(opening)["score"]).toBe("0 - 0");

    const later: CaromState = {
      ...opening,
      screen: "playing",
      mode: "versus",
      score: { p1: 4, p2: 7 },
      ball: { ...parkedBall(), x: 123.456, spin: -250 },
    };

    const values = read(later);
    expect(values["screen"]).toBe("playing");
    expect(values["mode"]).toBe("versus");
    expect(values["score"]).toBe("4 - 7");
    expect(values["ball pos"]).toBe("123.5, 360.0");
    expect(values["ball spin"]).toBe("-250.0");
    // The opening state reads as it did: no source remembers anything.
    expect(read(opening)["screen"]).toBe("title");
  });

  it("reports a dash for every ball figure while the field carries none", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    const empty: CaromState = { ...createInitialState(), ball: null };
    const values = read(empty);
    expect(values["ball pos"]).toBe("\u2014");
    expect(values["ball vel"]).toBe("\u2014");
    expect(values["ball spin"]).toBe("\u2014");
    // The paddles are field furniture the game always has.
    expect(values["paddle L"]).toBe("cy 360.0 vy 0.0");
  });

  it("changes nothing it reads", () => {
    const state = createInitialState();
    const { api, read } = collector();
    registerDiagnostics(api);
    const before = JSON.stringify(state);
    read(state);
    read(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
