//! **Responses as code** — the wasmtime sandbox that runs an agent's code-shaped
//! response as a *program over the tools*.
//!
//! Under the [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
//! capability, a model emits a `gg-script` program instead of a batch of discrete tool
//! calls (see [`gg_rac_interp`] for the language). This module is the **host**: it runs
//! that program in a wasmtime sandbox rather than dispatching tool calls directly,
//! composing loops, conditionals, intermediate values, and several tool invocations
//! into one round.
//!
//! ## Why an interpreter-in-wasm (and why wasmtime)
//!
//! A model cannot emit wasm directly, so the faithful way to sandbox its arbitrary
//! control flow is a **trusted interpreter compiled to wasm** — the committed
//! [`gg_rac_interp`] module — run under a fuel + linear-memory ceiling. This mirrors
//! exactly how [`foray-host`](../../crates/foray-host) and
//! [`lattice-host`](../../crates/lattice-host) run untrusted guests: one [`Store`] +
//! `Instance`, [`set_fuel`](Store::set_fuel) before the entry call, a
//! [`ResourceLimiter`] capping `memory.grow`, and a
//! hand-rolled `(ptr << 32) | len` marshalling ABI. The one addition here is a host
//! **import**: a script's tool call becomes a call to `gg.call_tool`, which the host
//! bridges to gg's real [`ToolRegistry`] — running the
//! tool in the container and handing the result back into the sandbox.
//!
//! ## What a run yields
//!
//! [`run_script`] returns the program's [outcome](gg_rac_interp::ProgramOutcome) (its
//! return value, any fault, and its `print` log) *plus* a [record](RacToolCall) of
//! every tool call the program made, in order — so the loop can feed the result back to
//! the model and telemetry can show the composed calls. Fuel consumed is reported too,
//! the same efficiency signal the sibling hosts expose.
//!
//! ## The tool bridge is synchronous
//!
//! wasmtime host imports are synchronous (this workspace's `wasmtime` has no `async`
//! feature), so a script's tool call is bridged through the synchronous
//! [`ScriptToolInvoker`] seam. The engine is therefore free of any runtime dependency
//! and is unit-tested with an in-memory fake invoker. The production adapter,
//! [`RegistryToolInvoker`], bridges that seam to the async
//! [`ToolRegistry::dispatch`](crate::tools::ToolRegistry::dispatch) via a
//! [`Handle`](tokio::runtime::Handle); because it blocks on the dispatch future, the
//! loop runs [`run_script`] on a blocking thread (`spawn_blocking`) so it never stalls
//! the async runtime — the same offload the `foray`/`lattice` validators use for their
//! CPU-bound guest runs.
//!
//! The engine is complete and fully tested here; the **integration** stage wires
//! [`run_script`] into the [agent loop](crate::agent) (offering the code-shaped
//! response as a toggle against traditional tool calling and recording the composed
//! tool calls on the telemetry stream). Until then its public surface has no in-crate
//! caller, so the module allows `dead_code` — every item is exercised by `rac.test.rs`.
#![allow(dead_code)]

use serde_json::{Value, json};
use wasmtime::{Caller, Config, Engine, Extern, Linker, Memory, Module, ResourceLimiter, Store};

use crate::model::ToolCall;
use crate::tools::{ToolContext, ToolOutcome, ToolRegistry};

/// The committed interpreter artifact — `gg-rac-interp` built for
/// `wasm32-unknown-unknown`. Rebuilt (and re-committed) via
/// `crates/gg-rac-interp/build.sh` whenever the language or the guest ABI changes,
/// exactly as the `foray-ref-*` / `lattice-ref-*` guests are.
const INTERPRETER_WASM: &[u8] = include_bytes!("rac/gg_rac_interp.wasm");

/// The sandbox limits one script runs under: a wasmtime fuel ceiling and a
/// linear-memory cap.
#[derive(Debug, Clone, Copy)]
pub struct RacLimits {
    /// The fuel ceiling for the whole `run_program` call. Set once before the call
    /// (not refilled — there is one call), so the program's control flow, its JSON
    /// marshalling, and the interpreter's own step accounting are all bounded by it. A
    /// program that would loop forever is stopped here even if it ignored the
    /// interpreter's softer step budget.
    pub fuel: u64,
    /// The linear-memory cap in bytes. A `memory.grow` that would exceed it is denied,
    /// failing the run rather than letting a runaway allocation exhaust the host.
    pub max_memory_bytes: usize,
}

