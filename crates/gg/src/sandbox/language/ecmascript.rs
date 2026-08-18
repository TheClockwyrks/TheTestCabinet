//! **The ECMAScript guest**: quickjs-ng inside a `wit-bindgen` component that declares this crate's
//! own `sandbox` world.
//!
//! # What it is, and which arms are on it
//!
//! A program is a **module** here — `Module::declare(ctx, "program.js", program)` over the bytes the
//! host sent — so it writes its own `import` lines, declares whatever top-level names it likes, and
//! reads its own line numbers back out of any failure.
//!
//! Every arm whose program becomes JavaScript evaluates here. The TypeScript and JavaScript arms are
//! registered against it as a declared pair, which is what holds them to differing in the compiler
//! and nothing else, and the PureScript arm's `esbuild` bundle is a module this guest declares
//! exactly as it declares theirs.
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
//! to `unreachable` after wizening and no bake flag restores it. Every one of those routes was tried
//! against the built guest before this one was chosen.
//!
//! So a program there is a **function body**: `new Function(...names, program)` with sixteen reserved
//! formal parameters, against which the SDK's names resolve with no line the model wrote, and every
//! reported line arrived at by subtracting a calibration throw. Ruling D14 chose this engine; rulings
//! D9, D10 and D11 delete that arrangement.
//!
//! # What it costs, measured on this artifact
//!
//! | | the `componentize-js` guest this replaces | this |
//! | --- | --- | --- |
//! | artifact | 14,123,934 B | ~1.2 MB core + 52 KB adapter |
//! | `Component::new`, gg's own `Config` | 11.7–24.3 s | 0.85–2.04 s |
//!
//! It is paid once per process, behind a `OnceLock`; for the CLI a run is a process, so it is once
//! per run. The figures were taken minutes apart on one machine under a load average of ~30 on 18
//! cores, so the absolutes are inflated and the ratio is the number to read.

use std::sync::OnceLock;

#[cfg(test)]
use wasmtime::component::Component;

use crate::sandbox::SandboxError;

use super::{ModuleExport, ModuleExportKind};

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

/// **The name the guest declares a program under**, which is
/// `packages/gg-sandbox/guest/src/loader.rs`'s own `PROGRAM`.
///
/// It is the name every frame in a program carries, so an arm whose compiler emits a source map
/// files that map under this name for [`locate`](crate::sandbox::locate) to find.
pub(super) const PROGRAM: &str = "program.js";

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

/// **What a code module offers**, read off its top-level `export` lines.
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
pub(super) fn exports(source: &str) -> Vec<ModuleExport> {
    exports_of(source, source)
}

/// The exports of `namespace`, **documented from `authored`** — the file the module's author really
/// wrote, when that is a different file from the one the guest evaluates.
///
/// The two are the same file on this arm and are not on [TypeScript's](super::typescript), where
/// `tsc` has already erased every type by the time the namespace can be read. The namespace is
/// still the emission's answer, because the emission is what the guest evaluates and a name that is
/// not in it is not callable — but the *declaration* a documentation view quotes is the author's
/// own, types and all, because a model reading it is about to write TypeScript against it. Nothing
/// is read twice: one file says which names exist, the other says how each was written.
pub(super) fn exports_of(namespace: &str, authored: &str) -> Vec<ModuleExport> {
    let written = declarations(authored);
    let emitted = declarations(namespace);
    let lines: Vec<&str> = namespace.lines().collect();
    exported(namespace)
        .into_iter()
        .map(|(name, local, line)| {
            match written
                .iter()
                .chain(emitted.iter())
                .find(|declared| declared.name == local)
            {
                Some(declared) => ModuleExport {
                    name,
                    kind: declared.kind,
                    declaration: declared.declaration.clone(),
                    doc: declared.doc.clone(),
                    returns: Vec::new(),
                    parameters: Vec::new(),
                },
                // A list export of something this file did not declare — a name it imported and
                // passed on. The `export` line is then the only thing its author wrote about it, so
                // it is what the view quotes.
                None => ModuleExport {
                    name,
                    kind: ModuleExportKind::Value,
                    declaration: lines.get(line).unwrap_or(&"").trim().to_string(),
                    doc: None,
                    returns: Vec::new(),
                    parameters: Vec::new(),
                },
            }
        })
        .collect()
}

