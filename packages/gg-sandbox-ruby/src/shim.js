/**
 * The **Ruby guest's entry module**: an Opal runtime, gg's hand-written Ruby SDK, the libraries a
 * program may require, and the `run` that puts a program in front of them.
 *
 * A gg Ruby program never crosses the membrane as Ruby. It is compiled to JavaScript on the *host*,
 * by Opal, before it is handed over (`crates/gg/src/sandbox/language/ruby.compile.rs`), so what this
 * guest evaluates is JavaScript — but everything it evaluates it against is Ruby: the capability
 * modules are constants under `GG`, the types are declared inside them, a failure is a raised
 * `GG::Core::ToolError`, and a code module is a `Module` bound at `lib.<key>`.
 *
 * # Why the runtime and the SDK are imported at top level
 *
 * `componentize-js` runs this module's top level at BUILD time under `wizer` and snapshots the
 * resulting heap, so everything the three imports below allocate — Opal's corelib, every library's
 * module definition, every class this SDK declares — is built once, into the artifact, instead of
 * once per turn. Measured, on this repository's dev container, through gg's own store and linker:
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

// Opal's runtime, the curated libraries, and gg's Ruby SDK — vendored beside this file by
// `build.sh`, and imported for their side effects in this order because each needs the last.
import "./opal.js";
import "./libraries.js";
import "./gg.js";

import * as feedback from "test-cabinet:gg/feedback";
import * as board from "test-cabinet:gg/board";
import * as context from "test-cabinet:gg/context";
import * as delegation from "test-cabinet:gg/delegation";
import * as docs from "test-cabinet:gg/docs";
import * as files from "test-cabinet:gg/files";
import * as helpers from "test-cabinet:gg/helpers";
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
 * inline-JavaScript interop. Nothing here is model-facing — a program's scope is built by
 * `GG::Scope`, out of the capability modules, and `__ggWire` is not one of them.
 */
