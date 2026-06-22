//! A single loaded controller module and the per-tick invocation across the
//! hand-rolled C ABI.
//!
//! ## The controller ABI (v1, wasm32-unknown-unknown core modules)
//!
//! A controller is a plain core module — *not* a component — exporting:
//!
//! - `memory` — its linear memory.
//! - `alloc(len: i32) -> i32` — reserve `len` bytes in the guest's own memory and
//!   return a pointer to them. The host writes the observation JSON there.
//! - the contract entry (named by the manifest, here `tick`):
//!   `tick(ptr: i32, len: i32) -> i64` — read `len` bytes of `world` JSON at
//!   `ptr`, decide, and return the action JSON's location in the *guest's* memory
//!   packed as `((out_ptr as i64) << 32) | (out_len as i64)`.
//!
//! ## Why one Store + Instance for the whole match
//!
//! The engine is reused between ticks (decision 2 / the
//! [overview](/testing/adversarial/overview/#the-controller-contract)): a single
//! [`Store`] and [`Instance`] live for the match, so the guest's globals/statics —
//! a map it has explored, a plan in flight — persist tick to tick. Only the
//! *fuel* is refilled each tick, so the [`fuel_per_tick`](crate::SandboxLimits)
//! ceiling bounds the work of one invocation while letting accumulated working
//! memory carry forward.

use wasmtime::{Engine, Instance, Memory, Module, Store, TypedFunc};

use crate::SandboxLimits;

/// Why a single controller invocation failed. Every variant is a **forfeit** for
/// that controller: the match continues with the controller's moves replaced by
/// all-`Stop`, so a replay is still produced. The variant is retained for the
/// recorded forfeit reason and for diagnostics.
#[derive(Debug, Clone, thiserror::Error)]
pub enum InvokeError {
    /// The controller exhausted its per-tick fuel ceiling.
    #[error("controller exhausted its fuel ceiling")]
    OutOfFuel,
    /// The controller's linear memory grew past the cap.
    #[error("controller exceeded its {limit}-byte memory cap (used {used} bytes)")]
    OutOfMemory { used: usize, limit: usize },
    /// The guest trapped (an unreachable, an out-of-bounds access, a panic, …).
    #[error("controller trapped: {0}")]
    Trap(String),
    /// `alloc`/`tick` reported a pointer/length that falls outside guest memory.
    #[error("controller returned an out-of-bounds region (ptr {ptr}, len {len})")]
    BadRegion { ptr: u32, len: u32 },
    /// The bytes the controller returned were not the contract's `action` JSON.
    #[error("controller returned malformed action JSON: {0}")]
    BadJson(String),
}

/// One loaded controller, ready to be invoked once per tick. Holds the wasmtime
/// [`Store`] (fuel + memory-limit state) and the resolved [`alloc`](Self::alloc)
/// / [`tick`](Self::tick) exports, so per-tick invocation does no re-resolution.
pub struct Controller {
    store: Store<StoreState>,
    memory: Memory,
    alloc: TypedFunc<i32, i32>,
    tick: TypedFunc<(i32, i32), i64>,
    limits: SandboxLimits,
    /// The most fuel any single tick of this controller consumed (`alloc` + the
    /// contract entry), tracked so a caller can report how close a controller ran
    /// to its per-tick ceiling — the signal a model needs to tell "comfortably
    /// within budget" from "one optimization away from forfeiting".
    peak_fuel: u64,
}

/// Per-store host state. wasmtime calls back into [`ResourceLimiter`] before each
/// memory growth, so the cap is enforced at the point of `memory.grow` rather than
/// observed after the fact.
struct StoreState {
    limiter: MemoryLimiter,
}

/// Caps guest linear-memory growth at [`SandboxLimits::max_memory_bytes`]. wasmtime
/// consults this *before* growing memory and a denied request makes the guest's
/// `memory.grow` return `-1`, which a well-behaved allocator surfaces as an
/// allocation failure (and a misbehaving one usually turns into a trap) — either
/// way the invocation forfeits.
struct MemoryLimiter {
    max_memory_bytes: usize,
}

