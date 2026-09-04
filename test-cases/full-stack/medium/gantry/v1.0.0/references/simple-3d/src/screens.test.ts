// The seven screens: the reading, the navigation, and the tape editor's press.

import { describe, expect, it } from "vitest";
import { RESULTS_ITEMS, SITE_COUNT } from "./constants";
import { point, thaw } from "./convert";
import * as edits from "./edits";
import type { GantryState } from "./game";
import { menuRects } from "./menus";
import { handleAction, handlePointer, pendingStartIssues } from "./screens";
import {
  addMoveStep,
  currentProgram,
  openSite,
  setCleared,
  setMenuIndex,
  setScreen,
  titleState,
} from "./state";
import { PANEL, tapeLayout } from "./tape";

const yard = (): GantryState => setScreen(openSite(titleState(), 0), "build");

/** A ring and one arm rail, which is the least a run will start on. */
function runnable(): GantryState {
  let s = yard();
  s = edits.setRing(s, point(0, 2, 0)).state;
  s = edits.addMember(s, point(2, 4, 0), point(4, 4, 0), "rail").state;
  s = addMoveStep(s, "slew", 15, 30);
  return s;
}

describe("what would refuse a run", () => {
  it("is the check's issues, in the order it reports them", () => {
    expect(pendingStartIssues(yard())).toEqual([
      "no-ring",
      "no-rail",
      "empty-program",
    ]);
  });

  it("drops an issue as the structure answers it", () => {
    const s = edits.setRing(yard(), point(0, 2, 0)).state;
    expect(pendingStartIssues(s)).not.toContain("no-ring");
    expect(pendingStartIssues(s)).toContain("no-rail");
  });
});

describe("the title screen", () => {
  it("takes SITES to the site select, highlighting the open site", () => {
    const s = handleAction(titleState(), "confirm");
    expect(s.screen).toBe("select");
    expect(s.menuIndex).toBe(s.siteIndex);
  });

  it("takes HOW TO PLAY to the how-to page", () => {
    const s = handleAction(setMenuIndex(titleState(), 1), "confirm");
    expect(s.screen).toBe("howto");
  });

  it("wraps the highlight at both ends", () => {
    expect(handleAction(titleState(), "up").menuIndex).toBe(1);
    expect(handleAction(setMenuIndex(titleState(), 1), "down").menuIndex).toBe(
      0,
    );
  });

  it("leaves the highlight where it is on left and right", () => {
    const s = setMenuIndex(titleState(), 1);
    expect(handleAction(s, "left").menuIndex).toBe(1);
    expect(handleAction(s, "right").menuIndex).toBe(1);
  });

  it("has nowhere for back to lead", () => {
    expect(handleAction(titleState(), "back")).toEqual(titleState());
  });
});

describe("the site select", () => {
  it("enters an open site on its build screen", () => {
    const s = handleAction(setScreen(titleState(), "select"), "confirm");
    expect(s.screen).toBe("build");
    expect(s.siteIndex).toBe(0);
  });

  it("does nothing on a locked site", () => {
    const at = setMenuIndex(setScreen(titleState(), "select"), 3);
    expect(handleAction(at, "confirm")).toEqual(thaw(at));
  });

  it("enters a site the clear before it opened", () => {
    let s = setCleared(titleState(), 0, true);
    s = setMenuIndex(setScreen(s, "select"), 1);
    expect(handleAction(s, "confirm").siteIndex).toBe(1);
  });

  it("goes back to the title with SITES selected", () => {
    // `specs/ui.md`: navigating back to a menu selects the entry that led away
    // from it, and select is reached through `SITES`, TITLE_ITEMS index 0.
    const back = handleAction(setScreen(titleState(), "select"), "back");
    expect(back.screen).toBe("title");
    expect(back.menuIndex).toBe(0);
  });

  it("goes back from how-to with HOW TO PLAY selected", () => {
    const s = handleAction(setScreen(titleState(), "howto"), "back");
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(1);
  });
});

