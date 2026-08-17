//! **The ECMAScript guest**: quickjs-ng inside a `wit-bindgen` component that declares this crate's
//! own `sandbox` world.
//!
//! # What it is, and which arms are on it
//!
//! A program is a **module** here — `Module::declare(ctx, "program.js", program)` over the bytes the
//! host sent — so it writes its own `import` lines, declares whatever top-level names it likes, and
//! reads its own line numbers back out of any failure.
//!
//! The TypeScript and JavaScript arms are registered against it, which is what holds that pair to
//! differing in the compiler and nothing else. The PureScript arm still evaluates in its own
//! `componentize-js` guest, which is the guest this one replaces; converting it is a change to that
//! arm's prepare step, its prompt and its page.
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
//! formal parameters, against which the SDK's names resolve with no line the model wrote, and every
//! reported line arrived at by subtracting a calibration throw. Ruling D14 chose this engine; rulings
//! D9, D10 and D11 delete that arrangement.
//!
//! # What it costs, measured on this artifact
//!
//! | | `typescript.component.wasm` | this |
//! | --- | --- | --- |
//! | artifact | 14,123,934 B | ~1.2 MB core + 52 KB adapter |
//! | `Component::new`, gg's own `Config` | 11.7–24.3 s | 0.85–2.04 s |
//!
//! Both are paid once per process, behind a `OnceLock`; for the CLI a run is a process, so it is
//! once per run. The figures were taken minutes apart on one machine under a load average of ~30 on
//! 18 cores, so the absolutes are inflated and the ratio is the number to read.

use std::sync::OnceLock;

#[cfg(test)]
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
///
/// `#[cfg(test)]` because the one reader is the gate that holds the arm's page to it: a released
/// binary has no use for the JSON, and embedding it there would be bytes nothing reads.
#[cfg(test)]
pub(crate) const MANIFEST: &str = include_str!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/ecmascript.guest.json"
));

/// The import namespace the adapter satisfies, which is the preview1 snapshot's own module name.
const ADAPTER_NAME: &str = "wasi_snapshot_preview1";

/// **The scheme a code module is reached under**, which is `packages/gg-sandbox/guest/src/loader.rs`'s
/// own `LIB` constant.
///
/// It is a fact about this guest that the host has to know twice over: it is the line an arm tells a
/// model to write to reach a module it loaded, and it is the name a frame inside that module carries,
/// which is how [`locate`](crate::sandbox::locate) finds the module's own source map.
pub(super) const MODULE_SCHEME: &str = "lib:";

/// The encoded component, encoded once per process.
static COMPONENT: OnceLock<Vec<u8>> = OnceLock::new();

/// The compiled component, compiled once per process.
///
/// `#[cfg(test)]`, with [`component`] beside it: production compiles this guest through
/// [`engine::component`](crate::sandbox::engine::component), which caches one [`Component`] per
/// registered language, and a second cache in a released binary would be a second compile of the
/// same bytes.
#[cfg(test)]
static COMPILED: OnceLock<Component> = OnceLock::new();

/// **The component bytes an arm hands the seam**, for
/// [`guest_component`](super::ProgramLanguage::guest_component), which has no channel for a failure.
///
/// It panics rather than degrading, on the same terms
/// [`catalogue`](super::ProgramLanguage::catalogue) does: what could fail here is the encoding of an
/// artifact this build baked, which is a build defect rather than a runtime condition, and the tests
/// beside this module encode it on every run.
pub(super) fn embedded() -> &'static [u8] {
    component_bytes().unwrap_or_else(|error| {
        panic!("gg's embedded ECMAScript guest could not be encoded as a component: {error}")
    })
}

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
#[cfg(test)]
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

/// **The names a code module offers**, read off its top-level `export` lines.
///
/// One reader for both arms on this guest, because a module is one thing here: the loader hands a
/// program the module's own namespace, and a name the module did not export is not in it. There is
/// no arm that guesses at an unexported declaration.
///
/// The reading is lexical, which is what an `export` at the top level of a module makes it: the
/// keyword opens a line and nothing indents it. [TypeScript](super::typescript) reads `tsc`'s
/// emission, where the types are already erased, so a type-only export contributes nothing here
/// without anything having to know what a type is; [JavaScript](super::javascript) reads the
/// author's own file, which is the file the guest evaluates.
pub(super) fn exports(source: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut push = |name: &str| {
        if !name.is_empty() && !names.iter().any(|seen| seen == name) {
            names.push(name.to_string());
        }
    };
    for line in source.lines() {
        let Some(rest) = line.strip_prefix("export ") else {
            continue;
        };
        let rest = rest.trim_start();
        // `export { a, b as c };` — the list form, whose names are the ones after `as` where there
        // is one, because that is what the namespace offers.
        if let Some(list) = rest.strip_prefix('{')
            && let Some((list, _)) = list.split_once('}')
        {
            for entry in list.split(',') {
                let entry = entry.trim();
                push(entry.rsplit(" as ").next().unwrap_or(entry).trim());
            }
            continue;
        }
        // `export function f(…)`, `export class C`, `export const x = …`, and the modifiers that
        // may stand between the keyword and the name.
        let mut words = rest.split_whitespace();
        let Some(mut keyword) = words.next() else {
            continue;
        };
        while ["async", "default"].contains(&keyword) {
            let Some(next) = words.next() else {
                break;
            };
            keyword = next;
        }
        if !["function", "class", "const", "let", "var"].contains(&keyword) {
            continue;
        }
        let Some(name) = words.next() else {
            continue;
        };
        let name = name.trim_start_matches('*');
        let end = name
            .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
            .unwrap_or(name.len());
        push(&name[..end]);
    }
    names
}

#[cfg(test)]
#[path = "ecmascript.test.rs"]
mod tests;
