//! A single loaded submission module and the once-per-scenario invocation across
//! the hand-rolled C ABI.
//!
//! ## The submission ABI (v1, wasm32-unknown-unknown core modules)
//!
//! A submission is a plain core module — *not* a component — exporting:
//!
//! - `memory` — its linear memory.
//! - `alloc(len: i32) -> i32` — reserve `len` bytes in the guest's own memory and
//!   return a pointer to them. The host writes the `scenario` JSON there.
//! - the contract entry (named by the manifest, here `simulate`):
//!   `simulate(ptr: i32, len: i32) -> i64` — read `len` bytes of `scenario` JSON
//!   at `ptr`, run the **whole** simulation, write the `state` JSON (the array of
//!   snapshots) into guest memory, and return its location packed as
//!   `((out_ptr as i64) << 32) | (out_len as i64)`.
//!
//! ## Why the contract entry is invoked ONCE, not per tick
//!
//! This is the central difference from Foray's controller (whose `tick` runs once
//! per simulation tick). Lattice scores an *engine*: the submission is handed the
//! whole scenario and runs it to completion in one call, returning every scheduled
//! snapshot. So a [`Submission`] loads, sets fuel **once** before the single
//! `simulate` call, and reads `store.get_fuel()` afterward — the difference is the
//! per-scenario fuel consumed, which *is* the performance result (lead decision 5).
//! There is no fuel refill and no persistent guest state across calls, because
//! there is exactly one call.

use wasmtime::{Engine, Instance, Memory, Module, Store, TypedFunc};

/// Why a single submission invocation failed. Every variant is a scoring failure
/// for the submission: the run records the submission as incorrect (no fuel score)
/// and surfaces the reason for diagnostics.
#[derive(Debug, Clone, thiserror::Error)]
pub enum InvokeError {
    /// The submission exhausted its per-scenario fuel ceiling.
    #[error("submission exhausted its fuel ceiling")]
    OutOfFuel,
    /// The submission's linear memory grew past the cap.
    #[error("submission exceeded its {limit}-byte memory cap (used {used} bytes)")]
    OutOfMemory { used: usize, limit: usize },
    /// The guest trapped (an unreachable, an out-of-bounds access, a panic, …).
    #[error("submission trapped: {0}")]
    Trap(String),
    /// `alloc`/`simulate` reported a pointer/length that falls outside guest memory.
    #[error("submission returned an out-of-bounds region (ptr {ptr}, len {len})")]
    BadRegion { ptr: u32, len: u32 },
    /// The bytes the submission returned were not the contract's `state` JSON (an
    /// array of snapshots).
    #[error("submission returned malformed state JSON: {0}")]
    BadJson(String),
}

/// One loaded submission, ready to be invoked once for a scenario. Holds the
/// wasmtime [`Store`] (fuel + memory-limit state) and the resolved `alloc` /
/// `simulate` exports.
pub struct Submission {
    store: Store<StoreState>,
    memory: Memory,
    alloc: TypedFunc<i32, i32>,
    simulate: TypedFunc<(i32, i32), i64>,
    /// The fuel ceiling set before the single `simulate` call.
    fuel_limit: u64,
    /// The linear-memory cap, retained for the [`InvokeError::OutOfMemory`]
    /// diagnostic.
    max_memory_bytes: usize,
}

/// Per-store host state. wasmtime calls back into [`ResourceLimiter`] before each
/// memory growth, so the cap is enforced at the point of `memory.grow` rather than
/// observed after the fact.
struct StoreState {
    limiter: MemoryLimiter,
}

/// Caps guest linear-memory growth at `max_memory_bytes`. wasmtime consults this
/// *before* growing memory and a denied request makes the guest's `memory.grow`
/// return `-1`, which a well-behaved allocator surfaces as an allocation failure
/// (and a misbehaving one usually turns into a trap) — either way the invocation
/// fails.
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

