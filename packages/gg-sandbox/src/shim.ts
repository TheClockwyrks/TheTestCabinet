/**
 * The interpreter shim: the component's entry point, and the only module `componentize-js` is
 * pointed at.
 *
 * gg bakes **one** component and reuses it for every program of every run. That is the whole latency
 * design: compiling this artifact costs about 660 ms and happens once per process, after which a
 * turn pays only an instantiate (tens of microseconds) and an invoke (a millisecond or two). So the
 * component cannot be specialised to a run — it receives the run's already-type-stripped JavaScript
 * as a *string* and the run's enabled tool names as a *list*, and does the specialising itself,
 * here, at the start of {@link run}.
 *
 * Four things happen in that function, and each is load-bearing:
 *
 * 1. **`console.*` is rebound** to `feedback.log`. The component is built `--disable stdio` because
 *    gg's telemetry stream *is* this process's stdout; without the rebinding a program's logging
 *    would go nowhere at all. Everything else the host has — the clock, the RNG, the filesystem, the
 *    network sockets — the guest simply gets, through WASI, and nothing here stands in the way.
 * 2. **The globals this sandbox cannot honour are shadowed with throwers** ({@link installDenials}).
 *    This is the difference between a model getting a sentence it can act on and gg reporting an
 *    opaque trap — see that function's own comment, which is the most important one in the file.
 * 3. **The scope is built from the run's enabled tools** ({@link buildScope}), and the program is
 *    evaluated as the body of a function whose *parameters* are those names. Scope injection is the
 *    capability model: a withheld tool is an undefined identifier, not a call that reaches the host
 *    and is refused there. The session-ending calls are bound alongside them by the same rule, from
 *    the agent's `ending` role rather than from a capability: exactly one group is in scope, so a
 *    reviewer has no `finish` to call and an ordinary agent has no `approve`.
 * 4. **Everything the program has to say is said through `feedback`**, never through a trap and
 *    never through a return value. A throw is caught once, described with a line number remapped
 *    into the program's own coordinates, and reported; a returned Promise and work deferred past the
 *    program's end are each named specifically, because each is a mistake a model makes repeatedly
 *    and cannot diagnose from a generic message.
 *
 * What this file deliberately does **not** do is carry a program's return value anywhere. The value
 * is discarded and the model is told once ({@link feedback.noteReturn}) that it was: a program shows
 * itself material by opening a **view** (`gg.views.openText`, `gg.views.openFile`) and tells the run's
 * operator things with `console.log`, which is why there is no serialisation to fail, no depth limit
 * to explain, and no rule about what a program may hand back. Ending the run is likewise not this
 * file's business —
 * `finish` returns like any other call and the *host* owns the flag it sets, so there is no unwind
 * to recognise and nothing here to reset between programs.
 */

import * as feedback from "test-cabinet:gg/feedback";
import type { ProgramError } from "test-cabinet:gg/feedback";
import type { EndingKind, ModuleId } from "./catalogue.js";
import {
  ALWAYS_BOUND,
  DOCS_NAME,
  ENDING_BOUND,
  GG_TOOLS,
  LEGACY_GROUPING,
  LEGACY_REVIEW_ENDING,
  LEGACY_STANDARD_ENDING,
  LIBRARY_BOUND,
  LIB_OBJECT,
  MODULE_ORDER,
  SURFACE,
  TOOL_BOUND,
  TOOL_ERROR,
  exportedName,
  keyOf,
  moduleOf,
} from "./catalogue.js";
import * as boardMod from "./gg/board.js";
import * as contextMod from "./gg/context.js";
import { ToolError } from "./gg/core.js";
import * as delegationMod from "./gg/delegation.js";
import * as filesMod from "./gg/files.js";
import * as memoriesMod from "./gg/memories.js";
import * as programsMod from "./gg/programs.js";
import * as sessionMod from "./gg/session.js";
import * as shellMod from "./gg/shell.js";
import * as skillsMod from "./gg/skills.js";
import * as tasksMod from "./gg/tasks.js";
import * as viewsMod from "./gg/views.js";
import {
  asToolError,
  describeThrown,
  errorMessage,
  errorName,
  isErrorLike,
} from "./internal/errors.js";

