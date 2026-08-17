// The globals a program has that are NOT part of the tool surface, declared for the type checker.
//
// gg type-checks a model's program before the guest evaluates it, against declarations assembled
// from this language's generated signature catalogue plus this file. Everything the catalogue
// describes is reflected out of the SDK; what is left over are the names a program can reach that no
// SDK declaration covers, and they are written here rather than in the Rust that assembles the rest,
// so that changing one is visibly changing the other.
//
// The rule for what belongs here is one rule: a name a program can CALL is declared, and a name it
// cannot is not. `setTimeout` and `fetch` are deliberately absent, because this guest has neither an
// event loop nor an HTTP client — declaring them would make the checker certify a program that
// cannot work. The
// clock and the entropy below are present for the opposite reason: gg's host linker supplies WASI
// ambiently, so a program that asks what time it is gets the answer, and a checker that refused the
// question would be refusing a program that runs.
//
// The guest it describes is `guest/`, the quickjs-ng component the TypeScript arm evaluates a
// program in, and `install_globals` in `guest/src/lib.rs` is what installs every name below.
//
// This file is COPIED VERBATIM by `tools/checker.mjs` into the `typescript.globals.d.ts` it writes
// into `$GG_ARTIFACTS_OUT_DIR` — the `OUT_DIR` of `crates/gg-sandbox-artifacts/typescript`, which
// `typescript.compile.rs` `include_str!`s it from. It is deliberately outside `src/`, so the guest
// build never compiles it and it never reaches the component.

/**
 * The console the guest installs over the engine's (see `install_globals` in `guest/src/lib.rs`).
 *
 * Every method routes to gg's operator log rather than to the model's context window: a program's
 * `console.log` is readable by whoever is watching the run and by nothing else, which is why the
 * system prompt tells a model to open a view instead. It is declared anyway, because it is callable
 * — a checker that rejected `console.log` would reject a program that runs.
 *
 * The method list mirrors what the guest installs exactly. Anything not on it is genuinely absent.
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
 * The entropy the guest installs, reading the host's through `wasi:random`.
 *
 * The two members a program has any use for. `subtle` is deliberately absent — nothing implements it
 * here, so a program that reached for it would be a program the compiler had waved through into a
 * run-time failure.
 */
declare const crypto: {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

/**
 * UTF-8, as the platform spells it. The guest implements both classes over Rust's own encoder and
 * decoder, so surrogate pairs and replacement characters are handled exactly rather than
 * approximately.
 *
 * Only UTF-8: a `TextDecoder` constructed for any other label throws, so no other label is declared.
 */
declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}

/** See `TextEncoder`. */
declare class TextDecoder {
  constructor(label?: string);
  readonly encoding: string;
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}

/**
 * A deep copy, over the structured-clone graph the guest implements: plain objects and arrays,
 * `Date`, `RegExp`, `Map`, `Set`, typed arrays and `ArrayBuffer`, with cycles preserved.
 *
 * A function has no structured-clone representation and throws, which is what the platform does.
 */
declare function structuredClone<T>(value: T): T;
