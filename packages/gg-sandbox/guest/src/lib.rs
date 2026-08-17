//! **The ECMAScript guest gg evaluates a program in**: quickjs-ng, through `rquickjs`, inside a
//! `wit-bindgen` component that declares gg's own `sandbox` world out of `crates/gg/wit`.
//!
//! # What it is for
//!
//! One property, from which everything else here follows: **a model's program is a module, and the
//! bytes evaluated are the bytes the model sent.** `Module::declare(ctx, "program.js", program)`
//! takes the source under its own name at offset zero, so a program writes its own `import` lines,
//! declares whatever top-level names it likes, and reads its own line numbers back out of any
//! failure. That is what
//! `apps/docs/src/content/docs/gg/responses-as-code/invariants.md` requires of every arm.
//!
//! The engine this replaces (StarlingMonkey, through `componentize-js`) cannot do it at any setting.
//! It has no way to evaluate module source at run time at all: `import()` of a `data:` URL, a
//! `blob:`, a `node:` specifier, a path and the same specifier smuggled through a nested `new
//! Function` all trap the store at `path_filestat_get`, because `componentize-js` stubs the preview1
//! filesystem to `unreachable` after wizening. So a program there was a **function body** —
//! `new Function(...names, program)` — with sixteen reserved formal parameters, a re-printed AST
//! rather than the model's bytes, a written refusal for the word `import`, and line numbers arrived
//! at by subtracting a calibration throw. `gg-js-runtime-decision.md` has the measurements; ruling
//! D14 chose this engine and ruling D9 deleted that shape.
//!
//! # How a failure reaches the model
//!
//! By **capture, not interception** — ruling D8. Nothing here catches a program's throw to describe
//! it: the engine's own rendering of the exception, with the engine's own `name`, `message` and
//! stack, goes to standard error, and gg's membrane (`crates/gg/src/sandbox/membrane.rs` routes the
//! guest's stderr into `GuestStderr`, and `with_guest_stderr` puts it in front of whatever gg says)
//! hands it to the model unedited. The locations in it are `Exception::stack()`'s, which are the
//! engine's own, stated against `program.js` — there is no arithmetic anywhere in this crate, which
//! is ruling D11.
//!
//! Four shapes reach stderr that way, and the last two were silent or opaque on the incumbent:
//!
//! * a throw the program did not catch, including a `ToolError` a refused gg call raised;
//! * a syntax error, at the model's own line, where a `new Function` construction failure had no
//!   location at all;
//! * a **floating rejection** — a promise nothing awaited — through the engine's rejection tracker;
//! * a **stack overflow**, as `RangeError: Maximum call stack size exceeded` with the frames, rather
//!   than as a store-killing `wasm trap: call stack exhausted`.
//!
//! Having written what happened, the guest **traps**, so gg records a failed turn. It does not call
//! `feedback.report-error`: that channel is the incumbent's single `catch`, which is the
//! interception D8 forbids.
//!
//! # What is deliberately absent
//!
//! * **`Intl`.** quickjs-ng does not implement it. Neither does the incumbent guest.
//! * **A budget of its own.** A runaway loop is stopped at gg's ceiling and no sooner. gg states that
//!   ceiling in `GG_SANDBOX_DEADLINE_MS`, one epoch tick short of its own deadline, so the engine
//!   answers first and in the model's own words rather than the store dying with an epoch trap. See
//!   [`deadline`].

// The world's `run` takes five parameters and `wit-bindgen` lowers it to an eight-argument extern.
// The lint is about a signature a person wrote; this one is the canonical ABI's.
#![allow(clippy::too_many_arguments)]

use std::io::Write as _;
use std::time::{Duration, Instant};

use rquickjs::function::Rest;
use rquickjs::{CatchResultExt, CaughtError, Context, Ctx, Function, Module, Runtime, Value};

wit_bindgen::generate!({
    world: "sandbox",
    path: "../../../crates/gg/wit",
    generate_all,
});

/// gg's own interfaces, under the path the generated membrane glue names them by.
mod bindings {
    pub use crate::test_cabinet::gg::*;
}

mod abi;
mod loader;

