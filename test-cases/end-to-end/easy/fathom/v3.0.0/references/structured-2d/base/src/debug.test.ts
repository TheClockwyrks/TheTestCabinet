// Fathom — the debugging and automation surface, driven off the engine.
//
// Every operation is reached the one way a caller reaches it, as `engine.debug`,
// and every claim is read back through the surface's own `snapshot`. What each
// test asserts is the contract `specs/instrumentation.md` and `specs/state.md`
// fix, written out here rather than imported from the code under test.

import { describe, expect, it } from "vitest";
import {
  BRIGHT_HOLD,
  DEN_RELEASE_GAP,
  DRIFTER_MAX,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_COOLDOWN,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  ROSTER_CAP,
  SCORE_PLANKTON,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  START_LIVES,
  TICK_HZ,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import { stampLayout } from "./fixtures";
import { createHarness, type Harness } from "./harness";
import { DEN, HALL, SPINE, at, minds, pose } from "./scenarios";

function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** In live play with the roster the maze laid out, every mind held still. */
async function playing(): Promise<Harness> {
  const harness = await createHarness();
  harness.debug.setScreen("playing");
  minds(harness.debug, false);
  return harness;
}

/** In live play over an empty world: no predator, no drifter, no plankton. */
async function alone(): Promise<Harness> {
  const harness = await createHarness();
  harness.debug.setScreen("playing");
  harness.debug.clearPredators();
  harness.debug.clearDrifters();
  harness.debug.clearPlankton();
  return harness;
}

describe("the snapshot", () => {
  it("reports every field the state contract names", async () => {
    const harness = await playing();
    // Two tiles clear of the forager, and still, so nothing eats it before it
    // is read.
    harness.debug.spawnDrifter(19, 15);
    harness.debug.setDrifterMind(0, false);
    await harness.engine.advance(2);
    const snapshot = harness.debug.snapshot();

    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("playing");
    expect(typeof snapshot.depth).toBe("number");
    expect(typeof snapshot.score).toBe("number");
    expect(typeof snapshot.lives).toBe("number");
    expect(typeof snapshot.muted).toBe("boolean");
    expect(typeof snapshot.planktonRemaining).toBe("number");
    expect(typeof snapshot.brightness).toBe("number");
    expect(typeof snapshot.brightHold).toBe("number");
    expect(typeof snapshot.visionRadius).toBe("number");
    expect(snapshot.sonar).toEqual({
      ready: expect.any(Boolean) as boolean,
      cooldown: expect.any(Number) as number,
      range: expect.any(Number) as number,
    });
    expect(snapshot.ink).toEqual({
      ready: expect.any(Boolean) as boolean,
      cooldown: expect.any(Number) as number,
    });
    expect(snapshot.grid).toEqual({
      cols: GRID_COLS,
      rows: GRID_ROWS,
      tile: TILE,
      originX: GRID_ORIGIN_X,
      originY: GRID_ORIGIN_Y,
    });
    expect(snapshot.tiles).toHaveLength(GRID_ROWS);
    expect(snapshot.tiles.every((row) => row.length === GRID_COLS)).toBe(true);
    expect(snapshot.tiles.join("")).toMatch(/^[#.gd]+$/);
    expect(snapshot.plankton).toHaveLength(GRID_ROWS);
    expect(snapshot.plankton.every((row) => row.length === GRID_COLS)).toBe(
      true,
    );
    expect(snapshot.plankton.join("")).toMatch(/^[*-]+$/);
    // The layer carries exactly the plankton the count reports, and carries
    // none on rock, on the gate or in the den.
    expect(
      snapshot.plankton
        .join("")
        .split("")
        .filter((mark) => mark === "*").length,
    ).toBe(snapshot.planktonRemaining);
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        if (snapshot.tiles[ty][tx] === ".") continue;
        expect(snapshot.plankton[ty][tx]).toBe("-");
      }
    }
    expect(snapshot.visibility).toHaveLength(GRID_ROWS);
    expect(snapshot.visibility.join("")).toMatch(/^[url]+$/);
    expect(snapshot.forager.dir).toMatch(/^(up|down|left|right)$/);
    expect(typeof snapshot.forager.moving).toBe("boolean");
    expect(snapshot.drifters).toHaveLength(1);
    expect(typeof snapshot.drifters[0].lit).toBe("boolean");
    expect(snapshot.drifters[0].mind).toBe(false);
    expect(snapshot.drifters[0].travel).toBe(true);
    expect(typeof snapshot.simTime).toBe("number");

    // A field a kind does not carry reports null rather than going missing.
    const [lanternjaw, gloamfin, flarefish] = snapshot.predators;
    expect(lanternjaw.kind).toBe("lanternjaw");
    expect(lanternjaw.mind).toBe(false);
    expect(lanternjaw.travel).toBe(true);
    expect(lanternjaw.hearingRange).toBeNull();
    expect(lanternjaw.hearingLock).toBeNull();
    expect(lanternjaw.flaring).toBeNull();
    expect(lanternjaw.detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * snapshot.brightness,
      6,
    );
    expect(gloamfin.detectRange).toBeNull();
    expect(gloamfin.hearingRange).toBe(GLOAMFIN_HEAR);
    expect(gloamfin.hearingLock).toBe(false);
    expect(flarefish.flareCharging).toBe(false);
    expect(flarefish.flaring).toBe(false);
    expect(flarefish.flareRadius).toBe(0);
    expect(flarefish.hearingRange).toBeNull();

    // It is JSON-serializable, and it is a pure read.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(harness.debug.snapshot()).toEqual(snapshot);
    harness.dispose();
  });

  it("lists the roster in release order, and grows it with the depth", async () => {
    const harness = await playing();
    expect(harness.debug.snapshot().predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
    ]);

    harness.debug.setDepth(2);
    expect(harness.debug.snapshot().predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
    ]);

    harness.debug.setDepth(9);
    const deep = harness.debug.snapshot();
    expect(deep.predators).toHaveLength(3 * ROSTER_CAP);
    expect(deep.sonar.range).toBe(SONAR_RANGE_MIN);
    harness.dispose();
  });

  it("derives the light radius and the detection ranges from the brightness", async () => {
    const harness = await playing();
    harness.debug.setBrightness(0);
    expect(harness.debug.snapshot().visionRadius).toBeCloseTo(VISION_MIN, 6);
    expect(harness.debug.snapshot().predators[0].detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE,
      6,
    );

    harness.debug.setBrightness(1);
    const bright = harness.debug.snapshot();
    expect(bright.brightness).toBe(1);
    expect(bright.visionRadius).toBeCloseTo(VISION_MIN + VISION_GAIN, 6);
    expect(bright.predators[0].detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN,
      6,
    );
    expect(bright.predators[2].detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN,
      6,
    );
    harness.dispose();
  });
});

