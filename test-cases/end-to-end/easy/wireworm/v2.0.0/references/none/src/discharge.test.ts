// Wireworm — the chain-arc discharge (specs/discharge.md).
//
// The chain is asserted as the LINK SET and the board it leaves, never as the
// lightning drawn over it: which pairs of tiles conduct is the rule, and the
// shape of the bolt between them is appearance.

import { describe, expect, test } from "vitest";
import {
  ARC_LIFE,
  CHARGE_MAX,
  CUES,
  DISCHARGE_RADIUS,
  SCORE_FRY,
  SCORE_PURGE_NODE,
} from "./constants";
import { detonate, isCritical } from "./discharge";
import { chargeAt, hasNode, setCharge } from "./field";
import { CueLog, layWorm, posedState } from "./harness.test-support";

describe("the chain", () => {
  test("the struck node is removed rather than knocked down", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    expect(isCritical(state, 10, 8)).toBe(true);
    detonate(state, 10, 8, new CueLog());
    expect(hasNode(state.field, 10, 8)).toBe(false);
  });

  test("the arc reaches a charged node two tiles away on the diagonal", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    setCharge(state.field, 12, 10, 1);
    detonate(state, 10, 8, new CueLog());
    expect(hasNode(state.field, 12, 10)).toBe(false);
  });

  test("a charged node three tiles out survives at its charge", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    setCharge(state.field, 13, 8, 1);
    detonate(state, 10, 8, new CueLog());
    expect(chargeAt(state.field, 13, 8)).toBe(1);
  });

  test("the chain runs onward from every node it detonates", () => {
    const state = posedState();
    setCharge(state.field, 4, 8, CHARGE_MAX);
    for (let step = 1; step <= 8; step += 1) {
      setCharge(state.field, 4 + step * DISCHARGE_RADIUS, 8, 1);
    }
    const result = detonate(state, 4, 8, new CueLog());
    expect(result.detonated).toHaveLength(9);
    for (let step = 0; step <= 8; step += 1) {
      expect(hasNode(state.field, 4 + step * DISCHARGE_RADIUS, 8)).toBe(false);
    }
  });

  test("an inert node inside the blast stands, and does not conduct", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    setCharge(state.field, 12, 8, 0);
    // Reachable only through the inert node, and three tiles from the blast.
    setCharge(state.field, 14, 8, 2);
    detonate(state, 10, 8, new CueLog());
    expect(chargeAt(state.field, 12, 8)).toBe(0);
    expect(chargeAt(state.field, 14, 8)).toBe(2);
  });

  test("a node is detonated at most once, so no link is reported twice", () => {
    const state = posedState();
    // A dense cluster: every node lies inside several blast radii.
    for (let c = 8; c <= 14; c += 1) {
      for (let r = 6; r <= 12; r += 1) setCharge(state.field, c, r, 2);
    }
    setCharge(state.field, 11, 9, CHARGE_MAX);
    const result = detonate(state, 11, 9, new CueLog());
    const seen = new Set(
      result.links.map(
        (link) => `${link.from.c},${link.from.r}->${link.to.c},${link.to.r}`,
      ),
    );
    expect(seen.size).toBe(result.links.length);
    // A chain that detonates n nodes conducts along n - 1 links.
    expect(result.links).toHaveLength(result.detonated.length - 1);
    expect(
      new Set(result.detonated.map((tile) => `${tile.c},${tile.r}`)).size,
    ).toBe(result.detonated.length);
  });

  test("each arc names the two tiles the link joined, and lasts ARC_LIFE", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    setCharge(state.field, 12, 8, 1);
    detonate(state, 10, 8, new CueLog());
    expect(state.arcs).toHaveLength(1);
    expect(state.arcs[0].from).toEqual({ c: 10, r: 8 });
    expect(state.arcs[0].to).toEqual({ c: 12, r: 8 });
    expect(state.arcs[0].life).toBeCloseTo(ARC_LIFE, 10);
    // The lightning is fixed when the arc is created and joins the two centers.
    const shape = state.arcs[0].shape;
    expect(shape.length).toBeGreaterThan(2);
    expect(shape[0]).toEqual({ x: 336, y: 352 });
    expect(shape[shape.length - 1]).toEqual({ x: 400, y: 352 });
  });

  test("the discharge sounds once", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    const cues = new CueLog();
    detonate(state, 10, 8, cues);
    expect(cues.count(CUES.discharge)).toBe(1);
  });
});

describe("what the discharge does to the worm", () => {
  test("a segment within two tiles of a detonated node is destroyed", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    layWorm(state, [[12, 8]]);
    const result = detonate(state, 10, 8, new CueLog());
    expect(result.fried).toBe(1);
    expect(state.worms).toEqual([]);
  });

  test("a segment three tiles out is left on its tile", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    layWorm(state, [[13, 8]]);
    detonate(state, 10, 8, new CueLog());
    expect(state.worms).toHaveLength(1);
    expect(state.worms[0].segments[0]).toEqual({ c: 13, r: 8 });
  });

  test("a fried segment leaves nothing behind", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    layWorm(state, [[12, 8]]);
    detonate(state, 10, 8, new CueLog());
    expect(hasNode(state.field, 12, 8)).toBe(false);
  });

  test("a discharge through a worm's middle leaves two worms", () => {
    const state = posedState();
    setCharge(state.field, 10, 14, CHARGE_MAX);
    const worm = layWorm(state, [
      [10, 4],
      [10, 6],
      [10, 8],
      [10, 13],
      [10, 15],
      [11, 18],
      [12, 18],
    ]);
    const was = worm.id;
    detonate(state, 10, 14, new CueLog());
    expect(state.worms).toHaveLength(2);
    // The piece carrying the old head keeps the id; the trailing one takes a new one.
    expect(state.worms[0].id).toBe(was);
    expect(state.worms[0].segments).toEqual([
      { c: 10, r: 4 },
      { c: 10, r: 6 },
      { c: 10, r: 8 },
    ]);
    expect(state.worms[1].id).not.toBe(was);
    expect(state.worms[1].segments).toEqual([
      { c: 11, r: 18 },
      { c: 12, r: 18 },
    ]);
  });
});

describe("what the discharge pays", () => {
  test("every node it removes pays the purge figure", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    setCharge(state.field, 12, 8, 1);
    setCharge(state.field, 14, 8, 1);
    setCharge(state.field, 16, 8, 1);
    setCharge(state.field, 18, 8, 1);
    setCharge(state.field, 20, 8, 1);
    const before = state.score;
    const result = detonate(state, 10, 8, new CueLog());
    expect(result.detonated).toHaveLength(6);
    expect(state.score - before).toBe(6 * SCORE_PURGE_NODE);
  });

  test("every segment it destroys pays the fry figure", () => {
    const state = posedState();
    setCharge(state.field, 10, 8, CHARGE_MAX);
    layWorm(state, [
      [11, 8],
      [12, 8],
      [11, 9],
    ]);
    const before = state.score;
    detonate(state, 10, 8, new CueLog());
    expect(state.score - before).toBe(SCORE_PURGE_NODE + 3 * SCORE_FRY);
  });
});
