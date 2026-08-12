//! **Kotlin** — the arm whose program is a **script**, compiled by a warm JVM to bytecode and then
//! to JavaScript by TeaVM before the guest ever sees it.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`] — the host-side build, what it costs, what it shares, and the two failures it
//!   tells apart;
//! * [`source`] — what gg does to a model's Kotlin before the compiler sees it, which for a program
//!   is almost nothing;
//! * [`healing`] — the [dialect](crate::healing::Dialect) response healing asks its lexical
//!   questions of: the fence tags, the two predicates and the template-aware lexer — the two
//!   predicates both answering differently from [Java's](super::java::healing), on the arm that
//!   shares a compiler with it;
//! * [`PROMPT`] — the responses-as-code system prompt and the "nothing shown" notice, both written
//!   in Kotlin's syntax;
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
//! It rides [the JVM road](super::jvm) the [Java](super::java) arm built: the same JDK, the same
//! TeaVM jars, the same two mandatory TeaVM settings, the same reading of TeaVM's source map, and
//! the same shared ECMAScript guest — which the seam's "no language is served another's artifacts"
//! rule names as a declared share rather than inferring from a passing test. That is the whole
//! reason this arm is cheap: everything from **bytecode onwards** already existed.
//!
//! What is its own is everything in front of the bytecode:
//!
//! | | |
//! | --- | --- |
//! | The compiler | `K2JVMCompiler`, embedded in the daemon rather than spawned, because it is ~1.7–9 s cold and 0.14–0.4 s warm and `kotlinc` has no daemon to ask |
//! | What a program **is** | a Kotlin **script**, not a wrapped function body — the one decision on this arm that had to be measured rather than copied |
//! | What a diagnostic in a *library* file means | the model's problem, not gg's, which is the opposite of the Java arm's answer and follows from Kotlin reaching the classlib through a standard library of its own |
//! | What a program may reach | the Kotlin standard library, by construction: the driver runs with a 60 MB compiler on its classpath and a program is compiled against two jars of it |
//!
//! # Why a program is a script
//!
//! Because the obvious shape does not work in this language, and that was found by building it. A
//! reply wrapped in the body of a function gg declares — [Java's](super::java::source) shape — puts
//! every declaration the model wrote in a *local* position, and Kotlin refuses five things there
//! that a Kotlin author writes without thinking: `object`, `interface` (and therefore `sealed
//! interface`), `enum class`, `typealias` and `private fun`. [`source`] has the measured table. In
//! a script they are all legal, statements and declarations sit side by side in whatever order the
//! model wrote them, and a reply with no `import` in it is compiled **byte for byte** — which no
//! other arm can say.
//!
//! # What this arm has that no other does
//!
//! Its **program and its module are compiled in different shapes and against different classpaths** —
//! a script against the standard library, a module as an ordinary file against that plus the one
//! annotation gg writes into it. [Java](super::java) is the only other arm whose two preparation
//! shapes differ at all, and it is why the seam's
//! isolation gate (`language/isolation.rs`) lets a language answer with a module of its own shape.
//!
//! And its **SDK is declared in the root package**, which is what no other arm's could be. Kotlin
//! forbids importing from the root package into a named one and resolves a name in the *same* package
//! with no import at all — and a model's program, having no `package` line, is itself in the root
//! one. So `fs.readFile("main.kt")` resolves with nothing written above it, and the substrate's
//! headline property survives the SDK: a reply with no `import` in it is still compiled byte for
//! byte, with a shift of zero. The bridge stays out of a program's reach all the same, and by a
//! stronger fence than a package would give it — every declaration in it is `internal`, which is
//! module visibility, and a program is its own module.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, PromptDialect, VIEW_OPEN_DOCS_VIEW, VIEW_OPEN_FILE, spell,
};

#[path = "kotlin.compile.rs"]
pub(super) mod compile;

#[path = "kotlin.source.rs"]
pub(super) mod source;

#[path = "kotlin.healing.rs"]
pub(super) mod healing;

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

/// Everything gg *says* about a Kotlin program that is written in Kotlin's own syntax.
///
/// The two templates are embedded from `crates/gg/templates/`, exactly as every other gg prompt is.
/// Individual function spellings are **not** here and not in the templates either: every name and
/// signature they quote is resolved from this language's catalogue when the template
/// renders.
static PROMPT: PromptDialect = PromptDialect {
    system_template: include_str!("../../../templates/system-code.kotlin.hbs"),
    system_template_name: "system-code.kotlin",
    nothing_shown_template: include_str!("../../../templates/code-nothing-shown.kotlin.hbs"),
    nothing_shown_template_name: "code-nothing-shown.kotlin",
};

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static KOTLIN: Kotlin = Kotlin;

/// Kotlin: compiled as a script to bytecode by the Kotlin compiler and then to JavaScript by TeaVM,
/// inside a warm JVM, and evaluated by the ECMAScript guest.
pub(super) struct Kotlin;