globalThis.__ggWire = {
  board,
  context,
  delegation,
  docs,
  files,
  helpers,
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
 * A failing `result<T, tool-error>` arrives as a bare object whose only own key is `payload`, so
 * both the thrown value and its payload are inspected. Anything that is not a membrane failure —
 * a `TypeError` out of the generated lowering, most often — is reported against the call that
 * raised it with `invalid-argument`, which supplies the one fact such an error is missing: which
 * call failed.
 *
 * @param {string} tool the gg call being made, for a throw that names none
 * @param {unknown} thrown whatever came out of the binding
 * @returns {{ tool: string, code: string, message: string }} the failure `GG::Wire` raises
 */
globalThis.__ggFailure = function (tool, thrown) {
  const nested = thrown === null || thrown === undefined ? undefined : thrown.payload;
  for (const candidate of [thrown, nested]) {
    if (candidate === null || typeof candidate !== "object") continue;
    if (
      typeof candidate.tool === "string" &&
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return candidate;
    }
  }
  return { tool, code: "invalid-argument", message: describe(thrown) };
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

/** One Ruby constant, by name, off the `GG` module. */
function gg(name) {
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
 * Ruby's own `sleep` is deliberately **not** here: Opal implements it as a busy wait, so it burns
 * the guest's fuel and the execution deadline reaches it like any other runaway — which is what a
 * ceiling is for.
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

/** Shadow every denied global with a thrower, and route `console` to gg's feedback channel. */
function installEnvironment() {
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
 * How many lines the `Function` constructor puts in front of a body, calibrated once per
 * instantiation. Measured at 2 on this engine; calibrated anyway so an engine update costs nothing.
 */
let bodyLineOffset;

function lineOffset() {
  if (bodyLineOffset !== undefined) return bodyLineOffset;
  bodyLineOffset = 2;
  try {
    new Function("throw new Error('calibrate')")();
  } catch (thrown) {
    const frame = firstProgramFrame(thrown);
    if (frame) bodyLineOffset = frame.line - 1;
  }
  return bodyLineOffset;
}

/** The first stack frame inside the constructed function, if the engine recorded one. */
function firstProgramFrame(thrown) {
  const stack = thrown === null || thrown === undefined ? undefined : thrown.stack;
  if (typeof stack !== "string") return undefined;
  for (const frame of stack.split("\n")) {
    const match = /Function:(\d+):(\d+)/.exec(frame);
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
 */
function locate(thrown, program) {
  const frame = firstProgramFrame(thrown);
  if (!frame) return undefined;
  const generated = frame.line - lineOffset();
  const mappings = sourceMap(program);
  if (!mappings) return undefined;
  const entries = mappings[generated - 1];
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
 * `TypeError` naming a compiled variable, and `describe` below is what renders it. A `GG::Core::ToolError`
 * is reported as the tool failure it is, carrying the membrane's own code, so gg classifies the turn
 * from the code rather than from what this guest made of the raise.
 *
 * A throw with no `$$class` is not a Ruby exception at all and is reported as what it is. Opal's
 * precompiled corelib is the one place that still produces one — it is outside gg's compile, so
 * `[1, 2].fetch` with no argument is a JavaScript `TypeError` rather than an `ArgumentError`.
 */
function report(thrown, program, modules, lib) {
  const location = locate(thrown, program);
  const klass = thrown && thrown.$$class ? String(thrown.$$class.$$name) : undefined;
  const message = klass === undefined ? describe(thrown) : String(Opal.send(thrown, "message"));

  if (klass === "ToolError") {
    const code = String(Opal.send(thrown, "code")).replace(/_/g, "-");
    const tool = String(Opal.send(thrown, "tool"));
    return {
      kind: "tool-failure",
      code,
      message: `\`${tool}\` failed (${code}): ${message}`,
      location,
    };
  }
  if (klass === "NoMethodError" || klass === "NameError") {
    // The most common cause is a program reaching for a name gg does not have, so answer the
    // question it is about to ask: what are the constants? Searching the documentation is how it
    // finds a function inside one.
    //
    // "GG's modules" rather than "modules this run", which is what this said while the SDK's scope
    // was built from the run. Every module is defined in every program now, so the list is the same
    // one every time and says nothing about what this run enabled — and a model told that *this
    // run* offers it the board and the task list writes a call into one and is refused for it.
    const lend = lib ? ", plus `lib` for loaded skill and memory code" : "";
    return {
      kind: "unknown-name",
      code: undefined,
      message: `${message}; GG's modules: ${modules.join(", ")}${lend}`,
      location,
    };
  }
  return {
    kind: "other",
    code: undefined,
    message: klass === undefined ? message : `${klass}: ${message}`,
    location,
  };
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
export function boundTools() {
  return Array.from(Opal.send(gg("Scope"), "bound_tools"));
}

/**
 * Evaluate one program against the whole SDK.
 *
 * `program` is the JavaScript Opal compiled on the host — the model's Ruby never reaches here —
 * with the source map that maps it back appended. `modules` is the code the agent loaded by reading
 * a code skill or a code memory, each already compiled and each wrapped by the host in the
 * `GG::Lib.define` call that makes its body a namespace.
 *
 * `enabled`, `ending` and `library` are **read by nothing here**. They used to build the surface;
 * the surface is now the whole SDK, bound at load into the baked heap, and every capability question
 * is answered at the membrane — the one place that can answer it the same way for all eleven
 * language arms. gg still sends them, because the WIT world is shared with ten sibling guests.
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
    // The module paths a program may reach, for the unknown-name hint alone. It is a constant: the
    // SDK is static, so every capability module carries every function it declares on every turn,
    // and which of them this agent may actually CALL is the host's answer rather than this guest's.
    const bound = Array.from(Opal.const_get_qualified(gg("Scope"), "MODULE_PATHS"));

    // Code modules are evaluated after the scope and before the program, so one may call
    // `GG::Files.read_file` like anything else, and each is given the same surface the program
    // gets.
    // A module that raises does not take the turn down: its author is whoever wrote the skill or
    // the memory, not the model whose program merely has it in scope.
    Opal.send(gg("Lib"), "reset");
    for (const module of modules) {
      try {
        new Function(module.source)();
      } catch (thrown) {
        const klass = thrown && thrown.$$class ? `${String(thrown.$$class.$$name)}: ` : "";
        const message = thrown && thrown.$$class
          ? String(Opal.send(thrown, "message"))
          : describe(thrown);
        feedback.reportModuleError(module.name, `${klass}${message}`);
      }
      // Named whether it succeeded or not: a module that raised binds an empty namespace, so a
      // program that calls into it gets a `NoMethodError` naming the member rather than a
      // `NoMethodError` naming `lib`.
      Opal.send(gg("Lib"), "bind", [module.name]);
    }
    const lib = Opal.send(gg("Scope"), "install_lib");

    try {
      new Function(program)();
    } catch (thrown) {
      feedback.reportError(report(thrown, program, bound, lib));
    }
  } catch (thrown) {
    // Everything above the program's own `catch` — building the surface, evaluating the modules —
    // is this guest's, and a throw out of it would otherwise escape as an opaque wasm trap: no
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
