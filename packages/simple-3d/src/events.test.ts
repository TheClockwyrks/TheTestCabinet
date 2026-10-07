import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEventMap, EngineEvents, Vec3 } from "./contract";
import { EventBus } from "./events";

/**
 * A `cue:played` payload, so a test can name one without restating the shape.
 *
 * `at` defaults to `null` — the unpositioned cue — because most of what this suite
 * asserts is about dispatch rather than about the payload, and a positioned cue is
 * the interesting case only where the test says so.
 */
function cue(
  name: string,
  t = 0,
  gain = 1,
  at: Vec3 | null = null,
): EngineEventMap["cue:played"] {
  return { cue: name, t, gain, at };
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
    const seen: EngineEventMap["cue:played"][] = [];
    bus.on("cue:played", (payload) => seen.push(payload));

    bus.emit("cue:played", cue("clank", 1560, 0.4));

    expect(seen).toEqual([{ cue: "clank", t: 1560, gain: 0.4, at: null }]);
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
      path: "models/ship.glb",
      url: "assets/models/ship.glb",
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

  it("returns a function", () => {
    const bus = new EventBus();

    expect(typeof bus.on("audio:unlocked", vi.fn())).toBe("function");
  });

  it("is the whole of what a game or a validator is handed", () => {
    // The narrowed view is what stops a game emitting engine events of its own
    // invention: `emit` and `clear` are reachable from the class, not from this.
    const events: EngineEvents = new EventBus();
    const handler = vi.fn();

    const off = events.on("cue:stopped", handler);
    off();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("the documented event map", () => {
  it("carries every event the engine broadcasts, and their payloads", () => {
    const bus = new EventBus();
    const seen: [keyof EngineEventMap, unknown][] = [];

    // One subscription per name in the map, so a name added to or removed from the
    // contract shows up here rather than only in the subsystem that emits it.
    bus.on("asset:loaded", (p) => seen.push(["asset:loaded", p]));
    bus.on("asset:failed", (p) => seen.push(["asset:failed", p]));
    bus.on("cue:played", (p) => seen.push(["cue:played", p]));
    bus.on("cue:looped", (p) => seen.push(["cue:looped", p]));
    bus.on("cue:stopped", (p) => seen.push(["cue:stopped", p]));
    bus.on("audio:unlocked", (p) => seen.push(["audio:unlocked", p]));

    bus.emit("asset:loaded", {
      path: "models/ship.glb",
      url: "assets/models/ship.glb",
    });
    bus.emit("asset:failed", {
      path: "../secrets.txt",
      url: "",
      reason: "a .. segment",
    });
    bus.emit("cue:played", cue("clank", 100, 0.2, { x: 1, y: 2, z: 3 }));
    bus.emit("cue:looped", { cue: "motor", t: 200, gain: 1, at: null });
    bus.emit("cue:stopped", { cue: "motor", t: 300 });
    bus.emit("audio:unlocked", {});

    expect(seen).toEqual([
      [
        "asset:loaded",
        { path: "models/ship.glb", url: "assets/models/ship.glb" },
      ],
      [
        "asset:failed",
        { path: "../secrets.txt", url: "", reason: "a .. segment" },
      ],
      [
        "cue:played",
        { cue: "clank", t: 100, gain: 0.2, at: { x: 1, y: 2, z: 3 } },
      ],
      ["cue:looped", { cue: "motor", t: 200, gain: 1, at: null }],
      ["cue:stopped", { cue: "motor", t: 300 }],
      ["audio:unlocked", {}],
    ]);
  });

  it("delivers a positioned cue's world point unchanged", () => {
    const bus = new EventBus();
    const at: Vec3 = { x: -4.5, y: 0.25, z: 12 };
    let seen: Vec3 | null | undefined;
    bus.on("cue:played", (payload) => {
      seen = payload.at;
    });

    bus.emit("cue:played", cue("clank", 0, 0.2, at));

    // A validator reads `at` to claim the sound came from where the object is, so
    // the bus must not round, replace, or drop the vector on the way through.
    expect(seen).toEqual({ x: -4.5, y: 0.25, z: 12 });
  });

  it("delivers `at: null` for an unpositioned cue", () => {
    const bus = new EventBus();
    let seen: Vec3 | null | undefined;
    bus.on("cue:looped", (payload) => {
      seen = payload.at;
    });

    bus.emit("cue:looped", { cue: "hum", t: 0, gain: 1, at: null });

    // `null` is the documented value, and it is what distinguishes a cue played
    // nowhere from one played at the world origin.
    expect(seen).toBeNull();
  });

  it("hands the payload on by reference rather than copying it", () => {
    const bus = new EventBus();
    const payload = cue("clank", 0, 0.2, { x: 1, y: 2, z: 3 });
    let seen: EngineEventMap["cue:played"] | undefined;
    bus.on("cue:played", (p) => {
      seen = p;
    });

    bus.emit("cue:played", payload);

    // Copying `at` is the audio bus's job, at the moment of the emit, because only
    // it knows whether the vector it holds is one a later `place` will overwrite.
    // The broadcaster copies nothing, which is what keeps that decision there.
    expect(seen).toBe(payload);
  });

  it("gives every subscriber the same payload object", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on("asset:failed", (p) => seen.push(p));
    bus.on("asset:failed", (p) => seen.push(p));

    bus.emit("asset:failed", {
      path: "a.glb",
      url: "assets/a.glb",
      reason: "404",
    });

    expect(seen[0]).toBe(seen[1]);
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

  it("leaves the other events' subscriptions alone", () => {
    const bus = new EventBus();
    const looped = vi.fn();
    const off = bus.on("cue:played", vi.fn());
    bus.on("cue:looped", looped);

    off();
    bus.emit("cue:looped", { cue: "motor", t: 0, gain: 1, at: null });

    expect(looped).toHaveBeenCalledTimes(1);
  });

  it("collects one window of cues when a check subscribes around an act", () => {
    // The shape validators/input-and-audio.md writes: subscribe, advance, drop the
    // subscription, assert on what the window held.
    const bus = new EventBus();
    const cues: string[] = [];

    bus.emit("cue:played", cue("before"));
    const off = bus.on("cue:played", ({ cue: name }) => cues.push(name));
    bus.emit("cue:played", cue("clank"));
    bus.emit("cue:played", cue("thud"));
    off();
    bus.emit("cue:played", cue("after"));

    expect(cues).toEqual(["clank", "thud"]);
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

    bus.emit("cue:played", cue("clank"));

    expect(after).toHaveBeenCalledTimes(1);
  });

  it("reaches the console, naming the event and carrying the cause", () => {
    const bus = new EventBus();
    const cause = new Error("subscriber bug");
    bus.on("cue:played", () => {
      throw cause;
    });

    bus.emit("cue:played", cue("clank"));

    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0])).toContain("cue:played");
    expect(errors[0]?.[1]).toBe(cause);
  });

  it("is reported under the engine's own name", () => {
    const bus = new EventBus();
    bus.on("asset:failed", () => {
      throw new Error("subscriber bug");
    });

    bus.emit("asset:failed", {
      path: "a.glb",
      url: "assets/a.glb",
      reason: "404",
    });

    // A build runs several packages' code in one console; the prefix is how a
    // reader knows which one reported.
    expect(String(errors[0]?.[0])).toContain("simple-3d");
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

  it("does not cost a nested emit its own dispatch", () => {
    const bus = new EventBus();
    const inner = vi.fn();
    bus.on("cue:stopped", inner);
    bus.on("cue:played", () => {
      bus.emit("cue:stopped", { cue: "motor", t: 0 });
      throw new Error("after the nested emit");
    });

    bus.emit("cue:played", cue("clank"));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
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

  it("dispatches a nested emit of another event before resuming", () => {
    // The shape a real subsystem produces: an `asset:failed` handler that reacts by
    // playing an alarm cue, which broadcasts from inside the first dispatch.
    const bus = new EventBus();
    const order: string[] = [];
    bus.on("asset:failed", () => {
      order.push("failed");
      bus.emit("cue:played", cue("alarm"));
      order.push("failed-done");
    });
    bus.on("cue:played", ({ cue: name }) => order.push(`played:${name}`));

    bus.emit("asset:failed", {
      path: "a.glb",
      url: "assets/a.glb",
      reason: "404",
    });

    expect(order).toEqual(["failed", "played:alarm", "failed-done"]);
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
    bus.emit("cue:played", cue("clank"));
    bus.emit("asset:loaded", { path: "a.glb", url: "assets/a.glb" });

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

    bus.emit("cue:played", cue("clank"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("retains nothing per event emitted", () => {
    const bus = new EventBus();
    let calls = 0;
    bus.on("cue:played", () => {
      calls += 1;
    });

    for (let i = 0; i < 20_000; i++) bus.emit("cue:played", cue("clank", i));

    // One call per emit, not a total that grew with the emits already made — which
    // is what a bus that appended the payload to a record and replayed it would do.
    expect(calls).toBe(20_000);
  });
});
