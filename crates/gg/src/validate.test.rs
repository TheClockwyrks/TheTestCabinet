//! **The launch refusal.**
//!
//! One property is what the whole design is for: a configuration gg cannot conduct is refused
//! **once**, naming every value it cannot conduct it by. An operator fixing a sweep's shared
//! document must not have to launch a dozen times to discover a dozen typos.
//!
//! It takes two tests because a configured value fails in two ways, and the second is invisible in
//! the document. [`every_class_of_defect_appears_in_one_refusal`] carries one value of every class
//! gg cannot **honour** — a misspelled key, an arm gg does not offer, a ceiling that bounds
//! nothing — and every later stage that teaches a resolver to report extends it with its own class
//! rather than adding a separate test.
//! [`one_refusal_names_every_value_the_document_leaves_out`] carries a document in which nothing is
//! wrong and nothing is **written**, and derives what it expects from the tables, because a hole is
//! what a hand-written list cannot stay honest about: a param that becomes required opens one in
//! every document already stored, without a line of any of them changing.
//!
//! The rest of the file pins the groups this stage implements — the profile invariants absorbed
//! from the old `validate_agents`, the capability-id vocabulary, the per-capability params
//! vocabulary, and the half of that vocabulary that says which keys an **enabled** capability must
//! actually write — plus the structural guarantees underneath them: the params table covers the
//! capability catalogue exactly, every capability that offers arms has arms to offer, and a
//! [`Discarding`](LaunchReport::Discarding) sink is the assertion it claims to be.

use serde_json::{Value, json};
use test_cabinet_core::gg::{
    ALL_SUBAGENT_SCOPES, AUTOLOAD_LOCKED_IMPL, CAPABILITY_READ_FILE, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, DEFAULT_SIGNAL_THRESHOLD_PERCENT, GgAgentConfig, GgCapabilityConfig,
    GgCapabilitySet, GgHook, GgHookAction, GgHookEvent, GgLoopDetection, GgMemoryScope,
    GgRunLimits, GgSubagentRef, GgSubagentScope, MEMORY_STRATEGY_SCRATCHPAD,
    PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, READ_MODE_DEFAULT_CAP, ROOT_PROFILE_ID,
    SHELL_OUTPUT_OFFLOAD,
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
///
/// The attribution is the profile's **id**, which is what the operator greps the document for; a
/// display name may sit on two profiles, so a line carrying one would not say which to fix.
#[test]
fn a_defect_reads_as_one_line_naming_the_agent_the_locus_and_the_value() {
    let defect = LaunchDefect::on_agent(
        "reviewer-2",
        "capabilities[2].implementation",
        "self-compation",
        "the `compaction` capability names a strategy gg does not offer.",
    )
    .known(["self-summarization", "handoff-summarization"]);
    assert_eq!(
        defect.to_string(),
        "agent `reviewer-2`: capabilities[2].implementation = `self-compation` — the `compaction` \
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

/// **A value nobody wrote is named once, however many readers noticed it.** Two readers do notice
/// it — the sweep over the whole table and the resolver that reads the one key — and both are
/// wanted: the sweep cannot miss a key, and the resolver cannot fall back on one. They produce the
/// same line, because the line comes from the table, so the operator is told about one thing once.
#[test]
fn a_value_is_named_once_however_many_readers_noticed_it() {
    let mut report = LaunchReport::collecting();
    report.report(missing_required_param(CAPABILITY_TASKS, PARAM_MAX_TASKS));
    report.report(missing_required_param(CAPABILITY_TASKS, PARAM_MODE));
    report.report(missing_required_param(CAPABILITY_TASKS, PARAM_MAX_TASKS));
    let loci: Vec<_> = report
        .into_defects()
        .into_iter()
        .map(|defect| defect.locus)
        .collect();
    assert_eq!(
        loci,
        [
            param_locus(CAPABILITY_TASKS, PARAM_MAX_TASKS),
            param_locus(CAPABILITY_TASKS, PARAM_MODE),
        ]
    );
}

/// …and two profiles short of the same param are two lines, because the attribution is part of the
/// value. The stamping happens on the way out of the walk, so the de-duplication has to happen
/// after it.
#[test]
fn two_profiles_short_of_one_param_are_two_lines() {
    let mut report = LaunchReport::collecting();
    for agent in ["root", "worker"] {
        report.for_agent(agent, |report| {
            report.report(missing_required_param(CAPABILITY_TASKS, PARAM_MODE));
        });
    }
    let agents: Vec<_> = report
        .into_defects()
        .into_iter()
        .map(|defect| defect.agent.unwrap_or_default())
        .collect();
    assert_eq!(agents, ["root", "worker"]);
}

// ---------------------------------------------------------------------------
// Reading one param
// ---------------------------------------------------------------------------

/// **A resolver reading a required key reports its own absence**, and hands back nothing for the
/// caller to mistake for a figure. The line it produces is the line the sweep produces, which is
/// what lets both readers exist.
#[test]
fn a_required_param_reports_its_own_absence() {
    for params in [json!({}), json!({ PARAM_MAX_TASKS: null })] {
        let mut report = LaunchReport::collecting();
        assert_eq!(
            required_count_param(&params, CAPABILITY_TASKS, PARAM_MAX_TASKS, &mut report),
            None,
            "{params}"
        );
        let defects = report.into_defects();
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(
            defects[0],
            missing_required_param(CAPABILITY_TASKS, PARAM_MAX_TASKS)
        );
        // The sentence names the knob, not only that one is missing.
        assert!(
            defects[0]
                .message
                .contains("how many tasks the list may hold"),
            "{}",
            defects[0].message
        );
    }
}

/// **An optional key's absence is silent**, because the absence is the setting: nothing to bound,
/// nothing to report, nothing substituted.
#[test]
fn an_optional_param_reads_absence_as_the_setting() {
    let mut report = LaunchReport::collecting();
    let params = json!({});
    assert_eq!(
        count_param(&params, CAPABILITY_TASKS, PARAM_MAX_TASKS, &mut report),
        None
    );
    assert!(report.is_empty());
}

/// A required count that names no count is refused for *that*, on top of being read — and a
/// required ceiling of zero is refused for what a zero would have meant.
#[test]
fn a_required_count_is_still_read_against_its_own_range() {
    let mut report = LaunchReport::collecting();
    let params = json!({ PARAM_MAX_TASKS: "lots" });
    assert_eq!(
        required_count_param(&params, CAPABILITY_TASKS, PARAM_MAX_TASKS, &mut report),
        None
    );
    let zero = json!({ PARAM_MAX_TASKS: 0 });
    assert_eq!(
        required_positive_count_param(
            &zero,
            CAPABILITY_TASKS,
            PARAM_MAX_TASKS,
            "a list nothing may be added to offers a call whose every use is refused",
            &mut report,
        ),
        None
    );
    let defects = report.into_defects();
    assert_eq!(defects.len(), 2, "{defects:?}");
    assert_eq!(defects[0].found, "\"lots\"");
    assert_eq!(defects[1].found, "0");
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
        let mut keys: Vec<&str> = params.iter().map(|(key, _)| *key).collect();
        let written = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), written, "`{id}` names a param twice");
        for (key, requirement) in *params {
            assert!(!key.is_empty(), "`{id}` names an empty param");
            // The requirement carries the clause a refusal reads out, so a key that is required and
            // says nothing about what it configures would refuse the launch with half a sentence.
            if let Requirement::Required(configures) = requirement {
                assert!(
                    !configures.is_empty(),
                    "`{id}`'s `{key}` is required and says nothing about what it configures"
                );
            }
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
    let offers = |id: &str| {
        params_for(id)
            .unwrap()
            .iter()
            .any(|(key, _)| *key == MODULE_PARAM_OWNERSHIP)
    };
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
    assert_eq!(defects[0].agent.as_deref(), Some(ROOT_PROFILE_ID));
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
/// this table is the only thing between `summryHeadroom` and a run that condensed at some headroom
/// nobody wrote while its record named the configured one.
#[test]
fn a_params_key_the_capability_does_not_read_is_refused() {
    let mut set = minimal();
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_COMPACTION).with_param("summryHeadroom", 0.4));
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
            .contains(&PARAM_SUMMARY_HEADROOM.to_string()),
        "the refusal offers the vocabulary: {:?}",
        defects[0].known
    );
}

