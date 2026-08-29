// Fathom — the build stood up on the real engine.
//
// Every test here drives the game the way a player or a caller does: keyboard
// events dispatched at the surface the engine listens on, frames stepped with
// `engine.advance` against a clock of one tick a frame, and the outcome read
// back off the world's own state, the debug surface, the cue events, or the
// pixels the render produced. Every figure asserted is the one the
// specification states, written out here rather than imported from the code
// under test.

import { describe, expect, it } from "vitest";
import { ConstantClock } from "@test-cabinet/structured-2d";
import {
  ALERT_TIME,
  DEN_RELEASE_GAP,
  FORAGER_SPEED,
  GAMEOVER_ITEMS,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  PAUSE_ITEMS,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  START_LIVES,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  TITLE_ITEMS,
} from "./constants";
import { diagnosticSources } from "./diagnostics";
import { createHarness, FRAME_MS, type Harness } from "./harness";
import { DEN, HALL, at, minds, pose } from "./scenarios";

/** Frames, at one tick a frame, covering `seconds` of game time. */
function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** A harness already in live play, with the creatures held where posed. */
async function playing(): Promise<Harness> {
  const harness = await createHarness();
  harness.debug.setScreen("playing");
  minds(harness.debug, false);
  // One tick settles the board — the plankton underfoot is grazed — so a test
  // that watches the cue log sees only the cues its own action raised.
  await harness.engine.advance(1);
  harness.cues.length = 0;
  return harness;
}

describe("the engine wiring", () => {
  it("hands the debug surface back off the engine, on the title screen", async () => {
    const harness = await createHarness();
    expect(harness.debug).toBe(harness.engine.debug);
    expect(harness.debug.version).toBe(1);

    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toBe(0);
    expect(snapshot.lives).toBe(START_LIVES);
    expect(snapshot.depth).toBe(1);
    expect(snapshot.muted).toBe(false);
    expect(snapshot.simTime).toBe(0);
    harness.dispose();
  });

  it("runs the simulation on whole ticks, however the frames divide the time", async () => {
    const one = await createHarness();
    one.debug.setScreen("playing");
    await one.engine.advance(ticks(2));
    const perTick = one.debug.snapshot();
    one.dispose();

    const two = await createHarness();
    two.debug.setScreen("playing");
    two.engine.setClock(new ConstantClock(FRAME_MS * 2));
    await two.engine.advance(ticks(2) / 2);
    const perFrame = two.debug.snapshot();
    two.dispose();

    expect(perFrame.simTime).toBeCloseTo(perTick.simTime, 6);
    expect(perFrame.forager.x).toBeCloseTo(perTick.forager.x, 6);
    expect(perFrame.predators.map((p) => p.released)).toEqual(
      perTick.predators.map((p) => p.released),
    );
  });

  it("registers the diagnostic sources it names, as pure reads", async () => {
    const harness = await createHarness();
    const names = diagnosticSources(() => harness.state).map(([name]) => name);
    expect(names).toContain("screen");
    expect(names).toContain("plankton");
    expect(names).toContain("forager");
    expect(names).toContain("predator 0");

    const before = harness.debug.snapshot();
    for (const [, source] of diagnosticSources(() => harness.state)) source();
    expect(harness.debug.snapshot()).toEqual(before);
    harness.dispose();
  });
});

