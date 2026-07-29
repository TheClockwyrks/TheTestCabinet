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
 * is discarded and the model is told once ({@link feedback.noteReturn}) that it was: `console.log`
 * is the one channel, which is why there is no serialisation to fail, no depth limit to explain, and
 * no rule about what a program may hand back. Ending the run is likewise not this file's business —
 * `finish` returns like any other call and the *host* owns the flag it sets, so there is no unwind
 * to recognise and nothing here to reset between programs.
 */

import * as feedback from "test-cabinet:gg/feedback";
import type { ProgramError } from "test-cabinet:gg/feedback";
import type { EndingKind } from "./catalogue.js";
import {
  HELPER_CATALOGUE,
  OBJECT_FOR_MODULE,
  SESSION_ENTRIES,
  TOOL_CATALOGUE,
} from "./catalogue.js";
import { ToolError, asToolError } from "./errors.js";
import * as helpers from "./helpers.js";
import * as sessionMod from "./session.js";
import * as boardMod from "./tools/board.js";
import * as contextMod from "./tools/context.js";
import * as delegationMod from "./tools/delegation.js";
import * as docsMod from "./tools/docs.js";
import * as filesMod from "./tools/files.js";
import * as memoriesMod from "./tools/memories.js";
import * as shellMod from "./tools/shell.js";
import * as skillsMod from "./tools/skills.js";
import * as tasksMod from "./tools/tasks.js";

/** A bound tool or helper, as the shim handles it: names and arities are the SDK's business. */
type ToolFn = (...args: unknown[]) => unknown;

/**
 * The SDK modules, keyed by the `module` field of {@link TOOL_CATALOGUE}.
 *
 * Every module is imported unconditionally — the component is baked once, so there is nothing to
 * gain by importing lazily, and a static import is what lets `componentize-js` resolve the membrane
 * specifiers at build time.
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
  ["fetch", "there is no network — use `shell` if you truly need one"],
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

/** Closes every denial message, because every denial has the same underlying cause. */
const SYNCHRONOUS_NOTE =
  "Every tool function is synchronous and returns its value directly — call it directly.";

/** A function that throws the denial for `name`, with the reason and the shared closing note. */
function denier(name: string, why: string): () => never {
  return () => {
    throw new Error(`${name} is not available in the sandbox: ${why}. ${SYNCHRONOUS_NOTE}`);
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
 * `console.log` are the same channel, and gg shows the model the tail of it.
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
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
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
    `\`${name}\` ran AFTER your program ended, from work you deferred with \`.then()\` or ` +
      "after an `await`. Deferred work is outside your turn and its failures are not reported. " +
      "Write straight-line synchronous code.",
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
    return fn(...args);
  };
}

/** The non-enumerable key a bound function carries the name `harness.readDocs` fetches its docs by. */
const DOCS_NAME = Symbol("gg.docsName");

/**
 * Wrap a bound function so its documentation is reachable two ways: `fn.docs()` fetches it, and
 * `harness.readDocs(fn)` finds the name to fetch it by. `name` is the name a program calls the
 * function by (`readFile`, `finish`, `list`), which is what the host's doc directory is keyed on.
 *
 * `.docs` is a non-enumerable property so it never shows up when a model iterates an object, and the
 * name is a `Symbol` for the same reason — neither is part of the callable surface, only reachable
 * when asked for by name.
 */
function documented(fn: ToolFn, name: string): ToolFn {
  const wrapped: ToolFn = (...args) => fn(...args);
  Object.defineProperty(wrapped, "docs", { value: () => docsMod.readDoc(name) });
  Object.defineProperty(wrapped, DOCS_NAME, { value: name });
  return wrapped;
}

/**
 * `harness.readDocs`: fetch a function's documentation given the function itself (`readDocs(fs.readFile)`)
 * or its name (`readDocs("readFile")`). The equivalent of `fn.docs()`, for a model that reaches for a
 * top-level call instead of a method on the function.
 */