/// A key that is a real gg param **on another capability** is still unknown here. `ownership` on
/// `memories` reads as though it configured something and configures nothing at all.
#[test]
fn a_params_key_belonging_to_another_capability_is_refused() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
            .with_param(MODULE_PARAM_OWNERSHIP, "owned"),
    );
    assert!(refusal_text(&set).contains(MODULE_PARAM_OWNERSHIP));
}

/// **The deliberate exception.** A key known to the capability but unused by the arm its
/// `implementation` selected is accepted: one params block swept across all three memory strategies
/// without retyping it is the point of the block, and `maxResults` is inert under `scratchpad`
/// rather than wrong. Required means required **whichever arm is selected**, for the same reason.
#[test]
fn a_params_key_the_selected_arm_does_not_use_is_accepted() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig {
            implementation: Some(MEMORY_STRATEGY_SCRATCHPAD.to_string()),
            ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES).with_param(PARAM_MAX_RESULTS, 5)
        },
    );
    assert_eq!(defects(&set), Vec::new());
}

/// **An absent params object is accepted where the capability requires nothing** — the ordinary
/// shape of one with nothing to tune, and of every disabled capability whatever it could tune.
#[test]
fn an_absent_or_empty_params_object_is_accepted_where_nothing_is_required() {
    for params in [json!({}), json!(null)] {
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig {
                params: params.clone(),
                ..GgCapabilityConfig::enabled(CAPABILITY_WRITE_FILE)
            },
        );
        put(
            &mut set,
            GgCapabilityConfig {
                params,
                ..GgCapabilityConfig::disabled(CAPABILITY_PROGRAM_LIBRARY)
            },
        );
        assert_eq!(defects(&set), Vec::new());
    }
}

/// **Every required key, absent from an enabled capability, refuses the launch by name.** This is
/// the whole of "absence is never a value" read off the table: gg has no figure to put there, so
/// the alternative to refusing is conducting a run under a number, a name or a mode nobody wrote.
///
/// Each capability is switched on carrying an empty params object, and every key the table marks
/// [required](Requirement::Required) has to appear at its own locus in the refusal.
#[test]
fn every_required_param_absent_from_an_enabled_capability_is_refused() {
    for (id, params) in CAPABILITY_PARAMS {
        let required: Vec<&str> = params
            .iter()
            .filter(|(_, requirement)| matches!(requirement, Requirement::Required(_)))
            .map(|(key, _)| *key)
            .collect();
        if required.is_empty() {
            continue;
        }
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig {
                params: json!({}),
                ..GgCapabilityConfig::enabled(*id)
            },
        );
        let refusal = refusal_text(&set);
        for key in required {
            assert!(
                refusal.contains(&param_locus(id, key)),
                "`{id}` launched without its `{key}`:\n{refusal}"
            );
        }
    }
}

/// …and the same key absent from a **disabled** capability is no defect at all. An off capability
/// configures nothing, so there is no value it could be short of, and requiring a full params block
/// there would refuse the document that expresses the off arm of a comparison.
#[test]
fn a_required_param_absent_from_a_disabled_capability_is_not_refused() {
    for id in GG_CAPABILITY_CATALOG {
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig {
                params: json!({}),
                implementation: None,
                ..GgCapabilityConfig::disabled(*id)
            },
        );
        assert_eq!(defects(&set), Vec::new(), "`{id}` was refused while off");
    }
}

/// **The context-usage signal's threshold is the one key gg answers an absence with a figure.**
///
/// Every other param an enabled capability leaves out refuses the launch. This one names a share of
/// the window the block is held back to, where "off" reads as neither "every turn" nor "never", so
/// the absence is the [default](DEFAULT_SIGNAL_THRESHOLD_PERCENT) — written into every new document
/// by the authoring catalog, so the record still says what the run was conducted under.
#[test]
fn a_signal_threshold_nobody_wrote_is_the_default_rather_than_a_refusal() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig {
            params: json!({ PARAM_TOP_FILE_VIEWS: 5, MODULE_PARAM_OWNERSHIP: "owned" }),
            ..GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
        },
    );
    assert_eq!(defects(&set), Vec::new());

    // The authoring catalog writes the figure, so a freshly authored capability carries it and a
    // run's record names the share it was conducted under.
    assert_eq!(
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
            .params
            .get(PARAM_SIGNAL_THRESHOLD_PERCENT)
            .and_then(serde_json::Value::as_u64),
        Some(DEFAULT_SIGNAL_THRESHOLD_PERCENT)
    );
}