describe("the screens", () => {
  it("moves the title selection and wraps at both ends", async () => {
    const harness = await createHarness();
    expect(harness.debug.snapshot().screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);

    await harness.tap("ArrowDown");
    expect(harness.state.menuIndex).toBe(1);
    await harness.tap("ArrowDown");
    expect(harness.state.menuIndex).toBe(0);
    await harness.tap("ArrowUp");
    expect(harness.state.menuIndex).toBe(TITLE_ITEMS.length - 1);
    harness.dispose();
  });

  it("dives from the title menu and leaves the countdown for live play", async () => {
    const harness = await createHarness();
    await harness.tap("Enter");
    expect(harness.debug.snapshot().screen).toBe("countdown");

    // No predator leaves the den while the countdown runs.
    await harness.engine.advance(ticks(0.9));
    expect(harness.debug.snapshot().screen).toBe("countdown");
    expect(harness.debug.snapshot().predators.some((p) => p.released)).toBe(
      false,
    );

    const reached = await harness.until(
      () => harness.debug.snapshot().screen === "playing",
      ticks(3) - ticks(0.9) + 1,
    );
    expect(reached).toBe(true);
    harness.dispose();
  });

  it("opens the how-to screen and comes back from it", async () => {
    const harness = await createHarness();
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    expect(harness.debug.snapshot().screen).toBe("howto");
    await harness.tap("Escape");
    expect(harness.debug.snapshot().screen).toBe("title");
    harness.dispose();
  });

  it("freezes the maze behind the pause menu and resumes it", async () => {
    const harness = await playing();
    harness.debug.setForagerTile(17, 15);
    harness.down("ArrowRight");
    await harness.engine.advance(ticks(0.1));

    await harness.tap("KeyP");
    const paused = harness.debug.snapshot();
    expect(paused.screen).toBe("paused");
    expect(harness.state.menuIndex).toBe(0);

    await harness.engine.advance(ticks(1));
    const still = harness.debug.snapshot();
    expect(still.forager.x).toBe(paused.forager.x);
    expect(still.score).toBe(paused.score);
    // simTime accumulates on every screen, the paused one included.
    expect(still.simTime).toBeGreaterThan(paused.simTime);

    await harness.tap("Escape");
    expect(harness.debug.snapshot().screen).toBe("playing");
    harness.dispose();
  });

  /** Loses every life on a posed board, leaving the run over. */
  async function loseTheRun(harness: Harness): Promise<void> {
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    for (let attempt = 0; attempt <= START_LIVES; attempt++) {
      if (harness.debug.snapshot().screen === "countdown") {
        harness.debug.setScreen("playing");
      }
      // Contact is the predator's center on the forager's own tile, whatever
      // that predator is doing, so a posed hunter underfoot is enough.
      harness.debug.setPredatorTile(0, start.tx, start.ty);
      harness.debug.setPredatorState(0, "wander");
      const settled = await harness.waitFor(() => {
        const screen = harness.debug.snapshot().screen;
        return screen === "countdown" || screen === "gameover";
      }, 2);
      expect(settled).toBe(true);
    }
    expect(harness.debug.snapshot().screen).toBe("gameover");
  }

  it("leaves the game-over screen for the title on its second item", async () => {
    const harness = await playing();
    await loseTheRun(harness);

    expect(GAMEOVER_ITEMS[1]).toBe("MENU");
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    const title = harness.debug.snapshot();
    expect(title.screen).toBe("title");
    expect(title.score).toBe(0);
    expect(title.lives).toBe(START_LIVES);
    expect(title.depth).toBe(1);
    harness.dispose();
  });

  it("leaves the game-over screen for the title on `back`", async () => {
    const harness = await playing();
    await loseTheRun(harness);

    await harness.tap("Escape");
    expect(harness.debug.snapshot().screen).toBe("title");
    harness.dispose();
  });

  it("resumes and restarts from the pause menu's own items", async () => {
    const harness = await playing();
    harness.debug.setForagerTile(17, 15);
    await harness.engine.advance(1);
    const scored = harness.debug.snapshot().score;

    expect(PAUSE_ITEMS[0]).toBe("RESUME");
    await harness.tap("KeyP");
    await harness.tap("Enter");
    const resumed = harness.debug.snapshot();
    expect(resumed.screen).toBe("playing");
    // RESUME picks the dive back up rather than beginning a new one.
    expect(resumed.score).toBe(scored);
    expect(harness.state.menuIndex).toBe(0);

    expect(PAUSE_ITEMS[1]).toBe("RESTART");
    await harness.tap("KeyP");
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    const fresh = harness.debug.snapshot();
    expect(fresh.screen).toBe("countdown");
    expect(fresh.score).toBe(0);
    expect(fresh.lives).toBe(START_LIVES);
    expect(fresh.depth).toBe(1);
    expect(fresh.predators.every((predator) => !predator.released)).toBe(true);
    harness.dispose();
  });

  it("takes the pause menu's own items", async () => {
    const harness = await playing();
    await harness.tap("KeyP");
    expect(PAUSE_ITEMS[2]).toBe("QUIT TO MENU");
    await harness.tap("ArrowDown");
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    const title = harness.debug.snapshot();
    expect(title.screen).toBe("title");
    expect(title.score).toBe(0);
    expect(title.lives).toBe(START_LIVES);
    expect(title.depth).toBe(1);
    harness.dispose();
  });
});

