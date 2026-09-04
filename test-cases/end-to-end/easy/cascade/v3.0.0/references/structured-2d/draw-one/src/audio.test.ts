// The ten cues, each on its own event, and the mute that silences them all
// (specs/audio.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUES, HUD_SOUND, type CueName } from "./constants";
import { CUE_SPECS } from "./audio";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseNearlyWon,
  poseStock,
  poseWaste,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The cues raised by `act`, in order. */
function cuesOf(h: Harness, act: () => void): string[] {
  h.cues.length = 0;
  act();
  return h.cues.map((play) => play.cue);
}

describe("the cue vocabulary", () => {
  it("defines exactly the ten names the specification fixes", () => {
    expect(Object.keys(CUE_SPECS).sort()).toEqual(Object.values(CUES).sort());
    expect(Object.keys(CUE_SPECS)).toHaveLength(10);
  });

  it("gives each cue a sound of its own", () => {
    const shapes = Object.values(CUE_SPECS).map(
      (spec) => `${spec.wave}:${spec.freq}:${spec.freqTo}:${spec.durationMs}`,
    );
    expect(new Set(shapes).size).toBe(10);
  });

  it("declares every one of them on the engine's bus", () => {
    const audio = h.engine.world.audio;
    for (const cue of Object.values(CUES) as CueName[]) {
      expect(() => audio.play(cue), cue).not.toThrow();
    }
  });
});

describe("each event sounds its own cue", () => {
  it("sounds the deal, the turn and the recycle", () => {
    const { debug } = h;
    expect(cuesOf(h, () => debug.deal())).toContain(CUES.deal);

    openTable(debug);
    poseStock(debug, [{ suit: "spades", rank: 2 }]);
    expect(cuesOf(h, () => debug.turnStock())).toContain(CUES.turn);
    expect(cuesOf(h, () => debug.turnStock())).toContain(CUES.recycle);
  });

  it("sounds a lift, an accepted drop and a refused one", () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "hearts", 4);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 5 }]);

    const lifted = cuesOf(h, () => debug.pointerDown(274, 250));
    expect(lifted).toContain(CUES.lift);

    const dropped = cuesOf(h, () => {
      debug.pointerMove(640, 94);
      debug.pointerUp(640, 94);
    });
    expect(dropped).toContain(CUES.drop);
    expect(dropped).toContain(CUES.home);

    poseColumn(debug, 1, [{ suit: "hearts", rank: 9 }]);
    debug.pointerDown(396, 250);
    const refused = cuesOf(h, () => {
      debug.pointerMove(640, 94);
      debug.pointerUp(640, 94);
    });
    expect(refused).toContain(CUES.reject);
    expect(refused).not.toContain(CUES.drop);
  });

  it("sounds a card turning face-up and a card going home", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [
      { suit: "clubs", rank: 9, faceUp: false },
      { suit: "hearts", rank: 1 },
    ]);
    const cues = cuesOf(h, () => debug.autoMove("tableau", 0));
    expect(cues).toContain(CUES.flip);
    expect(cues).toContain(CUES.home);
  });

  it("sounds the win, and a cue for every card the cascade launches", async () => {
    const { debug } = h;
    openTable(debug);
    debug.setTrailPainting(false);
    poseNearlyWon(debug);
    const won = cuesOf(h, () => {
      debug.move("tableau", 0, 0, "foundation", 3);
    });
    expect(won).toContain(CUES.win);

    h.cues.length = 0;
    await h.seconds(0.5, 1 / 240);
    const launches = h.cues.filter((play) => play.cue === CUES.launch);
    expect(launches.length).toBeGreaterThan(1);
    expect(launches.length).toBe(debug.snapshot().launched);
  });

  it("sounds each cue at most once on the frame that raised it", async () => {
    const { debug } = h;
    openTable(debug);
    debug.setTrailPainting(false);
    poseFoundation(debug, 0, "spades", 13);
    poseFoundation(debug, 1, "hearts", 13);
    poseFoundation(debug, 2, "diamonds", 13);
    poseFoundation(debug, 3, "clubs", 13);
    debug.setScreen("won");
    debug.setLaunchClock(0);
    h.cues.length = 0;
    // One coarse frame covers several intervals, so several cards launch in it.
    const before = debug.snapshot().launched;
    await h.seconds(1, 1);
    expect(debug.snapshot().launched).toBeGreaterThan(before + 1);
    expect(h.cues.filter((play) => play.cue === CUES.launch)).toHaveLength(1);
  });
});

describe("muting", () => {
  it("silences every cue and restores them again", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [{ suit: "spades", rank: 2 }], [1]);

    const heard = (): number[] => h.cues.map((play) => play.gain);

    h.cues.length = 0;
    debug.pointerDown(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    debug.pointerUp(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    expect(debug.snapshot().muted).toBe(true);

    h.cues.length = 0;
    debug.deal();
    expect(heard()).toEqual([0]);

    h.cues.length = 0;
    debug.pointerDown(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    debug.pointerUp(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    expect(debug.snapshot().muted).toBe(false);

    h.cues.length = 0;
    debug.deal();
    expect(heard()[0]).toBeGreaterThan(0);
  });
});
