//! **Java** — the arm whose compiler is a **warm JVM** gg keeps between preparations, and whose
//! program is compiled to JavaScript by TeaVM before the guest ever sees it.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`] — the host-side `javac` and TeaVM build, what it costs, what it shares, and the
//!   two failures it tells apart;
//! * [`source`] — what gg does to a model's Java before javac sees it: the wrapper, the import
//!   hoist and the export scan, all line-preserving;
//! * [`healing`] — the [dialect](crate::healing::Dialect) response healing asks its lexical
//!   questions of: the fence tags, the two predicates, and the text-block lexer — two of whose
//!   answers are this arm's alone;
//! * `packages/gg-sandbox-java/src/gg/` — the SDK, and every word of prose a model reads about it;
//! * the **signature catalogue** — reflected out of that SDK's own Javadoc by `javadoc` and a
//!   doclet of gg's own, and generated into this build's `OUT_DIR` rather than committed anywhere
//!   (see `crates/gg/build.rs`);
//! * `java.sdk.jar` — that SDK compiled, which is what a classpath entry is, cut into this
//!   build's artifacts by `crates/gg-sandbox-artifacts/java` rather than committed anywhere;
//! * `checkers/java.compiler.java` — gg's own compiler driver, a single file run by the JDK's
//!   single-file source-code launcher;
//! * `checkers/java.toolchain.json` — the JDK and TeaVM releases this arm is pinned to.
//!
//! # Why this arm has no component of its own
//!
//! It shares [TypeScript](super::typescript)'s, which is the ECMAScript guest — the same sharing
//! [JavaScript](super::javascript) and [PureScript](super::purescript) have, and the seam's "no
//! language is served another's artifacts" rule names such a pair rather than inferring it from a
//! passing test.
//!
//! The question was settled by measurement rather than by analogy, because Java is not PureScript.
//! A compiled PureScript program is a few kilobytes of self-contained JavaScript with **no runtime
//! at all**; a compiled Java program carries as much of TeaVM's 1,213-class classlib as it reached,
//! which for an ordinary program using `TreeMap`, streams and `String.format` is **~600 KB**. That
//! is a real per-turn cost and the obvious response is to bake the classlib into a component of this
//! arm's own, the way [Ruby](super::ruby) bakes Opal — so that `componentize-js` pre-initialises it
//! under wizer and a turn pays nothing for it.
//!
//! It does not work here, and the reason is TeaVM rather than gg. TeaVM does not *have* a runtime to
//! bake: it emits, per program, only the classlib methods that program's call graph reached, renamed
//! and inlined into the same file. There is no stable "Java runtime" object two programs could
//! share, so a component carrying one would carry the wrong 600 KB for every program that was not
//! the one it was built from. What a component of this arm's own would hold is therefore nothing,
//! and a second 20 MB artifact holding nothing is a second artifact to keep in step with the WIT.
//! The cost is real and is measured rather than hidden (`java.substrate.test.rs`): ~9 ms of evaluation per
//! turn against ~2 ms for the equivalent JavaScript on the same artifact.
//!
//! # What a Java program is, here
//!
//! A **sequence of statements**, as on every arm but PureScript — put into the body of a method of
//! a class gg declares, because Java has nowhere else for a statement to live. See [`source`] for
//! the wrapper, the import hoist that lets a model write the `import` lines a Java author writes
//! without them landing inside a method body, and the one thing this shape costs: a helper type
//! declared in a program is a *local* declaration, and a local declaration may not be `public`.
//!
//! The library set is **TeaVM's classlib** — a large subset of `java.base` — and what is missing
//! from it is a located compile error rather than a run-time surprise, which is the most valuable
//! property this arm has and was not expected: TeaVM reports an absent class or method at the
//! model's own line, so `java.nio.file.Paths` is `program.java:8: Class java.nio.file.Paths was not
//! found` on the turn that wrote it.
//!
//! # What this arm has that no other does
//!
//! Three things. It is the only arm whose **compiler is kept warm**, the only one whose program
//! passes through **two compilers** before it runs, and the only one whose **SDK reaches a program
//! the way that language reaches any library** — a jar on the classpath, imported by the header gg
//! writes. The first two are stated in [`compile`]: the warmth is a
//! [`CompilerPool`](crate::sandbox::CompilerPool) of processes rather than a shared builder — the
//! shape the study measured silently producing no output for three of four concurrent builds — and
//! the two compilers are why a diagnostic here can be javac's *or* TeaVM's, which are different
//! bands of the same recoverable, model-facing error. The third is [`source`]'s: the wrapper's
//! header carries `gg.*` plus one type-import-on-demand per capability module, so `Files.readFile`
//! is a static method on an imported class and **no gg function is a bare identifier**. An
//! `import static gg.Gg.*` would put twelve *values* into scope, which is exactly the shape the
//! static-SDK design forbids: a call the agent may not make must never look like an ordinary local
//! one. See [`source`] for the whole argument.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, spell,
};
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