describe("reset", () => {
  it("restores the title-screen values", async () => {
    const harness = await playing();
    harness.debug.setBrightness(1);
    harness.debug.setBrightHold(BRIGHT_HOLD);
    harness.debug.setDepth(4);
    harness.debug.setSonarCooldown(1);
    harness.debug.clearPlankton();
    harness.debug.spawnDrifter(17, 15);
    await harness.engine.advance(ticks(1));
    await harness.tap("KeyM");

    harness.debug.reset();
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toBe(0);
    expect(snapshot.lives).toBe(START_LIVES);
    expect(snapshot.depth).toBe(1);
    expect(snapshot.brightness).toBe(0);
    expect(snapshot.brightHold).toBe(0);
    expect(snapshot.drifters).toEqual([]);
    expect(snapshot.pulses).toEqual([]);
    expect(snapshot.inkClouds).toEqual([]);
    expect(snapshot.sonar.ready).toBe(true);
    expect(snapshot.ink.ready).toBe(true);
    expect(snapshot.simTime).toBe(0);
    expect(snapshot.visibility.join("")).not.toMatch(/[lr]/);
    expect(snapshot.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
    ]);
    expect(snapshot.predators.every((p) => p.state === "den")).toBe(true);
    expect(snapshot.predators.every((p) => !p.released)).toBe(true);
    // Every creature's mind and travel are running again.
    expect(snapshot.predators.every((p) => p.mind)).toBe(true);
    expect(snapshot.predators.every((p) => p.travel)).toBe(true);
    // A plankton on every corridor tile, and nowhere else.
    expect(snapshot.planktonRemaining).toBe(
      snapshot.tiles
        .join("")
        .split("")
        .filter((tile) => tile === ".").length,
    );
    // Muting is a player preference rather than a value a dive opens with.
    expect(snapshot.muted).toBe(true);
    harness.dispose();
  });
});

