// The surface's own edges: what each removal takes away, what a pose fails
// loudly on, and the guard the action registration puts on the engine it is
// given.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InitApi } from "@clockwyrks/structured-2d";
import {
  CHARGE_MAX,
  LAYOUT,
  TOTAL_LEVELS,
  tileCX,
  tileCY,
  wormLength,
  wormStepInterval,
} from "./constants";
import { createHarness, poseWorm, startPlaying, type Harness } from "./harness";
import { registerActions } from "./input";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("removing what a scenario is done with", () => {
  it("takes one entity by its id, and leaves the rest", () => {
    startPlaying(h.debug);
    const first = poseWorm(h.debug, 8, 6, 2);
    const second = poseWorm(h.debug, 20, 6, 2);
    h.debug.addFoe("glitch", 300, 300);
    h.debug.addFoe("dropper", 400, 200);
    h.debug.addBolt(500, 400);
    h.debug.addBolt(600, 400);
    const before = h.debug.snapshot();

    h.debug.removeWorm(first);
    h.debug.removeFoe(before.foes[0].id);
    h.debug.removeBolt(before.bolts[0].id);
    const after = h.debug.snapshot();
    expect(after.worms.map((worm) => worm.id)).toEqual([second]);
    expect(after.foes.map((foe) => foe.kind)).toEqual(["dropper"]);
    expect(after.bolts.map((bolt) => bolt.id)).toEqual([before.bolts[1].id]);
  });

  it("empties one roster at a time, leaving the others standing", () => {
    startPlaying(h.debug);
    h.debug.setNode(3, 3, 1);
    poseWorm(h.debug, 8, 6, 2);
    h.debug.addFoe("glitch", 300, 300);
    h.debug.addBolt(500, 400);

    h.debug.clearBolts();
    expect(h.debug.snapshot().bolts).toHaveLength(0);
    expect(h.debug.snapshot().worms).toHaveLength(1);
    h.debug.clearFoes();
    expect(h.debug.snapshot().foes).toHaveLength(0);
    expect(h.debug.snapshot().nodes).toHaveLength(1);
    h.debug.clearWorms();
    expect(h.debug.snapshot().worms).toHaveLength(0);
    expect(h.debug.snapshot().nodes).toHaveLength(1);
    h.debug.clearNodes();
    expect(h.debug.snapshot().nodes).toHaveLength(0);
  });

  it("clears one node, leaving its tile empty", () => {
    startPlaying(h.debug);
    h.debug.setNode(3, 3, 2);
    h.debug.setNode(4, 3, 2);
    h.debug.clearNode(3, 3);
    expect(h.debug.snapshot().nodes).toEqual([{ c: 4, r: 3, charge: 2 }]);
  });

  it("fails loudly for an id no entity carries", () => {
    startPlaying(h.debug);
    const id = poseWorm(h.debug, 8, 6, 2);
    expect(() => h.debug.removeWorm(id + 999)).toThrow(RangeError);
    expect(() => h.debug.removeFoe(id + 999)).toThrow(RangeError);
    expect(() => h.debug.removeBolt(id + 999)).toThrow(RangeError);
    expect(() => h.debug.setWormHeading(id + 999, -1)).toThrow(RangeError);
    expect(() => h.debug.setFoeVelocity(id + 999, 1, 1)).toThrow(RangeError);
    expect(() => h.debug.setFoeHit(id + 999, true)).toThrow(RangeError);
    expect(() => h.debug.setFoeMind(id + 999, false)).toThrow(RangeError);
    expect(() => h.debug.setFoeTravel(id + 999, false)).toThrow(RangeError);
    expect(() => h.debug.appendSegment(id + 999, 1, 1)).toThrow(RangeError);
    expect(h.debug.snapshot().worms).toHaveLength(1);
  });
});