/// **A written threshold is read on the ordinary terms.** A share of a window is between nothing and
/// all of it, so a percentage past a hundred names a block no window ever earns, and one gg cannot
/// read as a number names nothing at all. `0` is honoured: it is the block on every turn.
#[test]
fn a_signal_threshold_gg_cannot_honour_refuses_the_launch() {
    let threshold = |value: Value| {
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                .with_param(PARAM_SIGNAL_THRESHOLD_PERCENT, value),
        );
        set
    };
    let locus = param_locus(
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        PARAM_SIGNAL_THRESHOLD_PERCENT,
    );

    for refused in [json!(101), json!(750), json!("three quarters"), json!(-5)] {
        let refusal = refusal_text(&threshold(refused.clone()));
        assert!(
            refusal.contains(&locus),
            "`{refused}` names no share of a window:\n{refusal}"
        );
    }

    for honoured in [json!(0), json!(75), json!(100), json!(80.0)] {
        assert_eq!(
            defects(&threshold(honoured.clone())),
            Vec::new(),
            "`{honoured}` is a share gg can hold the block back to"
        );
    }

    // A **disabled** capability is shown no signal at all and so is owed nothing, while what it does
    // write is still read — the on and off arms of one comparison are judged the same way.
    let mut off = minimal();
    put(
        &mut off,
        GgCapabilityConfig {
            enabled: false,
            ..GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                .with_param(PARAM_SIGNAL_THRESHOLD_PERCENT, 120)
        },
    );
    assert!(refusal_text(&off).contains(&locus));
}

/// **An off-when-absent key is a setting, not a hole.** Compaction's summarizer model and the
/// board's reviewer requirement are each read when written and mean something definite when they
/// are not: the agent condenses on its own model, and an issue's author names reviewers or does
/// not. So a fully specified capability that writes neither launches.
#[test]
fn an_off_when_absent_param_may_be_left_out() {
    for (id, params) in CAPABILITY_PARAMS {
        let optional: Vec<&str> = params
            .iter()
            .filter(|(_, requirement)| *requirement == Requirement::OffWhenAbsent)
            .map(|(key, _)| *key)
            .collect();
        if optional.is_empty() {
            continue;
        }
        // The authoring catalog writes what a capability requires and nothing whose absence is
        // itself the setting, so a freshly authored capability is exactly this case.
        let authored = GgCapabilityConfig::enabled(*id);
        for key in &optional {
            assert!(
                authored.params.get(key).is_none(),
                "`{id}` is authored with an off-when-absent `{key}`"
            );
        }
        let mut set = minimal();
        put(&mut set, authored);
        // The board needs a roster and a merge agent before it is a launchable document at all;
        // what this case is about is that nothing complains about the key nobody wrote.
        let refusal = defects(&set)
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        for key in optional {
            assert!(
                !refusal.contains(&param_locus(id, key)),
                "`{id}` was refused for the `{key}` nobody wrote:\n{refusal}"
            );
        }
    }
}

/// **The one required param nothing may author.** Responses-as-code's `language` is the axis a
/// cross-language study slices its arms by, so there is no figure a catalog could put in front of
/// an operator to keep or change: a profile that switches the capability on names a language
/// itself, and one that does not is refused before it spends a token.
///
/// The switch decides whether it may be left out, not whether it is read: a tool-calling agent
/// writes no programs, and the editor saves it with an off responses-as-code block, which is a
/// document saying it is not a code agent rather than one with a hole in it.
#[test]
fn a_code_agent_that_names_no_language_is_refused() {
    let locus = param_locus(CAPABILITY_RESPONSES_AS_CODE, PARAM_LANGUAGE);
    for language in [json!(null), json!("typescript")] {
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
                .with_param(PARAM_LANGUAGE, language.clone()),
        );
        let named: Vec<LaunchDefect> = defects(&set)
            .into_iter()
            .filter(|defect| defect.locus == locus)
            .collect();
        if language.is_null() {
            // **One** line, worded from the table. Two readers notice this hole — the params
            // sweep, which cannot miss a required key, and the language resolver, which cannot
            // reach one without reporting it — and because both take their sentence from the
            // table rather than from their own call site, the operator is told about one thing to
            // fix rather than two.
            let swept = missing_required_param(CAPABILITY_RESPONSES_AS_CODE, PARAM_LANGUAGE);
            assert_eq!(named.len(), 1, "{language} -> {named:?}");
            assert_eq!(named[0].message, swept.message);
            assert!(named[0].found.is_empty(), "{named:?}");
            assert_eq!(named[0].agent.as_deref(), Some(ROOT_PROFILE_ID));
        } else {
            assert!(named.is_empty(), "{language} -> {named:?}");
        }

        // …and the same capability switched off requires nothing of itself.
        let mut off = minimal();
        put(
            &mut off,
            GgCapabilityConfig {
                params: json!({}),
                ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
            },
        );
        assert_eq!(defects(&off), Vec::new());
    }
}

/// `params` that is not an object at all has no named values in it, so there is nothing gg can
/// read. It is the **one** line the refusal carries: a list of every param the capability is
/// therefore missing would bury the sentence that says why it is missing them.
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
        params: json!({ PARAM_MAX_COUNT: -4 }),
        ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
    });
    let refusal = refusal_text(&set);
    assert!(
        refusal.contains("declared more than once on this agent"),
        "{refusal}"
    );
}

/// **The arms table lines up with the code that selects on the arms.** A capability listed as
/// offering arms whose vocabulary is empty would refuse every launch that names one; a capability
/// with arms and no entry would let a name gg cannot select stand.
#[test]
fn every_capability_with_arms_has_arms_to_offer() {
    for (id, rule) in CAPABILITIES_WITH_ARMS {
        assert!(
            GG_CAPABILITY_CATALOG.contains(id),
            "`{id}` offers arms but is not a capability gg ships"
        );
        assert!(!arms_of(id).is_empty(), "`{id}` offers arms but names none");
        // The one capability whose unwritten arm is a declaration is the one whose written arm has
        // an alternative to be the alternative *to*.
        if *rule == ArmRule::AbsenceIsAnArm {
            assert_eq!(*id, CAPABILITY_AUTOLOAD_SPECS);
            assert_eq!(arms_of(id), vec![AUTOLOAD_LOCKED_IMPL]);
        }
    }
    for id in GG_CAPABILITY_CATALOG {
        if arm_rule(id).is_none() {
            assert!(
                arms_of(id).is_empty(),
                "`{id}` has arms but is not in the table"
            );
        }
    }
}

