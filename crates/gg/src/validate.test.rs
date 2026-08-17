//! **The launch refusal.**
//!
//! One property is what the whole design is for, and it has a test of its own at the bottom of this
//! file: a configuration carrying several unhonourable values is refused **once**, naming every one
//! of them. An operator fixing a sweep's shared document must not have to launch a dozen times to
//! discover a dozen typos. Every later stage that teaches a resolver to report extends that test
//! with its own defect class rather than adding a separate one.
//!
//! The rest of the file pins the three groups this stage implements — the profile invariants
//! absorbed from the old `validate_agents`, the capability-id vocabulary, and the per-capability
//! params vocabulary — plus the two structural guarantees underneath them: the params table covers
//! the capability catalogue exactly, and a [`Discarding`](LaunchReport::Discarding) sink is the
//! assertion it claims to be.

use serde_json::json;
use test_cabinet_core::gg::{
    AUTOLOAD_LOCKED_IMPL, CAPABILITY_READ_FILE, CAPABILITY_SKILLS, CAPABILITY_SUBAGENTS,
    GgAgentConfig, GgCapabilityConfig, GgCapabilitySet, GgHook, GgHookAction, GgHookEvent,
    GgLoopDetection, GgRunLimits, GgSubagentRef, GgSubagentScope,
    PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, ROOT_AGENT, SHELL_OUTPUT_ADAPTIVE,
};

use super::*;

/// A one-agent set bound to a mock model — the smallest thing that launches.
fn minimal() -> GgCapabilitySet {
    GgCapabilitySet::minimal("mock/echo")
}

/// Put `capability` on the root profile, **replacing** any declaration of the same id it already
/// carries. A second entry of one id is its own refusal, so a test about some other value has to
/// overwrite rather than append.
fn put(set: &mut GgCapabilitySet, capability: GgCapabilityConfig) {
    match set.agents[0]
        .capabilities
        .iter_mut()
        .find(|existing| existing.id == capability.id)
    {
        Some(existing) => *existing = capability,
        None => set.agents[0].capabilities.push(capability),
    }
}

/// Every defect `set` earns, or an empty list when it launches.
fn defects(set: &GgCapabilitySet) -> Vec<LaunchDefect> {
    validate_capability_set(set).err().unwrap_or_default()
}

/// The refusal as one blob, for the cases that care that a value is *named* rather than where.
fn refusal_text(set: &GgCapabilitySet) -> String {
    let defects = defects(set);
    assert!(!defects.is_empty(), "the set was accepted");
    defects
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// The defect and the sink
// ---------------------------------------------------------------------------

/// The operator's line carries all four things they need: whose configuration it is, where in the
/// document, what was written, and why gg cannot honour it — plus the vocabulary when there is one.
#[test]
fn a_defect_reads_as_one_line_naming_the_agent_the_locus_and_the_value() {
    let defect = LaunchDefect::on_agent(
        "Reviewer",
        "capabilities[2].implementation",
        "self-compation",
        "the `compaction` capability names a strategy gg does not offer.",
    )
    .known(["self-summarization", "handoff-summarization"]);
    assert_eq!(
        defect.to_string(),
        "agent `Reviewer`: capabilities[2].implementation = `self-compation` — the `compaction` \
         capability names a strategy gg does not offer. gg recognizes: `self-summarization`, \
         `handoff-summarization`."
    );

    // A run-level defect with no value and no vocabulary is the same line with those parts absent,
    // rather than with empty brackets where they would have been.
    let run = LaunchDefect::run_level("agents", "", "no agent profiles are declared.");
    assert_eq!(run.to_string(), "agents — no agent profiles are declared.");
}

/// A collecting sink keeps everything, in the order it arrived — which is document order, because
/// the pass walks the document.
#[test]
fn a_collecting_sink_keeps_every_defect_in_order() {
    let mut report = LaunchReport::collecting();
    assert!(report.is_empty());
    report.report(LaunchDefect::run_level("first", "", "one"));
    report.report(LaunchDefect::run_level("second", "", "two"));
    assert!(!report.is_empty());
    let loci: Vec<_> = report
        .into_defects()
        .into_iter()
        .map(|defect| defect.locus)
        .collect();
    assert_eq!(loci, ["first", "second"]);
}

/// A discarding sink reports nothing, because by the time a resolver runs against one the launch
/// pass has already proved there is nothing to report. In a debug build reaching it is a panic — the
/// assertion that a resolver migrated onto the report was also taught to [`validate_launch`]. In a
/// release build it is silently dropped instead, because a run already under way is not something a
/// resolver should end, so this case only exists where the assertion does.
#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "gg read one document two different ways")]
fn reporting_into_a_discarding_sink_is_a_gg_defect() {
    let mut report = LaunchReport::Discarding;
    assert!(report.is_empty());
    report.report(LaunchDefect::run_level(
        "compaction.implementation",
        "x",
        "unreadable",
    ));
}

// ---------------------------------------------------------------------------
// The params table
// ---------------------------------------------------------------------------

/// The table is the vocabulary a params object is read against, so it has to line up with the
/// capability catalogue **exactly**: a capability missing from it would refuse every param anyone
/// wrote on it, and an entry naming a capability gg does not ship would be read by nothing.
#[test]
fn the_params_table_covers_the_capability_catalogue_exactly() {
    let mut ids: Vec<&str> = CAPABILITY_PARAMS.iter().map(|(id, _)| *id).collect();
    let declared = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), declared, "a capability is in the table twice");

    for (id, params) in CAPABILITY_PARAMS {
        assert!(
            GG_CAPABILITY_CATALOG.contains(id),
            "`{id}` is in the params table but is not a capability gg ships"
        );
        let mut keys = params.to_vec();
        let written = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), written, "`{id}` names a param twice");
        for key in *params {
            assert!(!key.is_empty(), "`{id}` names an empty param");
        }
    }
    for id in GG_CAPABILITY_CATALOG {
        assert!(
            params_for(id).is_some(),
            "`{id}` ships but has no params entry; give it an empty one if it takes none"
        );
    }
}

