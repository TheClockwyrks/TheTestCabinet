//! **The component TeaVM's wasm backend wrote** — the step between a core module and something gg's
//! engine can instantiate, done in gg's own process.
//!
//! Every other compiled arm gets the first half of this for free: `wit-bindgen` stamps a
//! `component-type` custom section into an object file, so by the time `wit_component` sees the
//! linked module it already knows which world the module implements. **TeaVM stamps nothing** — it
//! has never heard of the component model — so gg writes that section itself, out of its own WIT,
//! and appends it before encoding. That is exactly what `wasm-tools component embed` does, done in
//! process because gg is copied as a single file into a run container and cannot shell out to a tool
//! that is not in the image.
//!
//! # Why nothing calls this yet
//!
//! Because neither JVM arm is on this route. `java.rs` and `kotlin.rs` still answer
//! [TypeScript's component](super::typescript) and their compilers still emit JavaScript: the
//! model-facing half of both SDKs is written against a **JavaScript object**, and moving it — with
//! its code modules, its healing and its diagnostics — is each arm's own step rather than a
//! substrate's. What is here is complete, and is driven end to end by `jvm.wire.test.rs`: a
//! hand-written Java program, really compiled to wasm, really encoded here, really instantiated
//! against the production membrane, really answered, and really killed by its own runtime.
//!
//! The `allow` below is that state written down. It goes when the first arm converts.

#![allow(
    dead_code,
    reason = "the wasm route is complete and proven by `jvm.wire.test.rs`; the two arms that will \
              call it convert in their own steps, and until then nothing on a turn's path reaches it"
)]

// ---------------------------------------------------------------------------------------------

/// The pinned `wasi_snapshot_preview1` **reactor** adapter.
///
/// TeaVM's `WEBASSEMBLY_WASI` backend emits a core module importing the preview1 snapshot — four
/// functions, measured: `clock_time_get`, `args_sizes_get`, `args_get` and `fd_write` — and this is
/// what implements them in terms of the preview 2 interfaces gg's linker provides. It rides inside
/// gg's binary for the reason every other arm's does: gg is copied as a single file into an
/// ephemeral run container. `packages/gg-sandbox-java/java-version.sh` carries the pin.
const ADAPTER: &[u8] = include_bytes!(concat!(env!("GG_ARTIFACTS_JAVA"), "/java.adapter.wasm"));

/// The import namespace the adapter satisfies, which is the preview1 snapshot's own module name.
const ADAPTER_NAME: &str = "wasi_snapshot_preview1";

/// gg's own WIT, read here as **text** rather than through a binding generator.
///
/// The same file `bindgen!` reads at compile time on the host side, so the world this stamps into a
/// module and the world the host implements cannot be two vintages.
const WIT: &str = include_str!("../../../wit/gg-sandbox.wit");

/// The world a JVM arm's compiled program declares.
const WORLD: &str = "jvm-sandbox";

/// gg's WIT, parsed, and the id of [`WORLD`] within it — resolved once per process.
///
/// Parsing 1300 lines of IDL is a millisecond and it is the same answer every time, so a turn pays
/// for it once per process rather than once per program.
fn world() -> Result<&'static (wit_parser::Resolve, wit_parser::WorldId), String> {
    static WORLD_ID: std::sync::OnceLock<
        Result<(wit_parser::Resolve, wit_parser::WorldId), String>,
    > = std::sync::OnceLock::new();
    WORLD_ID
        .get_or_init(|| {
            let mut resolve = wit_parser::Resolve::default();
            let package = resolve
                .push_str("gg-sandbox.wit", WIT)
                .map_err(|error| format!("gg's own WIT does not parse: {error:#}"))?;
            let world = resolve
                .select_world(&[package], Some(WORLD))
                .map_err(|error| format!("gg's own WIT has no `{WORLD}` world: {error:#}"))?;
            Ok((resolve, world))
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// Encode the core module TeaVM wrote as the component gg's engine instantiates.
///
/// In process, from the bytes the compiler wrote, with no `wasm-tools` binary to install in a run
/// container — the same encode the Rust, C++ and Swift arms do, with one step those three do not
/// need. Their binding generators stamp the `component-type` custom section into the object file
/// they emit; **TeaVM stamps nothing**, because it has never heard of the component model. So gg
/// writes that section itself, out of its own WIT, and appends it to the module before encoding —
/// which is exactly what `wasm-tools component embed` does, done in process because gg cannot
/// shell out to a tool that is not in the image.
///
/// The measured shape of what comes out of TeaVM, and therefore what this has to describe: five
/// core imports (the four preview1 functions the adapter answers, and
/// `test-cabinet:gg/wire`'s `call`) and three core exports (`cabi_realloc`, `run` and `memory`),
/// with `bound-tools` beside `run`.
pub(crate) fn componentize(module: &[u8]) -> Result<Vec<u8>, String> {
    let (resolve, world) = world()?;
    let mut embedded = module.to_vec();
    wit_component::embed_component_metadata(
        &mut embedded,
        resolve,
        *world,
        wit_component::StringEncoding::UTF8,
    )
    .map_err(|error| {
        format!("gg could not stamp the `{WORLD}` world into the module: {error:#}")
    })?;
    wit_component::ComponentEncoder::default()
        .validate(true)
        .module(&embedded)
        .and_then(|encoder| encoder.adapter(ADAPTER_NAME, ADAPTER))
        .and_then(|mut encoder| encoder.encode())
        .map_err(|error| {
            format!(
                "TeaVM compiled the program and gg could not encode it as a component: {error:#}"
            )
        })
}