impl Default for RacLimits {
    /// A generous default sized for a real code-shaped turn on a large case: 2×10⁹ fuel
    /// (the interpreter parses JSON and composes many tool results, so the ceiling is
    /// well above Foray's per-tick budget) and 256 MiB of linear memory.
    fn default() -> Self {
        Self {
            fuel: 2_000_000_000,
            max_memory_bytes: 268_435_456,
        }
    }
}

/// One tool call a script made, recorded by the host as it bridges the call. The
/// ordered list of these is the composed-calls record the loop feeds back and
/// telemetry renders.
#[derive(Debug, Clone, PartialEq)]
pub struct RacToolCall {
    /// The tool name the script called.
    pub name: String,
    /// The arguments the script passed (the evaluated map).
    pub arguments: Value,
    /// Whether the tool reported success (the [`ToolOutcome::ok`] it returned).
    pub ok: bool,
    /// The tool's short summary, when it recorded one.
    pub summary: Option<String>,
}

/// The result of running one script: the interpreter's outcome, the ordered tool-call
/// record, and the fuel consumed.
#[derive(Debug, Clone)]
pub struct RacRun {
    /// The program's outcome — its return value, any fault (with the phase it occurred
    /// in), the `print` log, and the steps it took.
    pub outcome: gg_rac_interp::ProgramOutcome,
    /// Every tool call the program made, in call order.
    pub tool_calls: Vec<RacToolCall>,
    /// The fuel the run consumed (`fuel - remaining`).
    pub fuel_consumed: u64,
}

/// Why a script could not be *run*, or failed mid-run in a way that is not an ordinary
/// program fault. An ordinary program fault (a parse error, a type error, a runaway
/// loop) is **not** here — it is reported in [`RacRun::outcome`]; these are failures of
/// the sandbox itself.
#[derive(Debug, thiserror::Error)]
pub enum RacError {
    /// The wasm engine could not be configured (fuel metering unavailable in this build
    /// of wasmtime).
    #[error("failed to build the wasm engine: {0}")]
    Engine(String),
    /// The committed interpreter module failed to load (compile/instantiate/missing
    /// export). This is a build error in the committed artifact, not a script fault.
    #[error("the responses-as-code interpreter failed to load: {0}")]
    Load(String),
    /// The interpreter exhausted its fuel ceiling — a program so heavy (or so runaway)
    /// that even the interpreter's own step budget could not stop it in time.
    #[error("the script exhausted its fuel ceiling")]
    OutOfFuel,
    /// The interpreter's linear memory grew past the cap.
    #[error("the script exceeded its {limit}-byte memory cap")]
    OutOfMemory {
        /// The linear-memory cap that was exceeded, in bytes.
        limit: usize,
    },
    /// The interpreter trapped for some other reason (a host-bridge fault, an
    /// unexpected guest trap), or returned bytes the host could not read back.
    #[error("the responses-as-code sandbox trapped: {0}")]
    Trap(String),
}

/// The synchronous seam a script's tool call is bridged through. The interpreter hands
/// `(name, args)` here; the implementation performs the call and returns a
/// [`ToolOutcome`], which the host serialises back into the sandbox as the tool's
/// result value.
///
/// It is a trait so the engine is testable with an in-memory fake and free of any
/// runtime dependency; [`RegistryToolInvoker`] is the production adapter over the real
/// [`ToolRegistry`].
pub trait ScriptToolInvoker {
    /// Perform the tool call `name(args)` and return its outcome.
    fn invoke(&self, name: &str, args: &Value) -> ToolOutcome;
}

/// The production adapter: bridge a script's tool call to the async
/// [`ToolRegistry::dispatch`](crate::tools::ToolRegistry::dispatch) by blocking on the
/// dispatch future with a tokio [`Handle`](tokio::runtime::Handle).
///
/// Because [`invoke`](ScriptToolInvoker::invoke) blocks, the loop must run
/// [`run_script`] on a blocking thread (`Handle::spawn_blocking`) — never directly on
/// an async worker — so the blocking bridge cannot stall the runtime. This is the same
/// offload the CPU-bound Foray/Lattice validators use.
pub struct RegistryToolInvoker<'a> {
    /// The run's offered toolset — the dispatch target.
    registry: &'a ToolRegistry,
    /// The workspace the tools are rooted at.
    context: &'a ToolContext,
    /// A handle to the runtime the async dispatch is driven on.
    handle: tokio::runtime::Handle,
}

