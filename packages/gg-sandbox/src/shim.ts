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
 *    would go nowhere at all.
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
 * itself material by opening a **view** (`view.openText`, `view.openFile`) and tells the run's
 * operator things with `console.log`, which is why there is no serialisation to fail, no depth limit
 * to explain, and no rule about what a program may hand back. Ending the run is likewise not this
 * file's business —
 * `finish` returns like any other call and the *host* owns the flag it sets, so there is no unwind
 * to recognise and nothing here to reset between programs.
 */

import * as feedback from "test-cabinet:gg/feedback";
import type { ProgramError } from "test-cabinet:gg/feedback";
import type { EndingKind } from "./catalogue.js";
import {
  DOCS_NAME,
  HELPER_CATALOGUE,
  LIB_OBJECT,
  OBJECT_FOR_MODULE,
  PROGRAM_ENTRIES,
  PROGRAM_MODULE,
  SESSION_ENTRIES,
  TOOL_CATALOGUE,
  VIEW_ENTRIES,
  VIEW_MODULE,
} from "./catalogue.js";
import {
  ToolError,
  asToolError,
  describeThrown,
  errorMessage,
  errorName,
  isErrorLike,
} from "./errors.js";
import * as helpers from "./helpers.js";
import * as sessionMod from "./session.js";
import * as boardMod from "./tools/board.js";
import * as contextMod from "./tools/context.js";
import * as delegationMod from "./tools/delegation.js";
import * as docsMod from "./tools/docs.js";
import * as filesMod from "./tools/files.js";
import * as memoriesMod from "./tools/memories.js";
import * as programsMod from "./tools/programs.js";
import * as shellMod from "./tools/shell.js";
import * as skillsMod from "./tools/skills.js";
import * as tasksMod from "./tools/tasks.js";
import * as viewsMod from "./tools/views.js";

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
 * The SDK modules, keyed by the `module` field of {@link TOOL_CATALOGUE} — plus
 * {@link VIEW_MODULE}, whose functions are catalogued separately because none of them is a gg tool.
 *
 * Every module is imported unconditionally — the component is baked once, so there is nothing to
 * gain by importing lazily, and a static import is what lets `componentize-js` resolve the membrane
 * specifiers at build time.
 *
 * {@link boundTools} iterates {@link TOOL_CATALOGUE} rather than this map's keys, so the `views` and
 * `programs` entries cannot perturb the `boundTools() == ALL_TOOL_NAMES` bijection: no tool names
 * either module.
 */
const MODULES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  shell: shellMod,
  files: filesMod,
  skills: skillsMod,
  memories: memoriesMod,
  tasks: tasksMod,
  board: boardMod,
  context: contextMod,
  delegation: delegationMod,
  views: viewsMod,
  programs: programsMod,
};

/** The helper module, looked up the same way the tool modules are. */
const HELPERS: Readonly<Record<string, unknown>> = helpers;

/** The exported function for a catalogue entry, or `undefined` if the module does not export it. */
function lookup(exports: Readonly<Record<string, unknown>>, js: string): ToolFn | undefined {
  const candidate = exports[js];
  return typeof candidate === "function" ? (candidate as ToolFn) : undefined;
}

/**
 * The gg tool names this component can bind.
 *
 * gg calls this export in a unit test and asserts set-equality with its own tool vocabulary minus
 * the three turn-level transitions. It is the one drift gate that inspects the **committed
 * artifact** rather than a source file, so it catches the failure no compiler can: a tool added,
 * renamed or removed in gg, with a stale `.wasm` still checked in. The catalogue is filtered by
 * whether the module really exports the function, so a catalogue entry pointing at a name that does
 * not exist is a missing name here rather than a runtime `undefined`.
 */
