//! The submission SDK: the guest side of the Lattice submission ABI.
//!
//! A submission crate links this as an `rlib`, writes one function
//!
//! ```ignore
//! fn simulate(scenario: &Scenario) -> Vec<Snapshot> { /* ... */ }
//! ```
//!
//! and invokes [`simulate!`] to wire it to the wasm boundary. The SDK then owns
//! everything between the host and that function:
//!
//! - the `alloc` export — the host calls it to reserve a buffer in the guest's own
//!   linear memory, then writes the `scenario` JSON there;
//! - the `simulate` export the macro defines — it decodes the scenario from
//!   `(ptr, len)`, calls the submission's `simulate`, encodes the returned
//!   snapshots back into guest memory, and returns their location packed as
//!   `((out_ptr) << 32) | (out_len)`.
//!
//! This mirrors the host's expectations in `lattice-host`'s `submission.rs`
//! exactly (lead decision 1): a plain `wasm32-unknown-unknown` core module
//! exporting `memory` (rustc emits this automatically for a `cdylib`), `alloc`,
//! and the contract entry. A `cdylib` submission crate gets all three from this
//! one macro.
//!
//! ## Once per scenario, not once per tick
//!
//! Unlike Foray's controller (whose `tick` runs every simulation tick), the
//! submission's `simulate` runs **once** with the whole scenario and returns every
//! scheduled snapshot. So the SDK re-exports [`Scenario`] and [`Snapshot`] from
//! [`lattice-core`](lattice_core) and the submission writes a plain
//! `&Scenario -> Vec<Snapshot>`; it never touches raw pointers.

// Re-export the contract types a submission consumes and produces, so it depends
// on this SDK alone and never names `lattice_core` directly (though it may, the
// re-export keeps the surface small and stable).
pub use lattice_core::{Scenario, Snapshot};

/// The scratch buffer the SDK hands the host through `alloc`, and the output
/// buffer the encoded state lives in. Both are module globals so they outlive the
/// single host call that reads them — the host writes the scenario into the
/// `alloc` buffer before calling `simulate`, and reads the state out of the output
/// buffer immediately after `simulate` returns. Single-threaded wasm, so a
/// `static mut` behind a small unsafe shim is sufficient; there is no concurrency
/// in the guest.
struct Scratch {
    /// The buffer `alloc` reserves and the host writes the scenario into.
    input: Vec<u8>,
    /// The encoded state JSON, kept alive for the host to read after `simulate`.
    output: Vec<u8>,
}

static mut SCRATCH: Scratch = Scratch {
    input: Vec::new(),
    output: Vec::new(),
};

/// Pack a guest pointer and length into the `i64` the contract entry returns, the
/// same encoding the host unpacks: `((ptr) << 32) | (len)`.
fn pack(ptr: *const u8, len: usize) -> i64 {
    ((ptr as i64) << 32) | (len as i64)
}

/// Reserve `len` bytes in the guest's linear memory and return a pointer the host
/// writes the scenario JSON into.
///
/// The buffer is held in a module global so it is not freed before `simulate`
/// reads it. The host always calls `alloc(len)` and then `simulate(ptr, len)` in
/// that order, so reusing one growable buffer is safe.
///
/// # Safety
/// Exported for the wasm host only. The host must write exactly `len` bytes into
/// the returned region and then call `simulate(ptr, len)`.
#[doc(hidden)]
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: i32) -> i32 {
    let len = len.max(0) as usize;
    // SAFETY: single-threaded wasm; the host serializes `alloc` then `simulate`, so
    // no other code touches `SCRATCH.input` between this reservation and the read.
    unsafe {
        let scratch = &raw mut SCRATCH;
        let input = &mut (*scratch).input;
        input.clear();
        input.resize(len, 0);
        input.as_mut_ptr() as i32
    }
}

/// The shared body of the `simulate` export: decode the scenario at `(ptr, len)`,
/// run the submission's `run`, encode the snapshots, and return their packed
/// `(ptr, len)`.
///
/// On a scenario decode failure the SDK returns an empty snapshot array rather than
/// trapping — a malformed scenario is the host's bug, not the submission's, and an
/// empty array is simply scored as incorrect (a wrong count) without charging the
/// submission a trap. A `run` that itself panics is left to trap (the host
/// classifies that as a failure) — the SDK does not paper over submission bugs.
///
/// # Safety
/// `ptr`/`len` must describe the region the matching `alloc` returned and the host
/// filled. Called only by the macro-generated `simulate` export.
#[doc(hidden)]
pub unsafe fn dispatch(ptr: i32, len: i32, run: fn(&Scenario) -> Vec<Snapshot>) -> i64 {
    let len = len.max(0) as usize;
    // SAFETY: the host guarantees `ptr..ptr+len` is the buffer it just filled.
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };

    let snapshots = match serde_json::from_slice::<Scenario>(bytes) {
        Ok(scenario) => run(&scenario),
        // A malformed scenario is not a submission error; emit no snapshots so the
        // host scores it as incorrect rather than a trap being wrongly charged.
        Err(_) => Vec::new(),
    };

    let encoded = serde_json::to_vec(&snapshots).unwrap_or_else(|_| b"[]".to_vec());

    // SAFETY: single-threaded; the host reads this buffer immediately after
    // `simulate` returns and before the next `alloc`, so holding it in the global
    // is sound.
    unsafe {
        let scratch = &raw mut SCRATCH;
        (*scratch).output = encoded;
        let out = &(*scratch).output;
        pack(out.as_ptr(), out.len())
    }
}

/// Wire a submission's `simulate` function to the wasm contract ABI.
///
/// Expand this once in a submission crate's `lib.rs`, naming the function that runs
/// the whole scenario and returns every scheduled snapshot:
///
/// ```ignore
/// use lattice_sdk::{simulate, Scenario, Snapshot};
///
/// fn run(scenario: &Scenario) -> Vec<Snapshot> { /* ... */ }
///
/// simulate!(run);
/// ```
///
/// It defines the `simulate` export (the contract entry name from the manifest) by
/// delegating to [`dispatch`]; the `alloc` and `memory` exports come from the SDK
/// and rustc. The crate must set `crate-type = ["cdylib"]` and build for
/// `wasm32-unknown-unknown` for the host to load it.
#[macro_export]
macro_rules! simulate {
    ($run:path) => {
        /// The Lattice contract entry: invoked once with the whole `scenario`,
        /// returning the `state` (the array of snapshots) packed as
        /// `(ptr << 32) | len`.
        ///
        /// # Safety
        /// Exported for the wasm host only; `ptr`/`len` describe the buffer the
        /// host filled via `alloc`.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn simulate(ptr: i32, len: i32) -> i64 {
            // SAFETY: the host upholds the `alloc`-then-`simulate` protocol the
            // SDK's `dispatch` documents.
            unsafe { $crate::dispatch(ptr, len, $run) }
        }
    };
}