/// The generated membrane glue: one native module per WIT interface, and the lift/lower pair for
/// every record, variant and enum they carry. Written by `build.rs` from `crates/gg/wit`.
///
/// `dead_code` is allowed because the generator emits BOTH directions for every named type, and
/// which direction is reached depends on gg's WIT: a record that only ever comes back from a call
/// (`text-read`, `doc-search`) has no lift with a call site today. Emitting one direction would make
/// the generator's output depend on where a type happens to appear, and a type that later becomes a
/// parameter would silently have no lowering at all. The linker drops what nothing calls.
#[allow(dead_code, clippy::needless_borrow, clippy::useless_conversion, unused_imports)]
mod membrane {
    include!(concat!(env!("OUT_DIR"), "/membrane.rs"));
}

/// The SDK, baked. Written by `build.rs` from `packages/gg-sandbox/dist`.
mod sdk {
    include!(concat!(env!("OUT_DIR"), "/sdk.rs"));
}

/// How much of the shadow stack a JavaScript recursion may spend before the engine raises
/// `RangeError: Maximum call stack size exceeded`.
///
/// quickjs measures a recursion by taking the address of a local (`js_get_stack_pointer`), which on
/// wasm is a pointer into the shadow stack — the region `.cargo/config.toml` sizes at 4 MiB. This is
/// the ceiling `update_stack_limit` compares against.
///
/// **512 KiB, and the number is a measurement rather than a preference.** Measured on this guest,
/// depth reached before the engine reports the overflow, against wasmtime's `max_wasm_stack`:
///
/// | JavaScript ceiling | 512 KiB host | 1 MiB host | 2 MiB host |
/// | --- | --- | --- | --- |
/// | 128 KiB | 452 | 452 | 452 |
/// | 256 KiB | 907 | 907 | 907 |
/// | 512 KiB | host trap | **1817** | 1817 |
/// | 1 MiB | host trap | host trap | 3637 |
///
/// Two stacks are spent at once — quickjs's own, in linear memory, and the wasm call stack under it
/// — and if the *host* one runs out first the store dies with `wasm trap: call stack exhausted` and
/// the model reads nothing. So this pairs with `max_wasm_stack` in `crates/gg/src/sandbox/engine.rs`,
/// which gg raises to 1 MiB for exactly this row of the table.
const MAX_JS_STACK: usize = 512 * 1024;

/// The ceiling on the engine's own heap.
///
/// It is not the run's memory limit — that is gg's, imposed on the whole store by
/// `crates/gg/src/sandbox/limits.rs`, and it is the one that decides how much a program may have.
/// This is the engine's, set an order of magnitude above anything a program has needed so that a
/// runaway allocation is refused by quickjs (which raises `InternalError: out of memory`, a JavaScript
/// error with a stack) before it is refused by the store limiter (which traps).
const MAX_JS_HEAP: usize = 256 * 1024 * 1024;

/// The variable gg names its own execution budget in, if it names one.
///
/// See [`deadline`].
const DEADLINE: &str = "GG_SANDBOX_DEADLINE_MS";

/// How long this turn's guest execution has, and how much of the elapsed time was spent parked in a
/// host call.
///
/// gg's execution timeout bounds the **guest's own** execution rather than wall clock: a program
/// parked in a twenty-minute `shell` build accrues real time and has done nothing wrong, so gg's
/// epoch-deadline callback subtracts the time spent in bridged calls before deciding
/// (`crates/gg/src/sandbox.rs`, `guest_elapsed`). This does the same arithmetic on the guest's side,
/// from the same budget, so that a runaway loop is answered by the *engine* — `InternalError:
/// interrupted`, with the JavaScript frames — instead of by an epoch trap that names nothing the
/// model can act on.
///
/// It is only armed when gg names a budget. A guest with no budget has no second ceiling, and gg's
/// epoch deadline is the only one, which is what every other arm has.
mod deadline {
    use std::cell::Cell;
    use std::time::{Duration, Instant};

    thread_local! {
        /// The total time spent inside membrane calls this turn.
        static PARKED: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    }

    /// Record that a membrane call took `spent`. Called by the generated glue around every call.
    pub fn parked(spent: Duration) {
        PARKED.with(|cell| cell.set(cell.get() + spent));
    }

    /// How much of the elapsed time since `started` was the guest's own.
    pub fn guest_elapsed(started: Instant) -> Duration {
        started
            .elapsed()
            .saturating_sub(PARKED.with(std::cell::Cell::get))
    }
}

/// One line to standard error, flushed, because a trap follows and an unflushed line is a line the
/// model never reads.
fn say(line: &str) {
    let mut stderr = std::io::stderr();
    let _ = stderr.write_all(line.as_bytes());
    let _ = stderr.write_all(b"\n");
    let _ = stderr.flush();
}

