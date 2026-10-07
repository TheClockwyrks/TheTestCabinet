import { describe, expect, it } from "vitest";
import { DEAL_MODE, DEAL_MODE_LABEL } from "./constants";
import { createDebugApi } from "./debug";
import { openingState } from "./flow";
import { registerDiagnostics } from "./diagnostics";
import type { CascadeState } from "./game";
import type { DeepReadonly } from "ts-essentials";

type Source = (state: DeepReadonly<CascadeState>) => unknown;

function sources(): Map<string, Source> {
  const registered = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register(name: string, source: Source) {
        registered.set(name, source);
      },
    },
  });
  return registered;
}

describe("the overlay's sources", () => {
  const debug = createDebugApi();

  it("names the screen and the deal mode", () => {
    const registered = sources();
    const state = debug.setScreen(openingState(), "playing");
    expect(registered.get("screen")?.(state)).toBe("playing");
    expect(registered.get("mode")?.(state)).toBe(DEAL_MODE);
    expect(registered.get("modeLabel")?.(state)).toBe(DEAL_MODE_LABEL);
  });

  it("counts every pile", () => {
    const registered = sources();
    const state = debug.deal(debug.setScreen(openingState(), "playing"));
    expect(registered.get("stock")?.(state)).toBe(24);
    expect(registered.get("waste")?.(state)).toBe(0);
    expect(registered.get("foundations")?.(state)).toBe("0 0 0 0");
    expect(registered.get("columns")?.(state)).toBe("1 2 3 4 5 6 7");
  });

  it("reports the run in hand", () => {
    const registered = sources();
    let state = debug.clearTable(debug.setScreen(openingState(), "playing"));
    expect(registered.get("dragging")?.(state)).toBe(false);
    expect(registered.get("dragCards")?.(state)).toBe(0);

    state = debug.addCard(state, "tableau", 0, "spades", 13, true);
    state = debug.addCard(state, "tableau", 0, "hearts", 12, true);
    state = debug.pointerDown(state, 274, 190);
    expect(registered.get("dragging")?.(state)).toBe(true);
    expect(registered.get("dragCards")?.(state)).toBe(2);
  });

  it("reports the cascade", () => {
    const registered = sources();
    let state: CascadeState = {
      ...debug.clearTable(openingState()),
      launched: 7,
    };
    state = debug.addFlyer(state, "hearts", 3, 0, 0, 0, 0);
    expect(registered.get("launched")?.(state)).toBe(7);
    expect(registered.get("flying")?.(state)).toBe(1);
  });

  it("reads the state it is handed rather than the one it was built with", () => {
    const registered = sources();
    const first = openingState();
    const second = debug.setScreen(first, "won");
    expect(registered.get("screen")?.(first)).toBe("title");
    expect(registered.get("screen")?.(second)).toBe("won");
  });
});