describe("what a pose fails loudly on", () => {
  it("a charge outside the field's own range", () => {
    startPlaying(h.debug);
    expect(() => h.debug.setNode(5, 5, CHARGE_MAX + 1)).toThrow(RangeError);
    expect(() => h.debug.setNode(5, 5, -4)).toThrow(RangeError);
    // The scale's own ends are inside the domain and land.
    h.debug.setNode(5, 5, CHARGE_MAX);
    expect(h.debug.snapshot().nodes[0].charge).toBe(CHARGE_MAX);
    h.debug.clearNode(5, 5);
    expect(h.debug.snapshot().nodes).toHaveLength(0);
  });

  it("a tile off the board", () => {
    startPlaying(h.debug);
    expect(() => h.debug.setNode(-1, 5, 2)).toThrow(RangeError);
    expect(() => h.debug.setNode(5, 40, 2)).toThrow(RangeError);
    expect(() => h.debug.clearNode(-1, 5)).toThrow(RangeError);
    expect(h.debug.snapshot().nodes).toHaveLength(0);
  });

  it("a level outside the run", () => {
    startPlaying(h.debug);
    expect(() => h.debug.setLevel(TOTAL_LEVELS + 1)).toThrow(RangeError);
    expect(() => h.debug.setLevel(0)).toThrow(RangeError);
    expect(h.debug.snapshot().level).toBe(1);
  });

  it("a cursor position outside the band", () => {
    startPlaying(h.debug);
    // The band is the operation's domain, so the pose fails loudly rather than
    // landing the cursor on the nearest bound and reading back a position the
    // caller never posed.
    expect(() => h.debug.setCursor(-90, 900)).toThrow(RangeError);
  });

  it("but takes a value the specs fix no bound on exactly as given", () => {
    startPlaying(h.debug);
    h.debug.setCursorInvulnerable(-3);
    h.debug.setFireCooldown(-3);
    const shot = h.debug.snapshot();
    expect(shot.cursor.invulnerable).toBe(-3);
    expect(shot.fireCooldown).toBe(-3);
  });

  it("reconcile re-derives a reading and advances nothing", () => {
    startPlaying(h.debug);
    h.debug.setLevel(7);
    h.debug.reconcile();
    const once = h.debug.snapshot();
    expect(once.wormStepInterval).toBeCloseTo(wormStepInterval(7), 10);
    expect(once.wormLength).toBe(wormLength(7));
    h.debug.reconcile();
    // Twice is once, and no clock moved.
    expect(h.debug.snapshot()).toEqual(once);
  });

  it("appends a segment to the tail end of the worm it names", () => {
    startPlaying(h.debug);
    const id = poseWorm(h.debug, 8, 6, 1);
    h.debug.appendSegment(id, 7, 6);
    h.debug.appendSegment(id, 6, 6);
    expect(h.debug.snapshot().worms[0].segments).toEqual([
      { c: 8, r: 6 },
      { c: 7, r: 6 },
      { c: 6, r: 6 },
    ]);
  });

  it("adds a bolt that then resolves through the game's own shot rules", async () => {
    startPlaying(h.debug);
    h.debug.setNode(8, 6, 0);
    h.debug.addBolt(tileCX(8), tileCY(6));
    await h.advance(1);
    expect(h.debug.snapshot().nodes).toHaveLength(0);
    expect(h.debug.snapshot().bolts).toHaveLength(0);
  });
});

describe("the actions the build registers", () => {
  it("refuses an engine built without the layout the game is written for", () => {
    const registered: string[] = [];
    const api = (layout: string | null): Pick<InitApi, "input"> => ({
      input: {
        register: (name: string) => registered.push(name),
        layout: () => (layout === null ? null : { name: layout, actions: [] }),
      },
    });
    expect(() => registerActions(api(null))).toThrow(LAYOUT);
    expect(() => registerActions(api("dpad-4"))).toThrow("dpad-4");
    expect(registered).toHaveLength(0);
    registerActions(api(LAYOUT));
    expect(registered).toContain("mute");
  });
});
