// The values Orrery names for the engine's debug overlay
// (specs/instrumentation.md "Diagnostics").
//
// The panel, the backtick key that toggles it, and its read-only-ness are the
// engine's, so what is checked here is Orrery's half: that every fact the
// specification asks for is registered, that each source reads the state it is
// HANDED rather than one it closed over, and that reading them changes
// nothing.

import type { DiagnosticValue } from "@clockwyrks/simple-2d";
import { describe, expect, it } from "vitest";

import { createStateOps } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { Session } from "./session";
import { createState } from "./state";
import type { OrreryState } from "./types";

/** A registry that collects the sources, so a test can read them by name. */
function registry(): {
  names: string[];
  read: (state: OrreryState) => Record<string, DiagnosticValue>;
} {
  const sources: [string, (state: OrreryState) => DiagnosticValue][] = [];
  registerDiagnostics({
    diagnostics: {
      register: (name, source) =>
        sources.push([
          name,
          source as unknown as (state: OrreryState) => DiagnosticValue,
        ]),
    },
  });
  return {
    names: sources.map(([name]) => name),
    read: (state) =>
      Object.fromEntries(sources.map(([name, read]) => [name, read(state)])),
  };
}

describe("the overlay's sources (specs/instrumentation.md)", () => {
  it("registers the facts the snapshot reports", () => {
    const { names } = registry();
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

  it("reads the state it is handed rather than one it closed over", () => {
    const { read } = registry();
    expect(read(createState()).screen).toBe("title");

    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("extras", 1);
    api.placePart("arm", 0, 0, 0);
    api.placeSet(0, 3, 0, 0);
    api.startRun();
    api.setTally(0, 2);
    api.setFocus("tape");
    api.pointerMove(100, 200);

    const lines = read(game.state);
    expect(lines.screen).toBe("editor");
    expect(lines.challenge).toBe("Twin Moons");
    expect(lines.source).toBe("extras 2");
    expect(lines.parts).toBe(2);
    expect(lines.cost).toBe(20);
    expect(lines.status).toBe("running");
    expect(lines.tallies).toBe("2/6");
    expect(lines.focus).toBe("tape");
    expect(lines.pointer).toBe("100, 200");
  });

  it("changes nothing it reports", () => {
    const { read } = registry();
    const watched = new Session();
    const quiet = new Session();
    createStateOps(watched).openChallenge("extras", 0);
    createStateOps(quiet).openChallenge("extras", 0);
    for (let frame = 0; frame < 30; frame += 1) {
      watched.update(1 / 60);
      read(watched.state);
      quiet.update(1 / 60);
    }
    expect(createStateOps(watched).snapshot()).toEqual(
      createStateOps(quiet).snapshot(),
    );
  });

  it("rests every run figure while there is no run", () => {
    const lines = registry().read(createState());
    expect(lines.status).toBe("—");
    expect(lines.cycle).toBe("—");
    expect(lines.fault).toBe("—");
    expect(lines.motes).toBe(0);
  });
});
