// The overlay's sources (specs/instrumentation.md "Diagnostics"): at least
// the snapshot's facts, each a pure read that leaves the game as it is.

import { describe, expect, it } from "vitest";
import { createStateOps } from "./debug";
import { Diagnostics, registerGameDiagnostics } from "./diagnostics";
import { Game } from "./game";

function makePanel() {
  const game = new Game();
  const diagnostics = new Diagnostics();
  registerGameDiagnostics(diagnostics, game, { count: 3 });
  const value = (label: string): string => {
    const line = diagnostics.lines().find((entry) => entry.label === label);
    if (!line) throw new Error(`no source labeled ${label}`);
    return line.value;
  };
  return { game, diagnostics, value, ops: createStateOps(game) };
}

describe("the diagnostics registry", () => {
  it("reads sources in registration order", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("a", () => "1");
    diagnostics.register("b", () => "2");
    expect(diagnostics.lines()).toEqual([
      { label: "a", value: "1" },
      { label: "b", value: "2" },
    ]);
  });
});

describe("the game's registered sources", () => {
  it("carries every fact the specification requires", () => {
    const { diagnostics } = makePanel();
    const labels = diagnostics.lines().map((line) => line.label);
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

  it("reads the live values off the game", () => {
    const { game, ops, value } = makePanel();
    game.poseScreen("playing");
    ops.parkBall();
    game.session.score = 4321;
    game.session.lives = 2;
    game.session.wave = 5;
    game.session.effects.widenTicks = 120;
    game.session.effects.shieldActive = true;
    expect(value("screen")).toBe("playing");
    expect(value("score")).toBe("4321");
    expect(value("lives")).toBe("2");
    expect(value("wave")).toBe("5");
    expect(value("paddle")).toBe("90.0 deg / 72 deg");
    expect(value("balls")).toBe("1"); // the parked ball
    expect(value("targets")).toBe("48"); // 12 + 16 + 20
    expect(value("pods")).toBe("0");
    expect(value("widen")).toBe("120 ticks");
    expect(value("narrow")).toBe("0 ticks");
    expect(value("pierce")).toBe("0 ticks");
    expect(value("shield")).toBe("active");
    expect(value("fx")).toBe("3");
  });

  it("keeps every source a pure read", () => {
    const { game, diagnostics } = makePanel();
    game.poseScreen("playing");
    const before = JSON.stringify(game.snapshot());
    diagnostics.lines();
    diagnostics.lines();
    expect(JSON.stringify(game.snapshot())).toBe(before);
  });
});
