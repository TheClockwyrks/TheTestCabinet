//! **Java** — the arm whose compiler is a **warm JVM** gg keeps between preparations, and whose
//! program is compiled to a WebAssembly component of its own before the turn ever runs it.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`] — the host-side `javac` and TeaVM build, what it costs, what it shares, and the
//!   two failures it tells apart;
//! * [`source`] — what gg does to a model's Java before javac sees it (**nothing**), the one
//!   convention that costs, and the code-module wrapper, which is a module author's file rather than
//!   a model's reply;
//! * `packages/gg-sandbox-java/src/gg/` — the SDK, and every word of prose a model reads about it;
//! * the **signature catalogue** — reflected out of that SDK's own Javadoc by `javadoc` and a
//!   doclet of gg's own, and generated into this build's `OUT_DIR` rather than committed anywhere
//!   (see `crates/gg/build.rs`);
//! * `java.sdk.jar` — that SDK compiled, which is what a classpath entry is, cut into this
//!   build's artifacts by `crates/gg-sandbox-artifacts/java` rather than committed anywhere;
//! * `java.adapter.wasm` — the pinned `wasi_snapshot_preview1` reactor adapter every JVM component
//!   is encoded with, cut into the same place;
//! * `checkers/java.compiler.java` — gg's own compiler driver, a single file run by the JDK's
//!   single-file source-code launcher;
//! * `checkers/java.toolchain.json` — the JDK and TeaVM releases this arm is pinned to.
//!
//! # Why this arm has no guest component
//!
//! Because there is nothing for one to hold. TeaVM does not produce a Java interpreter that later
//! runs a program: it produces **the program**, carrying only the classlib methods that program's
//! own call graph reached, renamed and inlined into the same module. There is no stable "Java
//! runtime" two programs could share, so a component of this arm's own would carry the wrong 600 KB
//! for every program that was not the one it was built from.
//!
//! So this is a **compiled** arm on the seam's own terms, exactly as [Rust](super::rust),
//! [C++](super::cpp) and [Swift](super::swift) are: [`guest_component`](Java::guest_component)
//! answers `None`, the compiled bytes ride on the prepared program, and the engine instantiates a
//! fresh component every turn. What that costs is measured rather than asserted
//! (`java.substrate.test.rs`): a ~360 KB component for a program that logs one line, ~1.4 s of
//! `javac` and TeaVM, and `Component::new` at ~43 ms on this repository's dev container, against
//! the Rust arm's ~14 ms at ~64 KB. It is paid per turn and cannot be otherwise.
//!
//! # What a Java program is, here
//!
//! **A whole Java compilation unit**: the `import` lines the model wrote, and a
//! `public final class Program` with a `public static void main(String[] args)` in it. gg writes no
//! prologue, no epilogue, no entry point and no import into that file, so javac reads the bytes the
//! model sent and every diagnostic and every stack frame is already in the model's own coordinates.
//! [`source`] carries the one convention that costs — the class's *name* — and what enforces it,
//! which is javac's own diagnostic in both of the two ways of getting it wrong.
//!
//! The library set is **TeaVM's classlib** — a large subset of `java.base` — and what is missing
//! from it is a located compile error rather than a run-time surprise, which is the most valuable
//! property this arm has and was not expected: TeaVM reports an absent class or method at the
//! model's own line, so `java.nio.file.Paths` is `Program.java:8: Class java.nio.file.Paths was not
//! found` on the turn that wrote it.
//!
//! # What this arm has that no other does
//!
//! Two things. It is the only arm whose **compiler is kept warm**, and the only one whose program
//! passes through **two compilers** before it runs. Both are stated in [`compile`]: the warmth is a
//! [`CompilerPool`](crate::sandbox::CompilerPool) of processes rather than a shared builder — the
//! shape the study measured silently producing no output for three of four concurrent builds — and
//! the two compilers are why a diagnostic here can be javac's *or* TeaVM's, which are different
//! bands of the same recoverable, model-facing error.
//!
//! Its SDK reaches a program the way Java reaches any library: a jar on the classpath, which is
//! packaging, plus an `import` line **the program writes**. Every module's catalogue entry states
//! that line, and a program that writes none resolves nothing of gg's. A code
//! [skill](crate::skills)'s or [memory](crate::memories)'s module arrives by the same road: the
//! class directory its own compile produced, on the same classpath, reached by `import lib.<key>;`
//! or by the class named in full.

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

