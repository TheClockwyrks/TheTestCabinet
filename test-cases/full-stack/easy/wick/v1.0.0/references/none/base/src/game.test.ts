import { describe, expect, it } from "vitest";
import { TICK_DT } from "./constants";
import { Game } from "./game";
import { idleRun } from "./state";

function game(): { game: Game; mute: { on: boolean } } {
  const mute = { on: false };
  const built = new Game({
    toggleMute: () => {
      mute.on = !mute.on;
    },
    isMuted: () => mute.on,
  });
  return { game: built, mute };
}

describe("the title screen", () => {
  it("opens on title with the idle run", () => {
    const { game: g } = game();
    expect(g.state.screen).toBe("title");
    expect(g.state.menuIndex).toBe(0);
    expect(g.state.run).toEqual(idleRun());
  });

  it("wraps the highlight both ways and sounds menu-move", () => {
    const { game: g } = game();
    g.handleAction("up");
    expect(g.state.menuIndex).toBe(1);
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(0);
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(1);
    expect(g.drainCues()).toEqual(["menu-move"]);
  });

  it("starts a fresh run on LIGHT THE LAMP", () => {
    const { game: g } = game();
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.weapons).toEqual([
      { id: "taper", level: 1, cooldown: 0, cooldownSet: 0 },
    ]);
    expect(g.state.run.player).toEqual({
      x: 0,
      y: 0,
      facing: "right",
      hp: 100,
    });
    expect(g.drainCues()).toEqual(["menu-confirm"]);
    expect(g.wantedLoops().has("music")).toBe(true);
  });

  it("opens howto on HOW TO PLAY and back returns", () => {
    const { game: g } = game();
    g.handleAction("down");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("howto");
    expect(g.state.menuIndex).toBe(0);
    g.handleAction("back");
    expect(g.state.screen).toBe("title");
    expect(g.wantedLoops().size).toBe(0);
  });

  it("ignores back and pause on title", () => {
    const { game: g } = game();
    g.handleAction("back");
    g.handleAction("pause");
    expect(g.state.screen).toBe("title");
  });
});

describe("pause", () => {
  it("holds the run under paused and resumes it untouched", () => {
    const { game: g } = game();
    g.startRun();
    g.update(0.5);
    g.state.accumulator = 0.01;
    g.handleAction("pause");
    expect(g.state.screen).toBe("paused");
    expect(g.state.accumulator).toBe(0);
    const tick = g.state.run.tick;
    g.update(1);
    expect(g.state.run.tick).toBe(tick);
    expect(g.wantedLoops().has("music")).toBe(true);
    g.handleAction("pause");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.tick).toBe(tick);
  });

  it("abandons the run on back", () => {
    const { game: g } = game();
    g.startRun();
    g.pause();
    g.handleAction("back");
    expect(g.state.screen).toBe("title");
    expect(g.state.run).toEqual(idleRun());
  });
});

describe("the end screens", () => {
  it("keeps the run, and TRY AGAIN or TITLE leave it", () => {
    const { game: g } = game();
    g.startRun();
    g.update(1);
    g.state.run.kills = 4;
    g.endRun("fallen");
    expect(g.state.screen).toBe("fallen");
    expect(g.state.run.kills).toBe(4);
    expect(g.wantedLoops().size).toBe(0);
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.kills).toBe(0);
    g.endRun("dawn");
    g.handleAction("down");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("title");
    g.startRun();
    g.endRun("dawn");
    g.handleAction("back");
    expect(g.state.screen).toBe("title");
  });
});