/** A bound tool or helper, as the shim handles it: names and arities are the SDK's business. */
type ToolFn = (...args: unknown[]) => unknown;

/**
 * One code module the host handed over, mirroring the world's `code-module` record: the key it is
 * bound at under `lib`, and the JavaScript whose evaluation produces its exports.
 */
interface CodeModule {
  /** The binding key — already an identifier, already unique across the list. */
  name: string;
  /** The module's JavaScript, ending in the `return { … }` the host appended. */
  source: string;
}

/**
 * The capability modules, by the gg module id each one implements.
 *
 * Every module is imported unconditionally — the component is baked once, so there is nothing to gain
 * by importing lazily, and a static import is what lets `componentize-js` resolve the membrane
 * specifiers at build time. `core` is absent because it declares types and no function; the one value
 * it carries is bound by {@link buildScope} directly.
 */
const MODULES: Readonly<Partial<Record<ModuleId, Readonly<Record<string, unknown>>>>> = {
  files: filesMod,
  shell: shellMod,
  board: boardMod,
  tasks: tasksMod,
  memories: memoriesMod,
  views: viewsMod,
  context: contextMod,
  delegation: delegationMod,
  skills: skillsMod,
  programs: programsMod,
  session: sessionMod,
};

/** The exported function one gg operation is implemented by, or `undefined` when it is absent. */
function implementation(operation: string): ToolFn | undefined {
  const exports = MODULES[moduleOf(operation)] ?? {};
  const candidate = exports[exportedName(keyOf(operation))];
  return typeof candidate === "function" ? (candidate as ToolFn) : undefined;
}

/**
 * The gg tool names this component can bind.
 *
 * gg calls this export in a unit test and asserts set-equality with its own tool vocabulary. It is
 * the one drift gate that inspects the **committed artifact** rather than a source file, so it
 * catches the failure no compiler can: a tool added, renamed or removed in gg, with a stale `.wasm`
 * still checked in.
 *
 * A tool is reported only when some operation it buys really resolves to an exported function, so a
 * gating table naming a function this SDK does not have is a missing name here rather than a runtime
 * `undefined`.
 */
export function boundTools(): string[] {
  const bought = new Set(
    Object.entries(TOOL_BOUND)
      .filter(([operation]) => implementation(operation))
      .map(([, tool]) => tool),
  );
  return GG_TOOLS.filter((tool) => bought.has(tool));
}

/**
 * How many lines the `Function` constructor puts in front of a program's body.
 *
 * A thrown error's stack reports a line number in the *constructed function*, not in the program the
 * model wrote, and the two differ by a constant this engine chooses. Measured at 2; calibrated at
 * run time by {@link lineOffset} anyway, so an engine update that changes it costs nothing.
 */
const DEFAULT_BODY_LINE_OFFSET = 2;

/** The calibrated offset, computed at most once per instantiation. */
let bodyLineOffset: number | undefined;

/**
 * The number of lines to subtract from a stack frame's line to get the program's own line.
 *
 * Calibrated by throwing from a one-line constructed function and reading back where the engine says
 * that line was. A failure to calibrate falls back to {@link DEFAULT_BODY_LINE_OFFSET} rather than
 * reporting a wrong line: an off-by-two location is worse than the measured constant.
 */
function lineOffset(): number {
  if (bodyLineOffset !== undefined) return bodyLineOffset;
  bodyLineOffset = DEFAULT_BODY_LINE_OFFSET;
  try {
    new Function("throw new Error('calibrate')")();
  } catch (thrown) {
    const frame = firstProgramFrame(thrown);
    if (frame) bodyLineOffset = frame.line - 1;
  }
  return bodyLineOffset;
}

/**
 * The first stack frame that sits inside the constructed function, if the engine recorded one.
 *
 * Frames from this shim and from the SDK are skipped by construction: only frames from the evaluated
 * body carry the `Function:<line>:<column>` marker.
 */
function firstProgramFrame(thrown: unknown): { line: number; column: number } | undefined {
  const stack = (thrown as { stack?: unknown } | null | undefined)?.stack;
  if (typeof stack !== "string") return undefined;
  for (const frame of stack.split("\n")) {
    const match = /Function:(\d+):(\d+)/.exec(frame);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { line: Number(match[1]), column: Number(match[2]) };
    }
  }
  return undefined;
}

