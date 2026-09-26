import { describe, expect, it } from "vitest";

import { DEFAULT_SPEED_INDEX, SPEEDS } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { Session } from "./session";

/** A game holding Extras 1 (First Light), with the surface over it. */
function opened(): { game: Session; api: OrreryStateOps } {
  const game = new Session();
  const api = createStateOps(game);
  api.openChallenge("extras", 0);
  return { game, api };
}

describe("starting and stopping a run (specs/simulation.md)", () => {
  it("starts at cycle 0, fraction 0, the default speed, and no fault", () => {
    const { game, api } = opened();
    api.startRun();
    expect(game.state.sim).not.toBeNull();
    expect(game.state.sim?.status).toBe("running");
    expect(game.state.sim?.cycle).toBe(0);
    expect(game.state.sim?.fraction).toBe(0);
    expect(game.state.sim?.speed).toBe(DEFAULT_SPEED_INDEX);
    expect(game.state.sim?.fault).toBeNull();
    expect(game.state.sim?.metrics).toBeNull();
  });

  it("takes every arm and wheel to its rest pose, holding nothing", () => {
    const { game, api } = opened();
    api.placePart("biarm", 0, 0, 2);
    api.setPartLength(game.state.editor.parts[0].id, 3);
    api.startRun();
    expect(game.state.sim?.poses).toEqual([
      {
        part: game.state.editor.parts[0].id,
        rotation: 2,
        length: 3,
        cell: { q: 0, r: 0 },
      },
    ]);
    expect(game.state.sim?.grips).toEqual([]);
  });

  it("raises a wheel's six fixtures in the WHEEL_MOTES ring for its rotation", () => {
    const { game, api } = opened();
    api.placePart("wheel", 0, 0, 1);
    api.startRun();
    const wheel = game.state.editor.parts[0].id;
    const fixtures = game.state.sim?.motes ?? [];
    expect(fixtures).toHaveLength(6);
    expect(fixtures.every((mote) => mote.wheel === wheel)).toBe(true);
    // The fixture on spoke `d` is the ring entry for `d - rotation`.
    expect(fixtures[0].type).toBe("dust");
    expect(fixtures[1].type).toBe("nebula");
    expect(fixtures[2].type).toBe("comet");
  });

  it("banks every hex of every part, every fixture, and every gripper at rest", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    // The anchor and the one gripper hex.
    expect(game.state.sim?.areaHexes).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
  });

  it("hands the machine back to the editor when the run stops", () => {
    const { game, api } = opened();
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.stopRun();
    expect(game.state.sim).toBeNull();
    expect(game.state.editor.parts).toHaveLength(1);
  });

  it("throws with no challenge open", () => {
    const game = new Session();
    expect(() => createStateOps(game).startRun()).toThrow(/no challenge/);
  });
});

describe("the clock (specs/simulation.md, specs/instrumentation.md)", () => {
  it("reaches the same state however the interval was divided into frames", () => {
    const one = opened();
    one.api.startRun();
    one.game.update(1);

    const many = opened();
    many.api.startRun();
    for (let frame = 0; frame < 60; frame += 1) many.game.update(1 / 60);

    expect(one.game.state.sim?.cycle).toBe(SPEEDS[DEFAULT_SPEED_INDEX]);
    expect(many.game.state.sim?.cycle).toBe(one.game.state.sim?.cycle);
    expect(many.game.state.sim?.fraction).toBeCloseTo(
      one.game.state.sim?.fraction ?? -1,
      9,
    );
  });

  it("advances by SPEEDS[speed] cycles per second of game time", () => {
    const { game, api } = opened();
    api.startRun();
    api.setSpeed(0);
    game.update(2);
    expect(game.state.sim?.cycle).toBe(2);
    api.setSpeed(3);
    game.update(1);
    expect(game.state.sim?.cycle).toBe(32);
  });

  it("carries the excess of a frame into the next cycle", () => {
    const { game, api } = opened();
    api.startRun();
    api.setSpeed(0);
    game.update(1.5);
    expect(game.state.sim?.cycle).toBe(1);
    expect(game.state.sim?.fraction).toBeCloseTo(0.5, 9);
  });

  it("holds the fraction where it stands while paused", () => {
    const { game, api } = opened();
    api.startRun();
    api.setSpeed(0);
    game.update(0.25);
    api.setPaused(true);
    game.update(10);
    expect(game.state.sim?.fraction).toBeCloseTo(0.25, 9);
    expect(game.state.sim?.cycle).toBe(0);
    api.setPaused(false);
    game.update(0.75);
    expect(game.state.sim?.cycle).toBe(1);
  });

  it("accumulates simTime on every update, whatever the screen", () => {
    const { game, api } = opened();
    game.update(0.5);
    api.setScreen("title");
    game.update(0.5);
    expect(game.state.simTime).toBeCloseTo(1, 9);
  });

  it("ignores a frame that measured no time", () => {
    const { game, api } = opened();
    api.startRun();
    game.update(0);
    game.update(Number.NaN);
    expect(game.state.sim?.cycle).toBe(0);
    expect(game.state.simTime).toBe(0);
  });
});

