//! **The C++ compile** — how a model's C++ becomes the wasm component that turn is evaluated by.
//!
//! # The strategy, in one sentence
//!
//! A C++ program is **compiled on the host, per turn, into a component of its own**: one `clang++`
//! from wasi-sdk over the model's reply, against a **precompiled** prelude and gg's prebuilt shell
//! and bindings, then an in-process [`wit_component`] encode with the pinned preview1 adapter — and
//! what crosses the membrane is not source at all but the artifact gg's engine instantiates.
//!
//! It is the third arm of that shape, after [Rust](super::super::rust) and [Swift](super::super::swift), and it
//! inherits the seam Rust grew and the preview1 adaptation Swift added:
//! [`PreparedProgram::component`] carries the bytes, `guest_component` answers `None`, and
//! `engine::program_component` is where the two shapes meet.
//!
//! # What a C++ program is, here: the file itself
//!
//! **A model's reply is compiled verbatim, as `main.cpp`.** No wrapper, no prologue, no `#include`
//! line gg wrote, and therefore **no line offset at all** — a diagnostic at line 7 is line 7 of what
//! the model wrote. gg's own surface is reached by the reply's own `#include <gg/files.hpp>`: the
//! header is on the compile's include path and its bodies are in the `sdk.o` every artifact links,
//! which is packaging, and nothing gg passes puts a name of that SDK in scope.
//!
//! Like [Swift](super::super::swift::compile)'s, that is forced rather than chosen, and C++ forces it
//! harder than any arm before it. A function-body wrapper — the shape [Rust](super::super::rust) uses —
//! would refuse **three** things a C++ author writes without thinking. A `template` may not be
//! declared at block scope at all, which is most of what generic C++ is. A `namespace` may not
//! either. And a `#include` is a *textual* directive: it would still expand, but it would expand
//! the whole of `<vector>` inside a function body, which is not a program. A translation unit is
//! the only C++ context that admits all of them.
//!
//! What that costs is the one thing this arm asks of a model that no other does: **the reply must
//! define `main`**. C++ has nowhere for a bare statement to live except a function body, so the
//! entry point is the model's own, and gg's shell calls it. A reply that defines none is refused by
//! name at prepare time — see [`source::defines_main`](super::source::defines_main) for why the
//! linker cannot be asked that question and gg has to.
//!
//! # The precompiled header, which is what makes this arm affordable
//!
//! Parsing the prelude (`packages/gg-sandbox-cpp/Sources/prelude.hpp`) — the 53 standard-library
//! headers a C++ author reaches for — costs the best part of a second of every compile. Measured on
//! this repository's dev container, aarch64, best of five, on two programs: a small one that logs a
//! line, and the ranges/format/map program this module's cost table also quotes.
//!
//! | | small | realistic |
//! | --- | --- | --- |
//! | `clang++` with no PCH, prelude included as text | 836 ms | 1581 ms |
//! | `clang++` with the PCH | **90 ms** | **952 ms** |
//!
//! **What the PCH does not carry is gg's own surface**, and that costs a measured 33 ms a turn on
//! both programs — the parse of `<gg.hpp>` the reply's own `#include` now asks for. It is the price
//! of the [invariant](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) that every SDK
//! name a program writes is reached through a line that program wrote, and it is 3% of a realistic
//! turn.
//!
//! So the PCH is built, and three properties of it decide where it lives.
//!
//! * It is **compiler-version-private and path-bearing**: only the clang that wrote one may read it,
//!   and it records the absolute path of every header it precompiled. A PCH built in this
//!   repository's checkout could not be read by the wasi-sdk in a run image, so putting 28 MB of one
//!   into the archive would be shipping something no other machine can use.
//! * It is a pure function of the prelude and the toolchain, which is exactly what a
//!   [shared toolchain directory](shared_toolchain_dir) is for.
//! * It is **built by the first compile**, not by [`warm`], because building it means running a
//!   compiler and a compiler is spawned through a [`PrepareContext`] — which a warm-up does not
//!   have. The first program of a process pays ~1.1 s more than the rest; every process after that
//!   on the same machine pays nothing, because the directory is already there.
//!
//! The key folds in the pinned release, a digest of the embedded guest archive (which carries the
//! prelude) **and a stamp of the compiler binary itself** — its size and its modification time.
//! That last part is not fussiness: a wasi-sdk reinstalled at the same version writes new files with
//! new timestamps, and clang refuses a PCH whose inputs have moved. Without the stamp in the key,
//! a reinstall would leave a stale PCH that every compile then failed to load, for as long as the
//! directory survived.
//!
//! # Exceptions work, and enabling them cost the workspace one build feature
//!
//! C++ *is* an exception language: `throw`, `try`/`catch`, `std::stoi`, `.at()` and `new` all use
//! them, and `-fno-exceptions` makes every one of those a compile error rather than a slower
//! program. An arm whose model cannot write `try` would be measuring gg's flag rather than the
//! language, so this arm does not take that road. What it costs is measured rather than assumed:
//!
//! * clang 22 defaults `-fwasm-exceptions` to the **legacy** encoding, and wasmtime 45 refuses it
//!   outright — *legacy_exceptions feature required for try instruction*. `-mllvm
//!   -wasm-use-legacy-eh=false` selects the standardised `try_table` form, which it accepts.
//! * Accepting it needs `Config::wasm_exceptions(true)`, which wasmtime gates behind its `gc` build
//!   feature, which in turn needs a collector — and the workspace's `wasmtime` dependency is shared
//!   with `foray-host` and `lattice-host`. The features are additive, so both now build against a
//!   wasmtime with GC support and the null collector. Neither *shares gg's engine* — each builds its
//!   own `Config` — so what changed for them is that `WasmFeatures::default()` gained `GC_TYPES`,
//!   and both pin it back explicitly rather than inheriting a wider validation surface from a
//!   feature this arm turned on. See `crate::sandbox::engine`.
//! * Every translation unit is compiled with the flags, and libc++'s **`eh`** build is what the link
//!   resolves against. `-lunwind` is named explicitly, because the driver does not add it and the
//!   failure without it is four undefined symbols out of `libc++abi`.
//!
//! # What a failure looks like, and the two flags that decide it
//!
//! Three bands, none of them what this arm would have had by default:
//!
//! | What happened | What a model reads | What makes it so |
//! | --- | --- | --- |
//! | An uncaught `throw` | a **recoverable, model-facing program error** carrying the exception's own class, demangled, and its `what()` — but **no location** | gg's [shell](../../../../../packages/gg-sandbox-cpp/Sources/shell.cpp) catches it. Without that it is a bare host-visible wasm exception: wasmtime reports `thrown Wasm exception` and nothing else, because an escaping exception under `-fwasm-exceptions` never reaches `std::terminate` |
//! | A libc++ **hardening** check — `v[10]`, `.front()` on an empty container, a bad range | a trap carrying libc++'s own sentence — `libc++ Hardening assertion __n < size() failed: vector[] index out of bounds` — **at the model's own line** | [`HARDENING_FLAG`], because wasi-sdk ships libc++ configured to `none`, plus [`DEBUG_INFO`] and the engine's symbolication, because the message is a synthetic inlined frame rather than anything printed |
//! | Integer division by zero, a null dereference, an out-of-bounds raw pointer, any other undefined behaviour | **a trap with no words at all**, located at the model's own line | [`DEBUG_INFO`], and nothing else can be done |
//!
//! A fourth band exists on every arm and matters on this one more than on any other: a program
//! `clang++` **rejected**, which is a [recoverable, model-facing compile error](classify) carrying
//! the compiler's own diagnostic at the model's own coordinates — [bounded](capped), because C++ is
//! the one registered language where one ordinary mistake fills a turn's context. A `std::optional`
//! handed to `std::format` is 18.6 KB of libc++ internals for one missing `.value()`.
//!
//! The last row is the comparability risk this arm carries and it cannot be engineered away: silent
//! undefined behaviour in C++ produces a failure that is, in the run record, hard to tell from a
//! model that reasoned badly. What the middle row is *for* is making that row as small as possible —
//! hardening moves the most common shape of it, an out-of-bounds container access, out of the third
//! band and into the second.
//!
//! # What it costs
//!
//! Measured in this repository's dev container, aarch64, 18 cores:
//!
//! | | small program | ranges/format/map program |
//! | --- | --- | --- |
//! | `clang++`, with the PCH warm | **~90 ms** | ~0.95 s |
//! | The [`wit_component`] encode | ~2 ms | ~7 ms |
//! | Artifact | ~830 KB | ~4.2 MB |
//! | wasmtime `Component::new`, at `OptLevel::None`, **per turn** | ~25 ms | ~220 ms |
//!
//! A code module in scope adds one `clang++ --precompile` of its own — **~73 ms** and a ~1.2 MB
//! module interface for a small module, paid per module per compile.
//!
//! `-O0` rather than `-Oz`, and it is a measurement rather than a preference: `-Oz` costs ~1.26 s of
//! compile against ~0.95 s and saves ~45 ms of `Component::new`, so it is ~270 ms a turn dearer
//! end to end. What it would buy is faster guest code, and the guest's budget is **30 seconds of
//! CPU** against programs that use milliseconds — so the trade is latency a model waits for against
//! headroom nothing uses.
//!
//! # A code module is a **named C++ module** the program imports
//!
//! A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is bound at
//! `lib::<key>`, and on a compiled arm that binding is a **link** — so the modules in scope are
//! inputs to the program's own compile. Each is written into the preparation's workspace as a module
//! interface unit [exporting `namespace lib::<key>`](super::source::namespaced), precompiled by
//! [`precompile_module`] into a `.pcm`, and named to the program's compile twice: as
//! `-fmodule-file=lib.<key>=…`, which says where the interface is, and as a link input, which is
//! where its bodies are.
//!
//! **This is what keeps gg's surface out of a program that binds a module.** A module reaches gg
//! through an `#include` in its own global module fragment, and a global module fragment's names are
//! attached to the global module rather than exported, so a program that imports the module reaches
//! `lib::<key>` and earns *use of undeclared identifier 'gg'* for anything of gg's it wrote no line
//! for. A header put in front of the model's file could not hold that line: `#include` is textual,
//! and a header carrying gg's surface declares it in whatever translation unit reads it.
//!
//! The `import lib.<key>;` lines themselves are in one generated [file](BINDER_FILE) named with
//! `-include`, which leaves the primary file's line numbering alone — a diagnostic at line 7 is line
//! 7 with three skills loaded. Each module is compiled on its own, so a module reaches gg and the
//! standard library and no other module.
//!
//! A module is also compiled **alone** when it is read — [`compile_module`], one `-fsyntax-only`
//! over the namespaced file as its own module interface unit — which is what buys its author a
//! diagnostic in their own coordinates rather than a program that stops compiling a turn later for
//! reasons in somebody else's file.
//!
//! # Isolation
//!
//! This arm satisfies the [contract](super::compile) the way the Rust and Swift arms do, with one
//! addition of its own.
//!
//! The embedded archive is unpacked into a [shared toolchain directory](shared_toolchain_dir),
//! content-keyed, placed by rename and sealed read-only; `clang++` only ever **reads** it. The PCH
//! lives in a second such directory and is **written once**, by whichever preparation gets there
//! first, into `place_tree`'s own staging directory under a process-unique name — so two
//! preparations racing to build it either both win or one discards its copy for an identical one,
//! and neither can see the other's half-written file.
//!
//! Everything a compile writes goes into that preparation's own workspace, most of it without this
//! arm having asked: clang's intermediates go to `TMPDIR` and its module cache under the directory
//! it derives from `HOME`, both of which
//! [`PrepareContext::compiler`](super::compile::PrepareContext::compiler) has already redirected
//! into the private tree.
//!
//! One argument points outside the tree and it is the escape hatch [`compile`](super::compile)
//! documents: `-ffile-prefix-map` rewrites this preparation's directory to a fixed name in
//! everything the compiler records, so a model reading a located trap is not shown a directory that
//! was deleted before the message reached it. It cannot change a verdict, and unlike the Swift arm's
//! it makes the artifact a **function of the program**: clang stamps no per-invocation nonce, so two
//! preparations of one C++ program produce byte-identical components.
//!
//! There is no compiler daemon and no pool. `clang++` is a one-shot process whose cost is the
//! compile.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::{
    CodeModule, CompilerCommand, CompilerReport, PrepareContext, PrepareError, PrepareFailure,
    PreparedModule, PreparedProgram, Workspace, place_tree, shared_toolchain_dir,
};