/// **An enabled capability that offers arms and names none is refused.** The arm is what the
/// capability is varied by, so gg has nothing to select and will not select anything: a run
/// conducted on one arm while its record names no arm at all measures nothing.
#[test]
fn an_enabled_capability_that_names_no_arm_is_refused() {
    for (id, rule) in CAPABILITIES_WITH_ARMS {
        for implementation in [None, Some(String::new()), Some("  ".to_string())] {
            let mut set = minimal();
            put(
                &mut set,
                GgCapabilityConfig {
                    implementation: implementation.clone(),
                    ..GgCapabilityConfig::enabled(*id)
                },
            );
            let named: Vec<LaunchDefect> = defects(&set)
                .into_iter()
                .filter(|defect| defect.locus.ends_with(".implementation"))
                .collect();
            match rule {
                // Absent, blank or whitespace all name nothing, and an editor spells "unset" every
                // one of those ways.
                ArmRule::Required => {
                    assert_eq!(named.len(), 1, "`{id}` {implementation:?} -> {named:?}");
                    assert!(named[0].found.is_empty(), "{:?}", named[0]);
                    assert_eq!(
                        named[0].known,
                        arms_of(id)
                            .iter()
                            .map(ToString::to_string)
                            .collect::<Vec<_>>(),
                        "{:?}",
                        named[0]
                    );
                }
                // …and where absence is itself an arm, naming nothing is a configured run.
                ArmRule::AbsenceIsAnArm => {
                    assert!(named.is_empty(), "`{id}` {implementation:?} -> {named:?}");
                }
            }

            // Off, the arm is owed on neither rule: what a disabled capability carries is the
            // configuration the arm would have used, and an operator who has not picked one has
            // written a document that says so.
            let mut off = minimal();
            put(
                &mut off,
                GgCapabilityConfig {
                    implementation,
                    ..GgCapabilityConfig::disabled(*id)
                },
            );
            assert_eq!(defects(&off), Vec::new(), "`{id}` was refused while off");
        }
    }
}

/// **An enabled memories capability names its strategy under every scope, inheriting included.**
///
/// An inheriting profile usually binds the store its spawner keeps — but every place gg starts one
/// with no spawner to hand it a store (the root, an issue's implementer, a reviewer, a subagent
/// whose spawner keeps no memories) it organizes a notebook of its own instead, and an arm it never
/// named would be one gg picked. The pairing rule that keeps the two ends of an inheritance
/// agreeing lives in [`check_scoping`](crate::memories::check_scoping), not here.
#[test]
fn an_enabled_memories_capability_names_its_strategy_under_every_scope() {
    for scope in GgMemoryScope::ALL {
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig {
                implementation: None,
                ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
                    .with_param(MEMORY_PARAM_SCOPE, json!(scope.as_str()))
            },
        );
        let named: Vec<LaunchDefect> = defects(&set)
            .into_iter()
            .filter(|defect| defect.locus.ends_with(".implementation"))
            .collect();
        assert_eq!(named.len(), 1, "`{scope}` -> {named:?}");
    }
    // …and one that names it launches, under every scope.
    for scope in GgMemoryScope::ALL {
        let mut set = minimal();
        put(
            &mut set,
            GgCapabilityConfig {
                implementation: Some(MEMORY_STRATEGY_SCRATCHPAD.to_string()),
                ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
                    .with_param(MEMORY_PARAM_SCOPE, json!(scope.as_str()))
            },
        );
        assert_eq!(defects(&set), Vec::new(), "`{scope}` was refused");
    }
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

/// A blank `implementation` names nothing — it is how an editor spells "unset" — so on a capability
/// that offers no arms it reads exactly as an absent field does, and neither is a defect. (On one
/// that offers arms it also reads as absent, which is the refusal
/// [above](an_enabled_capability_that_names_no_arm_is_refused).)
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

/// **A run-level param written on another profile is refused when it diverges** — the subagent
/// recursion bound is read once, off the first profile, so a different value elsewhere is read by
/// nothing.
#[test]
fn a_diverging_run_level_param_is_refused() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS).with_param(PARAM_MAX_DEPTH, 3),
    );
    set.agents.push(GgAgentConfig {
        slug: "worker".to_string(),
        name: "worker".to_string(),
        model_id: set.agents[0].model_id.clone(),
        capabilities: vec![
            GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS).with_param(PARAM_MAX_DEPTH, 5),
        ],
        ..GgAgentConfig::root()
    });
    let refusal = refusal_text(&set);
    assert!(refusal.contains('5'), "{refusal}");
}

/// **A skills directory is a per-agent param**: one profile may read `.gg/skills` while another
/// reads a directory of its own, because a library belongs to the agent that loads it.
#[test]
fn a_skills_directory_may_differ_per_agent() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS).with_param(PARAM_SKILLS_DIR, ".gg/skills"),
    );
    set.agents.push(GgAgentConfig {
        slug: "worker".to_string(),
        name: "worker".to_string(),
        capabilities: vec![
            GgCapabilityConfig::enabled(CAPABILITY_SKILLS)
                .with_param(PARAM_SKILLS_DIR, "docs/skills"),
        ],
        model_id: set.agents[0].model_id.clone(),
        ..GgAgentConfig::root()
    });
    assert_eq!(defects(&set), Vec::new());
}

