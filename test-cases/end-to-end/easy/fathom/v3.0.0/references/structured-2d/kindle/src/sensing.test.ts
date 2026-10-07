// Fathom — the senses, run on the real engine.
//
// The fog and the light, the sonar pulse and what it marks, the Gloamfin's own
// ping, the Flarefish's flare, the ink, the wrap tunnel and the drifter
// cadence: each posed as a fixture and read back through the debug surface, so
// what is checked is the game a player meets rather than a module in isolation.

import { describe, expect, it } from "vitest";
import {
  DRIFTER_INTERVAL,
  DRIFTER_SPEED,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  GLOAMFIN_PING_RANGE,
  GRID_COLS,
  INK_RADIUS,
  SONAR_MARK_TIME,
  SONAR_RANGE_BASE,
  SONAR_WAVE_SPEED,
  TICK_HZ,
  TILE,
} from "./constants";
import { anchor, stampLayout } from "./fixtures";
import { createHarness, type Harness } from "./harness";
import { HALL, PERCH, at, minds, pose } from "./scenarios";
import type { FathomSnapshot } from "./debug";

function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** A harness in live play with the board dark, quiet and fully posed. */
async function posed(art: readonly string[]): Promise<Harness> {
  const harness = await createHarness();
  harness.debug.setScreen("playing");
  minds(harness.debug, false);
  pose(harness.debug, art);
  // A board with nothing to graze keeps the forager dark and the count steady.
  harness.debug.clearPlankton();
  harness.debug.setBrightness(0);
  return harness;
}

function revealed(snapshot: FathomSnapshot): number {
  return snapshot.visibility
    .join("")
    .split("")
    .filter((tile) => tile !== "u").length;
}

describe("the fog of war", () => {
  it("lights a pocket around the forager and remembers what it leaves", async () => {
    const harness = await posed(HALL);
    const start = at(stampLayout(HALL), "F");
    harness.debug.setForagerTile(start.tx + 1, start.ty);
    await harness.engine.advance(2);

    const lit = harness.debug.snapshot();
    expect(lit.visibility[start.ty][start.tx + 1]).toBe("l");
    expect(lit.visibility[start.ty][start.tx]).toBe("l");
    // The light stops at the rock it lands on: the tile past a wall is dark.
    expect(lit.visibility[start.ty - 1][start.tx - 1]).toBe("u");

    harness.debug.setForagerTile(start.tx + 7, start.ty);
    await harness.engine.advance(2);
    const later = harness.debug.snapshot();
    expect(later.visibility[start.ty][start.tx]).toBe("r");
    expect(later.visibility[start.ty][start.tx + 7]).toBe("l");
    harness.dispose();
  });

  it("widens the pocket as the forager brightens", async () => {
    const harness = await posed(HALL);
    const start = at(stampLayout(HALL), "F");
    harness.debug.setForagerTile(start.tx + 4, start.ty);
    harness.debug.setBrightness(0);
    await harness.engine.advance(2);
    const dim = revealed(harness.debug.snapshot());

    harness.debug.setBrightness(1);
    await harness.engine.advance(2);
    expect(revealed(harness.debug.snapshot())).toBeGreaterThan(dim);
    harness.dispose();
  });
});