/// Everything a compile needs on disk that is not the model's own file: the generated WIT header,
/// gg's hand-written SDK as headers and as a prebuilt object, the prelude the program is compiled
/// against, gg's shell as source and as a prebuilt object, the compiled bindings object, and the
/// component-type object that names the world.
///
/// Embedded for the reason the guest components are: gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it. Built by
/// `packages/gg-sandbox-cpp/build.sh`.
const GUEST_TAR_GZ: &[u8] = include_bytes!(concat!(env!("GG_ARTIFACTS_CPP"), "/cpp.guest.tar.gz"));

/// The `wasi_snapshot_preview1` **reactor** adapter, which turns the preview1 core module wasi-sdk
/// emits into the preview 2 component gg's engine instantiates.
///
/// In memory rather than in the archive above, because this is the one input the *encoder* needs and
/// not the compiler: it never touches a filesystem.
///
/// It is this arm's own copy of a file the [Swift](super::super::swift) arm also carries, and the
/// duplication is deliberate rather than an oversight: each arm pins its adapter from its own
/// version file, and the point of a pin is that bumping one arm's toolchain cannot silently move
/// another arm's ABI.
const ADAPTER: &[u8] = include_bytes!(concat!(env!("GG_ARTIFACTS_CPP"), "/cpp.adapter.wasm"));

/// What the archive was built by, and what is in it.
const MANIFEST_JSON: &str = include_str!(concat!(env!("GG_ARTIFACTS_CPP"), "/cpp.toolchain.json"));

/// The environment variable an operator points at the wasi-sdk tree when it is not where gg looks.
pub(super) const WASI_SDK_HOME_ENV: &str = "TCAB_GG_WASI_SDK_HOME";

/// Where `containers/gg-toolchains` installs this arm's toolchain in a gg run image.
const IMAGE_HOME: &str = "/opt/gg/toolchains/wasi-sdk";

/// Where `scripts/ci/install-wasi-sdk.sh` installs it on a developer's or CI machine, relative to
/// `HOME`.
///
/// Looked at after the image path rather than instead of it, so a run container never depends on a
/// home directory and a developer never has to export anything.
const USER_HOME_SUFFIX: &str = ".local/share/tcab/gg-wasi-sdk";

/// How long one `clang++` may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// A compile here is ~90 ms warm and ~1 s for a template-heavy program; the worst honest case is a
/// program whose template instantiation is genuinely deep, which is seconds. Two minutes is
/// unmistakably a hang, and matches the Swift arm rather than the Rust arm's minute because the
/// **first** compile of a process additionally builds the precompiled header.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);

/// The file a model's reply is compiled as — **verbatim**.
pub(super) const PROGRAM_FILE: &str = "main.cpp";

/// What `clang++` is told to write, in this preparation's own output directory.
const ARTIFACT_FILE: &str = "program.wasm";

/// The file that names the code modules in a program's scope, one `import lib.<key>;` per module,
/// put in front of the model's file with `-include`.
///
/// It is the other half of the [module wrapper](super::source::namespaced) and carries nothing else:
/// a module name binds `lib::<key>` and reaches no other name at all, which is why a program with a
/// code module in scope still has to write its own line for anything of gg's.
const BINDER_FILE: &str = "bound_modules.hpp";

