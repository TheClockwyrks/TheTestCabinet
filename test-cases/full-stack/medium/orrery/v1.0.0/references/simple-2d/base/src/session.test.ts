import { describe, expect, it } from "vitest";

import { CUES, HOWTO_PAGES, TITLE_ITEMS } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { clearOutbox, drainCues } from "./outbox";
import { missingApertures } from "./progress";
import { Session } from "./session";

/**
 * A session with an empty outbox and the state operations over its draft, plus
 * the mute bit the engine holds in a live build. A session raises cues into
 * the outbox and never plays one; `src/game.ts` is what hands the frame's cues
 * to the engine's bus, so a test reads them by draining the outbox.
 */
function bench(): { game: Session; api: OrreryStateOps; muted: () => boolean } {
  clearOutbox();
  let muted = false;
  const game = new Session(undefined, {
    toggleMuted: () => {
      muted = !muted;
    },
  });
  return { game, api: createStateOps(game), muted: () => muted };
}

describe("the title screen (specs/ui.md)", () => {
  it("opens on the title with its first item highlighted", () => {
    const { game } = bench();
    expect(game.state.screen).toBe("title");
    expect(game.state.menuIndex).toBe(0);
  });

  it("moves the highlight by one and wraps at both ends", () => {
    const { game } = bench();
    game.handleAction("up");
    expect(game.state.menuIndex).toBe(TITLE_ITEMS.length - 1);
    game.handleAction("down");
    expect(game.state.menuIndex).toBe(0);
    game.handleAction("down");
    expect(game.state.menuIndex).toBe(1);
  });

  it("takes each item where specs/ui.md sends it", () => {
    const campaign = bench();
    campaign.game.handleAction("confirm");
    expect(campaign.game.state.mode).toBe("campaign");
    expect(campaign.game.state.screen).toBe("select");

    const extras = bench();
    extras.game.handleAction("down");
    extras.game.handleAction("confirm");
    expect(extras.game.state.mode).toBe("extras");
    expect(extras.game.state.screen).toBe("select");

    const howto = bench();
    howto.game.handleAction("down");
    howto.game.handleAction("down");
    howto.game.handleAction("confirm");
    expect(howto.game.state.screen).toBe("howto");
    expect(howto.game.state.howtoPage).toBe(0);
  });

  it("does nothing on back", () => {
    const { game } = bench();
    game.handleAction("back");
    expect(game.state.screen).toBe("title");
  });
});

describe("the how-to (specs/ui.md)", () => {
  it("turns the page by one, stopping at both ends", () => {
    const { game, api } = bench();
    api.setScreen("howto");
    game.handleAction("left");
    expect(game.state.howtoPage).toBe(0);
    for (let page = 0; page < HOWTO_PAGES + 2; page += 1) {
      game.handleAction("right");
    }
    expect(game.state.howtoPage).toBe(HOWTO_PAGES - 1);
  });

  it("returns to the title on confirm and on back", () => {
    const { game, api } = bench();
    api.setScreen("howto");
    game.handleAction("confirm");
    expect(game.state.screen).toBe("title");
    expect(game.state.menuIndex).toBe(0);
    api.setScreen("howto");
    game.handleAction("back");
    expect(game.state.screen).toBe("title");
  });
});

describe("the select screen (specs/modes/extras.md)", () => {
  it("moves the highlight by one row, wrapping at both ends", () => {
    const { game, api } = bench();
    api.setMode("extras");
    api.setScreen("select");
    game.handleAction("up");
    expect(game.state.selectIndex).toBe(9);
    game.handleAction("down");
    expect(game.state.selectIndex).toBe(0);
  });

  it("opens the highlighted challenge, and lands there on the next visit", () => {
    const { game, api } = bench();
    api.setMode("extras");
    api.setScreen("select");
    api.setSelectIndex(2);
    game.handleAction("confirm");
    expect(game.state.screen).toBe("editor");
    expect(game.state.challenge?.name).toBe("Waning Crescent");
    expect(game.state.extrasLast).toBe(2);
    game.handleAction("back");
    expect(game.state.screen).toBe("select");
    expect(game.state.selectIndex).toBe(2);
  });

  it("restores the machine a challenge was left holding", () => {
    const { game, api } = bench();
    api.setMode("extras");
    api.setScreen("select");
    game.handleAction("confirm");
    api.placePart("arm", 0, 0, 0);
    api.setTapeCell(game.state.editor.parts[0].id, 0, "grab");
    game.handleAction("back");
    game.handleAction("confirm");
    expect(game.state.editor.parts).toHaveLength(1);
    expect(game.state.editor.parts[0].tape).toEqual(["grab"]);
    expect(game.state.editor.selected).toBeNull();
    expect(game.state.editor.undo).toEqual([]);
  });

  it("refuses a locked campaign row and admits every extras row", () => {
    const { game } = bench();
    expect(game.enterable("extras", 9)).toBe(true);
    expect(game.enterable("campaign", 4)).toBe(false);
    expect(game.enterable("extras", 10)).toBe(false);
  });

  it("returns to the title on back", () => {
    const { game, api } = bench();
    api.setScreen("select");
    game.handleAction("back");
    expect(game.state.screen).toBe("title");
  });
});

