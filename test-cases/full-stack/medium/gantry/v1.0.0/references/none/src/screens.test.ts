import { beforeEach, describe, expect, it, vi } from "vitest";

// The structure editor is another module's; `undo` and `check` are gated and
// forwarded here, so the seam is what these tests watch.
vi.mock("./editor", () => ({
  undo: vi.fn((state: unknown) => ({
    state,
    cue: "delete" as const,
    refusal: null,
  })),
  showCheck: vi.fn((state: Record<string, unknown>) => ({
    ...state,
    checkResult: {
      issues: [],
      cost: 0,
      budget: 0,
      stable: true,
      members: [],
    },
  })),
}));

import {
  RESULTS_ITEMS,
  RUN_SPEEDS,
  SITE_COUNT,
  SLEW_MAX_RATE,
  TITLE_ITEMS,
  type ActionName,
  type CueName,
} from "./constants";
import { showCheck, undo } from "./editor";
import { SIM_SITES, type Material, type Vec3 } from "./sim";
import {
  addMoveStep,
  currentProgram,
  currentStructure,
  emptySiteStructure,
  idleRun,
  menuLength,
  setCleared,
  setScreen,
  titleState,
  type GantryState,
  type Screen,
  type Tool,
} from "./state";
import { handleAction, handlePointer, pendingStartIssues } from "./screens";
import { insidePanel, PANEL, tapeLayout } from "./screens-tape";

// ---- A test harness for the one thing the screens reach past the state ------

interface Recorder {
  cues: CueName[];
  mutes: number;
  playCue(cue: CueName): void;
  toggleMute(): void;
}

const recorder = (): Recorder => ({
  cues: [],
  mutes: 0,
  playCue(cue) {
    this.cues.push(cue);
  },
  toggleMute() {
    this.mutes += 1;
  },
});

let io = recorder();
beforeEach(() => {
  io = recorder();
  vi.clearAllMocks();
});

const act = (state: GantryState, ...actions: ActionName[]): GantryState =>
  actions.reduce((s, a) => handleAction(s, a, io), state);

const ALL_SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "select",
  "build",
  "program",
  "run",
  "results",
];

/** A crane with a ring and one rail, which is ready to run. */
function readyCrane(state: GantryState): GantryState {
  const members = [
    {
      id: 0,
      a: [2, 4, 0] as Vec3,
      b: [4, 4, 0] as Vec3,
      material: "rail" as Material,
    },
  ];
  return {
    ...state,
    sites: state.sites.map((entry, i) =>
      i === state.siteIndex
        ? {
            structure: {
              members,
              nextMemberId: 1,
              ring: { corner: [0, 2, 0] as Vec3 },
              counterweights: [],
            },
            program: entry.program,
          }
        : entry,
    ),
  };
}

const runnable = (screen: Screen = "build"): GantryState =>
  setScreen(
    addMoveStep(readyCrane(titleState()), "slew", 30, SLEW_MAX_RATE),
    screen,
  );

// ---- The menus --------------------------------------------------------------

describe("the menus", () => {
  it("moves the highlight by one and wraps at both ends", () => {
    let state = titleState();
    expect(menuLength(state)).toBe(TITLE_ITEMS.length);
    state = act(state, "down");
    expect(state.menuIndex).toBe(1);
    state = act(state, "down");
    expect(state.menuIndex).toBe(0);
    state = act(state, "up");
    expect(state.menuIndex).toBe(TITLE_ITEMS.length - 1);
  });

  it("wraps a six-entry site list both ways", () => {
    let state = setScreen(titleState(), "select");
    state = act(state, "up");
    expect(state.menuIndex).toBe(SITE_COUNT - 1);
    state = act(state, "down");
    expect(state.menuIndex).toBe(0);
  });

  it("reaches the menu with left and right but leaves the highlight", () => {
    const state = act(setScreen(titleState(), "select"), "down", "down");
    expect(state.menuIndex).toBe(2);
    expect(act(state, "left").menuIndex).toBe(2);
    expect(act(state, "right").menuIndex).toBe(2);
  });

  it("moves nothing on a screen with no menu", () => {
    for (const screen of ["howto", "build", "program", "run"] as Screen[]) {
      const state = setScreen(titleState(), screen);
      expect(act(state, "up")).toBe(state);
      expect(act(state, "down")).toBe(state);
    }
  });

  it("leaves the camera actions to the frame loop", () => {
    for (const screen of ALL_SCREENS) {
      const state = setScreen(titleState(), screen);
      for (const action of ["left", "right", "zoom-in", "zoom-out"] as const) {
        expect(act(state, action).camera).toEqual(state.camera);
      }
    }
  });
});

