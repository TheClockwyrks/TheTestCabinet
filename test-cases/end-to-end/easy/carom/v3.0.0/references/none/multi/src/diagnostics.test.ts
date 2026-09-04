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
  it("registers the screen, mode, scores, every ball, and both paddles", () => {
    const { api, read } = collector();
    registerDiagnostics(api, createInitialState());
    expect(Object.keys(read())).toEqual([
      "screen",
      "mode",
      "score",
      "ball 0 pos",
      "ball 0 vel",
      "ball 0 spin",
      "ball 1 pos",
      "ball 1 vel",
      "ball 1 spin",
      "ball 2 pos",
      "ball 2 vel",
      "ball 2 spin",
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
    state.balls[1].x = 123.456;
    state.balls[1].spin = -250;
    state.balls[1].held = false;

    const values = read();
    expect(values["screen"]).toBe("playing");
    expect(values["mode"]).toBe("versus");
    expect(values["score"]).toBe("4 - 7");
    expect(values["ball 1 pos"]).toBe("123.5, 360.0");
    expect(values["ball 1 spin"]).toBe("-250.0");
    expect(values["ball 2 pos"]).toBe("640.0, 540.0 held");
  });

  it("reports a ball that is not on the field as absent", () => {
    const state = createInitialState();
    const { api, read } = collector();
    registerDiagnostics(api, state);
    state.balls.length = 0;

    const values = read();
    expect(values["ball 0 pos"]).toBe("—");
    expect(values["ball 0 vel"]).toBe("—");
    expect(values["ball 0 spin"]).toBe("—");
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
