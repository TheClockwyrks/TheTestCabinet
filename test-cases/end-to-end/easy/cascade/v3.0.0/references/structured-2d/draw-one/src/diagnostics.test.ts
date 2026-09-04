// The values the engine's overlay shows (specs/instrumentation.md,
// Diagnostics): that each one is registered, reads the live game, and changes
// nothing.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEAL_MODE, DEAL_MODE_LABEL } from "./constants";
import { diagnosticSources } from "./diagnostics";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseWaste,
  type Harness,
} from "./harness";
import { cascadeState } from "./game";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Every source's name and its value right now, as the overlay would show them. */
function panel(h: Harness): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const [name, source] of diagnosticSources(() =>
    cascadeState(h.engine.world),
  )) {
    rows[name] = String(source());
  }
  return rows;
}

describe("the sources", () => {
  it("name the screen and the deal mode", () => {
    const { debug } = h;
    openTable(debug);
    const rows = panel(h);
    expect(rows.screen).toBe("playing");
    expect(rows["deal-mode"]).toBe(DEAL_MODE);
    expect(rows["deal-label"]).toBe(DEAL_MODE_LABEL);
  });

  it("count the stock, the waste, the foundations and the columns", () => {
    const { debug } = h;
    openTable(debug);
    debug.addCard("stock", 0, "spades", 2, false);
    debug.addCard("stock", 0, "spades", 3, false);
    poseWaste(debug, [{ suit: "hearts", rank: 4 }], [1]);
    poseFoundation(debug, 1, "clubs", 3);
    poseColumn(debug, 6, [{ suit: "spades", rank: 13 }]);

    const rows = panel(h);
    expect(rows.stock).toBe("2");
    expect(rows.waste).toBe("1 shown 1");
    expect(rows.foundations).toBe("0 3 0 0");
    expect(rows.columns).toBe("0 0 0 0 0 0 1");
  });

  it("report the run in hand and the cascade", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [
      { suit: "spades", rank: 8 },
      { suit: "hearts", rank: 7 },
    ]);
    expect(panel(h).drag).toBe("none");
    debug.pointerDown(224 + 50, 180 + 17);
    expect(panel(h).drag).toBe("2 from tableau 0");
    debug.pointerUp(224 + 50, 180 + 17);

    expect(panel(h).cascade).toBe("launched 0 flying 0");
    debug.addFlyer("clubs", 2, 100, 100, 10, 0);
    await h.advance(1);
    expect(panel(h).cascade).toBe("launched 0 flying 1");
  });

  it("change nothing about the game", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 2, [{ suit: "hearts", rank: 9 }]);
    poseFoundation(debug, 0, "spades", 4);
    const before = JSON.stringify(debug.snapshot());
    panel(h);
    panel(h);
    expect(JSON.stringify(debug.snapshot())).toBe(before);
  });

  it("are registered with the world's own overlay registry", () => {
    const registered: string[] = [];
    const world = h.engine.world;
    const original = world.diagnostics.register.bind(world.diagnostics);
    world.diagnostics.register = (name: string, source: () => unknown) => {
      registered.push(name);
      original(name, source);
    };
    for (const [name] of diagnosticSources(() => cascadeState(world))) {
      world.diagnostics.register(name, () => null);
    }
    expect(registered).toContain("screen");
    expect(registered).toContain("cascade");
  });
});