describe("the controls", () => {
  it("travels while a movement key is held and rests when it is let go", async () => {
    const harness = await playing();
    harness.debug.setForagerTile(17, 15);
    const start = harness.debug.snapshot().forager;

    harness.down("ArrowRight");
    await harness.engine.advance(ticks(0.5));
    const moving = harness.debug.snapshot().forager;
    expect(moving.moving).toBe(true);
    expect(moving.dir).toBe("right");
    expect(moving.x - start.x).toBeCloseTo(FORAGER_SPEED * 0.5, 3);

    harness.up("ArrowRight");
    await harness.engine.advance(ticks(0.5));
    const rested = harness.debug.snapshot().forager;
    expect(rested.moving).toBe(false);
    expect(rested.x).toBeCloseTo(moving.x, 3);
    // A body at rest still faces the way it last travelled.
    expect(rested.dir).toBe("right");
    harness.dispose();
  });

  it("emits a pulse on the pulse key and refuses one on cooldown", async () => {
    const harness = await playing();
    harness.cues.length = 0;

    await harness.tap("Space");
    const fired = harness.debug.snapshot();
    expect(fired.pulses).toHaveLength(1);
    expect(fired.pulses[0].source).toBe("forager");
    expect(fired.pulses[0].tint).toBe("cyan");
    expect(fired.sonar.ready).toBe(false);
    expect(fired.sonar.cooldown).toBeGreaterThan(SONAR_COOLDOWN - 0.1);
    expect(harness.cues.map((cue) => cue.cue)).toEqual(["sonar"]);

    harness.cues.length = 0;
    await harness.tap("Space");
    expect(harness.cues).toHaveLength(0);
    expect(
      harness.debug.snapshot().pulses.filter((p) => p.source === "forager"),
    ).toHaveLength(1);
    harness.dispose();
  });

  it("releases a cloud on the ink key, fixed where the forager stood", async () => {
    const harness = await playing();
    harness.debug.setForagerTile(17, 15);
    const where = harness.debug.snapshot().forager;
    harness.cues.length = 0;

    await harness.tap("ShiftLeft");
    const snapshot = harness.debug.snapshot();
    expect(snapshot.inkClouds).toHaveLength(1);
    expect(snapshot.inkClouds[0].x).toBeCloseTo(where.x, 3);
    expect(snapshot.inkClouds[0].radius).toBe(INK_RADIUS);
    expect(snapshot.inkClouds[0].remaining).toBeLessThanOrEqual(INK_LIFE);
    expect(snapshot.ink.cooldown).toBeGreaterThan(INK_COOLDOWN - 0.1);
    expect(harness.cues.map((cue) => cue.cue)).toEqual(["ink"]);

    const gone = await harness.until(
      () => harness.debug.snapshot().inkClouds.length === 0,
      ticks(INK_LIFE) + 4,
    );
    expect(gone).toBe(true);
    harness.dispose();
  });

  it("toggles the sound from any screen and mirrors the bit into the state", async () => {
    const harness = await createHarness();
    await harness.tap("KeyM");
    expect(harness.debug.snapshot().muted).toBe(true);

    harness.debug.setScreen("playing");
    await harness.engine.advance(1);
    harness.cues.length = 0;
    await harness.tap("Space");
    // The event still happens while muted; only the sound stops.
    expect(harness.cues.map((cue) => cue.cue)).toEqual(["sonar"]);
    expect(harness.cues[0].gain).toBe(0);

    await harness.tap("KeyM");
    expect(harness.debug.snapshot().muted).toBe(false);
    harness.dispose();
  });
});