// ---- Title and how to play --------------------------------------------------

describe("the title screen", () => {
  it("opens on the title with the first entry highlighted", () => {
    const state = titleState();
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });

  it("takes SITES to the site select, highlighting the open site", () => {
    const state = act(titleState(), "confirm");
    expect(state.screen).toBe("select");
    expect(state.menuIndex).toBe(state.siteIndex);
  });

  it("takes HOW TO PLAY to the how-to screen", () => {
    const state = act(titleState(), "down", "confirm");
    expect(state.screen).toBe("howto");
  });

  it("does nothing on back", () => {
    const state = titleState();
    expect(act(state, "back")).toBe(state);
  });

  it("returns from how to play to the title with the first entry", () => {
    const state = act(titleState(), "down", "confirm", "back");
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });
});

// ---- Site select ------------------------------------------------------------

describe("the site select", () => {
  it("enters an open site on its build screen", () => {
    const state = act(setScreen(titleState(), "select"), "confirm");
    expect(state.screen).toBe("build");
    expect(state.siteIndex).toBe(0);
    expect(state.history).toEqual([]);
    expect(state.run).toEqual(idleRun());
    expect(state.site.loads).toHaveLength(SIM_SITES[0].loads.length);
  });

  it("does nothing on a locked site", () => {
    const state = act(setScreen(titleState(), "select"), "down");
    expect(act(state, "confirm")).toBe(state);
  });

  it("enters the site after one that has been cleared", () => {
    const opened = setCleared(setScreen(titleState(), "select"), 0, true);
    const state = act(opened, "down", "confirm");
    expect(state.screen).toBe("build");
    expect(state.siteIndex).toBe(1);
  });

  it("returns to the title on back", () => {
    const state = act(setScreen(titleState(), "select"), "back");
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });

  it("arrives with the highlight on the site the yard screens showed", () => {
    const opened = setCleared(setScreen(titleState(), "select"), 0, true);
    const inSite = act(opened, "down", "confirm");
    expect(inSite.siteIndex).toBe(1);
    const back = act(inSite, "back");
    expect(back.screen).toBe("select");
    expect(back.menuIndex).toBe(1);
  });

  it("keeps a site's structure and tape across visits", () => {
    let state = act(setScreen(titleState(), "select"), "confirm");
    state = addMoveStep(state, "slew", 30, SLEW_MAX_RATE);
    state = act(state, "back", "confirm");
    expect(currentProgram(state)).toHaveLength(1);
  });
});

// ---- Build ------------------------------------------------------------------

describe("the build screen", () => {
  const build = (): GantryState => setScreen(titleState(), "build");

  it("selects each tool from its own action", () => {
    const tools: [ActionName, Tool][] = [
      ["tool-strut", "strut"],
      ["tool-cable", "cable"],
      ["tool-rail", "rail"],
      ["tool-ring", "ring"],
      ["tool-counterweight", "counterweight"],
      ["tool-delete", "delete"],
    ];
    for (const [action, tool] of tools) {
      expect(act(build(), action).tool).toBe(tool);
    }
  });

  it("selects no tool from any other screen", () => {
    for (const screen of ALL_SCREENS) {
      if (screen === "build") continue;
      const state = setScreen(titleState(), screen);
      expect(act(state, "tool-delete")).toBe(state);
    }
  });

  it("undoes through the editor and plays what the edit raises", () => {
    const state = build();
    act(state, "undo");
    expect(undo).toHaveBeenCalledTimes(1);
    expect(io.cues).toEqual(["delete"]);
  });

  it("undoes on no other screen", () => {
    for (const screen of ALL_SCREENS) {
      if (screen === "build") continue;
      const state = setScreen(titleState(), screen);
      expect(act(state, "undo")).toBe(state);
    }
    expect(undo).not.toHaveBeenCalled();
  });

  it("runs the static check and shows it", () => {
    const state = act(build(), "check");
    expect(showCheck).toHaveBeenCalledTimes(1);
    expect(state.checkResult).not.toBeNull();
  });

  it("checks on no other screen", () => {
    for (const screen of ALL_SCREENS) {
      if (screen === "build") continue;
      const state = setScreen(titleState(), screen);
      expect(act(state, "check")).toBe(state);
    }
    expect(showCheck).not.toHaveBeenCalled();
  });

  it("switches to the tape and back", () => {
    const toProgram = act(build(), "program");
    expect(toProgram.screen).toBe("program");
    expect(act(toProgram, "build").screen).toBe("build");
  });

  it("switches only in the one direction each action names", () => {
    const state = build();
    expect(act(state, "build")).toBe(state);
    const program = setScreen(titleState(), "program");
    expect(act(program, "program")).toBe(program);
  });

  it("returns to the select screen on back", () => {
    const state = act(build(), "back");
    expect(state.screen).toBe("select");
    expect(state.menuIndex).toBe(state.siteIndex);
  });

  it("clears a pending node before it leaves the screen", () => {
    const held: GantryState = { ...build(), pendingNode: [2, 4, 0] };
    const cleared = act(held, "back");
    expect(cleared.pendingNode).toBeNull();
    expect(cleared.screen).toBe("build");
    // A second `back` then leaves the screen.
    expect(act(cleared, "back").screen).toBe("select");
  });
});