/// Every name the namespace offers, in source order and without repeats: what it is called, the
/// local name it was declared under, and the line the `export` stands on.
fn exported(source: &str) -> Vec<(String, String, usize)> {
    let mut names: Vec<(String, String, usize)> = Vec::new();
    let mut push = |name: &str, local: &str, line: usize| {
        if !name.is_empty() && !names.iter().any(|(seen, _, _)| seen == name) {
            names.push((name.to_string(), local.to_string(), line));
        }
    };
    for (number, line) in source.lines().enumerate() {
        let Some(rest) = line.strip_prefix("export ") else {
            continue;
        };
        let rest = rest.trim_start();
        // `export { a, b as c };` — the list form, whose names are the ones after `as` where there
        // is one, because that is what the namespace offers. What stands before the `as` is the name
        // the declaration was written under, which is where its documentation is.
        if let Some(list) = rest.strip_prefix('{')
            && let Some((list, _)) = list.split_once('}')
        {
            for entry in list.split(',') {
                let entry = entry.trim();
                let (local, name) = entry.rsplit_once(" as ").unwrap_or((entry, entry));
                push(name.trim(), local.trim(), number);
            }
            continue;
        }
        let Some(name) = declared_name(rest) else {
            continue;
        };
        push(name, name, number);
    }
    names
}

/// One top-level declaration of a module, exported or not — everything a documentation view of it
/// needs, kept under the name it was *declared* as so a renaming export can find it.
struct Declared {
    /// The name the declaration itself gives.
    name: String,
    /// What a program does with it.
    kind: ModuleExportKind,
    /// The declaration as written, without its body.
    declaration: String,
    /// The comment written above it.
    doc: Option<String>,
}

/// Every top-level declaration `source` makes, in source order — the ones it exports on the same
/// line and the ones a later `export { … }` names.
fn declarations(source: &str) -> Vec<Declared> {
    let lines: Vec<&str> = source.lines().collect();
    let mut out: Vec<Declared> = Vec::new();
    for (number, line) in lines.iter().enumerate() {
        // Unindented, which is what a module's top level is; the `export` keyword is not part of
        // what makes a line a declaration, only of what makes it exported.
        if line.starts_with([' ', '\t']) {
            continue;
        }
        let rest = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some(name) = declared_name(rest) else {
            continue;
        };
        if out.iter().any(|declared| declared.name == name) {
            continue;
        }
        out.push(Declared {
            name: name.to_string(),
            kind: kind(rest),
            declaration: super::heads::head(line),
            doc: super::comments::block_doc(&lines, number)
                .or_else(|| super::comments::line_doc(&lines, number, &["//"])),
        });
    }
    out
}

/// The name `rest` declares, where `rest` is a line with any `export ` keyword already stripped.
fn declared_name(rest: &str) -> Option<&str> {
    let name = binding(rest)?.trim_start_matches('*');
    let end = name
        .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
        .unwrap_or(name.len());
    (end > 0).then(|| &name[..end])
}

/// What a declaration binds: the text starting at its name, once the modifiers and the keyword that
/// says what kind of thing it is have been read — `None` for a line that declares nothing.
fn binding(rest: &str) -> Option<&str> {
    let mut cursor = rest.trim_start();
    loop {
        let end = cursor.find(char::is_whitespace)?;
        let word = &cursor[..end];
        let after = cursor[end..].trim_start();
        if ["async", "default"].contains(&word) {
            cursor = after;
            continue;
        }
        return ["function", "class", "const", "let", "var"]
            .contains(&word)
            .then_some(after);
    }
}

/// What a program does with the declaration `rest` makes.
///
/// A `class` is a type, a `function` is a function, and a binding is whichever its initialiser makes
/// it: `const parse = (text) => …` is a function to everyone who calls it, and reporting it as a
/// value because of the keyword it happens to be spelled with would tell a model the opposite of
/// what it needs to know. The reading is narrow on purpose — an initialiser that *opens* a function
/// or an arrow, rather than any initialiser with an `=>` somewhere inside it — because a `map` call
/// in a constant's value is not what that constant is.
fn kind(rest: &str) -> ModuleExportKind {
    let word = rest
        .split_whitespace()
        .find(|word| !["async", "default"].contains(word))
        .unwrap_or_default();
    match word {
        "class" => ModuleExportKind::Type,
        "function" => ModuleExportKind::Function,
        _ => match rest.split_once('=').map(|(_, value)| value) {
            Some(value) if opens_a_function(value) => ModuleExportKind::Function,
            _ => ModuleExportKind::Value,
        },
    }
}

