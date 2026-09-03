// The screen layer: what each screen prints, and that it draws through a real
// 2D context at the logical stage size.

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
import { point } from "./convert";
import * as edits from "./edits";
import type { GantryState } from "./game";
import { drawHud, clip, type HudHint } from "./render-hud";
import {
  addActionStep,
  addMoveStep,
  beginRun,
  openSite,
  setBest,
  setCleared,
  setMenuIndex,
  setScreen,
  setTool,
  titleState,
} from "./state";
import { tapeLayout } from "./tape";

const NO_HINT: HudHint = { action: null, refusal: null };

/** A context that records what was asked of it, for reading a frame back. */
class Recorder {
  readonly texts: string[] = [];
  readonly fills: string[] = [];
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  lineCap = "";
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

const yard = (): GantryState => setScreen(openSite(titleState(), 2), "build");

/** A ring and one arm rail, with a tape: what a run will start on. */
function runnable(): GantryState {
  let s = setScreen(openSite(titleState(), 0), "build");
  s = edits.setRing(s, point(0, 2, 0)).state;
  s = edits.addMember(s, point(2, 4, 0), point(4, 4, 0), "rail").state;
  return addMoveStep(s, "slew", 15, 30);
}

describe("the title screen", () => {
  it("prints the title, the tagline, and the menu", () => {
    const out = record(titleState()).printed;
    expect(out).toContain(TITLE_TEXT);
    expect(out).toContain(TAGLINE_TEXT);
    expect(out).toContain("SITES");
    expect(out).toContain("HOW TO PLAY");
  });

  it("says so when the sound is off", () => {
    expect(record(titleState()).printed).not.toContain("MUTED");
    expect(record({ ...titleState(), muted: true }).printed).toContain("MUTED");
  });
});

describe("the how-to screen", () => {
  it("prints every heading", () => {
    const out = record(setScreen(titleState(), "howto")).printed;
    expect(out).toContain("HOW TO PLAY");
    expect(out).toContain("READ THE SITE");
    expect(out).toContain("RUN AND WATCH");
  });
});

describe("the site select", () => {
  it("lists every site with its state and its best score", () => {
    let s: GantryState = setScreen(titleState(), "select");
    s = setBest(setCleared(s, 0, true), 0, { cost: 2400, time: 18 });
    const out = record(s).printed;
    for (const name of SITE_NAMES) expect(out).toContain(name.toUpperCase());
    expect(out).toContain("CLEARED");
    expect(out).toContain("LOCKED");
    expect(out).toContain("BEST   COST 2 400   TIME 18.00s");
  });
});

describe("the build screen", () => {
  it("names the site, reads the cost, and marks the selected tool", () => {
    const out = record(setTool(yard(), "rail")).printed;
    expect(out).toContain(SITE_NAMES[2].toUpperCase());
    expect(out).toContain("SITE 3 / 6");
    expect(out).toContain("COST 0 / 4 000");
    expect(out).toContain("RAIL");
    expect(out).toContain("TAPE 0 STEPS");
  });

  it("shows what would refuse a run, by name", () => {
    const out = record(yard()).printed;
    expect(out).toContain("G RUN IS REFUSED");
    expect(out).toContain("no-ring");
    expect(out).toContain("empty-program");
  });

  it("says nothing about a refusal once nothing refuses", () => {
    const started = beginRun(runnable());
    expect(started).not.toBeNull();
    const out = record(setScreen(runnable(), "build")).printed;
    expect(out).not.toContain("G RUN IS REFUSED");
  });

  it("shows the check's verdict once it has run", () => {
    const checked = edits.showCheck(runnable());
    const out = record(checked).printed;
    expect(out).toContain("STATIC CHECK");
    expect(out).toMatch(/THE STRUCTURE STANDS|IT DOES NOT STAND/);
  });

  it("shows the check's issues, and no verdict, while one stands", () => {
    const checked = edits.showCheck(yard());
    const out = record(checked).printed;
    expect(out).toContain("no-ring");
    expect(out).not.toContain("THE STRUCTURE STANDS");
    expect(out).toContain("no member solved");
  });

  it("says a node is held", () => {
    const held = { ...yard(), pendingNode: point(2, 4, 0) };
    expect(record(held).printed).toContain("NODE HELD — ESC DROPS");
  });

  it("says what a click would do, and why one would be refused", () => {
    expect(
      record(yard(), { action: "CLICK TO PLACE A STRUT", refusal: null })
        .printed,
    ).toContain("CLICK TO PLACE A STRUT");
    const refused = record(yard(), { action: null, refusal: "too-long" });
    expect(refused.printed).toContain("REFUSED — longer than this material");
  });
});

describe("the program screen", () => {
  it("draws the tape editor's own layout", () => {
    let s = setScreen(yard(), "program");
    s = addMoveStep(s, "slew", 90, 30);
    s = addActionStep(s, "attach");
    const out = record(s).printed;
    expect(out).toContain("TAPE — 2 STEPS");
    expect(out).toContain("01  MOVE");
    expect(out).toContain("02  ATTACH");
    // Every button the layout names is drawn.
    for (const widget of tapeLayout(s).bar) {
      expect(out).toContain(widget.label);
    }
  });

  it("says the tape is empty when it is", () => {
    const out = record(setScreen(yard(), "program")).printed;
    expect(out).toContain("the tape is empty");
  });

  it("says how many rows it had no room for", () => {
    let s = setScreen(yard(), "program");
    for (let i = 0; i < 60; i++) s = addActionStep(s, "attach");
    expect(record(s).printed).toContain("MORE BELOW");
  });
});

describe("the run screen", () => {
  const running = (): GantryState => {
    const started = beginRun(runnable());
    if (started === null) throw new Error("the crane should have run");
    return started;
  };

  it("reads the clock, the step, the cost, the speed, and every axis", () => {
    const out = record(running()).printed;
    expect(out).toContain("RUN CLOCK");
    expect(out).toContain("0.00s");
    expect(out).toContain("STEP 1 / 1");
    expect(out).toContain("SPEED ×1");
    for (const label of ["SLEW", "TROLLEY", "HOIST", "GRIP"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain("0 / 1 PLACED");
  });

  it("carries a legend for the utilization ramp", () => {
    const out = record(running()).printed;
    expect(out).toContain("MEMBER LOAD");
    expect(out).toContain("SLACK");
    expect(out).toContain("LIMIT");
    expect(out).toContain("CREAK");
    expect(out).toContain("past limit");
    expect(out).toContain("broken");
  });

  it("counts the members a run has broken", () => {
    const s = running();
    s.run.broken = [0];
    expect(record(s).printed).toContain("1 MEMBERS BROKEN");
  });

  it("shows the failure copy and the cause when a run fails", () => {
    const s = running();
    s.run.phase = "failed";
    s.run.cause = "cable-snap";
    const out = record(s).printed;
    expect(out).toContain("RUN FAILED");
    expect(out).toContain(FAIL_TEXT["cable-snap"]);
    expect(out).toContain("cable-snap");
  });

  it("offers the abort while a run is in progress and the way back after", () => {
    expect(record(running()).printed).toContain("ESC ABORT");
    const ended = running();
    ended.run.phase = "cleared";
    expect(record(ended).printed).toContain("ESC BACK TO BUILD");
  });
});

describe("the results screen", () => {
  it("shows the clear, the run's figures, and the par beside them", () => {
    let s = setScreen(openSite(titleState(), 0), "results");
    s = setBest(s, 0, { cost: 2400, time: 18 });
    s = setMenuIndex(s, 0);
    const out = record(s).printed;
    expect(out).toContain(CLEARED_TEXT);
    expect(out).toContain("COST");
    expect(out).toContain("PAR 2 400");
    expect(out).toContain("BEST   COST 2 400   TIME 18.00s");
    expect(out).toContain("NEXT SITE");
    expect(out).toContain("SITE SELECT");
  });
});

describe("clipping a line", () => {
  it("leaves a line that fits and cuts one that does not", () => {
    const recorder = new Recorder() as unknown as CanvasRenderingContext2D;
    expect(clip(recorder, "abc", 100)).toBe("abc");
    expect(clip(recorder, "abcdefghij", 21)).toBe("ab…");
  });
});

describe("a real 2D context", () => {
  it("takes every screen at the logical stage size", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    const states: GantryState[] = [
      titleState(),
      setScreen(titleState(), "howto"),
      setScreen(titleState(), "select"),
      yard(),
      setScreen(yard(), "program"),
      setScreen(runnable(), "run"),
      setScreen(titleState(), "results"),
    ];
    for (const state of states) {
      expect(() => drawHud(ctx, state, NO_HINT)).not.toThrow();
    }
    // Something reached the canvas rather than leaving it blank.
    expect(canvas.toBuffer("image/png").length).toBeGreaterThan(1000);
  });
});