describe("the yard screens", () => {
  it("selects a tool on the build screen and nowhere else", () => {
    expect(handleAction(yard(), "tool-rail").tool).toBe("rail");
    const elsewhere = setScreen(titleState(), "select");
    expect(handleAction(elsewhere, "tool-rail").tool).toBe("strut");
  });

  it("switches between the build and program screens", () => {
    const program = handleAction(yard(), "program");
    expect(program.screen).toBe("program");
    expect(handleAction(program, "build").screen).toBe("build");
    // Each switch applies from one screen only.
    expect(handleAction(yard(), "build").screen).toBe("build");
  });

  it("runs the static check on the build screen", () => {
    expect(handleAction(yard(), "check").checkResult).not.toBeNull();
    expect(
      handleAction(setScreen(yard(), "program"), "check").checkResult,
    ).toBe(null);
  });

  it("undoes the last edit and raises the delete cue", () => {
    const placed = edits.setRing(yard(), point(0, 2, 0)).state;
    placed.cues = [];
    const undone = handleAction(placed, "undo");
    expect(undone.sites[0].structure.ring).toBeNull();
    expect(undone.cues.map((c) => c.cue)).toContain("delete");
  });

  it("drops a held node with back before it leaves the screen", () => {
    const held = { ...yard(), pendingNode: point(2, 4, 0) };
    const dropped = handleAction(held, "back");
    expect(dropped.pendingNode).toBeNull();
    expect(dropped.screen).toBe("build");
    expect(handleAction(dropped, "back").screen).toBe("select");
  });

  it("leaves the program screen for the site select", () => {
    expect(handleAction(setScreen(yard(), "program"), "back").screen).toBe(
      "select",
    );
  });
});

describe("starting a run", () => {
  it("is refused, silently, while an issue stands", () => {
    const before = yard();
    expect(handleAction(before, "run")).toEqual(thaw(before));
  });

  it("starts from either yard screen and raises run-start", () => {
    const ready = runnable();
    for (const from of ["build", "program"] as const) {
      const started = handleAction(setScreen(ready, from), "run");
      expect(started.screen).toBe("run");
      expect(started.run.phase).toBe("running");
      expect(started.cues.map((c) => c.cue)).toContain("run-start");
    }
  });

  it("does nothing from a screen that carries no crane", () => {
    const title = setScreen(runnable(), "title");
    expect(handleAction(title, "run").run.phase).toBe("idle");
  });
});

describe("the run screen", () => {
  it("cycles the watch speed, and only there", () => {
    const running = handleAction(runnable(), "run");
    expect(handleAction(running, "speed").run.speedIndex).toBe(1);
    expect(handleAction(yard(), "speed").run.speedIndex).toBe(0);
  });

  it("aborts a run in progress and returns to the build screen", () => {
    const running = handleAction(runnable(), "run");
    const aborted = handleAction(running, "back");
    expect(aborted.screen).toBe("build");
    expect(aborted.run.phase).toBe("idle");
  });

  it("leaves a finished run's verdict readable", () => {
    const ended = setScreen(runnable(), "run");
    ended.run.phase = "failed";
    ended.run.cause = "collapse";
    const back = handleAction(ended, "back");
    expect(back.screen).toBe("build");
    expect(back.run.cause).toBe("collapse");
  });
});

describe("the results screen", () => {
  const results = (index: number): GantryState => {
    const s = setScreen(openSite(titleState(), index), "results");
    return setMenuIndex(s, 0);
  };

  it("takes NEXT SITE to the site after it", () => {
    const s = handleAction(results(0), "confirm");
    expect(s.siteIndex).toBe(1);
    expect(s.screen).toBe("build");
  });

  it("replays this site", () => {
    const s = handleAction(setMenuIndex(results(0), 1), "confirm");
    expect(s.siteIndex).toBe(0);
    expect(s.screen).toBe("build");
  });

  it("drops NEXT SITE on the last site, so the first entry replays", () => {
    const last = results(SITE_COUNT - 1);
    expect(RESULTS_ITEMS[0]).toBe("NEXT SITE");
    const s = handleAction(last, "confirm");
    expect(s.siteIndex).toBe(SITE_COUNT - 1);
    expect(s.screen).toBe("build");
  });

  it("takes SITE SELECT, and back, to the site select", () => {
    const s = handleAction(setMenuIndex(results(0), 2), "confirm");
    expect(s.screen).toBe("select");
    expect(handleAction(results(0), "back").screen).toBe("select");
  });
});

describe("mute", () => {
  it("flips the bit the update pushes to the engine, from any screen", () => {
    for (const screen of ["title", "build", "run"] as const) {
      const s = setScreen(titleState(), screen);
      expect(handleAction(s, "mute").muted).toBe(true);
    }
    const muted = handleAction(titleState(), "mute");
    expect(handleAction(muted, "mute").muted).toBe(false);
  });
});

describe("the actions the yard screens leave to the camera", () => {
  it("move nothing on a press edge", () => {
    const before = yard();
    for (const action of [
      "up",
      "down",
      "left",
      "right",
      "zoom-in",
      "zoom-out",
    ] as const) {
      expect(handleAction(before, action)).toEqual(thaw(before));
    }
  });
});