/// …and the same value on every profile is the ordinary shape, which is what an editor that offers
/// the param per agent writes. A number written two ways (`3` and `3.0`) is one declaration, because
/// that is how the resolver reads it.
#[test]
fn a_run_level_param_repeated_unchanged_is_accepted() {
    let mut set = minimal();
    put(
        &mut set,
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS).with_param(PARAM_MAX_DEPTH, 3),
    );
    set.agents.push(GgAgentConfig {
        slug: "worker".to_string(),
        name: "worker".to_string(),
        capabilities: vec![
            GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS).with_param(PARAM_MAX_DEPTH, 3.0),
        ],
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
// Profile ids
// ---------------------------------------------------------------------------

/// **A repeated profile id is refused.** Every reference — a roster entry, a machine's state, an
/// issue's implementer, the merge agent — resolves through [`GgCapabilitySet::agent`], which
/// answers with the first profile carrying the id. A second profile with that id is therefore not a
/// cosmetic clash: it is a profile nothing in the document can address.
#[test]
fn a_repeated_profile_id_is_refused() {
    let mut set = minimal();
    set.agents.push(GgAgentConfig {
        slug: set.agents[0].slug.clone(),
        name: "Twin".to_string(),
        model_id: set.agents[0].model_id.clone(),
        capabilities: Vec::new(),
        ..GgAgentConfig::root()
    });
    let refusal = refusal_text(&set);
    assert!(refusal.contains("more than once"), "{refusal}");
}

/// …and an **empty** id is refused on its own terms: a profile nothing can name.
#[test]
fn an_empty_profile_id_is_refused() {
    let mut set = minimal();
    set.agents[0].slug = "  ".to_string();
    let refusal = refusal_text(&set);
    assert!(refusal.contains("agents[0].id"), "{refusal}");
}

/// **Two profiles may share a name.** A name is display text — what a console list and a roster's
/// prose call the profile — and nothing resolves a reference by reading one, so a set carrying two
/// `Reviewer`s launches, and each is still addressed apart by its own id.
#[test]
fn two_profiles_may_share_a_name_and_are_addressed_apart_by_id() {
    let mut set = minimal();
    set.agents[0].name = "Reviewer".to_string();
    set.agents[0].subagents = vec![GgSubagentRef::any("reviewer-2")];
    set.agents.push(GgAgentConfig {
        slug: "reviewer-2".to_string(),
        name: "Reviewer".to_string(),
        model_id: set.agents[0].model_id.clone(),
        capabilities: Vec::new(),
        ..GgAgentConfig::root()
    });
    assert_eq!(defects(&set), Vec::new());
    assert_eq!(
        set.agent("reviewer-2").map(|a| a.slug.as_str()),
        Some("reviewer-2")
    );
    assert_eq!(
        set.agent(ROOT_PROFILE_ID).map(|a| a.slug.as_str()),
        Some(ROOT_PROFILE_ID)
    );
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
    for second in [json!(42), json!("helper")] {
        let mut set = minimal();
        crate::tools::grant_configured(
            &mut set.agents[0],
            GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
                .with_param(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, ROOT_PROFILE_ID),
        );
        set.agents.push(GgAgentConfig {
            slug: "helper".to_string(),
            name: "helper".to_string(),
            model_id: set.agents[0].model_id.clone(),
            capabilities: vec![
                GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
                    .with_param(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, second.clone()),
            ],
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
    let board = || {
        GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
            .with_param(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, ROOT_PROFILE_ID)
    };
    crate::tools::grant_configured(&mut set.agents[0], board());
    set.agents[0].subagents.push(GgSubagentRef::any("helper"));
    set.agents.push(GgAgentConfig {
        slug: "helper".to_string(),
        name: "helper".to_string(),
        model_id: set.agents[0].model_id.clone(),
        capabilities: vec![board()],
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
            GgCapabilityConfig::enabled(CAPABILITY_COMPACTION).with_param("summryHeadroom", 0.4),
            // The delegation depth is a bound on the **run's** tree, so gg reads it off the root —
            // and the pass reads it from exactly where the run does.
            GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS).with_param(PARAM_MAX_DEPTH, 0),
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
                slug: "resolvers".to_string(),
                name: "resolvers".to_string(),
                model_id: "mock/c".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        implementation: Some("vector-index".to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
                            .with_param(PARAM_MAX_COUNT, "lots")
                            .with_param(MEMORY_PARAM_SCOPE, "communal")
                    },
                    GgCapabilityConfig {
                        implementation: Some("self-compation".to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                            .with_param(PARAM_SUMMARY_HEADROOM, 1.5)
                            .with_param(COMPACTION_PARAM_MODEL_SLOT, "summarizer")
                    },
                    GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                        .with_param(MODULE_PARAM_OWNERSHIP, "communal"),
                ],
                ..GgAgentConfig::root()
            },
            // …and one whose values are each fine on their own and contradict one another: a
            // memory compaction on a profile that has no memories to write.
            GgAgentConfig {
                slug: "contradiction".to_string(),
                name: "contradiction".to_string(),
                model_id: "mock/d".to_string(),
                capabilities: vec![GgCapabilityConfig {
                    implementation: Some(COMPACTION_STRATEGY_MEMORY.to_string()),
                    ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                }],
                ..GgAgentConfig::root()
            },
            // …and one that is not wrong about anything: it is simply **unspecified**. An enabled
            // capability that names no arm, and one whose params object is empty of the two keys it
            // requires. gg has nothing to put in either hole, so both refuse the launch rather than
            // being filled in behind the operator.
            GgAgentConfig {
                slug: "unspecified".to_string(),
                name: "unspecified".to_string(),
                model_id: "mock/k".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        implementation: None,
                        ..GgCapabilityConfig::enabled(CAPABILITY_SHELL)
                    },
                    GgCapabilityConfig {
                        params: json!({}),
                        ..GgCapabilityConfig::enabled(CAPABILITY_TASKS)
                    },
                ],
                ..GgAgentConfig::root()
            },
            // A profile whose model was never bound, and whose id is declared twice.
            GgAgentConfig {
                slug: "worker".to_string(),
                name: "worker".to_string(),
                model_id: String::new(),
                model_slot: Some("critic".to_string()),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "worker".to_string(),
                name: "worker".to_string(),
                model_id: "mock/b".to_string(),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            // A machine whose only state runs a profile the set does not declare, whose second
            // state nothing can enter, and which carries a worker's configuration a shell never
            // reads.
            GgAgentConfig {
                slug: "machine".to_string(),
                name: "machine".to_string(),
                model_id: "mock/g".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        params: json!({ "states": [
                            { "name": "only", "agentId": "nobody" },
                            { "name": "orphan", "agentId": "worker" },
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
                slug: "delegation".to_string(),
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
                slug: "allowlists".to_string(),
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
                slug: "prompt".to_string(),
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
                slug: "code".to_string(),
                name: "code".to_string(),
                model_id: "mock/f".to_string(),
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
                        .with_param(PARAM_LANGUAGE, "pythn")
                        .with_param(PARAM_TIMEOUT_SECS, 0)
                        .with_param(PARAM_MAX_MEMORY_BYTES, "lots")
                        .with_param(PARAM_DOC_VIEW_TYPES, json!({ "returns": true }))
                        .with_param(PARAM_ASSISTANT_MESSAGES, "healed")
                        .with_param(PARAM_HEALING, json!({ "stripFences": false })),
                    GgCapabilityConfig {
                        implementation: Some("default_cap".to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_READ_FILE)
                            .with_param(PARAM_LINE_CAP, 0)
                    },
                    GgCapabilityConfig {
                        implementation: Some("offlaod".to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_SHELL)
                            .with_param(PARAM_MAX_LINES, "lots")
                    },
                    GgCapabilityConfig::enabled(CAPABILITY_SKILLS)
                        .with_param(PARAM_BUILT_INS, json!({ "gg-fileystem": false })),
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
            // Every value the `code` profile above spelled wrong, spelled right — and carrying the
            // same display name, which is no defect at all: the two are told apart by their ids.
            GgAgentConfig {
                slug: "code-2".to_string(),
                name: "code".to_string(),
                model_id: "mock/f".to_string(),
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
                        .with_param(PARAM_LANGUAGE, "python")
                        .with_param(PARAM_TIMEOUT_SECS, 0.5)
                        .with_param(PARAM_MAX_MEMORY_BYTES, 5e8)
                        .with_param(PARAM_DOC_VIEW_TYPES, json!({ "parameters": true }))
                        .with_param(PARAM_ASSISTANT_MESSAGES, "response-healing")
                        .with_param(PARAM_HEALING, json!({ "strip-fences": false })),
                    GgCapabilityConfig {
                        implementation: Some(READ_MODE_DEFAULT_CAP.to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_READ_FILE)
                            .with_param(PARAM_LINE_CAP, 120)
                    },
                    GgCapabilityConfig {
                        implementation: Some(SHELL_OUTPUT_OFFLOAD.to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_SHELL)
                            .with_param(PARAM_MAX_LINES, 40)
                    },
                    GgCapabilityConfig::enabled(CAPABILITY_SKILLS)
                        .with_param(PARAM_BUILT_INS, json!({ "gg-filesystem": false })),
                ],
                hooks: vec![GgHook {
                    event: GgHookEvent::PreShell,
                    action: GgHookAction::Command {
                        command: "cargo build".to_string(),
                        cwd: None,
                        timeout_secs: Some(600.0),
                        output: Some(SHELL_OUTPUT_OFFLOAD.to_string()),
                    },
                    name: "build".to_string(),
                }],
                ..GgAgentConfig::root()
            },
            // …and an override that parses, which is all a launch can ask of one.
            GgAgentConfig {
                slug: "prompt-2".to_string(),
                name: "prompt".to_string(),
                model_id: "mock/j".to_string(),
                system_prompt_template: Some(
                    "Build it. {{#if skills}}You have skills.{{/if}}".to_string(),
                ),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "ceilings".to_string(),
                name: "ceilings".to_string(),
                model_id: "mock/e".to_string(),
                // An armed detector that bounds nothing with the one knob it wrote, and writes
                // none of the other four.
                loop_detection: GgLoopDetection {
                    enabled: true,
                    window_words: Some(0),
                    ..GgLoopDetection::default()
                },
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_TASKS).with_param(PARAM_MAX_TASKS, 0),
                    GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                        .with_param(PARAM_TOP_FILE_VIEWS, "several"),
                    GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY)
                        .with_param(PARAM_KEEP, "5"),
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
            // A rate no run could ever exceed — and, with `..default()`, neither of the two
            // ceilings a run has no "off" for.
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
    // The two loci an unspecified capability earns, spelled the way the table spells them rather
    // than written out here.
    let (max_tasks, task_mode) = (
        param_locus(CAPABILITY_TASKS, PARAM_MAX_TASKS),
        param_locus(CAPABILITY_TASKS, PARAM_MODE),
    );
    for expected in [
        // an unresolved model slot
        "model slot",
        // a profile id declared twice, which every reference to it would resolve ambiguously
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
        // a detector knob that cannot bound anything, and the four the armed profile never wrote
        "loopDetection.windowWords",
        "loopDetection.repeatThreshold",
        "loopDetection.minOffenders",
        "loopDetection.minSaturatedRun",
        "loopDetection.maxResponseChars",
        // the two run-level ceilings a run has no "off" for, neither of them written
        "limits.maxParallel",
        "limits.replayMaxBytes",
        // a task list the model may never add to
        PARAM_MAX_TASKS,
        // a file-view count gg cannot read
        PARAM_TOP_FILE_VIEWS,
        // a retention gg cannot read
        PARAM_KEEP,
        // an autoload arm gg does not offer
        "pinned",
        // an enabled capability that names no arm at all
        "names no implementation",
        // …and one short of the params it requires, named at each of the two loci
        max_tasks.as_str(),
        task_mode.as_str(),
        // a capability declared twice, whose second entry is read by nothing
        "declared more than once on this agent",
        // an arm on a capability that offers none
        "kanban",
        // a hook ceiling that names no duration
        "timeoutSecs",
        // a delegation tree the root may not spawn into
        PARAM_MAX_DEPTH,
        // a language gg cannot drive
        "pythn",
        // a program timeout that bounds nothing
        PARAM_TIMEOUT_SECS,
        // a memory cap gg cannot read
        PARAM_MAX_MEMORY_BYTES,
        // a documentation-view type key gg does not have
        "returns",
        // an assistant-message mode gg does not have
        "healed",
        // a healing key that arms nothing
        "stripFences",
        // a read mode that would have granted uncapped reads
        "default_cap",
        // a line cap that would return nothing
        PARAM_LINE_CAP,
        // a shell output mode gg does not have
        "offlaod",
        // an inline ceiling gg cannot read
        PARAM_MAX_LINES,
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
            GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                .with_param(PARAM_SUMMARY_HEADROOM, 0.4),
            GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS).with_param(PARAM_MAX_DEPTH, 2),
        ],
        ..GgAgentConfig::root()
    };
    crate::tools::grant(&mut root, CAPABILITY_SHELL);
    crate::tools::grant_configured(
        &mut root,
        GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
            .with_param(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, ROOT_PROFILE_ID),
    );

    let set = GgCapabilitySet {
        agents: vec![
            root,
            GgAgentConfig {
                slug: "worker".to_string(),
                name: "worker".to_string(),
                model_id: "mock/b".to_string(),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
            // Every value the golden case above spelled wrong, spelled right — including the arm
            // that needs another capability to be honourable.
            GgAgentConfig {
                slug: "resolvers".to_string(),
                name: "resolvers".to_string(),
                model_id: "mock/c".to_string(),
                capabilities: vec![
                    GgCapabilityConfig {
                        implementation: Some(
                            crate::memories::MemoryStrategy::KeywordSearch
                                .id()
                                .to_string(),
                        ),
                        ..GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
                            .with_param(PARAM_MAX_COUNT, 40.0)
                            .with_param(MEMORY_PARAM_SCOPE, "shared")
                    },
                    GgCapabilityConfig {
                        implementation: Some(COMPACTION_STRATEGY_MEMORY.to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                            .with_param(PARAM_SUMMARY_HEADROOM, 0.5)
                    },
                    GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                        .with_param(MODULE_PARAM_OWNERSHIP, "unowned"),
                ],
                ..GgAgentConfig::root()
            },
            // A bare shell — no model, no other capability — driving a machine every state of which
            // is reachable from the entry.
            GgAgentConfig {
                slug: "machine".to_string(),
                name: "machine".to_string(),
                model_id: String::new(),
                capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_FSM).with_param(
                    FSM_PARAM_STATES,
                    json!([
                        { "name": "only", "agentId": "worker", "transitions": [{ "to": "done" }] },
                        { "name": "done", "agentId": "worker" },
                    ]),
                )],
                ..GgAgentConfig::root()
            },
            // Both delegation capabilities with what each of them needs to offer its call, and two
            // allowlist entries each in its own surface's vocabulary.
            GgAgentConfig {
                slug: "delegation".to_string(),
                name: "delegation".to_string(),
                model_id: "mock/h".to_string(),
                subagents: vec![GgSubagentRef::new("worker", &[GgSubagentScope::Subagent])],
                tools: vec![crate::tools::READ_FILE_TOOL.to_string()],
                operations: vec![crate::sandbox::BOARD_CREATE_ISSUE.to_string()],
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_EXEC),
                    GgCapabilityConfig::enabled(CAPABILITY_FORK),
                    // The recursion bound is the run's, read off the root, so a profile that
                    // declares one at all declares the one in force.
                    GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)
                        .with_param(PARAM_MAX_DEPTH, 2),
                ],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "ceilings".to_string(),
                name: "ceilings".to_string(),
                model_id: "mock/e".to_string(),
                // An armed detector writes all five knobs; there is no half-armed detector, and
                // nothing gg would fill the other four in with.
                loop_detection: GgLoopDetection {
                    enabled: true,
                    window_words: Some(64),
                    repeat_threshold: Some(3),
                    min_offenders: Some(2),
                    min_saturated_run: Some(0),
                    max_response_chars: Some(0),
                },
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_TASKS).with_param(PARAM_MAX_TASKS, 20),
                    GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                        .with_param(PARAM_TOP_FILE_VIEWS, 3),
                    // `0` is the one retention whose zero is the widest setting rather than the
                    // narrowest: keep every program of the session.
                    GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY)
                        .with_param(PARAM_KEEP, 0),
                    GgCapabilityConfig {
                        implementation: Some(AUTOLOAD_LOCKED_IMPL.to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_AUTOLOAD_SPECS)
                    },
                ],
                ..GgAgentConfig::root()
            },
        ],
        // The two required ceilings, plus the four this run chose to arm.
        limits: GgRunLimits {
            max_turns: Some(60),
            max_cost: Some(25.0),
            max_error_rate: Some(0.5),
            error_rate_window: Some(10),
            ..GgRunLimits::authored()
        },
        ..GgCapabilitySet::default()
    };
    assert_eq!(defects(&set), Vec::new());
}

