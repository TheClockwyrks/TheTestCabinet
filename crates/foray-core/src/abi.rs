//! The hand-rolled C ABI for browser playback (wasm32 only).
//!
//! The browser site ships no second rules engine: it loads *this* crate compiled
//! to `wasm32-unknown-unknown` and steps it to reconstruct a match. To avoid a
//! `wasm-bindgen` toolchain dependency (lead decision 3), the boundary is a tiny
//! hand-rolled C ABI that the browser/Node `WebAssembly` API can call directly:
//!
//! - `alloc(len) -> ptr` — the JS side asks the guest to reserve `len` bytes and
//!   writes the replay JSON there. The guest owns its linear memory; this is the
//!   only way the host can hand bytes in.
//! - `replay_load(ptr, len) -> 1|0` — parse the replay JSON at `ptr..ptr+len`,
//!   reconstruct the match, and hold it in a module global. `1` on success.
//! - `replay_board() -> i64` — pack `(ptr<<32)|len` of the static board JSON (the
//!   walls, dimensions, border, nests) the renderer draws once.
//! - `replay_step() -> i64` — advance one frame and pack `(ptr<<32)|len` of the
//!   [`StateSnapshot`](crate::engine::StateSnapshot) JSON for that frame. Returns
//!   `0` once the match is over (no more frames).
//! - `replay_reset()` — rewind to the first frame so playback can loop.
//!
//! The same `(ptr<<32)|len` packing the controller contract uses. All returned
//! buffers live in module globals so the pointer stays valid until the next call
//! that reuses it — the JS reads it immediately after each call.

use crate::board::Board;
use crate::engine::Match;
use crate::replay::Replay;

/// The reconstructed match and the static board, held across calls. Single-
/// threaded wasm, so a plain `static mut` accessed through a small unsafe shim is
/// adequate — there is no concurrency in the browser's wasm instance.
struct Playback {
    board_json: Vec<u8>,
    /// The per-tick action log, replayed by `replay_step`.
    ticks: Vec<crate::replay::TickInput>,
    /// The live match being stepped.
    game: Match,
    /// Index of the next tick to apply.
    cursor: usize,
    /// The full replay, kept so `replay_reset` can rebuild the match cheaply.
    replay: Replay,
    /// The most recent snapshot buffer, kept alive for the JS reader.
    out: Vec<u8>,
}

static mut PLAYBACK: Option<Playback> = None;

/// The scratch buffer `alloc` hands out, kept alive until the host has written
/// into it and called `replay_load`.
static mut INPUT: Vec<u8> = Vec::new();

/// Pack a pointer and length into the `i64` the ABI returns.
fn pack(ptr: *const u8, len: usize) -> i64 {
    ((ptr as i64) << 32) | (len as i64)
}

/// Reserve `len` bytes in the guest's linear memory and return a pointer the host
/// writes the replay JSON into. The buffer is held in a global so it is not freed
/// before `replay_load` reads it.
///
/// # Safety
/// Exported for the wasm host only. The host must write exactly into the returned
/// `len`-byte region and then call `replay_load(ptr, len)`.
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

/// Parse and reconstruct the replay sitting at `ptr..ptr+len`. Returns `1` on
/// success, `0` on any parse/reconstruction failure.
///
/// # Safety
/// `ptr`/`len` must describe a region previously returned by [`alloc`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn replay_load(ptr: i32, len: i32) -> i32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize) };
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return 0,
    };
    let replay = match Replay::from_json(text) {
        Ok(replay) => replay,
        Err(_) => return 0,
    };
    let board = match replay.board() {
        Ok(board) => board,
        Err(_) => return 0,
    };
    match build_playback(replay, board) {
        Some(playback) => {
            unsafe {
                PLAYBACK = Some(playback);
            }
            1
        }
        None => 0,
    }
}

/// Build a fresh playback positioned at the first frame.
fn build_playback(replay: Replay, board: Board) -> Option<Playback> {
    let board_json = serde_json::to_vec(&BoardJson::from(&board)).ok()?;
    let game = Match::new(board, replay.rules, replay.simulation);
    Some(Playback {
        board_json,
        ticks: replay.ticks.clone(),
        game,
        cursor: 0,
        replay,
        out: Vec::new(),
    })
}

