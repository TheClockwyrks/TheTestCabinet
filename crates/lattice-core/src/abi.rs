//! The hand-rolled C ABI for browser playback (wasm32 only).
//!
//! The console ships no second simulation: it loads *this* crate compiled to
//! `wasm32-unknown-unknown` and steps it to reconstruct a run's factory. To avoid
//! a `wasm-bindgen` toolchain dependency — the same call
//! [`foray-core`](../../foray-core/src/abi.rs) made — the boundary is a tiny C ABI
//! the browser's `WebAssembly` API can call directly:
//!
//! - `alloc(len) -> ptr` — the JS side asks the guest to reserve `len` bytes and
//!   writes the scenario JSON there. The guest owns its linear memory; this is the
//!   only way the host can hand bytes in.
//! - `playback_load(ptr, len) -> 1|0` — parse and validate the scenario at
//!   `ptr..ptr+len` and hold it in a module global. `1` on success; `0` if it does
//!   not parse or does not validate.
//! - `playback_board() -> i64` — pack `(ptr<<32)|len` of the static layout JSON
//!   (grid, run length, snapshot schedule, entities with resolved footprints) the
//!   renderer draws once.
//! - `playback_step() -> i64` — advance one tick and pack `(ptr<<32)|len` of that
//!   tick's [`Snapshot`](crate::state::Snapshot) JSON, checksum included. Returns
//!   `0` once the scenario's ticks are exhausted.
//! - `playback_reset()` — rewind to tick 0 so playback can loop.
//!
//! All the stepping logic lives in [`Playback`](crate::playback::Playback), which
//! compiles and is tested natively; this module adds only the C boundary and the
//! module global. Returned buffers live inside that global, so a pointer stays
//! valid until the next call that reuses it — the JS reads it immediately.

use crate::playback::Playback;

/// The loaded scenario, held across calls. Single-threaded wasm, so a plain
/// `static mut` behind a small unsafe shim is adequate — a browser wasm instance
/// has no concurrency.
static mut PLAYBACK: Option<Playback> = None;

/// The scratch buffer [`alloc`] hands out, kept alive until the host has written
/// into it and called [`playback_load`].
static mut INPUT: Vec<u8> = Vec::new();

/// Pack a pointer and length into the `i64` the ABI returns.
fn pack(ptr: *const u8, len: usize) -> i64 {
    ((ptr as i64) << 32) | (len as i64)
}

/// Reserve `len` bytes in the guest's linear memory and return a pointer the host
/// writes the scenario JSON into. The buffer is held in a global so it is not
/// freed before [`playback_load`] reads it.
///
/// # Safety
/// Exported for the wasm host only. The host must write exactly into the returned
/// `len`-byte region and then call `playback_load(ptr, len)`.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: i32) -> i32 {
    let len = len.max(0) as usize;
    // SAFETY: single-threaded wasm; the host serializes its calls.
    unsafe {
        let input = &raw mut INPUT;
        (*input).clear();
        (*input).resize(len, 0);
        (*input).as_mut_ptr() as i32
    }
}

/// Parse and validate the scenario at `ptr..ptr+len`. Returns `1` on success, `0`
/// on any parse or validation failure.
///
/// # Safety
/// `ptr`/`len` must describe a region previously returned by [`alloc`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn playback_load(ptr: i32, len: i32) -> i32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize) };
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return 0,
    };
    match Playback::load(text) {
        Ok(playback) => {
            // SAFETY: single-threaded; no other reference is live across this call.
            unsafe {
                PLAYBACK = Some(playback);
            }
            1
        }
        Err(_) => 0,
    }
}

/// Pack the static layout JSON. Call once after [`playback_load`].
///
/// # Safety
/// Exported for the wasm host only.
#[unsafe(no_mangle)]
pub extern "C" fn playback_board() -> i64 {
    // SAFETY: single-threaded; no aliasing across calls.
    unsafe {
        let playback = &raw const PLAYBACK;
        match (*playback).as_ref() {
            Some(playback) => {
                let board = playback.board();
                pack(board.as_ptr(), board.len())
            }
            None => 0,
        }
    }
}

/// Advance one tick and pack that tick's canonical state JSON. Returns `0` once
/// the scenario's ticks are exhausted (or before a successful load).
///
/// # Safety
/// Exported for the wasm host only.
#[unsafe(no_mangle)]
pub extern "C" fn playback_step() -> i64 {
    // SAFETY: single-threaded; the returned buffer stays alive in the global.
    unsafe {
        let slot = &raw mut PLAYBACK;
        let playback = match (*slot).as_mut() {
            Some(playback) => playback,
            None => return 0,
        };
        match playback.step() {
            Some(state) => pack(state.as_ptr(), state.len()),
            None => 0,
        }
    }
}

/// Rewind playback to tick 0 so the renderer can loop.
///
/// # Safety
/// Exported for the wasm host only.
#[unsafe(no_mangle)]
pub extern "C" fn playback_reset() {
    // SAFETY: single-threaded.
    unsafe {
        let slot = &raw mut PLAYBACK;
        if let Some(playback) = (*slot).as_mut() {
            playback.reset();
        }
    }
}
