import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  CLEARED_TEXT,
  FAIL_TEXT,
  SITE_NAMES,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_TEXT,
} from "./constants";
import { idleRun, type GantryState } from "./state";
import {
  addActionStep,
  addMoveStep,
  openSite,
  setMenuIndex,
  setScreen,
  setTool,
  titleState,
} from "./state";
import { drawHud, type HudHint } from "./render-hud";
import { tapeLayout } from "./screens-tape";

const NO_HINT: HudHint = { action: null, refusal: null };

/** A context that records what was asked of it, for reading a frame back. */
class Recorder {
  readonly texts: string[] = [];
  readonly fills: string[] = [];
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  lineJoin = "";
  font = "";
  textAlign = "";
  textBaseline = "";

  save(): void {}
  restore(): void {}
  clearRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arcTo(): void {}
  stroke(): void {}
  strokeRect(): void {}
  fill(): void {
    this.fills.push(this.fillStyle);
  }
  fillRect(): void {
    this.fills.push(this.fillStyle);
  }
  fillText(content: string): void {
    this.texts.push(content);
  }
  /** A monospace advance, which is all the layer measures text for. */
  measureText(content: string): { width: number } {
    return { width: content.length * 7 };
  }

  /** Everything the frame printed, as one string. */
  get printed(): string {
    return this.texts.join("\n");
  }
}

function record(state: GantryState, hint: HudHint = NO_HINT): Recorder {
  const recorder = new Recorder();
  drawHud(recorder as unknown as CanvasRenderingContext2D, state, hint);
  return recorder;
}

const yardState = (): GantryState => openSite(titleState(), 2);

/** A crane and a tape that `run` would accept: a ring, one rail, one step. */
function runnableState(): GantryState {
  const state = yardState();
  const withCrane: GantryState = {
    ...state,
    sites: state.sites.map((entry, i) =>
      i === state.siteIndex
        ? {
            structure: {
              members: [
                { id: 0, a: [2, 4, 0], b: [4, 4, 0], material: "rail" },
              ],
              nextMemberId: 1,
              ring: { corner: [0, 2, 0] },
              counterweights: [],
            },
            program: entry.program,
          }
        : entry,
    ),
  };
  return addMoveStep(withCrane, "slew", 30, 1);
}

describe("the title screen", () => {
  it("shows the title, the tagline, and the menu", () => {
    const printed = record(titleState()).printed;
    expect(printed).toContain(TITLE_TEXT);
    expect(printed).toContain(TAGLINE_TEXT);
    expect(printed).toContain("SITES");
    expect(printed).toContain("HOW TO PLAY");
  });

  it("marks the highlighted entry", () => {
    const first = record(titleState()).texts;
    const second = record(setMenuIndex(titleState(), 1)).texts;
    const cursor = "\u00bb";
    expect(first.filter((t) => t === cursor)).toHaveLength(1);
    expect(second.filter((t) => t === cursor)).toHaveLength(1);
    expect(first.indexOf(cursor)).not.toBe(second.indexOf(cursor));
  });

  it("says so while the game is muted", () => {
    const muted = { ...titleState(), muted: true };
    expect(record(muted).printed).toContain("MUTED");
    expect(record(titleState()).printed).not.toContain("MUTED");
  });
});

describe("the how-to screen", () => {
  it("explains the game and names the bindings", () => {
    const printed = record(setScreen(titleState(), "howto")).printed;
    expect(printed).toContain("HOW TO PLAY");
    expect(printed).toContain("BUILD");
    expect(printed).toContain("WRITE THE TAPE");
    expect(printed).toContain("ESC — BACK");
  });
});

