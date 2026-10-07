import { describe, expect, it } from "vitest";

import { CUES, HOWTO_PAGES, TITLE_ITEMS, type Cue } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { Game, type GameHost } from "./game";
import type { MenuItemRect } from "./regions";

/** A host that records what it was asked to play, and holds a mute bit. */
function host(): { host: GameHost; played: Cue[]; muted: () => boolean } {
  let muted = false;
  const played: Cue[] = [];
  return {
    played,
    muted: () => muted,
    host: {
      muted: () => muted,
      toggleMuted: () => {
        muted = !muted;
      },
      play: (cue) => played.push(cue),
    },
  };
}

function bench(): { game: Game; api: OrreryStateOps; played: Cue[] } {
  const wired = host();
  const game = new Game(wired.host);
  return { game, api: createStateOps(game), played: wired.played };
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
    expect(game.missingApertures()).toEqual(["rise 1", "set 1"]);
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
  it("plays a cue from the frame that raised it, once", () => {
    const { game, api, played } = bench();
    api.openChallenge("extras", 0);
    api.placeRise(0, -3, 0, 0);
    api.placeSet(0, 3, 0, 0);
    game.handleAction("play");
    expect(played).toEqual([]);
    game.update(1 / 60);
    expect(played).toEqual([CUES.start]);
    game.update(1 / 60);
    expect(played).toEqual([CUES.start]);
  });

  it("toggles the runtime's mute bit from any screen, and mirrors it", () => {
    const { game } = bench();
    game.handleAction("mute");
    expect(game.state.muted).toBe(true);
    game.update(1 / 60);
    expect(game.state.muted).toBe(true);
    game.handleAction("mute");
    game.update(1 / 60);
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

/** A stage position, as the pointer reports one. */
interface At {
  x: number;
  y: number;
}

/** The middle of the region the game reports for item `index`. */
function centerOf(game: Game, index: number): At {
  const rect = game.menuItemRect(index);
  expect(rect, `item ${index} has a region`).not.toBeNull();
  const region = rect as MenuItemRect;
  return { x: region.x + region.w / 2, y: region.y + region.h / 2 };
}

/** A press and a release in one place: a click, and a finger's tap. */
function clickAt(game: Game, at: At): void {
  game.handlePointer({ type: "down", x: at.x, y: at.y });
  game.handlePointer({ type: "up", x: at.x, y: at.y });
}

/** A press, a travel, and a release: a drag, and a finger's swipe. */
function dragBetween(game: Game, from: At, to: At): void {
  game.handlePointer({ type: "down", x: from.x, y: from.y });
  game.handlePointer({ type: "move", x: to.x, y: to.y });
  game.handlePointer({ type: "up", x: to.x, y: to.y });
}

describe("the menus under the pointer and touch (specs/ui.md)", () => {
  // A mouse, a pen, and a finger all reach the game on the same three
  // readings (specs/controls.md), so every gesture below is a touch contact
  // as much as it is a pointer: the press edge is the landing, the release
  // edge is the lift, and the moves between are the travel.

  it("moves the highlight onto each region the pointer enters", () => {
    const { game } = bench();
    game.handlePointer({ type: "move", ...centerOf(game, 2) });
    expect(game.state.menuIndex).toBe(2);
    expect(game.state.screen).toBe("title");
    game.handlePointer({ type: "move", ...centerOf(game, 0) });
    expect(game.state.menuIndex).toBe(0);
    // A move that lands outside every region names no item, so the highlight
    // stays on the last region the pointer entered.
    game.handlePointer({ type: "move", x: 8, y: 8 });
    expect(game.state.menuIndex).toBe(0);
  });

  it("takes the item both of a gesture's edges landed in", () => {
    const { game } = bench();
    clickAt(game, centerOf(game, TITLE_ITEMS.indexOf("EXTRAS")));
    expect(game.state.menuIndex).toBe(TITLE_ITEMS.indexOf("EXTRAS"));
    expect(game.state.mode).toBe("extras");
    expect(game.state.screen).toBe("select");
  });

  it("takes no item when the two edges fall in different regions", () => {
    const { game } = bench();
    dragBetween(game, centerOf(game, 2), centerOf(game, 0));
    expect(game.state.screen).toBe("title");
    // The release moved the pointer onto the first item, which selects it.
    expect(game.state.menuIndex).toBe(0);
  });

  it("takes no item when either edge falls outside every region", () => {
    const outside = { x: 8, y: 8 };
    const opened = bench();
    dragBetween(opened.game, outside, centerOf(opened.game, 1));
    expect(opened.game.state.screen).toBe("title");
    expect(opened.game.state.menuIndex).toBe(1);

    const left = bench();
    dragBetween(left.game, centerOf(left.game, 1), outside);
    expect(left.game.state.screen).toBe("title");
    expect(left.game.state.menuIndex).toBe(1);
  });

  it("takes the how-to's one item, which returns to the title", () => {
    const { game, api } = bench();
    api.setScreen("howto");
    expect(game.menuItemRect(1)).toBeNull();
    clickAt(game, centerOf(game, 0));
    expect(game.state.screen).toBe("title");
  });

  it("takes a select row, and a locked row opens nothing", () => {
    const { game, api } = bench();
    api.setScreen("select");
    clickAt(game, centerOf(game, 4));
    expect(game.state.selectIndex).toBe(4);
    expect(game.state.screen).toBe("select");
    clickAt(game, centerOf(game, 0));
    expect(game.state.screen).toBe("editor");
    expect(game.state.challengeRef).toEqual({ mode: "campaign", index: 0 });
  });

  it("takes an item of the solved panel, and nothing behind it", () => {
    const { game, api } = bench();
    api.openChallenge("extras", 0);
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.update(1);
    expect(game.state.sim?.status).toBe("complete");
    const items = game.solvedItems();

    // The machine drawn behind the panel takes neither the highlight nor the
    // take, and the run stands.
    clickAt(game, { x: 300, y: 500 });
    expect(game.state.menuIndex).toBe(0);
    expect(game.state.sim?.status).toBe("complete");

    clickAt(game, centerOf(game, items.indexOf("BACK TO SELECT")));
    expect(game.state.screen).toBe("select");
  });

  it("sets the focus from a press the solved panel took, as from any press", () => {
    const { game, api } = bench();
    api.openChallenge("extras", 0);
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.update(1);
    api.setFocus("tape");
    // The focus rule of specs/controls.md answers EVERY press on the editor
    // screen. What specs/ui.md exempts while the panel is up is the machine
    // drawn behind it, and the focus is not the machine's: it is where the
    // editing keys go the moment the panel is gone.
    game.handlePointer({ type: "down", ...centerOf(game, 0) });
    expect(game.state.editor.focus).toBe("field");
    expect(game.state.sim?.status).toBe("complete");
  });

  it("lays out no region while editing, and none while a run is live", () => {
    const { game, api } = bench();
    api.openChallenge("extras", 0);
    expect(game.menu()).toBeNull();
    expect(game.menuItemRect(0)).toBeNull();
    api.placeSet(0, 0, 0, 0);
    api.startRun();
    expect(game.menuItemRect(0)).toBeNull();
    api.setPaused(true);
    expect(game.menuItemRect(0)).toBeNull();
  });
});

describe("the remembered title selection (specs/ui.md)", () => {
  it("opens on the first item, and on the entry last taken after that", () => {
    const { game, api } = bench();
    expect(game.state.titleIndex).toBe(0);
    api.setMenuIndex(2);
    game.handleAction("confirm");
    expect(game.state.screen).toBe("howto");
    expect(game.state.titleIndex).toBe(2);
    game.handleAction("back");
    expect(game.state.screen).toBe("title");
    expect(game.state.menuIndex).toBe(2);
  });

  it("records a take from a pointer as it records one from the keyboard", () => {
    const { game } = bench();
    clickAt(game, centerOf(game, 1));
    expect(game.state.titleIndex).toBe(1);
    game.handleAction("back");
    expect(game.state.screen).toBe("title");
    expect(game.state.menuIndex).toBe(1);
  });

  it("carries the highlight through the how-to untouched", () => {
    const { game, api } = bench();
    api.setMenuIndex(2);
    api.setScreen("howto");
    // The how-to draws its one item as the highlighted one outright, so it has
    // no highlight of its own to write and leaves the posed one standing.
    expect(game.state.menuIndex).toBe(2);
    api.setScreen("title");
    // Nothing was taken on the way out, so the remembered selection is still
    // `0` — and the arrival at the title is what puts the highlight back on it.
    expect(game.state.titleIndex).toBe(0);
    expect(game.state.menuIndex).toBe(0);
  });

  it("is written by taking an item and by nothing else", () => {
    const { game, api } = bench();
    api.setMenuIndex(2);
    game.handlePointer({ type: "move", ...centerOf(game, 1) });
    api.setScreen("howto");
    api.setScreen("title");
    expect(game.state.titleIndex).toBe(0);
    expect(game.state.menuIndex).toBe(0);
  });

  it("stands through a visit elsewhere, and is 0 again after a reset", () => {
    const { game, api } = bench();
    api.setMenuIndex(1);
    game.handleAction("confirm");
    api.openChallenge("campaign", 0);
    api.setScreen("title");
    expect(game.state.titleIndex).toBe(1);
    expect(game.state.menuIndex).toBe(1);
    api.reset();
    expect(game.state.titleIndex).toBe(0);
    expect(game.state.menuIndex).toBe(0);
  });
});