/// What one code module's precompiled interface is called, given its binding key.
fn interface_file(key: &str) -> String {
    format!("module_{key}.pcm")
}

/// Everything a `clang++` invocation on the turn path needs that is not the preparation's own: the
/// wasi-sdk tree, the unpacked guest and the precompiled prelude.
///
/// Bundled because all three compiles this arm runs — the module's own check, a bound module's
/// precompile and the program's build — open with the same six arguments, and a difference between
/// them would be a module accepted at its read and rejected at a program's compile.
struct Toolchain<'a> {
    /// The wasi-sdk tree the compiler comes out of.
    home: &'a Path,
    /// The unpacked guest: gg's headers, shell and prebuilt objects.
    guest: &'a Guest,
    /// The precompiled standard-library prelude.
    prelude: &'a Path,
}

impl Toolchain<'_> {
    /// Everything shared, resolved once: the toolchain's tree, the unpacked guest and the prelude.
    fn resolve(context: &PrepareContext) -> Result<(PathBuf, &'static Guest, PathBuf), String> {
        let home = wasi_sdk_home()?;
        let guest = guest()?;
        let prelude = precompiled_prelude(&home, guest, context)?;
        Ok((home, guest, prelude))
    }

    /// A `clang++` carrying the arguments every compile on this arm passes: the shared flags, the
    /// precompiled prelude, gg's include root and this preparation's own path rewrite.
    fn command<'a>(
        &self,
        workspace: &Workspace,
        context: &'a PrepareContext,
    ) -> Result<CompilerCommand<'a>, String> {
        let mut command = context
            .compiler(clang(self.home))
            .map_err(|error| format!("{}{error}", spawn_prefix(self.home)))?;
        command
            .args(shared_flags(self.home))
            .arg("-include-pch")
            .arg(self.prelude)
            // **Where gg's headers are**, which is the whole of what this argument does: it makes
            // `#include <gg/files.hpp>` resolve. It is packaging rather than injection — the names
            // in that header are declared by the line the model wrote and by nothing else — and it
            // is the C++ spelling of the classpath entry, the `--extern` and the linked archive
            // every other compiled arm passes.
            .arg("-I")
            .arg(self.guest.include())
            // Every path this preparation's own tree contributes to the artifact, rewritten to a
            // fixed one. A model that traps is shown the frame, and `/gg/work/main.cpp:7:13` is a
            // thing it can read, where `/tmp/gg-prepare/8421-3/work/main.cpp:7:13` names a
            // directory that was deleted before the message reached it.
            .arg(format!(
                "-ffile-prefix-map={}={PREPARATION_PREFIX}",
                workspace.root().display()
            ));
        Ok(command)
    }

    /// Run a prepared command, telling a compiler that could not start from one that ran.
    fn run(&self, mut command: CompilerCommand<'_>) -> Result<CompilerReport, String> {
        command
            .run(COMPILE_TIMEOUT)
            .map_err(|error| match error.starts_with("could not run") {
                true => format!("{}{error}", spawn_prefix(self.home)),
                false => error,
            })
    }
}

/// What a preparation's own tree is called in anything the compiler records — a diagnostic's path,
/// a line-table file entry, a located trap's frame.
const PREPARATION_PREFIX: &str = "/gg";

/// What the wasi-sdk tree is called in anything the compiler records — the file a libc++ hardening
/// failure names, above all.
const TOOLCHAIN_PREFIX: &str = "/wasi-sdk";

/// The precompiled prelude, inside its shared directory.
const PCH_FILE: &str = "prelude.pch";

/// **`-g1`, which is line tables and nothing else** — and it does two jobs rather than one.
///
/// The obvious job is locating a trap. Undefined behaviour says nothing anywhere, so a division by
/// zero, a null dereference or a stray pointer arrives as a bare trap, and the artifact's line table
/// plus [`wasm_backtrace_details`](crate::sandbox::engine) on the engine is the whole difference
/// between `/gg/work/main.cpp:11:22` and an address.
///
/// The job that is not obvious is carrying a **message**. A failed libc++ hardening check under this
/// arm's [mode](HARDENING_FLAG) is `__builtin_verbose_trap`, and clang does not *print* its argument
/// anywhere: it encodes it as the name of a synthetic inlined frame in the debug information. So the
/// sentence a model reads — `libc++ Hardening assertion __n < size() failed: vector[] index out of
/// bounds` — exists only because of this flag. It is the same mechanism the [Swift](super::super::swift)
/// arm's entire error surface rests on, reached here for a narrower class of failure.
///
/// `-g1` rather than `-g`, measured: full debug information costs ~800 ms more per compile, adds
/// ~0.6 MB to the artifact and takes `Component::new` from 220 ms to 350 ms, and what it adds
/// over line tables is variable and type description that nothing in gg reads — the verbose-trap
/// frames survive `-g1` intact. Line tables cost ~80 ms and ~110 KB.
const DEBUG_INFO: &str = "-g1";

/// The exception-handling flags, which are spelled once here and once in
/// `packages/gg-sandbox-cpp/build.sh` — the prebuilt objects and the per-turn compile must agree.
///
/// `-fwasm-exceptions` selects the wasm exception-handling proposal; `-wasm-use-legacy-eh=false`
/// selects the **standardised** encoding, because clang 22 still defaults to the legacy `try`
/// instruction and wasmtime 45 refuses that one while accepting `try_table`. Both were measured
/// against the runtime gg actually links, not read from a compatibility table.
const EXCEPTION_FLAGS: &[&str] = &["-fwasm-exceptions", "-mllvm", "-wasm-use-legacy-eh=false"];

/// **libc++'s bounds and precondition checks, turned on**, which is the largest thing standing
/// between this arm and silent undefined behaviour.
///
/// wasi-sdk ships libc++ configured with `_LIBCPP_HARDENING_MODE_DEFAULT` set to **none** — measured
/// in its own `__config_site`, not assumed from libc++'s upstream default — so out of the box
/// `values[9]` on a three-element vector reads whatever is there and carries on. gg turns it on for
/// every compile, and picks `extensive` over `fast` because the extra checks it adds are still O(1)
/// (a container's own preconditions, a valid range, a non-empty `front()`) against a guest budget of
/// 30 seconds of CPU that an honest program uses milliseconds of.
///
/// What a failed check does is libc++'s `hardening-dependent` semantic, which for this mode is
/// **`quick_enforce`**: `__builtin_verbose_trap`, whose message clang encodes as a synthetic
/// inlined frame in the debug information. That is exactly the mechanism the
/// [Swift](super::super::swift) arm's whole error surface rests on, reached here for a narrower
/// class of failure — so [`DEBUG_INFO`] is what turns `values[9]` from an anonymous trap into
/// `libc++ Hardening: assertion vector[] index out of bounds failed` at the model's own line.
const HARDENING_FLAG: &str = "-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE";