#[path = "java.compile.rs"]
pub(super) mod compile;

#[path = "java.source.rs"]
pub(super) mod source;

/// This arm's catalogue, reflected out of the SDK's own Javadoc by
/// `packages/gg-sandbox-java/signatures.sh` with `javadoc` and a doclet of gg's own.
///
/// It is not committed. `crates/gg/build.rs` runs that reflection as a step of building this
/// crate and this line embeds what it wrote into the build's own `OUT_DIR`, so what a model is
/// told about this arm is reflected out of the SDK sources in this checkout, on the build that
/// compiles the module telling it.
const SIGNATURES: &str = include_str!(concat!(env!("OUT_DIR"), "/signatures/java.signatures.json"));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static JAVA: Java = Java;

/// Java: compiled to bytecode by `javac` and then to a WebAssembly component by TeaVM's
/// `WEBASSEMBLY_WASI` backend, inside a warm JVM, and run as a component of its own.
pub(super) struct Java;

impl ProgramLanguage for Java {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::Java
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::Java.display_name()
    }

    /// `import lib.csvTools;` — the line a program writes to reach a loaded module, which is the
    /// line it writes to reach [gg's own SDK](https://docs.testcabinet.ai/gg/languages/java/).
    ///
    /// A module is compiled on its own into package [`lib`](source::MODULE_PACKAGE) under a class
    /// named by its key, and the directory of classes goes on the program's classpath the way this
    /// arm's SDK jar does. A classpath entry declares no name, so what a program has after it is
    /// what Java gives it: the class named in full, `lib.csvTools.parse(…)`, or this import and the
    /// simple name. The access template is the seam's own default, `lib.<key>.<name>`, which on this
    /// arm is a package, a class and a `static` method.
    fn lib_import(&self, key: &str) -> Option<String> {
        Some(format!("import {}.{key};", source::MODULE_PACKAGE))
    }

    /// The `javac` compile, the TeaVM translation and the component encode, in this preparation's
    /// own workspace and in a JVM lent to it alone — see [`compile`] for what it costs, what it
    /// shares, and how it tells a program a compiler refused from a compiler that could not run.
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

    /// `javac`, which is what a Java programmer calls it and what its own binary is called — not
    /// TeaVM, which translates what javac accepted and judges nothing about the program except that
    /// its classlib carries what the program reached.
    ///
    /// Two compilers read a program here and the seam asks for **one**: the thing this language's
    /// own users would say a program is judged by. Naming one is also what has the compile — the
    /// largest of any arm's, and paid on the failing path as much as the succeeding one —
    /// [recorded](crate::sandbox::SandboxOutcome::compile) rather than absorbed, which for an arm
    /// this expensive is the difference between a study reading it as free and reading it honestly.
    fn checker(&self) -> Option<&'static str> {
        Some("javac")
    }

    /// [What `javac` says a program could not import](compile::unresolved_imports), read out of the
    /// `package … does not exist` wording this arm's own diagnostics carry.
    fn unresolved_imports(&self, diagnostic: &str) -> Vec<String> {
        compile::unresolved_imports(diagnostic)
    }

    /// Start one JVM and place the compiler driver and the SDK jar now, so the first code turn pays
    /// for neither.
    ///
    /// This is the arm that needs it most: a cold build is 4–9 s against 0.33–0.56 s warm, so a run
    /// whose first program paid the cold start would report a compile time an order of magnitude
    /// above every one after it. Idempotent and best effort — a failure here is the failure the
    /// first compile makes, and there it is classified, counted and reported as a
    /// [toolchain failure](PrepareFailure::Toolchain).
    fn warm_prepare(&self) {
        compile::warm();
    }

    /// `javac` alone, pointed at a class body wrapped in a class — and the names the resulting
    /// namespace offers.
    ///
    /// What comes back is the author's own source rather than an artifact, because a module is
    /// compiled under the **key** it is bound at and no key exists at the read. Running the compiler
    /// here anyway is what buys the author a located diagnostic at the read rather than one against
    /// somebody else's program every turn after it.
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

    /// `.java`, and nothing else.
    ///
    /// One extension, like [Python](super::python)'s, [Ruby](super::ruby)'s and
    /// [PureScript](super::purescript)'s: nothing else in the registry can compile a Java module —
    /// the ECMAScript guest could evaluate the *compiled* output, but a skills directory holds
    /// sources rather than artifacts — so a skill whose code is spelled `skill.ts` is a skill this
    /// arm's agents are not offered.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["java"]
    }

    /// [camelCase](self::binding_name) — Java's own convention for a name a program writes, and this
    /// SDK's for everything else.
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

    /// **None.** A Java program is its own component — see this module's documentation for why
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
                GgProgramLanguage::Java,
                "`signatures/java.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    /// [`gg.views.Views.openFile("src/Main.java");`](self::open_file_statement), with the window as
    /// the second and third arguments of an **overload** and a semicolon at the end.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// Those statements, in the `main` of a class this arm's compiler will accept — because Java
    /// has nowhere for a statement to live outside a member, so a statement list is not a program.
    fn open_file_program(&self, views: &[(&str, Option<FileWindow>)]) -> String {
        let open_file = spell(self, VIEWS_OPEN_FILE);
        let calls: String = views
            .iter()
            .map(|(path, window)| {
                format!(
                    "        {}\n",
                    open_file_statement(&open_file, path, *window)
                )
            })
            .collect();
        main_program("", &calls)
    }

    /// [A whole program: a `List.of(…)` of names and an enhanced `for` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }

    /// [One search over every module at once, then a `List.of(…)` and an enhanced `for` opening a
    /// documentation view of each name](self::bootstrap_program), with both calls resolved from this
    /// language's own catalogue and the search's arguments built with the SDK's own builder.
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
    /// Measured on the artifact this arm's own driver writes rather than assumed: a program whose
    /// only literal is `gg-isolation-000-marker` carries `g\0g\0-\0…` in the module's data section
    /// and the ASCII bytes nowhere at all, because TeaVM keeps a `String` constant in Java's own
    /// UTF-16.
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

    /// A class body with one `public static` method returning `name` — because this is the one arm
    /// whose module shape is not its program shape.
    ///
    /// A program here is a whole compilation unit and a module is a **class body**, so the seam's
    /// default subject (this language's generated documentation program) is a module that declares
    /// no method at all and is refused by name. The `name` rides in as a returned **string literal**,
    /// where javac's constant folding cannot drop it: it is the value the module's one export hands
    /// back.
    #[cfg(test)]
    fn gate_module(&self, name: &str) -> String {
        format!(
            "public static String marker() {{ return {}; }}\n",
            serde_json::Value::String(name.to_string())
        )
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`,
/// `class` → `_class`.
///
/// camelCase because that is what Java spells a name in and what this SDK spells every other bound
/// function in, so a program reaching `lib.csvTools.parse(…)` reads like the rest of its own scope.
/// Any separator — `-`, `_`, `.`, or anything a name should not have had — joins the next word
/// rather than surviving; a name that is nothing but separators becomes `module`.
///
/// # The result must be a Java identifier, and that is load-bearing
///
/// The key is the **name of the class** a module is compiled under in package
/// [`lib`](source::MODULE_PACKAGE), and the path segment javac resolves when a program writes
/// `lib.<key>.<name>`. A key that is not an identifier is therefore a module that does not compile,
/// for a name the model was handed and cannot change — so a leading digit is prefixed and a
/// **reserved word** is too. Both are prefixed rather than suffixed because `_class` reads as a name
/// a tool chose and `class_` reads as one an author typed.
///
/// Deliberately ASCII-only, though Java identifiers may be Unicode: a name a model has to reproduce
/// exactly is one that should have no characters it could get wrong.
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

/// Every word javac refuses as an identifier: the language's keywords and its three reserved
/// literals.
///
/// Enumerated because the language enumerates it — this is
/// [JLS §3.9](https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.9) plus
/// `true`, `false` and `null`, which §3.10.3 and §3.10.7 reserve as literals rather than keywords
/// and which javac refuses in exactly the same place. The contextual keywords (`record`, `sealed`,
/// `yield`, `var`) are deliberately absent: each is a legal class name, and so is `_` — which the
/// camelCase pass above cannot produce in any case, since it keeps only alphanumerics.
const RESERVED: [&str; 53] = [
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extends",
    "false",
    "final",
    "finally",
    "float",
    "for",
    "goto",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "native",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "true",
    "try",
    "void",
    "volatile",
    "while",
];

/// `gg.views.Views.openFile("src/Main.java");`, or the same call with `, 400, 200` for a window —
/// with the call itself already spelled by the language that asked.
///
/// Deliberately the plainest statement that does the job: no local, no `var`, no printing. It is
/// synthesized into the agent's own transcript and read by the model as an example of its own
/// output, so anything clever in it is a style the run did not intend to teach.
///
/// The window is two **positional** arguments of a second overload, which is this arm's idiom for an
/// optional argument and the shape the system prompt teaches — Java has neither default parameters
/// nor keyword arguments, so an options object would be a shape no Java library uses and a `null`
/// would be a shape no Java author wants. The path is rendered through [`serde_json`] so a quote or
/// a backslash in one cannot produce a statement that would not parse: Java's string literals accept
/// exactly the escapes JSON's do.
///
/// The call is written **in full**, `gg.` and all, because that is what the catalogue spells it as
/// and because gg writes no `import` into a program: a bare `Views.openFile` in a text gg put in the
/// model's own transcript would not compile.
pub(super) fn open_file_statement(
    open_file: &str,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let path = serde_json::Value::String(path.to_string());
    match window {
        Some(window) => format!("{open_file}({path}, {}, {});", window.offset, window.limit),
        None => format!("{open_file}({path});"),
    }
}

/// The compilation unit every program gg synthesizes for this arm is written as: `imports`, then
/// `body` inside the `main` of [`PROGRAM_CLASS`](source::PROGRAM_CLASS).
///
/// It is a **whole program by this arm's own rules**, because gg writes nothing around a model's
/// reply any more and the opening turn is executed rather than only read. A statement list here
/// would be a text in the model's own transcript that its next reply would be refused for.
///
/// `main` declares no `throws`, because every call this SDK offers throws an unchecked
/// [`ApiError`](https://docs.testcabinet.ai/gg/languages/java/) and nothing gg writes here declares
/// a checked one.
fn main_program(imports: &str, body: &str) -> String {
    format!(
        "{imports}public final class {class} {{\n\
         \x20   public static void main(String[] args) {{\n\
         {body}\
         \x20   }}\n\
         }}\n",
        class = source::PROGRAM_CLASS,
    )
}

/// A whole program: a `List.of(…)` of names and an enhanced `for` over it, each iteration opening
/// one documentation view.
///
/// A list and a loop rather than one statement per name because the list is as long as the family —
/// eleven calls written out would be a program a model reads as a style to copy.
///
/// `List.of` rather than an array literal because it is what a Java author writes today, under the
/// `import java.util.List;` this program writes for itself. The empty case is `List.of()`, whose
/// element type comes from the declaration's own `List<String>` — an array literal would have needed
/// a cast there.
///
/// The names are rendered through [`serde_json`] for the reason a path is: a name carrying a quote
/// would otherwise produce a program that does not parse.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    main_program(LIST_IMPORT, &views_loop(open_docs_view, names))
}

/// The `import` line the two synthesized programs that use `List.of` write for themselves.
///
/// Everything of **gg's** they call is written in full out of the catalogue, so this is the only
/// import either of them needs — and writing it is what makes them the shape a model should copy
/// rather than a shape gg would refuse.
const LIST_IMPORT: &str = "import java.util.List;\n\n";

/// A `List.of(…)` of names and the enhanced `for` that opens one documentation view per name.
fn views_loop(open_docs_view: &str, names: &[&str]) -> String {
    format!(
        "        List<String> functions = List.of({});\n\
         \x20       for (String name : functions) {{\n\
         \x20           {open_docs_view}(name);\n\
         \x20       }}\n",
        listed(names),
    )
}

/// The members of a `List.of(…)`, one per line and indented for a body, or nothing at all.
fn listed(names: &[&str]) -> String {
    let entries: Vec<String> = names
        .iter()
        .map(|name| {
            format!(
                "                {}",
                serde_json::Value::String((*name).to_string())
            )
        })
        .collect();
    match entries.is_empty() {
        true => String::new(),
        false => format!("\n{}\n        ", entries.join(",\n")),
    }
}

/// The opening turn: **one** search naming every module gg handed it, then a `List.of(…)` of the
/// names to open as documentation views with an enhanced `for` over it — in the `main` of a class gg
/// declares, because this program is **executed** as the session's first turn.
///
/// One search rather than one per module, because the filter is a **union**: naming them all returns
/// the entries of any of them, so a loop of a call per module would be a shape a model copies for
/// work that never needed it. And it carries no query at all — every part of a search is optional,
/// so a listing of whole modules names the modules and the page and nothing else.
///
/// The arguments are a **builder** — this language has neither default parameters nor keyword
/// arguments, so a call taking a bag of optional parts takes one of these, and the SDK declares it
/// nested inside the module the search belongs to. The list of names stays a `List.of(…)` and a
/// loop, because it is as long as the family and a dozen calls written out is a shape a model would
/// copy.
///
/// **An agent holding neither of the two modules is written the loop alone.** No module and no query
/// is the one question the search refuses, so a program that would ask it does not make the call
/// rather than making one that fails.
///
/// A failed call throws an unchecked exception and nothing here catches it, which is this arm's
/// failure model: a bootstrap that caught its own failure would be a worked example of swallowing
/// one.
pub(super) fn bootstrap_program(
    search: &str,
    open_docs_view: &str,
    tree_call: &str,
    open_text: &str,
    modules: &[&str],
    docs: &[&str],
    tree: Option<u32>,
) -> String {
    let views = views_loop(open_docs_view, docs);
    let filters = format!("{}.SearchFilters", class_of(search));
    let walked = match tree {
        None => String::new(),
        Some(depth) => format!(
            "        {open_text}({}, {tree_call}({depth}));\n\n",
            serde_json::Value::String(WORKSPACE_TREE_VIEW.to_string())
        ),
    };
    let body = match modules.is_empty() {
        true => format!("{walked}{views}"),
        false => format!(
            "{walked}        {search}(new {filters}()\n\
             \x20               .modules({})\n\
             \x20               .limit({MAX_SEARCH_LIMIT}));\n\
             \n\
             {views}",
            arguments(modules),
        ),
    };
    main_program(LIST_IMPORT, &body)
}

/// The arguments of a varargs call: each name as a Java string literal, comma-separated on one line.
///
/// A line of its own rather than a `List.of(…)` above the call, because the SDK spells a
/// `list<string>` argument as varargs and this one is at most the two module paths an agent holds —
/// where the list literal the documentation loop keeps is as long as a whole family.
///
/// The names are rendered through [`serde_json`] for the reason the members of a list are: a name
/// carrying a quote would otherwise produce a program that does not parse.
fn arguments(names: &[&str]) -> String {
    names
        .iter()
        .map(|name| serde_json::Value::String((*name).to_string()).to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

/// The class a fully-qualified call is a `static` method of, taken off the front of the call itself.
///
/// The one thing gg has to write here that is a **type** rather than a call, and it is derived from
/// the call rather than written down beside it so that the two cannot disagree: this SDK nests a
/// module's option builders inside the module's own class, so the class in front of the search is
/// the class the builder is reached through. Every catalogued name is module-qualified — the name
/// rule (`signatures.fqn.rs`) is what makes that true on every arm — so a call that somehow carried
/// no qualifier is used as its own class rather than crashing a turn.
fn class_of(call: &str) -> &str {
    call.rsplit_once('.').map_or(call, |(class, _)| class)
}

#[cfg(test)]
#[path = "java.test.rs"]
mod tests;

/// **The Java arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from [`tests`], because these are a different kind of test: each one starts
/// a JVM that loads TeaVM and builds a component per program, where everything next door is a pure
/// function over text.
#[cfg(test)]
#[path = "java.substrate.test.rs"]
mod substrate;

/// **The Java arm's model-facing surface**, driven the same way: the hand-written SDK, the
/// catalogue reflected out of its own Javadoc, and the libraries it says a program may reach.
///
/// Separate from [`substrate`] because it is a different claim. That file asks whether Java runs
/// here; this one asks whether the thing a model is *told* it may write is the thing the sandbox
/// really has — every gg operation driven through the real membrane from its Java spelling against the
/// same expected JSON the other arms are held to.
#[cfg(test)]
#[path = "java.surface.test.rs"]
mod surface;