// ---------------------------------------------------------------------------
// Every hole at once
// ---------------------------------------------------------------------------

/// **A document that writes none of what it owes is refused once, naming every one of them.**
///
/// [The refusal above](every_class_of_defect_appears_in_one_refusal) proves the one-pass property
/// over the classes of value gg cannot honour. This proves it over the values nobody wrote — the
/// half a hand-written list cannot keep honest, because a hole is invisible in the document and a
/// new required key adds one without editing a line of it.
///
/// So every locus expected here is **derived**: from the [params table](CAPABILITY_PARAMS), from
/// [the arm rules](CAPABILITIES_WITH_ARMS), from the run's two ceilings that have no off, and from
/// the five terms an armed detector is measured by. A key that becomes required joins this test by
/// joining the table, and a resolver that quietly filled one in behind the operator fails here
/// rather than in a sweep's results six hours later.
///
/// The document is the awkward one on purpose: nothing in it is misspelled, out of range or
/// contradictory. It is simply silent, which is the one state gg has no reading of.
#[test]
fn one_refusal_names_every_value_the_document_leaves_out() {
    // Every capability gg ships, each switched **on** and each writing nothing at all: no arm, and
    // a params object carrying none of its keys.
    let capabilities: Vec<GgCapabilityConfig> = GG_CAPABILITY_CATALOG
        .iter()
        .map(|id| GgCapabilityConfig {
            implementation: None,
            params: json!({}),
            ..GgCapabilityConfig::enabled(*id)
        })
        .collect();

    let set = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            model_id: "mock/echo".to_string(),
            capabilities,
            // An armed detector writing not one of its five terms…
            loop_detection: GgLoopDetection {
                enabled: true,
                ..GgLoopDetection::default()
            },
            // …and a command hook with no ceiling on how long it may hold the turn.
            hooks: vec![GgHook {
                event: GgHookEvent::PreShell,
                action: GgHookAction::Command {
                    command: "cargo build".to_string(),
                    cwd: None,
                    timeout_secs: None,
                    output: None,
                },
                name: "gate".to_string(),
            }],
            ..GgAgentConfig::root()
        }],
        // …over a run writing neither of the two ceilings it has no "off" for.
        limits: GgRunLimits::default(),
        ..GgCapabilitySet::default()
    };

    let refusal = refusal_text(&set);

    // Every param the table marks required, at its own locus.
    for (id, params) in CAPABILITY_PARAMS {
        for (key, requirement) in *params {
            if matches!(requirement, Requirement::Required(_)) {
                let locus = param_locus(id, key);
                assert!(
                    refusal.contains(&locus),
                    "the refusal is silent about `{locus}`:\n{refusal}"
                );
            }
        }
    }

    // Every capability that is varied by its arm, named where it names none — and the one whose
    // unwritten arm is a declaration rather than a hole, left alone.
    for (id, rule) in CAPABILITIES_WITH_ARMS {
        let unwritten = format!("the `{id}` capability is on and names no implementation");
        match rule {
            ArmRule::Required => assert!(
                refusal.contains(&unwritten),
                "the refusal is silent about `{id}`'s unwritten arm:\n{refusal}"
            ),
            ArmRule::AbsenceIsAnArm => assert!(
                !refusal.contains(&unwritten),
                "`{id}` was refused for the arm its absence already states:\n{refusal}"
            ),
        }
    }

    // The run-level and per-profile holes, which sit outside any capability's params and so are
    // spelled here the way the document spells them.
    for locus in [
        "limits.maxParallel",
        "limits.replayMaxBytes",
        "loopDetection.windowWords",
        "loopDetection.repeatThreshold",
        "loopDetection.minOffenders",
        "loopDetection.minSaturatedRun",
        "loopDetection.maxResponseChars",
        "hooks[gate].timeoutSecs",
    ] {
        assert!(
            refusal.contains(locus),
            "the refusal is silent about `{locus}`:\n{refusal}"
        );
    }

    // …and the converse, on the same silent document: a key whose absence *is* the setting is not
    // a hole, so nothing in the refusal names one. Without this the pass could satisfy every
    // assertion above by demanding everything.
    for (id, params) in CAPABILITY_PARAMS {
        for (key, requirement) in *params {
            if !matches!(requirement, Requirement::Required(_)) {
                let locus = param_locus(id, key);
                assert!(
                    !refusal.contains(&locus),
                    "the refusal names `{locus}`, which nobody owes:\n{refusal}"
                );
            }
        }
    }

    // **Each of them once.** This is the document with the most readers noticing the most holes,
    // which makes it the one place the second half of the rule can actually be checked: a value
    // read by a resolver *and* swept from the table is one thing to fix, and a refusal that
    // printed it twice would say there were two. Nothing here is wrong in two different ways, so
    // one profile's one locus is one line.
    let mut named: Vec<(Option<String>, String)> = Vec::new();
    for defect in defects(&set) {
        let addressed = (defect.agent.clone(), defect.locus.clone());
        assert!(
            !named.contains(&addressed),
            "`{}` is named twice in one refusal:\n{refusal}",
            defect.locus
        );
        named.push(addressed);
    }
}

