/**
 * The pointer: the engine's single answer to "where is the player pointing,
 * what are they holding, and with what?".
 *
 * A game never reads `PointerEvent`s. The engine listens on the same target its
 * key listeners go on, maps each event's client position through the letterboxed
 * fit the game draws under, and hands `update` positions in the game's own
 * logical coordinates — through {@link UpdateApi.input} — so the device pixel
 * ratio and the letterbox bars never appear in game code. The pointer is the one
 * input whose meaning depends on where the picture is, and every pointer game
 * otherwise re-derives that conversion slightly wrong.
 *
 * A mouse, a pen, and a touch all arrive here as pointers, on the same reads. A
 * pen or a touch in contact holds the primary button, so a game written against
 * `down` and the primary edges plays identically under all three, and `device`
 * and `buttons` are what a game reads where it wants to differ.
 *
 * Three reads serve three designs. The snapshot answers "where now, and held?",
 * which is what aiming needs. The per-frame sample list holds every position
 * delivered since the input frame last closed, in arrival order, which is what
 * direct manipulation needs: a sweep that crossed several targets between two
 * frames arrives as the ordered positions it visited rather than as the last one
 * alone. The contact list holds every pointer touching the surface, which is what
 * a pinch or a second player needs.
 *
 * **Nothing here grows with the length of a run.** The sample list is cleared
 * every time the frame loop closes the input frame, and it is bounded at
 * {@link POINTER_SAMPLE_CAP} in between, so a burst of events between two frames
 * — or a run whose frames have stopped closing — costs a fixed amount however
 * long it goes on. A sample past the cap still moves the snapshot, the contacts,
 * and the edges; only its place in the list is refused. The contact map is
 * bounded by the pointers actually touching the surface, and an entry leaves it
 * on the release or the cancel that ended the contact.
 */

import type {
  PointerButton,
  PointerContact,
  PointerDevice,
  PointerSample,
  PointerSnapshot,
  SurfaceMetrics,
  Viewport,
  WheelDelta,
} from "./contract";

/**
 * The most samples one frame lists.
 *
 * Browsers coalesce `pointermove` to roughly one per animation frame, so a real
 * player produces a handful of samples per frame and never approaches this. The
 * cap exists for the frames that stop closing — a hidden tab whose animation
 * callbacks are suspended while the pointer keeps streaming — where an unbounded
 * list would grow for as long as the tab stays hidden.
 */
export const POINTER_SAMPLE_CAP = 1024;

/**
 * CSS pixels one line of wheel travel is worth, for a wheel reporting its delta
 * in lines. A page's worth is the surface's own CSS height, read at the event.
 */
const WHEEL_LINE_HEIGHT = 16;

/** The buttons in the order {@link PointerButton} declares them. */
const BUTTON_ORDER: readonly PointerButton[] = [
  "primary",
  "secondary",
  "auxiliary",
  "back",
  "forward",
];

/**
 * The bit each button occupies in `PointerEvent.buttons`, and its index in
 * `PointerEvent.button`. The two use different numbering, which is why this is a
 * table rather than an arithmetic conversion.
 */
const BUTTON_BITS: Readonly<Record<PointerButton, number>> = {
  primary: 1,
  secondary: 2,
  auxiliary: 4,
  back: 8,
  forward: 16,
};

/** The button each `PointerEvent.button` index names. */
const BUTTON_INDEX: readonly PointerButton[] = [
  "primary",
  "auxiliary",
  "secondary",
  "back",
  "forward",
];

/** What the engine tracks for one pointer in contact with the surface. */
interface Contact {
  readonly id: number;
  x: number;
  y: number;
  readonly primary: boolean;
  device: PointerDevice;
  buttons: PointerButton[];
}

/** A press and a release edge for one button, each armed once and consumed on read. */
interface ButtonEdges {
  pressed: boolean;
  released: boolean;
}