/// **Everything the precompiled prelude and the program that reads it must agree on**, in one place
/// because they must be one list.
///
/// clang refuses a PCH whose language options differ from the invocation reading it, and — worse,
/// because it is silent — a `-D` that differs is a macro the PCH was *parsed under* and the program
/// is not. That is not theoretical: this arm's hardening flag was added, the prelude was already
/// precompiled without it, and `values[9]` went on reading past the end of the vector while every
/// command line said it should not. So the list is written once, passed by both, and
/// [fingerprinted into the shared directory's key](self::build_prelude) — a flag change writes a new
/// key rather than reading a prelude parsed under the old one.
fn shared_flags(home: &Path) -> Vec<String> {
    let mut flags = vec![
        format!("--target={}", target()),
        format!("-std={}", language_standard()),
        // The toolchain's own tree, shortened. It is here rather than beside the per-preparation
        // rewrite below because it has to reach the PRELUDE: libc++ builds a hardening failure's
        // message out of `__FILE__`, and `__FILE__` is fixed when the header is parsed — which for
        // this arm is when the prelude is precompiled. Mapped there, a model reads
        // `/wasi-sdk/…/vector.h:412` rather than ninety characters of somebody's home directory, on
        // every frame of every backtrace. A rewrite of what the compiler RECORDS, which can change
        // no verdict.
        format!("-ffile-prefix-map={}={TOOLCHAIN_PREFIX}", home.display()),
    ];
    flags.extend(EXCEPTION_FLAGS.iter().map(|flag| (*flag).to_string()));
    flags.push(HARDENING_FLAG.to_string());
    // Measured, not assumed: `-Oz` is ~270 ms a turn dearer end to end than `-O0` once the engine's
    // own `Component::new` is counted, and what it buys is guest speed against a budget nothing
    // uses. clang additionally refuses a PCH built at another level outright — `OptimizationLevel
    // differs in precompiled file` — which is why it is in this list rather than beside the link
    // options.
    flags.push("-O0".to_string());
    flags.push(DEBUG_INFO.to_string());
    flags
}

/// What the embedded archive was built by, and what is in it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    /// The wasi-sdk release a program is compiled by.
    wasi_sdk: String,
    /// The clang release inside it, as the compiler reports itself. What a diagnostic's reader
    /// needs, and what the PCH's shared directory is keyed on.
    clang: String,
    /// The target triple a program is compiled to.
    target: String,
    /// The C++ standard a program is compiled as.
    std: String,
    /// The `wit-bindgen` release the C bindings in the archive were generated by.
    #[allow(dead_code)]
    wit_bindgen: String,
    /// The wasmtime release [`ADAPTER`] came from.
    #[allow(dead_code)]
    adapter: String,
    /// Every standard-library header the [prelude](self::GUEST_TAR_GZ) puts in front of a program,
    /// read out of the prelude that actually ships rather than restated — the same rule every other
    /// arm's library manifest follows.
    ///
    /// Read only by `prelude_headers`, which is a gate rather than a runtime need: nothing on the
    /// turn path asks what is in the prelude, because the precompiled header already answers it.
    #[cfg_attr(not(test), allow(dead_code))]
    headers: Vec<String>,
    /// Every file in the guest archive.
    files: Vec<GuestFile>,
}

/// One file in the embedded archive.
#[derive(Debug, Deserialize)]
struct GuestFile {
    /// Its name, which is also its name inside the unpacked tree.
    name: String,
    /// How big it is. Recorded so a truncated archive is visible in the manifest rather than only
    /// in a compile failure.
    #[allow(dead_code)]
    bytes: u64,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static Manifest {
    static MANIFEST: std::sync::OnceLock<Manifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the embedded C++ toolchain manifest is valid JSON of the expected shape")
    })
}

/// The clang release a program is compiled with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().clang
}

/// The wasi-sdk release the compiler is expected to come from.
pub(super) fn sdk_version() -> &'static str {
    &manifest().wasi_sdk
}

/// The target triple a program is compiled to.
pub(super) fn target() -> &'static str {
    &manifest().target
}

/// The C++ standard a program is compiled as.
pub(super) fn language_standard() -> &'static str {
    &manifest().std
}

/// Every file the embedded archive holds, in the order the manifest lists them.
pub(super) fn guest_files() -> impl Iterator<Item = &'static str> {
    manifest().files.iter().map(|file| file.name.as_str())
}

/// Every standard-library header a program of this language is compiled with already included.
///
/// `#[cfg(test)]` because it is a gate rather than a runtime need — the two readers of the list are
/// the [surface](super::surface) gate, which compiles a program using every group in it, and the
/// [compile](self::tests) one, which holds the manifest to the prelude that actually ships.
#[cfg(test)]
pub(super) fn prelude_headers() -> impl Iterator<Item = &'static str> {
    manifest().headers.iter().map(String::as_str)
}

/// Unpack the embedded archive now, so the first compile does not.
///
/// The whole of this language's warm-up that can be done without a compiler: 32 KB decompressed,
/// once per machine. The **precompiled header** is deliberately not built here — building one means
/// running `clang++`, and a compiler is spawned through a [`PrepareContext`] a warm-up does not
/// have. The result is dropped, because a failure here is the failure the first compile will make,
/// and there it is classified, counted and reported.
pub(super) fn warm() {
    let _ = guest();
}

// ---------------------------------------------------------------------------------------------
// The compile
// ---------------------------------------------------------------------------------------------

/// Compile a **program** — a model's reply — into the component that evaluates it.
///
/// [`source`](PreparedProgram::source) is empty for the same reason the Rust arm's is: there is
/// nothing left for a guest to evaluate, because the guest *is* what this returned.
pub(super) fn compile_program(
    source: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    Ok(PreparedProgram {
        source: String::new(),
        component: Some(compile(source, modules, context)?),
    })
}

/// Prepare a **code module** — the code half of a skill or a memory — by compiling it the way a
/// program will, and read the names its namespace offers.
///
/// What comes back is **source**, which is what a linked language's module has to be: it is an input
/// to the [program compile](compile_program) that binds it, not something a guest could load on its
/// own. It is the author's own bytes rather than the namespaced form, because the namespace is
/// written under the key the *program* knows and a module's own preparation is handed none.
///
/// The check is `-fsyntax-only` over the namespaced module **as its own module interface unit**,
/// which is the whole of what this step can decide and a fraction of what a full build costs: there
/// is nothing to instantiate templates for, nothing to optimise and no interface to write for a file
/// that is going to be compiled again as part of a program. A module needs no entry point to be
/// checked this way, which is why this arm's one refusal —
/// [a program with no `main`](self::NO_MAIN) — has no counterpart here.
///
/// Compiling it now is what buys the author a diagnostic **at the read**, in their own coordinates,
/// rather than a program that stops compiling a turn later for reasons in somebody else's file.
pub(super) fn compile_module(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let (home, guest, prelude) = Toolchain::resolve(context).map_err(PrepareFailure::Toolchain)?;
    let toolchain = Toolchain {
        home: &home,
        guest,
        prelude: &prelude,
    };
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let file = super::source::module_file(super::source::CHECK_KEY);
    workspace
        .write(
            &file,
            &super::source::namespaced(source, super::source::CHECK_KEY)?,
        )
        .map_err(PrepareFailure::Toolchain)?;

    let mut command = toolchain
        .command(workspace, context)
        .map_err(PrepareFailure::Toolchain)?;
    command.arg("-fsyntax-only").args(MODULE_INPUT).arg(&file);
    let report = toolchain.run(command).map_err(PrepareFailure::Toolchain)?;
    classify_module(&report, &file)?;

    Ok(PreparedModule {
        source: source.to_string(),
        exports: super::source::exports(source),
    })
}

/// What tells `clang++` the file that follows is a **module interface unit** rather than a header or
/// an ordinary translation unit, which is what decides whether its `export module` line is read at
/// all.
const MODULE_INPUT: [&str; 2] = ["-x", "c++-module"];

