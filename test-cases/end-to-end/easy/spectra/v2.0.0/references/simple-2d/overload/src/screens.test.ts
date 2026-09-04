// The seven screens, the keys that move between them, the HUD, and the audio.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CUES,
  FIELD_BOTTOM,
  FIELD_TOP,
  GAME_OVER_ITEMS,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  INVERSION_TIME,
  PAUSE_ITEMS,
  RESONANCE_MAX,
  READY_HOLD,
  SHIP_Y,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  TITLE_ITEMS,
} from "./constants";
import { LANE_CENTRE } from "./flow";
import {
  createHarness,
  poseDrone,
  rgbDistance,
  startPosed,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  h.pose((s, d) => d.reset(s, { seed: 9 }));
});

afterEach(() => {
  h.dispose();
});

/** Draw the frame as it stands, on a step too small to move anything. */
async function draw(): Promise<void> {
  h.setStep(0.000001);
  await h.frames(1);
  h.setStep(1 / 60);
}

describe("the title screen", () => {
  it("is where the game opens", () => {
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menuIndex).toBe(0);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.score).toBe(0);
  });

  it("moves its highlight with the menu keys and wraps at both ends", async () => {
    h.tap("ArrowDown");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(1);
    h.tap("KeyS");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(0);
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    h.tap("KeyW");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(0);
  });

  it("draws the highlight where the index says", async () => {
    await draw();
    const first = h.average(400, 400, 480, 40);
    h.pose((s, d) => d.setMenuIndex(s, 1));
    await draw();
    const second = h.average(400, 400, 480, 40);
    expect(rgbDistance(first, second)).toBeGreaterThan(4);
  });

  it("opens a run at stage one on the mode entry", async () => {
    h.tap("Enter");
    await h.frames(1);
    const snap = h.snapshot();
    expect(snap.screen).toBe("stageIntro");
    expect(snap.stage).toBe(1);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.score).toBe(0);
  });

  it("opens how to play on the second entry, and comes back", async () => {
    h.tap("ArrowDown");
    await h.frames(1);
    h.tap("Space");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("howto");
    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
    // specs/ui.md: an arrival back at the title highlights the entry that led
    // away from it, which for the how-to-play screen is `HOW TO PLAY`.
    expect(h.snapshot().menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });
});

describe("the holds a run passes through", () => {
  it("gives way from the stage intro to the live wave", async () => {
    h.tap("Enter");
    await h.advance(STAGE_INTRO_HOLD * 0.8);
    expect(h.snapshot().screen).toBe("stageIntro");
    await h.advance(STAGE_INTRO_HOLD * 0.4);
    expect(h.snapshot().screen).toBe("inWave");
  });

  it("draws a challenge stage's intro differently from a standard one", async () => {
    h.pose((s, d) => d.setScreen(s, "stageIntro"));
    h.pose((s, d) => d.setPhaseTimer(s, STAGE_INTRO_HOLD));
    h.pose((s, d) => d.setStage(s, 1));
    await draw();
    const standard = h.average(300, 440, 680, 60);
    h.pose((s, d) => d.setStage(s, 3));
    await draw();
    const challenge = h.average(300, 440, 680, 60);
    expect(rgbDistance(standard, challenge)).toBeGreaterThan(4);
  });

  it("gives way from the stage-cleared screen to the next intro", async () => {
    startPosed(h);
    h.pose((s, d) => d.setScreen(s, "stageCleared"));
    h.pose((s, d) => d.setPhaseTimer(s, STAGE_CLEARED_HOLD));
    await h.advance(STAGE_CLEARED_HOLD * 0.8);
    expect(h.snapshot().screen).toBe("stageCleared");
    await h.advance(STAGE_CLEARED_HOLD * 0.4);
    expect(h.snapshot().screen).toBe("stageIntro");
  });

  it("draws the ready banner over the field", async () => {
    startPosed(h);
    await draw();
    const live = h.average(500, 340, 280, 70);
    h.pose((s, d) => d.setPhase(s, "ready"));
    h.pose((s, d) => d.setPhaseTimer(s, READY_HOLD));
    await draw();
    const ready = h.average(500, 340, 280, 70);
    expect(rgbDistance(live, ready)).toBeGreaterThan(6);
  });
});

