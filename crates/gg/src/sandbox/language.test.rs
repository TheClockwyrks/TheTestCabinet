//! The registry and the capability param that selects from it.
//!
//! Nothing here compiles a component: these are the questions the seam answers *before* a program
//! reaches a guest, and keeping them out of `sandbox.test.rs` keeps a per-process component compile
//! off tests that have no need of one.

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgCapabilityConfig, GgProgramLanguage,
};

use super::fixture::fixture_language;
use super::*;
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW};
use crate::validate::{LaunchDefect, LaunchReport};

/// The language `profile` resolves to, asserting gg honoured its configuration exactly as written.
fn language_of(profile: &GgAgentConfig) -> GgProgramLanguage {
    let mut report = LaunchReport::collecting();
    let language = resolve_program_language(profile, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    language
}

/// Everything resolving `profile` reports, for the cases whose subject is the refusal.
fn reported(profile: &GgAgentConfig) -> (GgProgramLanguage, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let language = resolve_program_language(profile, &mut report);
    (language, report.into_defects())
}

/// TypeScript, named explicitly wherever an assertion is about **TypeScript's** own answers rather
/// than about whichever language happens to be the default.
fn typescript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::TypeScript)
}

/// An agent profile whose responses-as-code capability carries `params`.
fn code_agent(enabled: bool, params: serde_json::Value) -> GgAgentConfig {
    let capability = if enabled {
        GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
    } else {
        GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
    };
    GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params,
            ..capability
        }],
        ..GgAgentConfig::root()
    }
}

/// **Every language the core enum names is registered**, and the registry is the enum's own list
/// walked in order.
///
/// This is what makes `all_languages()` safe to iterate as "everything gg can drive": it is derived
/// from [`GgProgramLanguage::ALL`], so there is no second list that could fall behind — and
/// [`language`] is an exhaustive match, so a variant with no implementation does not compile.
#[test]
fn the_registry_is_derived_from_the_core_enum() {
    let registered: Vec<GgProgramLanguage> =
        all_languages().map(|language| language.id()).collect();
    assert_eq!(registered, GgProgramLanguage::ALL.to_vec());

    for &id in GgProgramLanguage::ALL {
        let language = language(id);
        assert_eq!(language.id(), id, "a language must report its own id");
        assert_eq!(
            language.display_name(),
            id.display_name(),
            "the name the model is shown and the name the enum carries are one name"
        );
    }
}

/// **Every registered language's artifacts are present and its own.**
///
/// The catalogue is loaded (which panics on a corrupt artifact) and the component's bytes are
/// non-empty — the two things a language cannot run a single program without, and both of which are
/// generated files that a rename or a bad merge could quietly detach from the language that claims
/// them.
///
/// A language that [compiles a component per program](ProgramLanguage::guest_component) has no
/// prebuilt one, and that is not a hole here: it is required to answer `None` rather than empty
/// bytes, so "the artifact went missing" and "this arm has no artifact" stay different answers. Its
/// component is proved by its own substrate test, which compiles one and runs a program through it.
#[test]
fn every_registered_language_carries_its_artifacts() {
    for language in all_languages() {
        match language.guest_component() {
            Some(bytes) => assert!(
                !bytes.is_empty(),
                "{} claims a prebuilt guest component and carries no bytes",
                language.id()
            ),
            None => assert!(
                language.compiles_component(),
                "{} declares no prebuilt guest component and does not compile one either",
                language.id()
            ),
        }
        // Loaded through the projection every consumer reads rather than out of the raw document,
        // because what this asserts is that the artifact carries a surface at all — which is a
        // question about what an arm offers, not about how its JSON is laid out.
        assert!(
            !crate::sandbox::catalogue_functions(language).is_empty(),
            "{}'s catalogue documents no model-facing call at all",
            language.id()
        );
    }
}

/// **Every language names a spelling for a code skill's files, and writes exactly one of them.**
///
/// A skills directory is authored once and read by every agent in the run, so a skill's module has
/// one file name per language and each agent reads its own. A language that named none would be one
/// whose agents can never be handed a code skill at all — a capability silently absent on that arm
/// alone, which is the shape of gap a cross-language study cannot survive.
///
/// The [fixture](super::fixture) languages are held to it too, because the mechanism is only
/// exercised where two languages disagree about the spelling.
#[test]
fn every_language_names_the_files_a_code_skill_is_spelled_with() {
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let extensions = language.module_file_extensions();
        assert!(
            !extensions.is_empty(),
            "{} names no module file extension",
            language.display_name()
        );
        assert_eq!(
            language.module_file_extension(),
            extensions[0],
            "{}: the spelling it writes is not the first one it names",
            language.display_name()
        );
        for extension in extensions {
            assert!(
                !extension.is_empty()
                    && extension
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
                "{}: `{extension}` is not a bare lower-case file extension",
                language.display_name()
            );
        }
    }
}

/// **Every language writes the one program gg generates rather than quotes, in its own syntax and
/// with the call resolved from its own catalogue — and can read back what it wrote.**
///
/// It is the on-use script of every [built-in family skill](crate::skills::builtin), so a language
/// whose answer here was empty, or was another language's syntax, would be a language whose agents
/// read a skill and are shown nothing at all — a capability silently absent on one arm.
///
/// The last assertion is the load-bearing one: gg generates this source and hands it straight to the
/// prepare step, so a language that could not prepare its own output would fail on the first read of
/// a built-in skill, in a turn that has nothing to do with what the model wrote. Asserting the
/// spelling appears is not enough — a program can name the right function and still not parse.
///
/// The [fixture](super::fixture) is included and answers deliberately unlike TypeScript, which is
/// what makes "the program is written in the agent's own language" an assertion rather than a
/// promise: two languages here really do generate different programs.
#[test]
fn every_language_writes_the_program_that_opens_a_documentation_view() {
    const NAMES: [&str; 2] = ["readFile", "writeFile"];

    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let program = language.open_docs_views_statement(&NAMES);
        let call = spell(language, VIEWS_OPEN_DOCS_VIEW);
        assert!(
            program.contains(&call),
            "{}: the generated program does not call `{call}`:\n{program}",
            language.display_name()
        );
        for name in NAMES {
            assert!(
                program.contains(name),
                "{}: the generated program never names `{name}`:\n{program}",
                language.display_name()
            );
        }
        language
            .prepare_program(&program, &[], &PrepareContext::new())
            .unwrap_or_else(|failure| {
                panic!(
                    "{}: cannot prepare the program it generated ({failure}):\n{program}",
                    language.display_name()
                )
            });
    }

    assert_ne!(
        typescript().open_docs_views_statement(&NAMES),
        fixture_language().open_docs_views_statement(&NAMES),
        "two languages generating identical source would make this seam untested rather than \
         satisfied"
    );
}