/// [`ownership`](MODULE_PARAM_OWNERSHIP) is the case the table exists to get right: it is a real gg
/// param, offered by the two module-backed capabilities that have an ownership to configure and by
/// no others. On any other capability it is a key read by nothing, which is exactly the shape of
/// defect that used to be silent.
#[test]
fn ownership_is_known_only_to_the_capabilities_that_configure_one() {
    let offers = |id: &str| params_for(id).unwrap().contains(&MODULE_PARAM_OWNERSHIP);
    assert!(offers(CAPABILITY_PROJECT_MANAGEMENT));
    assert!(offers(CAPABILITY_AGENT_MANAGED_CONTEXT));
    for id in [CAPABILITY_MEMORIES, CAPABILITY_SKILLS, CAPABILITY_TASKS] {
        assert!(!offers(id), "`{id}` does not read an `ownership`");
    }
}

// ---------------------------------------------------------------------------
// Capability ids
// ---------------------------------------------------------------------------

/// A capability id gg does not ship is refused rather than carried through the run. It switches
/// nothing on — and the run's **own record** would go on to claim it was configured, so a study
/// reading its data back would see an arm that never ran.
#[test]
fn an_unknown_capability_id_is_refused() {
    let mut set = minimal();
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled("memorys"));
    let defects = defects(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].agent.as_deref(), Some(ROOT_AGENT));
    assert_eq!(defects[0].found, "memorys");
    assert!(defects[0].locus.ends_with(".id"), "{}", defects[0].locus);
    assert_eq!(defects[0].known, GG_CAPABILITY_CATALOG.to_vec());
}

/// A capability the profile declares and switches **off** is still configuration — it records the
/// arm the run would have used — so a typo in a disabled capability is refused on the same terms.
/// Telling an operator now beats telling them on the launch where they flip the switch.
#[test]
fn an_unknown_capability_id_is_refused_even_when_it_is_disabled() {
    let mut set = minimal();
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::disabled("compation"));
    assert!(refusal_text(&set).contains("compation"));
}

/// Every id gg ships is accepted, on and off — the catalogue is the vocabulary, and nothing in it
/// may be refused by the check that reads it.
#[test]
fn every_shipped_capability_id_is_accepted() {
    let mut set = minimal();
    set.agents[0].capabilities = GG_CAPABILITY_CATALOG
        .iter()
        .map(|id| GgCapabilityConfig::disabled(*id))
        .collect();
    assert_eq!(defects(&set), Vec::new());
}

// ---------------------------------------------------------------------------
// Params keys
// ---------------------------------------------------------------------------

/// A misspelled params key is refused. `serde` cannot reach inside a free-form `params` object, so
/// this table is the only thing between `summryHeadroom` and a run that condensed at gg's default
/// headroom while its record named the configured one.
#[test]
fn a_params_key_the_capability_does_not_read_is_refused() {
    let mut set = minimal();
    set.agents[0].capabilities.push(GgCapabilityConfig {
        params: json!({ "summryHeadroom": 0.4 }),
        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
    });
    let defects = defects(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].found, "summryHeadroom");
    assert!(
        defects[0].locus.ends_with(".params.summryHeadroom"),
        "{}",
        defects[0].locus
    );
    assert!(
        defects[0]
            .known
            .contains(&crate::compaction::PARAM_SUMMARY_HEADROOM.to_string()),
        "the refusal offers the vocabulary: {:?}",
        defects[0].known
    );
}

