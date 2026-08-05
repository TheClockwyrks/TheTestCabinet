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

/// The one language gg registers today, named explicitly wherever an assertion is about
/// **TypeScript's** own answers rather than about whichever language happens to be the default.
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
#[test]
fn every_registered_language_carries_its_committed_artifacts() {
    for language in all_languages() {
        assert!(
            !language.guest_component().is_empty(),
            "{} has no committed guest component",
            language.id()
        );
        let catalogue = language.catalogue();
        assert!(
            !catalogue.tools.is_empty(),
            "{}'s catalogue documents no tools at all",
            language.id()
        );
    }
}

/// **Every registered language declares what its guest needs from the host linker.**
///
/// The requirement is data rather than a linker method because
/// [`linker`](crate::sandbox::run_program) is generic over the tool API, and this is the assertion
/// that the data is actually stated: a guest whose imports the linker does not satisfy fails at
/// *instantiation*, deep inside a turn, with an error about a missing import rather than about a
/// language nobody finished registering.
#[test]
fn every_registered_language_declares_its_host_requirements() {
    for language in all_languages() {
        // Exhaustive on purpose: a new surface has to be considered here as well as in the linker.
        match language.host_requirements().wasi {
            WasiSurface::SandboxOnly => {}
        }
    }
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
        for call in crate::sandbox::MODEL_FACING_CALLS {
            let entry = functions
                .iter()
                .find(|function| function.object == call.object && function.key == call.key)
                .unwrap_or_else(|| {
                    panic!(
                        "{}: gg names `{}.{}`, which its catalogue does not carry",
                        language.id(),
                        call.object,
                        call.key
                    )
                });
            assert_eq!(
                crate::sandbox::spell(language, call),
                format!("{}.{}", call.object, entry.name),
                "{}: the quoted spelling is not the one the catalogue gives that key",
                language.id()
            );
        }
    }
}

/// **And the table covers the catalogue whole** — the other half of the same agreement.
///
/// The test above proves no entry in the table is invented. This one proves none is *missing*: a
/// function a language's SDK binds with no entry here is a call the membrane has no identity to
/// record under, which is precisely the silent undercount the per-function accounting exists to
/// remove — the model calls it, the console reports it as offered and never called, and nothing
/// anywhere says otherwise.
///
/// [`list`](crate::docs::LIST_FUNCTION) is the one exclusion, and it is excluded from the
/// *catalogue* too: the guest seeds it onto every object rather than exporting it once, so it has no
/// catalogue entry on either side to compare.
#[test]
fn the_model_facing_table_covers_every_catalogued_function() {
    for language in all_languages() {
        for function in crate::sandbox::catalogue_functions(language) {
            assert!(
                crate::sandbox::MODEL_FACING_CALLS
                    .iter()
                    .any(|call| { call.object == function.object && call.key == function.key }),
                "{}: the catalogue binds `{}.{}` (spelled `{}`), which gg has no identity to record \
                 it under",
                language.id(),
                function.object,
                function.key,
                function.name
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
            !prompt.nothing_shown_fallback.trim().is_empty(),
            "{}: an empty nothing-shown fallback",
            language.id()
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The seam has more than one implementation
// ---------------------------------------------------------------------------------------------
//
// Everything below is about the [fixture language](super::fixture) — a second implementation of
// `ProgramLanguage` that exists only under `#[cfg(test)]`. Its whole purpose is to make the
// properties this module claims *falsifiable*: with one implementation, "the consumer asks the
// language" and "the consumer knows TypeScript's answer" are the same observation.

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

/// **No language serves another language's artifacts.**
///
/// Four artifacts, each of which a consumer reaches through the trait object it was handed: the
/// committed component, the catalogue's spellings, the prompt's templates, and the healing dialect.
/// A consumer that had kept a `static` of TypeScript's — the shape every one of these was in before
/// the seam — would return the same value for both languages here.
#[test]
fn no_language_serves_another_languages_artifacts() {
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

    let spelling = |language: &'static dyn ProgramLanguage| {
        language
            .catalogue()
            .tools
            .iter()
            .find(|entry| entry.tool == "read_file")
            .map(|entry| entry.name.clone())
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
    for call in crate::sandbox::MODEL_FACING_CALLS {
        let name = functions
            .iter()
            .find(|function| function.object == call.object && function.key == call.key)
            .map(|function| function.name);
        let qualified = crate::sandbox::spell(fixture, call);
        assert_eq!(
            Some(qualified.as_str()),
            name.map(|name| format!("{}.{name}", call.object))
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
        r#"view.openFile("src/main.ts");"#
    );
    assert_eq!(
        typescript().open_file_statement("src/main.ts", Some(window)),
        r#"view.openFile("src/main.ts", { offset: 400, limit: 200 });"#
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
        .prepare_program(annotated)
        .expect("TypeScript prepares its own source");
    assert!(
        !stripped.source.contains(": number"),
        "TypeScript erases the annotation: {}",
        stripped.source
    );
    let fixture = fixture_language()
        .prepare_program(annotated)
        .expect("the fixture has no types to erase");
    assert!(
        fixture.source.contains(": number"),
        "the fixture passes it through: {}",
        fixture.source
    );

    let commented = "total = 1 # the answer\n";
    assert!(
        matches!(
            typescript().prepare_program(commented),
            Err(PrepareFailure::Program(PrepareError::Syntax(_)))
        ),
        "`#` is not TypeScript"
    );
    assert_eq!(
        fixture_language()
            .prepare_program(commented)
            .expect("`#` is the fixture's comment")
            .source,
        "total = 1\n"
    );

    // And each refuses what its own guest cannot resolve, in its own syntax.
    assert!(matches!(
        typescript().prepare_program("import fs from \"fs\";\n"),
        Err(PrepareFailure::Program(PrepareError::Unsupported(_)))
    ));
    assert!(matches!(
        fixture_language().prepare_program("use tools\n"),
        Err(PrepareFailure::Program(PrepareError::Unsupported(_)))
    ));
}

/// **Preparing a module is the language's own work too** — the namespace a code
/// [skill](crate::skills) or [memory](crate::memories) is bound from comes from the language's own
/// reading of its own export syntax.
#[test]
fn preparing_a_module_is_the_languages_own() {
    let module = typescript()
        .prepare_module("export const total = 1;\n")
        .expect("TypeScript reads its own exports");
    assert_eq!(module.exports, vec!["total".to_string()]);

    let fixture = fixture_language()
        .prepare_module("def total\n  x = 1\n")
        .expect("the fixture reads its own exports");
    assert_eq!(fixture.exports, vec!["total".to_string()]);

    // Neither language finds the other's exports, because neither is looking for them.
    assert!(
        fixture_language()
            .prepare_module("export const total = 1;\n")
            .expect("the fixture prepares it as ordinary source")
            .exports
            .is_empty()
    );
}
