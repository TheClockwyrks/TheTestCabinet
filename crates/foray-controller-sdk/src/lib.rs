//! The controller SDK: the guest side of the Foray controller ABI.
//!
//! A controller crate links this as an `rlib`, writes one function
//!
//! ```ignore
//! fn decide(world: &World) -> Action { /* ... */ }
//! ```
//!
//! and invokes [`controller!`] to wire it to the wasm boundary. The SDK then owns
//! everything between the host and that function:
//!
//! - the `alloc` export — the host calls it to reserve a buffer in the guest's own
//!   linear memory, then writes the `world` observation JSON there;
//! - the `tick` export the macro defines — it decodes the observation from
//!   `(ptr, len)`, calls `decide`, encodes the returned [`Action`] back into guest
//!   memory, and returns its location packed as `((out_ptr) << 32) | (out_len)`.
//!
//! This mirrors the host's expectations in `foray-host`'s `controller.rs` exactly
//! (decision 2): a plain `wasm32-unknown-unknown` core module exporting `memory`
//! (rustc emits this automatically for a `cdylib`), `alloc`, and the contract
//! entry. A `cdylib` controller crate gets all three from this one macro.
//!
//! The SDK also ships the [`grid`] maze helpers (a passability grid and a BFS the
//! greedy and soldier baselines pathfind over) and [`util`] tie-break-free
//! nearest-target selection, so a controller is a short policy on top of shared
//! plumbing rather than a re-implementation of pathfinding.

pub mod grid;
pub mod util;

use foray_core::{Action, World};

/// The scratch buffer the SDK hands the host through `alloc`, and the output
/// buffer the encoded action lives in. Both are module globals so they outlive the
/// single host call that reads them — the host writes the observation into the
/// `alloc` buffer before calling `tick`, and reads the action out of the output
/// buffer immediately after `tick` returns. Single-threaded wasm, so a `static mut`
/// behind a small unsafe shim is sufficient; there is no concurrency in the guest.
struct Scratch {
    /// The buffer `alloc` reserves and the host writes the observation into.
    input: Vec<u8>,
    /// The encoded action JSON, kept alive for the host to read after `tick`.
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
/// writes the observation JSON into.
///
/// The buffer is held in a module global so it is not freed before `tick` reads
/// it. The host always calls `alloc(len)` and then `tick(ptr, len)` in that order
/// for a single tick, so reusing one growable buffer is safe and avoids churning
/// the allocator every tick.
///
/// # Safety
/// Exported for the wasm host only. The host must write exactly `len` bytes into
/// the returned region and then call `tick(ptr, len)`.
#[doc(hidden)]
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: i32) -> i32 {
    let len = len.max(0) as usize;
    // SAFETY: single-threaded wasm; the host serializes `alloc` then `tick`, so no
    // other code touches `SCRATCH.input` between this reservation and the read.
    unsafe {
        let scratch = &raw mut SCRATCH;
        let input = &mut (*scratch).input;
        input.clear();
        input.resize(len, 0);
        input.as_mut_ptr() as i32
    }
}

/// The shared body of the `tick` export: decode the observation at `(ptr, len)`,
/// run `decide`, encode the action, and return its packed `(ptr, len)`.
///
/// On any decode failure the SDK returns an all-`Stop` action rather than trapping:
/// a malformed observation is the host's bug, not the controller's, and forfeiting
/// over it would be wrong. A `decide` that itself panics is left to trap (the host
/// classifies that as a forfeit) — the SDK does not paper over controller bugs.
///
/// # Safety
/// `ptr`/`len` must describe the region the matching `alloc` returned and the host
/// filled. Called only by the macro-generated `tick` export.
#[doc(hidden)]
pub unsafe fn dispatch(ptr: i32, len: i32, decide: fn(&World) -> Action) -> i64 {
    let len = len.max(0) as usize;
    // SAFETY: the host guarantees `ptr..ptr+len` is the buffer it just filled.
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };

    let action = match serde_json::from_slice::<World>(bytes) {
        Ok(world) => decide(&world),
        // A malformed observation is not a controller error; fall back to a legal
        // no-op so the match keeps running and no forfeit is wrongly charged.
        Err(_) => Action::all_stop(),
    };

    let encoded = serde_json::to_vec(&action).unwrap_or_else(|_| {
        // `Action` always serializes; this branch is unreachable, but encode the
        // safe fallback rather than panicking if it somehow is not.
        serde_json::to_vec(&Action::all_stop()).expect("all-stop action serializes")
    });

    // SAFETY: single-threaded; the host reads this buffer immediately after `tick`
    // returns and before the next `alloc`, so holding it in the global is sound.
    unsafe {
        let scratch = &raw mut SCRATCH;
        (*scratch).output = encoded;
        let out = &(*scratch).output;
        pack(out.as_ptr(), out.len())
    }
}

/// Wire a controller's `decide` function to the wasm contract ABI.
///
/// Expand this once in a controller crate's `lib.rs`, naming the function that
/// chooses the team's moves for a tick:
///
/// ```ignore
/// use foray_controller_sdk::controller;
/// use foray_core::{Action, World};
///
/// fn decide(world: &World) -> Action { /* ... */ }
///
/// controller!(decide);
/// ```
///
/// It defines the `tick` export (the contract entry name from the manifest) by
/// delegating to [`dispatch`]; the `alloc` and `memory` exports come from the SDK
/// and rustc. The crate must set `crate-type = ["cdylib"]` and build for
/// `wasm32-unknown-unknown` for the host to load it.
#[macro_export]
macro_rules! controller {
    ($decide:path) => {
        /// The Foray contract entry: invoked once per tick with the team's `world`
        /// observation, returning the team's `action` packed as `(ptr << 32) | len`.
        ///
        /// # Safety
        /// Exported for the wasm host only; `ptr`/`len` describe the buffer the
        /// host filled via `alloc`.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn tick(ptr: i32, len: i32) -> i64 {
            // SAFETY: the host upholds the `alloc`-then-`tick` protocol the SDK's
            // `dispatch` documents.
            unsafe { $crate::dispatch(ptr, len, $decide) }
        }
    };
}