/// A key that is a real gg param **on another capability** is still unknown here. `ownership` on
/// `memories` reads as though it configured something and configures nothing at all; that used to be
/// documented as "exactly like any other key gg does not know", and it is a refusal now.
#[test]
fn a_params_key_belonging_to_another_capability_is_refused() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig {
            params: json!({ MODULE_PARAM_OWNERSHIP: "owned" }),
            ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
        },
    );
    assert!(refusal_text(&set).contains(MODULE_PARAM_OWNERSHIP));
}

/// **The deliberate exception.** A key known to the capability but unused by the arm its
/// `implementation` selected is accepted: one params block swept across all three memory strategies
/// without retyping it is the point of the block, and `maxResults` is inert under `scratchpad`
/// rather than wrong.
#[test]
fn a_params_key_the_selected_arm_does_not_use_is_accepted() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig {
            implementation: Some("scratchpad".to_string()),
            params: json!({ crate::memories::PARAM_MAX_RESULTS: 5 }),
            ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
        },
    );
    assert_eq!(defects(&set), Vec::new());
}

/// An absent or empty params object is the ordinary shape of a capability with nothing to tune, and
/// takes every default. Absent is not unrecognized.
#[test]
fn an_absent_or_empty_params_object_is_accepted() {
    for params in [json!({}), json!(null)] {
        let mut set = minimal();
        set.agents[0].capabilities.push(GgCapabilityConfig {
            params,
            ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
        });
        assert_eq!(defects(&set), Vec::new());
    }
}

/// `params` that is not an object at all has no named values in it, so there is nothing gg can read
/// — and reading it as "no params" would launch the default arm under the configured arm's name.
#[test]
fn a_params_value_that_is_not_an_object_is_refused() {
    let mut set = minimal();
    set.agents[0].capabilities.push(GgCapabilityConfig {
        params: json!("summaryHeadroom=0.4"),
        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
    });
    let defects = defects(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(
        defects[0].locus.ends_with(".params"),
        "{}",
        defects[0].locus
    );
}

// ---------------------------------------------------------------------------
// The shape of a capability list
// ---------------------------------------------------------------------------

/// **A capability declared twice is refused.** A capability is looked up by id and the first
/// declaration answers, so every value on the second — its switch, its arm, its params — is read by
/// nothing at all. That is the refusal machinery fully intact and simply bypassed: written once,
/// either of these values refuses the launch; written twice, both become invisible.
#[test]
fn a_capability_declared_twice_is_refused() {
    let mut set = minimal();
    set.agents[0].capabilities.push(GgCapabilityConfig {
        implementation: Some("vector-index".to_string()),
        params: json!({ crate::memories::PARAM_MAX_COUNT: -4 }),
        ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
    });
    let refusal = refusal_text(&set);
    assert!(
        refusal.contains("declared more than once on this agent"),
        "{refusal}"
    );
}

/// **An `implementation` on a capability that offers no arms is refused.** Five capabilities read
/// the field; on the other sixteen there is no resolver to reach the value and nothing to compare it
/// against, so a name written there configures nothing and is recorded as though it had.
#[test]
fn an_implementation_on_a_capability_with_no_arms_is_refused() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig {
            implementation: Some("breadth-first".to_string()),
            ..GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
        },
    );
    let defects = defects(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].found, "breadth-first");
    assert!(
        defects[0].locus.ends_with(".implementation"),
        "{}",
        defects[0].locus
    );
}

/// A blank `implementation` names nothing — it is how an editor spells "unset" — so it reads exactly
/// as an absent field does, on an armless capability and an armed one alike.
#[test]
fn a_blank_implementation_is_the_absent_one() {
    for blank in ["", "   "] {
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig {
                implementation: Some(blank.to_string()),
                ..GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
            },
        );
        assert_eq!(defects(&set), Vec::new(), "{blank:?}");
    }
}

/// **A run-level param written on another profile is refused when it diverges** — the skills
/// directory and the subagent recursion bound are read once, off the first profile, so a different
/// value elsewhere is read by nothing.
#[test]
fn a_diverging_run_level_param_is_refused() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig {
            params: json!({ crate::agent::PARAM_SKILLS_DIR: ".gg/skills" }),
            ..GgCapabilityConfig::enabled(CAPABILITY_SKILLS)
        },
    );
    set.agents.push(GgAgentConfig {
        name: "worker".to_string(),
        capabilities: vec![GgCapabilityConfig {
            params: json!({ crate::agent::PARAM_SKILLS_DIR: "docs/skills" }),
            ..GgCapabilityConfig::enabled(CAPABILITY_SKILLS)
        }],
        ..GgAgentConfig::root()
    });
    let refusal = refusal_text(&set);
    assert!(refusal.contains("docs/skills"), "{refusal}");
}