describe("running the machine from the editor (specs/editor.md)", () => {
  /** Extras 1 with its one rise and one set placed. */
  function ready(): ReturnType<typeof bench> {
    const made = bench();
    made.api.openChallenge("extras", 0);
    made.api.placeRise(0, -3, 0, 0);
    made.api.placeSet(0, 3, 0, 0);
    return made;
  }

  it("starts no run until every rise and every set is placed", () => {
    const { game, api } = bench();
    api.openChallenge("extras", 0);
    expect(game.machineReady()).toBe(false);
    expect(missingApertures(game.state)).toEqual(["rise 1", "set 1"]);
    game.handleAction("play");
    expect(game.state.sim).toBeNull();
  });

  it("starts the run on play, and toggles running and paused after", () => {
    const { game } = ready();
    game.handleAction("play");
    expect(game.state.sim?.status).toBe("running");
    game.handleAction("play");
    expect(game.state.sim?.status).toBe("paused");
    game.handleAction("play");
    expect(game.state.sim?.status).toBe("running");
  });

  it("starts a run paused at its settle on step", () => {
    const { game } = ready();
    game.handleAction("step");
    expect(game.state.sim?.status).toBe("paused");
    expect(game.state.sim?.cycle).toBe(0);
    expect(game.state.sim?.fraction).toBe(0);
  });

  it("runs one whole cycle on step, and always leaves the run paused", () => {
    const { game, api } = ready();
    game.handleAction("step");
    game.handleAction("step");
    expect(game.state.sim?.cycle).toBe(1);
    expect(game.state.sim?.status).toBe("paused");
    api.setPaused(false);
    game.update(0.1);
    game.handleAction("step");
    expect(game.state.sim?.status).toBe("paused");
    expect(game.state.sim?.fraction).toBe(0);
    expect(game.state.sim?.cycle).toBe(2);
  });

  it("moves the speed step one at a time, stopping at both ends", () => {
    const { game } = ready();
    game.handleAction("play");
    game.handleAction("speed-down");
    expect(game.state.sim?.speed).toBe(0);
    game.handleAction("speed-down");
    expect(game.state.sim?.speed).toBe(0);
    for (let step = 0; step < 5; step += 1) game.handleAction("speed-up");
    expect(game.state.sim?.speed).toBe(3);
  });

  it("stops the run on back, and leaves the editor on the next back", () => {
    const { game } = ready();
    game.handleAction("play");
    game.handleAction("back");
    expect(game.state.sim).toBeNull();
    expect(game.state.screen).toBe("editor");
    game.handleAction("back");
    expect(game.state.screen).toBe("select");
  });
});

describe("cues (specs/ui.md)", () => {
  it("raises a cue once, for the frame that plays it to take", () => {
    const { game, api } = bench();
    api.openChallenge("extras", 0);
    api.placeRise(0, -3, 0, 0);
    api.placeSet(0, 3, 0, 0);
    game.handleAction("play");
    game.handleAction("play");
    game.handleAction("play");
    // However often the event fired, the cue is asked for once.
    expect(drainCues()).toEqual([CUES.start]);
    // And taking it empties the queue, so the next frame plays nothing.
    expect(drainCues()).toEqual([]);
  });

  it("toggles the engine's mute bit from any screen", () => {
    const { game, muted } = bench();
    game.handleAction("mute");
    expect(muted()).toBe(true);
    game.handleAction("mute");
    expect(muted()).toBe(false);
  });
});

describe("the solved panel (specs/ui.md)", () => {
  /** Extras 1, completed. */
  function solved(): ReturnType<typeof bench> {
    const made = bench();
    made.api.openChallenge("extras", 0);
    made.api.placeSet(0, 0, 0, 0);
    made.api.startRun();
    made.api.setTally(0, 6);
    made.game.update(1);
    return made;
  }

  it("offers NEXT CHALLENGE only while the mode has one after this", () => {
    const { game } = solved();
    expect(game.state.sim?.status).toBe("complete");
    expect(game.solvedItems()).toEqual([
      "NEXT CHALLENGE",
      "KEEP TINKERING",
      "BACK TO SELECT",
    ]);
  });

  it("opens the next challenge of the mode", () => {
    const { game } = solved();
    game.handleAction("confirm");
    expect(game.state.challenge?.name).toBe("Twin Moons");
    expect(game.state.sim).toBeNull();
  });

  it("returns to editing with the machine intact, on the item and on back", () => {
    const tinker = solved();
    tinker.game.handleAction("down");
    tinker.game.handleAction("confirm");
    expect(tinker.game.state.sim).toBeNull();
    expect(tinker.game.state.editor.parts).toHaveLength(1);

    const back = solved();
    back.game.handleAction("back");
    expect(back.game.state.sim).toBeNull();
    expect(back.game.state.screen).toBe("editor");
  });

  it("goes to the select screen", () => {
    const { game } = solved();
    game.handleAction("up");
    game.handleAction("confirm");
    expect(game.state.screen).toBe("select");
  });

  it("wraps the menu at both ends", () => {
    const { game } = solved();
    game.handleAction("up");
    expect(game.state.menuIndex).toBe(2);
    game.handleAction("down");
    expect(game.state.menuIndex).toBe(0);
  });
});