/// **Report one failure, once**, and record that the turn failed.
///
/// `prefix` is the shape (`"Uncaught"`, `"Uncaught (in promise)"`) and `rendered` is the engine's own
/// text — its `name`, its `message` and its stack, unedited. The de-duplication is on `rendered`
/// alone, and it is not editing: ONE failure genuinely reaches this from up to three places. A
/// program whose top-level `await` rejects arrives at the rejection tracker (which fires the moment a
/// rejection has no handler yet), at the tracker AGAIN if the module promise is separate, and at the
/// handler attached to the module's own evaluation promise. Printing the same stack three times
/// would tell a model it had three problems.
fn report(prefix: &str, rendered: &str) {
    thread_local! {
        static REPORTED: std::cell::RefCell<Vec<String>> = const {
            std::cell::RefCell::new(Vec::new())
        };
    }
    let fresh = REPORTED.with(|reported| {
        let mut reported = reported.borrow_mut();
        if reported.iter().any(|seen| seen == rendered) {
            return false;
        }
        reported.push(rendered.to_string());
        true
    });
    if fresh {
        match prefix.is_empty() {
            true => say(rendered),
            false => say(&format!("{prefix} {rendered}")),
        }
    }
    failed(true);
}

struct Component;

impl Guest for Component {
    /// Evaluate one program.
    ///
    /// `tools`, `ending` and `library` are read by nothing here, exactly as the world says of every
    /// guest: the SDK is static and every capability question is answered at the membrane, which is
    /// the one place that can answer it the same way for all eleven arms.
    fn run(
        program: String,
        modules: Vec<CodeModule>,
        _tools: Vec<String>,
        _ending: bindings::session::EndingKind,
        _library: bool,
    ) {
        let runtime = Runtime::new().expect("the engine starts");
        runtime.set_max_stack_size(MAX_JS_STACK);
        runtime.set_memory_limit(MAX_JS_HEAP);
        runtime.set_loader(
            loader::GgResolver,
            loader::GgLoader::new(
                modules
                    .into_iter()
                    .map(|module| (module.name, module.source))
                    .collect(),
            ),
        );

        // A promise nothing awaited. The one failure shape a `catch` cannot see, and a silent exit 0
        // on the incumbent — the engine there defines `addEventListener("unhandledrejection", …)`
        // and never fires it.
        runtime.set_host_promise_rejection_tracker(Some(Box::new(
            |ctx: Ctx<'_>, _promise: Value<'_>, reason: Value<'_>, handled: bool| {
                if handled {
                    return;
                }
                report("Uncaught (in promise)", &describe(&ctx, reason));
            },
        )));

        let started = Instant::now();
        if let Some(budget) = budget() {
            runtime.set_interrupt_handler(Some(Box::new(move || {
                deadline::guest_elapsed(started) > budget
            })));
        }

        let context = Context::full(&runtime).expect("the context starts");
        context.with(|ctx| {
            install_globals(&ctx);
            evaluate(&ctx, &program);
        });

        // Drained OUTSIDE any context borrow: a top-level `await`, a `.then` continuation and the
        // rejection tracker all run here, and the promise a module evaluates to cannot leave the
        // `ctx.with` that produced it.
        loop {
            match runtime.execute_pending_job() {
                Ok(true) => continue,
                Ok(false) => break,
                Err(_) => {
                    context.with(|ctx| {
                        let thrown = ctx.catch();
                        report("Uncaught", &describe(&ctx, thrown));
                    });
                    break;
                }
            }
        }

        // The engine is NOT freed. quickjs-ng asserts `list_empty(&rt->gc_obj_list)` inside
        // `JS_FreeRuntime`, so a program that left an ordinary reference cycle behind would abort in
        // the free — a C assertion, reported as the model's fault, over a program that ran fine. The
        // whole instance is torn down with the store when this call returns, and the linear memory
        // goes with it, so there is nothing to reclaim and nobody to reclaim it for.
        std::mem::forget(context);
        std::mem::forget(runtime);

        if failed(false) {
            // Die the way a runtime kills a program that threw. The words are already on standard
            // error, where `with_guest_stderr` puts them in FRONT of whatever gg says about the
            // trap — so what the model reads first is what its own engine said.
            std::process::abort();
        }
    }

    /// Every gg tool this component imports a binding for.
    fn bound_tools() -> Vec<String> {
        membrane::BOUND_TOOLS
            .iter()
            .map(|name| (*name).to_string())
            .collect()
    }
}