describe("the overlays", () => {
  it("opens the level-up overlay and chooses through the menu", () => {
    const { game: g } = game();
    g.startRun();
    g.state.run.pendingLevelUps = 1;
    expect(g.openLevelUp()).toBe(true);
    expect(g.state.screen).toBe("levelup");
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(1);
    g.handleAction("up");
    g.handleAction("up");
    expect(g.state.menuIndex).toBe(2);
    g.handleAction("back");
    g.handleAction("pause");
    expect(g.state.screen).toBe("levelup");
    const chosen = g.state.run.offers[2];
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(
      [...g.state.run.weapons, ...g.state.run.passives].some(
        (held) => held.id === chosen,
      ),
    ).toBe(true);
  });

  it("refuses to open with nothing pending or off playing", () => {
    const { game: g } = game();
    g.startRun();
    expect(g.openLevelUp()).toBe(false);
    g.state.run.pendingLevelUps = 1;
    g.pause();
    expect(g.openLevelUp()).toBe(false);
    expect(g.choose(0)).toBe(false);
  });

  it("closes the chest overlay on confirm alone", () => {
    const { game: g } = game();
    g.startRun();
    g.state.screen = "chest";
    g.state.run.chestResult = { kind: "heal" };
    g.handleAction("up");
    g.handleAction("back");
    g.handleAction("pause");
    expect(g.state.screen).toBe("chest");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.chestResult).toBeNull();
  });
});

describe("mute", () => {
  it("toggles the runtime bit from any screen and mirrors it", () => {
    const { game: g, mute } = game();
    g.handleAction("mute");
    expect(mute.on).toBe(true);
    g.mirrorMuted();
    expect(g.state.muted).toBe(true);
    g.startRun();
    g.handleAction("mute");
    g.mirrorMuted();
    expect(g.state.muted).toBe(false);
  });
});

describe("the accumulator", () => {
  it("consumes whole ticks and keeps the remainder on playing", () => {
    const { game: g } = game();
    g.startRun();
    g.update(0.04);
    expect(g.state.run.tick).toBe(2);
    expect(g.state.accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 12);
    g.update(0.5);
    expect(g.state.run.tick).toBe(32);
  });

  it("reaches the same tick however the time is divided", () => {
    const a = game().game;
    const b = game().game;
    a.startRun();
    b.startRun();
    a.update(0.5);
    for (let i = 0; i < 50; i += 1) b.update(0.01);
    expect(a.state.run.tick).toBe(30);
    expect(b.state.run.tick).toBe(30);
  });

  it("discards the remainder when a tick leaves playing", () => {
    const { game: g } = game();
    g.startRun();
    g.state.run.pendingLevelUps = 1;
    g.update(0.025);
    expect(g.state.screen).toBe("levelup");
    expect(g.state.run.tick).toBe(1);
    expect(g.state.accumulator).toBe(0);
    g.update(1);
    expect(g.state.run.tick).toBe(1);
  });

  it("stays at zero off playing", () => {
    const { game: g } = game();
    g.update(0.3);
    expect(g.state.accumulator).toBe(0);
    expect(g.state.run.tick).toBe(0);
  });
});

describe("reset", () => {
  it("returns to the title with a seeded generator, keeping muted", () => {
    const { game: g, mute } = game();
    g.startRun();
    g.update(1);
    g.state.switches.spawning = false;
    g.handleAction("mute");
    g.mirrorMuted();
    g.state.simTime = 5;
    g.autoStep = false;
    g.reset(42);
    expect(g.state.screen).toBe("title");
    expect(g.state.run).toEqual(idleRun());
    expect(g.state.switches.spawning).toBe(true);
    expect(g.state.simTime).toBe(0);
    expect(g.state.rngState).toBe(42);
    expect(g.state.muted).toBe(true);
    expect(mute.on).toBe(true);
    expect(g.autoStep).toBe(false);
    g.rng.next();
    expect(g.state.rngState).not.toBe(42);
  });

  it("replays the same run from the same seed", () => {
    const a = game().game;
    const b = game().game;
    a.reset(9);
    b.reset(9);
    for (const g of [a, b]) {
      g.startRun();
      g.state.run.pendingLevelUps = 3;
      g.update(TICK_DT);
      g.choose(1);
      g.choose(0);
    }
    expect(a.state.run.offers).toEqual(b.state.run.offers);
    expect(a.state.rngState).toBe(b.state.rngState);
  });
});