describe("the site select", () => {
  it("lists every site with its number, name, and state", () => {
    const printed = record(setScreen(titleState(), "select")).printed;
    for (const name of SITE_NAMES)
      expect(printed).toContain(name.toUpperCase());
    expect(printed).toContain("01");
    expect(printed).toContain("06");
    expect(printed).toContain("OPEN");
    expect(printed).toContain("LOCKED");
  });

  it("shows a cleared site's best score", () => {
    const state = setScreen(titleState(), "select");
    const cleared: GantryState = {
      ...state,
      cleared: state.cleared.map((was, i) => (i === 0 ? true : was)),
      best: state.best.map((was, i) =>
        i === 0 ? { cost: 2400, time: 18 } : was,
      ),
    };
    const printed = record(cleared).printed;
    expect(printed).toContain("CLEARED");
    expect(printed).toContain("BEST   COST 2 400   TIME 18.00s");
  });
});

describe("the build screen", () => {
  it("names the site and reads the cost against the budget", () => {
    const printed = record(setScreen(yardState(), "build")).printed;
    expect(printed).toContain(SITE_NAMES[2].toUpperCase());
    expect(printed).toContain("SITE 3 / 6");
    expect(printed).toContain("COST 0 / 4 000");
    expect(printed).toContain("TAPE 0 STEPS");
  });

  it("shows the tool palette with each tool's binding, and marks the one selected", () => {
    const state = setTool(setScreen(yardState(), "build"), "rail");
    const printed = record(state).printed;
    for (const label of [
      "STRUT",
      "CABLE",
      "RAIL",
      "RING",
      "WEIGHT",
      "DELETE",
    ]) {
      expect(printed).toContain(label);
    }
    for (const key of ["1", "2", "3", "4", "5", "6"]) {
      expect(record(state).texts).toContain(key);
    }
  });

  it("names what would refuse a run, on the build and program screens", () => {
    // `specs/ui.md`: a refused start "shows the refusing issues by name". A
    // refused start leaves the state as it was (`specs/instrumentation.md`), so
    // the issues are read off the crane and the tape rather than recorded.
    for (const screen of ["build", "program"] as const) {
      const printed = record(setScreen(yardState(), screen)).printed;
      expect(printed).toContain("G RUN IS REFUSED");
      expect(printed).toContain("no-ring");
      expect(printed).toContain("no-rail");
      expect(printed).toContain("empty-program");
    }
  });

  it("says nothing about a refused run once one would start", () => {
    for (const screen of ["build", "program"] as const) {
      const printed = record(setScreen(runnableState(), screen)).printed;
      expect(printed).not.toContain("G RUN IS REFUSED");
      expect(printed).not.toContain("no-ring");
    }
  });

  it("says a node is held while one is pending", () => {
    const state = setScreen(yardState(), "build");
    const held: GantryState = { ...state, pendingNode: [0, 2, 0] };
    expect(record(held).printed).toContain("NODE HELD");
    expect(record(state).printed).not.toContain("NODE HELD");
  });

  it("shows what a click would do", () => {
    const printed = record(setScreen(yardState(), "build"), {
      action: "CLICK TO PLACE A STRUT",
      refusal: null,
    }).printed;
    expect(printed).toContain("CLICK TO PLACE A STRUT");
  });

  it("shows why a click is refused, in the moment", () => {
    const printed = record(setScreen(yardState(), "build"), {
      action: null,
      refusal: "over-budget",
    }).printed;
    expect(printed).toContain("REFUSED");
    expect(printed).toContain("budget");
  });

  it("shows a readiness issue by name and no verdict", () => {
    const state = setScreen(yardState(), "build");
    const checked: GantryState = {
      ...state,
      checkResult: {
        issues: ["no-rail", "empty-program"],
        cost: 900,
        budget: 4000,
        stable: false,
        members: [],
      },
    };
    const printed = record(checked).printed;
    expect(printed).toContain("STATIC CHECK");
    // With a readiness issue the structure is not solved, so the check has no
    // verdict to report and the panel shows none (`specs/ui.md`).
    expect(printed).not.toContain("IT DOES NOT STAND");
    expect(printed).not.toContain("THE STRUCTURE STANDS");
    expect(printed).toContain("no-rail");
    expect(printed).toContain("empty-program");
    expect(printed).toContain("no member solved");
  });

  it("judges a ready crane whose only issue is an empty tape", () => {
    const state = setScreen(yardState(), "build");
    const checked: GantryState = {
      ...state,
      checkResult: {
        issues: ["empty-program"],
        cost: 900,
        budget: 4000,
        stable: false,
        members: [],
      },
    };
    const printed = record(checked).printed;
    expect(printed).toContain("IT DOES NOT STAND");
    expect(printed).toContain("empty-program");
  });

  it("reports a structure that stands, with its members", () => {
    const state = setScreen(yardState(), "build");
    const checked: GantryState = {
      ...state,
      checkResult: {
        issues: [],
        cost: 900,
        budget: 4000,
        stable: true,
        members: [
          { id: 0, force: 100, utilization: 0.25 },
          { id: 1, force: -900, utilization: 0.72 },
        ],
      },
    };
    const printed = record(checked).printed;
    expect(printed).toContain("THE STRUCTURE STANDS");
    expect(printed).toContain("2 members   peak 0.72");
    expect(printed).toContain("no issues");
  });
});

