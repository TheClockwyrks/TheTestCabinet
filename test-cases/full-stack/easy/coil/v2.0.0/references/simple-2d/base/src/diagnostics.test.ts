import { describe, expect, it } from "vitest";
import { NO_SPRITES } from "./assets";
import { registerDiagnostics } from "./diagnostics";
import { createInitialState, startRound, type CoilState } from "./game";
import type { DeepReadonly } from "ts-essentials";

type Source = (state: DeepReadonly<CoilState>) => unknown;

function collect(): Map<string, Source> {
  const sources = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register: (name: string, source: Source) => sources.set(name, source),
    },
  });
  return sources;
}

describe("the diagnostic sources", () => {
  it("names the facts specs/instrumentation.md asks the overlay to show", () => {
    expect([...collect().keys()]).toEqual([
      "screen",
      "score",
      "best",
      "combo",
      "window",
      "dir",
      "length",
      "head",
      "pellet",
    ]);
  });

  it("reads the state it is handed rather than the one it was built from", () => {
    const sources = collect();
    const opening = createInitialState(NO_SPRITES, false);
    const playing: CoilState = { ...startRound(opening), score: 70 };
    expect(sources.get("screen")!(opening)).toBe("title");
    expect(sources.get("screen")!(playing)).toBe("playing");
    expect(sources.get("score")!(playing)).toBe(70);
    expect(sources.get("length")!(playing)).toBe(playing.snake.length);
    expect(sources.get("head")!(playing)).toBe(
      `${playing.snake[0]!.col}, ${playing.snake[0]!.row}`,
    );
  });

  it("reports an absent pellet rather than failing on it", () => {
    const sources = collect();
    const state: CoilState = {
      ...createInitialState(NO_SPRITES, false),
      pellet: null,
    };
    expect(sources.get("pellet")!(state)).toBe("none");
  });

  it("changes nothing it reads", () => {
    const sources = collect();
    const state = startRound(createInitialState(NO_SPRITES, false));
    const before = JSON.stringify(state);
    for (const source of sources.values()) source(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
