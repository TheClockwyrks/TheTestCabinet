import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEventMap, SurfaceMetrics, Viewport } from "./contract";
import { InputRegistry } from "./input";
import { TOUCH_LAYOUTS, touchLayout } from "./layouts";
import { PointerInput } from "./pointer";
import {
  ACTION_ATTRIBUTE,
  ACTIONS_ATTRIBUTE,
  CONTAINER_ATTRIBUTE,
  DEAD_ZONE,
  TouchControls,
  axisDeflection,
  layoutControls,
  padDirections,
} from "./touch-controls";

/**
 * The controls are driven the way a player and a validator both drive them: by
 * dispatching pointer-shaped events, at the document for the visibility rule and
 * at a control's element for the control itself. The registry behind them is the
 * real one, so what is asserted is what a game would read.
 *
 * jsdom has no `PointerEvent` and no `setPointerCapture`, and it lays nothing
 * out, so the events are plain `Event`s carrying the fields the listeners read
 * (as `pointer.test.ts` dispatches them), the capture is stubbed where a test is
 * about it, and a control's rect is pinned by hand where a test measures a
 * contact against it.
 */

/** A surface whose event target is `target`: the document, or a bare target. */
function surfaceOver(target: EventTarget): SurfaceMetrics {
  return {
    cssWidth: () => 640,
    cssHeight: () => 360,
    dpr: () => 1,
    events: () => target,
  };
}

/** The fields a dispatched pointer event may carry beyond its type. */
interface PointerFields {
  pointerId?: number;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
}

type PointerType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel";

/**
 * A pointer-shaped plain event, bubbling as a browser's would, so one dispatched
 * at a control reaches the document unless the control stops it.
 */
function pointer(
  target: EventTarget,
  type: PointerType,
  fields: PointerFields = {},
): Event {
  const event = Object.assign(
    new Event(type, { bubbles: true, cancelable: true }),
    fields,
  );
  target.dispatchEvent(event);
  return event;
}

/** A touch, which is what shows the controls. */
function touch(target: EventTarget, fields: PointerFields = {}): Event {
  return pointer(target, "pointerdown", { pointerType: "touch", ...fields });
}

/**
 * A contact on a control: a touch unless the fields say otherwise, since a
 * control acts on a touch alone and every other device hides the controls.
 */
function contact(
  target: EventTarget,
  type: PointerType,
  fields: PointerFields = {},
): Event {
  return pointer(target, type, { pointerType: "touch", ...fields });
}

function keyDown(target: EventTarget, code = "KeyA"): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

/** Pins a control's rect, since jsdom lays nothing out. */
function pin(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  element.getBoundingClientRect = (): DOMRect =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }) as DOMRect;
}

/** One emitted event, as the bus would have carried it. */
type Emitted = {
  [K in keyof EngineEventMap]: { event: K; payload: EngineEventMap[K] };
}[keyof EngineEventMap];

/** Everything a test builds around one set of controls. */
interface Rig {
  controls: TouchControls;
  input: InputRegistry;
  emitted: Emitted[];
  container: HTMLElement;
  /** The element carrying `data-action="<action>"`, first in document order. */
  control(action: string): HTMLElement;
  /** The element whose `data-actions` starts with `action`. */
  multi(action: string): HTMLElement;
}

const rigs: Rig[] = [];

/**
 * Controls over the document for `layout`, with every action of its vocabulary
 * registered digital except those named in `analog`, and the rig disposed of by
 * the teardown whatever the test does.
 */
function rig(layout: string, analog: string[] = []): Rig {
  const surface = surfaceOver(document);
  const input = new InputRegistry(surface);
  input.useLayout(layout);
  for (const action of touchLayout(layout).actions) {
    input.register(action, {
      keys: [],
      kind: analog.includes(action) ? "analog" : "digital",
    });
  }
  const emitted: Emitted[] = [];
  const controls = new TouchControls({
    surface,
    actions: input,
    layout: touchLayout(layout),
    emit: (event, payload) => {
      emitted.push({ event, payload } as Emitted);
    },
  });
  const container = document.querySelector<HTMLElement>(
    `[${CONTAINER_ATTRIBUTE}]`,
  );
  if (container === null) throw new Error("no container was drawn");
  const built: Rig = {
    controls,
    input,
    emitted,
    container,
    control: (action) => {
      const found = container.querySelector<HTMLElement>(
        `[${ACTION_ATTRIBUTE}="${action}"]`,
      );
      if (found === null) throw new Error(`no control drives ${action}`);
      return found;
    },
    multi: (action) => {
      const found = container.querySelector<HTMLElement>(
        `[${ACTIONS_ATTRIBUTE}^="${action} "]`,
      );
      if (found === null) throw new Error(`no slider or pad drives ${action}`);
      return found;
    },
  };
  rigs.push(built);
  return built;
}

