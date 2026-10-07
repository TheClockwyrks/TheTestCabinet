import { describe, expect, it } from "vitest";

import { createDebugApi } from "./debug";
import { diagnosticSources } from "./diagnostics";
import { advanceFrame } from "./flow";
import { Bench } from "./harness";

/** Every source, read now, by name. */
function read(game: Bench): Record<string, string> {
  return Object.fromEntries(
    diagnosticSources(() => game.state).map(([name, source]) => [
      name,
      source(),
    ]),
  );
}

describe("the overlay's sources (specs/instrumentation.md)", () => {
  it("names the facts the snapshot reports", () => {
    const names = diagnosticSources(() => new Bench().state).map(
      ([name]) => name,
    );
    for (const name of [
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
      expect(names, name).toContain(name);
    }
  });

  it("reads the live game rather than the state it was registered against", () => {
    const game = new Bench();
    const api = createDebugApi(() => game);
    expect(read(game).screen).toBe("title");

    api.openChallenge("extras", 1);
    api.placePart("arm", 0, 0, 0);
    api.placeSet(0, 3, 0, 0);
    api.startRun();
    api.setTally(0, 2);
    api.setFocus("tape");
    api.pointerMove(100, 200);

    const lines = read(game);
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

  it("rests every run figure while there is no run", () => {
    const lines = read(new Bench());
    expect(lines.status).toBe("—");
    expect(lines.cycle).toBe("—");
    expect(lines.fault).toBe("—");
    expect(lines.motes).toBe("0");
  });

  it("changes nothing it reports", () => {
    const watched = new Bench();
    const quiet = new Bench();
    createDebugApi(() => watched).openChallenge("extras", 0);
    createDebugApi(() => quiet).openChallenge("extras", 0);
    for (let frame = 0; frame < 30; frame += 1) {
      advanceFrame(watched, 1 / 60);
      read(watched);
      advanceFrame(quiet, 1 / 60);
    }
    expect(createDebugApi(() => watched).snapshot()).toEqual(
      createDebugApi(() => quiet).snapshot(),
    );
  });
});
