/**
 * The **Ruby guest's entry module**: an Opal runtime, the requirable units a program may reach —
 * gg's hand-written Ruby SDK, the agent's own code, and the libraries — and the `run` that evaluates
 * one program.
 *
 * A gg Ruby program never crosses the membrane as Ruby. It is compiled to JavaScript on the *host*,
 * by Opal, before it is handed over (`crates/gg/src/sandbox/language/ruby.compile.rs`), so what this
 * guest evaluates is JavaScript — but everything it evaluates it against is Ruby: the capability
 * modules are constants under `GG`, the types are declared inside them, a failure is a raised
 * `GG::Core::ApiError`, and a code module is a `Module` bound at `lib.<key>`.
 *
 * # Nothing of gg's is loaded when a program starts
 *
 * The three imports below are Opal's runtime and two files of compiled Ruby that **register**
 * modules in Opal's require registry without running any of them: `gg` is gg's SDK, `lib` is the
 * code modules this agent read, and `libraries.js` is the set `src/library.rb` declares. A program
 * reaches any of them by writing Ruby's own `require`, and a program that writes none has no `GG`
 * constant, no `lib` and no `JSON` — it has Opal's corelib and its own text.
 *
 * # Why the runtime is imported at top level
 *
 * `componentize-js` runs this module's top level at BUILD time under `wizer` and snapshots the
 * resulting heap, so Opal's corelib — the dispatch tables, the exception hierarchy, `String`,
 * `Array`, `Hash` — is built once, into the artifact, instead of once per turn. Measured, on this
 * repository's dev container, through gg's own store and linker:
 *
 * | Where Opal's runtime lives | Per program |
 * | --- | --- |
 * | Prepended to the program, evaluated in the committed ECMAScript component | 45.6–51.0 ms |
 * | Imported here, so `componentize-js` pre-initialises it | **2.1–2.6 ms** |
 * | (a plain JavaScript program on that same component, for scale) | 1.2–1.4 ms |
 *
 * The imports are therefore not a convenience — they are the arm's per-turn cost.
 *
 * # What this file is, and what it deliberately is not
 *
 * It is **plumbing**. Every model-facing decision — what a function is called, what its arguments
 * are, what a result looks like, what a failure raises — is in `src/gg/`, in Ruby, where a Ruby
 * programmer can read it and where `tools/signatures.rb` reflects it out. What is here is the
 * three things a guest has to do that no SDK can: publish the membrane's bindings somewhere the
 * SDK can reach them, evaluate a program, and describe what happened when it did not finish.
 */

// Opal's runtime, then the two files of registered-but-unloaded modules: the curated libraries, and
// gg's own `gg` and `lib`. Vendored beside this file by `build.sh`, and imported for their side
// effects in this order because each needs the last.
import "./opal.js";
import "./libraries.js";
import "./gg.js";

import * as feedback from "test-cabinet:gg/feedback";
import * as board from "test-cabinet:gg/board";
import * as context from "test-cabinet:gg/context";
import * as delegation from "test-cabinet:gg/delegation";
import * as docs from "test-cabinet:gg/docs";
import * as files from "test-cabinet:gg/files";
import * as memories from "test-cabinet:gg/memories";
import * as programs from "test-cabinet:gg/programs";
import * as session from "test-cabinet:gg/session";
import * as shell from "test-cabinet:gg/shell";
import * as skills from "test-cabinet:gg/skills";
import * as tasks from "test-cabinet:gg/tasks";
import * as views from "test-cabinet:gg/views";

/**
 * The membrane, published where `GG::Wire` can reach it.
 *
 * The SDK is Ruby and the bindings are JavaScript modules, so there has to be one hand-off, and
 * this is it: one object, keyed by the interface name the WIT gives, read by Opal's
 * inline-JavaScript interop. It is not part of the surface `GG::Scope` builds: a program that
 * reaches it has written inline JavaScript to do so, and every call it makes is checked at the
 * membrane like any other.
 */
globalThis.__ggWire = {
  board,
  context,
  delegation,
  docs,
  files,
  memories,
  programs,
  session,
  shell,
  skills,
  tasks,
  views,
};