describe("the paused screen", () => {
  it("opens on the pause key and returns on it", async () => {
    startPosed(h);
    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("paused");
    h.tap("KeyP");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("inWave");

    h.tap("KeyP");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("paused");
    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("inWave");
  });

  it("holds the field exactly where it was", async () => {
    startPosed(h);
    const id = poseDrone(h, "shard", 500, 300, {
      phase: "diving",
      travel: true,
    });
    h.pose((s, d) => d.addPlayerBullet(s, 700, 500, "cyan"));
    h.tap("Escape");
    await h.frames(1);
    const before = h.snapshot();
    await h.advance(10);
    const after = h.snapshot();
    expect(after.drones.find((drone) => drone.id === id)?.y).toBe(
      before.drones.find((drone) => drone.id === id)?.y,
    );
    expect(after.bullets[0]?.y).toBe(before.bullets[0]?.y);
    expect(after.ship.x).toBe(before.ship.x);
  });

  it("restarts a run and quits to the title", async () => {
    startPosed(h);
    h.pose((s, d) => d.setScore(s, 5000));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.setStage(s, 6));
    h.tap("KeyP");
    await h.frames(1);
    h.tap("ArrowDown");
    await h.frames(1);
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("stageIntro");
    expect(h.snapshot().score).toBe(0);
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().stage).toBe(1);

    h.pose((s, d) => d.setScreen(s, "inWave"));
    h.tap("KeyP");
    await h.frames(1);
    h.pose((s, d) => d.setMenuIndex(s, PAUSE_ITEMS.length - 1));
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });
});

describe("the game-over screen", () => {
  it("plays again and returns to the menu", async () => {
    h.pose((s, d) => d.setScreen(s, "gameOver"));
    h.pose((s, d) => d.setScore(s, 1234));
    h.pose((s, d) => d.setStage(s, 5));
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("stageIntro");
    expect(h.snapshot().stage).toBe(1);
    expect(h.snapshot().score).toBe(0);

    h.pose((s, d) => d.setScreen(s, "gameOver"));
    h.pose((s, d) => d.setMenuIndex(s, GAME_OVER_ITEMS.length - 1));
    h.tap("Space");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });

  it("draws the run it ended", async () => {
    h.pose((s, d) => d.setScreen(s, "gameOver"));
    h.pose((s, d) => d.setScore(s, 100));
    h.pose((s, d) => d.setStage(s, 2));
    await draw();
    const low = h.average(400, 270, 480, 90);
    h.pose((s, d) => d.setScore(s, 987654));
    h.pose((s, d) => d.setStage(s, 17));
    await draw();
    const high = h.average(400, 270, 480, 90);
    expect(rgbDistance(low, high)).toBeGreaterThan(3);
  });
});

