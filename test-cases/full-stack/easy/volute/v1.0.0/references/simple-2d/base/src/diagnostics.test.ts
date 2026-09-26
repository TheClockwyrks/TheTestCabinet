// The values the engine's overlay carries: that each one is registered, that each
// reads off the state it is handed rather than off anything held here, and that
// reading them changes nothing.

import { describe, expect, it } from "vitest";
import type { DeepReadonly } from "ts-essentials";
import { registerDiagnostics } from "./diagnostics";
import { freeze } from "./draft";
import type { VoluteState } from "./game";
import { createDraft, startLevel } from "./level";

type Source = (state: DeepReadonly<VoluteState>) => unknown;

/** Register into a table, exactly as the engine's `InitApi.diagnostics` does. */
function sources(): Map<string, Source> {
  const table = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register: (name, source) => {
        table.set(name, source as Source);
      },
    },
  });
  return table;
}

describe("the overlay's values", () => {
  it("registers everything specs/instrumentation.md asks for", () => {
    expect([...sources().keys()]).toEqual([
      "screen",
      "level",
      "cells",
      "quota",
      "pressure",
      "chain",
      "cores",
      "segments",
      "danger",
      "injector",
      "projectiles",
      "machinery",
    ]);
  });

  it("reads a running hall off the state it is handed", () => {
    const draft = createDraft();
    startLevel(draft, 3);
    draft.score = 1234;
    draft.pressure = 50;
    draft.machinery = { kind: "sightline", remaining: 11.5 };
    draft.projectiles = [{ charge: "cobalt", x: 1, y: 2, angle: 90 }];
    const state = freeze(draft);

    const read = new Map(
      [...sources()].map(([name, source]) => [name, source(state)]),
    );
    expect(read.get("screen")).toBe("playing");
    expect(read.get("level")).toBe("3  score 1234");
    expect(read.get("cells")).toBe(3);
    expect(read.get("quota")).toBe(53);
    expect(String(read.get("pressure"))).toMatch(/^50\.00 {2}feed 45\.00$/);
    expect(read.get("chain")).toBe("1  in 0.00s");
    expect(String(read.get("cores"))).toBe("12  head 308.0");
    expect(read.get("segments")).toBe(1);
    expect(read.get("danger")).toBe("no");
    expect(String(read.get("injector"))).toMatch(/aim 270\.0 {2}cd 0\.00$/);
    expect(read.get("projectiles")).toBe(1);
    expect(read.get("machinery")).toBe("sightline 11.50s");
  });

  it("reads an empty title hall without reaching for anything that is not there", () => {
    const state = freeze(createDraft());
    const read = new Map(
      [...sources()].map(([name, source]) => [name, source(state)]),
    );
    expect(read.get("screen")).toBe("title");
    expect(String(read.get("cores"))).toBe("0  head -");
    expect(read.get("segments")).toBe(0);
    expect(read.get("danger")).toBe("no");
    expect(String(read.get("injector"))).toBe("-/-  aim 270.0  cd 0.00");
    expect(read.get("machinery")).toBe("none");
  });

  it("leaves the state exactly as it was", () => {
    const state = freeze(createDraft());
    const before = JSON.stringify(state);
    for (const source of sources().values()) source(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