/// **Every language writes the program that opens a session in its own syntax, covering every
/// module and every documentation key gg handed it — and can prepare what it wrote.**
///
/// This one is not a quotation gg could degrade: it is the agent's [opening
/// turn](crate::bootstrap), prepared and *run* before the first request, so a language whose program
/// did not prepare would fail every one of its agents' runs as an internal error rather than
/// producing a worse prompt. The same gate the generated documentation program gets, for the same
/// reason, plus the two things only this program can get wrong — a module gg listed and the program
/// never searched, and a search that took the default page instead of the whole module.
///
/// The [fixture](super::fixture) is included and answers deliberately unlike every registered arm,
/// which is what makes "the opening turn is written in the agent's own language" an assertion rather
/// than a promise.
#[test]
fn every_language_writes_the_program_that_opens_the_session() {
    const MODULES: [&str; 2] = ["gg.files", "gg.views"];
    const DOCS: [&str; 1] = ["gg.docs.search"];

    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let program = language.bootstrap_program(&MODULES, &DOCS);
        let search = spell(language, DOCS_SEARCH);
        let open_docs_view = spell(language, VIEWS_OPEN_DOCS_VIEW);
        for call in [&search, &open_docs_view] {
            assert!(
                program.contains(call.as_str()),
                "{}: the opening program does not call `{call}`:\n{program}",
                language.display_name()
            );
        }
        for name in MODULES.iter().chain(DOCS.iter()) {
            assert!(
                program.contains(name),
                "{}: the opening program never names `{name}`:\n{program}",
                language.display_name()
            );
        }
        // The whole-module lookup, which is the difference between an agent that is shown every
        // function it holds and one that is shown the first page of some of them.
        assert!(
            program.contains(&MAX_SEARCH_LIMIT.to_string()),
            "{}: the opening program does not ask for the whole of a module:\n{program}",
            language.display_name()
        );
        // The order the model reads: what was searched, then what was opened.
        assert!(
            program.find(&search) < program.find(&open_docs_view),
            "{}: the opening program opens a view before it searches:\n{program}",
            language.display_name()
        );
        language
            .prepare_program(&program, &[], &PrepareContext::new())
            .unwrap_or_else(|failure| {
                panic!(
                    "{}: cannot prepare the program it generated ({failure}):\n{program}",
                    language.display_name()
                )
            });
    }

    // Two implementations, written out, because containment cannot show that the syntax *around*
    // the two calls is each language's own: a trailing options object and a `for…of` here, keyword
    // arguments and one statement per module there.
    assert_eq!(
        typescript().bootstrap_program(&MODULES, &DOCS),
        format!(
            "import * as gg from \"gg\";\n\
             \n\
             const modules = [\n  \"gg.files\",\n  \"gg.views\",\n];\n\
             for (const path of modules) {{\n  \
             gg.docs.search(\"\", {{ module: path, limit: {MAX_SEARCH_LIMIT} }});\n}}\n\
             \n\
             const functions = [\n  \"gg.docs.search\",\n];\n\
             for (const name of functions) {{\n  gg.views.openDocsView(name);\n}}\n"
        )
    );
    assert_eq!(
        fixture_language().bootstrap_program(&MODULES, &DOCS),
        format!(
            "docs.search(\"\", module=\"gg.files\", limit={MAX_SEARCH_LIMIT})\n\
             docs.search(\"\", module=\"gg.views\", limit={MAX_SEARCH_LIMIT})\n\
             views.open_docs_view(\"gg.docs.search\")\n"
        )
    );
}