describe("the sonar pulse", () => {
  it("travels outward through the corridors, near tiles before far ones", async () => {
    const harness = await posed(HALL);
    const start = at(stampLayout(HALL), "F");
    harness.debug.setForagerTile(start.tx, start.ty);
    await harness.engine.advance(2);
    const before = revealed(harness.debug.snapshot());

    await harness.tap("Space");
    const pulse = harness.debug.snapshot().pulses[0];
    expect(pulse.range).toBe(SONAR_RANGE_BASE);
    expect([pulse.ox, pulse.oy]).toEqual([start.tx, start.ty]);

    await harness.engine.advance(ticks(0.2));
    const early = harness.debug.snapshot();
    await harness.engine.advance(ticks(0.4));
    const late = harness.debug.snapshot();

    expect(revealed(early)).toBeGreaterThan(before);
    expect(revealed(late)).toBeGreaterThan(revealed(early));
    // The front advances at the wavefront speed the specification fixes.
    const earlyFront = early.pulses[0].front;
    const lateFront = late.pulses[0].front;
    expect(lateFront - earlyFront).toBeCloseTo(SONAR_WAVE_SPEED * 0.4, 1);

    // It leaves the game once its front passes its range.
    const gone = await harness.until(
      () => harness.debug.snapshot().pulses.length === 0,
      ticks(SONAR_RANGE_BASE / SONAR_WAVE_SPEED + 0.5),
    );
    expect(gone).toBe(true);
    harness.dispose();
  });

  it("marks the Gloamfin and the Flarefish, and leaves the Lanternjaw alone", async () => {
    const harness = await posed(HALL);
    const fixture = stampLayout(HALL);
    const start = at(fixture, "F");
    harness.debug.setForagerTile(start.tx, start.ty);
    // Five tiles out, past the light pocket at brightness zero and inside the
    // pulse's range, so what shows a hunter is the mark and nothing else.
    harness.debug.setPredatorTile(0, start.tx + 5, start.ty);
    harness.debug.setPredatorState(0, "wander");
    harness.debug.setPredatorTile(1, start.tx + 6, start.ty);
    harness.debug.setPredatorState(1, "wander");
    harness.debug.setPredatorTile(2, start.tx + 7, start.ty);
    harness.debug.setPredatorState(2, "wander");
    await harness.engine.advance(2);
    expect(harness.debug.snapshot().predators.every((p) => !p.lit)).toBe(true);

    await harness.tap("Space");
    const swept = await harness.until(
      () => harness.debug.snapshot().predators[2].lit,
      ticks(1),
    );
    expect(swept).toBe(true);
    const marked = harness.debug.snapshot();
    expect(marked.predators[1].lit).toBe(true);
    expect(marked.predators[2].lit).toBe(true);
    // A pulse never resolves which amber glimmer is which.
    expect(marked.predators[0].lit).toBe(false);

    await harness.engine.advance(ticks(SONAR_MARK_TIME) + 4);
    expect(harness.debug.snapshot().predators[1].lit).toBe(false);
    harness.dispose();
  });

  it("hands a Gloamfin the pulse reaches a fix on the forager", async () => {
    const harness = await posed(HALL);
    const fixture = stampLayout(HALL);
    const start = at(fixture, "F");
    harness.debug.setForagerTile(start.tx, start.ty);
    harness.debug.setPredatorTile(1, start.tx + 6, start.ty);
    harness.debug.setPredatorState(1, "wander");
    minds(harness.debug, true);
    // The hunter is boxed in nowhere, so it holds still until the front lands.
    expect(harness.debug.snapshot().predators[1].state).toBe("wander");

    await harness.tap("Space");
    const heard = await harness.until(
      () => harness.debug.snapshot().predators[1].state === "chase",
      ticks(1),
    );
    expect(heard).toBe(true);
    expect(harness.debug.snapshot().predators[1].alert).toBe(true);
    harness.dispose();
  });
});

