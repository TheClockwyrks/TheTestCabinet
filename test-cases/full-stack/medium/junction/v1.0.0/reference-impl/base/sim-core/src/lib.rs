// Junction — the Rust simulation core (specs/simulation.md).
//
// The whole deterministic city model lives here. The pure modules (`constants` …
// `game`) are plain Rust with no I/O — they compile natively for the balance harness
// (`tests/balance.rs`) and to wasm for the browser. The `wasm` module (compiled only for
// `wasm32`) is the thin `#[wasm_bindgen]` surface the JS/TS front end drives: it steps the
// sim, forwards player actions in, and hands the renderer zero-copy views over the tile
// arrays plus small snapshots of the moving agents, HUD stats, and menus. The front end
// owns rendering, input, the camera, audio, and particle playback — never a rule.

pub mod constants;
pub mod develop;
pub mod economy;
pub mod game;
pub mod graph;
pub mod menus;
pub mod mode;
pub mod rng;
pub mod tools;
pub mod transit;
pub mod types;
pub mod utilities;
pub mod world;

#[cfg(target_arch = "wasm32")]
mod wasm;