/// **What an arm's catalogue says about reaching a module is what gg's own program does about
/// reaching it** — the assertion that keeps *in scope already* honest.
///
/// # The claim this holds
///
/// A documentation view of every symbol tells a model how its program reaches that symbol, out of
/// [`ModuleView::import`](crate::sandbox::ModuleView): a line to write, or nothing to write because
/// this arm's SDK is in a program's scope before the model's code is compiled. The arms that have
/// not converted are in the second state, and the second state is a claim about **how that arm
/// delivers its SDK** — a prelude, a precompiled header, a re-exported import, a scope injection.
/// Nothing about the catalogue notices when that stops being true. The day an arm's SDK
/// has to be imported, every view on that arm quietly tells every model the opposite, and the model
/// pays with a compile error naming a symbol it was told it already had.
///
/// The one thing in gg that would notice is right here: the [opening turn](crate::bootstrap) is a
/// program **gg writes and the arm compiles**, in that arm's own syntax, before the model's first
/// request. So it is the arm's own demonstration of what a program has to do to call `docs.search`
/// and `views.openDocsView`, and the catalogue has to agree with it:
///
/// * a module that states a line is reached in the program by the route [`PATH_ROUTE`] records for
///   that arm: the line character for character, or the module's own
///   [path](crate::sandbox::ModuleDoc::path) written at the call site with no line at all;
/// * a module that states none has **no line in the program bringing it into scope**, which is what
///   "already there" means when a compiler is the one being told.
///
/// What fails the first half is the case worth catching: a program calling into a module by a
/// **short** name, with neither the line nor the path, which is an injection the catalogue denies.
///
/// The negative half looks for a scope-bringing statement that names *that module's path*, rather
/// than for import syntax in general, so a program that imports something else entirely — a
/// standard-library module, an effect type — is not what this fails on.
#[test]
fn an_arms_import_line_is_the_one_its_own_opening_program_writes() {
    const MODULES: [&str; 2] = ["gg.files", "gg.views"];
    const DOCS: [&str; 1] = ["gg.docs.search"];
    /// The keywords the eleven arms bring a module into scope with. A line is a scope-bringing
    /// statement when it opens with one of these *and* names the module, which is the pair that
    /// makes this precise enough to keep.
    const BRINGS_INTO_SCOPE: [&str; 5] = ["import ", "use ", "using ", "#include", "require "];
    /// **The arms whose opening program reaches a module by writing its path rather than its line.**
    ///
    /// A fact about the language, recorded per arm because a rule that accepted either route
    /// everywhere would assert nothing: every arm's call sites write the module's path, so
    /// "the line or the path" is satisfied by every program that calls anything at all, including
    /// one that had dropped its imports entirely.
    ///
    /// C#'s modules are `static class`es inside a namespace an assembly reference makes reachable
    /// in full, Rust's are modules of a crate `--extern` puts in the extern prelude, and the two JVM
    /// arms' are reached by their fully-qualified names off a jar on the classpath, so all four
    /// opening programs name them in full and write no line. Every other arm that states a line
    /// writes that line, and the table fails in both directions: an arm listed here that starts
    /// writing its line fails, and an arm not listed that stops writing one fails.
    const PATH_ROUTE: [GgProgramLanguage; 4] = [
        GgProgramLanguage::CSharp,
        GgProgramLanguage::Java,
        GgProgramLanguage::Kotlin,
        GgProgramLanguage::Rust,
    ];

    let mut lines_asserted = 0usize;
    for language in all_languages() {
        let name = language.display_name();
        let program = language.bootstrap_program(&MODULES, &DOCS);
        // The two modules the opening program actually calls into. Resolved through the operation
        // rather than by reading a path out of the call, because the operation is gg's identity for
        // a call and the module id is what the catalogue files it under.
        for operation in [DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW] {
            let function = crate::sandbox::catalogue_functions(language)
                .into_iter()
                .find(|function| {
                    crate::sandbox::operation_of(function)
                        .is_some_and(|declared| declared.id == operation)
                })
                .unwrap_or_else(|| {
                    panic!("{name}: its catalogue carries no call for `{operation:?}`")
                });
            let module = crate::sandbox::catalogue_modules(language)
                .into_iter()
                .find(|module| module.id == function.module)
                .unwrap_or_else(|| {
                    panic!(
                        "{name}: `{}` is filed under the module `{}`, which its catalogue does not \
                         declare",
                        function.fqn, function.module
                    )
                });
            match module.import {
                Some(line) => {
                    match PATH_ROUTE.contains(&language.id()) {
                        true => {
                            assert!(
                                program.contains(module.path),
                                "{name}: `PATH_ROUTE` records that its opening program reaches a \
                                 module by writing its path, and this one does not name `{}` at \
                                 all:\n{program}",
                                module.path
                            );
                            assert!(
                                !program.contains(line),
                                "{name}: `PATH_ROUTE` records that its opening program writes no \
                                 line, and this one writes `{line}`; delete its row:\n{program}"
                            );
                        }
                        false => assert!(
                            program.contains(line),
                            "{name}: its catalogue says `{}` is reached with `{line}`, and the \
                             opening program gg writes for this arm calls into it without that \
                             line. One of the two is wrong, and the model is told the catalogue's \
                             answer:\n{program}",
                            module.path
                        ),
                    }
                    lines_asserted += 1;
                }
                None => {
                    let brought = program.lines().find(|line| {
                        let line = line.trim_start();
                        BRINGS_INTO_SCOPE
                            .iter()
                            .any(|keyword| line.starts_with(keyword))
                            && line.contains(module.path)
                    });
                    assert!(
                        brought.is_none(),
                        "{name}: its catalogue states no import line for `{}` — so every view of \
                         every symbol in it tells models the module is in scope already — and the \
                         opening program gg writes for this arm brings it into scope with \
                         `{}`:\n{program}",
                        module.path,
                        brought.unwrap_or_default().trim()
                    );
                }
            }
        }
    }

    assert!(
        lines_asserted > 0,
        "no arm's opening program was checked against a declared import line, so the half of this \
         gate that holds a stated line to being the real one never ran"
    );
}

