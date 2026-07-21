// The two-pass runtime behind automated validation.
//
// A validation item is written ONCE, as an arrange/act/assert triple, and the
// runtime runs it twice with a differently-wired `api`:
//
//   * The VALIDATE pass decides the verdict. Time advances instantly — the build
//     is put on its manual clock and `advance()` steps the simulation by an exact
//     amount — so a check reads an exact state and never depends on how fast the
//     host happens to be. Assertions record; capture calls do nothing.
//
//   * The RECORD pass produces the media. Time advances in REAL time — the build
//     is handed its own clock back and `advance()` is a wall-clock wait — so the
//     recording shows the game moving at the speed it actually moves. Assertions
//     are suppressed and `assert()` is skipped entirely: this pass decides
//     nothing, it only depicts what the item checks.
//
// Why two passes rather than one. A single pass cannot be both: exact stepping is
// what makes a check deterministic (and fast — an item may drive a 24-hit rally),
// but stepping advances simulation time instantly while the build's render loop
// keeps painting, so anything filmed during it moves at the speed of the host's
// round trips rather than the game's. Recording that produces a clip showing
// motion the game never exhibits. Playwright forces the split too: a recording is
// attached to a whole browser context and only flushes when that context closes,
// so there is no way to start filming partway through one pass.
//
// Why the item is a factory rather than a plain object: each pass gets its own
// instance, so state that `act` computes for `assert` to read (in a closure the
// item owns) cannot leak from one pass into the other.
//
//   export default function item() {
//     let outcome;
//     return {
//       id: "gameplay.scoring-p1",
//       // Instant: pose preconditions with control ops only. Runs in BOTH passes,
//       // so the record pass reaches `act` in exactly the state the check saw.
//       async arrange(api) {
//         await startPlaying(api);
//         await api.call("setBall", 0, { x: 900, y: 360, vx: 620 });
//       },
//       // The behavior under test — the ONLY part that consumes time, and the only
//       // part that is filmed. Keep it to what the item actually checks: a reviewer
//       // should not sit through anything else to see it.
//       async act(api) {
//         outcome = await api.until((s) => s.screen !== "playing", { max: 360 });
//       },
//       // Post-checks. Runs in the validate pass only.
//       async assert(api, check) {
//         check.expectEq("player one's score", outcome.snap.score.p1, 1);
//       },
//     };
//   }

/** The pass a runtime `api` is wired for. */
export const VALIDATE = "validate";
export const RECORD = "record";

/**
 * The marker property that distinguishes an UNMET PRECONDITION from a debug-API
 * conformance failure.
 *
 * An item's `arrange` often has to find a spot in the model's own world to pose its
 * scenario — a blind corner in an invented maze, a legal tile to build on. That
 * search can come up empty against a perfectly conformant build: the debug API
 * answered every call correctly, there simply was no such spot. Those two outcomes
 * look identical from the outside (both are a throw out of `arrange`) but mean
 * opposite things, so the driver has to be able to tell them apart. A plain throw
 * stays what it always was — the build misbehaved; a throw carrying this marker says
 * the scenario was never constructible, which is INCONCLUSIVE and must not be read
 * as the model failing to implement the API.
 *
 * It is a plain own property rather than a subclass because a case's
 * `validation/_helpers.mjs` is loaded from the case version folder by path and can
 * only import its own siblings — it has no resolvable specifier for this module, so
 * `instanceof` could never work across that boundary. Setting a documented flag
 * needs no import at all. Prefer {@link preconditionUnmet} where the module IS
 * reachable; a case helper sets the property directly:
 *
 *   const err = new Error("no blind-corner pair found");
 *   err.ttcPreconditionUnmet = true;
 *   throw err;
 */
export const PRECONDITION_UNMET = "ttcPreconditionUnmet";

/**
 * Build the error an item throws when its scenario cannot be posed against this
 * build — see {@link PRECONDITION_UNMET} for why this is not a subclass.
 */
export function preconditionUnmet(reason) {
  const err = new Error(String(reason));
  err[PRECONDITION_UNMET] = true;
  return err;
}

/** Whether `err` marks an unmet precondition rather than a conformance failure. */
export function isPreconditionUnmet(err) {
  return Boolean(err && err[PRECONDITION_UNMET] === true);
}