/**
 * The globals this engine defines but that this component cannot honour, mapped to the reason.
 *
 * Two different failures are covered, and both are silent without a thrower.
 *
 * The **timers** are the worse of the two. gg's `run` export is *synchronous*: the host calls it,
 * it returns, and nothing polls afterwards — so there is no event loop for a scheduled callback to
 * run on. `setTimeout` is defined, accepts the callback, returns a handle, and then never fires it.
 * Measured: `setTimeout(() => { hit = 1 }, 0)` leaves `hit` at `0` and produces no error at all. A
 * model that writes `await new Promise((r) => setTimeout(r, 100))` — the single most common reflex
 * anyone brings to a new runtime — would get a program that silently did nothing.
 *
 * `--disable http fetch-event` is the other: it removes the WASI *imports* `fetch` calls but leaves
 * the builtin **defined**, so an unshadowed call reaches a missing import and **traps the whole
 * store**. A trap is uncatchable: no `feedback` call happens, the program's effects so far are
 * reported without explanation, and the model is told only that the sandbox trapped.
 *
 * Replacing each with a thrower turns both into an ordinary, located program error the model can
 * read and correct on its next turn.
 *
 * Nothing here denies a *capability this component has*. The clock, the RNG and `crypto` are all
 * real and all reachable — `Date.now()` is the host's wall clock, `Math.random()` and
 * `crypto.randomUUID()` draw the host's entropy. `fetch`'s reason is therefore about **this
 * artifact**, not about the sandbox: gg's host linker defines `wasi:sockets` for every guest, and a
 * guest that imported it would have the network. This one is baked without an HTTP client, so it
 * does not.
 */
const DENIED_GLOBALS: readonly (readonly [string, string])[] = [
  ["setTimeout", "there is no event loop, so a scheduled callback would never run"],
  ["setInterval", "there is no event loop, so a scheduled callback would never run"],
  ["clearTimeout", "there is no event loop, so a scheduled callback would never run"],
  ["clearInterval", "there is no event loop, so a scheduled callback would never run"],
  ["queueMicrotask", "deferred work is not part of your program's result"],
  ["requestAnimationFrame", "there is no event loop, so a scheduled callback would never run"],
  ["fetch", "this program's runtime is built without an HTTP client"],
];

/** A function that throws the denial for `name`, naming what the sandbox does not have. */
function denier(name: string, why: string): () => never {
  return () => {
    throw new Error(`${name} is not available in the sandbox: ${why}`);
  };
}

/**
 * Replace a global with `value`, whatever kind of property it is.
 *
 * A plain assignment is not enough, and getting this wrong is catastrophic rather than cosmetic.
 * Some globals in this engine are accessor properties with no setter, so assigning to one throws a
 * `TypeError` out of the shim's own setup — which `componentize-js` turns into an opaque trap, i.e.
 * exactly the failure this function exists to prevent. Measured with `crypto`, which is one of them:
 * `globalThis.crypto = {}` at module scope trapped **every** program, including `return 40 + 2;`.
 *
 * A global that refuses even `defineProperty` keeps its engine behaviour. Setup must never fail
 * because of one name: for a denied global that means the model gets the engine's own
 * `is not defined` rather than this file's sentence, which is a worse message and not a worse
 * outcome.
 */
function replaceGlobal(name: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch {
    // Deliberately empty: see above. One unreplaceable name must not take the whole turn down.
  }
}

/** Shadow every denied global with a thrower. */
function installDenials(): void {
  for (const [name, why] of DENIED_GLOBALS) replaceGlobal(name, denier(name, why));
}

/**
 * Route every `console` method to the one `feedback.log` sink.
 *
 * There is no real stdout here, so there is no level distinction to preserve: `console.error` and
 * `console.log` are the same channel, and that channel goes to the run's **operator** — it is
 * captured into the run record and shown on the console, and the model never sees a line of it.
 * The way a program shows something to itself is `view.openText` / `view.openFile`, which put one
 * message per view into the next prompt.
 */