export function boundTools(): string[] {
  return TOOL_CATALOGUE.filter((entry) => lookup(MODULES[entry.module] ?? {}, entry.js)).map(
    (entry) => entry.tool,
  );
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
 * `--disable clocks random http fetch-event` removes the WASI *imports* these builtins call, but the
 * builtins themselves are still **defined** — so calling one reaches a missing import and **traps the
 * whole store**. A trap is uncatchable: no `feedback` call happens, the program's effects so far are
 * reported without explanation, and the model is told only that the sandbox trapped. Since
 * `await new Promise((r) => setTimeout(r, 100))` is the single most common reflex a model brings to
 * a new runtime, that failure would be routine.
 *
 * Replacing each with a thrower turns it into an ordinary, located program error the model can read
 * and correct on its next turn.
 */
const DENIED_GLOBALS: readonly (readonly [string, string])[] = [
  ["setTimeout", "there is no clock and no event loop"],
  ["setInterval", "there is no clock and no event loop"],
  ["clearTimeout", "there is no clock and no event loop"],
  ["clearInterval", "there is no clock and no event loop"],
  ["queueMicrotask", "deferred work is not part of your program's result"],
  ["requestAnimationFrame", "there is no clock and no event loop"],
  ["fetch", "there is no network"],
];

/**
 * The denied members of an object-valued global, replaced by a stub carrying only those members.
 *
 * `crypto` matters as much as the timers do, and for a subtler reason: unshadowed, this engine's
 * `crypto.randomUUID()` returns the *same* UUID on every run of every study, forever — and unlike
 * `Math.random()` it looks authoritative. Denying it outright is the only honest answer.
 */
const DENIED_MEMBERS: readonly (readonly [string, readonly string[], string])[] = [
  ["performance", ["now"], "there is no clock"],
  ["crypto", ["getRandomValues", "randomUUID"], "there is no randomness"],
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
 * Some of these globals are accessor properties with no setter (`crypto` is one), so assigning to
 * one throws a `TypeError` out of the shim's own setup — which `componentize-js` turns into an
 * opaque trap, i.e. exactly the failure this function exists to prevent. Measured:
 * `globalThis.crypto = {}` at module scope trapped **every** program, including `return 40 + 2;`.
 *
 * A global that refuses even `defineProperty` keeps its engine behaviour. That is still sound — the
 * underlying capability is absent either way — so setup must never fail because of one name.
 */
function replaceGlobal(name: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch {
    // Deliberately empty: see above. One unreplaceable name must not take the whole turn down.
  }
}

/** Shadow every denied global and denied member with a thrower. */
function installDenials(): void {
  for (const [name, why] of DENIED_GLOBALS) replaceGlobal(name, denier(name, why));
  for (const [object, members, why] of DENIED_MEMBERS) {
    const stub: Record<string, unknown> = {};
    for (const member of members) stub[member] = denier(`${object}.${member}`, why);
    replaceGlobal(object, stub);
  }
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
 * (`readFile`, `finish`, `list`), which is what the host's doc directory is keyed on.
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
 * The API objects a program may use, each bound to the functions behind it.
 *
 * A program does not receive flat identifiers. It receives a small set of namespaced objects — `fs`,
 * `project`, `system`, `harness`, … — one per {@link OBJECT_FOR_MODULE} namespace that has at least
 * one bound function, and each function is reached as `object.name(...)`. These object names become
 * the evaluated function's *parameters*, which shadow any global of the same name, so this map is
 * both the capability set and its enforcement: a withheld tool is a missing method, and a namespace
 * with nothing enabled is a missing object.
 *
 * Every object also carries a `list()` (the directory of its own functions), routed to the
 * {@link docsMod} carve-out. The `view` object is present whatever a run enables: it is the only way
 * material reaches the model's context window at all, documentation included. The session-ending calls are bound
 * from `ending`, one group per role, so a program has exactly the ending its role produces — a
 * reviewer gets a `review` object and no `finish`.
 * Everything goes through {@link guard}, so a call made from deferred work — which lands after the
 * turn is over — is reported.
 */
function buildScope(
  enabled: readonly string[],
  ending: EndingKind,
  library: boolean,
): Record<string, Record<string, unknown>> {
  const on = new Set(enabled);
  const objects = new Map<string, Record<string, unknown>>();
  // Fetch (creating on first use) the object for a namespace, seeding it with the `list()` directory
  // every object shares.
  const objectFor = (name: string): Record<string, unknown> => {
    let object = objects.get(name);
    if (!object) {
      object = { list: documented(guard("list", () => docsMod.listFunctions(name)), "list") };
      objects.set(name, object);
    }
    return object;
  };

  for (const entry of TOOL_CATALOGUE) {
    if (!on.has(entry.tool)) continue;
    const fn = lookup(MODULES[entry.module] ?? {}, entry.js);
    const object = OBJECT_FOR_MODULE[entry.module];
    if (fn && object) objectFor(object)[entry.js] = documented(guard(entry.js, fn), entry.js);
  }
  for (const helper of HELPER_CATALOGUE) {
    if (!on.has(helper.requires)) continue;
    const fn = lookup(HELPERS, helper.js);
    // A helper lives on the object of the tool it is built on.
    const required = TOOL_CATALOGUE.find((entry) => entry.tool === helper.requires);
    const object = required ? OBJECT_FOR_MODULE[required.module] : undefined;
    if (fn && object) objectFor(object)[helper.js] = documented(guard(helper.js, fn), helper.js);
  }

  // `view`: always present, on the same carve-out `harness` has — a run that enables no tools at all
  // must still be able to show its model something, and a view is the only channel that reaches it.
  // `openFile` is the one exception: it is a read, so it is bound exactly when `read_file` is, and a
  // run with reading withheld gets a `view` object without it rather than a side door into the
  // workspace.
  const view = objectFor(OBJECT_FOR_MODULE[VIEW_MODULE] ?? "view");
  for (const entry of VIEW_ENTRIES) {
    if (entry.requires !== undefined && !on.has(entry.requires)) continue;
    const fn = lookup(MODULES[VIEW_MODULE] ?? {}, entry.js);
    if (fn) view[entry.js] = documented(guard(entry.js, fn), entry.js);
  }

  // `programs`: the whole object, or no object at all. It is the one family a *capability* gates
  // rather than a tool or a role, so the host says so with a flag instead of a name in `enabled` —
  // but the enforcement is identical to every other family's: a run without the program library has
  // no `programs` in scope, not a `programs` whose calls are refused.
  if (library) {
    const programs = objectFor(OBJECT_FOR_MODULE[PROGRAM_MODULE] ?? "programs");
    for (const js of PROGRAM_ENTRIES) {
      const fn = lookup(MODULES[PROGRAM_MODULE] ?? {}, js);
      if (fn) programs[js] = documented(guard(js, fn), js);
    }
  }

  // The one ending group this role produces. Bound by the same rule the tools are: what is not this
  // role's ending is not a name in the program's scope.
  for (const entry of SESSION_ENTRIES) {
    if (entry.ending !== ending) continue;
    const fn = lookup(sessionMod as Readonly<Record<string, unknown>>, entry.js);
    if (fn) objectFor(entry.object)[entry.js] = documented(guard(entry.js, fn), entry.js);
  }

  return Object.fromEntries(objects);
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
  // Captured BEFORE `lib` and `ToolError` join the scope: the unknown-name hint lists the API
  // OBJECTS a program may reach (`fs`, `project`, `harness`, …). `lib` is not one — it holds no gg
  // functions and has no directory — so it is named separately rather than folded into a list that
  // would be false about it. A model offered `ToolError` there would likewise be pointed at a class
  // as though it were an API object.
  const callable = Object.keys(scope);
  // Built against the tool scope alone, then added to it: a module sees the same objects the program
  // does, and nothing sees a half-built `lib`.
  const lib = buildLib(modules, scope);
  if (lib) scope[LIB_OBJECT] = lib;
  // Bound so `catch (e) { if (e instanceof ToolError) … }` — the shape the system prompt teaches —
  // works inside a program.
  scope["ToolError"] = ToolError;
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
    feedback.reportError(describe(thrown, callable, lib !== undefined));
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
      // object form (`fs.readFile`), so answer the question it is about to ask: which objects does
      // it have? Each object's `list()` then names that object's functions.
      return {
        kind: "unknown-name",
        code: undefined,
        message:
          `${message}; API objects this run: ${names.join(", ")}` +
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