/**
 * The failure fields, dug out of whatever a binding threw.
 *
 * A failing `result<T, api-error>` arrives as a bare object whose only own key is `payload`, so
 * both the thrown value and its payload are inspected. Anything that is not a membrane failure —
 * a `TypeError` out of the generated lowering, most often — is reported against the call that
 * raised it with `invalid-argument`, which supplies the one fact such an error is missing: which
 * call failed.
 *
 * @param {string} operation the gg call being made, for a throw that names none
 * @param {unknown} thrown whatever came out of the binding
 * @returns {{ operation: string, code: string, message: string }} the failure `GG::Wire` raises
 */
globalThis.__ggFailure = function (operation, thrown) {
  const nested = thrown === null || thrown === undefined ? undefined : thrown.payload;
  for (const candidate of [thrown, nested]) {
    if (candidate === null || typeof candidate !== "object") continue;
    if (
      typeof candidate.operation === "string" &&
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return candidate;
    }
  }
  return { operation, code: "invalid-argument", message: describe(thrown) };
};

/**
 * Re-make a value the membrane returned in **this** realm, so Ruby's own methods are on it.
 *
 * The generated bindings run against a different set of intrinsics from this module's — the same
 * split that makes `instanceof Error` answer false for a binding-level fault — so an array they
 * built carries *their* `Array.prototype`, which Opal never patched. `list.map { … }` in a Ruby
 * program then fails with `$map is not a function`, on a value the program was handed rather than
 * one it built, which is the worst shape of failure available: correct Ruby, refused.
 *
 * Arrays are the whole of it. A record is read field by field by the SDK, so its prototype never
 * matters, and a string, number or boolean is a primitive whose methods are looked up in the realm
 * doing the looking.
 *
 * @param {unknown} value whatever crossed
 * @returns {unknown} the same value, with this realm's prototypes on every array in it
 */
globalThis.__ggAdopt = function (value) {
  return Array.isArray(value) ? Array.from(value, globalThis.__ggAdopt) : value;
};

/**
 * One Ruby constant, by name, off the `GG` module — **requiring gg's SDK first**.
 *
 * `require "gg"` is the model's line to write, and this guest never writes it on a program's
 * behalf. The two places this is called are neither of them a program's: `boundOperations` is a
 * drift gate gg runs in a unit test, and the unknown-name hint is composed *after* a program has
 * already failed, where loading the SDK changes nothing the program could observe.
 */
function gg(name) {
  Opal.require("gg");
  const root = Opal.const_get_relative([], "GG");
  return Opal.const_get_qualified(root, name);
}

/** Whatever a thrown value has to say for itself, when it is not a membrane failure. */
function describe(thrown) {
  if (thrown === null || thrown === undefined) return String(thrown);
  // Error-like rather than `instanceof Error`: a fault raised inside the generated bindings comes
  // from another realm, so `instanceof` answers false and the message — the only line that says
  // what went wrong — is lost.
  const name = typeof thrown.name === "string" ? thrown.name : undefined;
  const message = typeof thrown.message === "string" ? thrown.message : undefined;
  if (name !== undefined && message !== undefined) return `${name}: ${message}`;
  if (message !== undefined) return message;
  try {
    return String(thrown);
  } catch {
    return "a value that could not be described";
  }
}

/** How much of a partial line is held before it is flushed as one anyway. */
const MAX_HELD = 8192;

/**
 * Point Ruby's `$stdout` and `$stderr` at `console`, and hand back the flush for what is left over.
 *
 * This is not optional plumbing, and it is not what a browser Opal build already does. Opal's
 * runtime picks its write procedure **once, at load**, and captures the `console` it can see at
 * that moment — which here is the one that existed while `wizer` was pre-initialising the
 * component, not the one this file rebinds to `feedback.log` at the start of every `run`. Without
 * this, a program's `puts` goes to an object frozen into the snapshot and the operator sees nothing
 * at all. It was measured that way before it was fixed: `puts "hello"` produced an empty log.
 *
 * **Lines, not writes.** `puts` reaches a write procedure more than once — the argument, then the
 * newline — and `print` may never send one at all, while gg's feedback channel is line-oriented:
 * one call, one line in the run's record. So writes are buffered and split on newlines, and what a
 * program `print`ed without ever ending the line is flushed when the program ends rather than
 * dropped.
 */