/// Whether anything has failed this turn; `set` records that something has.
///
/// A flag rather than a return value because the three places that can fail — the declaration, the
/// evaluation, and the job queue — are in three different borrows of the context.
fn failed(set: bool) -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    static FAILED: AtomicBool = AtomicBool::new(false);
    if set {
        FAILED.store(true, Ordering::Relaxed);
    }
    FAILED.load(Ordering::Relaxed)
}

/// gg's execution budget for this turn, when gg named one.
fn budget() -> Option<Duration> {
    std::env::var(DEADLINE)
        .ok()?
        .parse::<u64>()
        .ok()
        .filter(|milliseconds| *milliseconds > 0)
        .map(Duration::from_millis)
}

/// **Declare the model's bytes as a module and evaluate them.**
///
/// The three lines this function is made of are the whole of ruling D9: no wrapper, no prologue, no
/// formal parameter, no appended `return`, and no re-print. What `Module::declare` receives is the
/// `String` the host sent, under the name the model's own frames are reported against.
fn evaluate<'js>(ctx: &Ctx<'js>, program: &str) {
    let declared = match Module::declare(ctx.clone(), loader::PROGRAM, program.to_string()).catch(ctx)
    {
        Ok(declared) => declared,
        Err(caught) => {
            report("", &render(ctx, caught));
            return;
        }
    };
    match declared.eval().catch(ctx) {
        Ok((_module, promise)) => {
            // A module's evaluation is a promise. It is already settled for a program with no
            // top-level `await`; for one that has, the job queue drain above finishes it. Either
            // way a rejection has to be watched for, because a rejected module promise is not a
            // thrown value anybody would otherwise see.
            let on_reject = Function::new(ctx.clone(), move |reason: Value<'js>| {
                let ctx = reason.ctx().clone();
                report("Uncaught", &describe(&ctx, reason));
            })
            .expect("a rejection handler");
            let _: rquickjs::Result<Value<'_>> = promise.then().and_then(|then| {
                then.call((
                    rquickjs::function::This(promise.clone()),
                    rquickjs::Undefined,
                    on_reject,
                ))
            });
        }
        Err(caught) => {
            report("", &render(ctx, caught));
        }
    }
}

/// The globals a program gets beyond the engine's own.
///
/// `console` is the program's channel for showing gg a value, and it goes to gg's feedback log
/// rather than to standard error: standard error is where a *failure* is read from, and mixing a
/// program's own output into it would make the two indistinguishable.
///
/// `TextEncoder`, `TextDecoder` and `structuredClone` are here because the incumbent engine had them
/// and quickjs does not, and a guest change that quietly removed a global a model's program may
/// already be writing would be a regression in exactly the direction this work exists to remove. The
/// two codecs are Rust's own UTF-8, so they are correct about surrogate pairs and replacement
/// characters rather than approximately correct.
fn install_globals(ctx: &Ctx<'_>) {
    let globals = ctx.globals();

    let console = rquickjs::Object::new(ctx.clone()).expect("a console object");
    for level in ["log", "error", "warn", "info", "debug", "trace"] {
        let line = Function::new(ctx.clone(), |rest: Rest<Value<'_>>| {
            let parts: Vec<String> = rest.0.iter().map(text_of).collect();
            bindings::feedback::log(&parts.join(" "));
        })
        .expect("a console function");
        console.set(level, line).expect("console is settable");
    }
    globals.set("console", console).expect("globals are settable");

    let encode = Function::new(ctx.clone(), |text: String| text.into_bytes())
        .expect("the UTF-8 encoder");
    let decode = Function::new(ctx.clone(), |ctx: Ctx<'_>, bytes: Vec<u8>| {
        String::from_utf8(bytes).map_err(|error| {
            abi::type_error(&ctx, &format!("the bytes are not valid UTF-8: {error}"))
        })
    })
    .expect("the UTF-8 decoder");
    globals
        .set("__ggUtf8Encode", encode)
        .expect("globals are settable");
    globals
        .set("__ggUtf8Decode", decode)
        .expect("globals are settable");
    ctx.eval::<(), _>(PRELUDE).expect("the prelude evaluates");
}