describe("the lifecycle poses", () => {
  it("sets the screen alone, and each screen runs its own rules from there", async () => {
    const harness = await createHarness();
    harness.debug.setScore(120);
    harness.debug.setLives(1);
    harness.debug.setDepth(3);
    const before = harness.debug.snapshot();

    harness.debug.setScreen("countdown");
    const opened = harness.debug.snapshot();
    // Nothing but the screen: the run's own figures stand as they were.
    expect(opened.screen).toBe("countdown");
    expect(opened.score).toBe(120);
    expect(opened.lives).toBe(1);
    expect(opened.depth).toBe(3);
    expect(opened.tiles).toEqual(before.tiles);
    expect(
      opened.predators.every((p) => p.state === "den" && !p.released),
    ).toBe(true);
    expect(opened.sonar.range).toBe(SONAR_RANGE_BASE - 2);

    // The countdown counts down and hands the game to live play on its own.
    const playing = await harness.until(
      () => harness.debug.snapshot().screen === "playing",
      ticks(4),
    );
    expect(playing).toBe(true);

    // Posed straight to live play, the release schedule starts from there.
    harness.debug.setScreen("title");
    harness.debug.setScreen("playing");
    expect(harness.debug.snapshot().screen).toBe("playing");
    expect(harness.debug.snapshot().predators[0].released).toBe(true);
    expect(harness.debug.snapshot().predators[1].released).toBe(false);

    expect(() =>
      (harness.debug as unknown as { setScreen(s: string): void }).setScreen(
        "diving",
      ),
    ).toThrow();
    harness.dispose();
  });

  it("takes the release schedule's origin from the moment play opens", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("playing");
    // The first slot's turn comes at once; the second's a gap later.
    expect(harness.debug.snapshot().predators[1].released).toBe(false);
    await harness.engine.advance(ticks(DEN_RELEASE_GAP) - 4);
    expect(harness.debug.snapshot().predators[1].released).toBe(false);
    await harness.engine.advance(8);
    expect(harness.debug.snapshot().predators[1].released).toBe(true);
    harness.dispose();
  });

  it("sets the score and the lives, and play carries on from them", async () => {
    const harness = await alone();
    harness.debug.setScore(7);
    harness.debug.setLives(0);
    expect(harness.debug.snapshot().score).toBe(7);
    expect(harness.debug.snapshot().lives).toBe(0);

    // The next plankton eaten adds to the figure that was posed. A second one
    // stands on the board, so eating the first clears no maze.
    const forager = harness.debug.snapshot().forager;
    harness.debug.setPlankton(forager.tx, forager.ty, true);
    harness.debug.setPlankton(forager.tx + 1, forager.ty, true);
    await harness.engine.advance(2);
    expect(harness.debug.snapshot().score).toBe(7 + SCORE_PLANKTON);

    expect(() => harness.debug.setScore(-1)).toThrow();
    expect(() => harness.debug.setScore(1.5)).toThrow();
    expect(() => harness.debug.setLives(-1)).toThrow();
    harness.dispose();
  });

  it("scales the sonar range and the roster with the depth, leaving the board alone", async () => {
    const harness = await playing();
    harness.debug.setPredatorTile(0, 1, 1);
    harness.debug.setPredatorState(0, "wander");
    const before = harness.debug.snapshot();

    harness.debug.setDepth(3);
    const after = harness.debug.snapshot();
    expect(after.depth).toBe(3);
    expect(after.sonar.range).toBe(SONAR_RANGE_BASE - 2);
    expect(after.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
      "lanternjaw",
    ]);
    // The roster it lays out is the one a maze at that depth starts with.
    expect(after.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
    // The maze, the plankton, the fog and the screen are untouched.
    expect(after.tiles).toEqual(before.tiles);
    expect(after.plankton).toEqual(before.plankton);
    expect(after.visibility).toEqual(before.visibility);
    expect(after.screen).toBe(before.screen);
    expect(() => harness.debug.setDepth(0)).toThrow();
    expect(() => harness.debug.setDepth(1.5)).toThrow();
    harness.dispose();
  });
});

