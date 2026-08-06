/**
 * The **Ruby guest's entry module** — the ECMAScript sandbox with a Ruby runtime baked into it.
 *
 * A gg Ruby program never crosses the membrane as Ruby. It is compiled to JavaScript on the *host*,
 * by Opal, before it is handed over (`crates/gg/src/sandbox/language/ruby.compile.rs`), so what this
 * guest evaluates is JavaScript — which is why this file re-exports the ECMAScript guest's `run`
 * verbatim rather than reimplementing it. What a program written in Ruby needs that a program
 * written in TypeScript does not is exactly two things, and they are the whole of this file:
 *
 * 1. **Opal's runtime has to be here already.** Compiled Ruby is a thin skin over `Opal.*`: every
 *    method definition, every `send`, every corelib class. That runtime is 743 KB of JavaScript, and
 *    where it lives is the difference between an arm that costs what the JavaScript arm costs and an
 *    arm that pays a fixed tax on every single turn. Measured, on this repository's dev container,
 *    through gg's own store and linker:
 *
 *    | Where the runtime lives | Per program |
 *    | --- | --- |
 *    | Prepended to the program, evaluated in the committed ECMAScript component | 45.6–51.0 ms |
 *    | Imported here, so `componentize-js` pre-initialises it | **2.1–2.6 ms** |
 *    | (a plain JavaScript program on this same component, for scale) | 1.2–1.4 ms |
 *
 *    `componentize-js` runs this module's top level at BUILD time under `wizer` and snapshots the
 *    resulting heap, so the corelib is built once, into the artifact, instead of once per turn. The
 *    import below is therefore not a convenience — it is the arm's per-turn cost.
 *
 * 2. **Ruby's output streams have to reach gg.** See {@link attachStreams}.
 *
 * # Why the compiled program can see `Opal` at all
 *
 * The ECMAScript guest evaluates a program as `new Function(...names, source)`, whose parameters are
 * the run's API objects. `Opal` is not one of them and must not become one: the objects a program
 * receives are the surface a cross-language study holds constant. It does not need to be. Opal's
 * runtime installs itself on `globalThis`, and a free identifier in a constructed function resolves
 * through the global scope — so the `Opal` that compiled Ruby references is found without a name
 * being added to any program's scope, and without this component differing from the ECMAScript one
 * in what a program is *offered*.
 *
 * That is also why this is a **separate committed component** rather than the Opal runtime being
 * added to `packages/gg-sandbox`. Baking it into the shared artifact would put `globalThis.Opal` in
 * front of the TypeScript and JavaScript arms too — and those two must differ in the type check and
 * in nothing else, where a checked program cannot name `Opal` (no declaration covers it) and an
 * unchecked one can.
 */

// Opal's runtime, vendored by `build.sh` beside this file. Imported for its side effect — it defines
// `globalThis.Opal` — and imported at TOP LEVEL on purpose: this is the line `wizer` executes at
// build time, and everything it allocates is in the artifact rather than in every turn.
import "./opal.js";

import { run as evaluate } from "../../gg-sandbox/dist/shim.js";

// The gg tool names this component binds, unchanged: this guest is the ECMAScript guest, so it binds
// exactly what that one binds, and gg's bijection check against its own tool vocabulary covers both.
export { boundTools } from "../../gg-sandbox/dist/shim.js";

/** How much of a partial line is held before it is flushed as one anyway. */
const MAX_HELD = 8192;

/**
 * Point Ruby's `$stdout` and `$stderr` at `console`, and hand back the flush for what is left over.
 *
 * This is not optional plumbing, and it is not what a browser Opal build already does. Opal's
 * runtime picks its write procedure **once, at load**, and captures the `console` it can see at that
 * moment — which here is the one that existed while `wizer` was pre-initialising the component, not
 * the one the shim rebinds to `feedback.log` at the start of every `run`. Without this, a program's
 * `puts` goes to an object frozen into the snapshot and the operator sees nothing at all. It was
 * measured that way before it was fixed: `puts "hello"` produced an empty log.
 *
 * The procedures are re-pointed on every run rather than once, because `run` is called many times
 * against one instantiation and each call rebinds `console` again.
 *
 * **Lines, not writes.** `puts` reaches a write procedure more than once — the argument, then the
 * newline — and `print` may never send one at all, while gg's feedback channel is line-oriented:
 * one call, one line in the run's record. So writes are buffered and split on newlines, and what a
 * program `print`ed without ever ending the line is flushed when the program ends rather than
 * dropped. That is the same treatment the Python guest gives its stream, for the same reason.
 */
function attachStreams() {
  const runtime = globalThis.Opal;
  if (!runtime) return () => {};

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
      const stream = runtime.const_get_qualified(runtime.const_get_relative([], "Object"), name);
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
 * Evaluate one program, exactly as the ECMAScript guest does, with Ruby's streams connected.
 *
 * `program` is the JavaScript Opal compiled on the host — the model's Ruby never reaches here — so
 * everything below this line is the shared guest's: the scope built from the run's enabled tools,
 * the denied globals, `lib.<name>` from the code modules, the single `catch`, and the report over
 * `feedback`.
 *
 * The flush is in a `finally` because a program that threw still wrote what it wrote, and a partial
 * line held at the moment of the throw is often the most useful line in the run.
 */
export function run(program, modules, tools, ending, library) {
  const flush = attachStreams();
  try {
    evaluate(program, modules, tools, ending, library);
  } finally {
    flush();
  }
}