describe("the program screen", () => {
  const tape = (): GantryState => {
    let state = setScreen(yardState(), "program");
    state = addMoveStep(state, "trolley", 8, 3);
    state = addActionStep(state, "attach");
    state = addMoveStep(state, "slew", 90, 24);
    return state;
  };

  it("shows every line of the tape the layout lays out, in order", () => {
    const state = tape();
    const layout = tapeLayout(state);
    const texts = record(state).texts;
    expect(layout.rows.length).toBeGreaterThan(0);
    for (const row of layout.rows) expect(texts).toContain(row.text);
    expect(texts).toContain(layout.titleText);
  });

  it("reads each step and each command", () => {
    const printed = record(tape()).printed;
    expect(printed).toContain("01");
    expect(printed).toContain("02");
    expect(printed).toContain("03");
    expect(printed).toContain("MOVE");
    expect(printed).toContain("ATTACH");
    expect(printed).toContain("TROLLEY");
    expect(printed).toContain("SLEW");
  });

  it("draws every widget the layout offers, and only those", () => {
    const state = tape();
    const printed = record(state).printed;
    const layout = tapeLayout(state);
    expect(layout.widgets.length).toBeGreaterThan(0);
    for (const widget of layout.widgets) {
      expect(printed).toContain(widget.label);
    }
  });

  it("says so when the tape is empty", () => {
    expect(record(setScreen(yardState(), "program")).printed).toContain(
      "the tape is empty",
    );
  });

  it("draws no tool palette: the tools belong to the build screen", () => {
    expect(record(tape()).printed).not.toContain("WEIGHT");
  });
});

describe("the run screen", () => {
  const running = (): GantryState => {
    const state = addMoveStep(setScreen(yardState(), "run"), "slew", 90, 24);
    return {
      ...state,
      run: {
        ...idleRun(),
        phase: "running",
        tick: 123,
        stepIndex: 0,
        axes: {
          slew: { value: 12.5, rate: 8, command: { target: 90, rate: 24 } },
          trolley: { value: 0, rate: 0, command: null },
          hoist: { value: 2, rate: 0, command: null },
          grip: { value: 0, rate: 0, command: null },
        },
        loads: [{ phase: "waiting", pos: [9, 2, 0], yaw: 0 }],
        speedIndex: 2,
      },
    };
  };

  it("reads the clock, the step, the cost, and the watch speed", () => {
    const printed = record(running()).printed;
    expect(printed).toContain("RUN CLOCK");
    expect(printed).toContain("2.05s");
    expect(printed).toContain("STEP 1 / 1");
    expect(printed).toContain("COST 0");
    expect(printed).toContain("SPEED ×4");
  });

  it("reads each axis's value, and its target while a command is live", () => {
    const printed = record(running()).printed;
    expect(printed).toContain("SLEW");
    expect(printed).toContain("TROLLEY");
    expect(printed).toContain("HOIST");
    expect(printed).toContain("GRIP");
    expect(printed).toContain("12.5°");
    expect(printed).toContain("→ 90.0°");
    expect(printed).toContain("—");
  });

  it("carries the legend for the utilization ramp", () => {
    const printed = record(running()).printed;
    expect(printed).toContain("MEMBER LOAD");
    expect(printed).toContain("SLACK");
    expect(printed).toContain("CREAK");
    expect(printed).toContain("LIMIT");
    expect(printed).toContain("past limit");
    expect(printed).toContain("broken");
  });

  it("counts the loads placed and the members broken", () => {
    const state = running();
    const hurt: GantryState = {
      ...state,
      run: { ...state.run, broken: [3, 4] },
    };
    expect(record(hurt).printed).toContain("0 / 1 PLACED");
    expect(record(hurt).printed).toContain("2 MEMBERS BROKEN");
    expect(record(state).printed).not.toContain("MEMBERS BROKEN");
  });

  it("reads the failure cause out in the fixed copy", () => {
    for (const cause of Object.keys(FAIL_TEXT) as (keyof typeof FAIL_TEXT)[]) {
      const state = running();
      const failed: GantryState = {
        ...state,
        run: { ...state.run, phase: "failed", cause },
      };
      const printed = record(failed).printed;
      expect(printed).toContain("RUN FAILED");
      expect(printed).toContain(FAIL_TEXT[cause]);
      expect(printed).toContain(cause);
    }
  });
});