/// …and the same value on every profile is the ordinary shape, which is what an editor that offers
/// the param per agent writes. A number written two ways (`3` and `3.0`) is one declaration, because
/// that is how the resolver reads it.
#[test]
fn a_run_level_param_repeated_unchanged_is_accepted() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig {
            params: json!({ crate::subagents::PARAM_MAX_DEPTH: 3 }),
            ..GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
        },
    );
    set.agents.push(GgAgentConfig {
        name: "worker".to_string(),
        capabilities: vec![GgCapabilityConfig {
            params: json!({ crate::subagents::PARAM_MAX_DEPTH: 3.0 }),
            ..GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
        }],
        model_id: set.agents[0].model_id.clone(),
        ..GgAgentConfig::root()
    });
    assert_eq!(defects(&set), Vec::new());
}

/// The params of a capability whose **id** is already the defect are not read: there is no
/// vocabulary to read them against, and a second line about them would bury the one that matters.
#[test]
fn an_unknown_capability_ids_params_are_not_read_as_well() {
    let mut set = minimal();
    set.agents[0].capabilities.push(GgCapabilityConfig {
        params: json!({ "anything": 1, "at": "all" }),
        ..GgCapabilityConfig::enabled("memorys")
    });
    let defects = defects(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(defects[0].locus.ends_with(".id"));
}

// ---------------------------------------------------------------------------
// Collect and continue
// ---------------------------------------------------------------------------

/// The behaviour the absorbed `validate_agents` did **not** have: it returned on the first problem,
/// so an operator fixed one typo per launch. Two bad capability ids on one profile are two defects.
#[test]
fn two_defects_on_one_profile_are_both_reported() {
    let mut set = minimal();
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled("memorys"));
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled("compation"));
    let found: Vec<_> = defects(&set)
        .into_iter()
        .map(|defect| defect.found)
        .collect();
    assert_eq!(found, ["memorys", "compation"]);
}

/// A set with no profiles is the one defect that stops the pass: [`GgCapabilitySet::root`] and every
/// check below it assume there is a root, so continuing would report a cascade of consequences
/// rather than the cause.
#[test]
fn an_empty_set_reports_the_cause_and_nothing_else() {
    let set = GgCapabilitySet {
        agents: Vec::new(),
        ..GgCapabilitySet::default()
    };
    let defects = defects(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(defects[0].message.contains("no agent profiles"));
}

// ---------------------------------------------------------------------------
// The golden case
// ---------------------------------------------------------------------------

/// **The board is the run's, so it has one merge agent.** A name gg cannot read is skipped as though
/// it were absent while a *later* profile's silently becomes the run's, and two profiles naming two
/// agents leave exactly one of them read — both are documents that say one thing and runs that do
/// another.
#[test]
fn a_merge_agent_gg_would_read_past_is_refused() {
    let unreadable = json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: 42 });
    let other = json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: "helper" });
    for second in [unreadable.clone(), other] {
        let mut set = minimal();
        crate::tools::grant_configured(
            &mut set.agents[0],
            GgCapabilityConfig {
                params: json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_AGENT }),
                ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
            },
        );
        set.agents.push(GgAgentConfig {
            name: "helper".to_string(),
            model_id: set.agents[0].model_id.clone(),
            capabilities: vec![GgCapabilityConfig {
                params: second.clone(),
                ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
            }],
            ..GgAgentConfig::root()
        });
        let refusal = refusal_text(&set);
        assert!(
            refusal.contains(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT),
            "{second} -> {refusal}"
        );
    }
}

/// …and the same name on every profile is the ordinary shape, which is what the editor writes: it
/// seeds the param on each agent that carries the capability.
#[test]
fn one_merge_agent_named_on_every_profile_is_accepted() {
    let mut set = minimal();
    let params = json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_AGENT });
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            params: params.clone(),
            ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
        },
    );
    set.agents[0].subagents.push(GgSubagentRef::any("helper"));
    set.agents.push(GgAgentConfig {
        name: "helper".to_string(),
        model_id: set.agents[0].model_id.clone(),
        capabilities: vec![GgCapabilityConfig {
            params,
            ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
        }],
        ..GgAgentConfig::root()
    });
    assert_eq!(defects(&set), Vec::new());
}

