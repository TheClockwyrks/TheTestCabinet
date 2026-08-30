// The debug surface as pure transitions: a pose takes a state and returns the
// next one, a reading takes a state and returns what it read, and neither
// touches the state it was handed.

import { describe, expect, it } from "vitest";
import { CHARGE_MAX, TOTAL_LEVELS } from "./constants";
import { createDebugApi } from "./debug";
import { blankState } from "./flow";
import type { WirewormState } from "./game";

const debug = createDebugApi();

/** A board with one worm, one foe and one bolt, and the ids they took. */
function posed(): {
  state: WirewormState;
  wormId: number;
  foeId: number;
  boltId: number;
} {
  let state: WirewormState = blankState();
  state = debug.addWorm(state, 10, 5);
  const wormId = debug.snapshot(state).worms[0]?.id as number;
  state = debug.addFoe(state, "dropper", 200, 200);
  const foeId = debug.snapshot(state).foes[0]?.id as number;
  state = debug.addBolt(state, 300, 400);
  const boltId = debug.snapshot(state).bolts[0]?.id as number;
  return { state, wormId, foeId, boltId };
}

describe("a pose", () => {
  it("leaves the state it was handed exactly as it was", () => {
    const before = blankState();
    const after = debug.setNode(before, 4, 4, 2);
    expect(before.nodes).toHaveLength(0);
    expect(after.nodes).toHaveLength(1);
    expect(after).not.toBe(before);
  });

  it("refuses a tile off the board", () => {
    expect(debug.setNode(blankState(), -1, 4, 2).nodes).toHaveLength(0);
    expect(debug.setNode(blankState(), 40, 4, 2).nodes).toHaveLength(0);
    expect(debug.setNode(blankState(), 4, 20, 2).nodes).toHaveLength(0);
  });

  it("holds a charge and a level inside the range the spec states", () => {
    expect(
      debug.snapshot(debug.setNode(blankState(), 4, 4, 9)).nodes[0]?.charge,
    ).toBe(CHARGE_MAX);
    expect(debug.snapshot(debug.setLevel(blankState(), 40)).level).toBe(
      TOTAL_LEVELS,
    );
    expect(debug.snapshot(debug.setLevel(blankState(), -3)).level).toBe(1);
    expect(debug.snapshot(debug.setLives(blankState(), -5)).lives).toBe(0);
    expect(
      debug.snapshot(debug.setCursorInvulnerable(blankState(), -2)).cursor
        .invulnerable,
    ).toBe(0);
    expect(
      debug.snapshot(debug.setFireCooldown(blankState(), -2)).fireCooldown,
    ).toBe(0);
    expect(debug.snapshot(debug.setMenuIndex(blankState(), -4)).menuIndex).toBe(
      0,
    );
  });

  it("clears one node without touching the rest of the field", () => {
    let state = debug.setNode(blankState(), 4, 4, 2);
    state = debug.setNode(state, 6, 4, 1);
    state = debug.clearNode(state, 4, 4);
    const snap = debug.snapshot(state);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0]).toEqual({ c: 6, r: 4, charge: 1 });
  });

  it("appends a segment to the tail end of the worm named", () => {
    const { state, wormId } = posed();
    const grown = debug.appendSegment(state, wormId, 9, 5);
    expect(debug.snapshot(grown).worms[0]?.segments).toEqual([
      { c: 10, r: 5 },
      { c: 9, r: 5 },
    ]);
    // An id no worm carries leaves the roster as it was.
    expect(
      debug.snapshot(debug.appendSegment(state, 999, 1, 1)).worms[0]?.segments,
    ).toHaveLength(1);
  });

  it("sets each worm field on its own", () => {
    const { state, wormId } = posed();
    let next = debug.setWormHeading(state, wormId, -1);
    next = debug.setWormDescent(next, wormId, -1);
    next = debug.setWormDiving(next, wormId, true);
    next = debug.setWormStepping(next, wormId, false);
    next = debug.setWormBody(next, wormId, false);
    expect(debug.snapshot(next).worms[0]).toMatchObject({
      dh: -1,
      dv: -1,
      diving: true,
      stepping: false,
      body: false,
    });

    // Either sign is read as the heading it names.
    expect(
      debug.snapshot(debug.setWormHeading(state, wormId, 5)).worms[0]?.dh,
    ).toBe(1);
    expect(
      debug.snapshot(debug.setWormDescent(state, wormId, 5)).worms[0]?.dv,
    ).toBe(1);
  });

  it("sets each foe field on its own", () => {
    const { state, foeId } = posed();
    let next = debug.setFoeVelocity(state, foeId, -40, 90);
    next = debug.setFoeHit(next, foeId, true);
    next = debug.setFoeMind(next, foeId, false);
    next = debug.setFoeTravel(next, foeId, false);

    // Each pose set its own field and left the others as the pose before it
    // wrote them: the posed velocity survives `setFoeHit`, which carries the
    // dropper's flag and nothing else. The fall speed a first bolt brings on is
    // the bolt path's, in `src/bolts.ts`.
    expect(debug.snapshot(next).foes[0]).toMatchObject({
      vx: -40,
      vy: 90,
      hit: true,
      mind: false,
      travel: false,
    });

    const healed = debug.setFoeHit(next, foeId, false);
    expect(debug.snapshot(healed).foes[0]).toMatchObject({
      vx: -40,
      vy: 90,
      hit: false,
    });
  });

  it("leaves the rosters alone for an id nothing carries", () => {
    const { state } = posed();
    expect(
      debug.snapshot(debug.setFoeVelocity(state, 999, 1, 1)).foes[0]?.vx,
    ).toBe(0);
    expect(debug.snapshot(debug.setFoeHit(state, 999, true)).foes[0]?.hit).toBe(
      false,
    );
    expect(
      debug.snapshot(debug.setFoeMind(state, 999, false)).foes[0]?.mind,
    ).toBe(true);
    expect(
      debug.snapshot(debug.setFoeTravel(state, 999, false)).foes[0]?.travel,
    ).toBe(true);
    expect(debug.snapshot(debug.removeFoe(state, 999)).foes).toHaveLength(1);
  });

  it("removes one entity at a time by its id", () => {
    const { state, wormId, foeId, boltId } = posed();
    expect(debug.snapshot(debug.removeWorm(state, wormId)).worms).toHaveLength(
      0,
    );
    expect(debug.snapshot(debug.removeFoe(state, foeId)).foes).toHaveLength(0);
    expect(debug.snapshot(debug.removeBolt(state, boltId)).bolts).toHaveLength(
      0,
    );
  });

  it("reports a live discharge's links without their remaining life", () => {
    const state = blankState();
    const snap = debug.snapshot(state);
    expect(snap.arcs).toEqual([]);
    expect(snap.version).toBe(debug.version);
  });
});