/**
 * How long the record pass may film before it stops, in ms.
 *
 * `act` is written to decide a verdict, and some checks need far more of the game
 * than a reviewer does: proving a rally accelerates and then caps takes 24 real
 * paddle hits, which is over half a minute of watching a ball bounce. A clip that
 * long is worse than useless — the reviewer scrubs past it, and every run pays to
 * store it. So the record pass films the beginning of `act` and stops, on the
 * principle that the opening of a scenario is what demonstrates it.
 *
 * This never affects a verdict: the validate pass is uncapped and has already run.
 * An item that genuinely needs longer sets `clipMs`.
 */
const DEFAULT_CLIP_MS = 8000;

/**
 * Thrown to unwind out of `act` once the record pass has filmed enough. Caught by
 * `runPass` in the record pass only, where it means "clip complete", never failure.
 */
class ClipBudgetReached extends Error {
  constructor() {
    super("clip budget reached");
    this.name = "ClipBudgetReached";
  }
}

/**
 * A `check` that records nothing and holds nothing back — handed to `act` in the
 * RECORD pass so an item can carry the same assertion calls through both passes
 * without a failing one aborting the recording (or, worse, contributing a second
 * set of assertions to a verdict already decided by the validate pass).
 *
 * Every matcher returns `true`, so an item must not branch on a check's return
 * value: the two passes would then take different paths and the recording would
 * stop depicting what was checked.
 */
function makeSilentCheck(id) {
  const check = { id, assertions: [], verdict: () => ({ verdicts: {} }) };
  for (const op of ["Eq", "Ne", "Gt", "Ge", "Lt", "Le", "Close", "Ok"]) {
    check[`expect${op}`] = () => true;
    check[`assert${op}`] = () => true;
  }
  return check;
}

/**
 * Build the `api` an item's phases are called with.
 *
 * `base` is the raw driver surface (`reset`/`snapshot`/`call`/`pixel`/`screenshot`
 * plus the real-time `wait`), and this wraps it so the SAME item code means the
 * right thing in each pass. `tickHz` is the case's fixed simulation rate: with it,
 * the unit of `advance`/`until` is TICKS and the runtime converts to wall-clock for
 * the record pass; without it the case is real-time-clocked and the unit is
 * seconds. Either way the amount is handed to the build's own `step` verbatim, so
 * the debug API keeps whatever unit its spec declares.
 */
