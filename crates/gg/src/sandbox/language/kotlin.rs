//! **Kotlin** — the arm whose program is an ordinary Kotlin file with its own `fun main()`,
//! compiled by a warm JVM to bytecode and then to a WebAssembly component of its own before the turn
//! ever runs it.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`] — the host-side build, what it costs, what it shares, and the four ways it can end;
//! * [`source`] — what gg does to a model's Kotlin before the compiler sees it (**nothing**), the one
//!   convention that costs, and the code-module wrapper that is all that is left of a wrapper here;
//! * `packages/gg-sandbox-kotlin/src/` — the SDK, and every word of prose a model reads about it;
//! * the **signature catalogue** — reflected out of that SDK's own KDoc by the compiler's own front
//!   end, and generated into this build's `OUT_DIR` rather than committed anywhere (see
//!   `crates/gg/build.rs`);
//! * `kotlin.sdk.jar` — that SDK compiled, which is what a classpath entry is, cut into this
//!   build's artifacts by `crates/gg-sandbox-artifacts/kotlin` rather than committed anywhere;
//! * `checkers/kotlin.compiler.java` — this arm's half of gg's compiler driver;
//! * `checkers/kotlin.toolchain.json` — the Kotlin release this arm is pinned to.
//!
//! # What it rides, and what is its own
//!
//! It rides [the JVM road](super::jvm) it shares with [Java](super::java): the same JDK, the same
//! TeaVM jars, the same three mandatory TeaVM settings, the same canonical ABI and wire encoding
//! (`packages/gg-sandbox-jvm`), the same generated entry class, and the same component encode. That
//! is the whole reason this arm is cheap: everything from **bytecode onwards** already existed.
//!
//! What is its own is everything in front of the bytecode:
//!
//! | | |
//! | --- | --- |
//! | The compiler | `K2JVMCompiler`, embedded in the daemon rather than spawned, because it is ~1.7–9 s cold and 0.14–0.4 s warm and `kotlinc` has no daemon to ask |
//! | What a diagnostic in a *library* file means | the model's problem, not gg's, which is the opposite of the Java arm's answer and follows from Kotlin reaching the classlib through a standard library of its own |
//! | What a program may reach | the Kotlin standard library, by construction: the driver runs with a 60 MB compiler on its classpath and a program is compiled against one jar of it |
//!
//! # Why this arm has no guest component
//!
//! Because there is nothing for one to hold, which is [Java's](super::java) answer and for the same
//! reason: TeaVM does not produce a Kotlin interpreter that later runs a program, it produces **the
//! program**, carrying only the classlib and standard-library methods that program's own call graph
//! reached. There is no stable "Kotlin runtime" two programs could share.
//!
//! So this is a **compiled** arm on the seam's own terms: [`guest_component`](Kotlin::guest_component)
//! answers `None`, the compiled bytes ride on the prepared program, and the engine instantiates a
//! fresh component every turn.
//!
//! # What a Kotlin program is, here
//!
//! **A whole Kotlin file**: the `import` lines the model wrote and a `fun main()` it declared. gg
//! writes no prologue, no epilogue, no entry point and no import into that file, so the compiler
//! reads the bytes the model sent and every diagnostic and every stack frame is already in the
//! model's own coordinates. [`source`] carries the one convention that costs — the `main` with no
//! parameters — and what enforces it, which is javac's own diagnostic about gg's own entry class.
//!
//! **The script is retired.** A program used to be a Kotlin `.kts`, because the shape it was compared
//! against wrapped a reply in the body of a function gg declared and Kotlin refuses `object`,
//! `interface`, `enum class`, `typealias` and `private fun` as *local* declarations. Under whole
//! programs there is no wrapper and therefore no local position: all five are ordinary top-level
//! declarations, and the scripting plugin, its four unversioned jars and the `kotlin-home` they were
//! loaded through are gone with the problem they solved.
//!
//! # What a program may reach, and how
//!
//! Its SDK reaches a program the way Kotlin reaches any library: a jar on the classpath, which is
//! packaging, plus a line **the program writes** — either a name written in full
//! (`gg.files.readFile(…)`) or the `import gg.files.*` every module's catalogue entry states. A
//! program that writes neither resolves nothing of gg's.
//!
//! And its **SDK is top-level functions rather than objects**, which is what this language spells a
//! free function as. The Kotlin half of `gg.internal` is `internal` — module visibility, and a
//! program is its own module — and the crossing under it is the Java `gg.internal` package both JVM
//! arms compile, whose classes are public because Java has no module visibility to give them. What
//! keeps that package out of a program's way is the same thing that keeps it out of every other
//! arm's: nothing describes it. See [`Abi`'s class
//! note](https://docs.testcabinet.ai/gg/languages/java/).

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, WORKSPACE_TREE_VIEW, spell,
};
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{
    DOCS_SEARCH, FILES_TREE, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE, VIEWS_OPEN_TEXT,
};

