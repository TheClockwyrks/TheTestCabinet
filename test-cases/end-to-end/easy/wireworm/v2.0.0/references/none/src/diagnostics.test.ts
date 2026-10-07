// Wireworm — the values the overlay reports (specs/instrumentation.md).
//
// The panel is the runtime's; Wireworm's part is naming the values, and every
// source is a PURE READ of the one live state, so watching the overlay leaves
// the game exactly as it is.

import { describe, expect, test } from "vitest";
import { CHARGE_MAX, tileCX, tileCY } from "./constants";
import { setCharge } from "./field";
import { makeFoe } from "./foes";
import { registerDiagnostics, ROSTER_LINES } from "./diagnostics";
import { layWorm, posedState } from "./harness.test-support";
import type { InitApi } from "./runtime";
import type { WirewormState } from "./types";

/** Collect the sources a registration names, without a runtime. */
function sourcesOf(state: WirewormState): Map<string, () => unknown> {
  const sources = new Map<string, () => unknown>();
  const api = {
    input: { register: () => undefined },
    audio: { define: () => undefined },
    diagnostics: {
      register: (name: string, source: () => unknown) =>
        sources.set(name, source),
    },
  } as unknown as InitApi;
  registerDiagnostics(api, state);
  return sources;
}

describe("the diagnostic sources", () => {
  test("every fact the specification lists is named", () => {
    const sources = sourcesOf(posedState());
    expect([...sources.keys()]).toEqual([
      "screen",
      "run",
      "nodes",
      "worms",
      "foes",
      "cursor",
      "bolts",
    ]);
  });

  test("they report the live game rather than the game they were named over", () => {
    const state = posedState(4);
    const sources = sourcesOf(state);
    expect(sources.get("screen")?.()).toBe("playing / active");
    expect(sources.get("nodes")?.()).toBe(0);

    setCharge(state.field, 3, 3, CHARGE_MAX);
    state.score = 250;
    state.lives = 2;
    state.cursor.x = 100.4;
    state.cursor.y = 688;
    state.bolts.push({ id: 1, x: 1, y: 2 });
    layWorm(state, [
      [7, 5],
      [6, 5],
    ]);
    state.foes.push(makeFoe(state, "glitch", tileCX(9), tileCY(9)));

    expect(sources.get("nodes")?.()).toBe(1);
    expect(sources.get("run")?.()).toBe("score 250  lives 2  level 4/12");
    expect(sources.get("cursor")?.()).toBe("100, 688");
    expect(sources.get("bolts")?.()).toBe(1);
    expect(String(sources.get("worms")?.())).toMatch(
      /#\d+ len 2 head 7,5 dh \+1 dv \+1 dive n/,
    );
    expect(String(sources.get("foes")?.())).toMatch(/#\d+ glitch 304, 384/);
  });

  test("an empty roster reads as none, and a long one is summarized", () => {
    const state = posedState();
    const sources = sourcesOf(state);
    expect(sources.get("worms")?.()).toBe("none");
    expect(sources.get("foes")?.()).toBe("none");
    for (let i = 0; i < ROSTER_LINES + 3; i += 1) layWorm(state, [[i, 1]]);
    expect(String(sources.get("worms")?.())).toContain("+3 more");
  });

  test("reading them changes nothing", () => {
    const state = posedState();
    layWorm(state, [[5, 5]]);
    state.foes.push(makeFoe(state, "dropper", 100, 200));
    const sources = sourcesOf(state);
    const before = JSON.stringify(state, (key, value) =>
      key === "field" ? [...(value as Int8Array)] : value,
    );
    for (const source of sources.values()) source();
    const after = JSON.stringify(state, (key, value) =>
      key === "field" ? [...(value as Int8Array)] : value,
    );
    expect(after).toBe(before);
  });

  test("a headless worm is reported rather than crashing the panel", () => {
    const state = posedState();
    layWorm(state, []);
    const sources = sourcesOf(state);
    expect(String(sources.get("worms")?.())).toContain("head -");
  });
});
