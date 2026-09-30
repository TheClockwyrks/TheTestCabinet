/**
 * The on-screen touch controls: what a touchscreen player is given for the
 * selected layout, and the engine's one place that draws chrome for input.
 *
 * A layout names a control scheme and the actions it drives, and a build on a
 * phone is playable only if something on the screen drives those actions. This
 * module draws that something. It is a DOM overlay rather than part of the
 * canvas, for three reasons that each rule the canvas out on their own:
 *
 * - The canvas is the game's own picture. The recorder and a captured frame
 *   hold what the pipeline drew, and a set of buttons baked into it would
 *   misreport that.
 * - A contact on a control has to be told apart from a contact on the game, and
 *   the element that received the event is what tells them apart. On a canvas
 *   every contact is a contact on the game, and the engine would be hit-testing
 *   its own chrome against the input system's every event.
 * - The browser's own gesture handling is per element. A control declines the
 *   browser's touch gestures and text selection with two properties; a region of
 *   a canvas cannot.
 *
 * The controls drive the actions through the same seam a key does —
 * {@link ActionDriver.drive}, which is `InputSystem.drive` — so the game reads
 * one number whichever source moved it: an analog action receives the partial
 * magnitude a stick gives, a digital one quantizes it, and each crossing from
 * rest arms the edge `pressed` reports exactly as a keypress would.
 *
 * **Appearance.** The controls are hidden at construction and shown by the first
 * `pointerdown` whose `pointerType` is `"touch"`. A `keydown`, or a `pointerdown`
 * or `pointermove` from a mouse or a pen, hides them again, and the next touch
 * shows them, so a device carrying both a touchscreen and a keyboard shows them
 * exactly while the screen is in use. Those listeners go on the same target the
 * key and pointer listeners use ({@link SurfaceMetrics.events}), so a caller that
 * dispatches events into a target of its own reaches them by the path a player
 * does. Only pointer and key events are read, never `mousedown` or `touchstart`:
 * a browser does not synthesize a `pointerdown` with `pointerType: "mouse"` from
 * a touch, so the compatibility mouse events cannot hide the controls by mistake.
 *
 * **Isolation.** A contact on a control belongs to the control. Its `pointerdown`,
 * `pointermove`, `pointerup`, and `pointercancel` stop propagating at the control,
 * so they never reach the input system listening on the document, and the
 * control captures the pointer so a thumb that slides off keeps driving until it
 * lifts. The touch that first reveals the controls lands on the game, not on a
 * control, and reaches the pointer as any other.
 *
 * **No document, no controls.** An engine built over a surface whose event target
 * has no document behind it — the headless case — has nowhere to put an overlay.
 * The class is then inert: it draws nothing, listens to nothing, and reports
 * `null`, and the engine keeps working exactly as it did.
 *
 * **The third dimension.** Where a 2D layout draws a slider, this catalogue draws
 * a stick: one control that reports a point in the unit disc, whose horizontal
 * component drives the stick's left and right actions and whose vertical
 * component drives its up and down actions, each by the magnitude the thumb has
 * pushed it to. Splitting the deflection is this module's job, which is what the
 * input system's `drive` doc asks of a source, so a controller reads four
 * unipolar magnitudes from a stick exactly as it reads them from four keys.
 *
 * This module depends on the surface, the one method of the input system it
 * drives, the layout, and an emit function, and on nothing else in the engine.
 * What a control *is* is kept in the pure functions at the bottom of the file,
 * and what it *does to the DOM* in the class above them.
 */

import type {
  SurfaceMetrics,
  TouchControlsState,
  TouchLayout,
} from "./contract";
import type { EngineEventEmitter, EngineEventMap } from "./events";
import { MENU_ACTIONS } from "./input";

/** The one thing the controls need of the input system. */
export interface ActionDriver {
  /** Drive `name` to `value`, through the same resolution a key goes through. */
  drive(name: string, value: number): void;
}