// ---- Starting a run ---------------------------------------------------------

describe("the run action", () => {
  it("refuses an empty tape and a structure with a readiness issue", () => {
    const empty = setScreen(readyCrane(titleState()), "build");
    expect(act(empty, "run")).toBe(empty);
    const bare = setScreen(
      addMoveStep(titleState(), "slew", 30, SLEW_MAX_RATE),
      "build",
    );
    expect(act(bare, "run")).toBe(bare);
    expect(io.cues).toEqual([]);
  });

  it("names the issues a refused start would show", () => {
    const empty = setScreen(readyCrane(titleState()), "build");
    expect(pendingStartIssues(empty)).toEqual(["empty-program"]);
    const bare = setScreen(titleState(), "build");
    expect(pendingStartIssues(bare)).toEqual([
      "no-ring",
      "no-rail",
      "empty-program",
    ]);
    expect(pendingStartIssues(runnable())).toEqual([]);
  });

  it("starts from the build screen and from the program screen", () => {
    for (const screen of ["build", "program"] as Screen[]) {
      io = recorder();
      const state = act(runnable(screen), "run");
      expect(state.screen).toBe("run");
      expect(state.run.phase).toBe("running");
      expect(state.run.tick).toBe(0);
      expect(state.run.speedIndex).toBe(0);
      expect(io.cues).toEqual(["run-start"]);
    }
  });

  it("starts from no other screen", () => {
    for (const screen of ALL_SCREENS) {
      if (screen === "build" || screen === "program") continue;
      const state = setScreen(runnable(), screen);
      expect(act(state, "run")).toBe(state);
    }
    expect(io.cues).toEqual([]);
  });
});

// ---- The run screen ---------------------------------------------------------

describe("the run screen", () => {
  const running = (): GantryState => act(runnable(), "run");

  it("cycles the watch speed and wraps", () => {
    let state = running();
    const seen = [RUN_SPEEDS[state.run.speedIndex]];
    for (let i = 0; i < RUN_SPEEDS.length; i++) {
      state = act(state, "speed");
      seen.push(RUN_SPEEDS[state.run.speedIndex]);
    }
    expect(seen).toEqual([1, 2, 4, 1]);
  });

  it("cycles the speed on no other screen", () => {
    for (const screen of ALL_SCREENS) {
      if (screen === "run") continue;
      const state = setScreen(runnable(), screen);
      expect(act(state, "speed")).toBe(state);
    }
  });

  it("aborts a run in progress and returns to the build screen", () => {
    const state = act(running(), "back");
    expect(state.screen).toBe("build");
    expect(state.run).toEqual(idleRun());
  });

  it("returns to the build screen with no run in progress", () => {
    const ended: GantryState = {
      ...running(),
      run: { ...running().run, phase: "failed", cause: "collapse", tick: 120 },
    };
    const state = act(ended, "back");
    expect(state.screen).toBe("build");
    // The verdict stays readable (`specs/state.md`).
    expect(state.run.phase).toBe("failed");
    expect(state.run.cause).toBe("collapse");
    expect(state.run.tick).toBe(120);
  });

  it("leaves the structure and the tape as they were", () => {
    const before = runnable();
    const after = act(act(before, "run"), "back");
    expect(currentStructure(after)).toEqual(currentStructure(before));
    expect(currentProgram(after)).toEqual(currentProgram(before));
  });
});

// ---- Results ----------------------------------------------------------------