describe("the rules of a dive", () => {
  it("scores a plankton and brightens the forager for eating it", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    // Two on the board, so eating the first clears no maze under the reading.
    harness.debug.setPlankton(start.tx + 1, start.ty, true);
    harness.debug.setPlankton(start.tx + 2, start.ty, true);
    harness.debug.setBrightness(0);
    harness.debug.setBrightHold(0);
    const before = harness.debug.snapshot();
    expect(before.brightness).toBe(0);

    harness.down("ArrowRight");
    const eaten = await harness.until(
      () => harness.debug.snapshot().score > before.score,
      ticks(1),
    );
    expect(eaten).toBe(true);
    const after = harness.debug.snapshot();
    expect(after.score).toBe(before.score + SCORE_PLANKTON);
    expect(after.planktonRemaining).toBe(before.planktonRemaining - 1);
    expect(after.brightness).toBeGreaterThan(0);
    harness.dispose();
  });

  it("sounds one cue per event, and each of a tick's cues once", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    // Two mouthfuls on the board, so the second is the one that clears it.
    harness.debug.clearPlankton();
    harness.debug.setPlankton(start.tx + 1, start.ty, true);
    harness.debug.setPlankton(start.tx + 2, start.ty, true);
    harness.cues.length = 0;

    harness.down("ArrowRight");
    const first = await harness.until(
      () => harness.debug.snapshot().planktonRemaining === 1,
      ticks(1),
    );
    expect(first).toBe(true);
    expect(harness.cues.map((cue) => cue.cue)).toEqual(["eat"]);

    // The mouthful that leaves none behind clears the maze, so one tick raises
    // two cues and each of them sounds once.
    const cleared = await harness.until(
      () => harness.debug.snapshot().screen === "cleared",
      ticks(1),
    );
    expect(cleared).toBe(true);
    expect(harness.cues.map((cue) => cue.cue)).toEqual([
      "eat",
      "eat",
      "descend",
    ]);
    harness.dispose();
  });

  it("scores a bonus drifter the forager swims onto", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.clearPlankton();
    harness.debug.spawnDrifter(start.tx + 2, start.ty);
    const before = harness.debug.snapshot();
    expect(before.drifters).toHaveLength(1);

    harness.down("ArrowRight");
    const eaten = await harness.until(
      () => harness.debug.snapshot().drifters.length === 0,
      ticks(1),
    );
    expect(eaten).toBe(true);
    expect(harness.debug.snapshot().score).toBe(before.score + SCORE_DRIFTER);
    harness.dispose();
  });

  it("costs a life on contact and sets the maze up for another attempt", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const mark = at(fixture, "P");
    harness.debug.setPredatorTile(0, mark.tx, mark.ty);
    harness.debug.setPredatorState(0, "chase");
    minds(harness.debug, true);
    harness.cues.length = 0;

    const caught = await harness.until(
      () => harness.debug.snapshot().lives < START_LIVES,
      ticks(20),
    );
    expect(caught).toBe(true);
    const after = harness.debug.snapshot();
    expect(after.lives).toBe(START_LIVES - 1);
    expect(after.screen).toBe("countdown");
    expect(after.predators.every((p) => p.state === "den")).toBe(true);
    expect(after.predators.every((p) => !p.released)).toBe(true);
    expect(after.brightness).toBe(0);
    expect(harness.cues.map((cue) => cue.cue)).toContain("caught");
    harness.dispose();
  });

  it("ends the run when contact comes with no life in reserve", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const mark = at(fixture, "P");
    minds(harness.debug, true);

    for (let attempt = 0; attempt <= START_LIVES; attempt++) {
      if (harness.debug.snapshot().screen === "countdown") {
        harness.debug.setScreen("playing");
      }
      harness.debug.setPredatorTile(0, mark.tx, mark.ty);
      harness.debug.setPredatorState(0, "chase");
      const settled = await harness.until(() => {
        const screen = harness.debug.snapshot().screen;
        return screen === "countdown" || screen === "gameover";
      }, ticks(20));
      expect(settled).toBe(true);
    }

    const over = harness.debug.snapshot();
    expect(over.screen).toBe("gameover");
    expect(over.lives).toBe(0);

    await harness.tap("Enter");
    expect(GAMEOVER_ITEMS[0]).toBe("PLAY AGAIN");
    const fresh = harness.debug.snapshot();
    expect(fresh.screen).toBe("countdown");
    expect(fresh.lives).toBe(START_LIVES);
    expect(fresh.score).toBe(0);
    harness.dispose();
  });

  it("clears the maze on the last plankton and descends to the next depth", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.clearPlankton();
    // An empty maze the forager has not just eaten from stays in live play.
    await harness.engine.advance(ticks(0.5));
    expect(harness.debug.snapshot().screen).toBe("playing");

    harness.debug.setPlankton(start.tx + 1, start.ty, true);
    const before = harness.debug.snapshot();
    harness.cues.length = 0;
    harness.down("ArrowRight");

    const cleared = await harness.until(
      () => harness.debug.snapshot().screen === "cleared",
      ticks(1),
    );
    expect(cleared).toBe(true);
    expect(harness.debug.snapshot().score).toBe(
      before.score + SCORE_PLANKTON + SCORE_CLEAR,
    );
    expect(harness.cues.map((cue) => cue.cue)).toContain("descend");

    const descended = await harness.until(
      () => harness.debug.snapshot().depth === 2,
      ticks(3) + 2,
    );
    expect(descended).toBe(true);
    const next = harness.debug.snapshot();
    expect(next.screen).toBe("countdown");
    // E shrinks by one tile per depth (specs/progression.md).
    expect(next.sonar.range).toBe(8);
    expect(next.visibility.join("")).not.toContain("r");
    harness.dispose();
  });

  it("releases the den on the staggered schedule, measured on `released`", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("playing");
    minds(harness.debug, false);

    const times: number[] = [];
    for (let slot = 0; slot < 3; slot++) {
      const reached = await harness.until(
        () =>
          harness.debug.snapshot().predators.filter((p) => p.released).length >
          slot,
        ticks(DEN_RELEASE_GAP * 4),
      );
      expect(reached).toBe(true);
      times.push(harness.debug.snapshot().simTime);
    }

    expect(times[0]).toBeLessThan(1 / TICK_HZ + 1e-9);
    expect(times[1] - times[0]).toBeCloseTo(DEN_RELEASE_GAP, 1);
    expect(times[2] - times[1]).toBeCloseTo(DEN_RELEASE_GAP, 1);
    harness.dispose();
  });

  it("lets a released predator out through the den gate", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("playing");
    const fixture = pose(harness.debug, DEN);
    minds(harness.debug, false);
    const start = at(fixture, "F");
    // Well clear of the gate, so nothing the swimmer does reaches it.
    harness.debug.setForagerTile(start.tx, start.ty);

    // One hunter alone, in the chamber, with its turn come.
    const den = harness.debug.snapshot().tiles.reduce<{
      tx: number;
      ty: number;
    } | null>((found, row, ty) => {
      const tx = row.indexOf("d");
      return found ?? (tx === -1 ? null : { tx, ty });
    }, null);
    if (!den) throw new Error("the fixture carries no den tile");
    harness.debug.setPredatorTile(0, den.tx, den.ty);
    harness.debug.setPredatorState(0, "den");
    harness.debug.setPredatorReleased(0, true);
    harness.debug.setPredatorMind(0, true);
    expect(harness.debug.snapshot().predators[0].state).toBe("den");

    // It swims out under its own mind, and is loose once it is past the gate.
    const out = await harness.until(
      () => harness.debug.snapshot().predators[0].state === "wander",
      ticks(4),
    );
    expect(out).toBe(true);
    const loose = harness.debug.snapshot().predators[0];
    expect(loose.released).toBe(true);
    expect(harness.debug.snapshot().tiles[loose.ty][loose.tx]).toBe(".");
    harness.dispose();
  });

  it("holds a predator with its travel off inside the den it is released from", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("playing");
    const fixture = pose(harness.debug, DEN);
    minds(harness.debug, false);
    const start = at(fixture, "F");
    harness.debug.setForagerTile(start.tx, start.ty);

    const den = harness.debug.snapshot().tiles.reduce<{
      tx: number;
      ty: number;
    } | null>((found, row, ty) => {
      const tx = row.indexOf("d");
      return found ?? (tx === -1 ? null : { tx, ty });
    }, null);
    if (!den) throw new Error("the fixture carries no den tile");
    harness.debug.setPredatorTile(0, den.tx, den.ty);
    harness.debug.setPredatorState(0, "den");
    harness.debug.setPredatorReleased(0, false);
    harness.debug.setPredatorMind(0, true);
    harness.debug.setPredatorTravel(0, false);

    // Long enough to have crossed the chamber and be out through the gate.
    await harness.engine.advance(ticks(0.5));

    // Its slot came and the flag turned over, and crossing the chamber to the
    // gate is travel, so it holds the den tile it was posed on.
    const held = harness.debug.snapshot().predators[0];
    expect(held.released).toBe(true);
    expect(held.state).toBe("den");
    expect([held.tx, held.ty]).toEqual([den.tx, den.ty]);
    harness.dispose();
  });
});