/**
 * What one event said, once it has been placed on the stage.
 *
 * `buttons` is `null` when the event carried no mask, which a hand-dispatched
 * event routinely does. Each listener resolves that absence for itself, because
 * what "unstated" means depends on the event: a press adds its button, a move
 * changes nothing, and a release drops the button it names.
 */
interface Reading {
  /** Whether the fit placed the event on the stage. A degenerate fit places none. */
  placed: boolean;
  x: number;
  y: number;
  id: number;
  primary: boolean;
  device: PointerDevice;
  button: PointerButton | null;
  buttons: PointerButton[] | null;
}

export class PointerInput {
  /** The target the listeners went on, taken from the surface once (see `InputRegistry`). */
  readonly #target: EventTarget;
  readonly #surface: SurfaceMetrics;
  /**
   * The live fit, read at each event rather than held: events arrive between
   * frames, and the fit in force at that moment — not the one some earlier frame
   * computed — is what places the event on the stage.
   */
  readonly #viewport: () => Viewport;
  /** Gives the browser back the gestures {@link SurfaceMetrics.claimGestures} took. */
  readonly #releaseGestures: (() => void) | null;
  #x = 0;
  #y = 0;
  #device: PointerDevice = "mouse";
  /**
   * Every pointer in contact, keyed by id and held in contact order, which is
   * the order {@link contacts} reports.
   */
  readonly #contacts = new Map<number, Contact>();
  /** The primary pointer's per-button edges, armed here and consumed on read. */
  readonly #edges = new Map<PointerButton, ButtonEdges>();
  #samples: PointerSample[] = [];
  #wheelX = 0;
  #wheelY = 0;
  #detached = false;