describe("the results screen", () => {
  const results = (index: number): GantryState => ({
    ...setScreen(titleState(), "results"),
    siteIndex: index,
    menuIndex: 0,
  });

  it("opens the next site and shows its build screen", () => {
    const state = act(results(0), "confirm");
    expect(state.screen).toBe("build");
    expect(state.siteIndex).toBe(1);
    expect(currentStructure(state)).toEqual(emptySiteStructure());
  });

  it("replays this site", () => {
    const state = act(results(2), "down", "confirm");
    expect(state.screen).toBe("build");
    expect(state.siteIndex).toBe(2);
  });

  it("returns to the select screen, opening no site", () => {
    const before = results(2);
    const state = act(before, "down", "down", "confirm");
    expect(state.screen).toBe("select");
    expect(state.siteIndex).toBe(2);
    expect(state.menuIndex).toBe(2);
  });

  it("leaves NEXT SITE out on the last site", () => {
    const last = results(SITE_COUNT - 1);
    expect(menuLength(last)).toBe(RESULTS_ITEMS.length - 1);
    // The first entry is now REPLAY.
    const state = act(last, "confirm");
    expect(state.screen).toBe("build");
    expect(state.siteIndex).toBe(SITE_COUNT - 1);
    // The second is SITE SELECT.
    expect(act(last, "down", "confirm").screen).toBe("select");
  });

  it("does what SITE SELECT does on back", () => {
    const state = act(results(3), "back");
    expect(state.screen).toBe("select");
    expect(state.siteIndex).toBe(3);
    expect(state.menuIndex).toBe(3);
  });

  it("returns the camera and the history when it opens a site", () => {
    const dirty: GantryState = {
      ...results(0),
      camera: { yaw: 200, pitch: 60, dist: 20 },
      history: [emptySiteStructure()],
    };
    const state = act(dirty, "confirm");
    expect(state.camera).toEqual(titleState().camera);
    expect(state.history).toEqual([]);
    expect(state.run).toEqual(idleRun());
  });
});

// ---- Mute -------------------------------------------------------------------

describe("mute", () => {
  it("toggles sound from every screen and changes nothing else", () => {
    for (const screen of ALL_SCREENS) {
      const state = setScreen(titleState(), screen);
      expect(act(state, "mute")).toBe(state);
    }
    expect(io.mutes).toBe(ALL_SCREENS.length);
  });
});

// ---- The tape editor's pointer ---------------------------------------------

describe("the tape editor's pointer", () => {
  const program = (): GantryState =>
    addMoveStep(setScreen(titleState(), "program"), "slew", 90, SLEW_MAX_RATE);

  it("takes a press on a widget and edits the tape", () => {
    const state = program();
    const target = tapeLayout(state).widgets.find(
      (w) => w.kind === "nudge-target" && w.delta === 1,
    )!;
    const outcome = handlePointer(
      state,
      {
        kind: "down",
        x: target.rect.x + target.rect.w / 2,
        y: target.rect.y + target.rect.h / 2,
      },
      io,
    );
    expect(outcome.consumed).toBe(true);
    const step = currentProgram(outcome.state)[0];
    expect(step.kind === "move" && step.commands[0].target).toBe(91);
  });

  it("takes a press on the panel that lands on no widget, and edits nothing", () => {
    const state = program();
    const outcome = handlePointer(
      state,
      { kind: "down", x: PANEL.x + 3, y: PANEL.y + 3 },
      io,
    );
    expect(insidePanel(PANEL.x + 3, PANEL.y + 3)).toBe(true);
    expect(outcome.consumed).toBe(true);
    expect(outcome.state).toBe(state);
  });

  it("leaves a press off the panel to the camera", () => {
    const state = program();
    const outcome = handlePointer(state, { kind: "down", x: 1200, y: 400 }, io);
    expect(outcome.consumed).toBe(false);
    expect(outcome.state).toBe(state);
  });

  it("keeps a captured press for the whole of it and edits nothing more", () => {
    const captured: GantryState = {
      ...program(),
      pointer: { ...program().pointer, down: true, captured: true },
    };
    for (const kind of ["move", "up"] as const) {
      const outcome = handlePointer(captured, { kind, x: 100, y: 100 }, io);
      expect(outcome.consumed).toBe(true);
      expect(outcome.state).toBe(captured);
    }
  });

  it("takes no move or release of a press it did not take", () => {
    const state = program();
    expect(handlePointer(state, { kind: "move", x: 100, y: 100 }, io)).toEqual({
      state,
      consumed: false,
    });
  });

  it("takes nothing on any other screen", () => {
    for (const screen of ALL_SCREENS) {
      if (screen === "program") continue;
      const state = setScreen(program(), screen);
      const outcome = handlePointer(
        state,
        { kind: "down", x: PANEL.x + 3, y: PANEL.y + 3 },
        io,
      );
      expect(outcome).toEqual({ state, consumed: false });
    }
  });

  it("plays no cue: the tape editor raises none", () => {
    const state = program();
    const target = tapeLayout(state).widgets.find(
      (w) => w.kind === "add-action",
    )!;
    handlePointer(
      state,
      {
        kind: "down",
        x: target.rect.x + 4,
        y: target.rect.y + 4,
      },
      io,
    );
    expect(io.cues).toEqual([]);
  });
});