describe("the picture", () => {
  it("draws an unrevealed tile as flat darkness", async () => {
    const harness = await playing();
    harness.debug.setForagerTile(17, 15);
    await harness.engine.advance(2);

    const snapshot = harness.debug.snapshot();
    const grid = snapshot.grid;
    let dark: [number, number] | null = null;
    for (let ty = 0; ty < grid.rows && !dark; ty++) {
      for (let tx = 0; tx < grid.cols; tx++) {
        if (snapshot.visibility[ty][tx] !== "u") continue;
        dark = [
          grid.originX + tx * grid.tile + grid.tile / 2,
          grid.originY + ty * grid.tile + grid.tile / 2,
        ];
        break;
      }
    }
    expect(dark).not.toBeNull();
    const [red, green, blue] = harness.pixel(dark![0], dark![1]);
    // No brighter than a tenth of full brightness (specs/overview.md).
    expect(Math.max(red, green, blue)).toBeLessThanOrEqual(26);
    harness.dispose();
  });

  it("draws the forager, its light, and the HUD on the live screen", async () => {
    const harness = await playing();
    harness.debug.setForagerTile(17, 15);
    harness.debug.setBrightness(1);
    await harness.engine.advance(2);

    const forager = harness.debug.snapshot().forager;
    const body = harness.pixel(forager.x, forager.y);
    expect(Math.max(...body)).toBeGreaterThan(120);
    // The corridor beside it is lit rather than black.
    const beside = harness.pixel(forager.x - 32, forager.y);
    expect(Math.max(...beside)).toBeGreaterThan(26);

    // The HUD's top strip carries the score in large light digits.
    let ink = 0;
    for (let x = 40; x < 200; x += 2) {
      for (let y = 20; y < 64; y += 2) {
        if (Math.max(...harness.pixel(x, y)) > 120) ink += 1;
      }
    }
    expect(ink).toBeGreaterThan(20);
    harness.dispose();
  });

  it("draws every screen without leaving the stage blank", async () => {
    const harness = await createHarness();
    const drawn = async (): Promise<number> => {
      await harness.engine.advance(1);
      let lit = 0;
      for (let x = 8; x < STAGE_W; x += 8) {
        for (let y = 8; y < STAGE_H; y += 8) {
          if (Math.max(...harness.pixel(x, y)) > 26) lit += 1;
        }
      }
      return lit;
    };

    expect(await drawn()).toBeGreaterThan(60);
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    expect(harness.debug.snapshot().screen).toBe("howto");
    expect(await drawn()).toBeGreaterThan(60);

    await harness.tap("Escape");
    harness.debug.setScreen("countdown");
    expect(await drawn()).toBeGreaterThan(60);
    harness.debug.setScreen("playing");
    expect(await drawn()).toBeGreaterThan(60);
    harness.dispose();
  });

  it("flashes the detection alert in the hunter's own color", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    // The Gloamfin's close hearing takes a fix through the build's own sense.
    harness.debug.setPredatorTile(1, start.tx + 1, start.ty);
    harness.debug.setPredatorState(1, "wander");
    minds(harness.debug, true);
    await harness.engine.advance(2);

    const alerted = harness.debug.snapshot().predators[1];
    expect(alerted.alert).toBe(true);
    expect(alerted.state).toBe("chase");
    expect(alerted.lit).toBe(true);

    await harness.engine.advance(ticks(ALERT_TIME) + 2);
    expect(harness.debug.snapshot().predators[1].alert).toBe(false);
    harness.dispose();
  });
});