  readonly #onDown = (event: Event): void => {
    const reading = this.#read(event);
    if (reading === null || !reading.placed) return;
    const existing = this.#contacts.get(reading.id);
    const pressed = reading.button ?? "primary";
    if (existing === undefined) {
      const contact: Contact = {
        id: reading.id,
        x: reading.x,
        y: reading.y,
        primary: reading.primary,
        device: reading.device,
        buttons: reading.buttons ?? [pressed],
      };
      this.#contacts.set(reading.id, contact);
      this.#surface.capturePointer?.(contact.id);
      if (contact.primary) this.#edge(pressed).pressed = true;
      this.#record(contact, "down", reading.x, reading.y, reading.button);
      return;
    }
    // A second `pointerdown` on a pointer already in contact is a chorded
    // button, not a new contact: the contact continues, its button set grows,
    // and the sample is a `move` so `down` and `up` keep alternating strictly.
    // A button already held arms nothing, so a repeated press of one button is
    // one press however many events report it.
    const chorded = !existing.buttons.includes(pressed);
    existing.device = reading.device;
    existing.buttons = reading.buttons ?? withButton(existing.buttons, pressed);
    if (existing.primary && chorded) this.#edge(pressed).pressed = true;
    this.#record(existing, "move", reading.x, reading.y, reading.button);
  };

  readonly #onMove = (event: Event): void => {
    const reading = this.#read(event);
    if (reading === null || !reading.placed) return;
    const contact = this.#contacts.get(reading.id);
    if (contact === undefined) {
      this.#hover(reading);
      return;
    }
    contact.device = reading.device;
    contact.buttons = reading.buttons ?? contact.buttons;
    this.#record(contact, "move", reading.x, reading.y, null);
  };

  readonly #onUp = (event: Event): void => {
    const reading = this.#read(event);
    if (reading === null) return;
    const contact = this.#contacts.get(reading.id);
    // A `pointerup` with no contact to end has no hold to release; it still says
    // where the pointer is.
    if (contact === undefined) {
      this.#hover(reading);
      return;
    }
    contact.device = reading.device;
    if (reading.placed) {
      contact.x = reading.x;
      contact.y = reading.y;
    }
    this.#lift(
      contact,
      reading.button,
      reading.buttons ?? withoutButton(contact.buttons, reading.button),
    );
  };

  /**
   * A cancelled pointer — the browser took the gesture for scrolling, the touch
   * left the surface — ends the contact as a release at the last known position.
   * Its own coordinates are not read: a cancel is the browser saying the gesture
   * stopped being the page's, not a report of where it went.
   */
  readonly #onCancel = (event: Event): void => {
    const contact = this.#contacts.get(pointerId(event));
    if (contact === undefined) return;
    this.#lift(contact, null, []);
  };

  /**
   * Accumulates wheel travel in logical units, through the same scale a position
   * goes through, so a game reads the wheel on the axes it draws on.
   */
  readonly #onWheel = (event: Event): void => {
    const candidate = event as Partial<WheelEvent>;
    if (
      typeof candidate.deltaX !== "number" ||
      typeof candidate.deltaY !== "number"
    ) {
      return;
    }
    const viewport = this.#viewport();
    if (viewport.scale === 0) return;
    const dpr = this.#surface.dpr();
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const unit = this.#wheelUnit(candidate.deltaMode);
    this.#wheelX += (candidate.deltaX * unit * ratio) / viewport.scale;
    this.#wheelY += (candidate.deltaY * unit * ratio) / viewport.scale;
  };

  /**
   * Attaches to the target the surface supplies, immediately, for the same
   * reason the key listeners do (see `InputRegistry`): it is the one seam an
   * engine with no document behind it still has, and a caller that dispatches a
   * pointer-shaped event at it reaches the game by the path a player's pointer
   * takes.
   *
   * The browser's own gestures are claimed here rather than left to the page.
   * Without that claim a touch drag is taken for a pan and arrives as a
   * `pointercancel` part way through the gesture, the secondary button opens a
   * context menu instead of reaching the game, and the wheel scrolls the page
   * out from under the canvas.
   */
  constructor(surface: SurfaceMetrics, viewport: () => Viewport) {
    this.#surface = surface;
    this.#viewport = viewport;
    this.#target = surface.events();
    this.#releaseGestures = surface.claimGestures?.() ?? null;
    this.#target.addEventListener("pointerdown", this.#onDown);
    this.#target.addEventListener("pointermove", this.#onMove);
    this.#target.addEventListener("pointerup", this.#onUp);
    this.#target.addEventListener("pointercancel", this.#onCancel);
    this.#target.addEventListener("wheel", this.#onWheel);
  }

  /** The primary pointer's position, hold, device, and buttons, as a fresh copy. */
  snapshot(): PointerSnapshot {
    const primary = this.#primary();
    return {
      x: this.#x,
      y: this.#y,
      down: primary !== undefined && primary.buttons.length > 0,
      device: this.#device,
      buttons: primary === undefined ? [] : [...primary.buttons],
    };
  }

  /**
   * Whether `button` was pressed on the primary pointer since the last frame —
   * true exactly once per armed edge, then consumed, for the same reason an
   * action's `pressed` is: a menu and a gameplay layer both asking in one frame
   * must not both act on one press.
   */
  pressed(button: PointerButton = "primary"): boolean {
    const edges = this.#edges.get(button);
    if (edges === undefined || !edges.pressed) return false;
    edges.pressed = false;
    return true;
  }

  /** Whether `button` was released since the last frame; consumed on read. */
  released(button: PointerButton = "primary"): boolean {
    const edges = this.#edges.get(button);
    if (edges === undefined || !edges.released) return false;
    edges.released = false;
    return true;
  }

  /**
   * The samples delivered since the input frame last closed, in arrival order,
   * as a fresh copy. Not consumed on read: the list is a record of the frame's
   * path rather than an edge, and two readers of one frame read one path.
   */
  samples(): PointerSample[] {
    return [...this.#samples];
  }

  /** Every pointer in contact, in contact order, as a fresh copy. */
  contacts(): PointerContact[] {
    return [...this.#contacts.values()].map((contact) => ({
      id: contact.id,
      x: contact.x,
      y: contact.y,
      primary: contact.primary,
      device: contact.device,
      buttons: [...contact.buttons],
    }));
  }

  /** The wheel travel accumulated since the input frame last closed. */
  wheel(): WheelDelta {
    return { x: this.#wheelX, y: this.#wheelY };
  }

  /**
   * Closes the pointer's input frame: the sample list empties, the accumulated
   * wheel travel returns to zero, and unconsumed edges are discarded. Called by
   * the frame loop beside the action registry's `endFrame`, so a press is news
   * for exactly one frame here too.
   *
   * The contacts survive, because a pointer held across a frame boundary is
   * still in contact.
   */
  endFrame(): void {
    this.#samples = [];
    this.#wheelX = 0;
    this.#wheelY = 0;
    for (const edges of this.#edges.values()) {
      edges.pressed = false;
      edges.released = false;
    }
  }

  /**
   * Detaches the pointer listeners, releases every capture, and gives the
   * gestures back. Idempotent, because teardown races.
   */
  detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    this.#target.removeEventListener("pointerdown", this.#onDown);
    this.#target.removeEventListener("pointermove", this.#onMove);
    this.#target.removeEventListener("pointerup", this.#onUp);
    this.#target.removeEventListener("pointercancel", this.#onCancel);
    this.#target.removeEventListener("wheel", this.#onWheel);
    for (const id of this.#contacts.keys())
      this.#surface.releasePointerCapture?.(id);
    this.#contacts.clear();
    this.#releaseGestures?.();
  }

  /**
   * Applies a release: every button the contact loses arms its release edge, and
   * a contact left holding nothing ends.
   *
   * A mouse releasing one of two held buttons keeps its contact and reports a
   * `move` naming the button, so `down` and `up` stay one contact apart.
   */
  #lift(
    contact: Contact,
    button: PointerButton | null,
    remaining: readonly PointerButton[],
  ): void {
    if (contact.primary) {
      for (const held of contact.buttons) {
        if (!remaining.includes(held)) this.#edge(held).released = true;
      }
    }
    contact.buttons = [...remaining];
    if (remaining.length > 0) {
      this.#record(contact, "move", contact.x, contact.y, button);
      return;
    }
    this.#contacts.delete(contact.id);
    this.#surface.releasePointerCapture?.(contact.id);
    this.#record(contact, "up", contact.x, contact.y, button);
  }

  /**
   * An event from a pointer holding nothing: it moves the snapshot when it is
   * the primary pointer, which is what hover and aiming read, and lists a sample
   * carrying no buttons.
   */
  #hover(reading: Reading): void {
    if (!reading.placed) return;
    if (reading.primary) {
      this.#x = reading.x;
      this.#y = reading.y;
      this.#device = reading.device;
    }
    this.#list({
      type: "move",
      x: reading.x,
      y: reading.y,
      id: reading.id,
      primary: reading.primary,
      device: reading.device,
      button: reading.button,
      buttons: [],
    });
  }

  /** The edge pair for `button`, created on first use. */
  #edge(button: PointerButton): ButtonEdges {
    const existing = this.#edges.get(button);
    if (existing !== undefined) return existing;
    const created: ButtonEdges = { pressed: false, released: false };
    this.#edges.set(button, created);
    return created;
  }

  /** The primary pointer's contact, when one is in contact. */
  #primary(): Contact | undefined {
    for (const contact of this.#contacts.values()) {
      if (contact.primary) return contact;
    }
    return undefined;
  }

  /** CSS pixels one unit of `deltaMode` is worth. */
  #wheelUnit(deltaMode: number | undefined): number {
    if (deltaMode === 1) return WHEEL_LINE_HEIGHT;
    if (deltaMode === 2) {
      const height = this.#surface.cssHeight();
      return Number.isFinite(height) && height > 0 ? height : WHEEL_LINE_HEIGHT;
    }
    return 1;
  }

  /**
   * The event's position, identity, device, and buttons, or `null` for an event
   * this input does not track at all: one with no numeric client position. The
   * narrowing is structural, like the key listeners', so a plain `Event` carrying
   * `clientX`/`clientY` from any realm drives the pointer.
   *
   * A degenerate fit (a `scale` of `0`) gives a real pointer event no place on
   * the stage, and the reading comes back unplaced. Its position is dropped, and
   * the release that must still end a contact wherever it happened acts on it
   * anyway.
   */
  #read(event: Event): Reading | null {
    const candidate = event as Partial<PointerEvent>;
    if (
      typeof candidate.clientX !== "number" ||
      typeof candidate.clientY !== "number"
    ) {
      return null;
    }
    const common = {
      id: pointerId(event),
      primary: candidate.isPrimary !== false,
      device: namedDevice(candidate.pointerType),
      button: namedButton(candidate.button),
      buttons: heldButtons(candidate.buttons),
    };
    const viewport = this.#viewport();
    if (viewport.scale === 0) return { ...common, x: 0, y: 0, placed: false };
    const origin = this.#surface.origin?.() ?? { x: 0, y: 0 };
    const dpr = this.#surface.dpr();
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    return {
      ...common,
      x:
        ((candidate.clientX - origin.x) * ratio - viewport.offsetX) /
        viewport.scale,
      y:
        ((candidate.clientY - origin.y) * ratio - viewport.offsetY) /
        viewport.scale,
      placed: true,
    };
  }

  /**
   * Moves the contact and the snapshot, and lists the sample.
   *
   * The snapshot follows the primary pointer alone, so a second finger landing on
   * the screen leaves a game built for one pointer exactly as it was.
   */
  #record(
    contact: Contact,
    type: PointerSample["type"],
    x: number,
    y: number,
    button: PointerButton | null,
  ): void {
    contact.x = x;
    contact.y = y;
    if (contact.primary) {
      this.#x = x;
      this.#y = y;
      this.#device = contact.device;
    }
    this.#list({
      type,
      x,
      y,
      id: contact.id,
      primary: contact.primary,
      device: contact.device,
      button,
      buttons: [...contact.buttons],
    });
  }

  /** Lists a sample, refusing the listing — and only the listing — past the cap. */
  #list(sample: PointerSample): void {
    if (this.#samples.length < POINTER_SAMPLE_CAP) this.#samples.push(sample);
  }
}

