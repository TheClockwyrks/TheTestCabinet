// The overlay's sources (specs/instrumentation.md "Diagnostics"): at least
// the snapshot's facts, each a pure read that leaves the game as it is.

import { describe, expect, it } from "vitest";
import { snapshotOf } from "./debug";
import { diagnosticSources } from "./diagnostics";
import { startFreshSession } from "./flow";
import { KesslerState } from "./game";

function makePanel() {
  const state = new KesslerState();
  const sources = diagnosticSources(() => state);
  const value = (label: string): unknown => {
    const entry = sources.find(([name]) => name === label);
    if (!entry) throw new Error(`no source labeled ${label}`);
    return entry[1]();
  };
  return { state, sources, value };
}

describe("the game's registered sources", () => {
  it("carries every fact the specification requires", () => {
    const { sources } = makePanel();
    const labels = sources.map(([name]) => name);
    for (const required of [
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
      expect(labels).toContain(required);
    }
  });

  it("reads the live values off the state", () => {
    const { state, value } = makePanel();
    startFreshSession(state);
    state.score = 4321;
    state.lives = 2;
    state.wave = 5;
    state.effects.widenTicks = 120;
    state.effects.shieldActive = true;
    expect(value("screen")).toBe("playing");
    expect(value("score")).toBe(4321);
    expect(value("lives")).toBe(2);
    expect(value("wave")).toBe(5);
    expect(value("paddle")).toBe("90.0 deg / 72 deg");
    expect(value("balls")).toBe(1); // the parked ball
    expect(value("targets")).toBe(48); // 12 + 16 + 20
    expect(value("pods")).toBe(0);
    expect(value("widen")).toBe("120 ticks");
    expect(value("narrow")).toBe("0 ticks");
    expect(value("pierce")).toBe("0 ticks");
    expect(value("shield")).toBe("active");
  });

  it("keeps every source a pure read", () => {
    const { state, sources } = makePanel();
    startFreshSession(state);
    const before = JSON.stringify(snapshotOf(state));
    for (const [, source] of sources) source();
    for (const [, source] of sources) source();
    expect(JSON.stringify(snapshotOf(state))).toBe(before);
  });
});