/** What the controls are built from. */
export interface TouchControlsOptions {
  /** The surface whose event target the visibility listeners go on. */
  surface: SurfaceMetrics;
  /** Where a control's value goes. */
  actions: ActionDriver;
  /** The selected layout, whose controls are drawn. */
  layout: TouchLayout;
  /** The engine's event broadcaster. */
  emit: EngineEventEmitter;
}

/** Why the controls were hidden, as `touch-controls:hidden` reports it. */
type HideReason = EngineEventMap["touch-controls:hidden"]["reason"];

/**
 * The attribute the container carries, valued with the layout's name, and the
 * prefix the control attributes share.
 *
 * The names carry no engine-specific prefix because the engine's own container
 * scopes them: a driver or a check finds the container first and the controls
 * inside it, so the names need only be unique within the overlay.
 */
export const CONTAINER_ATTRIBUTE = "data-touch-controls";
/** The attribute naming the action a control drives (the first, on a stick or a pad). */
export const ACTION_ATTRIBUTE = "data-action";
/** The attribute listing every action a stick or a pad drives, space-separated. */
export const ACTIONS_ATTRIBUTE = "data-actions";
/** The attribute a control carries while a pointer holds it. */
const HELD_ATTRIBUTE = "data-held";
/** The attribute the injected stylesheet carries, so teardown finds its own. */
const STYLE_ATTRIBUTE = "data-touch-controls-style";

/**
 * The fraction of a stick's or a pad's half-extent inside which a contact reads
 * as rest.
 *
 * A thumb that lands on a stick lands near its middle, and without a dead zone
 * the first contact would drive the action by whatever few pixels it missed the
 * centre by. Past the zone the deflection is rescaled to reach `1` at the edge,
 * so the zone costs no range.
 */
export const DEAD_ZONE = 0.15;

/**
 * The magnitudes one contact gives a control's actions, by action name.
 *
 * A stick gives each of its four directions the component of its deflection
 * along that direction; a pad gives the engaged directions their axis
 * magnitudes; a button gives its action `1`.
 */
export type Contribution = Readonly<Record<string, number>>;

/** A control as it is described before it is built. */
type ControlSpec =
  | { kind: "button"; action: string; label: string; classes: string[] }
  | {
      kind: "stick";
      up: string;
      down: string;
      left: string;
      right: string;
      classes: string[];
    }
  | {
      kind: "pad";
      up: string;
      down: string;
      left: string;
      right: string;
      classes: string[];
    };

/**
 * A control as it is held once built: its element, what it drives, and the
 * pointer holding it, if one is.
 */
interface Control {
  readonly spec: ControlSpec;
  readonly element: HTMLElement;
  /** Every action the control can drive, in `data-actions` order. */
  readonly actions: readonly string[];
  /** The id of the pointer holding the control, or `null` at rest. */
  pointer: number | null;
  /** The listeners on the element, so `detach` removes exactly what was added. */
  readonly listeners: [string, (event: Event) => void][];
}

export class TouchControls {
  readonly #layout: TouchLayout;
  readonly #actions: ActionDriver;
  readonly #emit: EngineEventEmitter;
  /** The target the visibility listeners went on, taken once (see `InputSystem`). */
  readonly #target: EventTarget;
  /** The overlay, or `null` when there was no document to place one in. */
  readonly #container: HTMLElement | null;
  readonly #style: HTMLStyleElement | null;
  readonly #controls: Control[] = [];
  /**
   * What each control is currently giving each action, so two controls that
   * drive one action — the menu's `confirm` and the thumb's — resolve to the
   * larger of the two rather than the last one to speak. Releasing one while
   * the other is held leaves the action held.
   */
  readonly #contributions = new Map<string, Map<Control, number>>();
  /** The value each action was last driven to, so an unchanged value is not re-sent. */
  readonly #driven = new Map<string, number>();
  #visible = false;
  #detached = false;