/// Compile one code module in a program's scope into its **precompiled module interface**, and hand
/// back where it was written.
///
/// This is the step that keeps gg's surface out of the program's translation unit. A module's own
/// `#include <gg.hpp>` is in its global module fragment, so the names it declares are attached to
/// the global module and are unreachable from whoever imports it: the program gets `lib::<key>` and
/// nothing else.
///
/// A diagnostic here is the author's, in the author's own coordinates, and reaches the model as a
/// compile failure the same way one in the model's own file does. It is rare rather than routine —
/// the module was already checked at its [read](compile_module) — and it is what happens when a
/// module and the toolchain it was read under have drifted apart.
fn precompile_module(
    module: &CodeModule,
    toolchain: &Toolchain<'_>,
    workspace: &Workspace,
    context: &PrepareContext,
) -> Result<PathBuf, PrepareFailure> {
    let file = super::source::module_file(&module.name);
    workspace
        .write(
            &file,
            &super::source::namespaced(&module.source, &module.name)?,
        )
        .map_err(PrepareFailure::Toolchain)?;
    let interface = workspace.output().join(interface_file(&module.name));

    let mut command = toolchain
        .command(workspace, context)
        .map_err(PrepareFailure::Toolchain)?;
    command
        .arg("--precompile")
        .args(MODULE_INPUT)
        .arg(&file)
        .arg("-o")
        .arg(&interface);
    let report = toolchain.run(command).map_err(PrepareFailure::Toolchain)?;
    classify_module(&report, &file)?;
    Ok(interface)
}

/// The refusal a reply with no entry point gets, at prepare time.
///
/// It names what to write rather than only what is missing, because the model has to produce a
/// whole program in one more turn — and it is the exact inverse of the [Rust](super::super::rust)
/// arm's one refusal, which is a program that *does* define `main`.
const NO_MAIN: &str = "this program defines no `main`, so there is nothing for the sandbox to run. \
                       A C++ program here is an ordinary translation unit: put your work in `int \
                       main() { … }` and write everything else — includes, namespaces, templates, \
                       classes — around it as you normally would.";

/// Compile one model program, and the code modules in its scope, into the component that evaluates
/// it — or say why it could not be.
fn compile(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<Vec<u8>, PrepareFailure> {
    if !super::source::defines_main(program) {
        return Err(PrepareFailure::Program(PrepareError::Unsupported(
            NO_MAIN.to_string(),
        )));
    }

    let (home, guest, prelude) = Toolchain::resolve(context).map_err(PrepareFailure::Toolchain)?;
    let toolchain = Toolchain {
        home: &home,
        guest,
        prelude: &prelude,
    };
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    // Verbatim. Nothing is prepended, appended or re-indented, which is what makes every line and
    // column below the model's own.
    workspace
        .write(PROGRAM_FILE, program)
        .map_err(PrepareFailure::Toolchain)?;

    // Each code module is compiled into a module interface of its own before the program is, and
    // the program is handed the interfaces rather than the sources. That is what puts gg's surface
    // out of the program's reach: a global module fragment's includes are attached to the global
    // module and reach nobody who imports it.
    let mut binder = String::new();
    let mut interfaces = Vec::with_capacity(modules.len());
    for module in modules {
        interfaces.push(precompile_module(module, &toolchain, workspace, context)?);
        binder.push_str(&super::source::module_import(&module.name));
    }
    workspace
        .write(BINDER_FILE, &binder)
        .map_err(PrepareFailure::Toolchain)?;

    let artifact = workspace.output().join(ARTIFACT_FILE);
    let report = invoke_clang(
        &artifact,
        modules,
        &interfaces,
        &toolchain,
        workspace,
        context,
    )
    .map_err(PrepareFailure::Toolchain)?;
    classify(&report, &authored_files(modules))?;

    let module = std::fs::read(&artifact).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "clang {} reported success and wrote no module to {}: {error}",
            compiler_version(),
            artifact.display(),
        ))
    })?;
    componentize(&module).map_err(PrepareFailure::Toolchain)
}

// ---------------------------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------------------------

/// Spawn `clang++` over the model's file, gg's prebuilt shell and bindings, and link the core
/// module.
///
/// One invocation does the whole job — parse, instantiate, generate and link — because the model's
/// file is the only translation unit that changes and everything else is already an object or a
/// precompiled module interface. The model's file is named **relatively** while everything else is
/// absolute: the command's working directory is this preparation's own, so a diagnostic in the
/// model's program reads `main.cpp:7` rather than a temporary path nobody should be shown, and a
/// diagnostic in one of gg's own inputs is unmistakable because it carries one.
fn invoke_clang(
    artifact: &Path,
    modules: &[CodeModule],
    interfaces: &[PathBuf],
    toolchain: &Toolchain<'_>,
    workspace: &Workspace,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let mut command = toolchain.command(workspace, context)?;
    command
        // What makes `--gc-sections` below able to drop anything at all: without these the linker's
        // unit is a whole object rather than a function.
        .arg("-ffunction-sections")
        .arg("-fdata-sections");
    // Where each code module's precompiled interface is, which is what makes the matching
    // `import lib.<key>;` resolve. Packaging, on the same terms `-I` above is: it says the module
    // exists and puts no name in scope.
    for (module, interface) in modules.iter().zip(interfaces) {
        command.arg(format!(
            "-fmodule-file={}={}",
            super::source::module_name(&module.name),
            interface.display()
        ));
    }
    if !modules.is_empty() {
        // The one file put in front of the model's own, holding one `import lib.<key>;` per module
        // in scope. `-include` leaves the primary file's line numbering alone, so a diagnostic at
        // line 7 is still line 7 with three skills loaded, and an import declaration binds the
        // module's namespace and nothing else — gg's surface included.
        command
            .arg("-include")
            .arg(workspace.work().join(BINDER_FILE));
    }
    command
        // A **reactor**, not a command: a component's exports are called after `_initialize`, and
        // the default execution model would insist on a `_start` this guest does not have — and
        // would run the model's program at instantiation rather than when `run` is called.
        .arg("-mexec-model=reactor")
        .arg("-Wl,--gc-sections")
        .arg("-o")
        .arg(artifact)
        .arg(PROGRAM_FILE);
    // Each module interface again, this time as an input: a `.pcm` is where the bodies of the
    // module's own declarations are, and the artifact needs them linked in.
    for interface in interfaces {
        command.arg(interface);
    }
    command
        .arg(toolchain.guest.file("shell.o"))
        // gg's own SDK, whose declarations the model's own `#include` put in front of the program
        // and whose bodies are here. One object rather than an archive, because `--gc-sections`
        // above works at function granularity: an artifact for a program that calls two of its
        // thirty-eight functions carries two of them.
        .arg(toolchain.guest.file("sdk.o"))
        .arg(toolchain.guest.file("sandbox.o"))
        .arg(toolchain.guest.file("sandbox_component_type.o"))
        // Named explicitly, because the driver does not add it and the failure without it is four
        // undefined symbols out of `libc++abi` — `_Unwind_RaiseException` and friends — on any
        // program at all rather than only on one that throws.
        .arg("-lunwind");
    toolchain.run(command)
}

/// The files a diagnostic may be located in that somebody a model can be told about **wrote**: the
/// model's own program, and the code modules in its scope, which a skill's author wrote.
///
/// Named rather than pattern-matched, because the direction the classification may be wrong in is
/// only one: a diagnostic located in gg's own prelude or shell reported to a model as "your program
/// did not compile" would send it rewriting a program that was never wrong.
fn authored_files(modules: &[CodeModule]) -> Vec<String> {
    let mut files = vec![PROGRAM_FILE.to_string()];
    files.extend(
        modules
            .iter()
            .map(|module| super::source::module_file(&module.name)),
    );
    files
}

/// The compiler binary inside a wasi-sdk tree. `clang++` rather than `clang`, because the name is
/// how the driver is told it is compiling C++ — the two are one binary and one symlink.
fn clang(home: &Path) -> PathBuf {
    home.join("bin/clang++")
}

