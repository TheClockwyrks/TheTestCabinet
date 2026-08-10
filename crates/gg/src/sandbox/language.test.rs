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

/// **Every registered language's committed artifacts are present and its own.**
///
/// The catalogue is loaded (which panics on a corrupt artifact) and the component's bytes are
/// non-empty — the two things a language cannot run a single program without, and both of which are
/// committed files that a rename or a bad merge could quietly detach from the language that claims
/// them.
///
/// A language that [compiles a component per program](ProgramLanguage::guest_component) has no
/// committed one, and that is not a hole here: it is required to answer `None` rather than empty
/// bytes, so "the artifact went missing" and "this arm has no artifact" stay different answers. Its
/// component is proved by its own substrate test, which compiles one and runs a program through it.
#[test]
fn every_registered_language_carries_its_committed_artifacts() {
    for language in all_languages() {
        match language.guest_component() {
            Some(bytes) => assert!(
                !bytes.is_empty(),
                "{} claims a committed guest component and carries no bytes",
                language.id()
            ),
            None => assert!(
                language.compiles_component(),
                "{} committed no guest component and does not compile one either",
                language.id()
            ),
        }
        // The catalogue is loaded through the normalized projection rather than by reaching into a
        // section, because which section a call arrives in is exactly what the two schemas disagree
        // about — and what this asserts is that the artifact carries a surface at all, which is the
        // same question whichever shape it was written in.
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
        let call = spell(language, VIEW_OPEN_DOCS_VIEW);
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

/// **A run that names no language gets the default**, whether the capability is off, on with no
/// params, or on with a null one — and none of those is reported as an unreadable setting.
#[test]
fn an_unconfigured_agent_writes_the_default_language() {
    for profile in [
        GgAgentConfig::root(),
        code_agent(true, json!({})),
        code_agent(true, json!({ "language": null })),
        // A capability that is present but *disabled* configures nothing at all — not even a
        // complaint about the value it carries, which nothing is going to read.
        code_agent(false, json!({ "language": "brainfuck" })),
    ] {
        let resolved = resolve_program_language(&profile);
        assert_eq!(resolved.language, GgProgramLanguage::default());
        assert!(resolved.unknown_params.is_empty(), "{resolved:?}");
    }
}

/// **A language gg knows is honoured**, spelled exactly as the id is.
#[test]
fn a_named_language_is_honoured() {
    for &id in GgProgramLanguage::ALL {
        let resolved = resolve_program_language(&code_agent(true, json!({ "language": id.id() })));
        assert_eq!(resolved.language, id);
        assert!(resolved.unknown_params.is_empty());
    }
}

/// **A `language` gg cannot read changes nothing and is reported.**
///
/// Both halves matter, and the second is the one that is easy to lose: falling back silently would
/// record the run under a language nobody chose, which is precisely the axis a cross-language study
/// slices on. A wrong spelling, a wrong case, and a value that is not a string at all are all one
/// answer.
#[test]
fn an_unreadable_language_falls_back_and_says_so() {
    for value in [
        json!({ "language": "brainfuck" }),
        json!({ "language": "TypeScript" }),
        json!({ "language": 3 }),
        json!({ "language": ["typescript"] }),
    ] {
        let resolved = resolve_program_language(&code_agent(true, value.clone()));
        assert_eq!(
            resolved.language,
            GgProgramLanguage::default(),
            "{value} must change nothing"
        );
        assert_eq!(
            resolved.unknown_params,
            vec!["language".to_string()],
            "{value} must be reported"
        );
    }
}

/// **Every model-facing call resolves in every registered language's catalogue.**
///
/// The table is read for two things. gg quotes the model's own surface in its own sentences — the
/// ending section of the system prompt, the context-pressure notice, the account of the message
/// kinds an agent receives — naming those calls by [`SurfaceCall`], which carries the object and the
/// language-independent *key* and no spelling at all, so [`spell`](crate::sandbox::spell) resolves
/// the spelling out of the language's own catalogue and there is no authored second copy to drift.
/// And the [membrane](crate::sandbox) records every call under the same pair, which is what a
/// console joins a bound function's count on.
///
/// What remains possible is a `SurfaceCall` naming a key **no** catalogue carries — a key renamed on
/// one side of the guest build and not the other. Quoted, that degrades to the bare key and gg tells
/// a model to call something its scope does not bind; recorded, it produces a count that joins to no
/// row of the agent's own reported surface. So every call is resolved here, against every registered
/// language, and the resolution has to be a real function rather than the fallback.
#[test]
fn every_model_facing_call_resolves_in_every_language() {
    for language in all_languages() {
        let functions = crate::sandbox::catalogue_functions(language);
        for call in crate::sandbox::OPERATIONS
            .iter()
            .map(|operation| operation.call)
        {
            // Resolved through the operation, which is the identity both schemas answer: an arm
            // that groups its surface into modules carries gg's own `(object, key)` pair nowhere,
            // and looking for it there would report every one of gg's calls missing. The canonical
            // binding is what gg quotes, so an alias is skipped here exactly as `spell` skips it.
            let entry = functions
                .iter()
                .find(|function| {
                    function.alias_of.is_none()
                        && crate::sandbox::operation_of(function).is_some_and(|resolved| {
                            resolved.call.object == call.object && resolved.call.key == call.key
                        })
                })
                .unwrap_or_else(|| {
                    panic!(
                        "{}: gg names `{}.{}`, which its catalogue does not carry",
                        language.id(),
                        call.object,
                        call.key
                    )
                });
            // Both halves of the quoted spelling are the ARM's: the grouping a program writes
            // before the separator, and the name after it. On an arm whose surface is API objects
            // the grouping is gg's own word for it and nothing changes; on a converted arm it is
            // the module path, which is the only form a program could compile.
            assert_eq!(
                crate::sandbox::spell(language, call),
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

/// **Every language registers its own templates under its own id**, so two languages cannot collide
/// on one Handlebars name and silently render each other's prompt.
///
/// The names are authored rather than derived — a `&'static str` costs nothing and reads plainly at
/// the definition — so the convention they are supposed to follow is asserted here rather than
/// assumed.
#[test]
fn every_language_names_its_templates_after_itself() {
    for language in all_languages() {
        let prompt = language.prompt();
        assert_eq!(
            prompt.system_template_name,
            format!("system-code.{}", language.id()),
            "{}: the system template's registered name",
            language.id()
        );
        assert_eq!(
            prompt.nothing_shown_template_name,
            format!("code-nothing-shown.{}", language.id()),
            "{}: the nothing-shown template's registered name",
            language.id()
        );
        assert!(
            !prompt.system_template.trim().is_empty(),
            "{}: an empty system prompt",
            language.id()
        );
        assert!(
            !prompt.nothing_shown_template.trim().is_empty(),
            "{}: an empty nothing-shown notice",
            language.id()
        );
    }
}

/// **The JavaScript arm is the TypeScript arm with the check taken out, and with nothing else
/// taken out.**
///
/// This is the assertion that keeps the pair worth running. An A/B across two arms measures the
/// check only while the check is the *only* thing that differs, and every other axis they could
/// drift on is cheap to drift on: a catalogue regenerated from a pruned source, a prompt edited on
/// one side, a strip that gained a refusal on one arm. So each is pinned here rather than left to
/// the fact that both are generated today.
///
/// Four things must be equal — the surface a model is shown, down to its type annotations; the
/// evaluator; the binding convention; and the lexical reading healing does — and exactly two must
/// differ: which language the prompt says the model is writing, and whether a compiler is named.
#[test]
fn the_javascript_arm_differs_from_typescript_only_in_the_check() {
    let ts = typescript();
    let js = language(GgProgramLanguage::JavaScript);

    // What differs, and it is the whole of the arm.
    assert_eq!(ts.checker(), Some("tsc"));
    assert_eq!(js.checker(), None, "nothing judges a JavaScript program");
    assert!(ts.prepare_compiles());
    assert!(!js.prepare_compiles());

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

    // The evaluator, the binding convention, and the reading healing does.
    assert_eq!(ts.guest_component(), js.guest_component());
    assert_eq!(js.binding_name("csv-tools"), "csvTools");
    assert_eq!(
        ts.healing().program_fence_tags(),
        js.healing().program_fence_tags(),
    );

    // And a type annotation prepares on both, because "JavaScript" here is a program nothing
    // checked rather than a narrower grammar.
    for language in [ts, js] {
        let prepared = language
            .prepare_program("const total: number = 1;", &[], &PrepareContext::new())
            .unwrap_or_else(|err| panic!("{}: {err}", language.id()));
        assert!(!prepared.source.contains(": number"), "{}", language.id());
    }
    // The one program that separates them: a call the SDK does not have is a compile error on the
    // checked arm and reaches the guest on the other.
    let mistyped = "view.openText(1, 2);";
    assert!(
        matches!(
            ts.prepare_program(mistyped, &[], &PrepareContext::new()),
            Err(PrepareFailure::Program(PrepareError::Compile(_)))
        ),
        "TypeScript's checker reads the program"
    );
    assert!(
        js.prepare_program(mistyped, &[], &PrepareContext::new())
            .is_ok(),
        "nothing on the JavaScript arm reads the program before it runs"
    );
}

/// **The JavaScript arm's prompt names its own language and not the other's**, and says nothing
/// about a compiler.
///
/// Both halves are the arm. A prompt that still said "TypeScript program" would be a copied
/// template nobody re-read; one that kept the type-check section would tell a model its program is
/// judged by something that never runs, which is worse than saying nothing.
#[test]
fn the_javascript_prompt_is_its_own_and_claims_no_compiler() {
    let template = language(GgProgramLanguage::JavaScript)
        .prompt()
        .system_template;
    assert!(template.contains("JavaScript program"), "{template}");
    assert!(!template.contains("TypeScript"), "{template}");
    assert!(!template.contains("tsc"), "{template}");
    assert!(!template.contains("type-check"), "{template}");
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

/// The pairs of registered languages that **deliberately** share a committed artifact, and why.
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
        "the two arms differ in whether gg type-checks a program before handing it over, and in \
         nothing else — the same SDK, the same signatures, the same strip, one evaluator. A second, \
         byte-identical 13.4 MB component in the repository would be a second copy of one artifact, \
         with nothing to observe between them and a standing chance for the one thing the arms must \
         share to diverge",
    ),
    (
        GgProgramLanguage::TypeScript,
        GgProgramLanguage::PureScript,
        "a PureScript program is compiled to JavaScript by `purs` and flattened by `esbuild` before \
         it crosses, and what arrives is a self-contained script with no runtime to boot — `purs` \
         compiles the library code a program used into the program and the bundler tree-shakes the \
         rest away. So a component of its own would differ from this one in nothing at all, where \
         Ruby's differs in a 743 KB Opal runtime pre-initialised into it. Measured: 2.7 ms per turn \
         against 2.1 ms for the equivalent plain JavaScript on the same artifact",
    ),
    (
        GgProgramLanguage::JavaScript,
        GgProgramLanguage::PureScript,
        "the transitive half of the two entries above: JavaScript serves TypeScript's component and \
         so does PureScript, so this pair shares one by consequence rather than by a third decision",
    ),
    (
        GgProgramLanguage::TypeScript,
        GgProgramLanguage::Java,
        "a Java program is compiled to JavaScript by TeaVM before it crosses, and the alternative — \
         a component of Java's own, with the classlib pre-initialised into it the way Ruby's holds \
         Opal — is not available: TeaVM has no runtime to bake. It emits, per program, only the \
         classlib methods that program's call graph reached, renamed and inlined into the same \
         file, so there is no stable object two programs could share and a component carrying one \
         would carry the wrong 600 KB for every program that was not the one it was built from. \
         The cost of sharing is measured rather than hidden: ~9 ms of evaluation per turn against \
         ~2 ms for the equivalent plain JavaScript on the same artifact",
    ),
    (
        GgProgramLanguage::JavaScript,
        GgProgramLanguage::Java,
        "the transitive half of the entry above: JavaScript serves TypeScript's component and so \
         does Java, so this pair shares one by consequence rather than by a third decision",
    ),
    (
        GgProgramLanguage::PureScript,
        GgProgramLanguage::Java,
        "the other transitive half: both arms compile to JavaScript on the host and both are \
         evaluated by TypeScript's component, so this pair shares one by consequence rather than by \
         a third decision",
    ),
    (
        GgProgramLanguage::Java,
        GgProgramLanguage::Kotlin,
        "the two JVM arms reach this guest by one road: a Kotlin program is compiled to bytecode \
         and then to JavaScript by the same TeaVM, through the same driver backend, so the \
         argument that a component of Java's own would carry nothing carries over unchanged. This \
         is the pair the sharing is *about* — the other three Kotlin entries below are its \
         consequences — and it is the pair where sharing an artifact is most worth saying out \
         loud, because these two also share a compiler road, a classlib and a library claim. What \
         they must not share is the surface a model writes against, and that is asserted \
         separately: this arm carries no overload group at all where Java carries fourteen",
    ),
    (
        GgProgramLanguage::TypeScript,
        GgProgramLanguage::Kotlin,
        "TypeScript's component is the ECMAScript guest every host-compiled arm is evaluated by, \
         and Kotlin's output is JavaScript by the time it crosses",
    ),
    (
        GgProgramLanguage::JavaScript,
        GgProgramLanguage::Kotlin,
        "the transitive half of the entry above: JavaScript serves TypeScript's component and so \
         does Kotlin, so this pair shares one by consequence rather than by a third decision",
    ),
    (
        GgProgramLanguage::PureScript,
        GgProgramLanguage::Kotlin,
        "the other transitive half: both arms compile to JavaScript on the host and both are \
         evaluated by TypeScript's component, so this pair shares one by consequence rather than by \
         a third decision",
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
/// Four artifacts, each of which a consumer reaches through the trait object it was handed: the
/// committed component, the catalogue's spellings, the prompt's templates, and the healing dialect.
/// A consumer that had kept a `static` of TypeScript's — the shape every one of these was in before
/// the seam — would return the same value for both languages here.
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
            // language's name, or rendered its prompt, would be a language an operator configured
            // and did not get.
            assert_ne!(mine.id(), theirs.id());
            assert_ne!(mine.display_name(), theirs.display_name());
            assert_ne!(
                mine.prompt().system_template,
                theirs.prompt().system_template,
                "{} and {} render one system prompt",
                mine.id(),
                theirs.id(),
            );
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

    // Resolved through the normalized projection rather than out of a section, because which
    // section a call arrives in is what the two schemas disagree about — and the question here is
    // only whose *spelling* of one call came back.
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
        ts.prompt().system_template_name,
        fixture.prompt().system_template_name,
    );
    assert_ne!(
        ts.prompt().system_template,
        fixture.prompt().system_template,
    );
    assert_ne!(
        crate::sandbox::spell(ts, crate::sandbox::REVIEW_REQUEST_CHANGES),
        crate::sandbox::spell(fixture, crate::sandbox::REVIEW_REQUEST_CHANGES),
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
/// the resolution reads the language it was handed rather than the one committed catalogue that
/// exists. The fixture re-spells every function in `snake_case`, so a resolution that had quietly
/// fallen back to TypeScript's would produce `review.requestChanges` here and fail.
#[test]
fn the_fixture_quotes_only_functions_its_own_catalogue_carries() {
    let fixture = fixture_language();
    let functions = crate::sandbox::catalogue_functions(fixture);
    for call in crate::sandbox::OPERATIONS
        .iter()
        .map(|operation| operation.call)
    {
        // Resolved through the operation and quoted with the entry's OWN grouping, for the reason
        // the registry's version next door is: the fixture is cut from a converted arm, which files
        // gg's `(object, key)` pair nowhere and groups the call under a module path instead.
        let entry = functions.iter().find(|function| {
            function.alias_of.is_none()
                && crate::sandbox::operation_of(function).is_some_and(|resolved| {
                    resolved.call.object == call.object && resolved.call.key == call.key
                })
        });
        let qualified = crate::sandbox::spell(fixture, call);
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
        r#"gg.views.openFile("src/main.ts");"#
    );
    assert_eq!(
        typescript().open_file_statement("src/main.ts", Some(window)),
        r#"gg.views.openFile("src/main.ts", { offset: 400, limit: 200 });"#
    );

    let fixture = fixture_language();
    assert_eq!(
        fixture.open_file_statement("src/main.fx", None),
        r#"view.open_file("src/main.fx")"#
    );
    assert_eq!(
        fixture.open_file_statement("src/main.fx", Some(window)),
        r#"view.open_file("src/main.fx", offset=400, limit=200)"#
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
            Err(PrepareFailure::Program(PrepareError::Syntax(_)))
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

    // And each refuses what its own guest cannot resolve, in its own syntax.
    assert!(matches!(
        typescript().prepare_program("import fs from \"fs\";\n", &[], &PrepareContext::new()),
        Err(PrepareFailure::Program(PrepareError::Unsupported(_)))
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
    assert_eq!(module.exports, vec!["total".to_string()]);

    let fixture = fixture_language()
        .prepare_module("def total\n  x = 1\n", &PrepareContext::new())
        .expect("the fixture reads its own exports");
    assert_eq!(fixture.exports, vec!["total".to_string()]);

    // Neither language finds the other's exports, because neither is looking for them.
    assert!(
        fixture_language()
            .prepare_module("export const total = 1;\n", &PrepareContext::new())
            .expect("the fixture prepares it as ordinary source")
            .exports
            .is_empty()
    );
}