describe("the Gloamfin's ping", () => {
  it("casts a violet wavefront of its own that reveals no tile", async () => {
    const harness = await posed(PERCH);
    const fixture = stampLayout(PERCH);
    const start = at(fixture, "F");
    const perch = anchor(fixture, "X");
    // On its sealed perch it hears nothing and reaches nothing, so what it
    // does over the window is cast its own ping on its own cadence.
    harness.debug.setForagerTile(start.tx, start.ty);
    harness.debug.setPredatorTile(1, perch.tx, perch.ty);
    harness.debug.setPredatorState(1, "wander");
    minds(harness.debug, true);
    await harness.engine.advance(2);
    const before = revealed(harness.debug.snapshot());

    const pinged = await harness.until(
      () =>
        harness.debug
          .snapshot()
          .pulses.some((pulse) => pulse.source === "gloamfin"),
      ticks(6),
    );
    expect(pinged).toBe(true);
    const ping = harness.debug
      .snapshot()
      .pulses.find((pulse) => pulse.source === "gloamfin");
    expect(ping?.tint).toBe("violet");
    expect(ping?.range).toBe(GLOAMFIN_PING_RANGE);
    expect(harness.cues.map((cue) => cue.cue)).toContain("predator-ping");

    // A ping reveals no tile and remembers none.
    await harness.engine.advance(ticks(0.4));
    expect(revealed(harness.debug.snapshot())).toBe(before);
    harness.dispose();
  });

  it("hands the Gloamfin a fix when its own front reaches the forager", async () => {
    // One straight hall. The forager rests seven tiles from the hunter: well
    // past GLOAMFIN_HEAR, and inside the ping's range of nine corridor steps.
    const HALLWAY = ["G.......F"];
    const harness = await posed(HALLWAY);
    const fixture = stampLayout(HALLWAY);
    const forager = at(fixture, "F");
    const hunter = at(fixture, "G");
    expect(
      Math.abs(forager.tx - hunter.tx) + Math.abs(forager.ty - hunter.ty),
    ).toBeLessThanOrEqual(GLOAMFIN_PING_RANGE);

    harness.debug.setForagerTile(forager.tx, forager.ty);
    harness.debug.setPredatorTile(1, hunter.tx, hunter.ty);
    harness.debug.setPredatorState(1, "wander");
    minds(harness.debug, true);

    // The hunter is held on its own tile for the whole window, so it never
    // closes to hearing range and the ping is the only sense left to it.
    const park = (): void => {
      harness.debug.setPredatorTile(1, hunter.tx, hunter.ty);
    };
    let cast = -1;
    let heard = -1;
    for (let frame = 0; frame < ticks(8); frame++) {
      park();
      await harness.engine.advance(1);
      const snapshot = harness.debug.snapshot();
      const gloamfin = snapshot.predators[1];
      expect(gloamfin.hearingLock).toBe(false);
      if (
        cast < 0 &&
        snapshot.pulses.some((pulse) => pulse.source === "gloamfin")
      ) {
        cast = frame;
        // The ping carries the sound outward, so nothing is heard yet.
        expect(gloamfin.state).toBe("wander");
      }
      if (cast >= 0 && gloamfin.state === "chase") {
        heard = frame;
        expect(gloamfin.alert).toBe(true);
        break;
      }
    }

    expect(cast).toBeGreaterThanOrEqual(0);
    expect(heard).toBeGreaterThan(cast);
    // The front stands SONAR_WAVE_SPEED steps out each second, so the fix
    // arrives when it has covered the seven tiles between them.
    const travel = (heard - cast) / TICK_HZ;
    expect(travel).toBeGreaterThan(0);
    expect(travel).toBeLessThan(GLOAMFIN_PING_RANGE / SONAR_WAVE_SPEED + 0.1);
    harness.dispose();
  });
});

describe("the Flarefish's flare", () => {
  it("charges, blooms to its lit radius, and lights a disc through rock", async () => {
    const harness = await posed(PERCH);
    const fixture = stampLayout(PERCH);
    const start = at(fixture, "F");
    const pocket = anchor(fixture, "X");
    harness.debug.setForagerTile(start.tx, start.ty);
    harness.debug.setPredatorTile(2, pocket.tx, pocket.ty);
    harness.debug.setPredatorState(2, "wander");
    minds(harness.debug, true);

    // The flare's own cadence is seconds of simulation rather than pictures.
    const charging = await harness.waitFor(
      () => harness.debug.snapshot().predators[2].flareCharging === true,
      FLARE_INTERVAL + 1,
    );
    expect(charging).toBe(true);
    expect(harness.debug.snapshot().predators[2].flaring).toBe(false);

    const blooming = await harness.until(
      () => harness.debug.snapshot().predators[2].flaring === true,
      ticks(FLARE_CHARGE + 0.2),
    );
    expect(blooming).toBe(true);
    // Read the radius a beat after the flag, so a build that lights the disc
    // on the next step is read as it stands rather than mid-change.
    await harness.engine.advance(2);
    const burning = harness.debug.snapshot();
    expect(burning.predators[2].flareRadius).toBe(FLARE_RADIUS);
    expect(burning.predators[2].lit).toBe(true);
    // The disc ignores rock: the pocket is sealed, and its neighbours light.
    expect(burning.visibility[pocket.ty][pocket.tx]).toBe("l");
    expect(burning.visibility[pocket.ty - 1][pocket.tx]).toBe("l");
    expect(burning.visibility[pocket.ty][pocket.tx - 1]).toBe("l");

    const over = await harness.waitFor(
      () => harness.debug.snapshot().predators[2].flaring === false,
      FLARE_BLOOM + 0.2,
    );
    expect(over).toBe(true);
    await harness.engine.advance(2);
    const after = harness.debug.snapshot();
    expect(after.predators[2].flareRadius).toBe(0);
    // The disc drops from lit back to remembered, and stays revealed.
    expect(after.visibility[pocket.ty - 1][pocket.tx]).toBe("r");
    expect(harness.cues.map((cue) => cue.cue)).toContain("flare");
    harness.dispose();
  });
});