/// What a failure to start the compiler is prefixed with, because it is the one failure here an
/// operator can actually fix: the toolchain is not where gg looked.
fn spawn_prefix(home: &Path) -> String {
    format!(
        "gg compiles every C++ program with the wasi-sdk in the gg run image and looked for it in \
         {} (set {WASI_SDK_HOME_ENV}, or run scripts/ci/install-wasi-sdk.sh): ",
        home.display()
    )
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/// Decide what a finished `clang++` means: nothing, a program the compiler rejected, or a compiler
/// that could not finish.
///
/// **One band for the model**, and that is a fact about the language rather than a shortcut. clang
/// has no parse-only phase a program passes before meaning is considered — an unclosed brace and a
/// failed overload resolution are both an `error:` from one invocation — so everything it rejects is
/// [`PrepareError::Compile`], exactly as everything `rustc` and `swiftc` reject is.
///
/// **What decides whose failure it is, is whether one of the files somebody authored is named
/// anywhere in the output** — the model's `main.cpp`, or one of the code modules in its scope, which
/// a skill's author wrote and a model is entitled to be told about. That rule is C++-shaped rather
/// than borrowed. A template error in this language is reported
/// *inside the library* — `format:1834: error: static assertion failed` — with a `note: in
/// instantiation of … requested here` at the model's own line. Reading only the `error:` line's path
/// would file the most ordinary C++ mistake there is under "gg's own toolchain broke", which is the
/// misattribution running the other way: a model told its program was fine when it was not, and a
/// turn spent by an operator instead. So the whole rendering is searched, notes included.
///
/// Two things are the model's without naming its file, and both are named explicitly:
///
/// * `wasm-ld: error: undefined symbol: …` — the model declared something and never defined it,
///   which is a real and common C++ mistake and one a model can fix. The linker reports no file.
/// * nothing else. A diagnostic located in gg's own inputs, a driver that could not find a tool, a
///   link that failed for any other reason and a compiler that said nothing at all are all a
///   [toolchain failure](PrepareFailure::Toolchain) — which is the safe direction, because a model
///   told to fix a program that was never wrong is the one misattribution this codebase spends the
///   most effort not making.
fn classify(report: &CompilerReport, authored: &[String]) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    let rendered = rendered(&report.stderr);
    if rendered.is_empty() {
        // A compiler that could not finish: it crashed, was killed by its timeout, or could not read
        // the precompiled header. It must never reach the model as "your program did not compile",
        // because nothing was ever decided about the program.
        return Err(PrepareFailure::Toolchain(format!(
            "clang {} {}{}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        )));
    }
    if authored
        .iter()
        .any(|file| rendered.contains(&format!("{file}:")))
        || rendered.contains(UNDEFINED_SYMBOL)
    {
        // The band is decided on the WHOLE rendering and only what the model reads is capped, so a
        // note naming the model's own file cannot be dropped and then looked for.
        return Err(PrepareFailure::Program(PrepareError::Compile(capped(
            &rendered, authored,
        ))));
    }
    Err(PrepareFailure::Toolchain(format!(
        "clang {} rejected gg's own guest rather than the model's program: {}",
        compiler_version(),
        report.stderr_tail(),
    )))
}

/// Decide what a finished `clang++ -fsyntax-only` over one **code module** means.
///
/// The same three answers [`classify`] gives and one narrower test of whose failure it is: a
/// module's own file is the only source in this translation unit, so a diagnostic located anywhere
/// else is located in gg's prelude and is gg's. There is no linker here and therefore no
/// [undefined symbol](self::UNDEFINED_SYMBOL) row — a module that declares something and never
/// defines it is a module the program linking it will report, which is the right place for it
/// because the program is where the call is.
fn classify_module(report: &CompilerReport, file: &str) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    let rendered = rendered(&report.stderr);
    if rendered.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "clang {} {}{}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        )));
    }
    if rendered.contains(&format!("{file}:")) {
        return Err(PrepareFailure::Program(PrepareError::Compile(capped(
            &rendered,
            &[file.to_string()],
        ))));
    }
    Err(PrepareFailure::Toolchain(format!(
        "clang {} rejected gg's own prelude rather than the module: {}",
        compiler_version(),
        report.stderr_tail(),
    )))
}

/// The linker's way of saying the model declared something it never defined.
const UNDEFINED_SYMBOL: &str = "undefined symbol:";

/// The compiler's own output, as the model is shown it.
///
/// Unaltered but for the **warnings**, which are dropped along with the notes attached to them,
/// because a model's program is not being reviewed and an unused variable that failed a turn would
/// be gg imposing a lint policy on an experiment about capability. A `note:` that follows an
/// `error:` is kept, and on this arm that is load-bearing rather than tidy: a template error's note
/// is the line the model actually wrote.
///
/// The driver's own summary — `clang++: error: linker command failed with exit code 1` — is dropped
/// too. It is about the process rather than about the program, and the real diagnostic is always the
/// line above it.
fn rendered(stderr: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    let mut in_warning = false;
    for line in stderr.lines() {
        if is_error(line) {
            in_warning = false;
        } else if line.contains(": warning: ") {
            in_warning = true;
        }
        if in_warning || line.starts_with("clang++: error: linker command failed") {
            continue;
        }
        kept.push(line);
    }
    kept.join("\n").trim().to_string()
}

/// How many `error:` diagnostics located in gg's or the library's own files a model is shown.
///
/// Four rather than [Kotlin's](super::super::kotlin) eight, because a C++ error is not one line: it drags
/// a source excerpt, a caret and an instantiation backtrace behind it. What a model can act on is
/// the first, and on this arm the first is almost always the only one — the eight errors a
/// `std::format` type mistake produces are one mistake, reported once per phase clang got to.
///
/// It is **not** a limit on errors located in the model's own program, which are all kept however
/// many there are. Those are short — a line, an excerpt and a caret — and clang has already bounded
/// them for us: its own `-ferror-limit` stops at twenty and says so.
const SHOWN_ERRORS: usize = 4;

/// How many `note:` diagnostics are kept under one error, **beyond** every note that names a file
/// somebody authored.
///
/// The exception is the whole design. On every other arm a `note:` is context; on this one it is
/// often *the* diagnostic, because a template error is reported inside the library and the model's
/// own line arrives as `note: in instantiation of … requested here`. So a note naming `main.cpp` or
/// a code module is never dropped however deep in the backtrace it sits, and the concept-failure
/// chain around it — `semiregular`, `copyable`, `move_constructible`, `constructible_from`, each
/// with an excerpt — is what this number is for.
const SHOWN_NOTES: usize = 3;

/// Whether a line **is** a diagnostic that failed the compile.
///
/// Two spellings, and the second is not a nicety: `'boost/asio.hpp' file not found` and
/// `too many errors emitted, stopping now` are both `fatal error:` rather than `error:`, and the
/// first of those is the most ordinary refusal this arm hands a model.
fn is_error(line: &str) -> bool {
    line.contains(": error: ") || line.contains(": fatal error: ")
}

/// Whether a line is a diagnostic that **explains** one.
fn is_note(line: &str) -> bool {
    line.contains(": note: ")
}

/// Whether a line is clang's count of what it just reported, rather than part of any one
/// diagnostic — `8 errors generated.`
///
/// Recognised by name because it is the one line that trails the last diagnostic without belonging
/// to it, and it is worth keeping: it is the honest total, and it is what makes a "… and N more"
/// line something a reader can check rather than gg's word for it.
fn is_summary(line: &str) -> bool {
    line.ends_with("errors generated.") || line.ends_with("error generated.")
}

/// **The compiler's output, bounded**, which on this arm is a measurement rather than tidiness.
///
/// A model reads a diagnostic out of its own context window, and C++ is the one registered language
/// where a single ordinary mistake can fill it. Measured against this arm's own flags:
/// `std::format("exit {}", v)` where `v` is a `std::optional<int>` — one missing `.value()` — is
/// **18 KB across 8 errors and 34 notes**, nearly all of it libc++'s `__disabled_formatter`,
/// `__compile_time_handle` and the `semiregular`/`copyable`/`move_constructible` chain, with the
/// model's own line buried in the middle as a `note:`. Roughly five thousand tokens of one turn
/// spent on a fault a sentence describes. `rustc` has no template instantiation to unwind and
/// [Kotlin's arm](super::super::kotlin) already caps for its own reason; this arm needs one more than
/// either.
///
/// So the first [few](SHOWN_ERRORS) errors are kept whole, each with the notes that matter, and
/// what was dropped is **counted rather than hidden** — a model that needs the rest knows there is
/// a rest. Three properties this is careful about:
///
/// * a diagnostic naming a file somebody **authored** is never dropped, at any depth, whether it is
///   an error or a note — on this arm that note is where the model's own line is;
/// * the [band](classify) is decided on the *whole* rendering before this runs, so capping can
///   never turn a model's compile error into a toolchain failure;
/// * clang's own trailing summary (`8 errors generated.`) is kept, because it is the honest total
///   and it is what makes the count above verifiable.
fn capped(rendered: &str, authored: &[String]) -> String {
    let (diagnostics, tail) = diagnostics(rendered, authored);
    let mut kept: Vec<String> = Vec::new();
    let mut shown_errors = 0usize;
    let mut dropped_errors = 0usize;
    let mut showing = false;
    let mut notes_in_group = 0usize;
    let mut dropped_notes = 0usize;

    // Flush the "… and N more notes." line that belongs to the group being left.
    fn close(kept: &mut Vec<String>, dropped: &mut usize) {
        if *dropped > 0 {
            kept.push(format!("… and {dropped} more notes under that error."));
            *dropped = 0;
        }
    }

    if !diagnostics.iter().any(|diagnostic| diagnostic.error) {
        // Nothing here groups, so there is nothing to bound and dropping any of it would be
        // dropping the whole diagnostic.
        return rendered.to_string();
    }
    for diagnostic in &diagnostics {
        if diagnostic.error {
            close(&mut kept, &mut dropped_notes);
            notes_in_group = 0;
            shown_errors += 1;
            showing = shown_errors <= SHOWN_ERRORS || diagnostic.authored;
            match showing {
                true => kept.push(diagnostic.text()),
                false => dropped_errors += 1,
            }
            continue;
        }
        if !showing {
            continue;
        }
        if diagnostic.authored || notes_in_group < SHOWN_NOTES {
            notes_in_group += 1;
            kept.push(diagnostic.text());
        } else {
            dropped_notes += 1;
        }
    }
    close(&mut kept, &mut dropped_notes);
    if dropped_errors > 0 {
        kept.push(format!("… and {dropped_errors} more errors like these."));
    }
    kept.extend(tail.into_iter().map(str::to_string));
    kept.join("\n").trim().to_string()
}

/// One diagnostic clang printed, with the source excerpt and caret it printed under it.
struct Diagnostic<'a> {
    /// Whether it is an `error:`, which opens a group, rather than a `note:` explaining one.
    error: bool,
    /// Whether it names a file somebody a model can be told about wrote — the model's own program,
    /// or a code module in its scope.
    authored: bool,
    /// Its own lines, in the order clang wrote them, including anything printed in front of it.
    lines: Vec<&'a str>,
}

