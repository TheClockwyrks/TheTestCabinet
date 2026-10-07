// The values the overlay is given, and that reading them changes nothing.

import { describe, expect, it } from "vitest";
import { DEAL_MODE, DEAL_MODE_LABEL } from "./constants";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import { dealFresh, turnStock } from "./table";
import { toSim } from "./sim";
import type { CascadeState } from "./game";
import type { InitApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

type Source = (state: DeepReadonly<CascadeState>) => unknown;

/** Collect what the build registers, without standing an engine up. */
function collectSources(): Map<string, Source> {
  const sources = new Map<string, Source>();
  const api = {
    diagnostics: {
      register: (name: string, source: Source) => {
        sources.set(name, source);
      },
    },
  } as unknown as InitApi<CascadeState>;
  registerDiagnostics(api);
  return sources;
}

/** A table part-way through a game, as a state the sources can read. */
function playedState(): CascadeState {
  const sim = toSim(openingState());
  sim.screen = "playing";
  dealFresh(sim);
  turnStock(sim);
  sim.drag = {
    cards: [{ id: 900, suit: "spades", rank: 5, faceUp: true }],
    fromPile: "tableau",
    fromIndex: 0,
    x: 10,
    y: 20,
  };
  sim.launched = 7;
  sim.flyers = [
    { id: 901, suit: "hearts", rank: 2, x: 0, y: 0, vx: 0, vy: 0 },
    { id: 902, suit: "clubs", rank: 3, x: 0, y: 0, vx: 0, vy: 0 },
  ];
  return sim;
}

describe("the overlay's sources", () => {
  it("registers the screen, the mode, every pile, the drag and the cascade", () => {
    const sources = collectSources();
    expect([...sources.keys()]).toEqual([
      "screen",
      "mode",
      "stock",
      "waste",
      "foundations",
      "columns",
      "drag",
      "cascade",
    ]);
  });

  it("reads the state it is handed rather than the one it was built from", () => {
    const sources = collectSources();
    const state = playedState();
    const read = (name: string): unknown =>
      (sources.get(name) as Source)(state);

    expect(read("screen")).toBe("playing");
    expect(read("mode")).toBe(`${DEAL_MODE} (${DEAL_MODE_LABEL})`);
    expect(read("stock")).toBe(21);
    expect(read("waste")).toBe("3 (3 shown)");
    expect(read("foundations")).toBe("0 0 0 0");
    expect(read("columns")).toBe("1 2 3 4 5 6 7");
    expect(read("drag")).toBe("held 1 cards");
    expect(read("cascade")).toBe("launched 7 / flying 2");
  });

  it("reports an idle table as idle", () => {
    const sources = collectSources();
    const state = openingState();
    expect((sources.get("drag") as Source)(state)).toBe("none");
    expect((sources.get("waste") as Source)(state)).toBe("0 (0 shown)");
  });

  it("changes nothing it reads", () => {
    const sources = collectSources();
    const state = playedState();
    const before = JSON.stringify({ ...state, trail: null });
    for (const source of sources.values()) source(state);
    expect(JSON.stringify({ ...state, trail: null })).toBe(before);
  });
});