describe("ink", () => {
  it("blinds a hunter that sees and leaves it wandering", async () => {
    const harness = await posed(HALL);
    const fixture = stampLayout(HALL);
    const start = at(fixture, "F");
    harness.debug.setForagerTile(start.tx, start.ty);
    harness.debug.setPredatorTile(0, start.tx + 3, start.ty);
    harness.debug.setPredatorState(0, "wander");
    harness.debug.setBrightness(1);
    minds(harness.debug, true);
    await harness.engine.advance(2);
    expect(harness.debug.snapshot().predators[0].state).toBe("chase");

    await harness.tap("ShiftLeft");
    await harness.engine.advance(4);
    const blinded = harness.debug.snapshot();
    expect(blinded.inkClouds[0].radius).toBe(INK_RADIUS);
    // The cloud lies on the line between the two, so the fix goes at once.
    expect(blinded.predators[0].state).toBe("wander");
    harness.dispose();
  });
});

describe("the wrap tunnel", () => {
  it("carries a body across the border as one ordinary step", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("playing");
    minds(harness.debug, false);

    const tiles = harness.debug.snapshot().tiles;
    const row = tiles.findIndex(
      (line) => line[0] === "." && line[GRID_COLS - 1] === ".",
    );
    expect(row).toBeGreaterThan(-1);

    harness.debug.setForagerTile(0, row);
    harness.down("ArrowLeft");
    const crossed = await harness.until(
      () => harness.debug.snapshot().forager.tx === GRID_COLS - 1,
      ticks(1),
    );
    expect(crossed).toBe(true);
    const forager = harness.debug.snapshot().forager;
    // Its center stays inside the maze region, carried across rather than
    // snapped, and nothing stopped at the border.
    expect(forager.x).toBeLessThanOrEqual(64 + GRID_COLS * TILE);
    expect(forager.x).toBeGreaterThanOrEqual(64);
    expect(forager.moving).toBe(true);
    harness.dispose();
  });
});

describe("the bonus drifters", () => {
  it("admits one at the den gate on its cadence, up to the ceiling", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("playing");
    minds(harness.debug, false);
    // Out of the way, so the forager grazes nothing and eats no drifter.
    harness.debug.setForagerTile(1, 1);
    expect(harness.debug.snapshot().drifters).toHaveLength(0);

    // The cadence is a long wait, so the same ticks run in fewer frames.
    const perFrame = 10;
    harness.pace(perFrame);
    const admitted = await harness.until(
      () => harness.debug.snapshot().drifters.length > 0,
      Math.ceil(ticks(DRIFTER_INTERVAL + 1) / perFrame),
    );
    expect(admitted).toBe(true);

    const tiles = harness.debug.snapshot().tiles;
    const drifter = harness.debug.snapshot().drifters[0];
    const gateRow = tiles.findIndex((line) => line.includes("g"));
    const gateCol = tiles[gateRow].indexOf("g");
    expect(
      Math.abs(drifter.tx - gateCol) + Math.abs(drifter.ty - gateRow),
    ).toBe(1);
    harness.dispose();
  });

  it("wanders the corridors at half the forager's pace once it is in", async () => {
    // A closed loop, so a wanderer always has somewhere to go, and the forager
    // sealed away from it, so nothing on the ring is ever eaten.
    const RING = [
      "F#######",
      "########",
      "#D.....#",
      "#.####.#",
      "#......#",
      "########",
    ];
    const harness = await posed(RING);
    const entry = at(stampLayout(RING), "D");
    harness.debug.spawnDrifter(entry.tx, entry.ty);
    minds(harness.debug, true);

    const seconds = 2;
    const opened = harness.debug.snapshot().drifters[0];
    let previous = opened;
    let travelled = 0;
    let furthest = 0;
    for (let frame = 0; frame < ticks(seconds); frame++) {
      await harness.engine.advance(1);
      const snapshot = harness.debug.snapshot();
      const drifter = snapshot.drifters[0];
      // It keeps to the corridor center lines for the whole window.
      expect(snapshot.tiles[drifter.ty][drifter.tx]).toBe(".");
      travelled += Math.hypot(drifter.x - previous.x, drifter.y - previous.y);
      furthest = Math.max(
        furthest,
        Math.hypot(drifter.x - opened.x, drifter.y - opened.y),
      );
      previous = drifter;
    }

    // DRIFTER_SPEED is half the forager's own pace, and a wanderer travels
    // without pause, so it covers that speed over the whole window.
    expect(travelled).toBeCloseTo(DRIFTER_SPEED * seconds, 3);
    expect(furthest).toBeGreaterThan(TILE);
    harness.dispose();
  });
});