function attachStreams() {
  let held = "";
  const write = (text) => {
    held += String(text);
    let newline = held.indexOf("\n");
    while (newline >= 0) {
      globalThis.console.log(held.slice(0, newline));
      held = held.slice(newline + 1);
      newline = held.indexOf("\n");
    }
    // A program that writes a great deal without a newline must not grow the buffer without bound.
    if (held.length > MAX_HELD) {
      globalThis.console.log(held);
      held = "";
    }
  };

  for (const name of ["STDOUT", "STDERR"]) {
    try {
      const stream = Opal.const_get_qualified(Opal.const_get_relative([], "Object"), name);
      stream["$write_proc="](write);
    } catch {
      // Deliberately empty. A runtime that has renamed its streams is one whose programs log
      // nothing; it is not a reason to fail every turn before the program has run.
    }
  }

  return () => {
    if (held.length > 0) {
      globalThis.console.log(held);
      held = "";
    }
  };
}

/**
 * The globals this engine defines but that this component cannot honour, mapped to the reason.
 *
 * A Ruby program reaches none of these by writing Ruby — it reaches them by writing inline
 * JavaScript, which Opal lets it do with backticks. That is a narrower door than the ECMAScript
 * arm's and the throwers are here for the same reason all the same: `fetch` is *defined* by this
 * engine and its WASI import is not, so an unshadowed call **traps the whole store** rather than
 * failing, and a trap is uncatchable — no `feedback` call happens and the model is told only that
 * the sandbox trapped. The timers are the quieter half: they accept a callback, return a handle,
 * and never fire it, because `run` is synchronous and nothing polls after it returns.
 *
 * Ruby's own `sleep` is deliberately **not** here: Opal implements it as a busy wait, so the
 * execution deadline reaches it like any other runaway — which is what a ceiling is for.
 */
const DENIED_GLOBALS = [
  ["setTimeout", "there is no event loop, so a scheduled callback would never run"],
  ["setInterval", "there is no event loop, so a scheduled callback would never run"],
  ["clearTimeout", "there is no event loop, so a scheduled callback would never run"],
  ["clearInterval", "there is no event loop, so a scheduled callback would never run"],
  ["queueMicrotask", "deferred work is not part of your program's result"],
  ["requestAnimationFrame", "there is no event loop, so a scheduled callback would never run"],
  ["fetch", "this program's runtime is built without an HTTP client"],
];

/**
 * Replace a global with `value`, whatever kind of property it is.
 *
 * A plain assignment is not enough: some globals in this engine are accessor properties with no
 * setter, and assigning to one throws out of the shim's own setup, which `componentize-js` turns
 * into an opaque trap — i.e. exactly the failure this function exists to prevent.
 */
function replaceGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch {
    // Deliberately empty: one unreplaceable name must not take the whole turn down.
  }
}

/**
 * End the program the way `Kernel#exit` ends a Ruby one.
 *
 * `Kernel#exit` runs the `at_exit` blocks, coerces its argument to an Integer and hands it to
 * `Opal.exit`, which Opal leaves for its host to supply — and on a host that supplies nothing it is
 * a no-op that logs under `$DEBUG`, so `exit 1` returned `nil` and the next statement ran. A model
 * that wrote `exit 1` had its program read as the opposite of what it said and the turn recorded as
 * a success.
 *
 * A `SystemExit` carrying the status is what CRuby raises there, so it is what this supplies. It is
 * not caught: it unwinds the program the way any other exception does and is reported by `report`,
 * which is the whole of D8a's "let the program die the way its runtime kills it".
 *
 * `status` and `success?` are defined on the raised object because Opal's `SystemExit` has neither
 * and a program that rescues one asks for both. `abort` and `exit!` are Ruby's other two spellings
 * of the same ending and Opal defines neither, so a model that reached for either had its program
 * fail on the spelling rather than end on it.
 */
