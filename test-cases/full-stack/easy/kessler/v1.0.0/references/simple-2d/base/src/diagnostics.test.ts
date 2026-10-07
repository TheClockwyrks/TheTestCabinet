// The overlay sources of specs/instrumentation.md "Diagnostics": every named
// value registers, each is a pure read of the state it is handed, and the
// facts match the snapshot's.

import { describe, expect, it } from "vitest";
import { NO_ASSETS } from "./assets";
import { createDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { bootState, type KesslerState, type View } from "./flow";

function collect() {
  const sources = new Map<string, (state: View) => unknown>();
  registerDiagnostics({
    diagnostics: {
      register: (name, source) => sources.set(name, source),
    },
  });
  return sources;
}

describe("the diagnostic sources", () => {
  it("registers every fact the spec names", () => {
    const names = [...collect().keys()];
    for (const wanted of [
      "screen",
      "score",
      "lives",
      "wave",
      "paddle",
      "balls",
      "targets",
      "pods",
      "widen",
      "narrow",
      "pierce",
      "shield",
    ]) {
      expect(names).toContain(wanted);
    }
  });

  it("reads the state it is handed, leaving it as it was", () => {
    const debug = createDebugApi();
    const sources = collect();
    let state: KesslerState = bootState(NO_ASSETS);
    state = debug.setScreen(state, "playing");
    state = debug.parkBall(state);
    state = debug.setScore(state, 725);
    state = debug.setEffectTicks(state, "widen", 90);
    state = debug.setShield(state, true);
    const frozen = JSON.stringify(debug.snapshot(state));

    expect(sources.get("screen")!(state)).toBe("playing");
    expect(sources.get("score")!(state)).toBe(725);
    expect(sources.get("lives")!(state)).toBe(3);
    expect(sources.get("wave")!(state)).toBe(1);
    expect(sources.get("paddle")!(state)).toBe("90.0 deg / 72 deg");
    expect(sources.get("balls")!(state)).toBe(1);
    expect(sources.get("targets")!(state)).toBe(48);
    expect(sources.get("pods")!(state)).toBe(0);
    expect(sources.get("widen")!(state)).toBe("90 ticks");
    expect(sources.get("narrow")!(state)).toBe("0 ticks");
    expect(sources.get("pierce")!(state)).toBe("0 ticks");
    expect(sources.get("shield")!(state)).toBe("active");

    expect(JSON.stringify(debug.snapshot(state))).toBe(frozen);
  });
});