/** Whether the container is hidden the one way the module hides it. */
function hidden(container: HTMLElement): boolean {
  return container.hidden && container.style.display === "none";
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const built of rigs.splice(0)) {
    built.controls.detach();
    built.input.detach();
  }
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

describe("the overlay", () => {
  it("is drawn in the document's body, marked with the layout, hidden", () => {
    const { container, controls, emitted } = rig("dual-vertical");

    expect(container.parentElement).toBe(document.body);
    expect(container.getAttribute(CONTAINER_ATTRIBUTE)).toBe("dual-vertical");
    expect(hidden(container)).toBe(true);
    expect(controls.state()).toEqual({
      layout: "dual-vertical",
      visible: false,
    });
    expect(emitted).toEqual([]);
  });

  it("injects its stylesheet once, scoped by the container's marker", () => {
    rig("dual-vertical");

    const sheets = document.querySelectorAll("style");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.textContent).toContain(`[${CONTAINER_ATTRIBUTE}]`);
    expect(sheets[0]?.textContent).toContain("safe-area-inset");
  });

  it("hands out a fresh state each read", () => {
    const { controls } = rig("dual-vertical");
    const first = controls.state();
    if (first === null) throw new Error("no state");
    first.visible = true;

    expect(controls.state()?.visible).toBe(false);
  });

  it.each(Object.keys(TOUCH_LAYOUTS))(
    "draws a control for every action %s speaks",
    (name) => {
      const { container } = rig(name);

      for (const action of TOUCH_LAYOUTS[name]?.actions ?? []) {
        const single = container.querySelector(
          `[${ACTION_ATTRIBUTE}="${action}"]`,
        );
        const listed = [
          ...container.querySelectorAll(`[${ACTIONS_ATTRIBUTE}]`),
        ].some((element) =>
          (element.getAttribute(ACTIONS_ATTRIBUTE) ?? "")
            .split(" ")
            .includes(action),
        );
        expect(single !== null || listed, action).toBe(true);
      }
    },
  );

  it("marks a pad with every action it drives, first one named", () => {
    const { multi } = rig("dpad-4-two-buttons");
    const pad = multi("up");

    expect(pad.getAttribute(ACTIONS_ATTRIBUTE)).toBe("up down left right");
    expect(pad.getAttribute(ACTION_ATTRIBUTE)).toBe("up");
  });

  it("marks a slider with its pair, positive direction first", () => {
    const { multi } = rig("dual-vertical");

    expect(multi("p2-up").getAttribute(ACTIONS_ATTRIBUTE)).toBe(
      "p2-up p2-down",
    );
    expect(multi("p2-up").getAttribute(ACTION_ATTRIBUTE)).toBe("p2-up");
  });

  it("leaves the document untouched when the layout has no drawing", () => {
    const surface = surfaceOver(document);
    const input = new InputRegistry(surface);
    const added = vi.spyOn(document, "addEventListener");

    expect(
      () =>
        new TouchControls({
          surface,
          actions: input,
          layout: { name: "not-drawn", actions: [] },
          emit: () => undefined,
        }),
    ).toThrow(/not-drawn/);

    expect(document.querySelector(`[${CONTAINER_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector("style")).toBeNull();
    expect(added).not.toHaveBeenCalled();
    input.detach();
  });

  it("refuses a layout the catalogue holds but the drawings do not, naming it", () => {
    expect(() => layoutControls({ name: "not-drawn", actions: [] })).toThrow(
      /not-drawn/,
    );
  });
});

describe("appearance", () => {
  it("shows on a touch pointerdown at the surface's target, and says so", () => {
    const { container, controls, emitted } = rig("single-vertical");

    touch(document);

    expect(hidden(container)).toBe(false);
    expect(controls.state()).toEqual({
      layout: "single-vertical",
      visible: true,
    });
    expect(emitted).toEqual([
      { event: "touch-controls:shown", payload: { layout: "single-vertical" } },
    ]);
  });

  it("stays hidden on a touch that only moves", () => {
    const { container } = rig("single-vertical");

    pointer(document, "pointermove", { pointerType: "touch" });

    expect(hidden(container)).toBe(true);
  });

  it.each([
    ["a keydown", (): void => keyDown(document), "keyboard"],
    [
      "a mouse pointerdown",
      (): void => {
        pointer(document, "pointerdown", { pointerType: "mouse" });
      },
      "mouse",
    ],
    [
      "a mouse pointermove",
      (): void => {
        pointer(document, "pointermove", { pointerType: "mouse" });
      },
      "mouse",
    ],
    [
      "a pen pointerdown",
      (): void => {
        pointer(document, "pointerdown", { pointerType: "pen" });
      },
      "pen",
    ],
  ])("hides on %s, naming the reason", (_, act, reason) => {
    const { container, controls, emitted } = rig("single-vertical");
    touch(document);
    emitted.length = 0;

    act();

    expect(hidden(container)).toBe(true);
    expect(controls.state()?.visible).toBe(false);
    expect(emitted).toEqual([
      {
        event: "touch-controls:hidden",
        payload: { layout: "single-vertical", reason },
      },
    ]);
  });

  it("comes back on the next touch", () => {
    const { container, emitted } = rig("single-vertical");
    touch(document);
    keyDown(document);
    emitted.length = 0;

    touch(document);

    expect(hidden(container)).toBe(false);
    expect(emitted.map((entry) => entry.event)).toEqual([
      "touch-controls:shown",
    ]);
  });

  it("reports each transition once, however many inputs repeat it", () => {
    const { emitted } = rig("single-vertical");

    keyDown(document);
    touch(document);
    touch(document);
    pointer(document, "pointermove", { pointerType: "mouse" });
    pointer(document, "pointermove", { pointerType: "mouse" });
    keyDown(document);

    expect(emitted.map((entry) => entry.event)).toEqual([
      "touch-controls:shown",
      "touch-controls:hidden",
    ]);
  });

  it("reads a pointer event carrying no pointerType as a mouse, as the pointer does", () => {
    const { container } = rig("single-vertical");
    touch(document);

    pointer(document, "pointerdown");

    expect(hidden(container)).toBe(true);
  });

  it.each([
    ["a mouse pointerdown", "pointerdown", "mouse"],
    ["a mouse pointermove", "pointermove", "mouse"],
    ["a pen pointerdown", "pointerdown", "pen"],
  ] as const)(
    "hides on %s at a control, which drives nothing",
    (_, type, device) => {
      const { control, container, input, emitted } = rig("single-vertical");
      touch(document);
      emitted.length = 0;

      pointer(control("confirm"), type, { pointerType: device });

      expect(hidden(container)).toBe(true);
      expect(input.value("confirm")).toBe(0);
      expect(emitted).toEqual([
        {
          event: "touch-controls:hidden",
          payload: { layout: "single-vertical", reason: device },
        },
      ]);
    },
  );

  it("leaves the touch that reveals it to reach the game's pointer", () => {
    const { container } = rig("single-vertical");
    const viewport: Viewport = {
      width: 640,
      height: 360,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    };
    const game = new PointerInput(surfaceOver(document), () => viewport);

    touch(document, { pointerId: 7, clientX: 10, clientY: 10 });

    expect(hidden(container)).toBe(false);
    expect(game.contacts()).toHaveLength(1);
    game.detach();
  });
});

describe("a button", () => {
  it("drives its action to 1 on pointerdown, arming the edge once", () => {
    const { control, input } = rig("single-vertical");
    touch(document);

    contact(control("confirm"), "pointerdown");

    expect(input.value("confirm")).toBe(1);
    expect(input.pressed("confirm")).toBe(true);
    expect(input.pressed("confirm")).toBe(false);
  });

  it("drives its action back to 0 on pointerup", () => {
    const { control, input } = rig("single-vertical");
    touch(document);
    contact(control("confirm"), "pointerdown");

    contact(control("confirm"), "pointerup");

    expect(input.value("confirm")).toBe(0);
  });

  it("drives its action back to 0 on pointercancel", () => {
    const { control, input } = rig("single-vertical");
    touch(document);
    contact(control("confirm"), "pointerdown");

    contact(control("confirm"), "pointercancel");

    expect(input.value("confirm")).toBe(0);
  });

  it("arms the edge again on the next press, as a key would", () => {
    const { control, input } = rig("single-vertical");
    touch(document);
    contact(control("confirm"), "pointerdown");
    contact(control("confirm"), "pointerup");
    input.endFrame();

    contact(control("confirm"), "pointerdown");

    expect(input.pressed("confirm")).toBe(true);
  });

  it("is held by the first pointer alone; a second finger changes nothing", () => {
    const { control, input } = rig("single-vertical");
    touch(document);
    contact(control("confirm"), "pointerdown", { pointerId: 1 });
    contact(control("confirm"), "pointerdown", { pointerId: 2 });

    contact(control("confirm"), "pointerup", { pointerId: 2 });
    expect(input.value("confirm")).toBe(1);

    contact(control("confirm"), "pointerup", { pointerId: 1 });
    expect(input.value("confirm")).toBe(0);
  });

  it("keeps an action held while another control still holds it", () => {
    // `dpad-4` draws confirm twice: the large thumb button and the menu's.
    const { container, input } = rig("dpad-4");
    touch(document);
    const [large, menu] = container.querySelectorAll<HTMLElement>(
      `[${ACTION_ATTRIBUTE}="confirm"]`,
    );
    if (large === undefined || menu === undefined) {
      throw new Error("dpad-4 draws confirm twice");
    }

    contact(large, "pointerdown", { pointerId: 1 });
    contact(menu, "pointerdown", { pointerId: 2 });
    contact(large, "pointerup", { pointerId: 1 });
    expect(input.value("confirm")).toBe(1);

    contact(menu, "pointerup", { pointerId: 2 });
    expect(input.value("confirm")).toBe(0);
  });
});

describe("a slider", () => {
  const rect = { left: 0, top: 100, width: 64, height: 200 };
  /** Where `deflection` puts a contact, inverting the rescale past the dead zone. */
  const at = (deflection: number): number => {
    const raw =
      Math.sign(deflection) *
      (Math.abs(deflection) * (1 - DEAD_ZONE) + DEAD_ZONE);
    return rect.top + rect.height / 2 - raw * (rect.height / 2);
  };

  it("drives a value the registry was moved away from in between", () => {
    const { multi, input } = rig("single-vertical", ["up", "down"]);
    touch(document);
    const slider = multi("up");
    pin(slider, rect);
    contact(slider, "pointerdown", { clientX: 32, clientY: at(0.5) });
    expect(input.value("up")).toBeCloseTo(0.5);
    // A caller moves the action under the held thumb, as a key would.
    input.setAction("up", 0);
    expect(input.value("up")).toBe(0);

    contact(slider, "pointermove", { clientX: 32, clientY: at(0.5) });

    expect(input.value("up")).toBeCloseTo(0.5);
  });

  it("hands an analog action the fraction the thumb pushed it to", () => {
    const { multi, input } = rig("single-vertical", ["up", "down"]);
    touch(document);
    const slider = multi("up");
    pin(slider, rect);

    contact(slider, "pointerdown", { clientX: 32, clientY: at(0.5) });

    expect(input.value("up")).toBeCloseTo(0.5);
    expect(input.value("down")).toBe(0);
  });

  it("follows the thumb across the middle, and quantizes a digital action", () => {
    const { multi, input } = rig("single-vertical", ["up"]);
    touch(document);
    const slider = multi("up");
    pin(slider, rect);

    contact(slider, "pointerdown", { clientX: 32, clientY: at(0.5) });
    contact(slider, "pointermove", { clientX: 32, clientY: at(-0.5) });

    expect(input.value("up")).toBe(0);
    // `down` is digital: half a deflection reads as held.
    expect(input.value("down")).toBe(1);
  });

  it("reads the dead zone about its middle as rest", () => {
    const { multi, input } = rig("single-vertical", ["up", "down"]);
    touch(document);
    const slider = multi("up");
    pin(slider, rect);

    contact(slider, "pointerdown", {
      clientX: 32,
      clientY: rect.top + rect.height / 2 - 5,
    });

    expect(input.value("up")).toBe(0);
    expect(input.value("down")).toBe(0);
  });

  it("clamps a thumb that slid past its end at full deflection", () => {
    const { multi, input } = rig("single-vertical", ["up", "down"]);
    touch(document);
    const slider = multi("up");
    pin(slider, rect);

    contact(slider, "pointerdown", { clientX: 32, clientY: at(0.5) });
    contact(slider, "pointermove", { clientX: 32, clientY: rect.top - 500 });

    expect(input.value("up")).toBe(1);
  });

  it("returns both actions to rest when the thumb lifts", () => {
    const { multi, input } = rig("single-vertical", ["up", "down"]);
    touch(document);
    const slider = multi("up");
    pin(slider, rect);
    contact(slider, "pointerdown", { clientX: 32, clientY: at(0.8) });

    contact(slider, "pointerup", { clientX: 32, clientY: at(0.8) });

    expect(input.value("up")).toBe(0);
    expect(input.value("down")).toBe(0);
  });

  it("drives each side's own pair on dual-vertical", () => {
    const { multi, input } = rig("dual-vertical", ["p1-up", "p2-down"]);
    touch(document);
    const left = multi("p1-up");
    const right = multi("p2-up");
    pin(left, rect);
    pin(right, { ...rect, left: 576 });

    contact(left, "pointerdown", { pointerId: 1, clientX: 32, clientY: at(1) });
    contact(right, "pointerdown", {
      pointerId: 2,
      clientX: 600,
      clientY: at(-0.25),
    });

    expect(input.value("p1-up")).toBeCloseTo(1);
    expect(input.value("p1-down")).toBe(0);
    expect(input.value("p2-up")).toBe(0);
    expect(input.value("p2-down")).toBeCloseTo(0.25);
  });
});

describe("a pad", () => {
  const rect = { left: 0, top: 0, width: 200, height: 200 };

  it.each([
    ["up", 100, 20, ["up"]],
    ["down", 100, 180, ["down"]],
    ["left", 20, 100, ["left"]],
    ["right", 180, 100, ["right"]],
    ["up-right", 170, 30, ["up", "right"]],
    ["up-left", 30, 30, ["up", "left"]],
    ["down-left", 30, 170, ["down", "left"]],
    ["down-right", 170, 170, ["down", "right"]],
  ])("resolves %s", (_, x, y, engaged) => {
    const { multi, input } = rig("dpad-4");
    touch(document);
    const pad = multi("up");
    pin(pad, rect);

    contact(pad, "pointerdown", { clientX: x, clientY: y });

    for (const action of ["up", "down", "left", "right"]) {
      expect(input.value(action), action).toBe(
        engaged.includes(action) ? 1 : 0,
      );
    }
  });

  it("reads its centre as rest and releases every direction on lift", () => {
    const { multi, input } = rig("dpad-4");
    touch(document);
    const pad = multi("up");
    pin(pad, rect);

    contact(pad, "pointerdown", { clientX: 170, clientY: 30 });
    contact(pad, "pointermove", { clientX: 100, clientY: 100 });
    expect(input.value("up")).toBe(0);
    expect(input.value("right")).toBe(0);

    contact(pad, "pointermove", { clientX: 100, clientY: 20 });
    expect(input.value("up")).toBe(1);

    contact(pad, "pointerup", { clientX: 100, clientY: 20 });
    expect(input.value("up")).toBe(0);
  });

  it("hands an analog direction its axis magnitude", () => {
    const { multi, input } = rig("dpad-4", ["up", "right"]);
    touch(document);
    const pad = multi("up");
    pin(pad, rect);

    // Straight up, 60 of the 100 half-height above centre: raw 0.6.
    contact(pad, "pointerdown", { clientX: 100, clientY: 40 });

    expect(input.value("up")).toBeCloseTo((0.6 - DEAD_ZONE) / (1 - DEAD_ZONE));
    expect(input.value("right")).toBe(0);
  });
});

describe("isolation from the game's pointer", () => {
  const viewport: Viewport = {
    width: 640,
    height: 360,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };

  it("keeps a contact on a control out of the pointer's contacts and samples", () => {
    const { control } = rig("single-vertical");
    const game = new PointerInput(surfaceOver(document), () => viewport);
    touch(document, { pointerId: 1, clientX: 5, clientY: 5 });
    pointer(document, "pointerup", { pointerId: 1, clientX: 5, clientY: 5 });
    game.endFrame();

    contact(control("confirm"), "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 300,
      clientY: 20,
    });
    contact(control("confirm"), "pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 305,
      clientY: 22,
    });
    contact(control("confirm"), "pointerup", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 305,
      clientY: 22,
    });

    expect(game.contacts()).toEqual([]);
    expect(game.samples()).toEqual([]);
    expect(game.snapshot()).toMatchObject({ x: 5, y: 5, down: false });
    game.detach();
  });

  it("stops every one of the four pointer events at the control", () => {
    const { control } = rig("single-vertical");
    touch(document);
    const reached: string[] = [];
    const listener = (event: Event): void => {
      reached.push(event.type);
    };
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ]) {
      document.addEventListener(type, listener);
    }

    contact(control("confirm"), "pointerdown", { pointerId: 1 });
    contact(control("confirm"), "pointermove", { pointerId: 1 });
    contact(control("confirm"), "pointercancel", { pointerId: 1 });
    contact(control("confirm"), "pointerup", { pointerId: 9 });

    expect(reached).toEqual([]);
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ]) {
      document.removeEventListener(type, listener);
    }
  });

  it("ignores a contact while hidden, which reaches the target as a touch on the game", () => {
    const { control, container, input, emitted } = rig("single-vertical");
    const reached: string[] = [];
    const listener = (event: Event): void => {
      reached.push(event.type);
    };
    document.addEventListener("pointerdown", listener);

    contact(control("confirm"), "pointerdown");

    expect(input.value("confirm")).toBe(0);
    expect(reached).toEqual(["pointerdown"]);
    // The touch went on to the target, which is exactly what shows the controls.
    expect(hidden(container)).toBe(false);
    expect(emitted.map((entry) => entry.event)).toEqual([
      "touch-controls:shown",
    ]);
    document.removeEventListener("pointerdown", listener);
  });

  it("captures the pointer on the control and releases it on lift", () => {
    const { control } = rig("single-vertical");
    touch(document);
    const button = control("confirm");
    const capture = vi.fn();
    const release = vi.fn();
    button.setPointerCapture = capture;
    button.releasePointerCapture = release;

    contact(button, "pointerdown", { pointerId: 4 });
    expect(capture).toHaveBeenCalledWith(4);

    contact(button, "pointerup", { pointerId: 4 });
    expect(release).toHaveBeenCalledWith(4);
  });

  it("survives a capture the host refuses", () => {
    const { control, input } = rig("single-vertical");
    touch(document);
    const button = control("confirm");
    button.setPointerCapture = (): void => {
      throw new Error("InvalidStateError");
    };

    expect(() =>
      contact(button, "pointerdown", { pointerId: 4 }),
    ).not.toThrow();
    expect(input.value("confirm")).toBe(1);
  });

  it("takes the default action of a pointerdown, so no compatibility mouse event follows", () => {
    const { control } = rig("single-vertical");
    touch(document);

    const event = contact(control("confirm"), "pointerdown");

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("hiding while held", () => {
  it("returns a held action to rest when a keyboard hides the controls", () => {
    const { control, input } = rig("single-vertical");
    touch(document);
    contact(control("confirm"), "pointerdown", { pointerId: 1 });
    expect(input.value("confirm")).toBe(1);

    keyDown(document);

    expect(input.value("confirm")).toBe(0);
  });

  it("drives the control again once the next touch shows it", () => {
    const { control, input } = rig("single-vertical");
    touch(document);
    contact(control("confirm"), "pointerdown", { pointerId: 1 });
    keyDown(document);
    expect(input.value("confirm")).toBe(0);
    touch(document);

    contact(control("confirm"), "pointerdown", { pointerId: 1 });

    expect(input.value("confirm")).toBe(1);
  });
});

describe("without a document", () => {
  it("is inert over a bare event target: nothing drawn, nothing listened to, null", () => {
    const target = new EventTarget();
    const added = vi.spyOn(target, "addEventListener");
    const surface = surfaceOver(target);
    const input = new InputRegistry(surface);
    input.useLayout("dpad-4");
    const emitted: Emitted[] = [];
    const controls = new TouchControls({
      surface,
      actions: input,
      layout: touchLayout("dpad-4"),
      emit: (event, payload) => {
        emitted.push({ event, payload } as Emitted);
      },
    });

    expect(controls.state()).toBeNull();
    expect(document.querySelector(`[${CONTAINER_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector("style")).toBeNull();
    // Only the registry's own pair went on.
    expect(added.mock.calls.map((call) => call[0]).sort()).toEqual([
      "keydown",
      "keyup",
    ]);

    touch(target);
    expect(controls.state()).toBeNull();
    expect(emitted).toEqual([]);
    expect(() => controls.detach()).not.toThrow();
    input.detach();
  });

  it("finds the document through a node other than the document itself", () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const surface = surfaceOver(canvas);
    const input = new InputRegistry(surface);
    const controls = new TouchControls({
      surface,
      actions: input,
      layout: touchLayout("dpad-4"),
      emit: () => undefined,
    });

    expect(controls.state()).toEqual({ layout: "dpad-4", visible: false });
    expect(document.querySelector(`[${CONTAINER_ATTRIBUTE}]`)).not.toBeNull();
    controls.detach();
    input.detach();
  });
});

describe("detach", () => {
  it("removes the overlay and its stylesheet", () => {
    const { controls } = rig("dpad-4-two-buttons");

    controls.detach();

    expect(document.querySelector(`[${CONTAINER_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector("style")).toBeNull();
  });

  it("stops listening, so a later touch shows nothing and says nothing", () => {
    const { controls, emitted } = rig("dpad-4-two-buttons");
    const removed = vi.spyOn(document, "removeEventListener");

    controls.detach();
    touch(document);
    keyDown(document);

    expect(emitted).toEqual([]);
    expect(controls.state()).toBeNull();
    expect(removed.mock.calls.map((call) => call[0]).sort()).toEqual([
      "keydown",
      "pointerdown",
      "pointermove",
    ]);
  });

  it("returns a held action to rest on the way out", () => {
    const { controls, control, input } = rig("dpad-4-two-buttons");
    touch(document);
    contact(control("a"), "pointerdown", { pointerId: 1 });
    expect(input.value("a")).toBe(1);

    controls.detach();

    expect(input.value("a")).toBe(0);
  });

  it("reports null once detached, the overlay being gone", () => {
    const { controls } = rig("dpad-4");

    controls.detach();

    expect(controls.state()).toBeNull();
  });

  it("is idempotent, because teardown races", () => {
    const { controls } = rig("dpad-4");

    controls.detach();

    expect(() => controls.detach()).not.toThrow();
  });
});

describe("the geometry", () => {
  it("deflects toward the start of the axis, clamped, past a dead zone", () => {
    expect(axisDeflection(50, 0, 100)).toBe(0);
    expect(axisDeflection(0, 0, 100)).toBe(1);
    expect(axisDeflection(100, 0, 100)).toBe(-1);
    expect(axisDeflection(-40, 0, 100)).toBe(1);
    expect(axisDeflection(50 - 50 * DEAD_ZONE + 1, 0, 100)).toBe(0);
    expect(axisDeflection(25, 0, 100)).toBeCloseTo(
      (0.5 - DEAD_ZONE) / (1 - DEAD_ZONE),
    );
  });

  it("reads a rect with no extent, or a contact with no position, as rest", () => {
    expect(axisDeflection(10, 0, 0)).toBe(0);
    expect(axisDeflection(Number.NaN, 0, 100)).toBe(0);
  });

  it("resolves a pad's eight ways from its two axes", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(padDirections(rect, { x: 50, y: 50 })).toEqual({
      up: 0,
      down: 0,
      left: 0,
      right: 0,
    });
    expect(padDirections(rect, { x: 50, y: 0 })).toMatchObject({
      up: 1,
      down: 0,
      left: 0,
      right: 0,
    });
    expect(padDirections(rect, { x: 100, y: 0 })).toMatchObject({
      up: 1,
      right: 1,
      down: 0,
      left: 0,
    });
    expect(padDirections(rect, { x: 0, y: 100 })).toMatchObject({
      down: 1,
      left: 1,
      up: 0,
      right: 0,
    });
  });
});