/// **A board ceiling that diverges from the board owner's is refused.**
///
/// A run keeps one board, bounded by the ceilings on the first profile with the capability on.
/// Every other board-carrying profile writes its own — the keys are required wherever the
/// capability is on — and gg reads none of them, so a retry depth swept on the wrong profile would
/// run every arm at the owner's figure.
#[test]
fn a_board_ceiling_that_diverges_from_the_board_owners_is_refused() {
    let board = |retries: u64| {
        GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
            .with_param(PARAM_MAX_EPICS, 50)
            .with_param(PARAM_MAX_ISSUES, 2_000)
            .with_param(PARAM_MAX_RETRIES, retries)
            .with_param(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, ROOT_PROFILE_ID)
            .with_param(MODULE_PARAM_OWNERSHIP, "owned")
    };
    let set = |implementer_retries: u64| GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                subagents: vec![GgSubagentRef::any(ROOT_PROFILE_ID)],
                capabilities: vec![board(2)],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "implementer".to_string(),
                name: "implementer".to_string(),
                model_id: "mock/echo".to_string(),
                capabilities: vec![board(implementer_retries)],
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::minimal("mock/echo")
    };

    // Only the ceiling matters here; the fixture's board earns other defects of its own (a merge
    // agent with no shell), and they are somebody else's test.
    let retries = |set: &GgCapabilitySet| -> Vec<LaunchDefect> {
        defects(set)
            .into_iter()
            .filter(|defect| defect.locus.ends_with(PARAM_MAX_RETRIES))
            .collect()
    };
    // The same figure on both is the ordinary shape — an editor that offers the param per agent
    // writes it on each, and the document says exactly what the run does.
    assert_eq!(retries(&set(2)), Vec::new());

    let diverging = retries(&set(9));
    assert_eq!(diverging.len(), 1, "{diverging:?}");
    assert_eq!(diverging[0].agent.as_deref(), Some("implementer"));
    assert_eq!(diverging[0].found, "9");
    assert!(
        diverging[0].message.contains("configure nothing"),
        "{}",
        diverging[0].message
    );
}