function installExit() {
  const systemExit = () => Opal.const_get_relative([], "SystemExit");
  const raise = (status) => {
    const error = Opal.send(systemExit(), "new", [status]);
    error.$status = () => status;
    error["$success?"] = () => status === 0;
    throw error;
  };
  Opal.exit = raise;
  // `exit!` skips the `at_exit` blocks `Kernel#exit` runs, and `abort` writes its message to
  // standard error first and ends with status 1. Both are defined on the object the program's own
  // top level runs as, which is where `Kernel`'s private instance methods are reached from.
  const kernel = Opal.const_get_relative([], "Kernel");
  Opal.def(kernel, "$exit!", function (status) {
    raise(status === undefined || status === null ? 0 : status);
  });
  Opal.def(kernel, "$abort", function (message) {
    if (message !== undefined && message !== null) {
      feedback.log(String(message));
    }
    raise(1);
  });
}

/** Shadow every denied global with a thrower, and route `console` to gg's feedback channel. */
function installEnvironment() {
  installExit();
  for (const [name, why] of DENIED_GLOBALS) {
    replaceGlobal(name, () => {
      throw new Error(`${name} is not available in the sandbox: ${why}`);
    });
  }
  const emit = (args) => feedback.log(args.map((arg) => renderLog(arg)).join(" "));
  const sink = {
    log: (...args) => emit(args),
    info: (...args) => emit(args),
    warn: (...args) => emit(args),
    error: (...args) => emit(args),
    debug: (...args) => emit(args),
    trace: (...args) => emit(args),
    dir: (...args) => emit(args),
  };
  replaceGlobal("console", sink);
}

/** One logged argument, as a line of text. Ruby has already rendered its own. */
function renderLog(arg) {
  return typeof arg === "string" ? arg : describe(arg);
}

// ------------------------------------------------------------------------------------------------
// Where in the model's Ruby it happened
// ------------------------------------------------------------------------------------------------

/**
 * The name the **program's** compiled JavaScript is evaluated under, so that its stack frames say
 * which unit they came from.
 *
 * Everything this guest evaluates goes through one `eval`, and the engine files every one of them
 * under the same name — `eval` — so a frame from a code module and a frame
 * from the program would be indistinguishable. That is not a cosmetic gap: a module is compiled
 * separately and carries its **own** source map, so a raise inside `lib.<key>` mapped through the
 * program's map produced a Ruby line number that was plausible, was in the model's own file, and
 * was wrong. `//# sourceURL` renames the unit, and a frame therefore carries where it is from.
 */
const PROGRAM_UNIT = "gg-program";

/**
 * What a code module's compiled JavaScript is evaluated under. Never [`PROGRAM_UNIT`].
 *
 * A module's binding key is `[a-z0-9_]` by the time gg sends it, so it cannot end the comment this
 * name is written into or introduce a line of its own.
 */
function moduleUnit(name) {
  return `gg-module-${name}`;
}

/**
 * `source`, named so that the engine files the frames of everything in it under `unit`.
 *
 * Appended rather than prepended, because a line added above the body would move every line of it
 * and falsify the map the compile emitted.
 */
function named(source, unit) {
  return `${source}\n//# sourceURL=${unit}\n`;
}

/**
 * Evaluate one compiled unit **at its own coordinates**, and hand back what it evaluated to.
 *
 * An indirect `eval` rather than the `Function` constructor, and that is the whole point of it: a
 * `Function` body is spliced into a function the engine writes, so line 1 of the compiled
 * JavaScript is line 3 of what the engine reports, and reaching the map's coordinates from a frame
 * meant subtracting a number this file had calibrated for itself. A source map is the only thing
 * allowed to move a location, so the subtraction had to go rather than be made more accurate. Here
 * a frame's line **is** the compiled unit's line, and the map does the rest.
 *
 * The completion value is the unit's own last expression — `Opal.queue` hands back what the queued
 * body returned — which is how a code module's namespace is collected without gg naming anything
 * inside the module's own source.
 */
function evaluateUnit(source, unit) {
  return (0, eval)(named(source, unit));
}

/**
 * The innermost stack frame belonging to `unit`, if the engine recorded one.
 *
 * Innermost **of that unit**, rather than innermost of the stack: a raise inside a code module, or
 * inside Opal's baked corelib, leaves frames of its own above the program's, and the one this
 * guest can honestly locate is the program's own — the line the model wrote that led there. A
 * frame from anywhere else is skipped rather than mapped, because the map it would be mapped
 * through is not the map it was compiled with.
 */