impl Diagnostic<'_> {
    /// This diagnostic as the model reads it.
    fn text(&self) -> String {
        self.lines.join("\n")
    }
}

/// Cut a rendering into diagnostics, and return whatever trailed the last of them.
///
/// Everything that is not itself an `error:` or a `note:` line belongs to the diagnostic it is
/// printed **around**: a source excerpt and its caret follow one, and `In file included from …`
/// precedes one. So unattributed lines are held and attached to whichever diagnostic comes next,
/// and what is left over at the end — clang's `8 errors generated.` — is the tail.
fn diagnostics<'a>(rendered: &'a str, authored: &[String]) -> (Vec<Diagnostic<'a>>, Vec<&'a str>) {
    let mut cut: Vec<Diagnostic<'a>> = Vec::new();
    let mut pending: Vec<&'a str> = Vec::new();
    for line in rendered.lines() {
        if is_summary(line) {
            pending.push(line);
            continue;
        }
        let error = is_error(line);
        if error || is_note(line) {
            // Read off the diagnostic's OWN line and not its preamble, which is the difference
            // between a rule and a rule that matches everything: `In file included from main.cpp:1:`
            // sits in front of every diagnostic in every header a program included, and counting it
            // would make the whole of libc++ the model's own file.
            let located = authored
                .iter()
                .any(|file| line.contains(&format!("{file}:")));
            let mut lines = std::mem::take(&mut pending);
            lines.push(line);
            cut.push(Diagnostic {
                error,
                authored: located,
                lines,
            });
            continue;
        }
        match cut.last_mut() {
            // A line under a diagnostic, until something says it is in front of the next one.
            Some(last) if pending.is_empty() && !line.starts_with("In file included from") => {
                last.lines.push(line);
            }
            _ => pending.push(line),
        }
    }
    (cut, pending)
}

// ---------------------------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------------------------

/// Encode the core module `clang++` linked as the component gg's engine instantiates.
///
/// In process, from the bytes the compiler wrote, with no `wasm-tools` binary to install in a run
/// container — the same encode the [Rust](super::super::rust) arm does, with the adaptation
/// [Swift](super::super::swift) added. This arm targets `wasm32-wasip1`, so the module it produces imports
/// the preview1 snapshot; [`ADAPTER`] is what implements those imports in terms of the preview 2
/// interfaces gg's linker provides.
fn componentize(module: &[u8]) -> Result<Vec<u8>, String> {
    wit_component::ComponentEncoder::default()
        .validate(true)
        .module(module)
        .and_then(|encoder| encoder.adapter(ADAPTER_NAME, ADAPTER))
        .and_then(|mut encoder| encoder.encode())
        .map_err(|error| {
            format!(
                "clang {} compiled the program and gg could not encode it as a component: \
                 {error:#}",
                compiler_version()
            )
        })
}

/// The import namespace the adapter satisfies, which is the preview1 snapshot's own module name.
const ADAPTER_NAME: &str = "wasi_snapshot_preview1";

// ---------------------------------------------------------------------------------------------
// The toolchain, the embedded guest and the precompiled prelude
// ---------------------------------------------------------------------------------------------

/// Where this arm's toolchain tree is: what an operator said, then what a gg run image guarantees,
/// then where `scripts/ci/install-wasi-sdk.sh` puts it.
///
/// Kept in step with `gg_wasi_sdk_home` in `packages/gg-sandbox-cpp/cpp-version.sh`, which is what
/// the installer and the image build resolve.
pub(super) fn wasi_sdk_home() -> Result<PathBuf, String> {
    if let Ok(configured) = std::env::var(WASI_SDK_HOME_ENV)
        && !configured.is_empty()
    {
        return Ok(PathBuf::from(configured));
    }
    let image = PathBuf::from(IMAGE_HOME);
    if clang(&image).is_file() {
        return Ok(image);
    }
    let Some(user) = std::env::var_os("HOME") else {
        return Ok(image);
    };
    Ok(PathBuf::from(user).join(USER_HOME_SUFFIX))
}

/// Where the embedded archive is unpacked, for this process.
pub(super) struct Guest {
    /// The directory holding every file the archive carried.
    tree: PathBuf,
}

impl Guest {
    /// One of the archive's files, by the name the manifest gives it.
    pub(super) fn file(&self, name: &str) -> PathBuf {
        self.tree.join(name)
    }

    /// **The model-facing include root** — the one directory `clang++ -I` is given on the turn
    /// path, so that `#include <gg/files.hpp>` and `#include <gg.hpp>` resolve and nothing else
    /// gg carries does.
    ///
    /// `build.sh` fills it with the umbrella header, the thirteen module headers a catalogue entry
    /// states as its own import line, and the one header the umbrella includes by name. The
    /// generated `sandbox.h` and the SDK's `wire.hpp` are in the tree beside it and off this path
    /// deliberately: they are the C the SDK is written against, no model-facing header includes
    /// either, and an include root is a claim about what a program may write.
    pub(super) fn include(&self) -> PathBuf {
        self.tree.join("include")
    }
}