impl ProgramLanguage for Kotlin {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::Kotlin
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::Kotlin.display_name()
    }

    /// The import hoist, the Kotlin compile and the TeaVM translation, in this preparation's own
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

    /// The same two compilers a program gets, pointed at an ordinary Kotlin **file** rather than a
    /// script — and the names the resulting namespace offers.
    ///
    /// The names are read from the model's own source by [`source`]'s export scan rather than out
    /// of the compiled bundle, because they are what the skill's author is *told* the namespace
    /// holds.
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        let (source, exports) = compile::compile_module(source, context)?;
        Ok(PreparedModule { source, exports })
    }

    /// `.kt`, and nothing else.
    ///
    /// One extension, like [Java](super::java)'s and [Ruby](super::ruby)'s: nothing else in the
    /// registry can compile a Kotlin module. `.kts` is deliberately **not** a second spelling even
    /// though a *program* on this arm is a script — a code module is compiled as an ordinary file,
    /// because what `lib.<key>` binds is a namespace of functions and a script's declarations are
    /// members of an instance that would have to be constructed first. Offering `skill.kts` would
    /// name a shape this arm does not compile.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["kt"]
    }

    /// [camelCase](self::binding_name) — Kotlin's own convention for a name a program writes, and
    /// this SDK's for everything else.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }

    /// The ECMAScript guest, which is [TypeScript](super::typescript)'s.
    ///
    /// A declared share rather than an accident, and the same one [Java](super::java) makes for the
    /// reason that arm's documentation gives: TeaVM has no runtime object two programs could share,
    /// so a component of this arm's own would carry nothing.
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
                GgProgramLanguage::Kotlin,
                "`signatures/kotlin.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &healing::KOTLIN_DIALECT
    }

    fn prompt(&self) -> &'static PromptDialect {
        &PROMPT
    }

    /// [`view.openFile("src/Main.kt")`](self::open_file_statement), with the window as two
    /// **named** arguments and no terminator.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEW_OPEN_FILE), path, window)
    }

    /// [A `listOf(…)` of names and a `for` over it](self::open_docs_views_statement), each iteration
    /// opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEW_OPEN_DOCS_VIEW), names)
    }

    /// One public top-level function returning `name` — because this is the second arm whose module
    /// shape is not its program shape.
    ///
    /// A program here is a script and a module is an ordinary file whose **public top-level
    /// functions** are its namespace, so the seam's default subject (this language's generated
    /// documentation program) is a module that declares no function at all and is refused by name.
    /// The `name` rides in as a returned **string literal**, where neither the Kotlin compiler's
    /// constant folding nor TeaVM's reachability pruning can drop it: it is the value the module's
    /// one export hands back.
    #[cfg(test)]
    fn isolation_module(&self, name: &str) -> String {
        format!(
            "fun marker(): String = {}\n",
            serde_json::Value::String(name.to_string())
        )
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`.
///
/// camelCase because that is what Kotlin spells a name in and what this SDK spells every other bound
/// function in, so a program reaching `lib.text("csvTools", "parse", …)` reads like the rest of its
/// own scope. Any separator — `-`, `_`, `.`, or anything a name should not have had — joins the next
/// word rather than surviving; a name that is nothing but separators becomes `module`, and a leading
/// digit is prefixed.
///
/// The result is held to being a valid Kotlin **identifier** even though this arm reaches a module by
/// *string* — `lib.text(key, name, …)` rather than a property access, because a code module is
/// compiled separately and there is no `import` for the compiler to check a program against. The key
/// is quoted back to the model in the reply that binds it and typed out in every program that uses
/// it, so a key a Kotlin author could not have written is a key a model will get wrong.
///
/// Deliberately ASCII-only, though Kotlin identifiers may be Unicode and may even be backquoted, for
/// the same reason: a name a model has to reproduce exactly is one that should have no characters it
/// could get wrong.
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

/// A `listOf(…)` of names and a `for` over it, each iteration opening one documentation view.
///
/// A list and a loop rather than one statement per name because the list is as long as the family —
/// eleven calls written out would be a program a model reads as a style to copy.
///
/// `listOf` needs no import — it is in `kotlin.collections`, which every Kotlin file imports by
/// default — and the empty case is `listOf<String>()`, whose element type has to be written out
/// because there is no declared type beside it to infer from.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    let entries: Vec<String> = names
        .iter()
        .map(|name| format!("    {}", serde_json::Value::String((*name).to_string())))
        .collect();
    let listed = match entries.is_empty() {
        true => "val functions = listOf<String>()\n".to_string(),
        false => format!("val functions = listOf(\n{}\n)\n", entries.join(",\n")),
    };
    format!(
        "{listed}\
         for (name in functions) {{\n    \
             {open_docs_view}(name)\n\
         }}\n"
    )
}

#[cfg(test)]
#[path = "kotlin.test.rs"]
mod tests;

/// **The Kotlin arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from [`tests`], because these are a different kind of test: each one
/// compiles the 13.4 MB shared ECMAScript guest and starts a JVM that loads the Kotlin compiler and
/// TeaVM, which is seconds rather than microseconds, where everything next door is a pure function
/// over text.
#[cfg(test)]
#[path = "kotlin.substrate.test.rs"]
mod substrate;

/// **The Kotlin arm's model-facing surface**, driven the same way: the hand-written SDK, the
/// catalogue reflected out of its own KDoc, and the libraries it says a program may reach.
///
/// Separate from [`substrate`] because it is a different claim. That file asks whether Kotlin runs
/// here; this one asks whether the thing a model is *told* it may write is the thing the sandbox
/// really has — every gg tool driven through the real membrane from its Kotlin spelling against the
/// same expected JSON the other arms are held to.
#[cfg(test)]
#[path = "kotlin.surface.test.rs"]
mod surface;
