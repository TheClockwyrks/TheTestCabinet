// specs/instrumentation.md names the values the runtime's overlay must show. What
// is checked here is that every one is registered and that each is a live, pure
// read of the state rather than a value sampled once at registration.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { createInitialState } from "./game";
import type { InitApi } from "./runtime";

/** Just enough of an `InitApi` to collect the sources a game registers. */
function collector(): {
  api: InitApi;
  read: () => Record<string, unknown>;
} {
  const sources = new Map<string, () => unknown>();
  const api = {
    diagnostics: {
      register: (name: string, source: () => unknown) => {
        sources.set(name, source);
      },
    },
  } as unknown as InitApi;
  return {
    api,
    read: () =>
      Object.fromEntries(
        [...sources].map(([name, source]) => [name, source()]),
      ),
  };
}

describe("registerDiagnostics", () => {
  it("registers the screen, mode, scores, ball, and both paddles", () => {
    const { api, read } = collector();
    registerDiagnostics(api, createInitialState());
    expect(Object.keys(read())).toEqual([
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

  it("reads the live state on every read", () => {
    const state = createInitialState();
    const { api, read } = collector();
    registerDiagnostics(api, state);

    expect(read()["screen"]).toBe("title");
    expect(read()["score"]).toBe("0 - 0");

    state.screen = "playing";
    state.mode = "versus";
    state.score.p1 = 4;
    state.score.p2 = 7;
    state.ball!.x = 123.456;
    state.ball!.spin = -250;

    const values = read();
    expect(values["screen"]).toBe("playing");
    expect(values["mode"]).toBe("versus");
    expect(values["score"]).toBe("4 - 7");
    expect(values["ball pos"]).toBe("123.5, 360.0");
    expect(values["ball spin"]).toBe("-250.0");
  });

  it("reports a dash for a ball that is not on the field", () => {
    const state = createInitialState();
    state.ball = null;
    const { api, read } = collector();
    registerDiagnostics(api, state);

    const values = read();
    expect(values["ball pos"]).toBe("—");
    expect(values["ball vel"]).toBe("—");
    expect(values["ball spin"]).toBe("—");
  });

  it("changes nothing it reads", () => {
    const state = createInitialState();
    const { api, read } = collector();
    registerDiagnostics(api, state);
    const before = JSON.stringify(state);
    read();
    read();
    expect(JSON.stringify(state)).toBe(before);
  });
});
