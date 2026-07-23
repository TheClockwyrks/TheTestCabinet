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

// --- Playback ABI ----------------------------------------------------------------
//
// Browser playback drives a run's OWN engine, not the reference: the console loads
// the submission's `engine.wasm` and steps it to draw the factory the submission
// actually computed. To make one `simulate`-only engine steppable a tick at a time,
// the SDK's playback ABI re-runs the submission's `run` over a bounded dense window
// (one snapshot per tick, `1..=WINDOW`) ONCE on load, caches those frames in linear
// memory, and serves them O(1) from `playback_step` — so an efficient engine that
// skips ticks for scoring still yields every tick here, and no huge trace is stored.
// These exports mirror `lattice-core`'s reference playback ABI byte for byte, so the
// renderer drives a submission exactly as it drives the reference build.

/// The dense playback window, in ticks. `playback_load` runs the submission over
/// ticks `1..=WINDOW`; those frames must fit the guest's linear memory alongside the
/// engine, and a per-tick canonical state is large (thousands of item positions), so
/// the window is bounded. A couple of thousand ticks covers the warm-up and the
/// onset of steady state — the stretch of a run worth watching — which is what
/// playback shows; it does not fast-forward to the far scored ticks.
const PLAYBACK_WINDOW_TICKS: u64 = 1500;

/// The playback cache: the static board, the submission's own per-tick frames over
/// the window, a cursor into them, and a scratch buffer holding the current frame's
/// JSON for the host to read. A module global for the same single-threaded-wasm
/// reason as [`SCRATCH`].
struct PlaybackCache {
    board: Vec<u8>,
    frames: Vec<Snapshot>,
    cursor: usize,
    out: Vec<u8>,
}

static mut PLAYBACK: PlaybackCache = PlaybackCache {
    board: Vec::new(),
    frames: Vec::new(),
    cursor: 0,
    out: Vec::new(),
};

/// The dense playback schedule for a scenario of `ticks` length: a snapshot on
/// **every** tick from `1` up to `min(ticks, PLAYBACK_WINDOW_TICKS)`, and that
/// windowed length. One snapshot per tick is what makes the cached frames a smooth
/// per-tick animation; the cap keeps them within the guest's memory. A zero-tick
/// scenario yields an empty window, which `dispatch_playback_load` treats as a load
/// failure (there is nothing to play).
fn playback_window(ticks: u64) -> (u64, Vec<u64>) {
    let window = ticks.min(PLAYBACK_WINDOW_TICKS);
    (window, (1..=window).collect())
}

/// Shared body of the `playback_load` export: decode the scenario, run the
/// submission's `run` over a bounded dense window from tick 0, and cache the frames
/// and the static board. Returns `1` on success, `0` if the scenario is malformed or
/// empty — matching the reference `playback_load`'s parse-failure contract.
///
/// # Safety
/// `ptr`/`len` must describe the region a matching `alloc` returned and the host
/// filled. Called only by the macro-generated `playback_load` export.
#[doc(hidden)]
pub unsafe fn dispatch_playback_load(
    ptr: i32,
    len: i32,
    run: fn(&Scenario) -> Vec<Snapshot>,
) -> i32 {
    let len = len.max(0) as usize;
    // SAFETY: the host guarantees `ptr..ptr+len` is the buffer it just filled.
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };
    let mut scenario = match serde_json::from_slice::<Scenario>(bytes) {
        Ok(scenario) => scenario,
        Err(_) => return 0,
    };

    // Bound the run to a dense window from tick 0 — one frame per tick, capped so the
    // cached frames fit memory. The board is serialized from this WINDOWED scenario,
    // so the renderer's "tick / total" reads against the window it will play.
    let (window, snapshots) = playback_window(scenario.ticks);
    if window == 0 {
        return 0;
    }
    scenario.ticks = window;
    scenario.snapshots = snapshots;

    let board = lattice_core::playback::board_json(&scenario);
    let frames = run(&scenario);

    // SAFETY: single-threaded; no other reference to PLAYBACK is live across this.
    unsafe {
        let playback = &raw mut PLAYBACK;
        (*playback).board = board;
        (*playback).frames = frames;
        (*playback).cursor = 0;
        (*playback).out = Vec::new();
    }
    1
}

/// Shared body of `playback_board`: the cached static layout, or `0` before a
/// successful load.
#[doc(hidden)]
pub fn dispatch_playback_board() -> i64 {
    // SAFETY: single-threaded; the board buffer stays alive in the global.
    unsafe {
        let playback = &raw const PLAYBACK;
        let board = &(*playback).board;
        if board.is_empty() {
            0
        } else {
            pack(board.as_ptr(), board.len())
        }
    }
}

/// Shared body of `playback_step`: the next cached frame's JSON packed as
/// `(ptr, len)`, or `0` once the window is exhausted (or before a load). The frame
/// is serialized on demand and held in the global so the returned pointer stays
/// valid until the next step.
#[doc(hidden)]
pub fn dispatch_playback_step() -> i64 {
    // SAFETY: single-threaded; the returned buffer stays alive in the global.
    unsafe {
        let playback = &raw mut PLAYBACK;
        let cursor = (*playback).cursor;
        // Bind an explicit reference to the frames before indexing, so the index does
        // not autoref through the raw-pointer dereference (the same field-reference
        // pattern `dispatch` uses for the output buffer).
        let frames = &(*playback).frames;
        if cursor >= frames.len() {
            return 0;
        }
        let encoded = serde_json::to_vec(&frames[cursor]).unwrap_or_else(|_| b"null".to_vec());
        (*playback).cursor = cursor + 1;
        (*playback).out = encoded;
        let out = &(*playback).out;
        pack(out.as_ptr(), out.len())
    }
}

/// Shared body of `playback_reset`: rewind to the window's first frame so the
/// renderer can loop.
#[doc(hidden)]
pub fn dispatch_playback_reset() {
    // SAFETY: single-threaded.
    unsafe {
        let playback = &raw mut PLAYBACK;
        (*playback).cursor = 0;
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

        /// Browser-playback: load a scenario and run this engine over a bounded
        /// dense window, caching each tick's state. Returns `1` on success, `0` on a
        /// malformed/empty scenario. Mirrors `lattice-core`'s reference
        /// `playback_load` so the console's renderer drives this engine identically.
        ///
        /// # Safety
        /// Exported for the wasm host only; `ptr`/`len` describe the buffer the host
        /// filled via `alloc`.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn playback_load(ptr: i32, len: i32) -> i32 {
            // SAFETY: the host upholds the `alloc`-then-`playback_load` protocol.
            unsafe { $crate::dispatch_playback_load(ptr, len, $run) }
        }

        /// Browser-playback: the static board (grid, run length, entities +
        /// footprints), packed `(ptr << 32) | len`, or `0` before a load.
        ///
        /// # Safety
        /// Exported for the wasm host only.
        #[unsafe(no_mangle)]
        pub extern "C" fn playback_board() -> i64 {
            $crate::dispatch_playback_board()
        }

        /// Browser-playback: the next cached tick's state, packed `(ptr << 32) | len`,
        /// or `0` once the window is exhausted.
        ///
        /// # Safety
        /// Exported for the wasm host only.
        #[unsafe(no_mangle)]
        pub extern "C" fn playback_step() -> i64 {
            $crate::dispatch_playback_step()
        }

        /// Browser-playback: rewind to the window's first frame so the renderer can
        /// loop.
        ///
        /// # Safety
        /// Exported for the wasm host only.
        #[unsafe(no_mangle)]
        pub extern "C" fn playback_reset() {
            $crate::dispatch_playback_reset()
        }
    };
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