/// **Every language says how a program reaches the code a skill or memory loaded**, in a form that
/// arm's own compiler would accept.
///
/// This is the one fact about the surface an arm's own catalogue cannot state: a loaded module binds
/// no catalogued function, so the [documentation view](crate::docs) a use of the module opens is the
/// only place a model is told, and that view's lines are built from here. A form quoted in a syntax
/// the arm does not have is a binding the model has not been given.
///
/// Two halves, and the first is what every arm — the fixture included — owes whatever its module
/// system is:
///
/// * the [access](ProgramLanguage::lib_access) names the key and leaves the placeholder for a name;
/// * an arm that states an [import line](ProgramLanguage::lib_import) states **one** line, and that
///   line either names the key or is the same for every key. A line that changes with the key and
///   does not say the key is a line that brings in some other module.
///
/// The second half is the exact text, arm by arm. A module is supplied the way each arm supplies its
/// own SDK, so these are that arm's own module system spoken out loud — an `import`, a `using`, a
/// `require`, or nothing at all where the supply is already the program's prelude — and a change to
/// one is a change to what every model on that arm is told to write. Pinned rather than derived,
/// because a derivation would be the implementation restating itself, and pinned for **every**
/// registered arm, so that a new arm cannot be registered without saying its line.
#[test]
fn every_language_says_how_a_bound_module_is_reached() {
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let access = language.lib_access("csvTools");
        for part in ["csvTools", "<name>"] {
            assert!(
                access.to_lowercase().contains(&part.to_lowercase()),
                "{}: `{access}` does not name `{part}`",
                language.display_name()
            );
        }
        let Some(line) = language.lib_import("csvTools") else {
            continue;
        };
        assert!(
            !line.trim().is_empty() && !line.contains('\n'),
            "{}: `{line}` is not one line a program writes",
            language.display_name()
        );
        assert!(
            language.lib_import("otherThing").as_deref() == Some(line.as_str())
                || line.to_lowercase().contains("csvtools"),
            "{}: `{line}` changes with the key and does not name it, so it brings in some other \
             module",
            language.display_name()
        );
    }

    // The exact text, for every registered arm. `None` is an answer and is pinned like any other:
    // Rust's module arrives on `--extern`, so the crate is in the program's own extern prelude and
    // there is no line above the call.
    let pinned: &[(GgProgramLanguage, Option<&str>, &str)] = &[
        (
            GgProgramLanguage::TypeScript,
            Some("import * as csvTools from \"lib:csvTools\";"),
            "csvTools.<name>",
        ),
        (
            GgProgramLanguage::JavaScript,
            Some("import * as csvTools from \"lib:csvTools\";"),
            "csvTools.<name>",
        ),
        (
            GgProgramLanguage::Python,
            Some("import lib"),
            "lib.csvTools.<name>",
        ),
        (
            GgProgramLanguage::Ruby,
            Some("require \"lib\""),
            "lib.csvTools.<name>",
        ),
        (
            GgProgramLanguage::PureScript,
            Some("import Lib.CsvTools as CsvTools"),
            "CsvTools.<name>",
        ),
        (
            GgProgramLanguage::Java,
            Some("import lib.csvTools;"),
            "lib.csvTools.<name>",
        ),
        (
            GgProgramLanguage::Kotlin,
            Some("import lib.csvTools.*"),
            "lib.csvTools.<name>",
        ),
        (GgProgramLanguage::Rust, None, "csvTools::<name>"),
        (
            GgProgramLanguage::Swift,
            Some("import csvTools"),
            "csvTools.<name>",
        ),
        (
            GgProgramLanguage::Cpp,
            Some("import lib.csvTools;"),
            "lib::csvTools::<name>",
        ),
        (
            GgProgramLanguage::CSharp,
            Some("using lib;"),
            "lib.csvTools.<name>",
        ),
    ];
    assert_eq!(
        pinned.len(),
        GgProgramLanguage::COUNT,
        "an arm is registered whose line to reach a loaded module nothing pins"
    );
    for (arm, import, access) in pinned {
        assert_eq!(
            language(*arm).lib_import("csvTools").as_deref(),
            *import,
            "{arm:?} states another line to reach a loaded module"
        );
        assert_eq!(
            language(*arm).lib_access("csvTools"),
            *access,
            "{arm:?} reaches a loaded module's export another way"
        );
    }
}

/// **Every arm spells one *named* export**, with the placeholder really gone.
///
/// [`lib_member`](ProgramLanguage::lib_member) is derived rather than declared, by substituting into
/// the [access template](ProgramLanguage::lib_access) — which makes the placeholder a contract
/// between the two, and an arm that spelled it any other way would hand a model a line reading
/// `lib.csvTools.<name>` and call it the call site. The sibling gate above cannot catch that: it
/// lowercases before it compares, so an arm writing `<NAME>` passes it and substitutes nothing.
///
/// So this asserts the substitution itself, on every arm: the export's name is in the line and the
/// placeholder is not.
#[test]
fn every_language_spells_one_named_export_with_the_placeholder_gone() {
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let member = language.lib_member("csvTools", "parseCsv");
        assert!(
            member.contains("parseCsv"),
            "{}: `{member}` does not name the export",
            language.display_name()
        );
        assert!(
            !member.contains(crate::sandbox::language::LIB_ACCESS_NAME),
            "{}: `{member}` still carries the placeholder, so nothing was substituted",
            language.display_name()
        );
        assert_eq!(
            member,
            language
                .lib_access("csvTools")
                .replace(crate::sandbox::language::LIB_ACCESS_NAME, "parseCsv"),
            "{}: the member spelling is the access template with a name in it",
            language.display_name()
        );
    }
}

/// **A code agent that names no language refuses the launch.** There is no default: gg drives no run
/// in a language nobody wrote down, because the language is the axis a cross-language study slices
/// on and one gg invented would be a difference between two arms that no document records.
///
/// An absent param and a `null` one are the same answer, since neither is a language named.
///
/// The line is the params table's, not this resolver's, because the sweep over that table notices
/// the same hole and an operator with one thing to fix is owed one line. So it carries no
/// vocabulary either: a list of the eleven ids is what corrects a name the operator *wrote* — see
/// [`an_unreadable_language_is_refused`] — and an absence has no name to correct.
#[test]
fn a_code_agent_that_names_no_language_is_refused() {
    for params in [json!({}), json!({ "language": null })] {
        let (_, defects) = reported(&code_agent(true, params.clone()));
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "responses-as-code.params.language",
            "{params}"
        );
        assert!(
            defects[0].found.is_empty(),
            "{params}: the defect is about a value's absence, so there is nothing to quote back"
        );
        assert_eq!(
            defects[0],
            crate::validate::missing_required_param(CAPABILITY_RESPONSES_AS_CODE, PARAM_LANGUAGE),
            "{params}: the sweep and the resolver have to produce the same line"
        );
    }
}

/// **An agent that writes no programs is not asked for a language.** The capability may be missing
/// altogether, or — which is what the editor writes onto every tool-calling agent it saves — present
/// and switched off with an empty params block. Neither is a document with a hole in it: both say
/// this agent is not a code agent, and an agent that answers no turn with a program has no language
/// to name.
#[test]
fn an_agent_without_the_capability_names_no_language() {
    for profile in [GgAgentConfig::root(), code_agent(false, json!({}))] {
        language_of(&profile);
    }
}