describe("completion and metrics (specs/simulation.md)", () => {
  /** Extras 1 with its set placed, its run live, and its tally satisfied. */
  function satisfied(): { game: Session; api: OrreryStateOps } {
    const opened = new Session();
    const api = createStateOps(opened);
    api.openChallenge("extras", 0);
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    return { game: opened, api };
  }

  it("completes at a boundary where every placed set has reached the target", () => {
    const { game } = satisfied();
    game.update(1);
    expect(game.state.sim?.status).toBe("complete");
    expect(game.state.sim?.metrics).toEqual({ cost: 0, cycles: 1, area: 1 });
    expect(game.state.sim?.fraction).toBe(0);
  });

  it("marks the challenge solved and records its three metrics", () => {
    const { game } = satisfied();
    game.update(1);
    expect(game.state.extrasSolved).toEqual([0]);
    expect(game.state.extrasRecords[0]).toEqual({
      cost: 0,
      cycles: 1,
      area: 1,
    });
  });

  it("lowers each record independently across replays", () => {
    const { game, api } = satisfied();
    game.update(1);
    api.setRecord("extras", 0, "cost", 10);
    api.setRecord("extras", 0, "cycles", 1);
    api.setRecord("extras", 0, "area", 1);
    api.stopRun();
    api.placePart("hexarm", 3, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.update(1);
    expect(game.state.extrasRecords[0]).toEqual({
      cost: 10,
      cycles: 1,
      area: 1,
    });
  });

  it("never completes a machine holding no set", () => {
    const { game, api } = opened();
    api.startRun();
    api.setTally(0, 99);
    game.update(1);
    expect(game.state.sim?.status).toBe("running");
  });

  it("carries the run past a satisfied target while the switch is off", () => {
    const { game, api } = satisfied();
    api.setCompletion(false);
    game.update(1);
    expect(game.state.sim?.status).toBe("running");
    expect(game.state.sim?.metrics).toBeNull();
    expect(game.state.extrasSolved).toEqual([]);
    expect(game.state.extrasRecords[0]).toBeNull();
  });

  it("completes at the first boundary after the switch comes back on", () => {
    const { game, api } = satisfied();
    api.setCompletion(false);
    game.update(1);
    api.setCompletion(true);
    const before = game.state.sim?.cycle ?? 0;
    game.update(1 / SPEEDS[DEFAULT_SPEED_INDEX]);
    expect(game.state.sim?.status).toBe("complete");
    expect(game.state.sim?.metrics?.cycles).toBe(before + 1);
  });

  it("touches no progress for a challenge loaded directly", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.loadChallenge({
      name: "Posed",
      reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      permitted: ["arm"],
      target: 1,
    });
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    api.setTally(0, 1);
    game.update(1);
    expect(game.state.sim?.status).toBe("complete");
    expect(game.state.extrasSolved).toEqual([]);
    expect(game.state.campaignSolved).toEqual([]);
    expect(game.state.unlockedCount).toBe(1);
  });
});
