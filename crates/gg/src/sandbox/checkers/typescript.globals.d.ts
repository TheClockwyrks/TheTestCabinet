// The globals a program has that are NOT part of the tool surface, declared for the type checker.
//
// gg type-checks a model's program before the guest evaluates it, against declarations assembled
// from this language's committed signature catalogue plus this file. Everything the catalogue
// describes is reflected out of the SDK; what is left over are the names a program can reach that no
// SDK declaration covers, and they are written here — beside the shim that installs or shadows them
// — rather than in the Rust that assembles the rest, so that changing one is visibly changing the
// other.
//
// The rule for what belongs here is one rule: a name a program can CALL is declared, and a name it
// cannot is not. `setTimeout` and `fetch` are deliberately absent, because the shim replaces them
// with throwers — declaring them would make the checker certify a program that cannot work. The
// clock and the entropy below are present for the opposite reason: gg's host linker supplies WASI
// ambiently, so a program that asks what time it is gets the answer, and a checker that refused the
// question would be refusing a program that runs.
//
// This file is COPIED VERBATIM by `tools/checker.mjs` into
// `crates/gg/src/sandbox/checkers/typescript.globals.d.ts` and committed. It is deliberately outside
// `src/`, so the guest build never compiles it and it never reaches the component.

/**
 * The console the shim installs over the engine's (see `installConsole` in `src/shim.ts`).
 *
 * Every method routes to gg's operator log rather than to the model's context window: a program's
 * `console.log` is readable by whoever is watching the run and by nothing else, which is why the
 * system prompt tells a model to open a view instead. It is declared anyway, because it is callable
 * — a checker that rejected `console.log` would reject a program that runs.
 *
 * The method list mirrors `installConsole`'s sink exactly. Anything not on it is genuinely absent.
 */
declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  trace(...args: unknown[]): void;
  dir(...args: unknown[]): void;
};

/**
 * The namespace every code skill and code memory this agent has loaded is bound under (see
 * `buildLib` in `src/shim.ts`): `lib.<key>.<export>`.
 *
 * Typed as an index of `any` rather than as anything specific, and that is not laziness — it is the
 * truth. A module's exports are whatever the code a model wrote happens to export, discovered by
 * evaluating it inside the guest, and gg has no declaration for any of them. So a call through `lib`
 * is checked for nothing at all, and a wrong one fails at run time exactly as it does in a language
 * that checks nothing. `unknown` would have been the stricter spelling and the wrong one: it makes
 * every `lib.<key>.<export>(…)` a compile error, which would refuse every correct program too.
 *
 * `lib` is absent from a program's scope entirely when the agent has loaded nothing. Declaring it
 * unconditionally is deliberate: the alternative is a checker whose verdict depends on which
 * memories an agent happened to read, so a program would type-check on one turn and not the next
 * without its text changing.
 */
declare const lib: Record<string, any>;

/**
 * The engine's monotonic clock, reading the host's through `wasi:clocks`.
 *
 * Only `now()`: the rest of the `Performance` interface is browser timeline machinery with nothing
 * behind it here, and declaring a method whose implementation is absent is the one thing a checker
 * must not do.
 */
declare const performance: {
  now(): number;
};

/**
 * The engine's entropy, reading the host's through `wasi:random`.
 *
 * The two members a program has any use for. `subtle` is deliberately absent — this engine's
 * `SubtleCrypto` is not implemented, so a program that reached for it would be a program the checker
 * had waved through into a run-time failure.
 */
declare const crypto: {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};