/// **A disabled capability's `language` is read like any other param.** It changes nothing about the
/// run — an agent without responses-as-code writes no programs, so the language it resolved to is
/// never asked for — and it is read anyway, on the rule the whole params table follows: a disabled
/// capability records the configuration the arm would have used, so the two arms of one comparison
/// stay symmetric, and a typo skipped because a switch happened to be off is a typo that surfaces on
/// the launch where it is flipped. `language` is the axis a cross-language study slices on, which
/// makes it the last param that should have been exempt.
///
/// What the switch does decide is whether the param may be left out — see
/// [`an_agent_without_the_capability_names_no_language`]. Written, it is read either way; unwritten,
/// it is only missing where the agent would have written programs in it.
#[test]
fn a_disabled_capabilitys_language_is_still_read() {
    assert_eq!(
        language_of(&code_agent(false, json!({ "language": "python" }))),
        GgProgramLanguage::Python
    );
    let mut report = crate::validate::LaunchReport::collecting();
    resolve_program_language(
        &code_agent(false, json!({ "language": "pythn" })),
        &mut report,
    );
    let defects = report.into_defects();
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.language");
}

/// **A language gg knows is honoured**, spelled exactly as the id is.
#[test]
fn a_named_language_is_honoured() {
    for &id in GgProgramLanguage::ALL {
        assert_eq!(
            language_of(&code_agent(true, json!({ "language": id.id() }))),
            id
        );
    }
}

/// **A `language` gg cannot read refuses the launch.**
///
/// Falling back silently would record the run under a language nobody chose, which is precisely the
/// axis a cross-language study slices on — so a wrong spelling, a wrong case, an empty string and a
/// value that is not a string at all are all one answer, and the answer is that the run does not
/// start.
#[test]
fn an_unreadable_language_is_refused() {
    for value in [
        json!({ "language": "brainfuck" }),
        json!({ "language": "TypeScript" }),
        json!({ "language": "" }),
        json!({ "language": 3 }),
        json!({ "language": ["typescript"] }),
    ] {
        let (_, defects) = reported(&code_agent(true, value.clone()));
        assert_eq!(defects.len(), 1, "{value} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "responses-as-code.params.language",
            "{value}"
        );
        assert!(
            defects[0].known.contains(&"typescript".to_string()),
            "{value}: a refusal offers the languages gg can drive"
        );
    }
}

/// A language written with stray whitespace around it is the language it names — the one liberty
/// taken with a vocabulary otherwise read literally, since whitespace is not part of what an
/// operator wrote.
#[test]
fn surrounding_whitespace_does_not_hide_a_language() {
    assert_eq!(
        language_of(&code_agent(true, json!({ "language": " python " }))),
        GgProgramLanguage::Python
    );
}

/// **Every model-facing call resolves in every registered language's catalogue.**
///
/// The table is read for two things. gg quotes the model's own surface in its own sentences — the
/// ending section of the system prompt, the context-pressure notice, the account of the message
/// kinds an agent receives — naming those calls by their [operation](crate::sandbox::OperationId), which carries the
/// language-independent *key* and no spelling at all, so [`spell`](crate::sandbox::spell) resolves
/// the spelling out of the language's own catalogue and there is no authored second copy to drift.
/// And the [membrane](crate::sandbox) records every call under the same pair, which is what a
/// console joins a bound function's count on.
///
/// What remains possible is an `OperationId` naming a key **no** catalogue carries — a key renamed on
/// one side of the guest build and not the other. Quoted, that degrades to the bare key and gg tells
/// a model to call something its scope does not bind; recorded, it produces a count that joins to no
/// row of the agent's own reported surface. So every call is resolved here, against every registered
/// language, and the resolution has to be a real function rather than the fallback.
#[test]
fn every_model_facing_call_resolves_in_every_language() {
    for language in all_languages() {
        let functions = crate::sandbox::catalogue_functions(language);
        for id in crate::sandbox::OPERATIONS
            .iter()
            .map(|operation| operation.id)
        {
            // Resolved through the operation, which is the identity both schemas answer: an arm
            // that groups its surface into modules carries gg's own key nowhere, and looking for it
            // there would report every one of gg's calls missing. The canonical binding is what gg
            // quotes, so an alias is skipped here exactly as `spell` skips it.
            let entry = functions
                .iter()
                .find(|function| {
                    function.alias_of.is_none()
                        && crate::sandbox::operation_of(function)
                            .is_some_and(|resolved| resolved.id == id)
                })
                .unwrap_or_else(|| {
                    panic!(
                        "{}: gg names `{id}`, which its catalogue does not carry",
                        language.id(),
                    )
                });
            // Both halves of the quoted spelling are the ARM's: the grouping a program writes
            // before the separator, and the name after it. The grouping is the module path, which
            // is the only form a program could compile.
            assert_eq!(
                crate::sandbox::spell(language, id),
                format!(
                    "{}{}{}",
                    entry.object,
                    language.member_separator(),
                    entry.name
                ),
                "{}: the quoted spelling is not the one the catalogue gives that key",
                language.id()
            );
        }
    }
}