function makeApi(base, { mode, tickHz, phase, budget }) {
  const recording = mode === RECORD;
  // Wall-clock milliseconds one unit of `advance` represents.
  const unitMs = tickHz ? 1000 / tickHz : 1000;

  const timed = (name) => {
    if (phase.current === "arrange") {
      throw new Error(
        `api.${name}() was called from arrange(), which must be instant — ` +
          `move anything that consumes time into act(), the phase that is timed and filmed`,
      );
    }
  };

  /**
   * Spend `ms` of the record pass's filming budget, and unwind once it is gone.
   * Only the record pass has a budget; the validate pass advances instantly and is
   * uncapped, so a check never sees this.
   */
  const spend = (ms) => {
    if (!recording) return;
    budget.remaining -= ms;
    if (budget.remaining <= 0) throw new ClipBudgetReached();
  };

  return {
    ...base,

    /**
     * Return the build to its start state, from either phase.
     *
     * The debug-API contract has `reset` switch the build to its MANUAL clock, so a
     * scripted scenario is exact from the start. That is what `arrange` wants, but
     * in the record pass it would take the clock back mid-`act` and quietly film a
     * frozen game — no motion, and no failing check to point at it.
     *
     * The clock is the runtime's to manage, so rather than forbidding `reset` in
     * `act` (which would push items into contorted workarounds — reaching the title
     * by driving the pause menu, say, coupling a check to menu ORDER when what it
     * meant to test was persistence), take the side effect back out: hand the clock
     * straight back afterwards. `reset` then means the same thing in both passes.
     */
    reset: async (options) => {
      const result = await base.reset(options);
      if (recording && phase.current === "act") {
        await base.call("setAutoStep", true);
      }
      return result;
    },

    /**
     * Advance by `amount` (ticks, or seconds for a real-time-clocked case).
     * Validate: an exact `step` on the build's manual clock. Record: a real pause
     * of the same duration while the build drives itself.
     */
    advance: async (amount) => {
      timed("advance");
      const n = Number(amount) || 0;
      if (recording) {
        spend(n * unitMs);
        return base.wait(n * unitMs);
      }
      return base.step(n);
    },

    /**
     * Advance until `predicate(snapshot)` holds or `max` units are spent, and
     * return `{ snap, hit }` — the snapshot at the end and whether the predicate
     * was met. `poll` is how much to advance between reads: keep it fine when the
     * exact instant matters (a bounce), coarse when the value read is constant
     * between events (rally speed) so the sweep stays cheap.
     *
     * The record pass cannot step, so it samples the running game on the same
     * cadence instead and gives up once `max` units of real time have passed.
     */
    until: async (predicate, { max, poll = 1 } = {}) => {
      timed("until");
      const limit = Number(max) || 0;
      const chunk = Number(poll) || 1;
      let snap = await base.snapshot();
      if (predicate(snap)) return { snap, hit: true, spent: 0 };
      for (let spent = 0; spent < limit; spent += chunk) {
        if (recording) {
          spend(chunk * unitMs);
          await base.wait(chunk * unitMs);
        } else await base.step(chunk);
        snap = await base.snapshot();
        if (predicate(snap)) return { snap, hit: true, spent: spent + chunk };
      }
      return { snap, hit: false, spent: limit };
    },

    /**
     * Pause for `ms` of REAL time in both passes, to let the build repaint.
     *
     * This is deliberately not `advance`. Simulation time and paint are different
     * things: `advance` moves the game, and in the validate pass it does so
     * instantly, consuming no wall clock at all. But a check that reads what the
     * build actually DREW — `api.pixel` sampling the canvas — needs a frame to have
     * been painted since the state was posed, and no amount of instant stepping
     * produces one. Relying on the incidental latency of driver round trips instead
     * makes such a check a race: it usually wins, and reads a stale canvas when it
     * does not, failing an implementation that painted correctly.
     *
     * So this stays real in both passes. Keep it to a paint settle (tens of ms) —
     * it is not a way to smuggle wall-clock waiting into the validate pass, and
     * anything that should move the game belongs in `advance`.
     */
    settle: async (ms) => base.wait(Number(ms) || 0),

    /**
     * Capture a still for a declared image output. Only the record pass produces
     * media, so this is a no-op while the verdict is being decided.
     */
    screenshot: async (id) => {
      if (!recording) return;
      await base.screenshot(id);
    },

    // `step` and `wait` are the runtime's own levers for expressing the two
    // clocks; an item uses `advance`/`until` so it reads the same in both passes.
    step: undefined,
    wait: undefined,
  };
}

/**
 * Load an item module and instantiate it. The module's default export is the
 * factory (a plain object is accepted too, for an item with no cross-phase state).
 */
export function instantiate(mod) {
  const exported = mod.default ?? mod.item;
  const item = typeof exported === "function" ? exported() : exported;
  if (!item || typeof item !== "object") {
    throw new Error(
      "a validation item must default-export an { id, arrange, act, assert } object (or a factory returning one)",
    );
  }
  for (const phase of ["arrange", "act"]) {
    if (typeof item[phase] !== "function") {
      throw new Error(`validation item is missing its ${phase}() phase`);
    }
  }
  return item;
}

/**
 * Run one pass of `item` against a live page.
 *
 * Both passes run `arrange` and then `act`; only the validate pass runs `assert`.
 * The build's clock is set between the two phases — manual for validate, its own
 * for record — so an item never touches `setAutoStep` itself and cannot leave the
 * wrong clock running under a check or a recording.
 */
export async function runPass(item, base, { mode, tickHz, check }) {
  const phase = { current: "arrange" };
  const budget = { remaining: Number(item.clipMs) || DEFAULT_CLIP_MS };
  const api = makeApi(base, { mode, tickHz, phase, budget });

  await item.arrange(api);

  // Hand the clock over. The build's own `reset`/`step` switch it to manual, so
  // the validate pass is already there after any arrange; setting it explicitly
  // means an item that arranged purely with setters is on the manual clock too.
  await base.call("setAutoStep", mode === RECORD);

  phase.current = "act";
  try {
    await item.act(api, check);
  } catch (err) {
    // Running out of filming budget is a normal end to the record pass, not a
    // failure: everything filmed up to here is a valid clip. Any other error, and
    // any error at all in the validate pass, still propagates.
    if (!(err instanceof ClipBudgetReached)) throw err;
  }

  if (mode === VALIDATE && typeof item.assert === "function") {
    phase.current = "assert";
    await item.assert(api, check);
  }
}

export { makeSilentCheck };
