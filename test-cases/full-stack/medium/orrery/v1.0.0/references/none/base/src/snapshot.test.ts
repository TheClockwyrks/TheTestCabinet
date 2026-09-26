import { describe, expect, it } from "vitest";

import { createStateOps } from "./debug";
import { Game } from "./game";
import { moleculeOut, partOut, snapshotOf } from "./snapshot";
import type { DragState } from "./types";

describe("the snapshot's derived and posed shapes", () => {
  it("reports each of the drag's three shapes", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 9);

    const place: DragState = {
      kind: "place",
      part: "piston",
      index: null,
      rotation: 2,
      length: 3,
      at: { q: 1, r: -1 },
      before: [],
    };
    game.state.editor.drag = place;
    expect((snapshotOf(game.state).editor as { drag: unknown }).drag).toEqual({
      kind: "place",
      part: "piston",
      index: null,
      rotation: 2,
      length: 3,
      at: { q: 1, r: -1 },
    });

    game.state.editor.drag = {
      kind: "move",
      part: 7,
      from: { q: 0, r: 0 },
      at: null,
      rotation: 0,
      length: 1,
      before: [],
    };
    expect((snapshotOf(game.state).editor as { drag: unknown }).drag).toEqual({
      kind: "move",
      part: 7,
      from: { q: 0, r: 0 },
      at: null,
    });

    game.state.editor.drag = {
      kind: "lay",
      part: 7,
      end: "first",
      before: [],
    };
    expect((snapshotOf(game.state).editor as { drag: unknown }).drag).toEqual({
      kind: "lay",
      part: 7,
      end: "first",
    });
  });

  it("reports a place drag over no hex as targeting null", () => {
    const game = new Game();
    game.state.editor.drag = {
      kind: "place",
      part: "arm",
      index: null,
      rotation: 0,
      length: 1,
      at: null,
      before: [],
    };
    const editor = snapshotOf(game.state).editor as {
      drag: { at: unknown };
    };
    expect(editor.drag.at).toBeNull();
  });

  it("writes a molecule as specs/formats.md writes one", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 9);
    const challenge = api.snapshot().challenge as {
      products: Record<string, unknown>[];
      reagents: Record<string, unknown>[];
    };
    expect(challenge.products[0].repeat).toEqual({
      vector: { q: 1, r: 0 },
      link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
    });
    expect(challenge.reagents[0]).not.toHaveProperty("repeat");
    expect(
      moleculeOut({
        motes: [{ q: 0, r: 0, type: "sol" }],
        filaments: [],
        repeat: null,
      }),
    ).toEqual({ motes: [{ q: 0, r: 0, type: "sol" }], filaments: [] });
  });

  it("reports a run's fault and metrics once they are set", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    const sim = game.state.sim;
    if (sim === null) throw new Error("no run");
    sim.status = "faulted";
    sim.fault = { kind: "collision", parts: [], motes: [3, 4] };
    sim.metrics = { cost: 20, cycles: 5, area: 2 };
    const reported = snapshotOf(game.state).sim as Record<string, unknown>;
    expect(reported.fault).toEqual({
      kind: "collision",
      parts: [],
      motes: [3, 4],
    });
    expect(reported.metrics).toEqual({ cost: 20, cycles: 5, area: 2 });
    expect(reported.poses).toEqual([
      {
        part: game.state.editor.parts[0].id,
        rotation: 0,
        length: 1,
        cell: { q: 0, r: 0 },
      },
    ]);
  });

  it("reports the title menu's remembered selection, whatever the screen", () => {
    const game = new Game();
    const api = createStateOps(game);
    expect(snapshotOf(game.state).titleIndex).toBe(0);
    api.setMenuIndex(1);
    game.handleAction("confirm");
    expect(snapshotOf(game.state).titleIndex).toBe(1);
    api.openChallenge("extras", 0);
    expect(snapshotOf(game.state).titleIndex).toBe(1);
  });

  it("keeps the armed menu press out of the shape, which is fixed", () => {
    const game = new Game();
    game.state.menuPress = 2;
    expect(snapshotOf(game.state)).not.toHaveProperty("menuPress");
  });

  it("copies a part out rather than handing over the one it holds", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 9);
    api.placeTrack(0, 0);
    const part = game.state.editor.parts[0];
    const copy = partOut(part);
    (copy.cells as { q: number }[])[0].q = 9;
    expect(part.cells?.[0].q).toBe(0);
  });
});