/// Pack the static board JSON. Call once after `replay_load`.
///
/// # Safety
/// Exported for the wasm host only.
#[unsafe(no_mangle)]
pub extern "C" fn replay_board() -> i64 {
    // SAFETY: single-threaded; no aliasing across calls.
    unsafe {
        let playback = &raw const PLAYBACK;
        match (*playback).as_ref() {
            Some(playback) => pack(playback.board_json.as_ptr(), playback.board_json.len()),
            None => 0,
        }
    }
}

/// Advance one frame and pack its snapshot JSON. Returns `0` when the match is
/// already over (no further frames).
///
/// # Safety
/// Exported for the wasm host only.
#[unsafe(no_mangle)]
pub extern "C" fn replay_step() -> i64 {
    // SAFETY: single-threaded; the returned buffer stays alive in the global.
    unsafe {
        let slot = &raw mut PLAYBACK;
        let playback = match (*slot).as_mut() {
            Some(playback) => playback,
            None => return 0,
        };
        if playback.game.is_over() {
            return 0;
        }
        if playback.cursor < playback.ticks.len() {
            let input = &playback.ticks[playback.cursor];
            playback.game.step(&input.red, &input.blue);
            playback.cursor += 1;
        } else {
            // No more recorded input but the match was not flagged over — stamp
            // the committed result so the final frame shows the outcome.
            playback.game.state.result = Some(crate::state::MatchResult {
                winner: playback.replay.result.winner,
                score: playback.replay.result.score,
                kills: playback.replay.result.kills,
                ended: playback.replay.result.ended,
                ticks: playback.replay.result.ticks,
            });
        }
        let snapshot = playback.game.snapshot();
        playback.out = serde_json::to_vec(&snapshot).unwrap_or_default();
        pack(playback.out.as_ptr(), playback.out.len())
    }
}

/// Rewind playback to the first frame so the renderer can loop.
///
/// # Safety
/// Exported for the wasm host only.
#[unsafe(no_mangle)]
pub extern "C" fn replay_reset() {
    // SAFETY: single-threaded.
    unsafe {
        let slot = &raw mut PLAYBACK;
        if let Some(playback) = (*slot).as_mut() {
            let board = match playback.replay.board() {
                Ok(board) => board,
                Err(_) => return,
            };
            playback.game = Match::new(board, playback.replay.rules, playback.replay.simulation);
            playback.cursor = 0;
        }
    }
}

/// The static board the renderer draws once. A flat shape (not the controller's
/// `BoardView`, which is keyed to a team) carrying the geometry and the fixtures
/// that never move.
#[derive(serde::Serialize)]
struct BoardJson {
    id: String,
    width: i32,
    height: i32,
    border_x: i32,
    walls: Vec<[i32; 2]>,
    red_nest: [i32; 2],
    blue_nest: [i32; 2],
    /// Every jelly node's starting tile (both halves). A frame's `jelly` list only
    /// carries the nodes that are still *active*; a renderer subtracts that from
    /// this to draw the spent husks, without holding any rules of its own.
    jelly_nodes: Vec<[i32; 2]>,
}

impl From<&Board> for BoardJson {
    fn from(board: &Board) -> BoardJson {
        let nest = |t| {
            let p = board.nest(t);
            [p.x, p.y]
        };
        let jelly_nodes = board
            .initial_jelly(crate::board::Team::Red)
            .iter()
            .chain(board.initial_jelly(crate::board::Team::Blue).iter())
            .map(|p| [p.x, p.y])
            .collect();
        BoardJson {
            id: board.id.clone(),
            width: board.width,
            height: board.height,
            border_x: board.border_x,
            walls: board.walls().iter().map(|p| [p.x, p.y]).collect(),
            red_nest: nest(crate::board::Team::Red),
            blue_nest: nest(crate::board::Team::Blue),
            jelly_nodes,
        }
    }
}
