// The browser half of the runtime layer: the listeners it binds and what they
// feed the core. The DOM here is stood in for by real `EventTarget`s and plain
// objects, so these run in Node with the rest.

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import {
  bindKeyboard,
  bindPointer,
  bindStageFit,
  createRuntime,
  RuntimeCore,
  type Runtime,
} from "./runtime";

function core(): RuntimeCore {
  return new RuntimeCore({
    openAudio: () => null,
    overlay: { setVisible: () => {}, setLines: () => {} },
  });
}

/** A canvas that listens and measures, and nothing else. */
class FakeCanvas extends EventTarget {
  width = 300;
  height = 150;
  clientWidth = 1600;
  clientHeight = 720;
  rect = { left: 0, top: 0, width: 1600, height: 720 };
  captured: number[] = [];
  readonly parentElement = null;

  getBoundingClientRect(): DOMRect {
    return this.rect as DOMRect;
  }

  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
}

const asCanvas = (canvas: FakeCanvas): HTMLCanvasElement =>
  canvas as unknown as HTMLCanvasElement;

/** Dispatch one event carrying the fields the listener reads. */
function fire(
  target: EventTarget,
  type: string,
  props: Record<string, unknown> = {},
): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, props);
  target.dispatchEvent(event);
  return event;
}

describe("bindKeyboard", () => {
  it("feeds a press and a release to the core", () => {
    const target = new EventTarget();
    const rt = core();
    bindKeyboard(target, rt);
    fire(target, "keydown", { code: "KeyG" });
    expect(rt.takeInput().actions).toEqual(["run"]);
    expect(rt.held("run")).toBe(true);
    fire(target, "keyup", { code: "KeyG" });
    expect(rt.held("run")).toBe(false);
  });

  it("drops the browser's auto-repeat, so a held key is one press", () => {
    const target = new EventTarget();
    const rt = core();
    bindKeyboard(target, rt);
    fire(target, "keydown", { code: "ArrowDown" });
    fire(target, "keydown", { code: "ArrowDown", repeat: true });
    fire(target, "keydown", { code: "ArrowDown", repeat: true });
    expect(rt.takeInput().actions).toEqual(["down"]);
    expect(rt.held("down")).toBe(true);
  });

  it("leaves a modified key to the browser", () => {
    const target = new EventTarget();
    const rt = core();
    bindKeyboard(target, rt);
    fire(target, "keydown", { code: "KeyS", ctrlKey: true });
    fire(target, "keydown", { code: "KeyS", metaKey: true });
    fire(target, "keydown", { code: "KeyS", altKey: true });
    expect(rt.takeInput().actions).toEqual([]);
  });

  it("stops the page acting on a key the game uses", () => {
    const target = new EventTarget();
    bindKeyboard(target, core());
    expect(fire(target, "keydown", { code: "ArrowUp" }).defaultPrevented).toBe(
      true,
    );
    expect(
      fire(target, "keydown", { code: "Backquote" }).defaultPrevented,
    ).toBe(true);
    expect(fire(target, "keydown", { code: "KeyQ" }).defaultPrevented).toBe(
      false,
    );
  });

  it("sends the backtick key on, where it toggles the overlay", () => {
    const target = new EventTarget();
    const rt = core();
    bindKeyboard(target, rt);
    fire(target, "keydown", { code: "Backquote" });
    expect(rt.overlayVisible).toBe(true);
  });
});

describe("bindPointer", () => {
  it("delivers a press on the canvas in logical stage units", () => {
    const canvas = new FakeCanvas();
    const target = new EventTarget();
    const rt = core();
    bindPointer(asCanvas(canvas), target, rt);
    // The canvas is 1600x720 CSS, so the stage is scaled 1 and centred with
    // 160px bars: its centre is at client (800, 360).
    fire(canvas, "pointerdown", {
      button: 0,
      pointerId: 7,
      clientX: 800,
      clientY: 360,
    });
    expect(rt.pointerX()).toBeCloseTo(STAGE_W / 2, 9);
    expect(rt.pointerY()).toBeCloseTo(STAGE_H / 2, 9);
    expect(canvas.captured).toEqual([7]);
  });

  it("takes the canvas's position on the page off the point", () => {
    const canvas = new FakeCanvas();
    canvas.rect = { left: 30, top: 20, width: 1280, height: 720 };
    const rt = core();
    bindPointer(asCanvas(canvas), new EventTarget(), rt);
    fire(canvas, "pointerdown", {
      button: 0,
      clientX: 30 + 12,
      clientY: 20 + 8,
    });
    expect(rt.pointerX()).toBeCloseTo(12, 9);
    expect(rt.pointerY()).toBeCloseTo(8, 9);
  });

  it("ignores a press of anything but the primary button", () => {
    const canvas = new FakeCanvas();
    const rt = core();
    bindPointer(asCanvas(canvas), new EventTarget(), rt);
    fire(canvas, "pointerdown", { button: 2, clientX: 800, clientY: 360 });
    expect(rt.takeInput().pointer).toEqual([]);
  });

  it("follows the moves and the release from the window, off the canvas", () => {
    const canvas = new FakeCanvas();
    const target = new EventTarget();
    const rt = core();
    bindPointer(asCanvas(canvas), target, rt);
    fire(canvas, "pointerdown", { button: 0, clientX: 800, clientY: 360 });
    fire(target, "pointermove", { clientX: 900, clientY: 360 });
    fire(target, "pointerup", {});
    const acts = rt.takeInput().pointer;
    expect(acts.map((act) => act.kind)).toEqual(["down", "move", "up"]);
    expect(acts[1]?.x).toBeCloseTo(STAGE_W / 2 + 100, 9);
  });

  it("ends a press that is cancelled as it ends one that is released", () => {
    const canvas = new FakeCanvas();
    const target = new EventTarget();
    const rt = core();
    bindPointer(asCanvas(canvas), target, rt);
    fire(canvas, "pointerdown", { button: 0, clientX: 800, clientY: 360 });
    fire(target, "pointercancel", {});
    expect(rt.pointerPressed()).toBe(false);
    expect(rt.takeInput().pointer.map((act) => act.kind)).toEqual([
      "down",
      "up",
    ]);
  });

  it("ignores a release with no press behind it", () => {
    const canvas = new FakeCanvas();
    const target = new EventTarget();
    const rt = core();
    bindPointer(asCanvas(canvas), target, rt);
    fire(target, "pointerup", {});
    expect(rt.takeInput().pointer).toEqual([]);
  });

  it("reports a hovering pointer, with no press live", () => {
    const canvas = new FakeCanvas();
    const target = new EventTarget();
    const rt = core();
    bindPointer(asCanvas(canvas), target, rt);
    fire(target, "pointermove", { clientX: 800, clientY: 360 });
    expect(rt.pointerX()).toBeCloseTo(STAGE_W / 2, 9);
    expect(rt.pointerPressed()).toBe(false);
  });
});

