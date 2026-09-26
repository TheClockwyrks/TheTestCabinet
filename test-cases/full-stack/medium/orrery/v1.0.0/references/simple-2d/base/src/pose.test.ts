import { describe, expect, it } from "vitest";
import { HEX_PITCH } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { hexCenter } from "./hex";
import { drawnGrippers, drawnParts } from "./pose";
import { Session } from "./session";

/** A game with one challenge open, driven through the debug surface. */
function bench(): { game: Session; api: OrreryStateOps } {
  const game = new Session();
  const api = createStateOps(game);
  api.openChallenge("extras", 0);
  return { game, api };
}

describe("the pose a frame draws (specs/simulation.md)", () => {
  it("stands every arm and wheel at its rest pose while editing", () => {
    const { game, api } = bench();
    api.placePart("arm", 0, 0, 2);
    api.setPartLength(game.state.editor.parts[0].id, 3);
    const [drawn] = drawnParts(game.state);
    expect(drawn.base).toEqual(hexCenter({ q: 0, r: 0 }));
    expect(drawn.bearing).toBe(120);
    expect(drawn.length).toBe(3);
    expect(drawn.spokes).toEqual([2]);
    expect(drawn.holding).toEqual([]);
  });

  it("sweeps a rotation sixty degrees across the cycle", () => {
    const { game, api } = bench();
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.setTapeCell(arm, 0, "rotate-cw");
    api.startRun();
    api.setPaused(true);
    expect(drawnParts(game.state)[0].bearing).toBe(0);
    api.setPaused(false);
    game.update(0.5 / 3); // half a cycle at DEFAULT_SPEED_INDEX (3 cycles/s).
    expect(drawnParts(game.state)[0].bearing).toBeCloseTo(30, 5);
  });

  it("sweeps a piston's reach, and puts its gripper where the sweep says", () => {
    const { game, api } = bench();
    api.placePart("piston", 0, 0, 0);
    const piston = game.state.editor.parts[0].id;
    api.setTapeCell(piston, 0, "extend");
    api.startRun();
    game.update(0.5 / 3);
    const drawn = drawnParts(game.state)[0];
    expect(drawn.length).toBeCloseTo(1.5, 5);
    const [gripper] = drawnGrippers(drawn);
    expect(gripper.at.x).toBeCloseTo(
      hexCenter({ q: 0, r: 0 }).x + HEX_PITCH * 1.5,
      5,
    );
    expect(gripper.closed).toBe(false);
  });

  it("carries a mounted base toward the cell an advance leads to", () => {
    const { game, api } = bench();
    api.placeTrack(0, 0);
    const track = game.state.editor.parts[0].id;
    api.extendTrack(track, 1, 0);
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[1].id;
    api.setTapeCell(arm, 0, "advance");
    api.startRun();
    game.update(0.5 / 3);
    const drawn = drawnParts(game.state)[0];
    const from = hexCenter({ q: 0, r: 0 });
    const to = hexCenter({ q: 1, r: 0 });
    expect(drawn.base.x).toBeCloseTo((from.x + to.x) / 2, 5);
  });

  it("draws a gripper closed exactly while it holds a mote", () => {
    const { game, api } = bench();
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.startRun();
    api.clearMotes();
    api.spawnMote(1, 0, "dust");
    const mote = game.state.sim?.motes[0].id ?? 0;
    expect(drawnGrippers(drawnParts(game.state)[0])[0].closed).toBe(false);
    api.setGrip(arm, 0, mote);
    expect(drawnGrippers(drawnParts(game.state)[0])[0].closed).toBe(true);
    api.releaseGrip(arm, 0);
    expect(drawnGrippers(drawnParts(game.state)[0])[0].closed).toBe(false);
  });

  it("gives a hexarm six grippers, one per spoke", () => {
    const { game, api } = bench();
    api.placePart("hexarm", 0, 0, 0);
    const drawn = drawnParts(game.state)[0];
    expect(drawn.spokes).toEqual([0, 1, 2, 3, 4, 5]);
    const bearings = drawnGrippers(drawn).map((gripper) => gripper.bearing);
    expect(bearings).toEqual([0, 60, 120, 180, 240, 300]);
  });
});
