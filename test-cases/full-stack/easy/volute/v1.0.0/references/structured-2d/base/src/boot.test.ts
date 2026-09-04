// The hall boots: the title level opens, its bodies carry their tags, the
// produced files arrive, and the surface reports the title-screen values.

import { describe, expect, it } from "vitest";
import { Core, Injector, Intake, Projectile } from "./actors";
import { CELLS, LEVELS, TAGS, WORLDS } from "./constants";
import {
  current,
  isolate,
  openLevel,
  poseTrain,
  run,
  useHarness,
} from "./harness";

useHarness();

describe("boot", () => {
  it("opens the title level with the hall standing behind it", () => {
    const h = current();
    expect(h.assetFailures).toEqual([]);
    expect(h.engine.world.level).toBe(WORLDS.title);

    // The tagged bodies the specification names are in place.
    expect(h.engine.world.byTag(TAGS.injector)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.intake)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.core)).toHaveLength(0);
    expect(h.engine.world.find(Injector)).toBeInstanceOf(Injector);
    expect(h.engine.world.find(Intake)).toBeInstanceOf(Intake);
  });

  it("reports the title-screen values the specification fixes", () => {
    const snapshot = current().snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toBe(0);
    expect(snapshot.level).toBe(1);
    expect(snapshot.cells).toBe(CELLS);
    expect(snapshot.quotaRemaining).toBe(LEVELS[0].quota);
    expect(snapshot.pressure).toBe(0);
    expect(snapshot.chainStep).toBe(1);
    expect(snapshot.machinery).toBeNull();
    expect(snapshot.train).toEqual([]);
    expect(snapshot.projectiles).toEqual([]);
    expect(snapshot.injector).toEqual({
      aim: 270,
      cooldown: 0,
      loaded: null,
      queued: null,
    });
    expect(snapshot.interlude).toBe(0);
    expect(snapshot.danger).toBe(false);
  });

  it("draws the hall, so the field is not left blank", async () => {
    const h = current();
    await h.engine.advance(1);
    // The channel plate runs through (320, 120); the field's own ground does
    // not, so the two differ.
    const plate = h.pixel(320, 120);
    const field = h.pixel(320, 270);
    expect(plate).not.toEqual(field);
  });

  it("hands every pose the same surface, whichever level is open", async () => {
    const h = current();
    expect(h.debug).toBe(h.engine.debug);
    await openLevel(h, 1);
    expect(h.debug).toBe(h.engine.debug);
    expect(h.engine.world.level).toBe(WORLDS.hall);
  });

  it("spawns the train's cores and shots as tagged actors", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, run(1000, 3, "halide"));
    h.debug.fire(90);
    expect(h.engine.world.byTag(TAGS.core)).toHaveLength(3);
    expect(h.engine.world.ofType(Core)).toHaveLength(3);
    expect(h.engine.world.byTag(TAGS.projectile)).toHaveLength(1);
    expect(h.engine.world.ofType(Projectile)).toHaveLength(1);
  });

  it("draws the engine's overlay over the named diagnostics, read-only", async () => {
    const h = current();
    await openLevel(h, 2);
    h.debug.grantMachinery("sightline");
    await h.engine.advance(1);
    const before = h.snapshot();

    // The backtick is the engine's own chrome, so the overlay toggles without a
    // registered action, and every source Volute named is read from there.
    h.tap("Backquote");
    await h.engine.advance(1);
    h.tap("Backquote");
    await h.engine.advance(1);

    const after = h.snapshot();
    expect(after.level).toBe(before.level);
    expect(after.machinery?.kind).toBe("sightline");
    expect(after.train).toHaveLength(before.train.length);
  });
});