function installConsole(): void {
  const emit = (args: unknown[]): void => {
    feedback.log(args.map(render).join(" "));
  };
  const sink = {
    log: (...args: unknown[]) => emit(args),
    info: (...args: unknown[]) => emit(args),
    warn: (...args: unknown[]) => emit(args),
    error: (...args: unknown[]) => emit(args),
    debug: (...args: unknown[]) => emit(args),
    trace: (...args: unknown[]) => emit(args),
    dir: (...args: unknown[]) => emit(args),
  };
  replaceGlobal("console", sink);
}

/**
 * One logged argument, as a line of text.
 *
 * A `ToolError` is rendered with its tool and code because those are the fields a model is told to
 * read, and neither survives `JSON.stringify` of a plain `Error`. Anything that cannot be
 * serialised — a cycle, a function — degrades to `String(...)` rather than taking the log line down
 * with it.
 */
function render(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof ToolError) return `${arg.name}(${arg.code}) on ${arg.tool}: ${arg.message}`;
  // Error-like rather than `instanceof Error`, for the reason `isErrorLike` documents: a fault
  // raised inside the generated bindings comes from another realm, and logging it as `{}` loses the
  // only line that says what went wrong.
  if (isErrorLike(arg)) return `${errorName(arg)}: ${errorMessage(arg)}`;
  return describeThrown(arg);
}

/** Whether {@link run} has already handed control back to the host. */
let ended = false;

/** Whether the deferred-work note has already been sent for this program. */
let deferredNoted = false;

/**
 * Report, once, that a tool call happened after the program ended.
 *
 * Deferred work still executes and its effects are real, so it is recorded like any other call — but
 * it lands after the turn's program is over, and a throw inside it is invisible: this engine defines
 * `addEventListener("unhandledrejection", …)` and never fires it. Telling the model plainly beats
 * reporting a clean turn over a half-failed program.
 */
function noteDeferred(name: string): void {
  if (deferredNoted) return;
  deferredNoted = true;
  feedback.reportDeferred(
    `\`${name}\` ran after your program ended, from work deferred with \`.then()\` or ` +
      "`await`; failures there are not reported",
  );
}

/**
 * Wrap a bound function in the one rule that holds for every tool call whatever the tool does: a
 * call made after the program has ended is noticed and reported.
 *
 * `js` is the function name a program calls (`writeFile`), because the deferred-work note names what
 * the model actually wrote rather than the gg tool behind it.
 *
 * There is deliberately **no** "the run is already finished" refusal here. `finish` sets a flag in
 * the agent's host-side context and the host decides what that flag means; a guest that refused
 * calls after it would be a second, quieter authority on when a run is over — and would turn the
 * harmless shape `finish(...)` followed by one more `console.log`-worth of tidying into a failed
 * turn.
 */
function guard(js: string, fn: ToolFn): ToolFn {
  return (...args: unknown[]) => {
    if (ended) noteDeferred(js);
    try {
      return fn(...args);
    } catch (thrown) {
      throw attribute(js, thrown);
    }
  };
}

/**
 * Name the function a binding-level fault came out of.
 *
 * The SDK validates what it can ({@link "./errors.js".uint}, {@link "./errors.js".list}, …), but
 * most argument mistakes are caught one layer further in, by the generated lowering code, which
 * knows the *shape* it wanted and nothing about the call: `tasks.addTask({ title: "x" })` — an
 * `addTask` missing its required `id` — raises `TypeError: expected a string, received [undefined]`
 * with no function name, no field name and no clue which of a record's fields was wrong.
 *
 * Re-tagging it as a {@link ToolError} on `js` supplies the one fact it was missing: which call
 * failed. A {@link ToolError} is passed straight through — the membrane already said something
 * better — and so is anything that is not error-like, which the shim describes on its own terms.
 */
function attribute(js: string, thrown: unknown): unknown {
  const err = asToolError(thrown);
  if (err instanceof ToolError || !isErrorLike(err)) return err;
  return new ToolError(js, "invalid-argument", `${errorName(err)}: ${errorMessage(err)}`);
}

