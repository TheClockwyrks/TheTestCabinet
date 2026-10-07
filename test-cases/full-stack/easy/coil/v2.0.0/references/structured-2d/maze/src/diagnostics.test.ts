import { describe, expect, it } from "vitest";
import { diagnosticSources } from "./diagnostics";
import { resetSession, startRound } from "./flow";
import { CoilState } from "./game";

function opening(): CoilState {
  const state = new CoilState();
  resetSession(state);
  return state;
}

/** The sources, reading whichever state `held` currently points at. */
function collect(held: { state: CoilState }): Map<string, () => unknown> {
  return new Map(diagnosticSources(() => held.state));
}

describe("the diagnostic sources", () => {
  it("names the facts specs/instrumentation.md asks the overlay to show", () => {
    expect([...collect({ state: opening() }).keys()]).toEqual([
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

  it("reads the live state at the call rather than the one it was built on", () => {
    const held = { state: opening() };
    const sources = collect(held);
    expect(sources.get("screen")!()).toBe("title");

    const playing = opening();
    startRound(playing);
    playing.score = 70;
    held.state = playing;
    expect(sources.get("screen")!()).toBe("playing");
    expect(sources.get("score")!()).toBe(70);
    expect(sources.get("length")!()).toBe(playing.snake.length);
    expect(sources.get("head")!()).toBe(
      `${playing.snake[0]!.col}, ${playing.snake[0]!.row}`,
    );
  });

  it("reports an absent pellet rather than failing on it", () => {
    const state = opening();
    state.pellet = null;
    expect(collect({ state }).get("pellet")!()).toBe("none");
  });

  it("changes nothing it reads", () => {
    const state = opening();
    startRound(state);
    const before = JSON.stringify(state);
    for (const source of collect({ state }).values()) source();
    expect(JSON.stringify(state)).toBe(before);
  });
});