impl Submission {
    /// Compile and instantiate `wasm` (a submission core module's bytes) under
    /// `engine`, resolving the ABI exports. `entry` is the contract entry name from
    /// the manifest (`simulate`). `fuel_limit`/`max_memory_bytes` are the
    /// per-scenario sandbox limits. Fails before running if the module does not
    /// build or is missing a required export — that is a build/legality failure,
    /// distinct from an in-run [`InvokeError`].
    pub fn load(
        engine: &Engine,
        wasm: &[u8],
        entry: &str,
        fuel_limit: u64,
        max_memory_bytes: usize,
    ) -> Result<Submission, LoadError> {
        let module = Module::new(engine, wasm).map_err(|e| LoadError::Compile(e.to_string()))?;

        let mut store = Store::new(
            engine,
            StoreState {
                limiter: MemoryLimiter { max_memory_bytes },
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
        let simulate = instance
            .get_typed_func::<(i32, i32), i64>(&mut store, entry)
            .map_err(|_| LoadError::MissingExport(entry.into()))?;

        Ok(Submission {
            store,
            memory,
            alloc,
            simulate,
            fuel_limit,
            max_memory_bytes,
        })
    }

    /// Run the whole scenario: write `scenario_json` into the guest, call
    /// `simulate` once under the fuel ceiling, and read the returned `state` bytes
    /// back out. Returns the raw `state` JSON bytes (the caller parses them) paired
    /// with the fuel consumed (`fuel_limit - remaining`).
    ///
    /// Fuel is set **once** before the call — there is exactly one invocation per
    /// scenario, so the ceiling bounds the whole simulation and the consumed fuel is
    /// the performance result.
    pub fn invoke(&mut self, scenario_json: &[u8]) -> Result<(Vec<u8>, u64), InvokeError> {
        // Set the per-scenario fuel ceiling once. Unlike Foray's per-tick refill,
        // this is the budget for the entire `simulate` call.
        self.store
            .set_fuel(self.fuel_limit)
            .map_err(|e| InvokeError::Trap(e.to_string()))?;

        let len = i32::try_from(scenario_json.len())
            .map_err(|_| InvokeError::Trap("scenario too large to address".into()))?;

        let ptr = self.call_alloc(len)?;
        self.write_guest(ptr, scenario_json)?;

        let packed = self.call_simulate(ptr, len)?;
        let (out_ptr, out_len) = unpack(packed);
        let bytes = self.read_guest(out_ptr, out_len)?;

        // The fuel consumed over the single call is the performance result. Any
        // fuel the engine couldn't account for clamps to the full ceiling, which can
        // only happen if metering is unavailable — guarded against at load time.
        let remaining = self.store.get_fuel().unwrap_or(0);
        let consumed = self.fuel_limit.saturating_sub(remaining);
        Ok((bytes, consumed))
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
    fn call_simulate(&mut self, ptr: u32, len: i32) -> Result<i64, InvokeError> {
        self.simulate
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

    /// Validate that `[ptr, ptr + len)` lies wholly within current guest memory. A
    /// submission that lies about its output region fails rather than letting the
    /// host read out of bounds.
    fn check_region(&mut self, ptr: u32, len: u32) -> Result<(), InvokeError> {
        let size = self.memory.data_size(&self.store) as u64;
        let end = ptr as u64 + len as u64;
        if end > size {
            return Err(InvokeError::BadRegion { ptr, len });
        }
        Ok(())
    }

    /// Map a wasmtime call error onto the right failure. Fuel exhaustion and the
    /// memory cap surface as their own variants (the limiter denial usually arrives
    /// as a trap); everything else is a generic trap.
    fn classify_trap(&mut self, err: wasmtime::Error) -> InvokeError {
        if err.downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::OutOfFuel)
            || self.store.get_fuel().map(|f| f == 0).unwrap_or(false)
        {
            return InvokeError::OutOfFuel;
        }
        let used = self.memory.data_size(&self.store);
        if used >= self.max_memory_bytes {
            return InvokeError::OutOfMemory {
                used,
                limit: self.max_memory_bytes,
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

/// Why a submission module could not be loaded — a build/legality failure that
/// happens before the run, distinct from an in-run [`InvokeError`].
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    /// The wasm bytes did not compile (not a valid module for the engine).
    #[error("submission module failed to compile: {0}")]
    Compile(String),
    /// The module compiled but could not be instantiated (e.g. it imports something
    /// the host does not provide — a v1 submission must be self-contained).
    #[error("submission module failed to instantiate: {0}")]
    Instantiate(String),
    /// A required ABI export (`memory`, `alloc`, or the contract entry) is absent.
    #[error("submission module is missing the `{0}` export")]
    MissingExport(String),
}

#[cfg(test)]
#[path = "submission.test.rs"]
mod tests;