  /** A touch shows the controls; a mouse or a pen hides them. */
  readonly #onPointerDown = (event: Event): void => {
    const device = pointerDevice(event);
    if (device === "touch") this.#show();
    else this.#hide(device);
  };

  /** A mouse or pen moving hides them; a touch moving changes nothing. */
  readonly #onPointerMove = (event: Event): void => {
    const device = pointerDevice(event);
    if (device !== "touch") this.#hide(device);
  };

  readonly #onKeyDown = (): void => {
    this.#hide("keyboard");
  };

  /** A long press on a control must not open the browser's context menu over it. */
  readonly #onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  /**
   * Builds the overlay for `layout` in the document behind the surface's event
   * target, hidden, and attaches the visibility listeners to that target.
   *
   * Built at construction rather than at first touch so the elements a driver
   * finds by their markers exist from the moment the engine does, hidden or not,
   * and so the first touch has nothing to build and shows the controls at once.
   */
  constructor(options: TouchControlsOptions) {
    this.#layout = options.layout;
    this.#actions = options.actions;
    this.#emit = options.emit;
    this.#target = options.surface.events();

    const document = owningDocument(this.#target);
    const host = document?.body ?? document?.documentElement ?? null;
    if (document === null || host === null) {
      this.#container = null;
      this.#style = null;
      return;
    }

    this.#style = document.createElement("style");
    this.#style.setAttribute(STYLE_ATTRIBUTE, "");
    this.#style.textContent = STYLESHEET;
    (document.head ?? host).append(this.#style);

    this.#container = document.createElement("div");
    this.#container.setAttribute(CONTAINER_ATTRIBUTE, this.#layout.name);
    this.#container.hidden = true;
    this.#container.style.display = "none";
    this.#container.addEventListener("contextmenu", this.#onContextMenu);

    const frame = document.createElement("div");
    frame.className = "frame";
    this.#container.append(frame);

    for (const spec of layoutControls(this.#layout)) {
      frame.append(this.#build(document, spec));
    }
    const strip = document.createElement("div");
    strip.className = "menu";
    for (const action of MENU_ACTIONS) {
      strip.append(
        this.#build(document, {
          kind: "button",
          action,
          label: capitalize(action),
          classes: ["menu-button"],
        }),
      );
    }
    frame.append(strip);
    host.append(this.#container);

    this.#target.addEventListener("pointerdown", this.#onPointerDown);
    this.#target.addEventListener("pointermove", this.#onPointerMove);
    this.#target.addEventListener("keydown", this.#onKeyDown);
  }

  /**
   * The layout and whether its controls are showing, as a fresh copy, or `null`
   * when there was no document to draw them in.
   */
  state(): TouchControlsState | null {
    if (this.#container === null) return null;
    return { layout: this.#layout.name, visible: this.#visible };
  }

  /**
   * Releases every held control, removes the overlay and its stylesheet, and
   * detaches the visibility listeners. Idempotent, because teardown races.
   *
   * The controls are released before anything is removed, so an action a thumb
   * was holding when the engine went away is driven back to rest rather than
   * left reading held.
   */
  detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    for (const control of this.#controls) {
      this.#release(control);
      for (const [type, listener] of control.listeners) {
        control.element.removeEventListener(type, listener);
      }
    }
    if (this.#container !== null) {
      this.#target.removeEventListener("pointerdown", this.#onPointerDown);
      this.#target.removeEventListener("pointermove", this.#onPointerMove);
      this.#target.removeEventListener("keydown", this.#onKeyDown);
      this.#container.removeEventListener("contextmenu", this.#onContextMenu);
      this.#container.remove();
    }
    this.#style?.remove();
  }

  #show(): void {
    if (this.#visible || this.#container === null || this.#detached) return;
    this.#visible = true;
    this.#container.hidden = false;
    this.#container.style.display = "";
    this.#emit("touch-controls:shown", { layout: this.#layout.name });
  }

  /**
   * Hides the controls and releases whatever they were holding: a control that
   * cannot be seen must not keep driving an action, and the pointer holding it
   * has no visible thing to lift off.
   */
  #hide(reason: HideReason): void {
    if (!this.#visible || this.#container === null) return;
    this.#visible = false;
    for (const control of this.#controls) this.#release(control);
    this.#container.hidden = true;
    this.#container.style.display = "none";
    this.#emit("touch-controls:hidden", { layout: this.#layout.name, reason });
  }

  /**
   * Builds one control's element, marks it, and attaches the pointer listeners
   * that isolate it from the game and drive its actions.
   *
   * The four listeners stop propagation unconditionally, whether or not the
   * control ends up acting on the event: a contact on a control is the control's
   * whatever it does with it, and a `pointermove` from a mouse hovering a visible
   * control is likewise not a report the game's pointer should receive.
   */
  #build(document: Document, spec: ControlSpec): HTMLElement {
    const element = document.createElement("div");
    const actions = specActions(spec);
    element.className = ["control", spec.kind, ...spec.classes].join(" ");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", actions.join(" "));
    element.setAttribute(ACTION_ATTRIBUTE, actions[0] ?? "");
    if (spec.kind !== "button") {
      element.setAttribute(ACTIONS_ATTRIBUTE, actions.join(" "));
    }
    decorate(document, element, spec);

    const control: Control = {
      spec,
      element,
      actions,
      pointer: null,
      listeners: [],
    };

    const onDown = (event: Event): void => {
      event.stopPropagation();
      // No focus change, no text selection, and no compatibility mouse events
      // synthesized for this contact: the control has already taken it.
      event.preventDefault();
      // A second finger on a held control changes nothing; the first keeps it.
      if (control.pointer !== null) return;
      control.pointer = pointerId(event);
      capturePointer(element, control.pointer);
      element.setAttribute(HELD_ATTRIBUTE, "");
      this.#engage(control, event);
    };
    const onMove = (event: Event): void => {
      event.stopPropagation();
      if (control.pointer === null || control.pointer !== pointerId(event)) {
        return;
      }
      this.#engage(control, event);
    };
    const onEnd = (event: Event): void => {
      event.stopPropagation();
      if (control.pointer === null || control.pointer !== pointerId(event)) {
        return;
      }
      this.#release(control);
    };
    control.listeners.push(
      ["pointerdown", onDown],
      ["pointermove", onMove],
      ["pointerup", onEnd],
      ["pointercancel", onEnd],
    );
    for (const [type, listener] of control.listeners) {
      element.addEventListener(type, listener);
    }
    this.#controls.push(control);
    return element;
  }

  /** Reads the contact against the control's rect and drives what it gives. */
  #engage(control: Control, event: Event): void {
    const position = clientPosition(event);
    const rect = control.element.getBoundingClientRect();
    const contribution = contributionOf(control.spec, rect, position);
    if (control.spec.kind === "stick") {
      const x =
        (contribution[control.spec.right] ?? 0) -
        (contribution[control.spec.left] ?? 0);
      const y =
        (contribution[control.spec.up] ?? 0) -
        (contribution[control.spec.down] ?? 0);
      control.element.style.setProperty("--stick-x", String(x));
      control.element.style.setProperty("--stick-y", String(y));
    }
    this.#drive(control, contribution);
  }

  /** Returns every action the control holds to rest and lets the pointer go. */
  #release(control: Control): void {
    const held = control.pointer;
    control.pointer = null;
    control.element.removeAttribute(HELD_ATTRIBUTE);
    control.element.style.removeProperty("--stick-x");
    control.element.style.removeProperty("--stick-y");
    if (held !== null) releasePointerCapture(control.element, held);
    this.#drive(control, {});
  }

  /**
   * Records what `control` now gives each of its actions and drives each to the
   * largest value any control gives it.
   *
   * An action's value is sent only when it changed, an action never driven
   * counting as at rest. The input system would accept a repeat harmlessly,
   * but a `pointermove` arrives many times a frame and the one call that
   * matters is the one that moved the number, and a release of a control that
   * was never engaged is not a change at all.
   */
  #drive(control: Control, contribution: Contribution): void {
    for (const action of control.actions) {
      let byControl = this.#contributions.get(action);
      if (byControl === undefined) {
        byControl = new Map();
        this.#contributions.set(action, byControl);
      }
      const value = contribution[action] ?? 0;
      if (value === 0) byControl.delete(control);
      else byControl.set(control, value);

      let resolved = 0;
      for (const given of byControl.values())
        resolved = Math.max(resolved, given);
      if ((this.#driven.get(action) ?? 0) === resolved) continue;
      this.#driven.set(action, resolved);
      this.#actions.drive(action, resolved);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The geometry: what a contact on a control means                            */
/* -------------------------------------------------------------------------- */

/** A rect's extent along one axis, as `getBoundingClientRect` reports it. */
export interface Extent {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A client-space point. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A contact's deflection in `[-1, 1]` along one axis of `rect`, positive toward
 * `start`, with the dead zone applied and the remaining travel rescaled to reach
 * `1` at the edge.
 *
 * `0` for a rect with no extent: an element that has not been laid out gives a
 * contact no place to be measured against, so it reads as rest rather than as a
 * division by zero.
 */
export function axisDeflection(
  contact: number,
  start: number,
  extent: number,
): number {
  if (!(extent > 0) || !Number.isFinite(contact)) return 0;
  const half = extent / 2;
  const raw = (start + half - contact) / half;
  const clamped = Math.max(-1, Math.min(1, raw));
  const magnitude = Math.abs(clamped);
  if (magnitude < DEAD_ZONE) return 0;
  const rescaled = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(clamped) * rescaled;
}

/**
 * A stick's deflection: a point in the unit disc, `x` positive rightward and
 * `y` positive upward, `(0, 0)` inside the dead zone about its centre.
 *
 * The dead zone is radial rather than per axis, and so is the rescaling: a thumb
 * pushed straight to the rim reads `1` along that axis, and one pushed to the
 * rim on a diagonal reads a unit vector rather than `(1, 1)`, so the magnitude a
 * controller rebuilds from the four directions is the distance the thumb moved
 * whatever the heading. A contact past the rim is clamped onto it. A rect with
 * no extent, or a contact with no position on either axis, reads as rest.
 */
export function stickDeflection(rect: Extent, contact: Point): Point {
  const rest = { x: 0, y: 0 };
  if (
    !(rect.width > 0) ||
    !(rect.height > 0) ||
    !Number.isFinite(contact.x) ||
    !Number.isFinite(contact.y)
  ) {
    return rest;
  }
  const rawX = (contact.x - (rect.left + rect.width / 2)) / (rect.width / 2);
  const rawY = (rect.top + rect.height / 2 - contact.y) / (rect.height / 2);
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude < DEAD_ZONE) return rest;
  const rescaled = Math.min(1, (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE));
  return {
    x: (rawX / magnitude) * rescaled,
    y: (rawY / magnitude) * rescaled,
  };
}

/**
 * What a pad gives its four directions for a contact: eight ways, each engaged
 * direction receiving the deflection along its own axis.
 *
 * The eight ways are the four axes and the four diagonals, each a 45° sector
 * about its heading, so a thumb pushed up-and-right engages `up` and `right`
 * together and one pushed almost straight up engages `up` alone. Inside the dead
 * zone nothing is engaged.
 */
export function padDirections(
  rect: Extent,
  contact: Point,
): { up: number; down: number; left: number; right: number } {
  const rest = { up: 0, down: 0, left: 0, right: 0 };
  // Positive `x` is rightward, so the horizontal axis runs from the right edge.
  const x = -axisDeflection(contact.x, rect.left, rect.width);
  const y = axisDeflection(contact.y, rect.top, rect.height);
  if (x === 0 && y === 0) return rest;
  // Sector 0 is right, then counter-clockwise by 45°: 2 is up, 4 is left, 6 down.
  const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4)) & 7;
  const vertical =
    sector >= 1 && sector <= 3 ? "up" : sector >= 5 ? "down" : null;
  const horizontal =
    sector === 7 || sector <= 1
      ? "right"
      : sector >= 3 && sector <= 5
        ? "left"
        : null;
  return {
    ...rest,
    ...(vertical === null ? {} : { [vertical]: Math.abs(y) }),
    ...(horizontal === null ? {} : { [horizontal]: Math.abs(x) }),
  };
}

/** What one contact on a control of `spec` gives each of the control's actions. */
export function contributionOf(
  spec: ControlSpec,
  rect: Extent,
  contact: Point,
): Contribution {
  switch (spec.kind) {
    case "button":
      return { [spec.action]: 1 };
    case "stick": {
      const deflection = stickDeflection(rect, contact);
      return {
        [spec.up]: Math.max(0, deflection.y),
        [spec.down]: Math.max(0, -deflection.y),
        [spec.left]: Math.max(0, -deflection.x),
        [spec.right]: Math.max(0, deflection.x),
      };
    }
    case "pad": {
      const directions = padDirections(rect, contact);
      return {
        [spec.up]: directions.up,
        [spec.down]: directions.down,
        [spec.left]: directions.left,
        [spec.right]: directions.right,
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The catalogue's drawings                                                   */
/* -------------------------------------------------------------------------- */

/** The pad every `dpad-` layout draws, at the bottom left. */
const PAD: ControlSpec = {
  kind: "pad",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  classes: [],
};

/** The move stick every `-stick` layout draws, at the bottom left. */
const MOVE_STICK: ControlSpec = {
  kind: "stick",
  up: "move-up",
  down: "move-down",
  left: "move-left",
  right: "move-right",
  classes: ["left"],
};

/** The look stick the `dual-stick` layouts draw, at the bottom right. */
const LOOK_STICK: ControlSpec = {
  kind: "stick",
  up: "look-up",
  down: "look-down",
  left: "look-left",
  right: "look-right",
  classes: ["right"],
};

/** The large `confirm` under the thumb of a layout with no action buttons. */
const LARGE_CONFIRM: ControlSpec = {
  kind: "button",
  action: "confirm",
  label: "OK",
  classes: ["round", "large"],
};

/**
 * What each layout draws, beside the menu strip every layout carries at the
 * top right.
 *
 * Keyed by the layout's name rather than derived from its vocabulary, because
 * the vocabulary says which actions exist and not where a thumb finds them. A
 * layout the catalogue holds and this table does not is refused, so adding a
 * layout to one without the other fails at construction rather than drawing an
 * empty overlay.
 */
const DRAWINGS: Readonly<Record<string, readonly ControlSpec[]>> = {
  "dpad-4": [PAD, LARGE_CONFIRM],
  "dpad-4-two-buttons": [
    PAD,
    { kind: "button", action: "a", label: "A", classes: ["round", "a"] },
    { kind: "button", action: "b", label: "B", classes: ["round", "b"] },
    {
      kind: "button",
      action: "confirm",
      label: "OK",
      classes: ["round", "small"],
    },
  ],
  "single-stick": [MOVE_STICK, LARGE_CONFIRM],
  "dual-stick": [MOVE_STICK, LOOK_STICK],
  "dual-stick-two-buttons": [
    MOVE_STICK,
    LOOK_STICK,
    {
      kind: "button",
      action: "a",
      label: "A",
      classes: ["round", "above", "a"],
    },
    {
      kind: "button",
      action: "b",
      label: "B",
      classes: ["round", "above", "b"],
    },
  ],
};

/**
 * The drawing for `layout`.
 *
 * @throws for a layout with no drawing, naming it: the catalogue and this table
 * must agree, and a layout that can be selected but not drawn is a build that
 * runs and shows a phone nothing.
 */
export function layoutControls(layout: TouchLayout): readonly ControlSpec[] {
  const drawing = DRAWINGS[layout.name];
  if (drawing === undefined) {
    throw new Error(
      `Touch layout "${layout.name}" has no on-screen controls to draw.`,
    );
  }
  return drawing;
}

/** Every action a control of `spec` drives, in the order `data-actions` lists them. */
function specActions(spec: ControlSpec): string[] {
  switch (spec.kind) {
    case "button":
      return [spec.action];
    case "stick":
    case "pad":
      return [spec.up, spec.down, spec.left, spec.right];
  }
}

/** Fills a control's element with what a player sees on it. */
function decorate(
  document: Document,
  element: HTMLElement,
  spec: ControlSpec,
): void {
  switch (spec.kind) {
    case "button":
      element.textContent = spec.label;
      return;
    case "stick": {
      const knob = document.createElement("span");
      knob.className = "knob";
      element.append(knob);
      return;
    }
    case "pad": {
      for (const [className, glyph] of [
        ["arrow up", "▲"],
        ["arrow left", "◀"],
        ["arrow right", "▶"],
        ["arrow down", "▼"],
      ] as const) {
        const arrow = document.createElement("span");
        arrow.className = className;
        arrow.textContent = glyph;
        element.append(arrow);
      }
      return;
    }
  }
}

/** `confirm` → `Confirm`, for a menu button's label. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* -------------------------------------------------------------------------- */
/* The DOM seams                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The document behind an event target, or `null` when there is none.
 *
 * Structural rather than `instanceof`, like every other narrowing in this
 * package: the target may come from another realm. A document is its own
 * document, a node has an owner, a window has a document, and a bare
 * `EventTarget` — what a headless caller supplies — has nothing, which is the
 * case that makes the controls inert.
 */
function owningDocument(target: EventTarget): Document | null {
  const node = target as Partial<Node>;
  if (node.nodeType === 9) return target as Document;
  if (typeof node.nodeType === "number") return node.ownerDocument ?? null;
  const window = target as Partial<Window>;
  const document = window.document as Partial<Node> | undefined;
  if (document?.nodeType === 9) return document as Document;
  return null;
}

/** The device behind a pointer event, defaulting to a mouse as the input system does. */
function pointerDevice(event: Event): "touch" | "mouse" | "pen" {
  const type = (event as Partial<PointerEvent>).pointerType;
  return type === "touch" || type === "pen" ? type : "mouse";
}

/** The pointer's id, `0` for an event that carries none (see the input system). */
function pointerId(event: Event): number {
  const id = (event as Partial<PointerEvent>).pointerId;
  return typeof id === "number" ? id : 0;
}

/**
 * The event's client position, or `NaN` on an axis the event does not report,
 * which a stick or a pad reads as rest. A button reads no position at all, so a
 * hand-dispatched `pointerdown` with none still presses it.
 */
function clientPosition(event: Event): Point {
  const candidate = event as Partial<MouseEvent>;
  return {
    x: typeof candidate.clientX === "number" ? candidate.clientX : Number.NaN,
    y: typeof candidate.clientY === "number" ? candidate.clientY : Number.NaN,
  };
}

/**
 * Captures the pointer on the control, when the host can.
 *
 * Guarded twice: a host without `setPointerCapture` at all (jsdom), and a
 * capture on a pointer that has already ended, which throws.
 */
function capturePointer(element: HTMLElement, id: number): void {
  if (typeof element.setPointerCapture !== "function") return;
  try {
    element.setPointerCapture(id);
  } catch {
    // The pointer is already gone; there is nothing to route.
  }
}

/** Ends the capture, when there is one to end. */
function releasePointerCapture(element: HTMLElement, id: number): void {
  if (typeof element.releasePointerCapture !== "function") return;
  try {
    element.releasePointerCapture(id);
  } catch {
    // Already released, by the browser or by the pointer ending.
  }
}

/* -------------------------------------------------------------------------- */
/* The stylesheet                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The overlay's whole style, injected once per engine and scoped by the
 * container attribute so nothing here reaches the page around the canvas.
 *
 * The container covers the viewport and lets every pointer event through;
 * only the controls take them. Each control declines the browser's touch
 * gestures and text selection, and measures at least 44 CSS pixels on its
 * shortest side; a stick and a pad take about a quarter of the viewport's
 * shorter side. The frame inside the container is inset by the device's
 * safe-area insets, so a control sits clear of a notch or a home indicator.
 * The action buttons of `dual-stick-two-buttons` sit above the look stick,
 * measured from the stick's own size, so they clear it in either orientation.
 */
const STYLESHEET = `
[${CONTAINER_ATTRIBUTE}] {
  --stick-size: max(132px, 25vmin);
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font: 600 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  -webkit-user-select: none;
  user-select: none;
}
[${CONTAINER_ATTRIBUTE}][hidden] {
  display: none;
}
[${CONTAINER_ATTRIBUTE}] .frame {
  position: absolute;
  inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  pointer-events: none;
}
[${CONTAINER_ATTRIBUTE}] .control {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  pointer-events: auto;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
[${CONTAINER_ATTRIBUTE}] .control[${HELD_ATTRIBUTE}] {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.9);
}
[${CONTAINER_ATTRIBUTE}] .stick {
  bottom: 16px;
  width: var(--stick-size);
  height: var(--stick-size);
  border-radius: 50%;
}
[${CONTAINER_ATTRIBUTE}] .stick.left { left: 16px; }
[${CONTAINER_ATTRIBUTE}] .stick.right { right: 16px; }
[${CONTAINER_ATTRIBUTE}] .stick .knob {
  position: absolute;
  left: calc(50% + var(--stick-x, 0) * (50% - 26px));
  top: calc(50% - var(--stick-y, 0) * (50% - 26px));
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.75);
}
[${CONTAINER_ATTRIBUTE}] .pad {
  left: 16px;
  bottom: 16px;
  width: var(--stick-size);
  height: var(--stick-size);
  border-radius: 50%;
  display: grid;
  grid-template: 1fr 1fr 1fr / 1fr 1fr 1fr;
  place-items: center;
}
[${CONTAINER_ATTRIBUTE}] .pad .arrow { font-size: 20px; opacity: 0.85; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.up { grid-area: 1 / 2; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.left { grid-area: 2 / 1; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.right { grid-area: 2 / 3; }
[${CONTAINER_ATTRIBUTE}] .pad .arrow.down { grid-area: 3 / 2; }
[${CONTAINER_ATTRIBUTE}] .round {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  font-size: 22px;
}
[${CONTAINER_ATTRIBUTE}] .round.large {
  right: 16px;
  bottom: 16px;
  width: 96px;
  height: 96px;
}
[${CONTAINER_ATTRIBUTE}] .round.a { right: 16px; bottom: 16px; }
[${CONTAINER_ATTRIBUTE}] .round.b { right: 100px; bottom: 76px; }
[${CONTAINER_ATTRIBUTE}] .round.small {
  right: 112px;
  bottom: 8px;
  width: 52px;
  height: 52px;
  font-size: 14px;
}
[${CONTAINER_ATTRIBUTE}] .round.above.a {
  right: 16px;
  bottom: calc(var(--stick-size) + 32px);
}
[${CONTAINER_ATTRIBUTE}] .round.above.b {
  right: 100px;
  bottom: calc(var(--stick-size) + 92px);
}
[${CONTAINER_ATTRIBUTE}] .menu {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  gap: 8px;
  pointer-events: none;
}
[${CONTAINER_ATTRIBUTE}] .menu-button {
  position: relative;
  height: 44px;
  min-width: 64px;
  padding: 0 12px;
  font-size: 13px;
}
`;
