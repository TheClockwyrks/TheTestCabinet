// The three driver strategies, and the state model each of them answers.
//
// A case does not pick one of these; its engine's state model does. What these
// checks pin is that each strategy really does what its name says — and, for the
// apply-threaded one, that a pose reaches `apply` and a reading does not, which
// is the distinction nothing about a pure surface makes at run time.

import { expect, it } from "vitest";
import {
  applyDriver,
  identityDriver,
  promiseDriver,
  type ApplyEngine,
  type PureDriver,
} from "../src/engine/driver";
import { absentSurface } from "../src/engine/surface";

/* ---- identity -------------------------------------------------------------- */

it("the identity driver is the surface itself", () => {
  const raw = { reset: () => undefined, version: 2 };
  expect(identityDriver(raw)).toBe(raw);
});

/* ---- promise-wrap ---------------------------------------------------------- */

interface Imperative {
  setScreen(name: string): void;
  snapshot(): { screen: string };
  version: number;
}

it("the promise driver answers a promise for every call, and the raw value for the rest", async () => {
  let screen = "title";
  const raw: Imperative = {
    setScreen: (name) => {
      screen = name;
    },
    snapshot: () => ({ screen }),
    version: 3,
  };
  const driver = promiseDriver<Imperative>(raw);
  expect(driver.version).toBe(3);

  const posed = driver.setScreen("select");
  expect(posed).toBeInstanceOf(Promise);
  await posed;
  await expect(driver.snapshot()).resolves.toEqual({ screen: "select" });
});

it("the promise driver calls the member on the raw surface, not on the proxy", async () => {
  const raw = {
    marker: "raw" as string,
    read(this: { marker: string }): string {
      return this.marker;
    },
  };
  await expect(promiseDriver<typeof raw>(raw).read()).resolves.toBe("raw");
});

/* ---- apply-threaded -------------------------------------------------------- */

interface State {
  screen: string;
  seed: number;
}

interface PureSurface {
  setScreen(state: Readonly<State>, name: string): State;
  reset(state: Readonly<State>, seed: number): State;
  snapshot(state: Readonly<State>): { screen: string; seed: number };
  /**
   * A reading that takes an argument past the state, which ten cases ship —
   * `menuItemRect(index)` in eight of them. See the spec below it pins.
   */
  menuItemRect(
    state: Readonly<State>,
    index: number,
  ): { x: number; index: number };
  version: number;
}

function engineOver(initial: State): ApplyEngine<Readonly<State>, State> & {
  applied: number;
} {
  let held = initial;
  let applied = 0;
  return {
    get state() {
      return held;
    },
    get applied() {
      return applied;
    },
    apply(transition) {
      applied += 1;
      held = transition(held);
      return held;
    },
  };
}

const RAW: PureSurface = {
  setScreen: (state, name) => ({ ...state, screen: name }),
  reset: (state, seed) => ({ ...state, seed }),
  snapshot: (state) => ({ screen: state.screen, seed: state.seed }),
  menuItemRect: (_state, index) => ({ x: index * 10, index }),
  version: 4,
};

type Driver = PureDriver<Readonly<State>, State, PureSurface>;

it("a reading is handed the state and answers what the surface answered", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, RAW, {
    readings: ["snapshot"],
  });
  expect(driver.snapshot()).toEqual({ screen: "title", seed: 1 });
  expect(engine.applied).toBe(0);
});

it("a pose runs through apply, so the next frame sees what it returned", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, RAW, {
    readings: ["snapshot"],
  });
  driver.setScreen("select");
  driver.reset(9);
  expect(engine.applied).toBe(2);
  expect(driver.snapshot()).toEqual({ screen: "select", seed: 9 });
});

it("a pose answers nothing, because the runtime holds what it returned", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, RAW, {
    readings: ["snapshot"],
  });
  expect(driver.setScreen("select")).toBeUndefined();
});

it("a projection narrows the named reading and leaves the others alone", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const seen: string[] = [];
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, RAW, {
    readings: ["snapshot"],
    project: (op, value) => {
      seen.push(op);
      return op === "snapshot"
        ? { ...(value as object), narrowed: true }
        : value;
    },
  });
  expect(driver.snapshot()).toEqual({
    screen: "title",
    seed: 1,
    narrowed: true,
  });
  expect(seen).toEqual(["snapshot"]);
});

it("a member that is not a function comes back as it is, so typeof can probe it", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const partial = { snapshot: RAW.snapshot, version: 4 };
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, partial, {
    readings: ["snapshot"],
  });
  expect(driver.version).toBe(4);
  // The operation the build left out: `undefined`, not a stand-in that would
  // read as present.
  expect(typeof driver.setScreen).toBe("undefined");
});

it("the machinery's own probes are answered without touching the surface", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const driver = applyDriver<Readonly<State>, State, Record<string, unknown>>(
    engine,
    RAW,
    { readings: ["snapshot"] },
  );
  expect(driver.then).toBeUndefined();
  expect(driver.constructor).toBeUndefined();
});

it("every driver is LAZY, so a missing surface fails the check and not the hook", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const absent = absentSurface<PureSurface>("the surface", "none returned");
  // Building the driver must not touch the surface at all.
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, absent, {
    readings: ["snapshot"],
  });
  expect(() => driver.snapshot).toThrow(/none returned/);
});

/**
 * A READING'S ARGUMENTS REACH THE SURFACE, and this is the check that says so.
 *
 * The driver's reading arm used to call `op(engine.state)` and forward nothing
 * else, so `menuItemRect(2)` asked the build about item ZERO. Nothing threw: a
 * rectangle came back, for the wrong item, and the check decided its point off
 * it. Ten cases ship a reading of this shape — `menuItemRect(index)` in eight,
 * plus Deepcore's `tileAt`, `findTile` and `controlRect` and Arc Foundry's
 * `recipeEntries` — so the failure would have been silent in most of them.
 */
it("a reading is handed the state AND everything else the check passed", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, RAW, {
    readings: ["snapshot", "menuItemRect"],
  });
  expect(driver.menuItemRect(2)).toEqual({ x: 20, index: 2 });
  // Still a reading, so nothing was posed through `apply`.
  expect(engine.applied).toBe(0);
});

it("an argument-taking reading is narrowed by `project` like any other", () => {
  const engine = engineOver({ screen: "title", seed: 1 });
  const driver = applyDriver<Readonly<State>, State, Driver>(engine, RAW, {
    readings: ["snapshot", "menuItemRect"],
    project: (op, value) =>
      op === "menuItemRect"
        ? { ...(value as { x: number; index: number }), x: 0 }
        : value,
  });
  expect(driver.menuItemRect(3)).toEqual({ x: 0, index: 3 });
});