/// **What the two ECMAScript arms share, and what they differ in today.**
///
/// An A/B across the pair measures the compiler only while the compiler is what differs, and every
/// other axis they could drift on is cheap to drift on: a catalogue regenerated from a pruned
/// source, a prompt edited on one side, a binding convention that changed on one. Each of those is
/// pinned here rather than left to the fact that both are generated today.
///
/// **The pair differs in the compiler and in nothing else**, which is what makes the A/B readable.
/// Both arms evaluate a module in the same guest, reach gg through the same import line, and are
/// generated from one set of declarations.
#[test]
fn the_javascript_arm_differs_from_typescript_only_in_the_check() {
    let ts = typescript();
    let js = language(GgProgramLanguage::JavaScript);

    // What differs by design, and is the whole reason for the pair.
    assert_eq!(ts.checker(), Some("tsc"));
    assert_eq!(js.checker(), None, "nothing judges a JavaScript program");
    assert!(ts.prepare_compiles());
    assert!(!js.prepare_compiles());

    // The guest, the import line and the module specifier: one artifact, one line, one scheme.
    assert_eq!(
        ts.guest_component().map(<[u8]>::len),
        js.guest_component().map(<[u8]>::len),
        "the pair runs on two guests, so a study across it measures the guest as well"
    );
    assert_eq!(ts.lib_import("csvTools"), js.lib_import("csvTools"));
    assert_eq!(
        ts.bootstrap_program(&["gg.docs"], &["gg.docs.search"]),
        js.bootstrap_program(&["gg.docs"], &["gg.docs.search"]),
        "gg synthesizes one opening program for the pair"
    );

    // The surface. Compared entry by entry rather than as whole catalogues, because the catalogues
    // differ in the one field that says whose they are — and rendered to text so that a signature,
    // an argument name and an argument's own description are all in the comparison.
    let surface = |language: &'static dyn ProgramLanguage| {
        crate::sandbox::catalogue_functions(language)
            .iter()
            .map(|function| {
                format!(
                    "{}.{} [{}] {} — {:?}",
                    function.object,
                    function.key,
                    function.name,
                    function.prose.rendered(),
                    function.signatures,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        surface(ts),
        surface(js),
        "the two arms show a model different signatures, so an A/B across them measures two things"
    );
    // Including the annotations, which is the point of keeping this catalogue typed: an unchecked
    // arm shown untyped signatures would differ from the checked one in how much it was told.
    assert!(
        crate::sandbox::catalogue_functions(js)
            .iter()
            .any(|function| function.signatures[0].signature.contains(": string")),
        "the JavaScript catalogue dropped its type annotations"
    );

    // The binding convention and the reading healing does.
    assert_eq!(ts.binding_name("csv-tools"), js.binding_name("csv-tools"));
    assert_eq!(
        ts.healing().program_fence_tags(),
        js.healing().program_fence_tags(),
    );

    // The one program that separates them: a call the SDK does not have is a compile error on the
    // checked arm and reaches the guest on the other, where the same text is what the engine
    // evaluates.
    const WRONG: &str = "import * as gg from \"gg\";\ngg.views.openText(1, 2);\n";
    assert!(
        matches!(
            ts.prepare_program(WRONG, &[], &PrepareContext::new()),
            Err(PrepareFailure::Program(PrepareError::Compile(_)))
        ),
        "TypeScript's compiler reads the program"
    );
    assert_eq!(
        js.prepare_program(WRONG, &[], &PrepareContext::new())
            .expect("nothing on the JavaScript arm reads the program before it runs")
            .source,
        WRONG,
        "and what it hands the guest is the reply, byte for byte"
    );
}

/// **The JavaScript arm names itself, and names no compiler.**
///
/// The two facts the one system prompt renders a language from, and the two an arm cut from another
/// arm is most likely to inherit: a JavaScript agent told it is writing TypeScript would have been
/// handed the wrong language outright, and one told its program is judged by `tsc` would be promised
/// a check that never runs.
#[test]
fn the_javascript_arm_names_itself_and_no_compiler() {
    let js = language(GgProgramLanguage::JavaScript);
    assert_eq!(js.display_name(), "JavaScript");
    assert_eq!(js.checker(), None);
}

// ---------------------------------------------------------------------------------------------
// The seam has more than one implementation
// ---------------------------------------------------------------------------------------------
//
// Everything below is about the [fixture language](super::fixture) — a second implementation of
// `ProgramLanguage` that exists only under `#[cfg(test)]`. Its whole purpose is to make the
// properties this module claims *falsifiable*: with one implementation, "the consumer asks the
// language" and "the consumer knows TypeScript's answer" are the same observation.
//
// A registry with two entries in it did not change that, because the second entry is TypeScript's
// own arm with the type check removed — it gives TypeScript's answer to every question here by
// design. The one property below that genuinely has a registered pair to test is the artifact
// rule, which is why that test walks both and the fixture.

/// **The registry is the registered set, and nothing else.**
///
/// The fixture is a `ProgramLanguage` in every respect except the one that matters here: it is not
/// reachable from [`language`] or [`all_languages`]. So no production reader can be handed a
/// language an operator could not have configured, and no gate that iterates the registry pays for a
/// surface gg does not ship.
#[test]
fn the_registry_offers_only_registered_languages() {
    let registered: Vec<&'static str> = all_languages()
        .map(|language| language.display_name())
        .collect();
    assert!(
        !registered.contains(&fixture_language().display_name()),
        "the fixture language reached the registry: {registered:?}"
    );
    assert_eq!(registered.len(), GgProgramLanguage::ALL.len());
}

/// **The fixture has no wire id, and says so loudly.**
///
/// A [`GgProgramLanguage`] is a value an operator configures, a run records and a study slices by; a
/// fixture that had one would be a fixture that could be *run*. The panic is the assertion, not a
/// gap: it is what guarantees the fixture never reaches the one production path that keys on the
/// wire id — the [component cache](crate::sandbox::engine), which would otherwise quietly hand it
/// TypeScript's compiled component out of TypeScript's slot.
#[test]
#[should_panic(expected = "no wire id")]
fn the_fixture_language_has_no_wire_id() {
    let _ = fixture_language().id();
}

/// The pairs of registered languages that **deliberately** share one artifact, and why.
///
/// The rule below is that a language is handed its own artifacts and never another's, because the
/// shape every one of them was in before the seam was a `static` of TypeScript's that a second
/// language would have silently inherited. This table is the one carve-out, written down rather
/// than left as a property nobody notices is no longer true.
///
/// A pair listed here is held to something *stronger* than the rule, not weaker: the sharing must be
/// real (the same bytes, not two files that happen to agree today), and everything a language owns
/// beyond the shared artifact must still be its own.
const SHARED_ARTIFACTS: &[(GgProgramLanguage, GgProgramLanguage, &str)] = &[
    (
        GgProgramLanguage::TypeScript,
        GgProgramLanguage::JavaScript,
        "the pair is one language with the type check varied, so both arms evaluate a module in \
         the ECMAScript guest and reach it through one constant. A second copy of that artifact is \
         1.2 MB in every released binary for bytes that must not differ: an arm whose guest \
         resolved `gg` differently, or reported a frame differently, would make the pair's A/B \
         measure the guest as well as the compiler",
    ),
    (
        GgProgramLanguage::TypeScript,
        GgProgramLanguage::PureScript,
        "PureScript compiles to JavaScript on the host, so what it hands the guest is an ES module \
         the ECMAScript guest declares exactly as it declares this one's emission — down to the \
         `gg` its SDK imports and the source map its frames are read back through. A guest of its \
         own would be a second copy of one artifact and a second engine under a study that varies \
         the source language rather than the runtime",
    ),
    (
        GgProgramLanguage::JavaScript,
        GgProgramLanguage::PureScript,
        "the same artifact, for the same reason: three arms compile to JavaScript and one guest \
         evaluates it",
    ),
];

/// Why `a` and `b` are allowed to share a component, or `None` if they are not.
fn shared_artifacts(a: GgProgramLanguage, b: GgProgramLanguage) -> Option<&'static str> {
    SHARED_ARTIFACTS
        .iter()
        .find(|(left, right, _)| (*left, *right) == (a, b) || (*left, *right) == (b, a))
        .map(|(_, _, why)| *why)
}

/// **No language serves another language's artifacts**, except where the seam says so out loud.
///
/// Three artifacts, each of which a consumer reaches through the trait object it was handed: the
/// embedded component, the catalogue's spellings, and the healing dialect. A consumer that had kept
/// a `static` of TypeScript's — the shape every one of these was in before the seam — would return
/// the same value for both languages here.
///
/// The rule is asserted over **every pair of registered languages** as well as against the fixture,
/// because a registry with two real languages in it is the first tree where "one of them quietly
/// serves the other's component" is a thing that can happen without a fixture to catch it. The one
/// pair that does share is [declared](SHARED_ARTIFACTS) with its reason, and is held to the sharing
/// being deliberate: the bytes must actually be identical, or the exemption is covering for
/// something else.
#[test]
fn no_language_serves_another_languages_artifacts() {
    let registered: Vec<&'static dyn ProgramLanguage> = all_languages().collect();
    for (index, mine) in registered.iter().enumerate() {
        for theirs in &registered[index + 1..] {
            let why = shared_artifacts(mine.id(), theirs.id());
            // Two arms that each compile their own component both answer `None` here, and that is
            // the **absence** of an artifact rather than a shared one: neither has bytes for the
            // other to be serving, and every program of either is its own component. Rust and Swift
            // are that pair. Comparing their answers would fail the rule by satisfying its letter.
            let both_compile = mine.compiles_component() && theirs.compiles_component();
            match why {
                Some(why) => {
                    assert!(
                        !both_compile,
                        "{} and {} are declared to share a component ({why}) and neither commits \
                         one, so the exemption is covering for something else",
                        mine.id(),
                        theirs.id(),
                    );
                    assert_eq!(
                        mine.guest_component(),
                        theirs.guest_component(),
                        "{} and {} are declared to share a component ({why}), and do not",
                        mine.id(),
                        theirs.id(),
                    );
                }
                None if both_compile => {}
                None => assert_ne!(
                    mine.guest_component(),
                    theirs.guest_component(),
                    "{} and {} were handed the same component bytes, and nothing in \
                     `SHARED_ARTIFACTS` says they may be",
                    mine.id(),
                    theirs.id(),
                ),
            }
            // Whatever an exemption covers, it never covers these: a language that answered another
            // language's id or another language's name would be a language an operator configured
            // and did not get. The prompt is no longer among them — one template serves every arm,
            // and what makes an arm's render its own is the segment gated on the id asserted here.
            assert_ne!(mine.id(), theirs.id());
            assert_ne!(mine.display_name(), theirs.display_name());
        }
    }

    let ts = typescript();
    let fixture = fixture_language();

    assert_ne!(
        ts.guest_component(),
        fixture.guest_component(),
        "both languages were handed the same component bytes"
    );
    assert_ne!(
        ts.display_name(),
        fixture.display_name(),
        "both languages report the same name"
    );

    // Resolved through the projection rather than out of the raw document, because the question
    // here is only whose *spelling* of one call came back.
    let spelling = |language: &'static dyn ProgramLanguage| {
        crate::sandbox::catalogue_functions(language)
            .into_iter()
            .find(|function| function.key == "read_file" && function.alias_of.is_none())
            .map(|function| function.name.to_string())
            .expect("`read_file` is catalogued")
    };
    assert_eq!(spelling(ts), "readFile");
    assert_eq!(spelling(fixture), "read_file");

    assert_ne!(
        crate::sandbox::spell(ts, crate::sandbox::SESSION_REQUEST_CHANGES),
        crate::sandbox::spell(fixture, crate::sandbox::SESSION_REQUEST_CHANGES),
    );

    assert_ne!(
        ts.healing().program_fence_tags(),
        fixture.healing().program_fence_tags(),
        "both languages recognise the same fenced blocks as their program"
    );
}