/// The unpacked guest, materialised once per process.
pub(super) fn guest() -> Result<&'static Guest, String> {
    static GUEST: std::sync::OnceLock<Result<Guest, String>> = std::sync::OnceLock::new();
    GUEST
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Unpack the embedded archive into a [shared toolchain directory](shared_toolchain_dir).
///
/// The seam's one sanctioned share, taken under the seam's discipline: the key folds in the pinned
/// compiler **and** a digest of the archive itself, so a gg carrying different bindings at the same
/// wasi-sdk version reads a different directory rather than another build's files; the write goes
/// through [`place_tree`], which fills a staging directory, seals it read-only and renames it in.
///
/// Sharing it needs no further argument than that, because `clang++` only ever **reads** it: the
/// header and the prelude are found by `-I`, the three objects are link inputs, and every artifact
/// goes to this preparation's own output directory.
fn materialise() -> Result<Guest, String> {
    let root = shared_toolchain_dir(&format!(
        "cpp-{}-{:016x}",
        sdk_version(),
        fingerprint(GUEST_TAR_GZ)
    ))?;
    let tree = root.join("guest");
    place_tree(&tree, unpack)?;
    Ok(Guest { tree })
}

/// Decompress and extract the embedded archive into `into`.
fn unpack(into: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(GUEST_TAR_GZ));
    // The archive is gg's own build artifact rather than anything a run produced, but the extraction
    // is still confined to `into`: an archive is a file format, and a file format is the wrong place
    // to be trusting.
    archive
        .unpack(into)
        .map_err(|error| format!("could not unpack the embedded C++ guest: {error}"))?;
    for name in guest_files() {
        let path = into.join(name);
        if !path.is_file() {
            return Err(format!(
                "the embedded C++ guest is missing {name}, which its manifest declares"
            ));
        }
    }
    Ok(())
}

/// A digest of an embedded archive, so the [shared directory](shared_toolchain_dir) a process reads
/// is keyed on the bytes it would have written.
fn fingerprint(archive: &[u8]) -> u64 {
    let mut hasher = std::hash::DefaultHasher::new();
    archive.hash(&mut hasher);
    hasher.finish()
}

/// **The precompiled prelude**, built once per machine and read by every compile after it.
///
/// See this module's own documentation for what it saves and why it cannot be shipped. The
/// mechanics are the seam's: a [shared directory](shared_toolchain_dir) keyed on everything that
/// could change the bytes, filled through [`place_tree`] — which stages under a process-unique
/// name, seals the result read-only and renames it in — so two preparations racing to build it
/// either both win or one discards an identical copy, and neither can read the other's half-written
/// file.
///
/// The key folds in three things and the third is the one worth naming. The pinned wasi-sdk release
/// and a digest of the embedded archive are the ordinary content-keying every shared directory
/// here does. **A stamp of the compiler binary** is not: a PCH may only be read by the clang that
/// wrote it *and* records the absolute path and identity of every header it precompiled, so a
/// wasi-sdk reinstalled at the same version — new files, new timestamps — invalidates one without
/// changing any version anybody wrote down. Without the stamp, that would leave a stale PCH in a
/// directory whose name still looked right, and every compile on the machine would then fail to
/// load it.
///
/// Cached per process once it has **succeeded**, so only the first program of a process pays even
/// the `place_tree` existence check — and, deliberately, not cached when it has failed. That is the
/// one place this differs from [`guest`], and the difference is what the two do: unpacking bytes gg
/// carries fails for reasons that will not have changed by the next turn, and *running a compiler*
/// fails for reasons that may have — a full disk, a process the machine killed. A run whose first
/// turn hit one of those would otherwise be a run where every later turn failed with a message
/// about the first.
///
/// **The process cache is keyed on `home`**, which is the same thing the directory it caches is
/// keyed on. Anything less would undo the care taken over the key below: the compiler stamp is in
/// there precisely so a reinstalled wasi-sdk cannot leave a stale PCH behind, and a cache in front
/// of it that answered the same path for every toolchain would hand the second `home` of a process
/// a PCH built for the first. In production the variable is fixed for a run's lifetime and the
/// failure direction is safe — clang refuses a foreign PCH, which is a
/// [toolchain failure](PrepareFailure::Toolchain) rather than anything blamed on a model — so this
/// is an invariant made *checked* rather than a bug fixed.
///
/// The lock is not held across the build, so two preparations that arrive together both build:
/// `place_tree` is what makes that safe, exactly as it is when two processes race.
pub(super) fn precompiled_prelude(
    home: &Path,
    guest: &Guest,
    context: &PrepareContext,
) -> Result<PathBuf, String> {
    static PRELUDE: std::sync::Mutex<Option<(PathBuf, PathBuf)>> = std::sync::Mutex::new(None);
    let cached = |built: &Option<(PathBuf, PathBuf)>| match built {
        Some((keyed, path)) if keyed == home => Some(path.clone()),
        _ => None,
    };
    if let Some(built) = cached(
        &PRELUDE
            .lock()
            .expect("the C++ prelude cache is not poisoned"),
    ) {
        return Ok(built);
    }
    let built = build_prelude(home, guest, context)?;
    *PRELUDE
        .lock()
        .expect("the C++ prelude cache is not poisoned") =
        Some((home.to_path_buf(), built.clone()));
    Ok(built)
}

/// Build [`precompiled_prelude`]'s directory, once.
fn build_prelude(home: &Path, guest: &Guest, context: &PrepareContext) -> Result<PathBuf, String> {
    let flags = shared_flags(home);
    let root = shared_toolchain_dir(&format!(
        "cpp-pch-{}-{:016x}-{:016x}-{}",
        sdk_version(),
        fingerprint(GUEST_TAR_GZ),
        fingerprint(flags.join(" ").as_bytes()),
        compiler_stamp(home),
    ))?;
    let tree = root.join("pch");
    place_tree(&tree, |into| {
        let report = context
            .compiler(clang(home))
            .map_err(|error| format!("{}{error}", spawn_prefix(home)))?
            .args(&flags)
            // No `-I`: the prelude is the standard library and nothing else, so there is no header
            // of gg's own for it to find.
            .arg("-x")
            .arg("c++-header")
            .arg("-o")
            .arg(into.join(PCH_FILE))
            .arg(guest.file("prelude.hpp"))
            .run(COMPILE_TIMEOUT)
            .map_err(|error| match error.starts_with("could not run") {
                true => format!("{}{error}", spawn_prefix(home)),
                false => error,
            })?;
        match report.ok {
            true => Ok(()),
            false => Err(format!(
                "clang {} could not precompile gg's own C++ prelude, which is gg's arrangement \
                 failing rather than any program's: {}{}",
                compiler_version(),
                report.status,
                report.stderr_tail(),
            )),
        }
    })?;
    Ok(tree.join(PCH_FILE))
}

/// A stamp of the compiler binary — its size and its modification time — for the
/// [prelude](precompiled_prelude)'s key.
///
/// Deliberately not a digest of a 63 MB shared object, which would be read on every process start
/// to answer a question a `stat` answers. A reinstall changes both fields; a bit-for-bit identical
/// reinstall that somehow preserved both would produce a PCH the existing one is identical to.
///
/// A compiler that cannot be `stat`ed yields a stamp of `absent`, which keys a directory the build
/// below will then fail to fill — with the message that names where gg looked, which is the failure
/// an operator can act on.
fn compiler_stamp(home: &Path) -> String {
    let Ok(metadata) = std::fs::metadata(clang(home)) else {
        return "absent".to_string();
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_secs());
    format!("{:x}-{:x}", metadata.len(), modified)
}

#[cfg(test)]
#[path = "cpp.compile.test.rs"]
mod tests;