impl wasmtime::ResourceLimiter for MemoryLimiter {
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

impl Controller {
    /// Compile and instantiate `wasm` (a controller core module's bytes) under
    /// `engine`, resolving the ABI exports. `entry` is the contract entry name
    /// from the manifest (`tick`). Fails before the match if the module does not
    /// build or is missing a required export — that is a build/legality failure,
    /// distinct from an in-match forfeit.
    pub fn load(
        engine: &Engine,
        wasm: &[u8],
        entry: &str,
        limits: SandboxLimits,
    ) -> Result<Controller, LoadError> {
        let module = Module::new(engine, wasm).map_err(|e| LoadError::Compile(e.to_string()))?;

        let mut store = Store::new(
            engine,
            StoreState {
                limiter: MemoryLimiter {
                    max_memory_bytes: limits.max_memory_bytes,
                },
            },
        );
        store.limiter(|state| &mut state.limiter);

        let instance = Instance::new(&mut store, &module, &[])
            .map_err(|e| LoadError::Instantiate(e.to_string()))?;

        let memory = instance
            .get_memory(&mut store, "memory")
            .ok_or_else(|| LoadError::MissingExport("memory".into()))?;
        let alloc = instance
            .get_typed_func::<i32, i32>(&mut store, "alloc")
            .map_err(|_| LoadError::MissingExport("alloc".into()))?;
        let tick = instance
            .get_typed_func::<(i32, i32), i64>(&mut store, entry)
            .map_err(|_| LoadError::MissingExport(entry.into()))?;

        Ok(Controller {
            store,
            memory,
            alloc,
            tick,
            limits,
            peak_fuel: 0,
        })
    }

    /// The most fuel any single tick of this controller has consumed so far,
    /// against the per-tick ceiling in [`SandboxLimits::fuel_per_tick`]. A value
    /// near the ceiling means the controller is one heavy tick from forfeiting; a
    /// small fraction means it has ample headroom.
    pub fn peak_fuel(&self) -> u64 {
        self.peak_fuel
    }

    /// Run one tick: write `world_json` into the guest, call `tick`, and read the
    /// returned bytes back out. Fuel is refilled to the per-tick ceiling first, so
    /// the budget bounds this single invocation while guest working memory
    /// persists. The returned bytes are the controller's raw `action` JSON — the
    /// caller parses and contract-validates them (a parse failure here is reported
    /// as [`InvokeError::BadJson`], a deeper contract failure by the caller).
    pub fn invoke(&mut self, world_json: &[u8]) -> Result<Vec<u8>, InvokeError> {
        // Refill fuel to exactly the per-tick ceiling. Setting (not adding) the
        // budget makes each tick independent: leftover fuel never banks forward
        // into a later tick, so the ceiling is a true per-invocation limit.
        self.store
            .set_fuel(self.limits.fuel_per_tick)
            .map_err(|e| InvokeError::Trap(e.to_string()))?;

        let len = i32::try_from(world_json.len())
            .map_err(|_| InvokeError::Trap("observation too large to address".into()))?;

        let ptr = self.call_alloc(len)?;
        self.write_guest(ptr, world_json)?;

        let packed = self.call_tick(ptr, len)?;
        // Fuel was refilled to the ceiling at entry, so the shortfall now is what
        // this tick (`alloc` + the contract entry) burned. Track the peak so a
        // caller can report how close the controller ran to its budget.
        if let Ok(remaining) = self.store.get_fuel() {
            self.peak_fuel = self
                .peak_fuel
                .max(self.limits.fuel_per_tick.saturating_sub(remaining));
        }
        let (out_ptr, out_len) = unpack(packed);
        self.read_guest(out_ptr, out_len)
    }