/// Whether `value` — the text after a binding's `=` — opens a function.
fn opens_a_function(value: &str) -> bool {
    let value = value.trim_start();
    let value = value.strip_prefix("async").map_or(value, str::trim_start);
    if value.starts_with("function") {
        return true;
    }
    // A **type-parameter list** stands between the `=` and the parameter list an arrow is
    // recognised by, on the arm this reader is written for as much as on its untyped twin:
    // `const identity = <T>(value: T): T => value` is an ordinary TypeScript arrow, and reading it
    // as a value would file a callable declaration under the one kind a
    // [use](crate::docs::DocsRuntime::use_views) opens no page for — so a model would be handed the
    // module and not the manual for the very function it came for. What the same `<` opens where
    // there is no arrow behind it — an old-style `<Row>data` assertion — is still a value, because
    // what decides that is what follows the list rather than the list itself.
    let value = match value.strip_prefix('<') {
        Some(rest) => match after_angles(rest) {
            Some(rest) => rest.trim_start(),
            // An unclosed one is a line the compiler will reject; nothing here guesses.
            None => return false,
        },
        None => value,
    };
    let after = match value.strip_prefix('(') {
        // A parameter list: whatever follows its own `)`, counted so a default value's parentheses
        // do not close it early.
        Some(mut rest) => {
            let mut depth = 1usize;
            loop {
                let Some(at) = rest.find([')', '(']) else {
                    // An unclosed parameter list is a line the compiler will reject; nothing here
                    // guesses at what its author meant.
                    return false;
                };
                match rest.as_bytes()[at] {
                    b'(' => depth += 1,
                    _ => depth -= 1,
                }
                rest = &rest[at + 1..];
                if depth == 0 {
                    break rest;
                }
            }
        }
        // A single parameter with no parentheses: `const twice = x => x * 2`.
        None => {
            let end = value
                .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
                .unwrap_or(value.len());
            &value[end..]
        }
    };
    arrow_follows(after)
}

/// Whether an arrow follows a parameter list — immediately, or past the **return type** this arm's
/// typed twin writes between the two.
///
/// `(value: T): T => value` is the shape most of a TypeScript module's arrows are written in, and a
/// reading that demanded the arrow immediately after the `)` would file every one of them as a
/// value — which is the one classification that costs the model a page, since a
/// [use](crate::docs::DocsRuntime::use_views) opens a view per *callable* declaration.
///
/// The arrow is looked for at the top level of the annotation, so a parameter typed as a function —
/// `(handler): (row: Row) => void` — is not what makes this one a function. Where the annotation is
/// itself a function type the two readings agree anyway, which is why the depth is counted rather
/// than the first `=>` taken.
fn arrow_follows(after: &str) -> bool {
    let after = after.trim_start();
    if after.starts_with("=>") {
        return true;
    }
    let Some(annotation) = after.strip_prefix(':') else {
        return false;
    };
    let bytes = annotation.as_bytes();
    let mut depth = 0usize;
    for (at, byte) in bytes.iter().enumerate() {
        match byte {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            b'=' if depth == 0 && bytes.get(at + 1) == Some(&b'>') => return true,
            _ => {}
        }
    }
    false
}

/// The text after the `>` that closes a type-parameter list whose `<` has already been read, or
/// `None` when the line never closes it.
///
/// Counted rather than searched for, because a type parameter may carry a bound that is itself
/// generic — `<T extends Array<string>>` closes twice before it is done.
fn after_angles(mut rest: &str) -> Option<&str> {
    let mut depth = 1usize;
    loop {
        let at = rest.find(['<', '>'])?;
        match rest.as_bytes()[at] {
            b'<' => depth += 1,
            _ => depth -= 1,
        }
        rest = &rest[at + 1..];
        if depth == 0 {
            return Some(rest);
        }
    }
}

#[cfg(test)]
#[path = "ecmascript.test.rs"]
mod tests;