describe("setMaze", () => {
  it("takes a fixture exactly as given, however far from a legal maze", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.tiles).toEqual(fixture.rows);
    // A hall with two dead ends, no den and no wrap tunnel keeps running.
    await harness.engine.advance(ticks(1));
    expect(harness.debug.snapshot().screen).toBe("playing");
    expect(harness.debug.snapshot().tiles).toEqual(fixture.rows);
    harness.dispose();
  });

  it("sets the layout and nothing else on the board", async () => {
    const harness = await playing();
    harness.debug.setBrightness(1);
    harness.debug.setScore(40);
    harness.debug.setPredatorTile(0, 1, 1);
    harness.debug.setPredatorState(0, "wander");
    await harness.engine.advance(ticks(1));
    const before = harness.debug.snapshot();
    expect(before.visibility.join("")).toMatch(/[lr]/);

    // A hall stamped over the trench, sharing none of its corridors.
    const fixture = stampLayout(HALL);
    harness.debug.setMaze(fixture.rows);
    const posed = harness.debug.snapshot();
    expect(posed.tiles).toEqual(fixture.rows);
    // The roster, the bodies, the run's figures and the screen all stand.
    expect(posed.predators.map((p) => p.kind)).toEqual(
      before.predators.map((p) => p.kind),
    );
    expect(posed.predators[0].state).toBe("wander");
    expect([posed.predators[0].tx, posed.predators[0].ty]).toEqual([1, 1]);
    expect(posed.forager.tx).toBe(before.forager.tx);
    expect(posed.forager.ty).toBe(before.forager.ty);
    expect(posed.screen).toBe(before.screen);
    expect(posed.score).toBe(before.score);
    expect(posed.lives).toBe(before.lives);
    expect(posed.depth).toBe(before.depth);
    // The revealed-tile memory stands: nothing was put back to fog.
    expect(posed.visibility.join("")).toMatch(/[lr]/);
    harness.dispose();
  });

  it("leaves a body the new layout walls in on the tile it holds", async () => {
    const harness = await alone();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    // A layout of solid rock, which the forager now stands inside.
    harness.debug.setMaze(
      new Array<string>(GRID_ROWS).fill("#".repeat(GRID_COLS - 1) + "."),
    );
    await harness.engine.advance(ticks(1));
    const stuck = harness.debug.snapshot().forager;
    expect([stuck.tx, stuck.ty]).toEqual([start.tx, start.ty]);
    expect(stuck.moving).toBe(false);
    harness.dispose();
  });

  it("takes the plankton the new layout walls into rock off the board", async () => {
    const harness = await playing();
    const full = harness.debug.snapshot();
    expect(full.planktonRemaining).toBeGreaterThan(0);

    const fixture = stampLayout(HALL);
    harness.debug.setMaze(fixture.rows);
    const posed = harness.debug.snapshot();
    // Every plankton left stands on a corridor tile of the new layout, and
    // the count is the number of them the layer carries.
    expect(
      posed.plankton
        .join("")
        .split("")
        .filter((mark) => mark === "*").length,
    ).toBe(posed.planktonRemaining);
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        if (posed.plankton[ty][tx] !== "*") continue;
        expect(posed.tiles[ty][tx]).toBe(".");
      }
    }
    harness.dispose();
  });

  it("refuses a layout that is not in the alphabet or not the right size", async () => {
    const harness = await playing();
    const good = harness.debug.snapshot().tiles;
    expect(() => harness.debug.setMaze(["#".repeat(GRID_COLS)])).toThrow();
    expect(() =>
      harness.debug.setMaze(new Array<string>(GRID_ROWS).fill("#")),
    ).toThrow();
    expect(() =>
      harness.debug.setMaze(
        new Array<string>(GRID_ROWS).fill("x".repeat(GRID_COLS)),
      ),
    ).toThrow();
    // Den tiles without exactly one gate are invalid.
    const twoGates = new Array<string>(GRID_ROWS).fill("#".repeat(GRID_COLS));
    twoGates[8] = `##gg${"d".repeat(GRID_COLS - 6)}##`;
    expect(() => harness.debug.setMaze(twoGates)).toThrow();
    // A refused layout leaves the standing one exactly as it was.
    expect(harness.debug.snapshot().tiles).toEqual(good);
    harness.dispose();
  });

  it("refuses rows that are not an array of strings at all", async () => {
    const harness = await playing();
    const surface = harness.debug as unknown as {
      setMaze(rows: unknown): void;
    };
    expect(() => {
      surface.setMaze("#".repeat(GRID_COLS));
    }).toThrow();
    expect(() => {
      surface.setMaze(null);
    }).toThrow();
    harness.dispose();
  });
});

describe("an argument outside its stated domain", () => {
  it("fails loudly rather than guessing what was meant", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");

    // Off the grid, or not a whole tile at all.
    expect(() => {
      harness.debug.setForagerTile(-1, start.ty);
    }).toThrow();
    expect(() => {
      harness.debug.setForagerTile(GRID_COLS, start.ty);
    }).toThrow();
    expect(() => {
      harness.debug.setPredatorTile(0, start.tx + 0.5, start.ty);
    }).toThrow();
    expect(() => {
      harness.debug.setPredatorTile(0, start.tx, GRID_ROWS);
    }).toThrow();

    // On the grid, but rock: closed to the forager and to a predator alike.
    const tiles = harness.debug.snapshot().tiles;
    expect(tiles[0][0]).toBe("#");
    expect(() => {
      harness.debug.setForagerTile(0, 0);
    }).toThrow();
    expect(() => {
      harness.debug.setPredatorTile(0, 0, 0);
    }).toThrow();
    expect(() => {
      harness.debug.spawnDrifter(0, 0);
    }).toThrow();
    expect(() => {
      harness.debug.setPlankton(0, 0, true);
    }).toThrow();

    // No predator carries that index, and no such state, facing or depth.
    expect(() => {
      harness.debug.setPredatorDir(99, "up");
    }).toThrow();
    const surface = harness.debug as unknown as {
      setPredatorState(index: number, value: string): void;
      setForagerDir(dir: string): void;
    };
    expect(() => {
      surface.setPredatorState(0, "search");
    }).toThrow();
    expect(() => {
      surface.setForagerDir("sideways");
    }).toThrow();
    expect(() => {
      harness.debug.setDepth(0);
    }).toThrow();
    expect(() => {
      harness.debug.setBrightness(1.5);
    }).toThrow();
    expect(() => {
      harness.debug.setSonarCooldown(-1);
    }).toThrow();
    expect(() => {
      harness.debug.setInkCooldown(-1);
    }).toThrow();

    // Every refusal left the game exactly as it stood.
    const after = harness.debug.snapshot();
    expect(after.forager.tx).toBe(start.tx);
    expect(after.forager.ty).toBe(start.ty);
    expect(after.depth).toBe(1);
    expect(after.brightness).toBe(0);
    harness.dispose();
  });
});