/**
 * Tag a bound function with the name gg knows it by, so `view.openDocsView(fs.readFile)` can be
 * spelled with the function instead of a string. `name` is the name a program calls the function by
 * (`readFile`, `finish`), which is what the host keys documentation on.
 *
 * The tag is a non-enumerable `Symbol`, so it never shows up when a model iterates an object and is
 * not part of the callable surface — it is metadata, reachable only by something that knows to look.
 *
 * There is deliberately **no** `.docs()` method here any more. Documentation is a view: it reaches
 * the model in its next prompt, keyed, closable and replaceable like everything else it reads. A
 * method that returned the text inline was a second, quieter channel into the model — the exact
 * thing views exist to remove.
 */
function documented(fn: ToolFn, name: string): ToolFn {
  const wrapped: ToolFn = (...args) => fn(...args);
  Object.defineProperty(wrapped, DOCS_NAME, { value: name });
  return wrapped;
}

/**
 * The names a program is given: the capability modules, under every spelling that reaches them.
 *
 * A program does not receive flat identifiers. It receives `gg`, carrying one object per module that
 * this run offers at least one function of, so `gg.files.readFile` — the fully-qualified name the
 * documentation is keyed by — is a path a program can write.
 *
 * These names become the evaluated function's *parameters*, which shadow any global of the same
 * name, so this map is both the capability set and its enforcement: a withheld operation is a missing
 * property, and a module with nothing enabled is absent from `gg` entirely.
 *
 * **A module is deliberately not bound under its bare id.** `files`, `shell` and `memories` are
 * among the most ordinary variable names a program writes, and a parameter of that name makes
 * `const files = …` a `SyntaxError` about a redeclared formal parameter — a failure whose message
 * says nothing about what the program did wrong. One qualified path costs nothing to write and
 * collides with nothing.
 *
 * Two further bindings are not modules and are here anyway:
 *
 * - **`ToolError`**, bound bare, because `catch (error) { if (error instanceof ToolError) … }` is the
 *   shape the prompt teaches and a qualified name in a `catch` reads as ceremony;
 * - the **legacy grouping names** ({@link LEGACY_GROUPING}) — `fs`, `view`, `harness` — which the
 *   PureScript, Java and Kotlin arms' compiled bundles resolve as free identifiers against this same
 *   scope. They are in no catalogue, so nothing puts them in front of a model.
 *
 * The last of those two **qualifies the paragraph above it**, and the prompt says so rather than
 * leaving a model to find out: four modules' grouping names are their own ids (`tasks`, `context`,
 * `skills`, `programs`), so those four *are* seeded bare after all, and `const context = …` is the
 * very `SyntaxError` this design was meant to avoid. They cannot simply be dropped — the three
 * sibling arms above resolve them by name out of compiled bundles gg does not rewrite — so the
 * honest fix is the one taken: each arm's prompt names the reserved set outright, and a model that
 * reads it wants for nothing.
 *
 * Everything goes through {@link guard}, so a call made from deferred work — which lands after the
 * turn is over — is reported.
 */
function buildScope(
  enabled: readonly string[],
  ending: EndingKind,
  library: boolean,
): Record<string, unknown> {
  const on = new Set(enabled);
  const modules = new Map<ModuleId, Record<string, unknown>>();
  // Fetch (creating on first use) the object for a module. A module starts EMPTY, and every property
  // it ends up with is one operation this run bound — so a module a program can see is a module it
  // can call something on, and there is nothing on it that is not a capability.
  const moduleFor = (id: ModuleId): Record<string, unknown> => {
    let module = modules.get(id);
    if (!module) {
      module = {};
      modules.set(id, module);
    }
    return module;
  };
  // The second name a module is reached by: the one the PureScript, Java and Kotlin arms' compiled
  // bundles resolve as a free identifier. The ending group is the one module whose name depends on
  // the role.
  const groupingFor = (id: ModuleId): string =>
    id === "session"
      ? ending === "review"
        ? LEGACY_REVIEW_ENDING
        : LEGACY_STANDARD_ENDING
      : (LEGACY_GROUPING[id] ?? id);

  const bind = (operation: string): void => {
    const fn = implementation(operation);
    if (!fn) return;
    const id = moduleOf(operation);
    const name = exportedName(keyOf(operation));
    moduleFor(id)[name] = documented(guard(name, fn), name);
  };

  for (const [operation, tool] of Object.entries(TOOL_BOUND)) {
    if (on.has(tool)) bind(operation);
  }
  // Bound whatever a run enables, on the same carve-out the endings have: a run that offers no tools
  // at all must still be able to show its model something, and a view is the only channel that
  // reaches it.
  for (const operation of ALWAYS_BOUND) bind(operation);
  // The program library is the one family a *capability* gates rather than a tool or a role, so the
  // host says so with a flag instead of a name in `enabled` — but the enforcement is identical to
  // every other family's: a run without it has no `programs` in scope, not a `programs` whose calls
  // are refused.
  if (library) {
    for (const operation of LIBRARY_BOUND) bind(operation);
  }
  // The one ending group this role produces. Bound by the same rule the tools are: what is not this
  // role's ending is not a name in the program's scope.
  for (const [operation, role] of Object.entries(ENDING_BOUND)) {
    if (role === ending) bind(operation);
  }

  const surface: Record<string, unknown> = {};
  const scope: Record<string, unknown> = { [SURFACE]: surface };
  // `core` carries no function and is therefore never created by `bind`; it is a module all the same,
  // because `gg.core.ToolError` is the name a documentation view of the error type is opened by.
  surface["core"] = { [TOOL_ERROR]: ToolError };
  scope[TOOL_ERROR] = ToolError;
  for (const id of MODULE_ORDER) {
    const module = modules.get(id);
    if (!module) continue;
    surface[id] = module;
    scope[groupingFor(id)] = module;
  }
  return scope;
}