/// The small part of the standard library quickjs leaves to its embedder, written on top of the two
/// native codecs installed beside it.
///
/// It is evaluated as a **script**, not a module, and it defines globals — which is what these are.
/// Nothing a model writes reaches this file: it is the engine's own surface, the way `Array` is.
const PRELUDE: &str = r#"
(function (encodeUtf8, decodeUtf8) {
  // Closed over rather than read off `globalThis`, and the two natives are deleted below, so a
  // program cannot reach the raw codecs and cannot break these two classes by shadowing them.
  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return "utf-8"; }
    encode(input = "") { return new Uint8Array(encodeUtf8(String(input))); }
  };
  globalThis.TextDecoder = class TextDecoder {
    constructor(label = "utf-8") {
      const normalised = String(label).toLowerCase();
      if (normalised !== "utf-8" && normalised !== "utf8") {
        throw new RangeError(`this sandbox decodes utf-8 only, not ${label}`);
      }
    }
    get encoding() { return "utf-8"; }
    decode(input) {
      if (input === undefined) return "";
      const bytes = input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer ?? input);
      return decodeUtf8(Array.from(bytes));
    }
  };
  const clone = function structuredClone(value, seen) {
    seen = seen ?? new Map();
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (value instanceof Map) {
      const copy = new Map(); seen.set(value, copy);
      for (const [k, v] of value) copy.set(clone(k, seen), clone(v, seen));
      return copy;
    }
    if (value instanceof Set) {
      const copy = new Set(); seen.set(value, copy);
      for (const v of value) copy.add(clone(v, seen));
      return copy;
    }
    if (ArrayBuffer.isView(value)) return new value.constructor(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (typeof value === "function") throw new Error("a function cannot be structured-cloned");
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const key of Reflect.ownKeys(value)) copy[key] = clone(value[key], seen);
    return copy;
  };
  globalThis.structuredClone = clone;
})(globalThis.__ggUtf8Encode, globalThis.__ggUtf8Decode);
delete globalThis.__ggUtf8Encode;
delete globalThis.__ggUtf8Decode;
"#;

/// One `console` argument, rendered the way a JavaScript host renders it.
fn text_of(value: &Value<'_>) -> String {
    if let Some(text) = value.as_string() {
        return text.to_string().unwrap_or_default();
    }
    if value.is_undefined() {
        return "undefined".to_string();
    }
    let ctx = value.ctx().clone();
    match ctx.json_stringify(value.clone()) {
        Ok(Some(text)) => text.to_string().unwrap_or_default(),
        _ => format!("{value:?}"),
    }
}

/// The engine's own words for a value that was thrown: its `name`, its `message` and its stack,
/// unedited and in the model's own coordinates.
fn describe<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> String {
    if let Some(exception) = value.clone().into_exception() {
        return format!(
            "{}: {}\n{}",
            exception
                .get::<_, Value<'js>>("name")
                .ok()
                .and_then(|name| name.as_string().and_then(|text| text.to_string().ok()))
                .unwrap_or_else(|| "Error".to_string()),
            exception.message().unwrap_or_default(),
            exception.stack().unwrap_or_default(),
        );
    }
    // A refused gg call arrives as the membrane's own record — `{ code, tool, message }` — which is
    // an ordinary object rather than an `Error`, exactly as it is on every other guest.
    if let Some(object) = value.as_object() {
        let name: String = object.get("name").unwrap_or_else(|_| "Error".to_string());
        let message: String = object.get("message").unwrap_or_default();
        let stack: String = object.get("stack").unwrap_or_default();
        if !message.is_empty() {
            return format!("{name}: {message}\n{stack}");
        }
    }
    match ctx.json_stringify(value.clone()) {
        Ok(Some(text)) => text.to_string().unwrap_or_default(),
        _ => format!("{value:?}"),
    }
}

/// A caught failure, rendered.
fn render<'js>(ctx: &Ctx<'js>, caught: CaughtError<'js>) -> String {
    match caught {
        CaughtError::Exception(exception) => format!(
            "{}: {}\n{}",
            exception
                .get::<_, Value<'js>>("name")
                .ok()
                .and_then(|name| name.as_string().and_then(|text| text.to_string().ok()))
                .unwrap_or_else(|| "Error".to_string()),
            exception.message().unwrap_or_default(),
            exception.stack().unwrap_or_default(),
        ),
        CaughtError::Value(value) => format!("Uncaught {}", describe(ctx, value)),
        CaughtError::Error(error) => error.to_string(),
    }
}

export!(Component);