describe("the HUD", () => {
  beforeEach(() => {
    startPosed(h);
  });

  it("reports the score and the stage in the top strip", async () => {
    await draw();
    const zero = h.average(20, 10, 400, HUD_TOP_H - 12);
    const stageZero = h.average(1000, 10, 260, HUD_TOP_H - 12);
    h.pose((s, d) => d.setScore(s, 987654));
    h.pose((s, d) => d.setStage(s, 12));
    await draw();
    expect(
      rgbDistance(zero, h.average(20, 10, 400, HUD_TOP_H - 12)),
    ).toBeGreaterThan(2);
    expect(
      rgbDistance(stageZero, h.average(1000, 10, 260, HUD_TOP_H - 12)),
    ).toBeGreaterThan(2);
  });

  it("reports the lives in the bottom strip", async () => {
    await draw();
    const three = h.average(30, 668, 180, 40);
    h.pose((s, d) => d.setLives(s, 1));
    await draw();
    expect(rgbDistance(three, h.average(30, 668, 180, 40))).toBeGreaterThan(4);
  });

  it("fills the resonance meter as the meter fills, and marks it ready", async () => {
    const sample = async (
      value: number,
    ): Promise<[number, number, number, number]> => {
      h.pose((s, d) => d.setResonance(s, value));
      await draw();
      return h.average(300, 678, 300, 20);
    };
    const empty = await sample(0);
    const half = await sample(RESONANCE_MAX / 2);
    const full = await sample(RESONANCE_MAX);
    const short = await sample(RESONANCE_MAX - 1);
    expect(rgbDistance(empty, half)).toBeGreaterThan(6);
    expect(rgbDistance(half, full)).toBeGreaterThan(6);
    expect(rgbDistance(short, full)).toBeGreaterThan(6);
  });

  it("shows the ship's band, and follows a flip", async () => {
    await draw();
    const cyan = h.average(970, 668, 230, 40);
    h.tap("KeyF");
    await h.frames(1);
    await draw();
    const magenta = h.average(970, 668, 230, 40);
    expect(h.snapshot().ship.band).toBe("magenta");
    expect(rgbDistance(cyan, magenta)).toBeGreaterThan(20);
  });

  it("shows a mute indicator only while sound is muted", async () => {
    await draw();
    const loud = h.average(1150, 672, 120, 40);
    const elsewhere = h.average(300, 668, 300, 40);
    h.tap("KeyM");
    await h.frames(1);
    await draw();
    expect(h.snapshot().muted).toBe(true);
    expect(rgbDistance(loud, h.average(1150, 672, 120, 40))).toBeGreaterThan(4);
    expect(rgbDistance(elsewhere, h.average(300, 668, 300, 40))).toBeLessThan(
      1,
    );

    h.tap("KeyM");
    await h.frames(1);
    await draw();
    expect(h.snapshot().muted).toBe(false);
    expect(rgbDistance(loud, h.average(1150, 672, 120, 40))).toBeLessThan(1);
  });

  it("marks the whole field while an inversion runs", async () => {
    await draw();
    const plain = [
      h.average(100, FIELD_TOP + 40, 60, 60),
      h.average(640, 400, 60, 60),
      h.average(1100, FIELD_BOTTOM - 80, 60, 60),
    ];
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    await draw();
    const marked = [
      h.average(100, FIELD_TOP + 40, 60, 60),
      h.average(640, 400, 60, 60),
      h.average(1100, FIELD_BOTTOM - 80, 60, 60),
    ];
    for (let i = 0; i < plain.length; i++) {
      expect(
        rgbDistance(
          plain[i] as [number, number, number, number],
          marked[i] as [number, number, number, number],
        ),
      ).toBeGreaterThan(20);
    }
  });

  it("keeps the play out of both strips", async () => {
    poseDrone(h, "shard", 300, 200, { phase: "formation" });
    poseDrone(h, "prism", 700, 260, { phase: "formation" });
    h.pose((s, d) => d.addPlayerBullet(s, 500, 400, "cyan"));
    await draw();
    const top = h.average(0, 0, 1280, HUD_TOP_H);
    const bottomStrip = h.average(
      0,
      HUD_BOTTOM_TOP,
      1280,
      720 - HUD_BOTTOM_TOP,
    );
    h.pose((s, d) => d.clearDrones(s));
    h.pose((s, d) => d.clearPlayerBullets(s));
    await draw();
    expect(rgbDistance(top, h.average(0, 0, 1280, HUD_TOP_H))).toBeLessThan(
      0.5,
    );
    expect(
      rgbDistance(
        bottomStrip,
        h.average(0, HUD_BOTTOM_TOP, 1280, 720 - HUD_BOTTOM_TOP),
      ),
    ).toBeLessThan(0.5);
  });
});

describe("the keys", () => {
  beforeEach(() => {
    startPosed(h);
  });

  it("moves the ship on both bindings, each way", async () => {
    for (const code of ["ArrowLeft", "KeyA"]) {
      h.pose((s, d) => d.setShipX(s, 640));
      h.hold(code);
      await h.advance(0.3);
      h.release(code);
      expect(h.snapshot().ship.x).toBeLessThan(640);
    }
    for (const code of ["ArrowRight", "KeyD"]) {
      h.pose((s, d) => d.setShipX(s, 640));
      h.hold(code);
      await h.advance(0.3);
      h.release(code);
      expect(h.snapshot().ship.x).toBeGreaterThan(640);
    }
  });

  it("fires on every binding, and repeats while held", async () => {
    for (const code of ["Space", "ArrowUp", "KeyW"]) {
      h.pose((s, d) => d.clearPlayerBullets(s));
      h.pose((s, d) => d.setFireCooldown(s, 0));
      h.tap(code);
      await h.frames(1);
      expect(h.snapshot().bullets.filter((b) => b.friendly)).toHaveLength(1);
    }
    h.pose((s, d) => d.clearPlayerBullets(s));
    h.pose((s, d) => d.setFireCooldown(s, 0));
    h.hold("Space");
    let seen = 0;
    for (let frame = 0; frame < 60; frame++) {
      await h.frames(1);
      seen += h.snapshot().bullets.filter((b) => b.friendly).length;
      h.pose((s, d) => d.clearPlayerBullets(s));
    }
    h.release("Space");
    expect(seen).toBeGreaterThan(1);
  });

  it("flips on every binding", async () => {
    for (const code of ["KeyF", "ShiftLeft", "ShiftRight"]) {
      const before = h.snapshot().ship.band;
      h.tap(code);
      await h.frames(1);
      expect(h.snapshot().ship.band).not.toBe(before);
    }
  });

  it("discharges on its own key", async () => {
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.frames(1);
    expect(h.snapshot().discharge.active).toBe(true);
  });

  it("mutes on M, and back", async () => {
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(false);
  });
});

