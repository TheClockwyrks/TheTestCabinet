import { describe, expect, it } from "vitest";

import { createStateOps } from "./debug";
import { Diagnostics, registerGameDiagnostics } from "./diagnostics";
import { Game } from "./game";

function read(diagnostics: Diagnostics): Record<string, string> {
  return Object.fromEntries(
    diagnostics.lines().map((line) => [line.label, line.value]),
  );
}

describe("the overlay's sources (specs/instrumentation.md)", () => {
  it("registers the facts the snapshot reports", () => {
    const game = new Game();
    const diagnostics = new Diagnostics();
    registerGameDiagnostics(diagnostics, game);
    const labels = diagnostics.lines().map((line) => line.label);
    for (const label of [
      "screen",
      "mode",
      "challenge",
      "source",
      "parts",
      "cost",
      "period",
      "status",
      "cycle",
      "fraction",
      "speed",
      "tallies",
      "motes",
      "area",
      "fault",
      "focus",
      "pointer",
    ]) {
      expect(labels, label).toContain(label);
    }
  });

  it("reads the live game rather than the state it was registered against", () => {
    const game = new Game();
    const api = createStateOps(game);
    const diagnostics = new Diagnostics();
    registerGameDiagnostics(diagnostics, game);
    expect(read(diagnostics).screen).toBe("title");

    api.openChallenge("extras", 1);
    api.placePart("arm", 0, 0, 0);
    api.placeSet(0, 3, 0, 0);
    api.startRun();
    api.setTally(0, 2);
    api.setFocus("tape");
    api.pointerMove(100, 200);

    const lines = read(diagnostics);
    expect(lines.screen).toBe("editor");
    expect(lines.challenge).toBe("Twin Moons");
    expect(lines.source).toBe("extras 2");
    expect(lines.parts).toBe("2");
    expect(lines.cost).toBe("20");
    expect(lines.status).toBe("running");
    expect(lines.tallies).toBe("2/6");
    expect(lines.focus).toBe("tape");
    expect(lines.pointer).toBe("100, 200");
  });

  it("changes nothing it reports", () => {
    const watched = new Game();
    const quiet = new Game();
    const diagnostics = new Diagnostics();
    registerGameDiagnostics(diagnostics, watched);
    createStateOps(watched).openChallenge("extras", 0);
    createStateOps(quiet).openChallenge("extras", 0);
    for (let frame = 0; frame < 30; frame += 1) {
      watched.update(1 / 60);
      diagnostics.lines();
      quiet.update(1 / 60);
    }
    expect(createStateOps(watched).snapshot()).toEqual(
      createStateOps(quiet).snapshot(),
    );
  });

  it("rests every run figure while there is no run", () => {
    const game = new Game();
    const diagnostics = new Diagnostics();
    registerGameDiagnostics(diagnostics, game);
    const lines = read(diagnostics);
    expect(lines.status).toBe("—");
    expect(lines.cycle).toBe("—");
    expect(lines.fault).toBe("—");
    expect(lines.motes).toBe("0");
  });
});