    /// Call `alloc(len)` and validate the returned pointer addresses real guest
    /// memory for `len` bytes.
    fn call_alloc(&mut self, len: i32) -> Result<u32, InvokeError> {
        let ptr = self
            .alloc
            .call(&mut self.store, len)
            .map_err(|e| self.classify_trap(e))?;
        let ptr = ptr as u32;
        self.check_region(ptr, len as u32)?;
        Ok(ptr)
    }

    /// Call the contract entry and return its packed `(ptr, len)` result.
    fn call_tick(&mut self, ptr: u32, len: i32) -> Result<i64, InvokeError> {
        self.tick
            .call(&mut self.store, (ptr as i32, len))
            .map_err(|e| self.classify_trap(e))
    }

    /// Copy `bytes` into guest memory at `ptr` (already bounds-checked).
    fn write_guest(&mut self, ptr: u32, bytes: &[u8]) -> Result<(), InvokeError> {
        self.memory
            .write(&mut self.store, ptr as usize, bytes)
            .map_err(|_| InvokeError::BadRegion {
                ptr,
                len: bytes.len() as u32,
            })
    }

    /// Read `len` bytes out of guest memory at `ptr`, after bounds-checking the
    /// region the guest reported.
    fn read_guest(&mut self, ptr: u32, len: u32) -> Result<Vec<u8>, InvokeError> {
        self.check_region(ptr, len)?;
        let mut buf = vec![0u8; len as usize];
        self.memory
            .read(&mut self.store, ptr as usize, &mut buf)
            .map_err(|_| InvokeError::BadRegion { ptr, len })?;
        Ok(buf)
    }

    /// Validate that `[ptr, ptr + len)` lies wholly within current guest memory.
    /// A controller that lies about its output region forfeits rather than letting
    /// the host read out of bounds.
    fn check_region(&mut self, ptr: u32, len: u32) -> Result<(), InvokeError> {
        let size = self.memory.data_size(&self.store) as u64;
        let end = ptr as u64 + len as u64;
        if end > size {
            return Err(InvokeError::BadRegion { ptr, len });
        }
        Ok(())
    }

    /// Map a wasmtime call error onto the right forfeit reason. Fuel exhaustion and
    /// the memory cap surface as their own variants (the limiter denial usually
    /// arrives as a trap); everything else is a generic trap.
    fn classify_trap(&mut self, err: wasmtime::Error) -> InvokeError {
        if err.downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::OutOfFuel)
            || self.store.get_fuel().map(|f| f == 0).unwrap_or(false)
        {
            return InvokeError::OutOfFuel;
        }
        let used = self.memory.data_size(&self.store);
        if used >= self.limits.max_memory_bytes {
            return InvokeError::OutOfMemory {
                used,
                limit: self.limits.max_memory_bytes,
            };
        }
        InvokeError::Trap(err.to_string())
    }
}

/// Unpack the `((ptr) << 32) | (len)` return value from the contract entry.
fn unpack(packed: i64) -> (u32, u32) {
    let bits = packed as u64;
    let ptr = (bits >> 32) as u32;
    let len = (bits & 0xFFFF_FFFF) as u32;
    (ptr, len)
}

/// Why a controller module could not be loaded — a build/legality failure that
/// happens before any tick, distinct from an in-match [`InvokeError`] forfeit.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    /// The wasm bytes did not compile (not a valid module for the engine).
    #[error("controller module failed to compile: {0}")]
    Compile(String),
    /// The module compiled but could not be instantiated (e.g. it imports
    /// something the host does not provide — a v1 controller must be self-contained).
    #[error("controller module failed to instantiate: {0}")]
    Instantiate(String),
    /// A required ABI export (`memory`, `alloc`, or the contract entry) is absent.
    #[error("controller module is missing the `{0}` export")]
    MissingExport(String),
}

#[cfg(test)]
#[path = "controller.test.rs"]
mod tests;