describe("the forager poses", () => {
  it("moves the forager to a tile and leaves it at rest there", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.setForagerTile(start.tx + 3, start.ty);

    const forager = harness.debug.snapshot().forager;
    expect([forager.tx, forager.ty]).toEqual([start.tx + 3, start.ty]);
    expect(forager.x).toBeCloseTo(
      GRID_ORIGIN_X + (start.tx + 3) * TILE + TILE / 2,
      6,
    );
    expect(forager.moving).toBe(false);

    await harness.engine.advance(ticks(0.5));
    expect(harness.debug.snapshot().forager.tx).toBe(start.tx + 3);
    expect(() => harness.debug.setForagerTile(0, 0)).toThrow();
    harness.dispose();
  });

  it("sets the facing without moving the forager", async () => {
    const harness = await playing();
    const before = harness.debug.snapshot().forager;
    harness.debug.setForagerDir("left");
    const after = harness.debug.snapshot().forager;
    expect(after.dir).toBe("left");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.moving).toBe(false);
    expect(() =>
      (
        harness.debug as unknown as { setForagerDir(d: string): void }
      ).setForagerDir("sideways"),
    ).toThrow();
    harness.dispose();
  });

  it("sets the brightness and leaves the hold as it stands", async () => {
    const harness = await alone();
    pose(harness.debug, HALL);
    // With the hold spent, the posed value decays from the next tick on.
    harness.debug.setBrightHold(0);
    harness.debug.setBrightness(0.5);
    expect(harness.debug.snapshot().brightness).toBe(0.5);
    expect(harness.debug.snapshot().brightHold).toBe(0);

    await harness.engine.advance(ticks(0.25));
    expect(harness.debug.snapshot().brightness).toBeLessThan(0.5);
    expect(() => harness.debug.setBrightness(2)).toThrow();
    expect(() => harness.debug.setBrightness(-0.1)).toThrow();
    harness.dispose();
  });

  it("holds the brightness steady for the seconds the hold is posed with", async () => {
    const harness = await alone();
    pose(harness.debug, HALL);
    harness.debug.setBrightness(0.5);
    harness.debug.setBrightHold(BRIGHT_HOLD);
    expect(harness.debug.snapshot().brightHold).toBe(BRIGHT_HOLD);

    await harness.engine.advance(ticks(BRIGHT_HOLD) - 4);
    expect(harness.debug.snapshot().brightness).toBeCloseTo(0.5, 6);
    expect(harness.debug.snapshot().brightHold).toBeGreaterThan(0);

    await harness.engine.advance(ticks(0.5));
    expect(harness.debug.snapshot().brightHold).toBe(0);
    expect(harness.debug.snapshot().brightness).toBeLessThan(0.5);

    // The hold runs from nothing to BRIGHT_HOLD and no further.
    expect(() => harness.debug.setBrightHold(-1)).toThrow();
    expect(() => harness.debug.setBrightHold(BRIGHT_HOLD + 0.5)).toThrow();
    harness.dispose();
  });
});

