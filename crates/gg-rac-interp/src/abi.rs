//! The wasm boundary: the `memory`/`alloc`/`run_program` exports and the
//! `gg.call_tool` import that bridge [`crate::execute`] across the guest/host ABI.
//!
//! This module exists only when the crate is compiled for
//! `wasm32-unknown-unknown` (the committed interpreter artifact); the native build
//! omits it entirely, so the pure interpreter has no wasm surface. The ABI mirrors the
//! [Foray](../../foray_host)/[Lattice](../../lattice_host) core-module contract
//! (`memory` + `alloc` + a single entry returning a packed `(ptr << 32) | len`), with
//! one addition: the guest **imports** `gg.call_tool` so a script's tool call reaches
//! the real tools in the container.
//!
//! ## The ABI (v1)
//!
//! Exports:
//! - `memory` — the guest's linear memory (rustc emits this for a `cdylib`).
//! - `alloc(len: i32) -> i32` — reserve `len` bytes in a guest-owned transfer buffer
//!   and return a pointer the host writes into. Used both to hand in the request and
//!   to hand back each tool result; the guest copies bytes out before the next
//!   `alloc`, so one reused buffer is sufficient.
//! - `run_program(ptr: i32, len: i32) -> i64` — read the `len`-byte
//!   [`ProgramRequest`](crate::ProgramRequest) JSON at `ptr`, run it to completion, and
//!   return the [`ProgramOutcome`](crate::ProgramOutcome) JSON's location in guest
//!   memory packed as `(out_ptr << 32) | out_len`.
//!
//! Import (module `gg`):
//! - `call_tool(name_ptr, name_len, args_ptr, args_len) -> i64` — the host reads the
//!   tool `name` and its `args` JSON out of guest memory, performs the call, writes the
//!   result JSON back into guest memory (via the guest's own `alloc`), and returns its
//!   packed `(ptr << 32) | len`.
//!
//! Single-threaded wasm, so the transfer/output buffers are module globals reached
//! through a small unsafe shim — there is no concurrency in the guest instance.

use crate::interp::ToolHost;
use serde_json::Value;

// The host import: perform a tool call and return the result JSON's packed
// `(ptr, len)` in guest memory. Implemented by the wasmtime host in `crates/gg`'s
// `rac` module — it reads the UTF-8 `name`/`args` regions out of *this* guest's
// memory, performs the call, then writes the result back via the guest's `alloc` and
// returns its location.
#[link(wasm_import_module = "gg")]
unsafe extern "C" {
    #[link_name = "call_tool"]
    fn host_call_tool(name_ptr: i32, name_len: i32, args_ptr: i32, args_len: i32) -> i64;
}

/// The shared host→guest transfer buffer (`alloc`'s target) and the persistent output
/// buffer the final program outcome lives in.
///
/// `transfer` is overwritten by the host on every `alloc` (the request, then each tool
/// result); the guest copies its contents out before triggering the next one. `output`
/// is separate so the final `run_program` result survives after the run's last tool
/// call reused `transfer`.
struct Buffers {
    transfer: Vec<u8>,
    output: Vec<u8>,
}

static mut BUFFERS: Buffers = Buffers {
    transfer: Vec::new(),
    output: Vec::new(),
};

/// Pack a guest pointer and length into the ABI's `i64`: `(ptr << 32) | len`.
fn pack(ptr: *const u8, len: usize) -> i64 {
    ((ptr as i64) << 32) | (len as i64)
}

/// Unpack a `(ptr << 32) | len` value the host returns from `call_tool`.
fn unpack(packed: i64) -> (usize, usize) {
    let bits = packed as u64;
    ((bits >> 32) as usize, (bits & 0xFFFF_FFFF) as usize)
}

/// Reserve `len` bytes in the transfer buffer and return a pointer the host writes
/// into.
///
/// # Safety
/// Exported for the wasm host only. The host writes exactly `len` bytes into the
/// returned region and then either calls `run_program` (for the request) or reads it as
/// the `call_tool` result — always before the next `alloc`.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: i32) -> i32 {
    let len = len.max(0) as usize;
    // SAFETY: single-threaded wasm; the host serialises `alloc` with the call that
    // reads the buffer, so nothing else touches `transfer` in between.
    unsafe {
        let buffers = &raw mut BUFFERS;
        let transfer = &mut (*buffers).transfer;
        transfer.clear();
        transfer.resize(len, 0);
        transfer.as_ptr() as i32
    }
}

/// The `run_program` entry: run the request JSON at `(ptr, len)` and return the outcome
/// JSON's packed `(ptr, len)`.
///
/// # Safety
/// `ptr`/`len` must describe the buffer the matching `alloc` returned and the host
/// filled with the request JSON. Called only by the wasm host.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn run_program(ptr: i32, len: i32) -> i64 {
    let len = len.max(0) as usize;
    // SAFETY: the host guarantees `ptr..ptr+len` is the buffer it just filled. Copy the
    // request out immediately, because running it will reuse `transfer` for tool
    // results.
    let request = unsafe {
        let bytes = std::slice::from_raw_parts(ptr as *const u8, len);
        String::from_utf8_lossy(bytes).into_owned()
    };

    let mut host = WasmToolHost;
    let outcome = crate::execute(&request, &mut host);

    // SAFETY: single-threaded; the host reads `output` immediately after `run_program`
    // returns and makes no further `alloc` call, so holding it in the global is sound.
    unsafe {
        let buffers = &raw mut BUFFERS;
        (*buffers).output = outcome.into_bytes();
        let output = &(*buffers).output;
        pack(output.as_ptr(), output.len())
    }
}

/// The guest-side [`ToolHost`]: it marshals a tool call across the `gg.call_tool`
/// import and reads the result back out of guest memory.
struct WasmToolHost;

impl ToolHost for WasmToolHost {
    fn call_tool(&mut self, name: &str, args: &Value) -> Value {
        // The name and args live in guest-owned allocations distinct from the transfer
        // buffer, so they stay valid while the host reads them and then reuses
        // `transfer` (via `alloc`) to hand the result back.
        let name_bytes = name.as_bytes();
        let args_json = args.to_string();
        let args_bytes = args_json.as_bytes();

        let packed = unsafe {
            host_call_tool(
                name_bytes.as_ptr() as i32,
                name_bytes.len() as i32,
                args_bytes.as_ptr() as i32,
                args_bytes.len() as i32,
            )
        };
        let (result_ptr, result_len) = unpack(packed);

        // SAFETY: the host wrote `result_len` bytes at `result_ptr` (the pointer it got
        // from our `alloc`), which lies in this guest's memory. Copy them out before any
        // subsequent tool call reuses the buffer.
        let result_bytes =
            unsafe { std::slice::from_raw_parts(result_ptr as *const u8, result_len) };
        serde_json::from_slice(result_bytes).unwrap_or(Value::Null)
    }
}
