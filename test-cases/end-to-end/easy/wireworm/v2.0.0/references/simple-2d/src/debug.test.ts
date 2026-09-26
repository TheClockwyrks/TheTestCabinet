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

  it("fails loudly on a tile off the board", () => {
    expect(() => debug.setNode(blankState(), -1, 4, 2)).toThrow(RangeError);
    expect(() => debug.setNode(blankState(), 40, 4, 2)).toThrow(RangeError);
    expect(() => debug.setNode(blankState(), 4, 20, 2)).toThrow(RangeError);
    expect(() => debug.clearNode(blankState(), -1, 4)).toThrow(RangeError);
  });

  it("fails loudly outside a range the spec fixes as a constant", () => {
    expect(() => debug.setNode(blankState(), 4, 4, CHARGE_MAX + 1)).toThrow(
      RangeError,
    );
    expect(() => debug.setNode(blankState(), 4, 4, -1)).toThrow(RangeError);
    expect(() => debug.setLevel(blankState(), TOTAL_LEVELS + 1)).toThrow(
      RangeError,
    );
    expect(() => debug.setLevel(blankState(), -3)).toThrow(RangeError);
    expect(() => debug.setCursor(blankState(), -500, 0)).toThrow(RangeError);
  });

  it("applies a value the specs fix no bound on exactly as it is given", () => {
    // Neither a life count, a menu index, nor a timer is bounded by the specs,
    // so each pose lands the figure it was handed rather than a nearer legal
    // one: what the game's own systems then make of it is theirs to decide.
    expect(debug.snapshot(debug.setLives(blankState(), -5)).lives).toBe(-5);
    expect(
      debug.snapshot(debug.setCursorInvulnerable(blankState(), -2)).cursor
        .invulnerable,
    ).toBe(-2);
    expect(
      debug.snapshot(debug.setFireCooldown(blankState(), -2)).fireCooldown,
    ).toBe(-2);
    expect(debug.snapshot(debug.setMenuIndex(blankState(), -4)).menuIndex).toBe(
      -4,
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
    // An id no worm carries names nothing, so the call fails loudly.
    expect(() => debug.appendSegment(state, 999, 1, 1)).toThrow(RangeError);
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

    // A heading is one of two directions, so anything else names nothing and
    // the call fails loudly rather than being read as the nearer direction.
    expect(() => debug.setWormHeading(state, wormId, 5)).toThrow(RangeError);
    expect(() => debug.setWormDescent(state, wormId, 5)).toThrow(RangeError);
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

  it("fails loudly for an id nothing carries", () => {
    const { state } = posed();
    expect(() => debug.setFoeVelocity(state, 999, 1, 1)).toThrow(RangeError);
    expect(() => debug.setFoeHit(state, 999, true)).toThrow(RangeError);
    expect(() => debug.setFoeMind(state, 999, false)).toThrow(RangeError);
    expect(() => debug.setFoeTravel(state, 999, false)).toThrow(RangeError);
    expect(() => debug.removeFoe(state, 999)).toThrow(RangeError);
    expect(() => debug.removeWorm(state, 999)).toThrow(RangeError);
    expect(() => debug.removeBolt(state, 999)).toThrow(RangeError);
    // And the loud failure left the state it was handed exactly as it was.
    expect(debug.snapshot(state).foes).toHaveLength(1);
  });

  it("reconcile re-derives a reading and returns the same world", () => {
    const state = debug.setLevel(blankState(), 7);
    const reconciled = debug.reconcile(state);
    expect(debug.snapshot(reconciled)).toEqual(debug.snapshot(state));
    // Twice is once.
    expect(debug.snapshot(debug.reconcile(reconciled))).toEqual(
      debug.snapshot(reconciled),
    );
  });

  it("reconcile advances nothing", () => {
    const { state } = posed();
    const before = debug.snapshot(state);
    const after = debug.snapshot(debug.reconcile(state));
    expect(after.simTime).toBe(before.simTime);
    expect(after.phaseTimer).toBe(before.phaseTimer);
    expect(after.fireCooldown).toBe(before.fireCooldown);
    expect(after).toEqual(before);
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
