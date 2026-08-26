import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./events";

/**
 * The broadcaster's own semantics: subscription order, snapshot dispatch,
 * idempotent unsubscribe, contained throws, and `clear`. The engine-side
 * suites assert that subsystems emit the right events at the right moments;
 * this suite owns how any emit behaves once it happens. The tiny map below
 * stands in for an engine's event map, because the bus is generic and the
 * semantics do not depend on which map it carries.
 */

/** A stand-in event map with two payload shapes, enough to prove the typing. */
interface TestEventMap extends Record<string, unknown> {
  "cue:played": { cue: string; t: number };
  "audio:unlocked": Record<string, never>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subscription", () => {
  it("delivers a payload synchronously, in subscription order", () => {
    const bus = new EventBus<TestEventMap>("test");
    const order: string[] = [];
    bus.on("cue:played", ({ cue }) => order.push(`first:${cue}`));
    bus.on("cue:played", ({ cue }) => order.push(`second:${cue}`));

    bus.emit("cue:played", { cue: "bounce", t: 16 });
    // Both ran before emit returned: nothing was deferred to a microtask.
    expect(order).toEqual(["first:bounce", "second:bounce"]);
  });

  it("returns an unsubscriber that removes the handler", () => {
    const bus = new EventBus<TestEventMap>("test");
    const seen: number[] = [];
    const off = bus.on("cue:played", ({ t }) => seen.push(t));

    bus.emit("cue:played", { cue: "a", t: 1 });
    off();
    bus.emit("cue:played", { cue: "a", t: 2 });
    expect(seen).toEqual([1]);
  });

  it("unsubscribes idempotently, so a second call does not remove a stranger", () => {
    const bus = new EventBus<TestEventMap>("test");
    const seen: string[] = [];
    const off = bus.on("cue:played", () => seen.push("first"));
    off();
    // A later subscriber occupies the bin; the stale unsubscriber must not touch it.
    bus.on("cue:played", () => seen.push("second"));
    off();

    bus.emit("cue:played", { cue: "a", t: 0 });
    expect(seen).toEqual(["second"]);
  });

  it("lets one function subscribe twice, and removes one copy per unsubscribe", () => {
    const bus = new EventBus<TestEventMap>("test");
    let calls = 0;
    const handler = (): void => {
      calls += 1;
    };
    bus.on("audio:unlocked", handler);
    const offSecond = bus.on("audio:unlocked", handler);

    bus.emit("audio:unlocked", {});
    expect(calls).toBe(2);

    offSecond();
    bus.emit("audio:unlocked", {});
    expect(calls).toBe(3);
  });
});

describe("dispatch", () => {
  it("walks a snapshot: a handler subscribed during dispatch misses the event that added it", () => {
    const bus = new EventBus<TestEventMap>("test");
    const seen: string[] = [];
    bus.on("cue:played", () => {
      seen.push("outer");
      bus.on("cue:played", () => seen.push("added"));
    });

    bus.emit("cue:played", { cue: "a", t: 0 });
    expect(seen).toEqual(["outer"]);

    bus.emit("cue:played", { cue: "a", t: 1 });
    expect(seen).toEqual(["outer", "outer", "added"]);
  });

  it("walks a snapshot: a handler removed during dispatch still receives the in-flight event", () => {
    const bus = new EventBus<TestEventMap>("test");
    const seen: string[] = [];
    const offSecond = bus.on("cue:played", () => {
      seen.push("first");
      offLater();
    });
    const offLater = bus.on("cue:played", () => seen.push("second"));
    void offSecond;

    bus.emit("cue:played", { cue: "a", t: 0 });
    // The removal lands for the next emit, not the one already dispatching.
    expect(seen).toEqual(["first", "second"]);

    bus.emit("cue:played", { cue: "a", t: 1 });
    expect(seen).toEqual(["first", "second", "first"]);
  });

  it("contains a throwing handler: the error reaches the console and the rest still run", () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = new EventBus<TestEventMap>("engine-under-test");
    const seen: string[] = [];
    bus.on("cue:played", () => {
      throw new Error("a subscriber bug");
    });
    bus.on("cue:played", () => seen.push("after"));

    expect(() => bus.emit("cue:played", { cue: "a", t: 0 })).not.toThrow();
    expect(seen).toEqual(["after"]);
    expect(reported).toHaveBeenCalledTimes(1);
    // The report names the engine through the constructor label and the event,
    // in the exact wording the 2D engines' buses use.
    expect(reported.mock.calls[0]?.[0]).toBe(
      'engine-under-test: an "cue:played" handler threw',
    );
  });

  it("emits to nobody without complaint", () => {
    const bus = new EventBus<TestEventMap>("test");
    expect(() => bus.emit("audio:unlocked", {})).not.toThrow();
  });
});

describe("clear", () => {
  it("drops every subscription, which is what destroy() relies on", () => {
    const bus = new EventBus<TestEventMap>("test");
    let calls = 0;
    bus.on("cue:played", () => {
      calls += 1;
    });
    bus.on("audio:unlocked", () => {
      calls += 1;
    });

    bus.clear();
    bus.emit("cue:played", { cue: "a", t: 0 });
    bus.emit("audio:unlocked", {});
    expect(calls).toBe(0);
  });
});