impl<'a> RegistryToolInvoker<'a> {
    /// Build an adapter dispatching against `registry` (rooted at `context`), driving
    /// the async dispatch on `handle`.
    pub fn new(
        registry: &'a ToolRegistry,
        context: &'a ToolContext,
        handle: tokio::runtime::Handle,
    ) -> Self {
        Self {
            registry,
            context,
            handle,
        }
    }
}

impl ScriptToolInvoker for RegistryToolInvoker<'_> {
    fn invoke(&self, name: &str, args: &Value) -> ToolOutcome {
        // A synthetic call id: gg's `ToolCall` carries a provider id, but a script's
        // call has none — the name is enough for dispatch, which matches on it.
        let call = ToolCall {
            id: format!("rac:{name}"),
            name: name.to_string(),
            arguments: args.clone(),
        };
        self.handle
            .block_on(self.registry.dispatch(&call, self.context))
    }
}

/// The per-[`Store`] host state: the memory-growth limiter, the tool bridge, and the
/// growing record of the calls the script made.
///
/// wasmtime requires store data to be `'static`, but the tool invoker is *borrowed*
/// for the duration of one [`run_script`] call. The invoker is therefore held as a
/// [lifetime-erased pointer](InvokerPtr) whose referent [`run_script`] guarantees
/// outlives the store, so dereferencing it in the host import is sound.
struct StoreState {
    limiter: MemoryLimiter,
    invoker: InvokerPtr,
    calls: Vec<RacToolCall>,
}

