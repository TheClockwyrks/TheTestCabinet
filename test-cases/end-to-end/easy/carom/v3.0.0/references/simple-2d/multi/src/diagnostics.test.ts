// specs/instrumentation.md names the values the engine's overlay must show. What
// is checked here is that every one is registered and that each is a read of the
// state it is HANDED rather than of the one that existed at registration — the
// engine calls a source with the state current at the read, and a source that
// closed over the opening state would report the title screen forever.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { createInitialState } from "./flow";
import type { CaromState } from "./game";
import type { InitApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

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
  it("registers the screen, mode, scores, every ball, and both paddles", () => {
    const { api, read } = collector();
    registerDiagnostics(api);
    expect(Object.keys(read(createInitialState()))).toEqual([
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

  it("reads the state it is handed on every read", () => {
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
      balls: title.balls.map((ball, i) =>
        i === 1 ? { ...ball, x: 123.456, spin: -250, held: false } : ball,
      ),
    };

    const values = read(later);
    expect(values["screen"]).toBe("playing");
    expect(values["mode"]).toBe("versus");
    expect(values["score"]).toBe("4 - 7");
    expect(values["ball 1 pos"]).toBe("123.5, 360.0");
    expect(values["ball 1 spin"]).toBe("-250.0");
    expect(values["ball 2 pos"]).toBe("640.0, 540.0 held");
    // And the opening state still reads as the opening state: nothing was kept.
    expect(read(title)["screen"]).toBe("title");
  });

  it("says so plainly for a ball that is not in the field", () => {
    const { api, read } = collector();
    registerDiagnostics(api);

    const title = createInitialState();
    const emptied: CaromState = { ...title, balls: [title.balls[0]] };
    const values = read(emptied);
    expect(values["ball 0 pos"]).toBe("640.0, 180.0 held");
    expect(values["ball 1 pos"]).toBe("—");
    expect(values["ball 1 vel"]).toBe("—");
    expect(values["ball 2 spin"]).toBe("—");
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