function firstFrameIn(thrown, unit) {
  const stack = thrown === null || thrown === undefined ? undefined : thrown.stack;
  if (typeof stack !== "string") return undefined;
  // `unit` is one of this file's own constants, so it carries no regular-expression syntax.
  const marker = new RegExp(`${unit}:(\\d+):(\\d+)`);
  for (const frame of stack.split("\n")) {
    const match = marker.exec(frame);
    if (match) return { line: Number(match[1]), column: Number(match[2]) };
  }
  return undefined;
}

/** Base64 alphabet positions, for the VLQ decoder below. */
const BASE64 = new Map(
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]),
);

/**
 * A source map's `mappings`, decoded into one array of `[generatedColumn, originalLine]` per
 * generated line.
 *
 * Only the two fields a location needs are kept. This is the whole of what maps a guest backtrace
 * back into the coordinates the model wrote in, and it is why the compile driver emits a map at
 * all: without it a located Ruby error points at a line of a file the model never saw.
 */
function decodeMappings(mappings) {
  const lines = [];
  let originalLine = 0;
  for (const segment of mappings.split(";")) {
    const entries = [];
    let generatedColumn = 0;
    for (const field of segment.split(",")) {
      if (field.length === 0) continue;
      const values = [];
      let shift = 0;
      let value = 0;
      for (const character of field) {
        const digit = BASE64.get(character);
        if (digit === undefined) return lines;
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
          continue;
        }
        const negative = value & 1;
        value >>= 1;
        values.push(negative ? -value : value);
        shift = 0;
        value = 0;
      }
      generatedColumn += values[0] ?? 0;
      if (values.length >= 4) {
        originalLine += values[2] ?? 0;
        entries.push([generatedColumn, originalLine]);
      }
    }
    lines.push(entries);
  }
  return lines;
}