/// A lifetime-erased pointer to a borrowed `dyn ScriptToolInvoker`, letting the
/// `Store` data be `'static` (as wasmtime requires) while still bridging to an invoker
/// that borrows (the production [`RegistryToolInvoker`] borrows the registry and the
/// workspace context).
///
/// # Safety
/// The pointer is only ever dereferenced inside the host import, on the same thread
/// that [`run_script`] created the store on, and only while that call is on the stack —
/// so the referent (borrowed for the whole call) is always live. The store is dropped
/// before [`run_script`] returns and is never `Send`, so the pointer cannot outlive its
/// referent or cross a thread.
struct InvokerPtr(*const (dyn ScriptToolInvoker + 'static));

impl InvokerPtr {
    /// Erase the lifetime of a borrowed invoker into a `'static` pointer for storage in
    /// the `Store`. Sound under the invariant documented on [`InvokerPtr`].
    fn new(invoker: &dyn ScriptToolInvoker) -> Self {
        let ptr: *const dyn ScriptToolInvoker = invoker;
        // Erasing only the lifetime of the (fat) pointer — same layout, so a transmute
        // is the sanctioned way to widen `'_` to `'static` here.
        InvokerPtr(unsafe {
            std::mem::transmute::<
                *const (dyn ScriptToolInvoker + '_),
                *const (dyn ScriptToolInvoker + 'static),
            >(ptr)
        })
    }

    /// Borrow the invoker. See [`InvokerPtr`] for why this is sound.
    fn get(&self) -> &dyn ScriptToolInvoker {
        // SAFETY: the referent outlives the store per the type's invariant.
        unsafe { &*self.0 }
    }
}

/// Caps guest linear-memory growth at `max_memory_bytes`, consulted by wasmtime
/// *before* each `memory.grow` (identical to the Foray/Lattice hosts).
struct MemoryLimiter {
    max_memory_bytes: usize,
}

impl ResourceLimiter for MemoryLimiter {
    fn memory_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        Ok(desired <= self.max_memory_bytes)
    }

    fn table_growing(
        &mut self,
        _current: usize,
        _desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        Ok(true)
    }
}

/// Run `source` (a `gg-script` program) in the sandbox under `limits`, bridging its
/// tool calls to `invoker`. Returns the program's [outcome](RacRun::outcome) and the
/// ordered record of the tool calls it made, or a [`RacError`] if the *sandbox* failed
/// (an ordinary program fault is carried in the outcome, not returned as an error).
///
/// This is the reusable entry the loop calls (on a blocking thread — see
/// [`RegistryToolInvoker`]); it is synchronous and does no I/O of its own beyond what a
/// bridged tool call performs.
pub fn run_script(
    source: &str,
    limits: RacLimits,
    invoker: &dyn ScriptToolInvoker,
) -> Result<RacRun, RacError> {
    let engine = build_engine()?;
    let module =
        Module::new(&engine, INTERPRETER_WASM).map_err(|e| RacError::Load(e.to_string()))?;

    let mut store = Store::new(
        &engine,
        StoreState {
            limiter: MemoryLimiter {
                max_memory_bytes: limits.max_memory_bytes,
            },
            invoker: InvokerPtr::new(invoker),
            calls: Vec::new(),
        },
    );
    store.limiter(|state| &mut state.limiter);
    store
        .set_fuel(limits.fuel)
        .map_err(|e| RacError::Engine(e.to_string()))?;

    let mut linker = Linker::new(&engine);
    define_call_tool(&mut linker).map_err(|e| RacError::Load(e.to_string()))?;

    let instance = linker
        .instantiate(&mut store, &module)
        .map_err(|e| RacError::Load(e.to_string()))?;

    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or_else(|| RacError::Load("interpreter is missing the `memory` export".into()))?;
    let alloc = instance
        .get_typed_func::<i32, i32>(&mut store, "alloc")
        .map_err(|_| RacError::Load("interpreter is missing the `alloc` export".into()))?;
    let run_program = instance
        .get_typed_func::<(i32, i32), i64>(&mut store, "run_program")
        .map_err(|_| RacError::Load("interpreter is missing the `run_program` export".into()))?;

    // Hand the request envelope to the guest: `alloc` a buffer, write the JSON, then
    // call `run_program`.
    let request = json!({ "source": source }).to_string();
    let request_bytes = request.into_bytes();
    let request_len = i32::try_from(request_bytes.len())
        .map_err(|_| RacError::Trap("program source too large to address".into()))?;

    let request_ptr = alloc
        .call(&mut store, request_len)
        .map_err(|e| classify_trap(&mut store, &memory, limits, e))?;
    memory
        .write(&mut store, request_ptr as usize, &request_bytes)
        .map_err(|_| RacError::Trap("failed to write the request into guest memory".into()))?;

    let packed = run_program
        .call(&mut store, (request_ptr, request_len))
        .map_err(|e| classify_trap(&mut store, &memory, limits, e))?;

    let (out_ptr, out_len) = unpack(packed);
    let outcome_bytes = read_region(&mut store, &memory, out_ptr, out_len)?;
    let outcome: gg_rac_interp::ProgramOutcome = serde_json::from_slice(&outcome_bytes)
        .map_err(|e| RacError::Trap(format!("interpreter returned malformed outcome JSON: {e}")))?;

    let remaining = store.get_fuel().unwrap_or(0);
    let fuel_consumed = limits.fuel.saturating_sub(remaining);
    let tool_calls = store.into_data().calls;

    Ok(RacRun {
        outcome,
        tool_calls,
        fuel_consumed,
    })
}

/// Build a fuel-metered wasmtime engine. Fuel metering must be enabled for the ceiling
/// and the consumed-fuel reading to work; a build of wasmtime that cannot enable it is
/// a host error, not a script failure.
fn build_engine() -> Result<Engine, RacError> {
    let mut config = Config::new();
    config.consume_fuel(true);
    Engine::new(&config).map_err(|e| RacError::Engine(e.to_string()))
}

/// Define the `gg.call_tool` host import on `linker`: read the tool `name`/`args` out
/// of guest memory, dispatch through the [`ScriptToolInvoker`], record the call, and
/// write the outcome JSON back into guest memory (via the guest's own `alloc`),
/// returning its packed `(ptr << 32) | len`.
fn define_call_tool(linker: &mut Linker<StoreState>) -> wasmtime::Result<()> {
    linker.func_wrap(
        "gg",
        "call_tool",
        |mut caller: Caller<'_, StoreState>,
         name_ptr: i32,
         name_len: i32,
         args_ptr: i32,
         args_len: i32|
         -> wasmtime::Result<i64> {
            let memory = caller
                .get_export("memory")
                .and_then(Extern::into_memory)
                .ok_or_else(|| wasmtime::Error::msg("guest has no `memory` export"))?;
            let alloc = caller
                .get_export("alloc")
                .and_then(Extern::into_func)
                .ok_or_else(|| wasmtime::Error::msg("guest has no `alloc` export"))?
                .typed::<i32, i32>(&caller)?;

            // Read the call name and arguments the guest passed from its own memory.
            let name = read_utf8(&caller, &memory, name_ptr, name_len)?;
            let args_text = read_utf8(&caller, &memory, args_ptr, args_len)?;
            let args: Value = serde_json::from_str(&args_text).unwrap_or(Value::Null);

            // Bridge the call to the real toolset and record it in call order. The
            // pointer is copied out (ending the `data()` borrow) before dispatch, and
            // the referent outlives the store (see `InvokerPtr`).
            let outcome = caller.data().invoker.get().invoke(&name, &args);
            caller.data_mut().calls.push(RacToolCall {
                name,
                arguments: args,
                ok: outcome.ok,
                summary: outcome.summary.clone(),
            });

            // Hand the result back to the script as the tool's value.
            let result = outcome_to_value(&outcome);
            let result_bytes = serde_json::to_vec(&result)
                .map_err(|e| wasmtime::Error::msg(format!("failed to encode tool result: {e}")))?;
            let result_len = i32::try_from(result_bytes.len())
                .map_err(|_| wasmtime::Error::msg("tool result too large to address"))?;

            let result_ptr = alloc.call(&mut caller, result_len)?;
            memory
                .write(&mut caller, result_ptr as usize, &result_bytes)
                .map_err(|_| {
                    wasmtime::Error::msg("failed to write tool result into guest memory")
                })?;

            Ok(pack(result_ptr as u32, result_bytes.len() as u32))
        },
    )?;
    Ok(())
}

/// The `{ "ok", "output", "summary" }` value a tool outcome is presented to a script
/// as — the convention `gg-script` documents, so a program can branch on `result.ok`
/// and read `result.output`.
fn outcome_to_value(outcome: &ToolOutcome) -> Value {
    json!({
        "ok": outcome.ok,
        "output": outcome.output,
        "summary": outcome.summary,
    })
}

/// Read a UTF-8 region out of guest memory, bounds-checked. A guest that names a region
/// outside its memory is a trap.
fn read_utf8(
    caller: &Caller<'_, StoreState>,
    memory: &Memory,
    ptr: i32,
    len: i32,
) -> wasmtime::Result<String> {
    let data = memory.data(caller);
    let start = ptr.max(0) as usize;
    let len = len.max(0) as usize;
    let end = start
        .checked_add(len)
        .ok_or_else(|| wasmtime::Error::msg("guest region overflow"))?;
    let bytes = data
        .get(start..end)
        .ok_or_else(|| wasmtime::Error::msg("guest region out of bounds"))?;
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

/// Read a region out of guest memory into an owned buffer, bounds-checked (the
/// [`run_script`] result path).
fn read_region(
    store: &mut Store<StoreState>,
    memory: &Memory,
    ptr: u32,
    len: u32,
) -> Result<Vec<u8>, RacError> {
    let data = memory.data(&*store);
    let start = ptr as usize;
    let end = start
        .checked_add(len as usize)
        .ok_or_else(|| RacError::Trap("guest returned an overflowing region".into()))?;
    data.get(start..end)
        .map(<[u8]>::to_vec)
        .ok_or_else(|| RacError::Trap("guest returned an out-of-bounds region".into()))
}

/// Map a wasmtime call error onto the right [`RacError`]: fuel exhaustion and the
/// memory cap surface as their own variants (a limiter denial usually arrives as a
/// trap), everything else as a generic trap. Mirrors the Foray/Lattice classification.
fn classify_trap(
    store: &mut Store<StoreState>,
    memory: &Memory,
    limits: RacLimits,
    err: wasmtime::Error,
) -> RacError {
    if err.downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::OutOfFuel)
        || store.get_fuel().map(|f| f == 0).unwrap_or(false)
    {
        return RacError::OutOfFuel;
    }
    // A denied `memory.grow` arrives as a trap; if the guest is pinned at (or above)
    // the cap, report it as the memory-cap failure rather than a generic trap.
    if memory.data_size(&*store) >= limits.max_memory_bytes {
        return RacError::OutOfMemory {
            limit: limits.max_memory_bytes,
        };
    }
    RacError::Trap(err.to_string())
}

/// Pack a guest pointer and length into the ABI's `i64`: `(ptr << 32) | len`.
fn pack(ptr: u32, len: u32) -> i64 {
    ((ptr as i64) << 32) | (len as i64)
}

/// Unpack a `(ptr << 32) | len` value from the guest's `run_program`.
fn unpack(packed: i64) -> (u32, u32) {
    let bits = packed as u64;
    ((bits >> 32) as u32, (bits & 0xFFFF_FFFF) as u32)
}

#[cfg(test)]
#[path = "rac.test.rs"]
mod tests;