/**
 * Evaluate every code module and return the `lib` object a program reaches them through, or
 * `undefined` when the agent has loaded none.
 *
 * A module is the code half of a skill or a memory the agent read. It is evaluated exactly the way a
 * program is — as the body of a function whose parameters are the scope's object names — so a module
 * may call `fs.readFile` or `system.shell` like anything else. The host appended the
 * `return { … }` that makes the module's exports the value of evaluating it, so there is no export
 * protocol here: whatever comes back is the namespace.
 *
 * **A module that throws does not take the turn down.** Its author is whoever wrote the skill or the
 * memory, not the model whose program merely has it in scope, so the failure is reported over
 * {@link feedback.reportModuleError} — one sentence to the model, the whole message to the operator
 * — and `lib.<name>` is left as an empty object. A program that then calls into it gets an ordinary,
 * located `TypeError` naming the member it wanted.
 *
 * Modules are evaluated **in order**, and each is given the same scope the program gets rather than
 * the `lib` being built: a module that could see its neighbours would make the load order part of
 * the contract, and the load order is the order the agent happened to read things in.
 */
function buildLib(
  modules: readonly CodeModule[],
  scope: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (modules.length === 0) return undefined;
  const names = Object.keys(scope);
  const values = names.map((name) => scope[name]);
  const lib: Record<string, unknown> = {};
  for (const module of modules) {
    try {
      const body = new Function(...names, module.source) as (...args: unknown[]) => unknown;
      const exports = body(...values);
      lib[module.name] = typeof exports === "object" && exports !== null ? exports : {};
    } catch (thrown) {
      lib[module.name] = {};
      const err = asToolError(thrown);
      feedback.reportModuleError(
        module.name,
        isErrorLike(err) ? `${errorName(err)}: ${errorMessage(err)}` : describeThrown(err),
      );
    }
  }
  return lib;
}

/**
 * Evaluate one program against exactly the tools this run enables.
 *
 * `program` is JavaScript: gg type-stripped the model's TypeScript before it got here. `enabled` is
 * the run's gg tool names, `ending` the agent's role and `library` whether the run keeps a program
 * library — together the whole scope. `modules` is the code the agent loaded by reading a code skill
 * or a code memory, bound at `lib.<name>` ({@link buildLib}). Nothing comes back: a throw is
 * reported over `feedback.report-error` rather than being allowed to escape as an opaque wasm trap,
 * everything a program wanted to show itself it opened a view of, and an ending is a flag the host
 * already holds.
 *
 * A **returned value is discarded**, and {@link feedback.noteReturn} is how the model learns that
 * rather than by noticing an absence. Discarding it is what makes the rule one sentence — open a
 * view of what you want to see — and it costs a program nothing: there is no value it could return
 * that it could not open a view of.
 */