/**
 * The pointer's id.
 *
 * An event carrying no `pointerId` is read as `0`, whatever else it says about
 * itself: a browser always supplies the field, so an event without one was
 * dispatched by hand, and the id is the one thing a hand-dispatched event has
 * no way of implying. Reading `isPrimary` as a second id instead would invent a
 * pointer the dispatcher never named, and a suite driving two contacts says
 * which two by giving each a `pointerId` — which is what the field is for.
 */
function pointerId(event: Event): number {
  const candidate = event as Partial<PointerEvent>;
  if (typeof candidate.pointerId === "number") return candidate.pointerId;
  return 0;
}

/** The device `pointerType` names, defaulting to a mouse. */
function namedDevice(pointerType: string | undefined): PointerDevice {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return "mouse";
}

/**
 * The button `PointerEvent.button` names, or `null` when it names none.
 *
 * A move reports `-1`, which is the field saying the event is about position
 * rather than about a button.
 */
function namedButton(button: number | undefined): PointerButton | null {
  if (typeof button !== "number") return null;
  return BUTTON_INDEX[button] ?? null;
}

/**
 * The buttons `PointerEvent.buttons` reports as held, or `null` when the event
 * carried no mask and each listener must decide what its absence means.
 */
function heldButtons(buttons: number | undefined): PointerButton[] | null {
  if (typeof buttons !== "number") return null;
  return BUTTON_ORDER.filter((name) => (buttons & BUTTON_BITS[name]) !== 0);
}

/** `held` with `button` added, keeping the declared order. */
function withButton(
  held: readonly PointerButton[],
  button: PointerButton,
): PointerButton[] {
  if (held.includes(button)) return [...held];
  return BUTTON_ORDER.filter((name) => name === button || held.includes(name));
}

/** `held` with `button` removed, or emptied when the release named none. */
function withoutButton(
  held: readonly PointerButton[],
  button: PointerButton | null,
): PointerButton[] {
  if (button === null) return [];
  return held.filter((name) => name !== button);
}