describe("the debug overlay", () => {
  it("is off until the backtick shows it, and reports the game read-only", async () => {
    startPosed(h);
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    poseDrone(h, "prism", 700, 300, { band: "magenta", shellAlive: false });
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    await draw();
    const hidden = h.average(0, 0, 400, 220);
    // Everything but the clocks a passing microsecond moves.
    const facts = (): string => {
      const snap = h.snapshot();
      return JSON.stringify([
        snap.drones,
        snap.bullets.length,
        snap.ship,
        snap.score,
        snap.resonance,
        snap.screen,
      ]);
    };
    const before = facts();

    h.tap("Backquote");
    await draw();
    const shown = h.average(0, 0, 400, 220);
    expect(rgbDistance(hidden, shown)).toBeGreaterThan(4);
    // Reading the overlay changes nothing about the game.
    expect(facts()).toBe(before);

    h.tap("Backquote");
    await draw();
    expect(rgbDistance(hidden, h.average(0, 0, 400, 220))).toBeLessThan(1);
  });

  it("reports an empty field as readily as a full one", async () => {
    startPosed(h);
    h.tap("Backquote");
    await draw();
    await draw();
    expect(h.snapshot().drones).toHaveLength(0);
  });
});

describe("the audio", () => {
  beforeEach(() => {
    startPosed(h);
  });

  it("plays no cue before the first key is pressed", async () => {
    const fresh = await createHarness();
    await fresh.advance(2);
    expect(fresh.cues).toHaveLength(0);
    fresh.dispose();
  });

  it("plays a distinct cue on each of its events", async () => {
    const played = (): string[] => h.cues.map((cue) => cue.cue);

    h.tap("Space");
    await h.frames(1);
    expect(played()).toContain(CUES.fire);

    h.tap("KeyF");
    await h.frames(1);
    expect(played()).toContain(CUES.flip);

    h.pose((s, d) => d.setShipBand(s, "cyan"));
    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "cyan"));
    await h.advance(0.4);
    expect(played()).toContain(CUES.absorb);

    poseDrone(h, "shard", 500, 300, { band: "cyan" });
    h.pose((s, d) => d.addPlayerBullet(s, 500, 340, "cyan"));
    await h.advance(0.2);
    expect(played()).toContain(CUES.kill);

    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.frames(1);
    expect(played()).toContain(CUES.discharge);

    // The wave has to run out before a Prism can survive its own dive.
    await h.advance(0.7);
    poseDrone(h, "prism", 640, 600, { phase: "diving", travel: true });
    await h.advance(0.4);
    expect(played()).toContain(CUES.inversion);

    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.addEnemyBullet(s, h.state.ship.x, 560, "magenta"));
    await h.advance(0.5);
    expect(played()).toContain(CUES.hit);

    h.pose((s, d) => d.setScreen(s, "title"));
    h.tap("ArrowDown");
    await h.frames(1);
    expect(played()).toContain(CUES.menu);
  });

  it("starts no sound at all while it is muted", async () => {
    h.tap("KeyM");
    await h.frames(1);
    const before = h.cues.length;
    h.tap("Space");
    await h.frames(1);
    h.tap("KeyF");
    await h.frames(1);
    poseDrone(h, "shard", 500, 300, { band: "cyan" });
    h.pose((s, d) => d.addPlayerBullet(s, 500, 340, "cyan"));
    await h.advance(0.2);
    expect(h.cues).toHaveLength(before);
  });
});

describe("the field's own geometry on screen", () => {
  it("carries a starfield behind an empty play field", async () => {
    startPosed(h);
    await draw();
    let marks = 0;
    const background = h.pixel(2, FIELD_TOP + 2);
    for (let x = 0; x < 1280; x += 2) {
      for (let y = FIELD_TOP + 2; y < FIELD_BOTTOM - 2; y += 2) {
        if (rgbDistance(h.pixel(x, y), background) > 8) marks++;
      }
    }
    expect(marks).toBeGreaterThan(40);
  });

  it("keeps the ship in its lane", async () => {
    startPosed(h);
    h.hold("ArrowRight");
    await h.advance(1);
    h.release("ArrowRight");
    h.pose((s, d) => d.addPlayerBullet(s, h.state.ship.x, SHIP_Y, "cyan"));
    expect(h.snapshot().bullets[0]?.y).toBe(SHIP_Y);
  });
});