/// **Every model-facing call resolves against the *fixture's* catalogue too**, in the fixture's own
/// spellings.
///
/// The registry's own version of this is next door; running it over a second surface is what proves
/// the resolution reads the language it was handed rather than whichever catalogue is nearest to
/// hand. The fixture re-spells every function in `snake_case`, so a resolution that had quietly
/// fallen back to the arm the fixture is cut from would produce `requestChanges` here and fail.
#[test]
fn the_fixture_quotes_only_functions_its_own_catalogue_carries() {
    let fixture = fixture_language();
    let functions = crate::sandbox::catalogue_functions(fixture);
    for id in crate::sandbox::OPERATIONS
        .iter()
        .map(|operation| operation.id)
    {
        // Resolved through the operation and quoted with the entry's OWN grouping, because the
        // fixture's grouping is deliberately not gg's: it renames one module, invents another, and
        // hangs two calls off the types they operate on. Going through the operation is what makes
        // this a lookup rather than a guess at where the arm filed the call.
        let entry = functions.iter().find(|function| {
            function.alias_of.is_none()
                && crate::sandbox::operation_of(function).is_some_and(|resolved| resolved.id == id)
        });
        let qualified = crate::sandbox::spell(fixture, id);
        assert_eq!(
            Some(qualified.as_str()),
            entry
                .map(|entry| format!(
                    "{}{}{}",
                    entry.object,
                    fixture.member_separator(),
                    entry.name
                ))
                .as_deref(),
            "the fixture quotes `{qualified}`, which its catalogue does not carry"
        );
    }
}