#[path = "java.compile.rs"]
pub(super) mod compile;

#[path = "java.source.rs"]
pub(super) mod source;

#[path = "java.healing.rs"]
pub(super) mod healing;

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

/// Java: compiled to bytecode by `javac` and then to JavaScript by TeaVM, inside a warm JVM, and
/// evaluated by the ECMAScript guest.
pub(super) struct Java;

impl ProgramLanguage for Java {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::Java
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::Java.display_name()
    }

    /// A module is compiled separately from the program that uses it, so there is no `import` for
    /// `javac` to check the two against and a program names both halves as strings —
    /// [`Lib`](https://docs.testcabinet.ai/gg/languages/java/#code-modules)'s family, chosen by what
    /// the export hands back.
    fn lib_access(&self, key: &str) -> String {
        format!("Lib.<text|number|flag|run>(\"{key}\", \"<name>\", …)")
    }

    /// The wrapper, the `javac` compile and the TeaVM translation, in this preparation's own
    /// workspace and in a JVM lent to it alone — see [`compile`] for what it costs, what it shares,
    /// and how it tells a program a compiler refused from a compiler that could not run.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        compile::compile_program(source, context)
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

    /// The same two compilers a program gets, pointed at a class body rather than a statement
    /// sequence — and the names the resulting namespace offers.
    ///
    /// The names are read from the model's own source by [`source`]'s export scan rather than out
    /// of the compiled bundle, because they are what the skill's author is *told* the namespace
    /// holds; the arm's own tests assert that the scan and the compiler agree on the answer, which
    /// is what keeps one reading from being a second chance to differ.
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        let (source, exports) = compile::compile_module(source, context)?;
        Ok(PreparedModule { source, exports })
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

    /// The ECMAScript guest, which is [TypeScript](super::typescript)'s.
    ///
    /// Declared sharing rather than an accident, and the decision was made by measurement rather
    /// than by analogy: see this module's documentation for why TeaVM has no runtime for a component
    /// of this arm's own to bake, and `SHARED_ARTIFACTS` in the seam's own tests for the pairs being
    /// written down.
    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(super::typescript::COMPONENT)
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

    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &healing::JAVA_DIALECT
    }

    /// [`view.openFile("src/Main.java");`](self::open_file_statement), with the window as the second
    /// and third arguments of an **overload** and a semicolon at the end.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// [A `List.of(…)` of names and an enhanced `for` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }

    /// [Two `List.of(…)`s and two enhanced `for` loops](self::bootstrap_program), with both calls
    /// resolved from this language's own catalogue and the filters built with the SDK's own builder.
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String {
        bootstrap_program(
            &spell(self, DOCS_SEARCH),
            &spell(self, VIEWS_OPEN_DOCS_VIEW),
            modules,
            docs,
        )
    }

    /// A class body with one `public static` method returning `name` — because this is the one arm
    /// whose module shape is not its program shape.
    ///
    /// A program here is a sequence of statements and a module is a **class body**, so the seam's
    /// default subject (this language's generated documentation program) is a module that declares
    /// no method at all and is refused by name. The `name` rides in as a returned **string literal**,
    /// where neither javac's constant folding nor TeaVM's reachability pruning can drop it: it is
    /// the value the module's one export hands back.
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

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`.
///
/// camelCase because that is what Java spells a name in and what this SDK spells every other bound
/// function in, so a program reaching `lib.text("csvTools", "parse", …)` reads like the rest of its
/// own scope. Any separator — `-`, `_`, `.`, or anything a name should not have had — joins the next
/// word rather than surviving; a name that is nothing but separators becomes `module`, and a leading
/// digit is prefixed.
///
/// The result is held to being a valid Java **identifier** even though this arm reaches a module by
/// *string* — `lib.text(key, name, …)` rather than a field access, because a code module is compiled
/// separately and there is no `import` for javac to check a program against. The key is still quoted
/// back to the model in the reply that binds it and typed out in every program that uses it, so a
/// key a Java author could not have written is a key a model will get wrong; and if this arm ever
/// gains a generated accessor, the name is already one javac would accept.
///
/// Deliberately ASCII-only, though Java identifiers may be Unicode, for the same reason: a name a
/// model has to reproduce exactly is one that should have no characters it could get wrong.
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
    if out.starts_with(|ch: char| ch.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

/// `view.openFile("src/Main.java");`, or `view.openFile("src/Main.java", 400, 200);` for a window —
/// with `view.openFile` already spelled by the language that asked.
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

/// A `List.of(…)` of names and an enhanced `for` over it, each iteration opening one documentation
/// view.
///
/// A list and a loop rather than one statement per name because the list is as long as the family —
/// eleven calls written out would be a program a model reads as a style to copy.
///
/// `List.of` rather than an array literal because it is what a Java author writes today, and it
/// needs no import: `java.util.*` is in the header gg writes. The empty case is `List.of()`, whose
/// element type comes from the declaration's own `List<String>` — an array literal would have needed
/// a cast there.
///
/// The names are rendered through [`serde_json`] for the reason a path is: a name carrying a quote
/// would otherwise produce a program that does not parse.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    let entries: Vec<String> = names
        .iter()
        .map(|name| format!("    {}", serde_json::Value::String((*name).to_string())))
        .collect();
    let listed = match entries.is_empty() {
        true => String::new(),
        false => format!("\n{}\n", entries.join(",\n")),
    };
    format!(
        "List<String> functions = List.of({listed});\n\
         for (String name : functions) {{\n    \
             {open_docs_view}(name);\n\
         }}\n"
    )
}

/// The opening turn: one `List.of(…)` of module paths listed in full, then one of the names opened
/// as documentation views, each with an enhanced `for` over it.
///
/// Two lists and two loops rather than one call per entry, because a granted surface is a dozen
/// modules and a dozen calls written out is a shape a model would copy for its own work. `List.of`
/// needs no import of its own, exactly as it does not in
/// [`open_docs_views_statement`].
///
/// The filters are a **builder** — this language has neither default parameters nor keyword
/// arguments, so a call taking a bag of optional fields takes one of these, and the SDK declares it
/// nested inside the module the search belongs to.
///
/// A failed call throws an unchecked exception and nothing here catches it, which is this arm's
/// failure model: a bootstrap that caught its own failure would be a worked example of swallowing
/// one.
pub(super) fn bootstrap_program(
    search: &str,
    open_docs_view: &str,
    modules: &[&str],
    docs: &[&str],
) -> String {
    let listed = |names: &[&str]| -> String {
        let entries: Vec<String> = names
            .iter()
            .map(|name| format!("    {}", serde_json::Value::String((*name).to_string())))
            .collect();
        match entries.is_empty() {
            true => String::new(),
            false => format!("\n{}\n", entries.join(",\n")),
        }
    };
    let paths = listed(modules);
    let functions = listed(docs);
    let filters = format!("{}.SearchFilters", class_of(search));
    format!(
        "List<String> modules = List.of({paths});\n\
         for (String path : modules) {{\n    \
             {search}(\"\", new {filters}().module(path).limit({MAX_SEARCH_LIMIT}));\n\
         }}\n\
         \n\
         List<String> functions = List.of({functions});\n\
         for (String name : functions) {{\n    \
             {open_docs_view}(name);\n\
         }}\n"
    )
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
/// A separate test file from [`tests`], because these are a different kind of test: each one
/// compiles a 20 MB component and starts a JVM that loads TeaVM, which is seconds rather than
/// microseconds, where everything next door is a pure function over text.
#[cfg(test)]
#[path = "java.substrate.test.rs"]
mod substrate;

/// **The Java arm's model-facing surface**, driven the same way: the hand-written SDK, the
/// catalogue reflected out of its own Javadoc, and the libraries it says a program may reach.
///
/// Separate from [`substrate`] because it is a different claim. That file asks whether Java runs
/// here; this one asks whether the thing a model is *told* it may write is the thing the sandbox
/// really has — every gg tool driven through the real membrane from its Java spelling against the
/// same expected JSON the other arms are held to.
#[cfg(test)]
#[path = "java.surface.test.rs"]
mod surface;
