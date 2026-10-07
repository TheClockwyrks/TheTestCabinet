// The thirteen cues, as the engine plays them (specs/assets.md).
//
// Nothing here listens to sound: the engine reports every play, loop, and stop
// as an event, so what is checked is that the game raised the right cue on the
// frame its event happened and started and stopped the right loop.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUES, MINER_H, TILE } from "./constants";
import { CUE_NAMES, cuePath, LOOP_CUES, ONE_SHOT_CUES } from "./audio";
import {
  createHarness,
  installStorage,
  openScene,
  placeAt,
  standOn,
  type Harness,
} from "./test-support";

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  openScene(h);
});

afterEach(() => {
  h.dispose();
});

describe("the cue table", () => {
  it("names the thirteen cues the contract lists", () => {
    expect(CUE_NAMES).toHaveLength(13);
    expect(new Set(CUE_NAMES).size).toBe(13);
    for (const cue of [...LOOP_CUES, ...ONE_SHOT_CUES]) {
      expect(CUE_NAMES).toContain(cue);
    }
  });

  it("backs each cue with the produced clip at its stated path", () => {
    expect(cuePath(CUES.drill)).toBe("audio/drill.wav");
    expect(cuePath(CUES.music)).toBe("audio/music.wav");
  });
});

describe("what a frame sounds", () => {
  it("loops the music bed under every screen", async () => {
    await h.advance(1);
    expect(h.loops).toContain(CUES.music);
  });

  it("loops the drill while a cut runs and stops it when it ends", async () => {
    h.debug.setTile(5, 200, "rock");
    h.debug.setTile(5, 201, "rock");
    standOn(h, 5, 200);
    h.debug.setFuel(100);
    h.hold("down");
    await h.advance(6);
    expect(h.loops).toContain(CUES.drill);
    expect(h.engine.world.audio.looping(CUES.drill)).toBe(true);
    h.release("down");
    await h.advance(4);
    // Started once, and off the bus again the frame the cut ended.
    expect(h.loops.filter((cue) => cue === CUES.drill)).toHaveLength(1);
    expect(h.stops).toContain(CUES.drill);
    expect(h.engine.world.audio.looping(CUES.drill)).toBe(false);
  });

  it("loops the jetpack while thrust is held and stops it on release", async () => {
    placeAt(h, 5 * TILE, 200 * TILE);
    h.debug.setFuel(50);
    h.hold("up");
    await h.advance(4);
    expect(h.loops).toContain(CUES.thrust);
    expect(h.engine.world.audio.looping(CUES.thrust)).toBe(true);
    h.release("up");
    await h.advance(4);
    expect(h.engine.world.audio.looping(CUES.thrust)).toBe(false);
  });

  it("stops the low-fuel alarm once the tank is filled again", async () => {
    placeAt(h, 5 * TILE, 200 * TILE);
    h.debug.setMinerTravel(false);
    h.debug.setFuel(5);
    await h.advance(4);
    expect(h.engine.world.audio.looping(CUES.alarmFuel)).toBe(true);
    h.debug.setFuel(100);
    await h.advance(4);
    expect(h.engine.world.audio.looping(CUES.alarmFuel)).toBe(false);
  });

  it("plays the pickup once as an ore cell breaks", async () => {
    h.debug.setOreTile(5, 200, "ferron");
    h.debug.setTile(5, 201, "rock");
    standOn(h, 5, 200);
    h.debug.setFuel(100);
    h.hold("down");
    await h.seconds(2);
    h.release("down");
    expect(h.cues.filter((play) => play.cue === CUES.orePickup)).toHaveLength(
      1,
    );
  });

  it("plays the launch cue when the rocket lifts off", async () => {
    placeAt(h, 4 * TILE, -MINER_H);
    h.debug.setRocketInstalled(5);
    h.debug.launch();
    await h.advance(2);
    expect(h.cues.some((play) => play.cue === CUES.launch)).toBe(true);
  });

  it("reports a muted play at zero gain rather than not at all", async () => {
    h.debug.setOreTile(5, 200, "ferron");
    h.debug.setTile(5, 201, "rock");
    standOn(h, 5, 200);
    h.debug.setFuel(100);
    h.tap("mute");
    await h.advance(1);
    expect(h.debug.snapshot().muted).toBe(true);
    h.hold("down");
    await h.seconds(2);
    h.release("down");
    const pickup = h.cues.find((play) => play.cue === CUES.orePickup);
    expect(pickup).toBeDefined();
    expect(pickup?.gain).toBe(0);
  });

  it("mirrors the engine's mute bit into the state", async () => {
    expect(h.debug.snapshot().muted).toBe(false);
    h.tap("mute");
    await h.advance(1);
    expect(h.debug.snapshot().muted).toBe(true);
    // The status bar's own control toggles it back.
    h.click(1280 - 78 + 32, 28);
    await h.advance(1);
    expect(h.debug.snapshot().muted).toBe(false);
  });
});