describe("the predator poses", () => {
  it("selects a predator by its index into the roster", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const mark = at(fixture, "P");

    harness.debug.setPredatorTile(1, mark.tx, mark.ty);
    harness.debug.setPredatorDir(1, "left");
    const posed = harness.debug.snapshot().predators[1];
    expect(posed.kind).toBe("gloamfin");
    expect([posed.tx, posed.ty]).toEqual([mark.tx, mark.ty]);
    expect(posed.dir).toBe("left");
    // The other predators were not touched.
    expect(harness.debug.snapshot().predators[0].tx).not.toBe(mark.tx);

    expect(() => harness.debug.setPredatorTile(9, mark.tx, mark.ty)).toThrow();
    expect(() => harness.debug.setPredatorDir(-1, "up")).toThrow();
    harness.dispose();
  });

  it("poses each of the three states on the tile the predator stands on", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, DEN);
    const mark = at(fixture, "F");

    harness.debug.setPredatorTile(0, mark.tx + 2, mark.ty);
    harness.debug.setPredatorState(0, "wander");
    let predator = harness.debug.snapshot().predators[0];
    expect(predator.state).toBe("wander");
    expect([predator.tx, predator.ty]).toEqual([mark.tx + 2, mark.ty]);

    harness.debug.setPredatorState(0, "chase");
    predator = harness.debug.snapshot().predators[0];
    expect(predator.state).toBe("chase");
    // It moves the predator nowhere, and a pose is an arrangement rather than
    // a detection, so it fires no alert.
    expect([predator.tx, predator.ty]).toEqual([mark.tx + 2, mark.ty]);
    expect(predator.alert).toBe(false);

    // The den state belongs to a predator standing in the den chamber.
    const den = harness.debug.snapshot().tiles.reduce<{
      tx: number;
      ty: number;
    } | null>((found, row, ty) => {
      const tx = row.indexOf("d");
      return found ?? (tx === -1 ? null : { tx, ty });
    }, null);
    expect(den).not.toBeNull();
    if (!den) throw new Error("the fixture carries no den tile");
    harness.debug.setPredatorTile(0, den.tx, den.ty);
    harness.debug.setPredatorState(0, "den");
    predator = harness.debug.snapshot().predators[0];
    expect(predator.state).toBe("den");
    expect([predator.tx, predator.ty]).toEqual([den.tx, den.ty]);

    harness.dispose();
  });

  it("refuses a state the tile the predator stands on cannot carry", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, DEN);
    const mark = at(fixture, "F");

    // Out in the corridors, the den state has no chamber to name.
    harness.debug.setPredatorTile(0, mark.tx + 2, mark.ty);
    expect(() => harness.debug.setPredatorState(0, "den")).toThrow();

    // Inside the chamber, the loose states have no corridor to stand on.
    const den = harness.debug.snapshot().tiles.reduce<{
      tx: number;
      ty: number;
    } | null>((found, row, ty) => {
      const tx = row.indexOf("d");
      return found ?? (tx === -1 ? null : { tx, ty });
    }, null);
    if (!den) throw new Error("the fixture carries no den tile");
    harness.debug.setPredatorTile(0, den.tx, den.ty);
    expect(() => harness.debug.setPredatorState(0, "wander")).toThrow();
    expect(() => harness.debug.setPredatorState(0, "chase")).toThrow();
    expect(() =>
      (
        harness.debug as unknown as {
          setPredatorState(i: number, v: string): void;
        }
      ).setPredatorState(0, "search"),
    ).toThrow();
    harness.dispose();
  });

  it("sets the release flag without moving the predator or its state", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const mark = at(fixture, "P");
    harness.debug.setPredatorTile(0, mark.tx, mark.ty);
    harness.debug.setPredatorState(0, "wander");

    harness.debug.setPredatorReleased(0, false);
    let predator = harness.debug.snapshot().predators[0];
    expect(predator.released).toBe(false);
    expect(predator.state).toBe("wander");
    expect([predator.tx, predator.ty]).toEqual([mark.tx, mark.ty]);

    harness.debug.setPredatorReleased(0, true);
    predator = harness.debug.snapshot().predators[0];
    expect(predator.released).toBe(true);
    expect(predator.state).toBe("wander");
    expect(() => harness.debug.setPredatorReleased(9, true)).toThrow();
    harness.dispose();
  });

  it("lets a posed hunter run its own mind, rounding rock to reach its fix", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, SPINE);
    const mark = at(fixture, "P");
    harness.debug.setPredatorTile(0, mark.tx, mark.ty);
    harness.debug.setPredatorState(0, "chase");
    minds(harness.debug, true);

    const rows = harness.debug.snapshot().tiles;
    let steppedOnRock = false;
    const reached = await harness.until(() => {
      const predator = harness.debug.snapshot().predators[0];
      if (rows[predator.ty][predator.tx] === "#") steppedOnRock = true;
      return predator.ty === at(fixture, "F").ty;
    }, ticks(10));

    expect(reached).toBe(true);
    expect(steppedOnRock).toBe(false);
    harness.dispose();
  });

  it("holds one creature where it stands and leaves the rest running", async () => {
    const harness = await playing();
    // A longer hall than HALL, so the hunter left running can wander either
    // way for the whole window without coming inside the forager's light.
    const fixture = pose(harness.debug, [
      "#".repeat(24),
      `#F${".".repeat(21)}#`,
      "#".repeat(24),
    ]);
    const start = at(fixture, "F");
    harness.debug.clearPredators();
    harness.debug.addPredator("lanternjaw", start.tx + 4, start.ty);
    harness.debug.addPredator("lanternjaw", start.tx + 12, start.ty);
    harness.debug.spawnDrifter(start.tx + 8, start.ty);
    harness.debug.setPredatorMind(0, false);
    harness.debug.setDrifterMind(0, false);
    harness.debug.setSonarCooldown(2);

    const before = harness.debug.snapshot();
    expect(before.predators[0].mind).toBe(false);
    expect(before.predators[1].mind).toBe(true);
    await harness.engine.advance(ticks(2));
    const after = harness.debug.snapshot();

    // The one held still keeps its tile and its state; the other travels.
    expect(after.predators[0].x).toBe(before.predators[0].x);
    expect(after.predators[0].state).toBe(before.predators[0].state);
    expect(after.predators[1].x).not.toBe(before.predators[1].x);
    expect(after.drifters[0].x).toBe(before.drifters[0].x);
    // Everything else keeps running: the cooldowns still run down.
    expect(after.sonar.cooldown).toBeLessThan(before.sonar.cooldown);
    expect(() => harness.debug.setPredatorMind(9, false)).toThrow();
    expect(() => harness.debug.setDrifterMind(9, false)).toThrow();
    expect(() => harness.debug.setPredatorTravel(9, false)).toThrow();
    expect(() => harness.debug.setDrifterTravel(9, false)).toThrow();
    harness.dispose();
  });

  it("holds a predator's body on its tile while its own mind runs on", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.clearPredators();
    harness.debug.clearDrifters();
    // One tile off the forager: inside GLOAMFIN_HEAR, and not the tile the
    // forager stands on, so nothing here is contact.
    harness.debug.addPredator("gloamfin", start.tx + 1, start.ty);
    harness.debug.setPredatorTravel(0, false);

    const before = harness.debug.snapshot().predators[0];
    expect(before.mind).toBe(true);
    expect(before.travel).toBe(false);
    expect(before.state).toBe("wander");

    await harness.engine.advance(ticks(0.25));
    const held = harness.debug.snapshot().predators[0];

    // Its mind ran through the code play runs: it heard the forager, took the
    // fix, fired its alert, and reports the pace a chase carries.
    expect(held.hearingLock).toBe(true);
    expect(held.state).toBe("chase");
    expect(held.alert).toBe(true);
    expect(held.speed).toBeCloseTo(GLOAMFIN_CHASE_SPEED, 6);
    // Its body held the tile it was posed on, to the unit.
    expect(held.x).toBe(before.x);
    expect(held.y).toBe(before.y);
    expect([held.tx, held.ty]).toEqual([start.tx + 1, start.ty]);

    // Travel back on and the same chase carries the body.
    harness.debug.setPredatorTravel(0, true);
    await harness.engine.advance(2);
    const loosed = harness.debug.snapshot().predators[0];
    expect(loosed.travel).toBe(true);
    expect(loosed.x).toBeLessThan(held.x);
    harness.dispose();
  });

  it("holds a drifter's body on its tile and leaves the rest wandering", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.clearPredators();
    harness.debug.clearDrifters();
    harness.debug.spawnDrifter(start.tx + 4, start.ty);
    harness.debug.spawnDrifter(start.tx + 6, start.ty);
    harness.debug.setDrifterTravel(0, false);

    const before = harness.debug.snapshot();
    expect(before.drifters[0].travel).toBe(false);
    expect(before.drifters[1].travel).toBe(true);
    await harness.engine.advance(ticks(0.2));
    const after = harness.debug.snapshot();

    // The held one keeps its tile with its mind still running; the other
    // wanders on.
    expect(after.drifters[0].x).toBe(before.drifters[0].x);
    expect(after.drifters[0].mind).toBe(true);
    expect([after.drifters[0].tx, after.drifters[0].ty]).toEqual([
      start.tx + 4,
      start.ty,
    ]);
    expect(after.drifters[1].x).not.toBe(before.drifters[1].x);
    harness.dispose();
  });

  it("adds a predator at the end of the roster, loose and patrolling", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    const before = harness.debug.snapshot().predators.length;

    harness.debug.addPredator("flarefish", start.tx + 5, start.ty);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.predators).toHaveLength(before + 1);
    expect(snapshot.predators[before].mind).toBe(true);
    // Held still, so the roster it was added to stands for the wait below.
    harness.debug.setPredatorMind(before, false);
    snapshot = harness.debug.snapshot();
    const added = snapshot.predators[before];
    expect(added.kind).toBe("flarefish");
    expect([added.tx, added.ty]).toEqual([start.tx + 5, start.ty]);
    expect(added.state).toBe("wander");
    expect(added.released).toBe(true);
    expect(added.dir).toBe("up");

    // It carries no release time, so held back it stays held back, however
    // many slots of the staggered schedule go by.
    harness.debug.setPredatorReleased(before, false);
    const released = await harness.waitFor(
      () => harness.debug.snapshot().predators[before].released,
      DEN_RELEASE_GAP * 4,
    );
    expect(released).toBe(false);

    expect(() =>
      (
        harness.debug as unknown as {
          addPredator(k: string, tx: number, ty: number): void;
        }
      ).addPredator("shark", start.tx, start.ty),
    ).toThrow();
    expect(() => harness.debug.addPredator("gloamfin", 0, 0)).toThrow();
    harness.dispose();
  });

  it("takes every predator off the board, and runs no schedule without one", async () => {
    const harness = await playing();
    harness.debug.clearPredators();
    expect(harness.debug.snapshot().predators).toEqual([]);

    // No release schedule runs, because there is no predator left to run one.
    const appeared = await harness.waitFor(
      () => harness.debug.snapshot().predators.length > 0,
      DEN_RELEASE_GAP * 4,
    );
    expect(appeared).toBe(false);
    expect(harness.debug.snapshot().screen).toBe("playing");

    // The depth's own roster comes back with the depth.
    harness.debug.setDepth(1);
    expect(harness.debug.snapshot().predators).toHaveLength(3);
    harness.dispose();
  });
});

