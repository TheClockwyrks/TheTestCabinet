// The debug overlay: off until toggled, drawn from the registered source, and
// a pure read (`specs/instrumentation.md`).

import { describe, expect, it } from "vitest";
import {
  DiagnosticsOverlay,
  OVERLAY_TOGGLE_CODE,
  type OverlayView,
} from "./runtime-overlay";

interface Recording extends OverlayView {
  visible: boolean;
  lines: readonly string[];
  writes: number;
}

function recordingView(): Recording {
  const view: Recording = {
    visible: true,
    lines: [],
    writes: 0,
    setVisible(visible) {
      view.visible = visible;
    },
    setLines(lines) {
      view.lines = lines;
      view.writes += 1;
    },
  };
  return view;
}

describe("the overlay", () => {
  it("is toggled by the backtick key", () => {
    expect(OVERLAY_TOGGLE_CODE).toBe("Backquote");
  });

  it("is off until toggled", () => {
    const view = recordingView();
    const overlay = new DiagnosticsOverlay(view);
    expect(overlay.visible).toBe(false);
    expect(view.visible).toBe(false);
    overlay.setSource(() => ["screen title"]);
    overlay.refresh();
    expect(view.writes).toBe(0);
  });

  it("shows and hides on each toggle", () => {
    const overlay = new DiagnosticsOverlay(recordingView());
    overlay.toggle();
    expect(overlay.visible).toBe(true);
    overlay.toggle();
    expect(overlay.visible).toBe(false);
    overlay.toggle();
    expect(overlay.visible).toBe(true);
  });

  it("draws the registered source's lines once shown", () => {
    const view = recordingView();
    const overlay = new DiagnosticsOverlay(view);
    overlay.setSource(() => ["screen build", "members 4"]);
    overlay.toggle();
    expect(view.visible).toBe(true);
    expect(view.lines).toEqual(["screen build", "members 4"]);
  });

  it("reads the source only while it is shown", () => {
    let reads = 0;
    const overlay = new DiagnosticsOverlay(recordingView());
    overlay.setSource(() => {
      reads += 1;
      return ["one"];
    });
    overlay.refresh();
    overlay.refresh();
    expect(reads).toBe(0);
    overlay.toggle();
    expect(reads).toBe(1);
    overlay.refresh();
    expect(reads).toBe(2);
    overlay.toggle();
    overlay.refresh();
    expect(reads).toBe(2);
  });

  it("follows the source as the game changes", () => {
    const view = recordingView();
    const overlay = new DiagnosticsOverlay(view);
    let tick = 0;
    overlay.setSource(() => [`tick ${tick}`]);
    overlay.toggle();
    expect(view.lines).toEqual(["tick 0"]);
    tick = 7;
    overlay.refresh();
    expect(view.lines).toEqual(["tick 7"]);
  });

  it("writes nothing when the reading has not changed", () => {
    const view = recordingView();
    const overlay = new DiagnosticsOverlay(view);
    overlay.setSource(() => ["steady"]);
    overlay.toggle();
    const writes = view.writes;
    overlay.refresh();
    overlay.refresh();
    expect(view.writes).toBe(writes);
  });

  it("redraws from scratch when it comes back", () => {
    const view = recordingView();
    const overlay = new DiagnosticsOverlay(view);
    overlay.setSource(() => ["steady"]);
    overlay.toggle();
    overlay.toggle();
    const writes = view.writes;
    overlay.toggle();
    expect(view.writes).toBe(writes + 1);
  });

  it("takes a later source in place of the one before", () => {
    const view = recordingView();
    const overlay = new DiagnosticsOverlay(view);
    overlay.setSource(() => ["first"]);
    overlay.toggle();
    overlay.setSource(() => ["second"]);
    expect(view.lines).toEqual(["second"]);
  });

  it("draws nothing at all before a source is registered", () => {
    const view = recordingView();
    const overlay = new DiagnosticsOverlay(view);
    overlay.toggle();
    expect(view.lines).toEqual([]);
  });
});
