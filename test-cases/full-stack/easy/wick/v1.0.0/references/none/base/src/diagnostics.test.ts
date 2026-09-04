import { describe, expect, it } from "vitest";
import { CUES, type Cue } from "./constants";
import {
  Diagnostics,
  formatClock,
  registerAudioDiagnostics,
  registerGameDiagnostics,
} from "./diagnostics";
import { Game } from "./game";
import { SWITCH_NAMES } from "./state";

function game(): Game {
  let muted = false;
  return new Game({
    toggleMute: () => {
      muted = !muted;
    },
    isMuted: () => muted,
  });
}

/** The overlay's lines as a label-to-value map. */
function lines(diagnostics: Diagnostics): Map<string, string> {
  return new Map(diagnostics.lines().map(({ label, value }) => [label, value]));
}

describe("the run clock", () => {
  it("formats whole seconds as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9.99)).toBe("0:09");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(600)).toBe("10:00");
  });
});

describe("the game's sources", () => {
  it("report the facts the snapshot reports, read fresh at each draw", () => {
    const g = game();
    const diagnostics = new Diagnostics();
    registerGameDiagnostics(diagnostics, g);
    const idle = lines(diagnostics);
    expect(idle.get("screen")).toBe("title");
    expect(idle.get("clock")).toBe("0:00 (tick 0)");
    expect(idle.get("weapons")).toBe("");
    for (const name of SWITCH_NAMES) expect(idle.get(name)).toBe("on");
    expect(idle.get("autoStep")).toBe("true");

    g.startRun();
    g.state.run.tick = 90;
    g.state.run.kills = 7;
    g.state.run.pendingLevelUps = 2;
    g.state.switches.spawning = false;
    g.autoStep = false;
    const live = lines(diagnostics);
    expect(live.get("screen")).toBe("playing");
    expect(live.get("clock")).toBe("0:01 (tick 90)");
    expect(live.get("level")).toBe("1  xp 0.0 / 5");
    expect(live.get("hp")).toBe("100.0 / 100");
    expect(live.get("kills")).toBe("7");
    expect(live.get("lamplighter")).toBe("0.0, 0.0 right");
    expect(live.get("enemies")).toBe("0  window 0");
    expect(live.get("effects")).toBe("0 projectiles, 0 zones");
    expect(live.get("gems")).toBe("0");
    expect(live.get("weapons")).toBe("taper L1 0.00s");
    expect(live.get("passives")).toBe("");
    expect(live.get("pending")).toBe("2");
    expect(live.get("spawning")).toBe("off");
    expect(live.get("autoStep")).toBe("false");
  });

  it("leave the game as it is when read", () => {
    const g = game();
    const diagnostics = new Diagnostics();
    registerGameDiagnostics(diagnostics, g);
    g.startRun();
    const before = JSON.stringify(g.state);
    diagnostics.lines();
    diagnostics.lines();
    expect(JSON.stringify(g.state)).toBe(before);
  });
});

describe("the audio sources", () => {
  it("name the loops sounding and the mute bit", () => {
    const diagnostics = new Diagnostics();
    let looping: Cue[] = [];
    const audio = {
      looping: () => looping,
      muted: false,
    };
    registerAudioDiagnostics(diagnostics, audio);
    expect(lines(diagnostics).get("loops")).toBe("none");
    expect(lines(diagnostics).get("muted")).toBe("no");
    looping = [CUES.music, CUES.hum];
    audio.muted = true;
    expect(lines(diagnostics).get("loops")).toBe("music, hum");
    expect(lines(diagnostics).get("muted")).toBe("yes");
  });
});
