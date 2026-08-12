use std::collections::BTreeSet;

use serde_json::json;

use super::tools::{Configuration, MAXIMAL_CONFIGURATION, registry_definitions};
use super::*;
use crate::memories::MemoryStrategy;
use crate::tasks::TaskMode;
use crate::tools::{ALL_TOOL_NAMES, READ_MODE_DEFAULT_CAP, READ_MODE_UNLIMITED};
use test_cabinet_core::gg::{SHELL_OUTPUT_ADAPTIVE, SHELL_OUTPUT_INLINE, SHELL_OUTPUT_OFFLOAD};

/// Every tool gg can offer appears **exactly once**, with the prose and schema a model would
/// really be sent.
///
/// This is the property the whole feature rests on: a reference that quietly lost a tool — because
/// its capability was left out of the maximal profile, or because the memory strategies were not
/// unioned over — would document a gg that offers less than gg does, and nothing else on the page
/// would give that away.
#[test]
fn every_tool_appears_once_with_a_real_definition() {
    let reference = reference();

    let names: Vec<&str> = reference.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(
        names,
        ALL_TOOL_NAMES.to_vec(),
        "the reference must carry exactly the canonical tool vocabulary, in its order"
    );

    for tool in &reference.tools {
        assert!(
            !tool.description.trim().is_empty(),
            "`{}` came out with an empty description — its definition was not read",
            tool.name
        );
        assert_eq!(
            tool.parameters.get("type").and_then(|t| t.as_str()),
            Some("object"),
            "`{}`'s parameters must be the object schema the provider is sent",
            tool.name
        );
        assert!(
            tool.parameters.get("properties").is_some(),
            "`{}`'s parameter schema has no properties at all",
            tool.name
        );
    }
}

/// Every tool names a category the index actually declares — so no entry can land in a group the
/// console does not render, which is how an entry disappears from a sidebar without disappearing
/// from the data.
#[test]
fn every_tool_maps_to_a_declared_category() {
    let reference = reference();
    let declared: BTreeSet<&str> = reference.categories.iter().map(|c| c.id.as_str()).collect();

    for tool in &reference.tools {
        assert!(
            declared.contains(tool.category.as_str()),
            "`{}` is in category `{}`, which no family declares",
            tool.name,
            tool.category
        );
    }
}

/// The categories are the families, in the families' own order, each with a display title and the
/// model-facing description verbatim.
#[test]
fn the_categories_are_the_families_in_order() {
    let reference = reference();

    assert_eq!(reference.categories.len(), FAMILIES.len());
    for (category, family) in reference.categories.iter().zip(FAMILIES) {
        assert_eq!(category.id, family.id);
        assert_eq!(category.title, family.title);
        assert_eq!(category.description, family.description);
        assert!(
            !category.title.trim().is_empty(),
            "`{}` has no display title",
            category.id
        );
    }
}

/// Every tool belongs to exactly one family — the property [`category_of_tool`] relies on, and the
/// reason it can answer without a fallback ever being taken.
///
/// Asserted here rather than left to the fallback because the two lists are authored in different
/// files: a tool added to [`ALL_TOOL_NAMES`] and forgotten in [`FAMILIES`] would get an empty
/// category, and a name left in `FAMILIES` after its tool was removed would silently document
/// nothing.
#[test]
fn the_families_partition_the_tool_vocabulary() {
    let mut grouped: Vec<&str> = FAMILIES
        .iter()
        .flat_map(|family| family.tools.iter().copied())
        .collect();
    let before = grouped.len();
    grouped.sort_unstable();
    grouped.dedup();
    assert_eq!(before, grouped.len(), "a tool is listed by two families");

    let canonical: Vec<&str> = {
        let mut names = ALL_TOOL_NAMES.to_vec();
        names.sort_unstable();
        names
    };
    assert_eq!(
        grouped, canonical,
        "the families must name exactly the tools gg can offer"
    );
}

/// **Every arm gg registers is on the picker, and the size beside it is its own document's.**
///
/// The counts are what a reader sees before they fetch an arm, so a count that does not match the
/// document behind it is the one error the page cannot show: the arm looks complete and opens
/// short. Recomputed here from the document rather than from the catalogue, which is the same
/// direction the projection computes them in and therefore the check that a *dropped* entry — a
/// type nothing reaches, a function no maximal grant binds — is visible in the index too.
#[test]
fn every_registered_language_is_listed_with_the_size_of_its_own_document() {
    let reference = reference();
    let listed: Vec<GgProgramLanguage> = reference.languages.iter().map(|arm| arm.id).collect();
    assert_eq!(
        listed,
        GgProgramLanguage::ALL.to_vec(),
        "the picker must list every registered arm, in registration order"
    );

    for arm in &reference.languages {
        let document = reference_api(arm.id);
        assert_eq!(document.modules.len(), arm.module_count, "{}", arm.id.id());
        assert_eq!(
            document
                .entries
                .iter()
                .filter(|entry| entry.kind == GgReferenceEntryKind::Function)
                .count(),
            arm.function_count,
            "{}",
            arm.id.id()
        );
        assert_eq!(
            document
                .entries
                .iter()
                .filter(|entry| entry.kind == GgReferenceEntryKind::Type)
                .count(),
            arm.type_count,
            "{}",
            arm.id.id()
        );
        assert!(
            arm.function_count > 0 && arm.type_count > 0 && arm.module_count > 0,
            "`{}` is advertised with an empty document",
            arm.id.id()
        );
    }
}

