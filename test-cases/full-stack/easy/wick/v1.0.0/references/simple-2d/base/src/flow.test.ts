import { describe, expect, it } from "vitest";
import { TICK_DT, type ActionName, type CueName } from "./constants";
import { wantedLoops } from "./audio";
import {
  choose,
  consumeTime,
  endRun,
  handleAction,
  openLevelUpOverlay,
  pause,
  runFrame,
  startRun,
} from "./flow";
import { idleRun, initialState, type Draft } from "./state";
import { NOTHING_HELD } from "./sim/context";

interface World {
  state: Draft;
  mute: { on: boolean };
  cues: Set<CueName>;
  press(action: ActionName): void;
  drain(): CueName[];
  update(dt: number): void;
}

function world(seed = 1): World {
  const state = initialState(seed);
  const mute = { on: false };
  const cues = new Set<CueName>();
  return {
    state,
    mute,
    cues,
    press: (action) =>
      handleAction(state, action, cues, () => {
        mute.on = !mute.on;
      }),
    drain: () => {
      const out = [...cues];
      cues.clear();
      return out;
    },
    update: (dt) => consumeTime(state, dt, NOTHING_HELD, cues),
  };
}

describe("the title screen", () => {
  it("opens on title with the idle run", () => {
    const { state } = world();
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
    expect(state.run).toEqual(idleRun());
  });

  it("wraps the highlight both ways and sounds menu-move", () => {
    const w = world();
    w.press("up");
    expect(w.state.menuIndex).toBe(1);
    w.press("down");
    expect(w.state.menuIndex).toBe(0);
    w.press("down");
    expect(w.state.menuIndex).toBe(1);
    expect(w.drain()).toEqual(["menu-move"]);
  });

  it("starts a fresh run on LIGHT THE LAMP", () => {
    const w = world();
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.weapons).toEqual([
      { id: "taper", level: 1, cooldown: 0, cooldownSet: 0 },
    ]);
    expect(w.state.run.player).toEqual({
      x: 0,
      y: 0,
      facing: "right",
      hp: 100,
    });
    expect(w.drain()).toEqual(["menu-confirm"]);
    expect(wantedLoops(w.state)).toContain("music");
  });

  it("opens howto on HOW TO PLAY and back returns", () => {
    const w = world();
    w.press("down");
    w.press("confirm");
    expect(w.state.screen).toBe("howto");
    expect(w.state.menuIndex).toBe(0);
    w.press("back");
    expect(w.state.screen).toBe("title");
    expect(wantedLoops(w.state)).toEqual([]);
  });

  it("ignores back and pause on title", () => {
    const w = world();
    w.press("back");
    w.press("pause");
    expect(w.state.screen).toBe("title");
  });
});

describe("pause", () => {
  it("holds the run under paused and resumes it untouched", () => {
    const w = world();
    startRun(w.state);
    w.update(0.5);
    w.state.accumulator = 0.01;
    w.press("pause");
    expect(w.state.screen).toBe("paused");
    expect(w.state.accumulator).toBe(0);
    const tick = w.state.run.tick;
    w.update(1);
    expect(w.state.run.tick).toBe(tick);
    expect(wantedLoops(w.state)).toContain("music");
    w.press("pause");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.tick).toBe(tick);
  });

  it("abandons the run on back", () => {
    const w = world();
    startRun(w.state);
    pause(w.state);
    w.press("back");
    expect(w.state.screen).toBe("title");
    expect(w.state.run).toEqual(idleRun());
  });
});

describe("the end screens", () => {
  it("keeps the run, and TRY AGAIN or TITLE leave it", () => {
    const w = world();
    startRun(w.state);
    w.update(1);
    w.state.run.kills = 4;
    endRun(w.state, "fallen", w.cues);
    expect(w.state.screen).toBe("fallen");
    expect(w.state.run.kills).toBe(4);
    expect(w.drain()).toEqual(["fallen"]);
    expect(wantedLoops(w.state)).toEqual([]);
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.kills).toBe(0);
    endRun(w.state, "dawn", w.cues);
    w.press("down");
    w.press("confirm");
    expect(w.state.screen).toBe("title");
    startRun(w.state);
    endRun(w.state, "dawn", w.cues);
    w.press("back");
    expect(w.state.screen).toBe("title");
  });
});