export function run(
  program: string,
  modules: CodeModule[],
  enabled: string[],
  ending: EndingKind,
  library: boolean,
): void {
  installConsole();
  installDenials();
  ended = false;
  deferredNoted = false;

  const scope: Record<string, unknown> = buildScope(enabled, ending, library);
  // The unknown-name hint names the MODULES a program may reach, qualified as the documentation
  // qualifies them (`gg.files`, `gg.views`): one spelling in the message, and the one every other
  // thing the model reads uses. `lib` is not a module — it holds no gg function — so it is named
  // separately rather than folded into a list that would be false about it.
  const surface = scope[SURFACE] as Record<string, unknown>;
  const offered = MODULE_ORDER.filter((id) => id in surface).map((id) => `${SURFACE}.${id}`);
  // Built against the module scope alone, then added to it: a module sees the same names the program
  // does, and nothing sees a half-built `lib`.
  const lib = buildLib(modules, scope);
  if (lib) scope[LIB_OBJECT] = lib;
  const names = Object.keys(scope);

  try {
    const body = new Function(...names, program) as (...args: unknown[]) => unknown;
    const value = body(...names.map((name) => scope[name]));
    ended = true;
    // A Promise is the one returned value that is reported as an error rather than merely noted,
    // because it is not a value the model meant to hand back at all: it is the trace of `async` or
    // `await` in a synchronous sandbox, and the work inside it is still pending as this returns.
    if (isThenable(value)) {
      feedback.reportError({
        kind: "other",
        code: undefined,
        message: "your program returned a Promise; this sandbox is synchronous",
        location: undefined,
      });
      return;
    }
    if (value !== undefined) feedback.noteReturn();
  } catch (thrown) {
    ended = true;
    feedback.reportError(describe(thrown, offered, lib !== undefined));
  }
}

/**
 * Turn whatever a program threw into the report gg feeds back to the model.
 *
 * The message is rendered as `${name}: ${message}` rather than from `err.stack`, because this
 * engine's stack does **not** begin with the name and message — reporting the stack alone would lose
 * the one line that says what went wrong.
 *
 * The `kind` this returns is what *this* guest makes of the throw; the `code` is what the membrane
 * said. gg classifies the turn's error from the code where there is one, so a call the host refused
 * is recorded the same way in every language arm — see `program-error` in the WIT.
 */
function describe(
  thrown: unknown,
  names: readonly string[],
  lib: boolean,
): ProgramError {
  const err = asToolError(thrown);
  // The frame is looked for in what was thrown *first*, and only then in the normalised form. A
  // membrane failure arrives as a bare record with no stack at all, while the `ToolError` built from
  // it was constructed at the call site and carries one — so neither alone finds the program's line
  // in every case, and the original is the more faithful of the two when both have one.
  const frame = firstProgramFrame(thrown) ?? firstProgramFrame(err);
  const location = frame ? `line ${frame.line - lineOffset()}, column ${frame.column}` : undefined;
  if (err instanceof ToolError) {
    return {
      kind: "tool-failure",
      code: err.code,
      message: `\`${err.tool}\` failed (${err.code}): ${err.message}`,
      location,
    };
  }
  // Every branch below classifies by NAME rather than by `instanceof`, because a fault raised inside
  // the generated bindings is an `Error` from another realm — see `isErrorLike`. Classifying it by
  // constructor identity dropped it into the fallback, where it was reported as `{}`.
  if (isErrorLike(err)) {
    const name = errorName(err);
    const message = errorMessage(err);
    if (name === "ReferenceError") {
      // The most common cause is a program reaching for a flat name (`readFile`) instead of the
      // qualified one (`gg.files.readFile`), so answer the question it is about to ask: which
      // modules does it have? Finding a function inside one is what searching is for.
      return {
        kind: "unknown-name",
        code: undefined,
        message:
          `${message}; modules this run: ${names.join(", ")}` +
          (lib ? `, plus \`${LIB_OBJECT}\` for loaded skill and memory code` : ""),
        location,
      };
    }
    return { kind: "other", code: undefined, message: `${name}: ${message}`, location };
  }
  return { kind: "other", code: undefined, message: describeThrown(err), location };
}

/** Whether a value is a Promise (or anything else with a `then`), which a program must not return. */
function isThenable(value: unknown): boolean {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function";
}