/// **The statement gg synthesizes into an agent's transcript is written in that agent's language.**
///
/// Autoload and [agent persistence](crate::persistence) both push an *assistant* turn the agent did
/// not send: a program that opens the views gg is seeding on its behalf. The model reads its own
/// transcript as the example of what a well-formed turn looks like, so that program has to be one it
/// could have written — which means the call's spelling, the idiom for the optional window, and the
/// statement terminator are all the language's.
///
/// Asserted across two implementations that differ in all three, because one implementation's output
/// proves nothing about whose syntax it is.
#[test]
fn the_synthesized_file_view_statement_is_the_languages_own() {
    let window = crate::sandbox::FileWindow {
        offset: 400,
        limit: 200,
    };

    assert_eq!(
        typescript().open_file_statement("src/main.ts", None),
        "import * as gg from \"gg\";\n\ngg.views.openFile(\"src/main.ts\");\n"
    );
    assert_eq!(
        typescript().open_file_statement("src/main.ts", Some(window)),
        "import * as gg from \"gg\";\n\ngg.views.openFile(\"src/main.ts\", { offset: 400, limit: \
         200 });\n"
    );

    let fixture = fixture_language();
    assert_eq!(
        fixture.open_file_statement("src/main.fx", None),
        r#"views.open_file("src/main.fx")"#
    );
    assert_eq!(
        fixture.open_file_statement("src/main.fx", Some(window)),
        r#"views.open_file("src/main.fx", offset=400, limit=200)"#
    );

    // A path is rendered so that a quote or a backslash in one cannot produce a statement that
    // would not parse — a property every language owes, whatever its escaping rules.
    for language in all_languages() {
        let statement = language.open_file_statement("a\"b\\c.txt", None);
        assert!(
            !statement.contains("a\"b\\c.txt"),
            "{}: the raw path reached the statement unescaped: {statement}",
            language.id()
        );
    }
}

/// **The `lib.<key>` a code skill or memory binds at is the language's own identifier convention.**
///
/// The key is a property a program *spells out*, so it has to be an identifier that language will
/// parse — and which identifier is a convention rather than a rule. TypeScript camelCases it because
/// that is what its SDK spells everything else in; the fixture lower-snakes it.
#[test]
fn the_module_binding_name_is_the_languages_own() {
    assert_eq!(typescript().binding_name("csv-tools"), "csvTools");
    assert_eq!(typescript().binding_name("my_helpers.v2"), "myHelpersV2");
    assert_eq!(typescript().binding_name("9lives"), "_9lives");
    assert_eq!(fixture_language().binding_name("csv-tools"), "csv_tools");

    // Whatever the convention, a name with nothing usable in it still has to yield something a
    // program can write, because the key is quoted back to the model in the reply that binds it.
    for language in all_languages() {
        assert!(
            !language.binding_name("---").is_empty(),
            "{}",
            language.id()
        );
    }
}

/// **Preparing a program is the language's own work**, not a step the sandbox performs and then asks
/// a language about.
///
/// The two implementations are asked the same two questions and give opposite answers to both: a
/// type annotation is erased by one and passed through untouched by the other, and a `#` comment
/// prepares cleanly in one and is a syntax error in the other. Neither could hold if
/// `prepare_program` were TypeScript's with a parameter.
#[test]
fn preparing_a_program_is_the_languages_own() {
    let annotated = "const total: number = 1;";
    let stripped = typescript()
        .prepare_program(annotated, &[], &PrepareContext::new())
        .expect("TypeScript prepares its own source");
    assert!(
        !stripped.source.contains(": number"),
        "TypeScript erases the annotation: {}",
        stripped.source
    );
    let fixture = fixture_language()
        .prepare_program(annotated, &[], &PrepareContext::new())
        .expect("the fixture has no types to erase");
    assert!(
        fixture.source.contains(": number"),
        "the fixture passes it through: {}",
        fixture.source
    );

    let commented = "total = 1 # the answer\n";
    assert!(
        matches!(
            typescript().prepare_program(commented, &[], &PrepareContext::new()),
            Err(PrepareFailure::Program(PrepareError::Compile(_)))
        ),
        "`#` is not TypeScript"
    );
    assert_eq!(
        fixture_language()
            .prepare_program(commented, &[], &PrepareContext::new())
            .expect("`#` is the fixture's comment")
            .source,
        "total = 1\n"
    );

    // And each refuses what its own guest cannot resolve, in its own syntax. TypeScript's refusal is
    // the compiler's, because a specifier is something a compiler resolves.
    assert!(matches!(
        typescript().prepare_program("import fs from \"fs\";\n", &[], &PrepareContext::new()),
        Err(PrepareFailure::Program(PrepareError::Compile(_)))
    ));
    assert!(matches!(
        fixture_language().prepare_program("use tools\n", &[], &PrepareContext::new()),
        Err(PrepareFailure::Program(PrepareError::Unsupported(_)))
    ));
}

/// **Preparing a module is the language's own work too** — the namespace a code
/// [skill](crate::skills) or [memory](crate::memories) is bound from comes from the language's own
/// reading of its own export syntax.
#[test]
fn preparing_a_module_is_the_languages_own() {
    let module = typescript()
        .prepare_module("export const total = 1;\n", &PrepareContext::new())
        .expect("TypeScript reads its own exports");
    assert_eq!(export_names(&module.exports), vec!["total".to_string()]);

    let fixture = fixture_language()
        .prepare_module("def total\n  x = 1\n", &PrepareContext::new())
        .expect("the fixture reads its own exports");
    assert_eq!(export_names(&fixture.exports), vec!["total".to_string()]);

    // Neither language finds the other's exports, because neither is looking for them.
    assert!(
        fixture_language()
            .prepare_module("export const total = 1;\n", &PrepareContext::new())
            .expect("the fixture prepares it as ordinary source")
            .exports
            .is_empty()
    );
}
