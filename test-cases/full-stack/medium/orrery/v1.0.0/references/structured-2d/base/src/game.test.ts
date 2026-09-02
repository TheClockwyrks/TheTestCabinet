import { describe, expect, it } from "vitest";

import { CUES, HOWTO_PAGES, TITLE_ITEMS, type CueName } from "./constants";
import { createDebugApi, type OrreryDebugApi } from "./debug";
import {
  advanceFrame,
  enterable,
  handleAction,
  machineReady,
  missingApertures,
  solvedItems,
} from "./flow";
import { Bench } from "./harness";

/** The rules stood up alone, with the cues they raise recorded. */
function bench(): { game: Bench; api: OrreryDebugApi; played: CueName[] } {
  const game = new Bench();
  return { game, api: createDebugApi(() => game), played: game.cues };
}

describe("the title screen (specs/ui.md)", () => {
  it("opens on the title with its first item highlighted", () => {
    const { game } = bench();
    expect(game.state.screen).toBe("title");
    expect(game.state.menuIndex).toBe(0);
  });

  it("moves the highlight by one and wraps at both ends", () => {
    const { game } = bench();
    handleAction(game, "up");
    expect(game.state.menuIndex).toBe(TITLE_ITEMS.length - 1);
    handleAction(game, "down");
    expect(game.state.menuIndex).toBe(0);
    handleAction(game, "down");
    expect(game.state.menuIndex).toBe(1);
  });

  it("takes each item where specs/ui.md sends it", () => {
    const campaign = bench();
    handleAction(campaign.game, "confirm");
    expect(campaign.game.state.mode).toBe("campaign");
    expect(campaign.game.state.screen).toBe("select");

    const extras = bench();
    handleAction(extras.game, "down");
    handleAction(extras.game, "confirm");
    expect(extras.game.state.mode).toBe("extras");
    expect(extras.game.state.screen).toBe("select");

    const howto = bench();
    handleAction(howto.game, "down");
    handleAction(howto.game, "down");
    handleAction(howto.game, "confirm");
    expect(howto.game.state.screen).toBe("howto");
    expect(howto.game.state.howtoPage).toBe(0);
  });

  it("does nothing on back", () => {
    const { game } = bench();
    handleAction(game, "back");
    expect(game.state.screen).toBe("title");
  });
});

describe("the how-to (specs/ui.md)", () => {
  it("turns the page by one, stopping at both ends", () => {
    const { game, api } = bench();
    api.setScreen("howto");
    handleAction(game, "left");
    expect(game.state.howtoPage).toBe(0);
    for (let page = 0; page < HOWTO_PAGES + 2; page += 1) {
      handleAction(game, "right");
    }
    expect(game.state.howtoPage).toBe(HOWTO_PAGES - 1);
  });

  it("returns to the title on confirm and on back", () => {
    const { game, api } = bench();
    api.setScreen("howto");
    handleAction(game, "confirm");
    expect(game.state.screen).toBe("title");
    expect(game.state.menuIndex).toBe(0);
    api.setScreen("howto");
    handleAction(game, "back");
    expect(game.state.screen).toBe("title");
  });
});