describe("the board poses", () => {
  it("adds a drifter beyond the ordinary ceiling", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    for (let extra = 0; extra <= DRIFTER_MAX; extra++) {
      harness.debug.spawnDrifter(start.tx + 2 + extra, start.ty);
    }
    expect(harness.debug.snapshot().drifters.length).toBe(DRIFTER_MAX + 1);
    expect(() => harness.debug.spawnDrifter(0, 0)).toThrow();
    harness.dispose();
  });

  it("takes every drifter off the maze without eating one", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.setScore(0);
    harness.debug.spawnDrifter(start.tx + 2, start.ty);
    harness.debug.spawnDrifter(start.tx + 3, start.ty);
    expect(harness.debug.snapshot().drifters).toHaveLength(2);

    harness.debug.clearDrifters();
    const after = harness.debug.snapshot();
    expect(after.drifters).toEqual([]);
    // None of them was eaten, so nothing was scored.
    expect(after.score).toBe(0);
    harness.dispose();
  });

  it("puts a plankton on a tile and takes one off without eating it", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    const before = harness.debug.snapshot();
    expect(before.planktonRemaining).toBe(0);

    harness.debug.setPlankton(start.tx + 2, start.ty, true);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.planktonRemaining).toBe(1);
    expect(snapshot.plankton[start.ty][start.tx + 2]).toBe("*");
    expect(snapshot.score).toBe(before.score);

    harness.debug.setPlankton(start.tx + 2, start.ty, false);
    snapshot = harness.debug.snapshot();
    expect(snapshot.planktonRemaining).toBe(0);
    expect(snapshot.plankton[start.ty][start.tx + 2]).toBe("-");
    expect(snapshot.score).toBe(before.score);
    expect(() => harness.debug.setPlankton(0, 0, true)).toThrow();
    harness.dispose();
  });

  it("clears every plankton without clearing the maze", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.setPlankton(start.tx + 2, start.ty, true);
    harness.debug.setPlankton(start.tx + 3, start.ty, true);
    harness.debug.setScore(0);

    harness.debug.clearPlankton();
    let snapshot = harness.debug.snapshot();
    expect(snapshot.planktonRemaining).toBe(0);
    expect(snapshot.plankton.join("")).not.toMatch(/\*/);
    // Nothing was eaten, so nothing was scored.
    expect(snapshot.score).toBe(0);

    await harness.engine.advance(ticks(1));
    snapshot = harness.debug.snapshot();
    // An empty board the forager has not just eaten from stays in live play.
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.depth).toBe(1);
    harness.dispose();
  });

  it("puts every tile back to unrevealed", async () => {
    const harness = await alone();
    pose(harness.debug, HALL);
    harness.debug.setBrightness(1);
    await harness.engine.advance(ticks(0.5));
    const seen = harness.debug.snapshot();
    expect(seen.visibility.join("")).toMatch(/[lr]/);
    const forager = seen.forager;

    harness.debug.clearFog();
    const dark = harness.debug.snapshot();
    expect(dark.visibility.join("")).toMatch(/^u+$/);
    // It moves nothing: the forager stands exactly where it stood.
    expect([dark.forager.tx, dark.forager.ty]).toEqual([
      forager.tx,
      forager.ty,
    ]);

    // Light reaching a tile again is what reveals it again.
    await harness.engine.advance(2);
    expect(harness.debug.snapshot().visibility.join("")).toMatch(/l/);
    harness.dispose();
  });

  it("poses each cooldown, which then runs down on the ordinary curve", async () => {
    const harness = await playing();
    pose(harness.debug, HALL);
    harness.debug.setSonarCooldown(0);
    harness.debug.setInkCooldown(INK_COOLDOWN);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.sonar.ready).toBe(true);
    expect(snapshot.ink.ready).toBe(false);
    expect(snapshot.ink.cooldown).toBe(INK_COOLDOWN);

    await harness.engine.advance(ticks(1));
    snapshot = harness.debug.snapshot();
    expect(snapshot.ink.cooldown).toBeCloseTo(INK_COOLDOWN - 1, 3);

    expect(() => harness.debug.setSonarCooldown(-1)).toThrow();
    expect(() => harness.debug.setInkCooldown(Number.NaN)).toThrow();
    harness.dispose();
  });
});