/// **A roster entry that names no scope is refused.** The three roles are governed independently and
/// every call that names a target is checked against the scope it names it in, so an entry short of
/// them permits nothing at all — and gg grants none of the three on an operator's behalf.
#[test]
fn a_roster_entry_that_names_no_scope_is_refused() {
    let mut set = minimal();
    set.agents[0].subagents = vec![GgSubagentRef::new(ROOT_PROFILE_ID, &[])];
    let unscoped = defects(&set);
    assert_eq!(unscoped.len(), 1, "{unscoped:?}");
    assert_eq!(unscoped[0].locus, "subagents[0].scopes");
    assert_eq!(
        unscoped[0].known,
        ALL_SUBAGENT_SCOPES
            .iter()
            .map(|scope| scope.id().to_string())
            .collect::<Vec<_>>()
    );

    // One scope is enough: the entry says what it is for.
    set.agents[0].subagents = vec![GgSubagentRef::new(
        ROOT_PROFILE_ID,
        &[GgSubagentScope::Subagent],
    )];
    assert_eq!(defects(&set), Vec::new());
}

// ---------------------------------------------------------------------------
// Slugs and leftover slot declarations
// ---------------------------------------------------------------------------

/// The slug is what the model is shown and passes back, so a profile named in a way a model
/// would have to decide how to spell refuses the launch rather than reaching a roster.
#[test]
fn a_malformed_profile_slug_refuses_the_launch() {
    for bad in ["Reviewer", "merge agent", "merge_agent", "-lead"] {
        let mut set = minimal();
        set.agents[0].slug = bad.to_string();
        let text = refusal_text(&set);
        assert!(
            text.contains("well-formed profile slug"),
            "`{bad}` must be named as a malformed slug: {text}"
        );
    }
    // The slug a default set is born with, and the shapes an operator legitimately writes.
    for good in [ROOT_PROFILE_ID, "merge-agent", "gpt5"] {
        let mut set = minimal();
        set.agents[0].slug = good.to_string();
        assert!(
            !refusal_text_or_empty(&set).contains("well-formed profile slug"),
            "`{good}` is a slug gg accepts"
        );
    }
}

/// A profile's identity is in two halves, and gg is only ever handed one of them. An authored
/// configuration points every reference at the profile's **internal id**; launching rewrites each
/// one to that profile's **slug** and drops the ids. So an id still on the document says the
/// resolution did not happen — and gg is about to resolve a roster, a merge agent and a machine's
/// states by ids that no longer name anything, offering a roster short of the profiles the
/// operator wrote.
///
/// It is refused rather than resolved here for the same reason a leftover model slot is: gg has no
/// id table of its own to finish the launch from, and a run conducted off half a resolution is not
/// a differently-configured run, it is one strictly smaller than the document describes.
#[test]
fn a_set_that_still_carries_a_profiles_internal_id_is_refused() {
    let mut set = minimal();
    set.agents[0].id = Some("k-root".to_string());
    let text = refusal_text(&set);
    assert!(
        text.contains("still carries an internal id"),
        "unexpected refusal: {text}"
    );
    // Named by the agent it is on, because that is the profile an operator would open — and the
    // id itself, which is what a console tracking the resolution greps its own document for.
    assert!(text.contains(ROOT_PROFILE_ID), "unexpected refusal: {text}");
    assert!(text.contains("k-root"), "unexpected refusal: {text}");

    // The launched form of that same document — the one the backend actually stores — carries no
    // id and is refused for nothing.
    assert_eq!(defects(&set.resolve_agent_keys()), Vec::new());
}

/// A slot is a launch input, and launching fills every one of them in. A declaration still on
/// the document — at either level — means the launch was incomplete, and gg has no slot table
/// to finish it from.
#[test]
fn a_set_that_still_declares_a_model_slot_is_refused() {
    let mut set = minimal();
    set.model_slots = vec![test_cabinet_core::gg::GgConfigSlot {
        name: "cheap".to_string(),
        default_model_id: None,
        targets: Vec::new(),
    }];
    let text = refusal_text(&set);
    assert!(
        text.contains("still declares the `cheap` model slot"),
        "unexpected refusal: {text}"
    );

    let mut set = minimal();
    set.agents[0].model_slots = vec![test_cabinet_core::gg::GgModelSlot {
        name: "brain".to_string(),
        default_model_id: None,
        passthrough: true,
    }];
    let text = refusal_text(&set);
    assert!(
        text.contains("still declares the `brain` model slot"),
        "unexpected refusal: {text}"
    );
}

/// The refusal blob, or the empty string when the set launches — for the cases that assert a
/// value is *absent* from the refusal rather than present in it.
fn refusal_text_or_empty(set: &GgCapabilitySet) -> String {
    defects(set)
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}