describe("a press on the tape editor", () => {
  const program = (): GantryState => setScreen(yard(), "program");

  it("reaches no other screen", () => {
    const outcome = handlePointer(yard(), { kind: "down", x: 100, y: 100 });
    expect(outcome.consumed).toBe(false);
  });

  it("is not the panel's when it falls outside it", () => {
    const outcome = handlePointer(program(), {
      kind: "down",
      x: PANEL.x + PANEL.w + 40,
      y: 100,
    });
    expect(outcome.consumed).toBe(false);
  });

  it("is the panel's even where it takes no widget", () => {
    const s = program();
    const outcome = handlePointer(s, {
      kind: "down",
      x: PANEL.x + 2,
      y: PANEL.y + 2,
    });
    expect(outcome.consumed).toBe(true);
    expect(currentProgram(outcome.state)).toHaveLength(0);
  });

  it("takes the widget under it", () => {
    const s = program();
    const add = tapeLayout(s).bar[0];
    const outcome = handlePointer(s, {
      kind: "down",
      x: add.rect.x + 4,
      y: add.rect.y + 4,
    });
    expect(outcome.consumed).toBe(true);
    expect(currentProgram(outcome.state)).toHaveLength(1);
  });

  it("keeps a press it took for the moves and the release that follow", () => {
    const s = program();
    s.pointer.captured = true;
    expect(handlePointer(s, { kind: "move", x: 20, y: 60 }).consumed).toBe(
      true,
    );
    s.pointer.captured = false;
    expect(handlePointer(s, { kind: "up", x: 20, y: 60 }).consumed).toBe(false);
  });
});

// ---- The menus, under a pointer and under a finger --------------------------
//
// `specs/ui.md` gives every menu the pointer and touch as well as the key
// actions, over hit regions this build lays out in `src/menus.ts`. Every check
// below asks that module where the entry is and aims at the middle of what it
// answered, so none of them knows a menu coordinate. A contact reaches the game
// on the engine's own pointer reads (`specs/controls.md`), so a tap is these
// same two edges at one point.

describe("the menus under a pointer", () => {
  const at = (state: GantryState, index: number): { x: number; y: number } => {
    const rect = menuRects(state)[index]!;
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  };

  /** A stage point inside no entry's region. */
  const nowhere = (state: GantryState): { x: number; y: number } => {
    const first = menuRects(state)[0]!;
    return { x: first.x + first.w + 40, y: first.y - 30 };
  };

  const pressedAt = (
    state: GantryState,
    point: { x: number; y: number },
  ): GantryState => {
    state.pointer.pressX = point.x;
    state.pointer.pressY = point.y;
    return state;
  };

  it("moves the highlight onto the entry the pointer is over", () => {
    const state = titleState();
    const entry = at(state, 1);
    const outcome = handlePointer(state, {
      kind: "move",
      x: entry.x,
      y: entry.y,
    });
    expect(outcome.consumed).toBe(true);
    expect(outcome.state.menuIndex).toBe(1);
    expect(outcome.state.screen).toBe("title");
  });

  it("leaves the highlight where it is over no entry", () => {
    const state = titleState();
    const away = nowhere(state);
    const outcome = handlePointer(state, {
      kind: "move",
      x: away.x,
      y: away.y,
    });
    expect(outcome.state.menuIndex).toBe(0);
  });

  it("takes the entry a press and its release both fell inside", () => {
    const state = titleState();
    const entry = at(state, 1);
    const outcome = handlePointer(pressedAt(state, entry), {
      kind: "up",
      x: entry.x,
      y: entry.y,
    });
    // TITLE_ITEMS index 1 is HOW TO PLAY, which confirm opens.
    expect(outcome.state.screen).toBe("howto");
  });

  it("takes nothing when the release fell outside the pressed entry", () => {
    const state = titleState();
    const entry = at(state, 1);
    const away = nowhere(state);
    const outcome = handlePointer(pressedAt(state, entry), {
      kind: "up",
      x: away.x,
      y: away.y,
    });
    expect(outcome.state.screen).toBe("title");
    expect(outcome.consumed).toBe(true);
  });

  it("takes nothing when the release fell inside a different entry", () => {
    const state = setScreen(titleState(), "select");
    const from = at(state, 0);
    const to = at(state, 1);
    const outcome = handlePointer(pressedAt(state, from), {
      kind: "up",
      x: to.x,
      y: to.y,
    });
    expect(outcome.state.screen).toBe("select");
  });
});
