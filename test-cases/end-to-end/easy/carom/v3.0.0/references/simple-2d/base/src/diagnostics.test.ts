// specs/instrumentation.md names the values the engine's overlay must show. What
// is checked here is that every one is registered and that each is a pure read
// of the state it is handed rather than a value sampled once at registration.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { homeBall } from "./entities";
import type { CaromState } from "./game";
import { createInitialState } from "./match";
import type { InitApi } from "@clockwyrks/simple-2d";

type Source = (state: CaromState) => unknown;

/** Just enough of an `InitApi` to collect the sources a game registers. */
function collector(): {
  api: InitApi<CaromState>;
  read: (state: CaromState) => Record<string, unknown>;
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

  it("reads whichever state it is handed", () => {
    const { api, read } = collector();
    registerDiagnostics(api);

    const title = createInitialState();
    expect(read(title)["screen"]).toBe("title");
    expect(read(title)["score"]).toBe("0 - 0");

    const later: CaromState = {
      ...title,
      screen: "playing",
      mode: "versus",
      score: { p1: 4, p2: 7 },
      ball: { ...homeBall(), x: 123.456, spin: -250 },
    };
    const values = read(later);
    expect(values["screen"]).toBe("playing");
    expect(values["mode"]).toBe("versus");
    expect(values["score"]).toBe("4 - 7");
    expect(values["ball pos"]).toBe("123.5, 360.0");
    expect(values["ball spin"]).toBe("-250.0");
  });

  it("reads a cleared field without reaching into an absent ball", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    const empty: CaromState = { ...createInitialState(), ball: null };
    const values = read(empty);
    expect(values["ball pos"]).toBe("\u2014");
    expect(values["ball vel"]).toBe("\u2014");
    expect(values["ball spin"]).toBe("\u2014");
    // The paddles are always present, so their lines still read.
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