/// Every tool a configuration rewrites carries its alternate renderings, and each one really
/// differs from the default — a variant identical to the entry above it is a variant that is not
/// being built from the configuration it claims.
#[test]
fn the_policy_driven_tools_carry_distinct_variants() {
    let reference = reference();
    let tool = |name: &str| {
        reference
            .tools
            .iter()
            .find(|tool| tool.name == name)
            .unwrap_or_else(|| panic!("`{name}` is missing"))
    };

    for (name, labels) in [
        ("read_file", vec!["read mode: default-cap"]),
        (
            "shell",
            vec!["shell output: inline", "shell output: offload"],
        ),
        ("create_issue", vec!["reviewers: required"]),
        ("add_task", vec!["task mode: issues"]),
        ("update_task", vec!["task mode: issues"]),
        ("create_memory", vec!["memory strategy: keyword-search"]),
        ("read_memory", vec!["memory strategy: keyword-search"]),
    ] {
        let entry = tool(name);
        let emitted: Vec<&str> = entry.variants.iter().map(|v| v.label.as_str()).collect();
        assert_eq!(emitted, labels, "`{name}`'s variants");
        for variant in &entry.variants {
            assert!(
                variant.description != entry.description || variant.parameters != entry.parameters,
                "`{name}`'s `{}` variant renders identically to the default",
                variant.label
            );
        }
    }

    // The unlimited read mode is the *default*, and it is the one that offers no paging arguments
    // at all — so the capped variant is where `offset` and `limit` appear. Asserted explicitly
    // because getting the default backwards would look right on the page and be wrong.
    let read_file = tool("read_file");
    assert!(read_file.parameters["properties"].get("limit").is_none());
    assert!(read_file.variants[0].parameters["properties"]["limit"].is_object());

    // The two file-shaped memory strategies disagree about a *required argument*, which is the
    // difference a reader would act on: under `markdown` a memory must be described, because the
    // description is the index line the model reads it back off; under `keyword-search` there is
    // no index, so it need not be. Asserted on `required` rather than on the prose because prose
    // may be reworded and this may not.
    let create_memory = tool("create_memory");
    assert_eq!(
        create_memory.parameters["required"],
        json!(["name", "description", "contents"]),
        "the `create_memory` entry must be the indexed (markdown) rendering"
    );
    assert_eq!(
        create_memory.variants[0].parameters["required"],
        json!(["name", "contents"]),
        "the keyword-search variant must be the one that does not demand a description"
    );
    assert!(
        tool("read_memory").variants[0]
            .description
            .contains("search_memories"),
        "the keyword-search `read_memory` variant must name the call a slug comes from"
    );

    // Issues mode is the one that turns a to-do into something scoped, and it does it by *adding
    // required arguments* — the failure a reader of the simple-mode schema alone would walk into.
    let add_task = tool("add_task");
    assert_eq!(add_task.parameters["required"], json!(["id", "title"]));
    assert_eq!(
        add_task.variants[0].parameters["required"],
        json!(["id", "title", "inScope", "outOfScope", "completionCriteria"])
    );
}

/// **Every** rendering a run can actually be sent is on the page — as the entry, or as one of its
/// variants.
///
/// This is the general form of the property the test above spot-checks, and it is the one that
/// makes the union's name-keyed dedup safe. That dedup keeps the *first* definition it sees for a
/// name; if two reachable configurations word or shape a tool differently and only one of them is
/// emitted, the page documents a gg some runs are not. Nothing about a `ToolDefinition` announces
/// that it varies, so the only way to know is to build every configuration and look — which is
/// cheap, and is what this does.
///
/// A failure here is fixed by adding the missing rendering to `variants`, not by widening the
/// comparison.
#[test]
fn every_reachable_rendering_is_on_the_page() {
    let reference = reference();

    for configuration in every_policy() {
        for definition in registry_definitions(&configuration) {
            let entry = reference
                .tools
                .iter()
                .find(|tool| tool.name == definition.name)
                .unwrap_or_else(|| {
                    panic!(
                        "`{}` is offered by a run but not documented",
                        definition.name
                    )
                });
            let same = |description: &str, parameters: &serde_json::Value| {
                description == definition.description && *parameters == definition.parameters
            };
            assert!(
                same(&entry.description, &entry.parameters)
                    || entry
                        .variants
                        .iter()
                        .any(|variant| same(&variant.description, &variant.parameters)),
                "`{}` renders differently under {configuration:?} than anything the reference \
                 carries — that configuration's rendering needs a variant",
                definition.name
            );
        }
    }
}

