// The diagnostic sources: each registered under its name and each a pure read
// of the state it is handed, reporting the facts specs/instrumentation.md
// lists for the overlay.

import { describe, expect, it } from "vitest";
import { cellCenter } from "./board";
import { createDebugApi, type RefractDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { createInitialState } from "./flow";
import type { RefractState } from "./game";

/**
 * A route drawn through the surface's three pointer poses: a press at the
 * first cell's center, a move to each remaining center, then a release. The
 * surface carries no sugar for a route, so a caller that wants one composes it.
 */
function traceRoute(
  api: RefractDebugApi,
  state: RefractState,
  cells: readonly { col: number; row: number }[],
): RefractState {
  if (cells.length === 0) return state;
  const [firstX, firstY] = cellCenter(cells[0], state.board);
  let next = api.pointerDown(state, firstX, firstY);
  for (const cell of cells.slice(1)) {
    const [x, y] = cellCenter(cell, next.board);
    next = api.pointerMove(next, x, y);
  }
  return api.pointerUp(next);
}
import type { DeepReadonly } from "ts-essentials";

type Source = (state: DeepReadonly<RefractState>) => unknown;

/** The sources as registered, captured through a stand-in InitApi. */
function capture(): Map<string, Source> {
  const sources = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register: (name: string, source: Source) => {
        sources.set(name, source);
      },
    },
  });
  return sources;
}

const debug = createDebugApi();

describe("the diagnostic sources", () => {
  const sources = capture();

  it("registers the facts the overlay is asked to show", () => {
    expect([...sources.keys()]).toEqual([
      "screen",
      "mode",
      "board",
      "beam triangle",
      "beam square",
      "beam diamond",
      "crystals",
      "solved",
      "pointer",
    ]);
  });

  it("reads the state it is handed, not a state it closed over", () => {
    const title = createInitialState();
    expect(sources.get("screen")?.(title)).toBe("title");
    expect(sources.get("board")?.(title)).toBe("1x1");
    expect(sources.get("beam triangle")?.(title)).toBe("-");
    expect(sources.get("crystals")?.(title)).toBe("-");
    expect(sources.get("solved")?.(title)).toBe(false);
    expect(sources.get("pointer")?.(title)).toBe("0, 0");

    let playing = debug.loadBoard(title, ["T1T", "S.S"]);
    playing = traceRoute(debug, playing, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    playing = debug.pointerDown(playing, 100, 200);
    expect(sources.get("screen")?.(playing)).toBe("playing");
    expect(sources.get("board")?.(playing)).toBe("3x2");
    expect(sources.get("beam triangle")?.(playing)).toBe("2 seg, complete");
    expect(sources.get("beam square")?.(playing)).toBe("0 seg");
    expect(sources.get("beam diamond")?.(playing)).toBe("-");
    expect(sources.get("crystals")?.(playing)).toBe("1/1");
    expect(sources.get("solved")?.(playing)).toBe(false);
    expect(sources.get("pointer")?.(playing)).toBe("100, 200 down");
  });
});
