import { describe, expect, it, vi } from "vitest";
import { EngineEventBus } from "./events";
import type {
  EngineEventEmitter,
  EngineEventMap,
  EngineEvents,
} from "./events";

/**
 * The engine's broadcaster: the one channel a subsystem reports through and the
 * one place a caller watches it from.
 *
 * The claims here are all about *dispatch discipline* rather than about which
 * events exist, because the events themselves are emitted by the subsystems and
 * pinned in their own suites. What this suite has to establish is that a
 * subscriber can trust the stream: that a handler runs inside the frame the
 * event belongs to, that it can subscribe and unsubscribe from inside a handler
 * without disturbing the dispatch in flight, that unsubscribing twice does not
 * unsubscribe a stranger, and that one throwing handler does not cost the other
 * subscribers the event or the emitting subsystem its work.
 */

/** A `world:opened` payload, the suite's usual subject. */
function opened(level: string): EngineEventMap["world:opened"] {
  return { level };
}

describe("subscribing", () => {
  it("delivers the payload to a handler", () => {
    const bus = new EngineEventBus();
    const seen: string[] = [];
    bus.on("world:opened", (payload) => seen.push(payload.level));

    bus.emit("world:opened", opened("arena"));

    expect(seen).toEqual(["arena"]);
  });

  it("delivers synchronously, before the emit returns", () => {
    // The property the whole stream rests on: a subscriber attributes an event
    // to the frame it fired in, which a microtask would make impossible.
    const bus = new EngineEventBus();
    const order: string[] = [];
    bus.on("world:opened", () => order.push("handler"));

    bus.emit("world:opened", opened("arena"));
    order.push("after");

    expect(order).toEqual(["handler", "after"]);
  });

  it("delivers to every handler in subscription order", () => {
    const bus = new EngineEventBus();
    const order: number[] = [];
    bus.on("world:opened", () => order.push(1));
    bus.on("world:opened", () => order.push(2));
    bus.on("world:opened", () => order.push(3));

    bus.emit("world:opened", opened("arena"));

    expect(order).toEqual([1, 2, 3]);
  });

  it("keeps the events apart", () => {
    const bus = new EngineEventBus();
    const closed: string[] = [];
    bus.on("world:closed", (payload) => closed.push(payload.level));

    bus.emit("world:opened", opened("arena"));

    expect(closed).toEqual([]);
  });

  it("emits to nobody without complaint", () => {
    const bus = new EngineEventBus();

    expect(() => bus.emit("world:opened", opened("arena"))).not.toThrow();
  });

  it("delivers to the same function subscribed twice, twice", () => {
    // Two independent observers sharing one helper is a legitimate thing to do,
    // and is why the bins are arrays rather than sets.
    const bus = new EngineEventBus();
    const handler = vi.fn();
    bus.on("world:opened", handler);
    bus.on("world:opened", handler);

    bus.emit("world:opened", opened("arena"));

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("unsubscribing", () => {
  it("stops delivery from the next emit", () => {
    const bus = new EngineEventBus();
    const handler = vi.fn();
    const off = bus.on("world:opened", handler);

    bus.emit("world:opened", opened("one"));
    off();
    bus.emit("world:opened", opened("two"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("is idempotent, so a teardown that runs twice removes one subscriber", () => {
    // Were it not, the second call would find the slot reoccupied by whatever
    // subscribed after it and silently unsubscribe a stranger.
    const bus = new EngineEventBus();
    const first = vi.fn();
    const off = bus.on("world:opened", first);
    off();

    const second = vi.fn();
    bus.on("world:opened", second);
    off();
    bus.emit("world:opened", opened("arena"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes one of two identical subscriptions, not both", () => {
    const bus = new EngineEventBus();
    const handler = vi.fn();
    const off = bus.on("world:opened", handler);
    bus.on("world:opened", handler);

    off();
    bus.emit("world:opened", opened("arena"));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("a dispatch in flight", () => {
  it("does not deliver to a handler subscribed during it", () => {
    const bus = new EngineEventBus();
    const late = vi.fn();
    bus.on("world:opened", () => bus.on("world:opened", late));

    bus.emit("world:opened", opened("one"));

    expect(late).not.toHaveBeenCalled();

    bus.emit("world:opened", opened("two"));
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("still delivers to a handler unsubscribed during it", () => {
    const bus = new EngineEventBus();
    const second = vi.fn();
    let dropSecond = (): void => {};
    bus.on("world:opened", () => dropSecond());
    dropSecond = bus.on("world:opened", second);

    bus.emit("world:opened", opened("one"));
    bus.emit("world:opened", opened("two"));

    // Removed by the handler ahead of it, and still delivered this dispatch.
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("survives a handler that removes itself", () => {
    const bus = new EngineEventBus();
    const once = vi.fn();
    const off = bus.on("world:opened", (payload) => {
      once(payload.level);
      off();
    });

    bus.emit("world:opened", opened("one"));
    bus.emit("world:opened", opened("two"));

    expect(once).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith("one");
  });

  it("completes a nested emit before the outer dispatch resumes", () => {
    const bus = new EngineEventBus();
    const order: string[] = [];
    bus.on("world:opening", () => {
      order.push("opening:start");
      bus.emit("world:opened", opened("arena"));
      order.push("opening:end");
    });
    bus.on("world:opened", () => order.push("opened"));

    bus.emit("world:opening", { from: null, to: "arena" });

    expect(order).toEqual(["opening:start", "opened", "opening:end"]);
  });
});

describe("a throwing handler", () => {
  it("does not cost the remaining handlers the event", () => {
    // The emitter is a subsystem mid-frame, emitting as the last step of work
    // it has already committed to: a subscriber's bug must not become the audio
    // bus's failure to play a cue.
    const bus = new EngineEventBus();
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    bus.on("world:opened", () => {
      throw new Error("subscriber bug");
    });
    bus.on("world:opened", after);

    expect(() => bus.emit("world:opened", opened("arena"))).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    console_.mockRestore();
  });

  it("is reported rather than swallowed, naming the event", () => {
    const bus = new EngineEventBus();
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("subscriber bug");
    bus.on("cue:played", () => {
      throw cause;
    });

    bus.emit("cue:played", { cue: "kick", t: 0, gain: 1, at: null });

    expect(console_).toHaveBeenCalledWith(
      'structured-3d: an "cue:played" handler threw',
      cause,
    );
    console_.mockRestore();
  });
});

describe("clear", () => {
  it("drops every subscription across every event", () => {
    // `engine.destroy()` calls it: a handler closes over the caller's own scene,
    // and leaving the bus subscribed lets a stale one observe a successor.
    const bus = new EngineEventBus();
    const openedHandler = vi.fn();
    const spawned = vi.fn();
    bus.on("world:opened", openedHandler);
    bus.on("actor:spawned", spawned);

    bus.clear();
    bus.emit("world:opened", opened("arena"));

    expect(openedHandler).not.toHaveBeenCalled();
    expect(spawned).not.toHaveBeenCalled();
  });

  it("leaves the bus usable", () => {
    const bus = new EngineEventBus();
    bus.clear();
    const handler = vi.fn();
    bus.on("world:opened", handler);

    bus.emit("world:opened", opened("arena"));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("the emitting half", () => {
  it("is unreachable through the type a game is handed", () => {
    // `EngineEvents` declares only `on`, which is what stops a game from
    // broadcasting engine events of its own invention. The claim is a
    // compile-time one, so it is stated as one: the suppression below is an
    // error if the narrow type ever grows an `emit`.
    const bus = new EngineEventBus();
    const events: EngineEvents = bus;

    // @ts-expect-error `EngineEvents` declares `on` and nothing else.
    expect(events.emit).toBeDefined();
    expect(typeof events.on).toBe("function");
  });

  it("satisfies a subsystem's narrower single-event seam", () => {
    // The game mode, the possession machinery, and the collision pass each
    // declare an emitter over the one entry they use; the engine hands each the
    // same generic bus, and this is the assignability that lets it.
    const bus = new EngineEventBus();
    const emit: EngineEventEmitter = (event, payload) =>
      bus.emit(event, payload);
    const narrow: {
      emit(event: "match:phase", payload: EngineEventMap["match:phase"]): void;
    } = { emit };
    const seen: string[] = [];
    bus.on("match:phase", (payload) => seen.push(payload.phase));

    narrow.emit("match:phase", { phase: "playing", previous: "waiting" });

    expect(seen).toEqual(["playing"]);
  });
});