/** The `//# sourceMappingURL=data:…;base64,…` the compile driver appended, decoded, or undefined. */
function sourceMap(program) {
  const match = /\/\/# sourceMappingURL=data:[^,]*;base64,([A-Za-z0-9+/=]+)\s*$/.exec(program);
  if (!match) return undefined;
  try {
    const json = JSON.parse(atob(match[1]));
    return typeof json.mappings === "string" ? decodeMappings(json.mappings) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where in the **model's Ruby** a throw happened, as the sentence gg reports.
 *
 * The frame is a position in the compiled JavaScript, so it is mapped through the source map the
 * compile emitted; a program with no map, or a frame the map does not cover, reports no location
 * at all rather than a line of a file nobody wrote.
 *
 * The frame is the program's own, [by name](firstFrameIn), and `program`'s map is therefore the map
 * that unit was compiled with. A raise inside a code module is located at the line of the model's
 * program that called into it — which is a line the model wrote and can act on — rather than at the
 * module's own line read through somebody else's map.
 */
function locate(thrown, program) {
  const frame = firstFrameIn(thrown, PROGRAM_UNIT);
  if (!frame) return undefined;
  const mappings = sourceMap(program);
  if (!mappings) return undefined;
  const entries = mappings[frame.line - 1];
  if (!entries || entries.length === 0) return undefined;
  let original = entries[0][1];
  for (const [column, line] of entries) {
    if (column > frame.column) break;
    original = line;
  }
  return `line ${original + 1}`;
}

/**
 * Turn whatever a program raised into the report gg feeds back to the model.
 *
 * The class and the message are Ruby's own — `ArgumentError: wrong number of arguments` — because
 * that is the sentence the model can act on, and it is a *different* sentence from the compiled
 * JavaScript's `TypeError`. That is only true because gg compiles both the model's program and the
 * SDK with `arity_check`; with Opal's default the same mistake arrives here as a raw JavaScript
 * `TypeError` naming a compiled variable, and `describe` below is what renders it. A
 * `GG::Core::ApiError` is reported as the API failure it is, carrying the membrane's own code, so
 * gg classifies the turn from the code rather than from what this guest made of the raise.
 *
 * A throw with no `$$class` is not a Ruby exception at all and is reported as what it is. Opal's
 * precompiled corelib is the one place that still produces one — it is outside gg's compile, so
 * `[1, 2].fetch` with no argument is a JavaScript `TypeError` rather than an `ArgumentError`.
 */
function report(thrown, program, lib) {
  const location = locate(thrown, program);
  const klass = thrown && thrown.$$class ? String(thrown.$$class.$$name) : undefined;
  const message = klass === undefined ? describe(thrown) : String(Opal.send(thrown, "message"));

  if (klass === "ApiError") {
    const code = String(Opal.send(thrown, "code")).replace(/_/g, "-");
    const operation = String(Opal.send(thrown, "operation"));
    return {
      kind: "api-failure",
      code,
      message: `\`${operation}\` failed (${code}): ${message}`,
      location,
    };
  }
  if (klass === "NoMethodError" || klass === "NameError") {
    // The hint is a REMEDY, so it is only written where it is one: the name that could not be
    // resolved is gg's own or the code the agent has read, and nothing has loaded it yet. A model
    // whose `nil.upcase` failed, or one that already wrote the require, is told to write a line
    // that cannot fix its program — which is tokens spent to say something untrue.
    const missing = missingName(thrown);
    if ((missing === "GG" || missing === "lib") && !alreadyLoaded(missing)) {
      const lend = lib ? ", and `require \"lib\"` for the code you have read" : "";
      return {
        kind: "unknown-name",
        code: undefined,
        message: `${message}; \`require "gg"\` reaches ${modulePaths().join(", ")}${lend}`,
        location,
      };
    }
    return { kind: "unknown-name", code: undefined, message, location };
  }
  return {
    kind: "other",
    code: undefined,
    message: klass === undefined ? message : `${klass}: ${message}`,
    location,
  };
}

// ------------------------------------------------------------------------------------------------
// The code modules this run read, and the `lib` a program requires to reach them
// ------------------------------------------------------------------------------------------------

/**
 * The code the agent loaded by reading a code skill or a code memory, as gg handed it over: each
 * already compiled, each wrapped by the host so that evaluating it yields a namespace.
 *
 * Held rather than evaluated, because evaluating one runs somebody's Ruby — and a module whose own
 * body calls gg writes `require "gg"`, which would put gg's surface in front of a program that
 * wrote no such line. Nothing here runs until the program requires `lib`.
 */
let pendingModules = [];

/**
 * Evaluate every held code module and hand back the namespaces, keyed by binding key.
 *
 * Called from `src/knowledge.rb` — the `lib` a program requires — and from nowhere else, so a
 * program that never writes `require "lib"` never runs a line of anybody's skill.
 *
 * A module that raises does not take the turn down: its author is whoever wrote the skill or the
 * memory, not the model whose program merely has it in scope. It is reported on its own channel and
 * bound to an empty namespace, so a program that calls into it gets a `NoMethodError` naming the
 * member it wanted rather than one naming `lib`.
 *
 * @returns {unknown} a Ruby `Hash` of binding key to `Module`
 */
globalThis.__ggBindModules = function () {
  const keys = [];
  const namespaces = {};
  for (const module of pendingModules) {
    let namespace;
    try {
      // Named, so that a frame raised inside this module later — while the program is running,
      // through `lib.<key>` — is recognisable as not the program's and is not read through the
      // program's source map. The unit's own last expression is the namespace its wrapper built.
      namespace = evaluateUnit(module.source, moduleUnit(module.name));
      Opal.send(namespace, "extend", [namespace]);
    } catch (thrown) {
      const klass = thrown && thrown.$$class ? `${String(thrown.$$class.$$name)}: ` : "";
      const message = thrown && thrown.$$class
        ? String(Opal.send(thrown, "message"))
        : describe(thrown);
      feedback.reportModuleError(module.name, `${klass}${message}`);
      namespace = Opal.send(Opal.const_get_relative([], "Module"), "new");
    }
    keys.push(module.name);
    namespaces[module.name] = namespace;
  }
  return Opal.hash2(keys, namespaces);
};

/**
 * The name a `NameError` or a `NoMethodError` could not resolve, or `undefined` where the exception
 * does not carry one.
 *
 * Read through Ruby's own `NameError#name` rather than off the message, because the message is
 * Opal's wording and a hint that keyed on it would be a second statement of what the exception
 * already says. A failure to read it costs the hint and nothing else.
 */
function missingName(thrown) {
  try {
    const name = Opal.send(thrown, "name");
    return name === null || name === undefined ? undefined : String(name);
  } catch {
    return undefined;
  }
}

/**
 * Whether the name the hint would tell a program to reach for is already there — which makes the
 * hint a remedy for a failure that has some other cause.
 */
function alreadyLoaded(missing) {
  const root = Opal.Object.$$const || {};
  return missing === "GG" ? root.GG !== undefined : root.Lib !== undefined;
}

/**
 * The capability modules gg's SDK declares, for the unknown-name hint alone.
 *
 * A constant list: the SDK is static, so every capability module carries every function it declares
 * on every turn, and which of them this agent may actually CALL is the host's answer rather than
 * this guest's.
 */
function modulePaths() {
  try {
    return Array.from(Opal.const_get_qualified(gg("Scope"), "MODULE_PATHS"));
  } catch {
    // A hint is not worth a second failure on top of the one being reported.
    return [];
  }
}

// ------------------------------------------------------------------------------------------------
// The exports
// ------------------------------------------------------------------------------------------------

/**
 * The gg tool names this component can bind, answered by the SDK's own catalogue.
 *
 * gg calls this in a unit test and asserts set-equality with its own tool vocabulary. It is the one
 * drift gate that inspects the **committed artifact** rather than a source file, so it catches a
 * tool added, renamed or removed in gg with a stale `.wasm` still checked in.
 */
export function boundOperations() {
  return Array.from(Opal.send(gg("Scope"), "bound_operations"));
}

/**
 * Evaluate one program.
 *
 * `program` is the JavaScript Opal compiled on the host — the model's Ruby never reaches here —
 * with the source map that maps it back appended. `modules` is the code the agent loaded by reading
 * a code skill or a code memory, each already compiled and each wrapped by the host so that
 * evaluating it yields a namespace. None of it is evaluated unless the program requires `lib`.
 *
 * **Nothing of gg's is in scope when the first line runs.** `gg` and `lib` are registered in Opal's
 * require registry and not loaded, so the program reaches either one by writing its own `require`,
 * and one that writes neither has Opal's corelib and its own text.
 *
 * `enabled`, `ending` and `library` are **read by nothing here**. They used to build the surface;
 * the surface is now the whole SDK, and every capability question is answered at the membrane — the
 * one place that can answer it the same way for all eleven language arms. gg still sends them,
 * because the WIT world is shared with ten sibling guests.
 *
 * Nothing comes back: a raise is reported over `feedback.report-error` rather than being allowed to
 * escape as an opaque wasm trap, everything a program wanted to show itself it opened a view of,
 * and an ending is a flag the host already holds. A **returned value is discarded**, and Ruby
 * returns the value of the last expression from every program, so — unlike the ECMAScript arm —
 * there is nothing here to note: a Ruby program cannot help returning something, and telling a
 * model its last expression was ignored would be a sentence on every single turn.
 */
export function run(program, modules, _enabled, _ending, _library) {
  installEnvironment();
  const flush = attachStreams();
  try {
    pendingModules = modules;

    try {
      // Named, so that a frame this guest locates is a frame of THIS unit — `program`'s source map
      // is the only map it has — and a frame raised inside a code module is recognisably not it.
      evaluateUnit(program, PROGRAM_UNIT);
    } catch (thrown) {
      feedback.reportError(report(thrown, program, modules.length > 0));
    }
  } catch (thrown) {
    // Everything outside the program's own `catch` is this guest's, and a throw out of it would
    // otherwise escape as an opaque wasm trap: no
    // `feedback` call, nothing in the run record, and a model told only that the sandbox stopped.
    // Reported instead, on its own terms, so the failure names itself.
    feedback.reportError({
      kind: "other",
      code: undefined,
      message: `the Ruby guest could not prepare this program: ${
        thrown && thrown.$$class
          ? `${String(thrown.$$class.$$name)}: ${String(Opal.send(thrown, "message"))}`
          : describe(thrown)
      }`,
      location: undefined,
    });
  } finally {
    // A program that raised still wrote what it wrote, and a partial line held at the moment of the
    // raise is often the most useful line in the run.
    flush();
  }
}