function readDocs(target: unknown): string {
  const name =
    typeof target === "string"
      ? target
      : (target as Record<symbol, unknown> | null | undefined)?.[DOCS_NAME];
  return docsMod.readDoc(typeof name === "string" ? name : String(name));
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
 * Every object also carries a `list()` (the directory of its own functions), and every bound
 * function carries a `.docs()` — both routed to the {@link docsMod} carve-out. The `harness` object
 * is present whatever a run enables, because it holds `readDocs`. The session-ending calls are bound
 * from `ending`, one group per role, so a program has exactly the ending its role produces — a
 * reviewer gets a `review` object and no `finish`, a judge a `judge` object and no `finish`.
 * Everything goes through {@link guard}, so a call made from deferred work — which lands after the
 * turn is over — is reported.
 */
function buildScope(
  enabled: readonly string[],
  ending: EndingKind,
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

  // `harness`: always present, because `readDocs` is always available.
  const harness = objectFor(OBJECT_FOR_MODULE["session"] ?? "harness");
  harness["readDocs"] = documented(guard("readDocs", readDocs as ToolFn), "readDocs");

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
 * Evaluate one program against exactly the tools this run enables.
 *
 * `program` is JavaScript: gg type-stripped the model's TypeScript before it got here. `enabled` is
 * the run's gg tool names and `ending` the agent's role, which together are the whole scope. Nothing
 * comes back: a throw is reported over `feedback.report-error` rather than being allowed to escape as
 * an opaque wasm trap, everything a program wanted to say it said with `console.log`, and an ending
 * is a flag the host already holds.
 *
 * A **returned value is discarded**, and {@link feedback.noteReturn} is how the model learns that
 * rather than by noticing an absence. Discarding it is what makes the rule one sentence — log what
 * you want to see — and it costs a program nothing: there is no value it could return that it could
 * not log.
 */
export function run(program: string, enabled: string[], ending: EndingKind): void {
  installConsole();
  installDenials();
  ended = false;
  deferredNoted = false;

  const scope: Record<string, unknown> = buildScope(enabled, ending);
  // Captured BEFORE `ToolError` joins the scope: the unknown-name hint lists the OBJECTS a program
  // may reach (`fs`, `project`, `harness`, …), and a model offered `ToolError` there would be
  // pointed at a class as though it were an API object.
  const callable = Object.keys(scope);
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
        message:
          "your program returned a Promise. Every tool function is synchronous and returns its " +
          "value directly — remove `async` and `await`, and `console.log` what you want to see.",
        location: undefined,
      });
      return;
    }
    if (value !== undefined) feedback.noteReturn();
  } catch (thrown) {
    ended = true;
    feedback.reportError(describe(thrown, callable));
  }
}

/**
 * Turn whatever a program threw into the report gg feeds back to the model.
 *
 * The message is rendered as `${name}: ${message}` rather than from `err.stack`, because this
 * engine's stack does **not** begin with the name and message — reporting the stack alone would lose
 * the one line that says what went wrong.
 */
function describe(thrown: unknown, names: readonly string[]): ProgramError {
  const err = asToolError(thrown);
  const frame = firstProgramFrame(err);
  const location = frame ? `line ${frame.line - lineOffset()}, column ${frame.column}` : undefined;
  if (err instanceof ToolError) {
    return {
      kind: "tool-failure",
      message: `\`${err.tool}\` failed (${err.code}): ${err.message}`,
      location,
    };
  }
  if (err instanceof ReferenceError) {
    // The most common cause is a program reaching for a flat name (`readFile`) instead of the
    // object form (`fs.readFile`), so answer the question it is about to ask: which objects does it
    // have? Each object's `list()` then names that object's functions.
    return {
      kind: "unknown-name",
      message:
        `${err.message}. The API objects available to your program this run are: ` +
        `${names.join(", ")}. Call \`<object>.list()\` to see an object's functions.`,
      location,
    };
  }
  if (err instanceof Error) {
    return { kind: "other", message: `${err.name}: ${err.message}`, location };
  }
  let message: string;
  try {
    message = typeof err === "string" ? err : (JSON.stringify(err) ?? String(err));
  } catch {
    message = String(err);
  }
  return { kind: "other", message, location };
}

/** Whether a value is a Promise (or anything else with a `then`), which a program must not return. */
function isThenable(value: unknown): boolean {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function";
}