describe("bindStageFit", () => {
  it("fits the canvas on load and again on every resize", () => {
    const canvas = new FakeCanvas();
    const target = new EventTarget();
    bindStageFit(asCanvas(canvas), target);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(720);

    canvas.clientWidth = 900;
    canvas.clientHeight = 1600;
    fire(target, "resize");
    expect(canvas.width).toBe(900);
    expect(canvas.height).toBe(1600);
  });

  it("answers the refit, so a caller can ask for one", () => {
    const canvas = new FakeCanvas();
    const refit = bindStageFit(asCanvas(canvas), new EventTarget());
    canvas.clientWidth = 640;
    canvas.clientHeight = 360;
    refit();
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
  });
});

describe("the contract", () => {
  it("is what the game's `Runtime` asks for", () => {
    const rt: Runtime = core();
    expect(typeof rt.takeInput).toBe("function");
    expect(typeof rt.held).toBe("function");
    expect(typeof rt.playCue).toBe("function");
    expect(typeof rt.setMotor).toBe("function");
    expect(typeof rt.installAudio).toBe("function");
    expect(typeof rt.setDiagnostics).toBe("function");
  });
});

// ---- Standing the whole layer up ------------------------------------------

interface FakePanel {
  hidden: boolean;
  textContent: string | null;
  attributes: string[];
}

/** Just enough page for `createRuntime` to bind itself to. */
function installPage() {
  const panels: FakePanel[] = [];
  const frames: (() => void)[] = [];
  let armed = 0;
  const body = {
    ownerDocument: {
      createElement: () => {
        const panel: FakePanel = {
          hidden: false,
          textContent: null,
          attributes: [],
        };
        panels.push(panel);
        return {
          get hidden() {
            return panel.hidden;
          },
          set hidden(value: boolean) {
            panel.hidden = value;
          },
          get textContent() {
            return panel.textContent;
          },
          set textContent(value: string | null) {
            panel.textContent = value;
          },
          setAttribute: (_name: string, value: string) => {
            panel.attributes.push(value);
          },
        };
      },
    },
    appendChild: () => {},
  };
  const win = new EventTarget() as EventTarget & { devicePixelRatio: number };
  win.devicePixelRatio = 2;
  Object.assign(globalThis, {
    window: win,
    document: { body },
    matchMedia: () => ({
      addEventListener: () => {
        armed += 1;
      },
    }),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  });
  return {
    win,
    panels,
    frames,
    armed: () => armed,
    restore: () => {
      for (const name of [
        "window",
        "document",
        "matchMedia",
        "requestAnimationFrame",
      ]) {
        Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

describe("createRuntime", () => {
  it("stands the layer up over the page's canvas", () => {
    const page = installPage();
    try {
      const canvas = new FakeCanvas();
      const rt = createRuntime(asCanvas(canvas));

      // The canvas is fitted at once, at the page's pixel ratio.
      expect(canvas.width).toBe(3200);
      expect(canvas.height).toBe(1440);

      // A resize refits it, and the pixel-ratio watch is armed.
      canvas.clientWidth = 800;
      canvas.clientHeight = 600;
      fire(page.win, "resize");
      expect(canvas.width).toBe(1600);
      expect(page.armed()).toBe(1);

      // The keyboard is bound to the window.
      fire(page.win, "keydown", { code: "KeyB" });
      expect(rt.takeInput().actions).toEqual(["build"]);

      // The pointer is bound to the canvas and the window.
      canvas.rect = { left: 0, top: 0, width: 1280, height: 720 };
      fire(canvas, "pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 640,
        clientY: 360,
      });
      fire(page.win, "pointerup", {});
      expect(rt.pointerX()).toBeCloseTo(STAGE_W / 2, 9);
      expect(rt.takeInput().pointer.map((act) => act.kind)).toEqual([
        "down",
        "up",
      ]);

      // The overlay panel is on the page, hidden, until the backtick key.
      expect(page.panels).toHaveLength(1);
      expect(page.panels[0]?.hidden).toBe(true);
      rt.setDiagnostics(() => ["screen title"]);
      fire(page.win, "keydown", { code: "Backquote" });
      expect(page.panels[0]?.hidden).toBe(false);
      expect(page.panels[0]?.textContent).toBe("screen title");

      // The overlay redraws on its own frame, which re-arms itself.
      const first = page.frames.length;
      page.frames[0]?.();
      expect(page.frames.length).toBe(first + 1);
    } finally {
      page.restore();
    }
  });

  it("leaves no window behind it", () => {
    expect(typeof window).toBe("undefined");
  });
});
