import { describe, expect, it } from "vitest";
import { GantryState } from "./game";
import { silentIo, type GameIo } from "./io";
import { handleAction, handlePointer, pendingStartIssues } from "./screens";
import { addMoveStep, currentProgram, setScreen } from "./state";
import { PANEL } from "./tape";
import type { CueName } from "./constants";

/** An io that remembers what it was asked to play. */
function recordingIo(): GameIo & { cues: CueName[]; toggles: number } {
  const io = silentIo();
  const cues: CueName[] = [];
  let toggles = 0;
  return {
    playCue(cue) {
      cues.push(cue);
    },
    setMotor: io.setMotor,
    setMusic: io.setMusic,
    toggleMute() {
      toggles += 1;
    },
    muted: io.muted,
    get cues() {
      return cues;
    },
    get toggles() {
      return toggles;
    },
  };
}

describe("pendingStartIssues", () => {
  it("lists what would refuse a run, in the order check reports them", () => {
    expect([...pendingStartIssues(new GantryState())]).toEqual([
      "no-ring",
      "no-rail",
      "empty-program",
    ]);
  });
});

describe("handleAction — the menus", () => {
  it("moves the highlight by one and wraps at both ends", () => {
    const s = new GantryState();
    handleAction(s, "down", silentIo());
    expect(s.menuIndex).toBe(1);
    handleAction(s, "down", silentIo());
    expect(s.menuIndex).toBe(0);
    handleAction(s, "up", silentIo());
    expect(s.menuIndex).toBe(1);
  });

  it("leaves the highlight where it is on left and right", () => {
    const s = new GantryState();
    s.menuIndex = 1;
    handleAction(s, "left", silentIo());
    handleAction(s, "right", silentIo());
    expect(s.menuIndex).toBe(1);
  });

  it("takes SITES and HOW TO PLAY from the title menu", () => {
    const s = new GantryState();
    handleAction(s, "confirm", silentIo());
    expect(s.screen).toBe("select");
    handleAction(s, "back", silentIo());
    expect(s.screen).toBe("title");
    handleAction(s, "down", silentIo());
    handleAction(s, "confirm", silentIo());
    expect(s.screen).toBe("howto");
  });

  it("does nothing on back from the title", () => {
    const s = new GantryState();
    handleAction(s, "back", silentIo());
    expect(s.screen).toBe("title");
  });

  it("highlights the site the yard screens last showed on arriving", () => {
    const s = new GantryState();
    s.siteIndex = 2;
    s.cleared = [true, true, false, false, false, false];
    setScreen(s, "build");
    handleAction(s, "back", silentIo());
    expect(s.screen).toBe("select");
    expect(s.menuIndex).toBe(2);
  });

  it("enters an open site and refuses a locked one", () => {
    const s = new GantryState();
    setScreen(s, "select");
    s.menuIndex = 3;
    handleAction(s, "confirm", silentIo());
    expect(s.screen).toBe("select");
    s.menuIndex = 0;
    handleAction(s, "confirm", silentIo());
    expect(s.screen).toBe("build");
    expect(s.siteIndex).toBe(0);
  });
});

describe("handleAction — the build screen", () => {
  it("selects a tool on the build screen and nowhere else", () => {
    const s = new GantryState();
    handleAction(s, "tool-rail", silentIo());
    expect(s.tool).toBe("strut");
    setScreen(s, "build");
    handleAction(s, "tool-rail", silentIo());
    expect(s.tool).toBe("rail");
  });

  it("clears a held node with back before it leaves the screen", () => {
    const s = new GantryState();
    setScreen(s, "build");
    s.pendingNode = { x: 0, y: 0, z: 0 };
    handleAction(s, "back", silentIo());
    expect(s.pendingNode).toBeNull();
    expect(s.screen).toBe("build");
    handleAction(s, "back", silentIo());
    expect(s.screen).toBe("select");
  });

  it("shows the static check and switches to the tape and back", () => {
    const s = new GantryState();
    setScreen(s, "build");
    handleAction(s, "check", silentIo());
    expect(s.checkResult).not.toBeNull();
    handleAction(s, "program", silentIo());
    expect(s.screen).toBe("program");
    handleAction(s, "build", silentIo());
    expect(s.screen).toBe("build");
  });

  it("raises delete on an undo that reverses an edit", () => {
    const s = new GantryState();
    setScreen(s, "build");
    const io = recordingIo();
    handleAction(s, "undo", io);
    expect(io.cues).toEqual([]);
    s.history.push(s.sites[0].structure);
    handleAction(s, "undo", io);
    expect(io.cues).toEqual(["delete"]);
  });

  it("leaves a refused run exactly where it was", () => {
    const s = new GantryState();
    setScreen(s, "build");
    const io = recordingIo();
    handleAction(s, "run", io);
    expect(s.screen).toBe("build");
    expect(io.cues).toEqual([]);
  });
});

describe("handleAction — the run screen and mute", () => {
  it("cycles the watch speed and wraps", () => {
    const s = new GantryState();
    setScreen(s, "run");
    for (const expected of [1, 2, 0]) {
      handleAction(s, "speed", silentIo());
      expect(s.run.speedIndex).toBe(expected);
    }
  });

  it("cycles nothing off the run screen", () => {
    const s = new GantryState();
    handleAction(s, "speed", silentIo());
    expect(s.run.speedIndex).toBe(0);
  });

  it("toggles the sound from any screen", () => {
    const io = recordingIo();
    const s = new GantryState();
    handleAction(s, "mute", io);
    setScreen(s, "run");
    handleAction(s, "mute", io);
    expect(io.toggles).toBe(2);
  });

  it("returns to the build screen from a run that is over", () => {
    const s = new GantryState();
    setScreen(s, "run");
    handleAction(s, "back", silentIo());
    expect(s.screen).toBe("build");
  });
});

describe("handlePointer", () => {
  it("takes nothing off the program screen", () => {
    const s = new GantryState();
    setScreen(s, "build");
    expect(handlePointer(s, { kind: "down", x: 100, y: 100 }, silentIo())).toBe(
      false,
    );
  });

  it("takes nothing pressed outside the panel", () => {
    const s = new GantryState();
    setScreen(s, "program");
    expect(handlePointer(s, { kind: "down", x: 1200, y: 60 }, silentIo())).toBe(
      false,
    );
  });

  it("takes the whole press once it lands on the panel", () => {
    const s = new GantryState();
    setScreen(s, "program");
    const inside = { x: PANEL.x + 4, y: PANEL.y + 4 };
    expect(handlePointer(s, { kind: "down", ...inside }, silentIo())).toBe(
      true,
    );
    expect(currentProgram(s)).toHaveLength(0);
    expect(handlePointer(s, { kind: "move", ...inside }, silentIo())).toBe(
      true,
    );
    expect(handlePointer(s, { kind: "up", ...inside }, silentIo())).toBe(true);
  });

  it("works the widget under the press", () => {
    const s = new GantryState();
    setScreen(s, "program");
    addMoveStep(s, "slew", 90, 30);
    const before = currentProgram(s).length;
    // The add bar's first button appends a move on the slew axis.
    expect(
      handlePointer(s, { kind: "down", x: PANEL.x + 40, y: 640 }, silentIo()),
    ).toBe(true);
    expect(currentProgram(s).length).toBe(before + 1);
  });
});
