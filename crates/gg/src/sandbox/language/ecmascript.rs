//! **The ECMAScript guest the three JavaScript-evaluating arms are moving to**: quickjs-ng inside a
//! `wit-bindgen` component that declares this crate's own `sandbox` world.
//!
//! # What it is, and what it is not yet
//!
//! It is a built, embedded, instantiable artifact with gg's whole membrane behind it. It is **not**
//! registered as any language's guest: [`typescript`](super::typescript),
//! [`javascript`](super::javascript) and [`purescript`](super::purescript) still evaluate in
//! `typescript::COMPONENT`, and nothing on a turn path reaches this module. Converting those three
//! arms is a change to each arm's prepare step, each arm's prompt and each arm's page; this is the
//! floor those changes stand on, landed on its own so that the engine is proved before three arms
//! are moved onto it.
//!
//! # Why a second guest exists at all
//!
//! Because the incumbent one cannot keep the contract, and not for want of configuration.
//! `apps/docs/src/content/docs/gg/responses-as-code/invariants.md` requires that the bytes gg
//! evaluates are the bytes the model sent and that every SDK name a program uses comes from an
//! `import` the program wrote. StarlingMonkey — the engine `componentize-js` bakes — has no way to
//! evaluate module source at run time by ANY route: `import()` of a `data:` URL, of a `blob:`, of a
//! `node:` specifier, of a path, and of the same specifier smuggled through a nested `new Function`
//! all trap the store at `path_filestat_get`, because `componentize-js` stubs the preview1 filesystem
//! to `unreachable` after wizening and no bake flag restores it. That is measured, exhaustively, in
//! `gg-js-runtime-decision.md`.
//!
//! So a program there is a **function body**: `new Function(...names, program)` with sixteen reserved
//! formal parameters (`const context = 1` is a `SyntaxError`), evaluated over a re-printed AST rather
//! than the model's own bytes, with `import`, `export` and top-level `await` refused in writing, and
//! every reported line arrived at by subtracting a calibration throw. Ruling D14 chose this engine;
//! rulings D9, D10 and D11 delete that arrangement.
//!
//! # What it costs, measured on this artifact
//!
//! | | `typescript.component.wasm` | this |
//! | --- | --- | --- |
//! | artifact | 14,123,934 B | ~1.2 MB core + 52 KB adapter |
//! | `Component::new`, gg's own `Config` | 11.7–24.3 s | 0.85–2.04 s |
//!
//! Both are paid once per process, behind a [`OnceLock`]; for the CLI a run is a process, so it is
//! once per run. The figures were taken minutes apart on one machine under a load average of ~30 on
//! 18 cores, so the absolutes are inflated and the ratio is the number to read.

use std::sync::OnceLock;

use wasmtime::component::Component;

use crate::sandbox::SandboxError;

/// The core module `rustc` emitted for `wasm32-wasip1`.
///
/// It is not committed. `gg-artifact-typescript` runs `packages/gg-sandbox/build.sh` as a step of
/// building this crate — which runs `guest.sh`, which builds `packages/gg-sandbox/guest` — and this
/// line embeds what it wrote into that crate's `OUT_DIR`. So the guest is baked out of the SDK
/// sources in this checkout, on the build that compiles the module describing it.
const CORE: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/ecmascript.core.wasm"
));

/// The pinned `wasi_snapshot_preview1` **reactor** adapter, which turns the preview1 core module
/// above into a preview 2 component.
///
/// `wasm32-wasip1` is a preview1 target, and the target is not incidental: a guest compiled to
/// `wasm32-unknown-unknown` has no standard error at all — std's own `cfg_select!` falls through to
/// `unsupported.rs`, where a write is discarded and reported as a success — and standard error is
/// this guest's whole failure surface.
const ADAPTER: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/ecmascript.adapter.wasm"
));

/// What built the two above, for the arm's own documentation to quote rather than restate.
pub(crate) const MANIFEST: &str = include_str!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/ecmascript.guest.json"
));

/// The import namespace the adapter satisfies, which is the preview1 snapshot's own module name.
const ADAPTER_NAME: &str = "wasi_snapshot_preview1";

/// The encoded component, encoded once per process.
static COMPONENT: OnceLock<Vec<u8>> = OnceLock::new();

/// The compiled component, compiled once per process.
static COMPILED: OnceLock<Component> = OnceLock::new();

/// **The component bytes**, encoded from [`CORE`] and [`ADAPTER`] on first use.
///
/// In gg's own process, with no `wasm-tools` binary anywhere, exactly as
/// [`rust`](super::rust)'s per-program encode works: the core module carries the `component-type`
/// custom sections `wit-bindgen` wrote, and those sections *are* the world, so this reads gg's own
/// WIT out of the artifact rather than being told it again. Encoding here rather than in `build.sh`
/// is what makes the component a run instantiates the product of the `wasm-encoder` gg's own
/// wasmtime agrees with, rather than of whichever one a build machine's `wasm-tools` bundled.
///
/// Measured at 5–31 ms, against a `Component::new` an order of magnitude longer.
pub(crate) fn component_bytes() -> Result<&'static [u8], SandboxError> {
    if let Some(bytes) = COMPONENT.get() {
        return Ok(bytes);
    }
    let encoded = wit_component::ComponentEncoder::default()
        .validate(true)
        .module(CORE)
        .and_then(|encoder| encoder.adapter(ADAPTER_NAME, ADAPTER))
        .and_then(|mut encoder| encoder.encode())
        .map_err(|error| {
            SandboxError::Compile(format!(
                "gg could not encode its ECMAScript guest as a component: {error:#}"
            ))
        })?;
    let _ = COMPONENT.set(encoded);
    Ok(COMPONENT
        .get()
        .expect("the bytes were just set, and a `OnceLock` never unsets"))
}

/// **The compiled component**, compiled against the process-wide engine on first use.
///
/// Race-idempotent rather than locked, on the same terms
/// [`engine::component`](crate::sandbox::engine) is: two threads arriving together may both compile,
/// the first `set` wins, and the loser's is dropped — which costs one wasted compile in a window a
/// real run never enters and avoids holding a lock across a multi-second compile.
pub(crate) fn component() -> Result<&'static Component, SandboxError> {
    if let Some(component) = COMPILED.get() {
        return Ok(component);
    }
    let compiled = crate::sandbox::engine::compile_bytes(component_bytes()?)?;
    let _ = COMPILED.set(compiled);
    Ok(COMPILED
        .get()
        .expect("the component was just set, and a `OnceLock` never unsets"))
}

#[cfg(test)]
#[path = "ecmascript.test.rs"]
mod tests;