describe("the overlays", () => {
  it("opens the level-up overlay and chooses through the menu", () => {
    const w = world();
    startRun(w.state);
    w.state.run.pendingLevelUps = 1;
    expect(openLevelUpOverlay(w.state, w.cues)).toBe(true);
    expect(w.state.screen).toBe("levelup");
    w.press("down");
    expect(w.state.menuIndex).toBe(1);
    w.press("up");
    w.press("up");
    expect(w.state.menuIndex).toBe(2);
    w.press("back");
    w.press("pause");
    expect(w.state.screen).toBe("levelup");
    const chosen = w.state.run.offers[2];
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(
      [...w.state.run.weapons, ...w.state.run.passives].some(
        (held) => held.id === chosen,
      ),
    ).toBe(true);
  });

  it("refuses to open with nothing pending or off playing", () => {
    const w = world();
    startRun(w.state);
    expect(openLevelUpOverlay(w.state, w.cues)).toBe(false);
    w.state.run.pendingLevelUps = 1;
    pause(w.state);
    expect(openLevelUpOverlay(w.state, w.cues)).toBe(false);
    expect(choose(w.state, 0, w.cues)).toBe(false);
  });

  it("closes the chest overlay on confirm alone", () => {
    const w = world();
    startRun(w.state);
    w.state.screen = "chest";
    w.state.run.chestResult = { kind: "heal" };
    w.press("up");
    w.press("back");
    w.press("pause");
    expect(w.state.screen).toBe("chest");
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.chestResult).toBeNull();
  });
});

describe("mute", () => {
  it("toggles the engine's bit from any screen", () => {
    const w = world();
    w.press("mute");
    expect(w.mute.on).toBe(true);
    startRun(w.state);
    w.press("mute");
    expect(w.mute.on).toBe(false);
    w.state.screen = "chest";
    w.press("mute");
    expect(w.mute.on).toBe(true);
  });
});

describe("the accumulator", () => {
  it("consumes whole ticks and keeps the remainder on playing", () => {
    const w = world();
    startRun(w.state);
    w.update(0.04);
    expect(w.state.run.tick).toBe(2);
    expect(w.state.accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 12);
    w.update(0.5);
    expect(w.state.run.tick).toBe(32);
  });

  it("reaches the same tick however the time is divided", () => {
    const a = world();
    const b = world();
    startRun(a.state);
    startRun(b.state);
    a.update(0.5);
    for (let i = 0; i < 50; i += 1) b.update(0.01);
    expect(a.state.run.tick).toBe(30);
    expect(b.state.run.tick).toBe(30);
  });

  it("discards the remainder when a tick leaves playing", () => {
    const w = world();
    startRun(w.state);
    w.state.run.pendingLevelUps = 1;
    w.update(0.025);
    expect(w.state.screen).toBe("levelup");
    expect(w.state.run.tick).toBe(1);
    expect(w.state.accumulator).toBe(0);
    w.update(1);
    expect(w.state.run.tick).toBe(1);
  });

  it("stays at zero off playing", () => {
    const w = world();
    w.update(0.3);
    expect(w.state.accumulator).toBe(0);
    expect(w.state.run.tick).toBe(0);
  });
});

describe("a frame", () => {
  it("leaves the state it was handed as it was and returns a new one", () => {
    const before = initialState(3);
    const frozen = JSON.stringify(before);
    const { draft } = runFrame(before, {
      dt: TICK_DT,
      pressed: ["confirm"],
      held: NOTHING_HELD,
      toggleMute: () => {},
    });
    expect(JSON.stringify(before)).toBe(frozen);
    expect(draft).not.toBe(before);
    expect(draft.screen).toBe("playing");
    expect(draft.run.tick).toBe(1);
  });

  it("reads every edge against the screen it began on", () => {
    // `confirm` starts the run; the same frame's `pause` arrived on `title`,
    // which does not answer it, so the run is not paused on arrival.
    const { draft } = runFrame(initialState(), {
      dt: 0,
      pressed: ["confirm", "pause"],
      held: NOTHING_HELD,
      toggleMute: () => {},
    });
    expect(draft.screen).toBe("playing");
  });

  it("adds the delta to simTime on every screen and ticks on playing alone", () => {
    let state = initialState();
    const frame = (dt: number, held = NOTHING_HELD): void => {
      state = runFrame(state, {
        dt,
        pressed: [],
        held,
        toggleMute: () => {},
      }).draft;
    };
    frame(0.25);
    expect(state.simTime).toBeCloseTo(0.25, 12);
    expect(state.run.tick).toBe(0);
    startRun(state);
    frame(0.5, { up: 0, down: 0, left: 0, right: 1 });
    expect(state.simTime).toBeCloseTo(0.75, 12);
    expect(state.run.tick).toBe(30);
    expect(state.run.player.x).toBeCloseTo(90, 6);
  });

  it("replays the same run from the same seed", () => {
    const runs = [9, 9].map((seed) => {
      const w = world(seed);
      startRun(w.state);
      w.state.run.pendingLevelUps = 3;
      w.update(TICK_DT);
      choose(w.state, 1, w.cues);
      choose(w.state, 0, w.cues);
      return w.state;
    });
    expect(runs[0].run.offers).toEqual(runs[1].run.offers);
    expect(runs[0].rngState).toBe(runs[1].rngState);
  });
});
