import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./events";

/** A `cue:played` payload, so a test can name one without restating the shape. */
function cue(
  name: string,
  t = 0,
  gain = 1,
): { cue: string; t: number; gain: number } {
  return { cue: name, t, gain };
}

/**
 * The console is where a throwing handler's error is required to land, so it is
 * silenced and recorded for every test rather than only the ones that provoke one —
 * an unexpected report then shows up as a non-empty spy instead of as noise in the
 * suite's output.
 */
let errors: unknown[][];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EventBus.on", () => {
  it("delivers the payload to a subscriber", () => {
    const bus = new EventBus();
    const seen: { cue: string; t: number; gain: number }[] = [];
    bus.on("cue:played", (payload) => seen.push(payload));

    bus.emit("cue:played", cue("bounce", 1560, 0.4));

    expect(seen).toEqual([{ cue: "bounce", t: 1560, gain: 0.4 }]);
  });

  it("calls handlers in subscription order", () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on("audio:unlocked", () => order.push("first"));
    bus.on("audio:unlocked", () => order.push("second"));
    bus.on("audio:unlocked", () => order.push("third"));

    bus.emit("audio:unlocked", {});

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("calls handlers before emit returns", () => {
    const bus = new EventBus();
    let called = false;
    bus.on("audio:unlocked", () => {
      called = true;
    });

    bus.emit("audio:unlocked", {});

    // No `await`, no flush: a subscriber must be able to attribute the event to the
    // frame that emitted it.
    expect(called).toBe(true);
  });

  it("keeps each event's subscribers to itself", () => {
    const bus = new EventBus();
    const loaded = vi.fn();
    const failed = vi.fn();
    bus.on("asset:loaded", loaded);
    bus.on("asset:failed", failed);

    bus.emit("asset:loaded", {
      path: "sprites/ship.png",
      url: "assets/sprites/ship.png",
    });

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("calls a handler subscribed twice once per subscription", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("audio:unlocked", handler);
    bus.on("audio:unlocked", handler);

    bus.emit("audio:unlocked", {});

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("the unsubscribe function", () => {
  it("removes the handler", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on("audio:unlocked", handler);

    off();
    bus.emit("audio:unlocked", {});

    expect(handler).not.toHaveBeenCalled();
  });

  it("is safe to call twice", () => {
    const bus = new EventBus();
    const off = bus.on("audio:unlocked", vi.fn());

    off();
    expect(() => off()).not.toThrow();
  });

  it("does not remove a stranger when called twice", () => {
    const bus = new EventBus();
    const first = vi.fn();
    const second = vi.fn();
    const off = bus.on("audio:unlocked", first);
    off();

    // Registered into the slot the first one vacated; the redundant unsubscribe
    // must not take it down with it.
    bus.on("audio:unlocked", second);
    off();
    bus.emit("audio:unlocked", {});

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes one of two identical subscriptions, not both", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on("audio:unlocked", handler);
    bus.on("audio:unlocked", handler);

    off();
    bus.emit("audio:unlocked", {});

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("leaves the surviving handlers in order", () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on("audio:unlocked", () => order.push("a"));
    const off = bus.on("audio:unlocked", () => order.push("b"));
    bus.on("audio:unlocked", () => order.push("c"));

    off();
    bus.emit("audio:unlocked", {});

    expect(order).toEqual(["a", "c"]);
  });
});

describe("EventBus.emit", () => {
  it("does nothing when nothing is subscribed", () => {
    const bus = new EventBus();

    expect(() => bus.emit("audio:unlocked", {})).not.toThrow();
    expect(errors).toEqual([]);
  });

  it("does nothing when every subscriber has unsubscribed", () => {
    const bus = new EventBus();
    const off = bus.on("audio:unlocked", vi.fn());
    off();

    expect(() => bus.emit("audio:unlocked", {})).not.toThrow();
  });
});

describe("a handler that throws", () => {
  it("does not reach the emitting subsystem", () => {
    const bus = new EventBus();
    bus.on("audio:unlocked", () => {
      throw new Error("subscriber bug");
    });

    expect(() => bus.emit("audio:unlocked", {})).not.toThrow();
  });

  it("does not stop the handlers after it", () => {
    const bus = new EventBus();
    const after = vi.fn();
    bus.on("cue:played", () => {
      throw new Error("subscriber bug");
    });
    bus.on("cue:played", after);

    bus.emit("cue:played", cue("blip"));

    expect(after).toHaveBeenCalledTimes(1);
  });

  it("reaches the console, naming the event and carrying the cause", () => {
    const bus = new EventBus();
    const cause = new Error("subscriber bug");
    bus.on("cue:played", () => {
      throw cause;
    });

    bus.emit("cue:played", cue("blip"));

    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0])).toContain("cue:played");
    expect(errors[0]?.[1]).toBe(cause);
  });

  it("is reported once per throwing handler", () => {
    const bus = new EventBus();
    bus.on("audio:unlocked", () => {
      throw new Error("one");
    });
    bus.on("audio:unlocked", () => {
      throw new Error("two");
    });

    bus.emit("audio:unlocked", {});

    expect(errors).toHaveLength(2);
  });

  it("is contained whatever it threw", () => {
    const bus = new EventBus();
    const after = vi.fn();
    bus.on("audio:unlocked", () => {
      // Not an `Error`, which a naive `error.message` would then throw on.
      throw "a string";
    });
    bus.on("audio:unlocked", after);

    expect(() => bus.emit("audio:unlocked", {})).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  it("still receives later events", () => {
    const bus = new EventBus();
    let calls = 0;
    bus.on("audio:unlocked", () => {
      calls += 1;
      throw new Error("every time");
    });

    bus.emit("audio:unlocked", {});
    bus.emit("audio:unlocked", {});

    expect(calls).toBe(2);
  });
});

describe("mutating the bus from inside a handler", () => {
  it("does not deliver the in-flight event to a handler subscribed during it", () => {
    const bus = new EventBus();
    const late = vi.fn();
    bus.on("audio:unlocked", () => {
      bus.on("audio:unlocked", late);
    });

    bus.emit("audio:unlocked", {});

    expect(late).not.toHaveBeenCalled();
  });

  it("delivers the next event to a handler subscribed during a dispatch", () => {
    const bus = new EventBus();
    const late = vi.fn();
    const off = bus.on("audio:unlocked", () => {
      bus.on("audio:unlocked", late);
    });

    bus.emit("audio:unlocked", {});
    off();
    bus.emit("audio:unlocked", {});

    expect(late).toHaveBeenCalledTimes(1);
  });

  it("still delivers the in-flight event to a handler unsubscribed during it", () => {
    const bus = new EventBus();
    const second = vi.fn();
    let off = (): void => {};
    bus.on("audio:unlocked", () => off());
    off = bus.on("audio:unlocked", second);

    bus.emit("audio:unlocked", {});

    // The snapshot is what makes this predictable: whether a subscriber sees an
    // event in flight must not depend on where it happens to sit in the order.
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not deliver later events to a handler unsubscribed during a dispatch", () => {
    const bus = new EventBus();
    const second = vi.fn();
    let off = (): void => {};
    bus.on("audio:unlocked", () => off());
    off = bus.on("audio:unlocked", second);

    bus.emit("audio:unlocked", {});
    bus.emit("audio:unlocked", {});

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("lets a handler unsubscribe itself", () => {
    const bus = new EventBus();
    const handler = vi.fn(() => off());
    const off = bus.on("audio:unlocked", handler);

    bus.emit("audio:unlocked", {});
    bus.emit("audio:unlocked", {});

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("finishes the in-flight dispatch when a handler clears the bus", () => {
    const bus = new EventBus();
    const after = vi.fn();
    bus.on("audio:unlocked", () => bus.clear());
    bus.on("audio:unlocked", after);

    bus.emit("audio:unlocked", {});
    bus.emit("audio:unlocked", {});

    expect(after).toHaveBeenCalledTimes(1);
  });

  it("dispatches a nested emit fully before resuming the outer one", () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on("cue:played", ({ cue: name }) => {
      order.push(`outer:${name}`);
      if (name === "first") bus.emit("cue:played", cue("nested"));
      order.push(`outer-done:${name}`);
    });
    bus.on("cue:played", ({ cue: name }) => order.push(`second:${name}`));

    bus.emit("cue:played", cue("first"));

    expect(order).toEqual([
      "outer:first",
      "outer:nested",
      "outer-done:nested",
      "second:nested",
      "outer-done:first",
      "second:first",
    ]);
  });
});

describe("EventBus.clear", () => {
  it("drops every subscription, across every event", () => {
    const bus = new EventBus();
    const played = vi.fn();
    const loaded = vi.fn();
    bus.on("cue:played", played);
    bus.on("asset:loaded", loaded);

    bus.clear();
    bus.emit("cue:played", cue("blip"));
    bus.emit("asset:loaded", { path: "a.png", url: "assets/a.png" });

    expect(played).not.toHaveBeenCalled();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("leaves the bus usable", () => {
    const bus = new EventBus();
    bus.clear();
    const handler = vi.fn();
    bus.on("audio:unlocked", handler);

    bus.emit("audio:unlocked", {});

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("leaves an unsubscribe from before it safe to call", () => {
    const bus = new EventBus();
    const off = bus.on("audio:unlocked", vi.fn());
    bus.clear();

    expect(() => off()).not.toThrow();
  });

  it("does not take down a subscription made after it", () => {
    const bus = new EventBus();
    const off = bus.on("audio:unlocked", vi.fn());
    bus.clear();
    const handler = vi.fn();
    bus.on("audio:unlocked", handler);

    off();
    bus.emit("audio:unlocked", {});

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("is safe with nothing subscribed", () => {
    const bus = new EventBus();

    expect(() => bus.clear()).not.toThrow();
  });
});

describe("boundedness", () => {
  it("retains nothing across a long run of subscribe and unsubscribe", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    // The shape a validator's per-window subscription takes, repeated far past any
    // frame count a test would use. Anything the bus kept per cycle would show up
    // here as a handler called more than once.
    for (let i = 0; i < 20_000; i++) {
      const off = bus.on("cue:played", handler);
      off();
    }

    bus.emit("cue:played", cue("blip"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("retains nothing per event emitted", () => {
    const bus = new EventBus();
    let calls = 0;
    bus.on("cue:played", () => {
      calls += 1;
    });

    for (let i = 0; i < 20_000; i++) bus.emit("cue:played", cue("blip", i));

    // One call per emit, not a total that grew with the emits already made — which
    // is what a bus that appended the payload to a record and replayed it would do.
    expect(calls).toBe(20_000);
  });
});