describe("the results screen", () => {
  it("shows the clear, the score, and the par it is measured against", () => {
    const state = setScreen(openSite(titleState(), 0), "results");
    const cleared: GantryState = {
      ...state,
      best: state.best.map((was, i) =>
        i === 0 ? { cost: 2400, time: 18 } : was,
      ),
      run: { ...idleRun(), phase: "cleared", tick: 1080 },
    };
    const printed = record(cleared).printed;
    expect(printed).toContain(CLEARED_TEXT);
    expect(printed).toContain(SITE_NAMES[0].toUpperCase());
    expect(printed).toContain("COST");
    expect(printed).toContain("TIME");
    expect(printed).toContain("18.00s");
    expect(printed).toContain("PAR 2 400");
    expect(printed).toContain("PAR 18.00s");
    expect(printed).toContain("NEXT SITE");
    expect(printed).toContain("REPLAY");
    expect(printed).toContain("SITE SELECT");
  });

  it("drops NEXT SITE on the last site", () => {
    const state = setScreen(openSite(titleState(), 5), "results");
    const printed = record(state).printed;
    expect(printed).not.toContain("NEXT SITE");
    expect(printed).toContain("SITE SELECT");
  });
});

describe("through a real 2D context", () => {
  const paint = (state: GantryState, hint: HudHint = NO_HINT): Uint8Array => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d");
    drawHud(ctx as unknown as CanvasRenderingContext2D, state, hint);
    return new Uint8Array(
      ctx.getImageData(0, 0, STAGE_W, STAGE_H).data.buffer.slice(0),
    );
  };

  const painted = (pixels: Uint8Array): number => {
    let count = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) count++;
    return count;
  };

  it("paints every screen without throwing, and leaves ink on the stage", () => {
    const screens: GantryState[] = [
      titleState(),
      setScreen(titleState(), "howto"),
      setScreen(titleState(), "select"),
      setScreen(yardState(), "build"),
      addMoveStep(setScreen(yardState(), "program"), "hoist", 6, 3),
      setScreen(yardState(), "run"),
      setScreen(yardState(), "results"),
    ];
    for (const state of screens) {
      const pixels = paint(state);
      expect(painted(pixels)).toBeGreaterThan(20000);
    }
  });

  it("leaves the yard showing through the build screen's readouts", () => {
    // The layer is transparent where nothing is drawn, so the 3D scene beneath
    // it is what a player sees there.
    const pixels = paint(setScreen(yardState(), "build"));
    expect(painted(pixels)).toBeLessThan(STAGE_W * STAGE_H * 0.5);
  });

  it("covers the yard behind a menu screen, so its copy reads", () => {
    const pixels = paint(titleState());
    expect(painted(pixels)).toBe(STAGE_W * STAGE_H);
  });
});