describe("the select screen (specs/modes/extras.md)", () => {
  it("moves the highlight by one row, wrapping at both ends", () => {
    const { game, api } = bench();
    api.setMode("extras");
    api.setScreen("select");
    handleAction(game, "up");
    expect(game.state.selectIndex).toBe(9);
    handleAction(game, "down");
    expect(game.state.selectIndex).toBe(0);
  });

  it("opens the highlighted challenge, and lands there on the next visit", () => {
    const { game, api } = bench();
    api.setMode("extras");
    api.setScreen("select");
    api.setSelectIndex(2);
    handleAction(game, "confirm");
    expect(game.state.screen).toBe("editor");
    expect(game.state.challenge?.name).toBe("Waning Crescent");
    expect(game.state.extrasLast).toBe(2);
    handleAction(game, "back");
    expect(game.state.screen).toBe("select");
    expect(game.state.selectIndex).toBe(2);
  });

  it("restores the machine a challenge was left holding", () => {
    const { game, api } = bench();
    api.setMode("extras");
    api.setScreen("select");
    handleAction(game, "confirm");
    api.placePart("arm", 0, 0, 0);
    api.setTapeCell(game.state.editor.parts[0].id, 0, "grab");
    handleAction(game, "back");
    handleAction(game, "confirm");
    expect(game.state.editor.parts).toHaveLength(1);
    expect(game.state.editor.parts[0].tape).toEqual(["grab"]);
    expect(game.state.editor.selected).toBeNull();
    expect(game.state.editor.undo).toEqual([]);
  });

  it("refuses a locked campaign row and admits every extras row", () => {
    const { game } = bench();
    expect(enterable(game.state, "extras", 9)).toBe(true);
    expect(enterable(game.state, "campaign", 4)).toBe(false);
    expect(enterable(game.state, "extras", 10)).toBe(false);
  });

  it("returns to the title on back", () => {
    const { game, api } = bench();
    api.setScreen("select");
    handleAction(game, "back");
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
    expect(machineReady(game.state)).toBe(false);
    expect(missingApertures(game.state)).toEqual(["rise 1", "set 1"]);
    handleAction(game, "play");
    expect(game.state.sim).toBeNull();
  });

  it("starts the run on play, and toggles running and paused after", () => {
    const { game } = ready();
    handleAction(game, "play");
    expect(game.state.sim?.status).toBe("running");
    handleAction(game, "play");
    expect(game.state.sim?.status).toBe("paused");
    handleAction(game, "play");
    expect(game.state.sim?.status).toBe("running");
  });

  it("starts a run paused at its settle on step", () => {
    const { game } = ready();
    handleAction(game, "step");
    expect(game.state.sim?.status).toBe("paused");
    expect(game.state.sim?.cycle).toBe(0);
    expect(game.state.sim?.fraction).toBe(0);
  });

  it("runs one whole cycle on step, and always leaves the run paused", () => {
    const { game, api } = ready();
    handleAction(game, "step");
    handleAction(game, "step");
    expect(game.state.sim?.cycle).toBe(1);
    expect(game.state.sim?.status).toBe("paused");
    api.setPaused(false);
    advanceFrame(game, 0.1);
    handleAction(game, "step");
    expect(game.state.sim?.status).toBe("paused");
    expect(game.state.sim?.fraction).toBe(0);
    expect(game.state.sim?.cycle).toBe(2);
  });

  it("moves the speed step one at a time, stopping at both ends", () => {
    const { game } = ready();
    handleAction(game, "play");
    handleAction(game, "speed-down");
    expect(game.state.sim?.speed).toBe(0);
    handleAction(game, "speed-down");
    expect(game.state.sim?.speed).toBe(0);
    for (let step = 0; step < 5; step += 1) handleAction(game, "speed-up");
    expect(game.state.sim?.speed).toBe(3);
  });

  it("stops the run on back, and leaves the editor on the next back", () => {
    const { game } = ready();
    handleAction(game, "play");
    handleAction(game, "back");
    expect(game.state.sim).toBeNull();
    expect(game.state.screen).toBe("editor");
    handleAction(game, "back");
    expect(game.state.screen).toBe("select");
  });
});

describe("cues (specs/ui.md)", () => {
  it("raises the start cue when the run begins, and only then", () => {
    const { game, api, played } = bench();
    api.openChallenge("extras", 0);
    api.placeRise(0, -3, 0, 0);
    api.placeSet(0, 3, 0, 0);
    expect(played).toEqual([]);
    handleAction(game, "play");
    // The cue is ASKED FOR here and PLAYED by the frame that follows, which
    // `src/engine.test.ts` reads off the engine's own cue bus.
    expect(played).toEqual([CUES.start]);
    advanceFrame(game, 1 / 60);
    expect(played).toEqual([CUES.start]);
  });

  it("toggles the engine's mute bit from any screen, and mirrors it", () => {
    const { game } = bench();
    handleAction(game, "mute");
    expect(game.state.muted).toBe(true);
    advanceFrame(game, 1 / 60);
    expect(game.state.muted).toBe(true);
    handleAction(game, "mute");
    advanceFrame(game, 1 / 60);
    expect(game.state.muted).toBe(false);
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
    advanceFrame(made.game, 1);
    return made;
  }

  it("offers NEXT CHALLENGE only while the mode has one after this", () => {
    const { game } = solved();
    expect(game.state.sim?.status).toBe("complete");
    expect(solvedItems(game.state)).toEqual([
      "NEXT CHALLENGE",
      "KEEP TINKERING",
      "BACK TO SELECT",
    ]);
  });

  it("opens the next challenge of the mode", () => {
    const { game } = solved();
    handleAction(game, "confirm");
    expect(game.state.challenge?.name).toBe("Twin Moons");
    expect(game.state.sim).toBeNull();
  });

  it("returns to editing with the machine intact, on the item and on back", () => {
    const tinker = solved();
    handleAction(tinker.game, "down");
    handleAction(tinker.game, "confirm");
    expect(tinker.game.state.sim).toBeNull();
    expect(tinker.game.state.editor.parts).toHaveLength(1);

    const back = solved();
    handleAction(back.game, "back");
    expect(back.game.state.sim).toBeNull();
    expect(back.game.state.screen).toBe("editor");
  });

  it("goes to the select screen", () => {
    const { game } = solved();
    handleAction(game, "up");
    handleAction(game, "confirm");
    expect(game.state.screen).toBe("select");
  });

  it("wraps the menu at both ends", () => {
    const { game } = solved();
    handleAction(game, "up");
    expect(game.state.menuIndex).toBe(2);
    handleAction(game, "down");
    expect(game.state.menuIndex).toBe(0);
  });
});