#[path = "kotlin.compile.rs"]
pub(super) mod compile;

#[path = "kotlin.source.rs"]
pub(super) mod source;

/// This arm's catalogue, reflected out of the SDK's own KDoc by
/// `packages/gg-sandbox-kotlin/signatures.sh` — the compiler's own front end reading the same
/// `KtFile` the compiler compiles.
///
/// It is not committed. `crates/gg/build.rs` runs that reflection as a step of building this
/// crate and this line embeds what it wrote into the build's own `OUT_DIR`, so what a model is
/// told about this arm is reflected out of the SDK sources in this checkout, on the build that
/// compiles the module telling it.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/kotlin.signatures.json"
));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static KOTLIN: Kotlin = Kotlin;

/// Kotlin: compiled to bytecode by the Kotlin compiler and then to a WebAssembly component by
/// TeaVM's `WEBASSEMBLY_WASI` backend, inside a warm JVM, and run as a component of its own.
pub(super) struct Kotlin;

impl ProgramLanguage for Kotlin {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::Kotlin
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::Kotlin.display_name()
    }

    /// `lib.<key>.<name>` — the fully-qualified name, which is one of the two ways a Kotlin program
    /// reaches anything and is the way it reaches [gg's own SDK](Self::lib_import) without an
    /// import.
    ///
    /// The key is a **package** gg compiles the module's own file into; see
    /// [`module_package`](source::module_package) for why a package is what Kotlin has instead of a
    /// generated accessor.
    fn lib_access(&self, key: &str) -> String {
        format!("{}.<name>", source::module_package(key))
    }

    /// `import lib.csvTools.*` — the line a program writes to reach a loaded module, which is the
    /// line it writes to reach [gg's own SDK](https://docs.testcabinet.ai/gg/languages/kotlin/).
    ///
    /// A module is compiled on its own into [`lib.<key>`](source::module_package), and the directory
    /// of classes that produced goes on the program's classpath the way this arm's SDK jar does. A
    /// classpath entry declares no name, so what a program has after it is what Kotlin gives it: the
    /// [fully-qualified call](Self::lib_access), or this import and the simple name. The star is the
    /// spelling every SDK module's own catalogue entry states — `import gg.files.*` — because what a
    /// package of top-level functions offers is names rather than a type.
    fn lib_import(&self, key: &str) -> Option<String> {
        Some(format!("import {}.*", source::module_package(key)))
    }

    /// The Kotlin compile, the TeaVM translation and the component encode, in this preparation's own
    /// workspace and in a JVM lent to it alone — see [`compile`] for what it costs, what it shares,
    /// and how it tells a program a compiler refused from a compiler that could not run.
    ///
    /// The modules are compiled **before** it, each on its own, and what reaches this compile is the
    /// classpath entry each of those produced.
    fn prepare_program(
        &self,
        source: &str,
        modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        compile::compile_program(source, modules, context)
    }

    /// `kotlinc`, which is what a Kotlin programmer calls the compiler — even though gg drives it
    /// [embedded rather than as that binary](compile), because `kotlinc` is a shell script around a
    /// JVM and this arm needs the JVM warm.
    ///
    /// Not TeaVM, on the same grounds [Java's arm](super::java) does not name it: it translates what
    /// the Kotlin compiler accepted and judges nothing about the program except that its classlib
    /// carries what the program reached. Naming a checker is also what has this arm's compile
    /// [recorded](crate::sandbox::SandboxOutcome::compile) on every turn, the failing path included.
    fn checker(&self) -> Option<&'static str> {
        Some("kotlinc")
    }

    /// [What `kotlinc` says a program could not import](compile::unresolved_imports), read out of the
    /// `unresolved reference` wording this arm's own diagnostics carry.
    fn unresolved_imports(&self, diagnostic: &str) -> Vec<String> {
        compile::unresolved_imports(diagnostic)
    }

    /// Start one JVM and place the compiler driver and the SDK jar now, so the first code turn pays
    /// for neither.
    ///
    /// This arm needs it as much as [Java's](super::java) does and for a sharper reason: the first
    /// build in a JVM costs 1.7–9 s against 0.14–0.4 s after it, because the Kotlin compiler's own
    /// class loading is what is being paid for. A run whose first program paid that would report a
    /// compile time an order of magnitude above every one after it. Idempotent and best effort — a
    /// failure here is the failure the first compile makes, and there it is classified, counted and
    /// reported as a [toolchain failure](PrepareFailure::Toolchain).
    fn warm_prepare(&self) {
        compile::warm();
    }

    /// The Kotlin compiler alone, pointed at the author's own file in a package of gg's naming —
    /// and the names the resulting namespace offers.
    ///
    /// What comes back is the author's own source rather than an artifact, because the key the
    /// module will be bound at does not exist yet and the key is the package it is compiled into.
    /// Running the compiler here anyway is what buys the author a located diagnostic at the read
    /// rather than one taking somebody else's turn for as long as the module stays loaded.
    ///
    /// The names are read from the author's own source by [`source`]'s export scan rather than out
    /// of a compiled artifact, because they are what the skill's author is *told* the namespace
    /// holds; the arm's own tests assert that the scan and the compiler agree on the answer, which
    /// is what keeps one reading from being a second chance to differ.
    fn prepare_module(
        &self,
        key: &str,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        compile::compile_module(key, source, context)
    }

    /// `.kt`, and nothing else.
    ///
    /// One extension, like [Java](super::java)'s and [Ruby](super::ruby)'s: nothing else in the
    /// registry can compile a Kotlin module. `.kts` is deliberately **not** a second spelling — a
    /// script's declarations are members of an instance that would have to be constructed first,
    /// where what `lib.<key>` binds is a namespace of functions, and nothing on this arm compiles a
    /// script any more at all.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["kt"]
    }

    /// [camelCase](self::binding_name) — Kotlin's own convention for a name a program writes, and
    /// this SDK's for everything else.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }
    /// **No.** TeaVM's DWARF is misattributed, and gg must not report it as this program's location.
    ///
    /// Measured on the wasm route, on the artifact this arm's own driver writes: a program whose
    /// frames really are `Program.java:16`, `:14` and `:9` symbolicates as `gg/internal/Abi.java:87`,
    /// `:83` and `:82` — gg's own SDK internals, named as the site of the model's bug. The *function*
    /// names in the same backtrace are right, and they are kept; the file and line are what go. A
    /// failure's real location on this arm arrives on the guest's own standard error, in the model's
    /// own coordinates, which is where the failure rule says to read it.
    fn wasm_frames_are_located(&self) -> bool {
        false
    }

    /// **None.** A Kotlin program is its own component — see this module's documentation for why
    /// TeaVM leaves nothing for a shared guest to hold.
    fn guest_component(&self) -> Option<&'static [u8]> {
        None
    }

    /// This language's catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language's build reflects one of these under its own stem into the one
    /// `OUT_DIR`, and each carries the language it was generated for; checking it here is what stops
    /// a catalogue written — or embedded — under the wrong stem from reaching a model as a system
    /// prompt describing a sandbox nobody has.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the generated signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::Kotlin,
                "`signatures/kotlin.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    /// [`view.openFile("src/Main.kt")`](self::open_file_statement), with the window as two
    /// **named** arguments and no terminator.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// Those statements, in the `main` of a program this arm's compiler will accept — because
    /// Kotlin has nowhere for a statement to live outside a function, so a statement list is not a
    /// program.
    fn open_file_program(&self, views: &[(&str, Option<FileWindow>)]) -> String {
        let open_file = spell(self, VIEWS_OPEN_FILE);
        let calls: String = views
            .iter()
            .map(|(path, window)| {
                format!("    {}\n", open_file_statement(&open_file, path, *window))
            })
            .collect();
        main_program(&calls)
    }

    /// [A whole program: a `listOf(…)` of names and a `for` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }

    /// [One search over every listed module at once, then a `listOf(…)` and a `for`
    /// loop](self::bootstrap_program) in a `fun main()`, with both calls resolved from this
    /// language's own catalogue and the filters passed as named default arguments.
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str], tree: Option<u32>) -> String {
        bootstrap_program(
            &spell(self, DOCS_SEARCH),
            &spell(self, VIEWS_OPEN_DOCS_VIEW),
            &spell(self, FILES_TREE),
            &spell(self, VIEWS_OPEN_TEXT),
            modules,
            docs,
            tree,
        )
    }

    /// **The marker as written, and the marker as TeaVM stores it** — which is UTF-16.
    ///
    /// Measured on the artifact this arm's own driver writes rather than assumed, exactly as on
    /// [Java's](super::java): a program whose only literal is `gg-isolation-000-marker` carries
    /// `g\0g\0-\0…` in the module's data section and the ASCII bytes nowhere at all, because TeaVM
    /// keeps a `String` constant in Java's own UTF-16 whichever compiler wrote the bytecode.
    ///
    /// The ASCII form is kept beside it rather than replaced, because it costs nothing and it is
    /// what a *module*'s artifact carries: a code module on this arm is handed back as the author's
    /// own source.
    ///
    /// Both forms are derived from the marker character by character, so a form belonging to one
    /// input can never be found in another input's artifact.
    #[cfg(test)]
    fn isolation_marker_forms(&self, marker: &str) -> Vec<String> {
        let wide: String = marker
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .map(char::from)
            .collect();
        vec![marker.to_string(), wide]
    }

    /// One public top-level function returning `name` — because this is the arm whose module shape
    /// is not its program shape.
    ///
    /// A program here declares a `fun main()` and a module is a file whose **public top-level
    /// functions** are its namespace, so the seam's default subject (this language's generated
    /// documentation program) is a module that declares no function at all and is refused by name.
    /// The `name` rides in as a returned **string literal**, where neither the Kotlin compiler's
    /// constant folding nor TeaVM's reachability pruning can drop it: it is the value the module's
    /// one export hands back.
    #[cfg(test)]
    fn gate_module(&self, name: &str) -> String {
        format!(
            "fun marker(): String = {}\n",
            serde_json::Value::String(name.to_string())
        )
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`,
/// `object` → `_object`.
///
/// camelCase because that is what Kotlin spells a name in and what this SDK spells every other bound
/// function in, so a program reaching `lib.csvTools.parse(…)` reads like the rest of its own scope.
/// Any separator — `-`, `_`, `.`, or anything a name should not have had — joins the next word
/// rather than surviving; a name that is nothing but separators becomes `module`.
///
/// # The result must be a Kotlin identifier, and that is load-bearing
///
/// The key is a **package segment**: gg compiles the module's own file into
/// [`lib.<key>`](source::module_package), and `lib.<key>.<name>` is what a program writes or
/// imports. A key that is not an identifier is therefore a syntax error against the *model's* own
/// file, on every turn, for a name it was handed and cannot change — so a leading digit is prefixed
/// and a **hard keyword** is too. Both are prefixed rather than suffixed because `_object` reads as
/// a name a tool chose and `object_` reads as one an author typed.
///
/// Deliberately ASCII-only, though Kotlin identifiers may be Unicode and may even be backquoted: a
/// name a model has to reproduce exactly is one that should have no characters it could get wrong.
pub(super) fn binding_name(name: &str) -> String {
    let mut out = String::new();
    let mut capitalize = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if capitalize {
                out.extend(ch.to_uppercase());
                capitalize = false;
            } else {
                out.push(ch);
            }
        } else {
            capitalize = !out.is_empty();
        }
    }
    if out.is_empty() {
        return "module".to_string();
    }
    if out.starts_with(|ch: char| ch.is_ascii_digit()) || RESERVED.contains(&out.as_str()) {
        out.insert(0, '_');
    }
    out
}

/// Kotlin's **hard keywords**: the words the parser refuses wherever an identifier may stand.
///
/// The soft and modifier keywords (`by`, `data`, `sealed`, `value`, `where`, `open`, and the rest)
/// are deliberately absent: each is a legal identifier, and reserving one would rename a key for no
/// reason. `field` and `it` are absent for the same reason — they are identifiers everywhere except
/// inside an accessor and a lambda, and a package segment is neither.
const RESERVED: [&str; 28] = [
    "as",
    "break",
    "class",
    "continue",
    "do",
    "else",
    "false",
    "for",
    "fun",
    "if",
    "in",
    "interface",
    "is",
    "null",
    "object",
    "package",
    "return",
    "super",
    "this",
    "throw",
    "true",
    "try",
    "typealias",
    "typeof",
    "val",
    "var",
    "when",
    "while",
];

/// `view.openFile("src/Main.kt")`, or `view.openFile("src/Main.kt", offset = 400, limit = 200)` for
/// a window — with `view.openFile` already spelled by the language that asked.
///
/// Deliberately the plainest statement that does the job: no `val`, no printing. It is synthesized
/// into the agent's own transcript and read by the model as an example of its own output, so anything
/// clever in it is a style the run did not intend to teach.
///
/// The window is two **named** arguments of the one signature, which is this arm's idiom for an
/// optional argument and the shape the system prompt teaches — and it is exactly where this arm and
/// [Java's](super::java) are meant to look different, since there the same window is two positional
/// arguments of a second overload. There is **no terminator**, because Kotlin statements end at the
/// newline and a stray semicolon is a style no Kotlin author writes.
///
/// The path is rendered through [`serde_json`] so a quote or a backslash in one cannot produce a
/// statement that would not parse: Kotlin's string literals accept exactly the escapes JSON's do —
/// and a `$` in a path is left alone deliberately, because it only begins a template inside a string
/// this function never writes one of.
pub(super) fn open_file_statement(
    open_file: &str,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let path = serde_json::Value::String(path.to_string());
    match window {
        Some(window) => format!(
            "{open_file}({path}, offset = {}, limit = {})",
            window.offset, window.limit
        ),
        None => format!("{open_file}({path})"),
    }
}

/// The program every source gg synthesizes for this arm is written as: `body` inside a `fun main()`.
///
/// It is a **whole program by this arm's own rules**, because gg writes nothing around a model's
/// reply any more and the opening turn is executed rather than only read. A statement list here
/// would be a text in the model's own transcript that its next reply would be refused for.
///
/// `fun main()` with no parameters, which is the one convention this arm asks of a model and which
/// [`source`] explains: it is the form that compiles to the `main()` gg's entry class calls.
///
/// Nothing gg writes here needs an `import`: `listOf` is in `kotlin.collections`, which every Kotlin
/// file imports by default, and everything of gg's is written in full out of the catalogue.
fn main_program(body: &str) -> String {
    format!("fun main() {{\n{body}}}\n")
}

/// A whole program: a `listOf(…)` of names and a `for` over it, each iteration opening one
/// documentation view.
///
/// A list and a loop rather than one statement per name because the list is as long as the family —
/// eleven calls written out would be a program a model reads as a style to copy.
///
/// The empty case is `listOf<String>()`, whose element type has to be written out because there is
/// no declared type beside it to infer from.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    main_program(&views_loop(open_docs_view, names))
}

/// A `listOf(…)` of names and the `for` that opens one documentation view per name, indented for a
/// function body.
fn views_loop(open_docs_view: &str, names: &[&str]) -> String {
    format!(
        "{}\
         \x20   for (name in functions) {{\n        \
             {open_docs_view}(name)\n\
         \x20   }}\n",
        listed("functions", names),
    )
}

/// One `val <binding> = listOf(…)` declaration, indented for a function body.
///
/// The empty case is `listOf<String>()`, whose element type has to be written out because there is
/// no declared type beside it to infer from.
fn listed(binding: &str, names: &[&str]) -> String {
    let entries: Vec<String> = names
        .iter()
        .map(|name| format!("        {}", serde_json::Value::String((*name).to_string())))
        .collect();
    match entries.is_empty() {
        true => format!("    val {binding} = listOf<String>()\n"),
        false => format!(
            "    val {binding} = listOf(\n{}\n    )\n",
            entries.join(",\n")
        ),
    }
}

/// The opening turn: **one** search naming every module gg listed at once, then a `listOf(…)` of the
/// names to open documentation views of and a `for` over it — inside a `fun main()`, because this
/// program is **executed** as the session's first turn.
///
/// One call rather than one per module, because the filter takes a list and several modules are a
/// union: what the model reads at the top of its window is one page of everything it was listed, and
/// a loop of near-identical calls is a shape it would copy for its own work. The names stay a list
/// and a loop, because that list is as long as the family; its empty case is spelled
/// `listOf<String>()` for the reason [`open_docs_views_statement`]'s is, and the module list is
/// written into the call rather than declared, because a `val` naming two paths reads as ceremony.
///
/// An agent listed **no** module gets no search at all rather than one over an empty list: a search
/// with neither a query nor a filter is the one way this call is refused, and the program that opens
/// the session is the last place to hand a model a worked example of an `INVALID_ARGUMENT`.
///
/// The filters are **default arguments passed by name**, which is this language's idiom for optional
/// ones, and every gg name is written in full, which is one of the two lines this arm offers instead
/// of an import.
///
/// A failed call throws and nothing here catches it, which is this arm's failure model: a bootstrap
/// that caught its own failure would be a worked example of swallowing one.
pub(super) fn bootstrap_program(
    search: &str,
    open_docs_view: &str,
    tree_call: &str,
    open_text: &str,
    modules: &[&str],
    docs: &[&str],
    tree: Option<u32>,
) -> String {
    let paths: Vec<String> = modules
        .iter()
        .map(|path| serde_json::Value::String((*path).to_string()).to_string())
        .collect();
    let walked = match tree {
        None => String::new(),
        Some(depth) => format!(
            "    {open_text}({}, {tree_call}(depth = {depth}))\n\n",
            serde_json::Value::String(WORKSPACE_TREE_VIEW.to_string())
        ),
    };
    let listing = match paths.is_empty() {
        true => String::new(),
        false => format!(
            "    {search}(modules = listOf({}), limit = {MAX_SEARCH_LIMIT})\n\n",
            paths.join(", ")
        ),
    };
    main_program(&format!(
        "{walked}{listing}{}",
        views_loop(open_docs_view, docs)
    ))
}

#[cfg(test)]
#[path = "kotlin.test.rs"]
mod tests;

/// **The Kotlin arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from [`tests`], because these are a different kind of test: each one
/// compiles a ~400 KB component and starts a JVM that loads the Kotlin compiler and TeaVM, which is
/// seconds rather than microseconds, where everything next door is a pure function over text.
#[cfg(test)]
#[path = "kotlin.substrate.test.rs"]
mod substrate;

/// **The Kotlin arm's model-facing surface**, driven the same way: the hand-written SDK, the
/// catalogue reflected out of its own KDoc, and the libraries it says a program may reach.
///
/// Separate from [`substrate`] because it is a different claim. That file asks whether Kotlin runs
/// here; this one asks whether the thing a model is *told* it may write is the thing the sandbox
/// really has — every gg operation driven through the real membrane from its Kotlin spelling against the
/// same expected JSON the other arms are held to.
#[cfg(test)]
#[path = "kotlin.surface.test.rs"]
mod surface;