/// **The property the whole design exists for.** A configuration carrying one defect of every class
/// gg can see is refused **once**, and the refusal names every one of them.
///
/// This is what an operator fixing a sweep's single shared configuration document needs: every typo
/// in one pass, not a dozen launches each revealing the next. Every later stage that teaches a
/// resolver to report a defect extends this case with its class rather than writing a separate one —
/// a defect class that is not in this list is a class that could still be reported alone.
#[test]
fn every_class_of_defect_appears_in_one_refusal() {
    // The root: an unknown capability id, a misspelled params key on a real capability, a roster
    // entry naming nobody, and a board it may file issues on with no implementer to assign them to
    // and no merge agent to resolve their merges. The board is granted through `grant_configured`
    // so the root really holds `create_issue` — the implementer check reads the allowlist, and a
    // board whose calls were never granted is the read-only board that is deliberately fine.
    let mut root = GgAgentConfig {
        model_id: "mock/a".to_string(),
        // Scoped `subagent` only, so this roster grants no implementer — `any` would have
        // satisfied the issue-filer check below and hidden it.
        subagents: vec![GgSubagentRef::new("ghost", &[GgSubagentScope::Subagent])],
        capabilities: vec![
            GgCapabilityConfig::enabled("memorys"),
            GgCapabilityConfig {
                params: json!({ "summryHeadroom": 0.4 }),
                ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
            },
            // The delegation depth is a bound on the **run's** tree, so gg reads it off the root —
            // and the pass reads it from exactly where the run does.
            GgCapabilityConfig {
                params: json!({ crate::subagents::PARAM_MAX_DEPTH: 0 }),
                ..GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
            },
        ],
        ..GgAgentConfig::root()
    };
    crate::tools::grant_configured(
        &mut root,
        GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT),
    );

    let set = GgCapabilitySet {
        agents: vec![
            root,
            // A profile whose every *value* is individually spelled on a key gg knows, and not one
            // of which gg can honour: an arm it does not offer, a limit that is not a count, a
            // scope that names no instance, an ownership that names neither.
            GgAgentConfig {
                name: "resolvers".to_string(),
                model_id: "mock/c".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        implementation: Some("vector-index".to_string()),
                        params: json!({
                            crate::memories::PARAM_MAX_COUNT: "lots",
                            MEMORY_PARAM_SCOPE: "communal",
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
                    },
                    GgCapabilityConfig {
                        implementation: Some("self-compation".to_string()),
                        params: json!({
                            crate::compaction::PARAM_SUMMARY_HEADROOM: 1.5,
                            COMPACTION_PARAM_MODEL_SLOT: "summarizer",
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                    },
                    GgCapabilityConfig {
                        params: json!({ MODULE_PARAM_OWNERSHIP: "communal" }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                    },
                ],
                ..GgAgentConfig::root()
            },
            // …and one whose values are each fine on their own and contradict one another: a
            // memory compaction on a profile that has no memories to write.
            GgAgentConfig {
                name: "contradiction".to_string(),
                model_id: "mock/d".to_string(),
                capabilities: vec![GgCapabilityConfig {
                    implementation: Some(COMPACTION_STRATEGY_MEMORY.to_string()),
                    ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                }],
                ..GgAgentConfig::root()
            },
            // A profile whose model was never bound, and which is declared twice.
            GgAgentConfig {
                name: "worker".to_string(),
                model_id: String::new(),
                model_slot: Some("critic".to_string()),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                name: "worker".to_string(),
                model_id: "mock/b".to_string(),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            // A machine whose only state runs a profile the set does not declare, whose second
            // state nothing can enter, and which carries a worker's configuration a shell never
            // reads.
            GgAgentConfig {
                name: "machine".to_string(),
                model_id: "mock/g".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        params: json!({ "states": [
                            { "name": "only", "agent": "nobody" },
                            { "name": "orphan", "agent": "worker" },
                        ] }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
                    },
                    GgCapabilityConfig::enabled(CAPABILITY_MEMORIES),
                ],
                ..GgAgentConfig::root()
            },
            // A profile whose two delegation capabilities each resolve to a call that is never
            // offered — the misconfiguration a model can never report, because it simply never makes
            // the call.
            GgAgentConfig {
                name: "delegation".to_string(),
                model_id: "mock/h".to_string(),
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_EXEC),
                    GgCapabilityConfig::enabled(CAPABILITY_FORK),
                ],
                ..GgAgentConfig::root()
            },
            // A profile whose allowlists each name a call in the *other* surface's vocabulary: an
            // agent narrowed by accident, which reads exactly like one narrowed on purpose.
            GgAgentConfig {
                name: "allowlists".to_string(),
                model_id: "mock/i".to_string(),
                tools: vec!["fs.read_file".to_string()],
                operations: vec![crate::tools::READ_FILE_TOOL.to_string()],
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            // A profile whose system-prompt override is not a Handlebars template at all. gg used
            // to answer a template it could not render by rendering its own built-in one instead,
            // with no log line anywhere — and the prompt an agent reasons under *is* the
            // experiment.
            GgAgentConfig {
                name: "prompt".to_string(),
                model_id: "mock/j".to_string(),
                system_prompt_template: Some("Build it. {{#if skills}} unclosed".to_string()),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            // A profile whose responses-as-code, tool and skills configuration is spelled on keys
            // gg knows and carries values it cannot honour: an arm it cannot drive, a mode it
            // does not have, two toggle keys that toggle nothing, two sandbox ceilings that
            // bound nothing, a read mode that would have handed the agent *uncapped* reads, and a
            // built-in skill id that switches nothing off.
            GgAgentConfig {
                name: "code".to_string(),
                model_id: "mock/f".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        params: json!({
                            crate::sandbox::PARAM_LANGUAGE: "pythn",
                            crate::sandbox::PARAM_TIMEOUT_SECS: 0,
                            crate::sandbox::PARAM_MAX_MEMORY_BYTES: "lots",
                            crate::docs::PARAM_DOC_VIEW_TYPES: { "returns": true },
                            crate::healing::PARAM_ASSISTANT_MESSAGES: "healed",
                            crate::healing::PARAM_HEALING: { "stripFences": false },
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
                    },
                    GgCapabilityConfig {
                        implementation: Some("default_cap".to_string()),
                        params: json!({ crate::tools::PARAM_LINE_CAP: 0 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_READ_FILE)
                    },
                    GgCapabilityConfig {
                        implementation: Some("offlaod".to_string()),
                        params: json!({ crate::tools::PARAM_MAX_LINES: "lots" }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_SHELL)
                    },
                    GgCapabilityConfig {
                        params: json!({
                            crate::skills::builtin::PARAM_BUILT_INS: { "gg-fileystem": false },
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_SKILLS)
                    },
                ],
                // …and a hook whose `output` names no mode and whose `timeoutSecs` names no
                // duration — the two hook fields that used to be read with no launch diagnostic
                // anywhere behind them.
                hooks: vec![GgHook {
                    event: GgHookEvent::PreShell,
                    action: GgHookAction::Command {
                        command: "cargo build".to_string(),
                        cwd: None,
                        timeout_secs: Some(0.0),
                        output: Some("inlien".to_string()),
                    },
                    name: "build".to_string(),
                }],
                ..GgAgentConfig::root()
            },
            // A profile whose every declared **ceiling** is one gg cannot bound anything with, plus
            // a detector knob and an arm of the same shape.
            // Every value the `code` profile above spelled wrong, spelled right.
            GgAgentConfig {
                name: "code".to_string(),
                model_id: "mock/f".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        params: json!({
                            crate::sandbox::PARAM_LANGUAGE: "python",
                            crate::sandbox::PARAM_TIMEOUT_SECS: 0.5,
                            crate::sandbox::PARAM_MAX_MEMORY_BYTES: 5e8,
                            crate::docs::PARAM_DOC_VIEW_TYPES: { "parameters": true },
                            crate::healing::PARAM_ASSISTANT_MESSAGES: "response-healing",
                            crate::healing::PARAM_HEALING: { "strip-fences": false },
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
                    },
                    GgCapabilityConfig {
                        implementation: Some(crate::tools::READ_MODE_DEFAULT_CAP.to_string()),
                        params: json!({ crate::tools::PARAM_LINE_CAP: 120 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_READ_FILE)
                    },
                    GgCapabilityConfig {
                        implementation: Some(SHELL_OUTPUT_ADAPTIVE.to_string()),
                        params: json!({ crate::tools::PARAM_MAX_LINES: 40 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_SHELL)
                    },
                    GgCapabilityConfig {
                        params: json!({
                            crate::skills::builtin::PARAM_BUILT_INS: { "gg-filesystem": false },
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_SKILLS)
                    },
                ],
                hooks: vec![GgHook {
                    event: GgHookEvent::PreShell,
                    action: GgHookAction::Command {
                        command: "cargo build".to_string(),
                        cwd: None,
                        timeout_secs: None,
                        output: Some(SHELL_OUTPUT_ADAPTIVE.to_string()),
                    },
                    name: "build".to_string(),
                }],
                ..GgAgentConfig::root()
            },
            // …and an override that parses, which is all a launch can ask of one.
            GgAgentConfig {
                name: "prompt".to_string(),
                model_id: "mock/j".to_string(),
                system_prompt_template: Some(
                    "Build it. {{#if skills}}You have skills.{{/if}}".to_string(),
                ),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                name: "ceilings".to_string(),
                model_id: "mock/e".to_string(),
                loop_detection: GgLoopDetection {
                    enabled: true,
                    window_words: Some(0),
                    ..GgLoopDetection::default()
                },
                capabilities: vec![
                    GgCapabilityConfig {
                        params: json!({ crate::tasks::PARAM_MAX_TASKS: 0 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_TASKS)
                    },
                    GgCapabilityConfig {
                        params: json!({ crate::agent::PARAM_TOP_FILE_VIEWS: "several" }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                    },
                    GgCapabilityConfig {
                        params: json!({ crate::programs::PARAM_KEEP: "5" }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY)
                    },
                    GgCapabilityConfig {
                        implementation: Some("pinned".to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_AUTOLOAD_SPECS)
                    },
                    // A second declaration of a capability already on this profile. A lookup
                    // answers with the first, so everything here is read by nothing at all.
                    GgCapabilityConfig::disabled(CAPABILITY_PROGRAM_LIBRARY),
                    // …and an arm on a capability that offers none to choose between.
                    GgCapabilityConfig {
                        implementation: Some("kanban".to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
                    },
                ],
                ..GgAgentConfig::root()
            },
        ],
        // …and the run's own guardrails, none of which bounds anything.
        limits: GgRunLimits {
            max_turns: Some(0),
            max_cost: Some(-1.0),
            // A rate no run could ever exceed. (`0.5` on its own is fine: the window half it did
            // not declare simply takes gg's default.)
            max_error_rate: Some(1.5),
            ..GgRunLimits::default()
        },
        // …and a session hook naming a script gg does not ship. It used to disarm every other hook
        // on this declaration site and let the run start regardless — a gate that silently does not
        // run is worse than no gate, because an operator believes they have one.
        hooks: vec![GgHook {
            event: GgHookEvent::SessionStart,
            action: GgHookAction::BuiltIn {
                script: "trace-everything".to_string(),
            },
            name: "trace".to_string(),
        }],
        ..GgCapabilitySet::default()
    };

    let refusal = refusal_text(&set);
    for expected in [
        // an unresolved model slot
        "model slot",
        // a duplicate profile name
        "more than once",
        // an unknown capability id
        "memorys",
        // an unknown params key
        "summryHeadroom",
        // a roster entry naming an undeclared profile
        "ghost",
        // an issue filer with nobody to assign to
        "no `implementer`",
        // a board with no merge agent
        PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
        // a machine state running an undeclared profile
        "nobody",
        // a memories arm gg does not offer
        "vector-index",
        // a limit that is not a count
        "maxCount",
        // a scope that names no memory instance
        "communal",
        // a compaction arm gg does not offer
        "self-compation",
        // a headroom outside the range gg can reserve
        "1.5",
        // a model slot the launch never bound
        COMPACTION_PARAM_MODEL_SLOT,
        // an ownership that names neither `owned` nor `unowned`
        MODULE_PARAM_OWNERSHIP,
        // a configuration that contradicts itself
        COMPACTION_STRATEGY_MEMORY,
        // a turn ceiling nothing could run under
        "limits.maxTurns",
        // a spend ceiling that is not a figure
        "limits.maxCost",
        // an error rate no run could ever exceed
        "limits.maxErrorRate",
        // a detector knob that cannot bound anything
        "loopDetection.windowWords",
        // a task list the model may never add to
        crate::tasks::PARAM_MAX_TASKS,
        // a file-view count gg cannot read
        crate::agent::PARAM_TOP_FILE_VIEWS,
        // a retention gg cannot read
        crate::programs::PARAM_KEEP,
        // an autoload arm gg does not offer
        "pinned",
        // a capability declared twice, whose second entry is read by nothing
        "declared more than once on this agent",
        // an arm on a capability that offers none
        "kanban",
        // a hook ceiling that names no duration
        "timeoutSecs",
        // a delegation tree the root may not spawn into
        crate::subagents::PARAM_MAX_DEPTH,
        // a language gg cannot drive
        "pythn",
        // a program timeout that bounds nothing
        crate::sandbox::PARAM_TIMEOUT_SECS,
        // a memory cap gg cannot read
        crate::sandbox::PARAM_MAX_MEMORY_BYTES,
        // a documentation-view type key gg does not have
        "returns",
        // an assistant-message mode gg does not have
        "healed",
        // a healing key that arms nothing
        "stripFences",
        // a read mode that would have granted uncapped reads
        "default_cap",
        // a line cap that would return nothing
        crate::tools::PARAM_LINE_CAP,
        // a shell output mode gg does not have
        "offlaod",
        // an inline ceiling gg cannot read
        crate::tools::PARAM_MAX_LINES,
        // a built-in skill id that withholds nothing
        "gg-fileystem",
        // a hook output mode gg does not have
        "inlien",
        // a hook naming a built-in script gg does not ship
        "trace-everything",
        // a machine state nothing can enter
        "unreachable",
        // a worker's configuration on a machine, which reads none of it
        "model binding",
        // a delegation capability whose call could never be offered
        crate::tools::EXEC_TOOL,
        crate::tools::FORK_TOOL,
        // an allowlist entry from the other surface's vocabulary
        "fs.read_file",
        "not a gg operation",
        // a system-prompt override that is not a Handlebars template
        "systemPromptTemplate",
    ] {
        assert!(
            refusal.contains(expected),
            "the single refusal is missing `{expected}`:\n{refusal}"
        );
    }
}

/// …and the same set with every one of those values corrected launches. The refusal has to be
/// *exactly* the set of configurations gg cannot honour: a check that refused a good document would
/// be a worse failure than the fallbacks it replaced.
#[test]
fn the_corrected_configuration_launches() {
    let mut root = GgAgentConfig {
        model_id: "mock/a".to_string(),
        subagents: vec![GgSubagentRef::new(
            "worker",
            &[GgSubagentScope::Implementer],
        )],
        capabilities: vec![
            GgCapabilityConfig::enabled(CAPABILITY_MEMORIES),
            GgCapabilityConfig {
                params: json!({ crate::compaction::PARAM_SUMMARY_HEADROOM: 0.4 }),
                ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
            },
            GgCapabilityConfig {
                params: json!({ crate::subagents::PARAM_MAX_DEPTH: 2 }),
                ..GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
            },
        ],
        ..GgAgentConfig::root()
    };
    crate::tools::grant(&mut root, CAPABILITY_SHELL);
    crate::tools::grant_configured(
        &mut root,
        GgCapabilityConfig {
            params: json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_AGENT }),
            ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
        },
    );

    let set = GgCapabilitySet {
        agents: vec![
            root,
            GgAgentConfig {
                name: "worker".to_string(),
                model_id: "mock/b".to_string(),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            // Every value the golden case above spelled wrong, spelled right — including the arm
            // that needs another capability to be honourable.
            GgAgentConfig {
                name: "resolvers".to_string(),
                model_id: "mock/c".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        implementation: Some(
                            crate::memories::MemoryStrategy::KeywordSearch
                                .id()
                                .to_string(),
                        ),
                        params: json!({
                            crate::memories::PARAM_MAX_COUNT: 40.0,
                            MEMORY_PARAM_SCOPE: "shared",
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
                    },
                    GgCapabilityConfig {
                        implementation: Some(COMPACTION_STRATEGY_MEMORY.to_string()),
                        params: json!({ crate::compaction::PARAM_SUMMARY_HEADROOM: 0.5 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                    },
                    GgCapabilityConfig {
                        params: json!({ MODULE_PARAM_OWNERSHIP: "unowned" }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                    },
                ],
                ..GgAgentConfig::root()
            },
            // A bare shell — no model, no other capability — driving a machine every state of which
            // is reachable from the entry.
            GgAgentConfig {
                name: "machine".to_string(),
                model_id: String::new(),
                capabilities: vec![GgCapabilityConfig {
                    params: json!({ "states": [
                        { "name": "only", "agent": "worker", "transitions": [{ "to": "done" }] },
                        { "name": "done", "agent": "worker" },
                    ] }),
                    ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
                }],
                ..GgAgentConfig::root()
            },
            // Both delegation capabilities with what each of them needs to offer its call, and two
            // allowlist entries each in its own surface's vocabulary.
            GgAgentConfig {
                name: "delegation".to_string(),
                model_id: "mock/h".to_string(),
                subagents: vec![GgSubagentRef::new("worker", &[GgSubagentScope::Subagent])],
                tools: vec![crate::tools::READ_FILE_TOOL.to_string()],
                operations: vec![crate::sandbox::BOARD_CREATE_ISSUE.to_string()],
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_EXEC),
                    GgCapabilityConfig::enabled(CAPABILITY_FORK),
                    GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
                ],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                name: "ceilings".to_string(),
                model_id: "mock/e".to_string(),
                loop_detection: GgLoopDetection {
                    enabled: true,
                    window_words: Some(64),
                    ..GgLoopDetection::default()
                },
                capabilities: vec![
                    GgCapabilityConfig {
                        params: json!({ crate::tasks::PARAM_MAX_TASKS: 20 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_TASKS)
                    },
                    GgCapabilityConfig {
                        params: json!({ crate::agent::PARAM_TOP_FILE_VIEWS: 3 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                    },
                    GgCapabilityConfig {
                        // `0` is the one retention whose zero is the widest setting rather than the
                        // narrowest: keep every program of the session.
                        params: json!({ crate::programs::PARAM_KEEP: 0 }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY)
                    },
                    GgCapabilityConfig {
                        implementation: Some(AUTOLOAD_LOCKED_IMPL.to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_AUTOLOAD_SPECS)
                    },
                ],
                ..GgAgentConfig::root()
            },
        ],
        limits: GgRunLimits {
            max_turns: Some(60),
            max_cost: Some(25.0),
            max_error_rate: Some(0.5),
            error_rate_window: Some(10),
            ..GgRunLimits::default()
        },
        ..GgCapabilitySet::default()
    };
    assert_eq!(defects(&set), Vec::new());
}
