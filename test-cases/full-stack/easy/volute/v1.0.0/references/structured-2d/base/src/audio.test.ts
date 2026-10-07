// The produced sound (specs/ui.md "Audio", specs/assets.md "The sound"): that
// every cue is bound to its produced file, that each sounds on the tick its event
// happens and at most once on that tick, and that exactly one bed loops under a
// run in play.

import { describe, expect, it } from "vitest";
import { CUES, LOOPING_CUES, PATH_LENGTH } from "./constants";
import type { CueName } from "./constants";
import {
  current,
  isolate,
  onLowerLeg,
  openLevel,
  poseTrain,
  seatAhead,
  useHarness,
  type Harness,
} from "./harness";

useHarness();

/** The cues sounded since the mark, in order. */
function since(h: Harness, mark: number): string[] {
  return h.cues.slice(mark).map((play) => play.cue);
}

/** How many distinct ticks the cues since the mark were spread over. */
function ticks(h: Harness, mark: number): number {
  return new Set(h.cues.slice(mark).map((play) => play.t)).size;
}

describe("the cues", () => {
  it("binds every one of the fifteen to its produced file", () => {
    const h = current();
    expect(h.assetFailures).toEqual([]);
    for (const cue of Object.values(CUES)) {
      expect(h.engine.world.audio.looping(cue)).toBe(false);
    }
  });

  it("sounds the injector on the tick it fires, and on no tick before", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    await h.engine.advance(30);

    const mark = h.cues.length;
    await h.engine.advance(30);
    expect(since(h, mark)).toEqual([]);

    h.debug.setAim(270);
    h.debug.fire();
    await h.engine.advance(1);
    expect(since(h, mark)).toEqual([CUES.fire]);
  });

  it("sounds a refused shot as a refusal", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.setAim(270);
    h.debug.fire();
    await h.engine.advance(1);

    const mark = h.cues.length;
    h.tap("Space");
    await h.engine.advance(1);
    expect(since(h, mark)).toEqual([CUES.denied]);
  });

  it("sounds the swap on the swap control", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    const mark = h.cues.length;
    h.tap("KeyX");
    await h.engine.advance(1);
    expect(since(h, mark)).toContain(CUES.swap);
  });

  it("sounds the seat and the extraction on the tick a run is drawn out", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - 28, "halide", null],
      [1000, "garnet", null],
    ]);
    const mark = h.cues.length;
    await seatAhead("halide");

    const sounded = since(h, mark);
    expect(sounded).toContain(CUES.seat);
    expect(sounded).toContain(CUES.extract1);
    // The seat and the extraction resolve on one tick, and each sounds once.
    expect(sounded.filter((cue) => cue === CUES.extract1)).toHaveLength(1);
  });

  it("sounds a chained extraction one step higher", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - 28, "halide", null],
      [onLowerLeg(400) - 56, "cobalt", null],
      [onLowerLeg(400) - 84, "cobalt", null],
      [onLowerLeg(400) - 84 - 100, "cobalt", null],
      [1000, "garnet", null],
    ]);
    await seatAhead("halide");
    const mark = h.cues.length;
    await h.engine.advance(90);
    expect(since(h, mark)).toContain(CUES.extract2);
  });

  it("sounds the machinery on a grant", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    const mark = h.cues.length;
    h.debug.grantMachinery("choke");
    await h.engine.advance(1);
    expect(since(h, mark)).toContain(CUES.machinery);
  });

  it("sounds the intake and the lost cell on the tick a cell is spent", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setQuotaRemaining(0);
    h.debug.clearTrain();
    poseTrain(h, [[PATH_LENGTH - 20, "halide", null]]);
    const mark = h.cues.length;
    for (let i = 0; i < 120; i += 1) {
      await h.engine.advance(1);
      if (h.snapshot().screen === "setback") break;
    }
    const sounded = since(h, mark);
    expect(sounded).toContain(CUES.intake);
    expect(sounded).toContain(CUES.cellLost);
    expect(ticks(h, mark)).toBe(1);
  });

  it("sounds the clear on the tick a level is cleared", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - 28, "halide", null],
    ]);
    const mark = h.cues.length;
    await seatAhead("halide");
    expect(since(h, mark)).toContain(CUES.levelClear);
  });
});

describe("the music beds", () => {
  /** Which of the two beds is looping right now. */
  function bed(h: Harness): CueName | null {
    for (const cue of LOOPING_CUES) {
      if (h.engine.world.audio.looping(cue)) return cue;
    }
    return null;
  }

  it("loops neither bed on the title", async () => {
    const h = current();
    await h.engine.advance(5);
    expect(bed(h)).toBeNull();
  });

  it("loops the hall bed under a run in play", async () => {
    const h = current();
    await openLevel(h, 1);
    await h.engine.advance(1);
    expect(bed(h)).toBe(CUES.hallLoop);
  });

  it("swaps to the danger bed on the tick the hall turns dangerous", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    await h.engine.advance(1);
    expect(bed(h)).toBe(CUES.hallLoop);

    poseTrain(h, [[4500, "halide", null]]);
    await h.engine.advance(1);
    expect(bed(h)).toBe(CUES.dangerLoop);

    poseTrain(h, [[1000, "halide", null]]);
    await h.engine.advance(1);
    expect(bed(h)).toBe(CUES.hallLoop);
  });

  it("stops both beds on a screen that is not the hall in play", async () => {
    const h = current();
    await openLevel(h, 1);
    await h.engine.advance(1);
    expect(bed(h)).toBe(CUES.hallLoop);

    h.debug.pause();
    await h.engine.advance(1);
    expect(bed(h)).toBeNull();
  });

  it("keeps looping while muted", async () => {
    const h = current();
    await openLevel(h, 1);
    await h.engine.advance(1);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.snapshot().muted).toBe(true);
    expect(bed(h)).toBe(CUES.hallLoop);
  });
});
