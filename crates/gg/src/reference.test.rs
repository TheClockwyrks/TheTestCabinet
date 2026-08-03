use std::collections::BTreeSet;

use super::*;

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

/// Every tool and every API function names a category the payload actually declares — so no entry
/// can land in a group the console does not render, which is how an entry disappears from a
/// sidebar without disappearing from the data.
#[test]
fn every_entry_maps_to_a_declared_category() {
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
    for function in &reference.functions {
        assert!(
            declared.contains(function.category.as_str()),
            "`{}.{}` is in category `{}`, which no family declares",
            function.object,
            function.name,
            function.category
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
        assert_eq!(category.objects, family.objects.to_vec());
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

/// The gate table covers **exactly** the tool vocabulary: no tool without a documented gate, and no
/// gate for a tool that no longer exists.
///
/// This is the gate that makes the authored half of the reference maintainable. A new tool arrives
/// with a capability and a set of conditions that live only in `ToolRegistry::from_run`'s `if`s;
/// without this test it would arrive on the page with no explanation of what buys it, and nobody
/// would notice.
#[test]
fn the_gate_table_covers_exactly_the_tool_vocabulary() {
    let gated: Vec<&str> = TOOL_GATES.iter().map(|gate| gate.tool).collect();
    assert_eq!(
        gated,
        ALL_TOOL_NAMES.to_vec(),
        "TOOL_GATES must name exactly the tools gg can offer, in the same order"
    );

    for gate in TOOL_GATES {
        assert!(
            !gate.capability.trim().is_empty(),
            "`{}` has no capability",
            gate.tool
        );
        if let Some(note) = gate.note {
            assert!(
                !note.trim().is_empty(),
                "`{}` carries an empty note, which renders as a blank caveat",
                gate.tool
            );
        }
    }
}

/// Every function the committed signature catalogue documents reaches the reference, with its
/// signature and documentation intact.
#[test]
fn every_catalogued_function_appears() {
    let reference = reference();
    let emitted: BTreeSet<(String, String)> = reference
        .functions
        .iter()
        .map(|f| (f.object.clone(), f.name.clone()))
        .collect();

    let catalogued = crate::sandbox::catalogue_functions();
    assert_eq!(
        emitted.len(),
        catalogued.len(),
        "the reference must carry one entry per catalogued function"
    );
    for function in &catalogued {
        assert!(
            emitted.contains(&(function.object.to_string(), function.name.to_string())),
            "`{}.{}` is documented by the catalogue but missing from the reference",
            function.object,
            function.name
        );
    }

    for function in &reference.functions {
        assert!(
            !function.signature.trim().is_empty(),
            "`{}.{}` came out with no signature",
            function.object,
            function.name
        );
        assert!(
            !function.doc.trim().is_empty(),
            "`{}.{}` came out with no documentation",
            function.object,
            function.name
        );
        assert!(
            !function.summary.trim().is_empty(),
            "`{}.{}` came out with no summary",
            function.object,
            function.name
        );
    }
}

/// Every type a signature refers to resolves to a declaration.
///
/// The reference drops a name the catalogue does not declare rather than rendering an empty block,
/// which is the right behaviour for a corrupt artifact and the wrong thing to discover in
/// production — so the count is asserted here, where a regenerated catalogue that lost a
/// declaration fails the build instead.
#[test]
fn every_referenced_type_resolves_to_a_declaration() {
    let reference = reference();
    let by_name: std::collections::BTreeMap<(String, String), usize> = reference
        .functions
        .iter()
        .map(|f| ((f.object.clone(), f.name.clone()), f.types.len()))
        .collect();

    for function in crate::sandbox::catalogue_functions() {
        let key = (function.object.to_string(), function.name.to_string());
        assert_eq!(
            by_name.get(&key).copied(),
            Some(function.types.len()),
            "`{}.{}` refers to a type the catalogue does not declare",
            function.object,
            function.name
        );
    }

    for function in &reference.functions {
        for declared in &function.types {
            assert!(
                !declared.declaration.trim().is_empty(),
                "`{}` resolved to an empty declaration",
                declared.name
            );
        }
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
/// makes the [union](maximal_definitions)'s name-keyed dedup safe. That dedup keeps the *first*
/// definition it sees for a name; if two reachable configurations word or shape a tool differently
/// and only one of them is emitted, the page documents a gg some runs are not. Nothing about a
/// `ToolDefinition` announces that it varies, so the only way to know is to build every
/// configuration and look — which is cheap, and is what this does.
///
/// A failure here is fixed by adding the missing rendering to [`variants`], not by widening the
/// comparison.
#[test]
fn every_reachable_rendering_is_on_the_page() {
    let reference = reference();

    for configuration in every_configuration() {
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

/// Every configuration a run can put a tool in: the cross product of the policies
/// [`variants`] knows about and the two axes the [union](maximal_definitions) runs over.
///
/// A cross product rather than one-axis-at-a-time because the interesting failure is a *pair* — a
/// policy whose rendering only differs under some other setting — and 144 registries of a few
/// dozen tools apiece is a fraction of a second.
fn every_configuration() -> Vec<Configuration> {
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
                            });
                        }
                    }
                }
            }
        }
    }
    configurations
}

/// Every tool whose description enumerates run data — the skills, the roster, a machine's edges —
/// is shown built from the placeholders, and says so in its note.
///
/// The assertion is on the *description*, not on the note, because the failure this guards against
/// is the reference silently rendering an empty list (an unbound library, an empty roster) and
/// reading as though gg offers a tool with nothing to point at.
#[test]
fn run_data_descriptions_are_built_from_placeholders() {
    let reference = reference();
    let described = |name: &str| {
        reference
            .tools
            .iter()
            .find(|tool| tool.name == name)
            .map(|tool| tool.description.clone())
            .unwrap_or_else(|| panic!("`{name}` is missing"))
    };

    assert!(described("read_skill").contains(PLACEHOLDER_SKILL));
    for name in ["spawn_subagent", "run_workflow", "speculate", "exec"] {
        assert!(
            described(name).contains(PLACEHOLDER_AGENT),
            "`{name}` does not name the placeholder roster"
        );
    }
    let (_, state, next) = PLACEHOLDER_PROCESS;
    let transition = described("transition_state");
    assert!(transition.contains(state) && transition.contains(next));
}

/// The reference is stamped with the build it came out of, and is pure: two calls in one process
/// produce the same document.
#[test]
fn the_reference_is_stamped_and_deterministic() {
    let first = reference();
    assert_eq!(first.gg_version, env!("CARGO_PKG_VERSION"));
    assert!(!first.gg_version.is_empty());
    assert_eq!(first, reference());
}