/// Every configuration a run can put a tool's **rendering** in: the cross product of the policies
/// `variants` knows about and the two axes the maximal union runs over, with everything a run can
/// *withhold* left maximal.
///
/// A cross product rather than one-axis-at-a-time because the interesting failure is a *pair* — a
/// policy whose rendering only differs under some other setting — and 144 registries of a few dozen
/// tools apiece is a fraction of a second. What a run withholds is the
/// [conditions](super::conditions)' subject and is covered exhaustively there, over a space this
/// one deliberately does not enter: a withheld tool has no rendering to compare.
pub(super) fn every_policy() -> Vec<Configuration> {
    let mut configurations = Vec::new();
    for read in [READ_MODE_UNLIMITED, READ_MODE_DEFAULT_CAP] {
        for shell in [
            SHELL_OUTPUT_ADAPTIVE,
            SHELL_OUTPUT_INLINE,
            SHELL_OUTPUT_OFFLOAD,
        ] {
            for reviewers in [false, true] {
                for memories in [
                    MemoryStrategy::Scratchpad,
                    MemoryStrategy::Markdown,
                    MemoryStrategy::KeywordSearch,
                ] {
                    for tasks in [TaskMode::Simple, TaskMode::Issues] {
                        for fsm in [false, true] {
                            configurations.push(Configuration {
                                read,
                                shell,
                                reviewers,
                                memories,
                                tasks,
                                fsm,
                                ..MAXIMAL_CONFIGURATION
                            });
                        }
                    }
                }
            }
        }
    }
    configurations
}

/// Every tool whose description or schema is built from run data is shown built from the
/// placeholders, **and says which ones it carries**.
///
/// Two halves, and both are needed. The description assertion guards against the reference silently
/// rendering an empty list (an unbound library, an empty roster) and reading as though gg offers a
/// tool with nothing to point at. The `runData` assertion guards the page's other half: a token in
/// the prose that the entry does not declare is a token a reader has no way to know is a
/// placeholder, and marking it by looking for angle brackets is what this field exists to avoid.
#[test]
fn run_data_descriptions_are_built_from_placeholders() {
    let reference = reference();
    let entry = |name: &str| {
        reference
            .tools
            .iter()
            .find(|tool| tool.name == name)
            .unwrap_or_else(|| panic!("`{name}` is missing"))
    };
    let declares = |name: &str, token: &str| {
        entry(name)
            .run_data
            .iter()
            .any(|stand_in| stand_in.token == token)
    };

    assert!(entry("read_skill").description.contains(PLACEHOLDER_SKILL));
    assert!(declares("read_skill", PLACEHOLDER_SKILL));
    for name in ["spawn_subagent", "exec"] {
        assert!(
            entry(name).description.contains(PLACEHOLDER_AGENT),
            "`{name}` does not name the placeholder roster"
        );
        assert!(declares(name, PLACEHOLDER_AGENT));
    }
    let (_, state, next) = PLACEHOLDER_PROCESS;
    let transition = &entry("transition_state").description;
    assert!(transition.contains(state) && transition.contains(next));
    assert!(declares("transition_state", state) && declares("transition_state", next));

    // `create_issue` carries its roster in the **parameter schema** rather than in its prose, and
    // in a variant's as well as the entry's — the two reasons the scan reads more than the
    // description of the default rendering.
    assert!(declares("create_issue", PLACEHOLDER_AGENT));

    // And nothing else claims a stand-in. A token declared by a tool whose text does not contain it
    // would be a marker the page could never place.
    for tool in &reference.tools {
        for stand_in in &tool.run_data {
            let mut text = format!("{}{}", tool.description, tool.parameters);
            for variant in &tool.variants {
                text.push_str(&variant.description);
                text.push_str(&variant.parameters.to_string());
            }
            assert!(
                text.contains(&stand_in.token),
                "`{}` declares the stand-in `{}`, which appears nowhere in what it sends",
                tool.name,
                stand_in.token
            );
            assert!(
                !stand_in.stands_for.trim().is_empty(),
                "`{}`'s `{}` stands for nothing a reader can read",
                tool.name,
                stand_in.token
            );
        }
    }
}

/// The reference is stamped with the build it came out of, and is pure: two calls in one process
/// produce the same document, index and arms alike.
#[test]
fn the_reference_is_stamped_and_deterministic() {
    let first = reference();
    assert_eq!(first.gg_version, env!("CARGO_PKG_VERSION"));
    assert!(!first.gg_version.is_empty());
    assert_eq!(first, reference());

    for language in GgProgramLanguage::ALL {
        let document = reference_api(*language);
        assert_eq!(document.gg_version, first.gg_version);
        assert_eq!(document, reference_api(*language));
    }
}
