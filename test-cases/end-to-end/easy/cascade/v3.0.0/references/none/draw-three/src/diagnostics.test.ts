// The values the overlay shows: every one a pure read, and short enough to fit on
// a line.

import { describe, expect, it } from "vitest";
import { DEAL_MODE_LABEL } from "./constants";
import { registerDiagnostics } from "./diagnostics";
import { Diagnostics } from "./overlay";
import type { InitApi } from "./runtime";
import { createState, type CascadeState } from "./state";

function stand(): { panel: Diagnostics; state: CascadeState } {
  const panel = new Diagnostics();
  const api: InitApi = {
    audio: { define: () => undefined },
    diagnostics: {
      register: (name, source) => panel.register(name, source),
    },
  };
  const state = createState(() => null);
  registerDiagnostics(api, state);
  return { panel, state };
}

const frame = { count: 1, dt: 1 / 60 };

describe("registerDiagnostics", () => {
  it("names the screen, the deal mode, every pile, the hand and the cascade", () => {
    const { panel } = stand();
    const lines = panel.lines(frame).slice(1);
    expect(lines).toEqual([
      "screen title",
      `deal ${DEAL_MODE_LABEL}`,
      "stock 0",
      "waste 0 (showing 0)",
      "foundations 0 0 0 0",
      "columns 0 0 0 0 0 0 0",
      "hand empty",
      "cascade launched 0  flying 0",
    ]);
  });

  it("reports the live game rather than the game it was registered over", () => {
    const { panel, state } = stand();
    state.screen = "playing";
    state.stock.push({ id: 1, suit: "spades", rank: 1, faceUp: false });
    state.waste.push({ id: 2, suit: "hearts", rank: 2, faceUp: true });
    state.wasteSets.push(1);
    state.foundations[0].push({ id: 3, suit: "clubs", rank: 1, faceUp: true });
    state.tableau[6].push({ id: 4, suit: "hearts", rank: 5, faceUp: true });
    state.drag = {
      cards: [{ id: 5, suit: "spades", rank: 9, faceUp: true }],
      fromPile: "tableau",
      fromIndex: 0,
      x: 0,
      y: 0,
      grabDx: 0,
      grabDy: 0,
    };
    state.launched = 4;
    state.flyers.push({
      id: 6,
      suit: "clubs",
      rank: 3,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    });

    const lines = panel.lines(frame).slice(1);
    expect(lines).toEqual([
      "screen playing",
      `deal ${DEAL_MODE_LABEL}`,
      "stock 1",
      "waste 1 (showing 1)",
      "foundations 1 0 0 0",
      "columns 0 0 0 0 0 0 1",
      "hand 1 card(s)",
      "cascade launched 4  flying 1",
    ]);
  });

  it("leaves the game exactly as it is", () => {
    const { panel, state } = stand();
    const before = JSON.stringify({
      screen: state.screen,
      stock: state.stock,
      waste: state.waste,
      sets: state.wasteSets,
      launched: state.launched,
    });
    panel.lines(frame);
    panel.lines(frame);
    expect(
      JSON.stringify({
        screen: state.screen,
        stock: state.stock,
        waste: state.waste,
        sets: state.wasteSets,
        launched: state.launched,
      }),
    ).toBe(before);
  });
});
