//! Tests for the compaction **strategies**: how an implementation string resolves to one, what each
//! asks the agent for and refuses in the meantime, and how a handoff transcript is rebuilt.
//!
//! The trigger, the policy and the rewrite they all converge on are in `compaction.test.rs`.

use std::sync::Arc;

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_COMPACTION, CAPABILITY_MEMORIES, GgCapabilityConfig, GgCapabilitySet,
};

use super::super::*;
use crate::context::{ContextModel, HeuristicTokenEstimator, Retention};
use crate::memories::MemoryStrategy;
use crate::model::{Message, ToolCall};
use crate::sandbox::{
    CONTEXT_COMPACT, MEMORIES_DELETE_MEMORY, MEMORIES_UPDATE_MEMORY, MEMORIES_WRITE_MEMORY,
    SHELL_SHELL,
};

/// A rendered prompt with every run of whitespace collapsed to one space.
///
/// The templates hard-wrap their prose, so a phrase check that spanned a line break would fire on
/// a re-wrap that changed no word. What a prompt *says* is asserted against this.
fn flat(rendered: &str) -> String {
    rendered.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A capability set whose Root agent enables compaction with `implementation` and `params`, with
/// memories on or off — the two inputs strategy resolution reads.
fn set_with(
    implementation: Option<&str>,
    params: serde_json::Value,
    memories: bool,
) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: true,
            implementation: implementation.map(str::to_string),
            params,
        },
    );
    // Memories are on by default, so the off arm has to *replace* the default rather than simply
    // not adding one.
    set.agents[0]
        .capabilities
        .retain(|capability| capability.id != CAPABILITY_MEMORIES);
    set.agents[0].capabilities.push(if memories {
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
    } else {
        GgCapabilityConfig::disabled(CAPABILITY_MEMORIES)
    });
    set
}

/// A context model with a code-mode flag, for the heading assertions.
fn model(code_mode: bool) -> ContextModel {
    ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        code_mode,
    )
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/// Every strategy id resolves to its strategy and round-trips through [`CompactionStrategy::id`],
/// and an unrecognized name falls back to the default rather than failing to launch — so a sweep can
/// reference a not-yet-built strategy.
#[test]
fn every_strategy_id_round_trips_and_an_unknown_one_falls_back() {
    for strategy in [
        CompactionStrategy::SelfSummarization,
        CompactionStrategy::SelfCompaction,
        CompactionStrategy::HandoffSummarization,
        CompactionStrategy::HandoffCompaction,
        CompactionStrategy::Memory,
    ] {
        assert_eq!(
            CompactionStrategy::resolve(Some(strategy.id()), true),
            strategy,
            "{} round-trips",
            strategy.id()
        );
    }
    for unknown in [None, Some(""), Some("default"), Some("not-a-strategy")] {
        assert_eq!(
            CompactionStrategy::resolve(unknown, true),
            CompactionStrategy::SelfSummarization,
            "{unknown:?} falls back to the default"
        );
    }
}

/// Memory compaction is the one strategy with a hard prerequisite: without the memories capability
/// there is nothing to write the working state into, and a run configured that way would never
/// satisfy its own gate. So it demotes to the default instead of stalling.
#[test]
fn memory_compaction_requires_memories() {
    assert_eq!(
        CompactionStrategy::resolve(Some("memory-compaction"), true),
        CompactionStrategy::Memory
    );
    assert_eq!(
        CompactionStrategy::resolve(Some("memory-compaction"), false),
        CompactionStrategy::SelfSummarization
    );
    // …and the same through a whole capability set.
    assert_eq!(
        CompactionSetup::resolve(
            set_with(Some("memory-compaction"), json!({}), false).root(),
            false
        )
        .strategy,
        CompactionStrategy::SelfSummarization
    );
    assert_eq!(
        CompactionSetup::resolve(
            set_with(Some("memory-compaction"), json!({}), true).root(),
            true
        )
        .strategy,
        CompactionStrategy::Memory
    );
}

/// The prerequisite is *writable* memories, not merely enabled ones.
///
/// A [read-only](crate::memories::MemoryScope::ReadOnly) holder is shown its spawner's memories and
/// offered no call that changes them, so a memory compaction would ask it to record its state with
/// calls it does not have and the boundary's gate could never be satisfied — leaving the run wedged
/// against a full window. Demoting is a worse summary; not demoting is no run at all.
#[test]
fn memory_compaction_demotes_for_a_read_only_holder() {
    // The capability is on — the set says so — but this holder may not write, so the strategy that
    // depends on writing is not the one it gets.
    assert_eq!(
        CompactionSetup::resolve(
            set_with(Some("memory-compaction"), json!({}), true).root(),
            false
        )
        .strategy,
        CompactionStrategy::SelfSummarization
    );
}

/// Which strategies are in-loop (the agent condenses its own thread across a turn boundary) and
/// which are out-of-band (a separate model condenses it between turns, invisibly).
#[test]
fn only_the_three_in_loop_strategies_are_pending() {
    assert_eq!(
        CompactionStrategy::SelfSummarization.pending(),
        Some(PendingCompaction::Summary)
    );
    assert_eq!(
        CompactionStrategy::SelfCompaction.pending(),
        Some(PendingCompaction::CompactCall)
    );
    assert_eq!(
        CompactionStrategy::Memory.pending(),
        Some(PendingCompaction::MemoryWrites)
    );
    for out_of_band in [
        CompactionStrategy::HandoffSummarization,
        CompactionStrategy::HandoffCompaction,
    ] {
        assert!(out_of_band.pending().is_none(), "{}", out_of_band.id());
    }
}

/// The `compact` tool is offered to the **working** model under self-compaction, and — in code mode
/// only — under self-summarization too.
///
/// Handoff compaction uses the same tool but offers it to its separate model alone, which is the
/// whole difference between the two: one asks the agent to compact itself, the other never
/// interrupts it.
///
/// Self-summarization is the interesting arm. It asks the agent for a summary, and a tool-calling
/// agent answers in prose — but a code agent has no prose to answer in, since every reply it sends
/// is a program. So its summary arrives the way everything else a program says arrives: as a call
/// carrying it. The alternative gg used to take was to tell a code agent to stop writing programs
/// for one turn, which suspends the single contract the whole protocol rests on.
#[test]
fn the_compact_tool_is_offered_where_the_agent_must_compact_itself() {
    for code_mode in [false, true] {
        assert!(CompactionStrategy::SelfCompaction.offers_compact_tool(code_mode));
        for other in [
            CompactionStrategy::HandoffSummarization,
            CompactionStrategy::HandoffCompaction,
            CompactionStrategy::Memory,
        ] {
            assert!(!other.offers_compact_tool(code_mode), "{}", other.id());
        }
    }
    assert!(
        CompactionStrategy::SelfSummarization.offers_compact_tool(true),
        "a code agent's summary arrives as a `compact` call — it has no other channel"
    );
    assert!(
        !CompactionStrategy::SelfSummarization.offers_compact_tool(false),
        "a tool-calling agent's summary is its reply's own text"
    );
}

/// Only the two handoff strategies resolve a second model, and only from a non-blank `model` param
/// on an **enabled** capability.
#[test]
fn the_handoff_model_is_read_only_for_a_handoff_strategy() {
    let handoff = set_with(
        Some("handoff-summarization"),
        json!({ "model": "openrouter/cheap" }),
        false,
    );
    assert_eq!(
        handoff_model_id(handoff.root()),
        Some("openrouter/cheap".to_string())
    );
    assert!(
        CompactionSetup::resolve(handoff.root(), true)
            .strategy
            .is_handoff()
    );

    // The same param on a non-handoff strategy names nothing to resolve.
    let same_model = set_with(
        Some("self-compaction"),
        json!({ "model": "openrouter/cheap" }),
        false,
    );
    assert_eq!(handoff_model_id(same_model.root()), None);

    // A handoff with no (or a blank) model falls back to the agent's own client.
    let unnamed = set_with(Some("handoff-compaction"), json!({ "model": "  " }), false);
    assert_eq!(handoff_model_id(unnamed.root()), None);

    // A disabled capability names nothing at all.
    let mut disabled = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut disabled.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: false,
            implementation: Some("handoff-summarization".to_string()),
            params: json!({ "model": "openrouter/cheap" }),
        },
    );
    assert_eq!(handoff_model_id(disabled.root()), None);
}

/// A handoff still deferring its model to a slot reached gg unbound — the launcher was supposed to
/// fill it in. gg cannot resolve it here (the slot table lives on the launch form), so it is
/// reported rather than resolved, and the run condenses on the agent's own model.
#[test]
fn an_unbound_model_slot_is_reported_rather_than_resolved() {
    let deferred = set_with(
        Some("handoff-summarization"),
        json!({ "modelSlot": "summarizer" }),
        false,
    );
    assert_eq!(
        unbound_handoff_slot(deferred.root()),
        Some("summarizer".to_string())
    );
    assert_eq!(
        handoff_model_id(deferred.root()),
        None,
        "an unbound slot names no model, so the agent condenses on its own"
    );

    // A slot that *was* bound leaves only the model behind, which is the ordinary case.
    let bound = set_with(
        Some("handoff-summarization"),
        json!({ "model": "openrouter/cheap" }),
        false,
    );
    assert_eq!(unbound_handoff_slot(bound.root()), None);

    // A non-handoff strategy resolves no second model at all, so a stale slot on one is not
    // something the run is doing anything with.
    let self_summarizing = set_with(None, json!({ "modelSlot": "summarizer" }), false);
    assert_eq!(unbound_handoff_slot(self_summarizing.root()), None);
}

// ---------------------------------------------------------------------------
// What each pending compaction admits, and what it says
// ---------------------------------------------------------------------------

/// The narrowing is total: while a compaction is in flight only the family that satisfies it is
/// admitted, and everything else — including `finish`, `shell`, and the other context tools — is
/// refused.
///
/// Asked of **both** surfaces, in each one's own vocabulary, because they are two predicates rather
/// than one spelled twice: the tool path admits nothing at all for a
/// [`Summary`](PendingCompaction::Summary), where the code path admits the `context.compact` call
/// the summary arrives inside.
#[test]
fn a_pending_compaction_admits_only_what_satisfies_it() {
    assert!(PendingCompaction::CompactCall.admits("compact"));
    assert!(!PendingCompaction::CompactCall.admits("shell"));
    assert!(!PendingCompaction::CompactCall.admits("write_memory"));

    assert!(PendingCompaction::MemoryWrites.admits("write_memory"));
    assert!(PendingCompaction::MemoryWrites.admits("update_memory"));
    assert!(PendingCompaction::MemoryWrites.admits("delete_memory"));
    assert!(!PendingCompaction::MemoryWrites.admits("compact"));
    assert!(!PendingCompaction::MemoryWrites.admits("shell"));

    assert!(!PendingCompaction::Summary.admits("shell"));

    assert!(PendingCompaction::CompactCall.admits_operation(CONTEXT_COMPACT));
    assert!(!PendingCompaction::CompactCall.admits_operation(SHELL_SHELL));
    assert!(!PendingCompaction::CompactCall.admits_operation(MEMORIES_WRITE_MEMORY));

    assert!(PendingCompaction::MemoryWrites.admits_operation(MEMORIES_WRITE_MEMORY));
    assert!(PendingCompaction::MemoryWrites.admits_operation(MEMORIES_UPDATE_MEMORY));
    assert!(PendingCompaction::MemoryWrites.admits_operation(MEMORIES_DELETE_MEMORY));
    assert!(!PendingCompaction::MemoryWrites.admits_operation(CONTEXT_COMPACT));
    assert!(!PendingCompaction::MemoryWrites.admits_operation(SHELL_SHELL));

    assert!(!PendingCompaction::Summary.admits_operation(SHELL_SHELL));

    // On the tool-calling path a summarization turn is not a working turn at all — the loop takes
    // it whole and never dispatches from it, so this only ever answers the defensive case. A
    // program has no such turn: the summary *is* a `context.compact` call, so that call is admitted.
    assert!(!PendingCompaction::Summary.admits("compact"));
    assert!(PendingCompaction::Summary.admits_operation(CONTEXT_COMPACT));
}

/// A memory compaction is satisfied by **one reply whose calls all succeeded**, and by nothing else
/// — not by a reply that made no calls, and not by one where a call (a refusal included) failed.
#[test]
fn a_memory_compaction_needs_one_clean_reply() {
    assert!(PendingCompaction::MemoryWrites.satisfied_by_calls(2, 0));
    assert!(!PendingCompaction::MemoryWrites.satisfied_by_calls(0, 0));
    assert!(!PendingCompaction::MemoryWrites.satisfied_by_calls(3, 1));
    // The other two are satisfied by a specific thing arriving, never by a count.
    assert!(!PendingCompaction::CompactCall.satisfied_by_calls(2, 0));
    assert!(!PendingCompaction::Summary.satisfied_by_calls(2, 0));
}

/// The memory calls a scratchpad run names, in one execution mode — what every instruction below
/// is rendered with unless it is testing the strategy-dependence itself.
fn scratchpad_calls(code_mode: bool) -> MemoryCalls {
    MemoryStrategy::Scratchpad.calls(code_language(code_mode))
}

/// The language a code-mode assertion below is rendered against, and `None` for a tool-calling one.
fn code_language(code_mode: bool) -> Option<&'static dyn crate::sandbox::ProgramLanguage> {
    code_mode
        .then(|| crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::TypeScript))
}

/// Each instruction names the call the model must actually make, in the vocabulary of the execution
/// mode it is in — the free-standing tool on the tool-calling path, the API-object method under
/// responses-as-code — and every one of them says why the model is being interrupted.
#[test]
fn each_instruction_names_the_call_for_its_execution_mode() {
    let tool_calling = PendingCompaction::CompactCall.instruction(None, scratchpad_calls(false));
    assert!(tool_calling.contains("Call `compact`"), "{tool_calling}");
    let code =
        PendingCompaction::CompactCall.instruction(code_language(true), scratchpad_calls(true));
    assert!(
        code.contains("`gg.context.compact(summary, files)`"),
        "{code}"
    );

    let memories_code =
        PendingCompaction::MemoryWrites.instruction(code_language(true), scratchpad_calls(true));
    assert!(
        memories_code.contains("gg.memories.writeMemory"),
        "{memories_code}"
    );
    let memories_tools = PendingCompaction::MemoryWrites.instruction(None, scratchpad_calls(false));
    assert!(memories_tools.contains("write_memory"), "{memories_tools}");

    // **A code agent is never told to stop writing programs.** Its summary arrives the way
    // everything else a program says arrives: as a call carrying it. Asking a code agent for prose
    // would suspend the one contract the whole protocol rests on — and a contract suspended once is
    // a contract a model has learned is negotiable.
    let summary_code =
        PendingCompaction::Summary.instruction(code_language(true), scratchpad_calls(true));
    assert!(
        summary_code.contains("`gg.context.compact(summary)`"),
        "{summary_code}"
    );
    for forbidden in ["NOT write a program", "plain text"] {
        assert!(
            !summary_code.contains(forbidden),
            "a code agent was told to answer in prose (`{forbidden}`):\n{summary_code}"
        );
    }
    // The tool-calling arm is unchanged: there, the reply's own text *is* the summary.
    let summary_tools = PendingCompaction::Summary.instruction(None, scratchpad_calls(false));
    assert!(
        summary_tools.contains("plain text summary"),
        "{summary_tools}"
    );

    for pending in [
        PendingCompaction::Summary,
        PendingCompaction::CompactCall,
        PendingCompaction::MemoryWrites,
    ] {
        for code_mode in [false, true] {
            assert!(
                pending
                    .instruction(code_language(code_mode), scratchpad_calls(code_mode))
                    .contains("context window is full"),
                "{pending:?} ({code_mode}) states why it is interrupting"
            );
        }
    }
}

/// A refusal names the call that was refused as well as what is wanted instead — a model told only
/// "do X" while its Y silently fails reads the failure as gg being broken and retries Y.
#[test]
fn a_refusal_names_the_refused_call_and_the_way_out() {
    let refusal = PendingCompaction::CompactCall.refusal("shell", None, scratchpad_calls(false));
    assert!(refusal.contains("`shell`"), "{refusal}");
    assert!(refusal.contains("compact"), "{refusal}");
}

/// A memory compaction asks for the calls the run's **memory strategy** actually offers. A markdown
/// run has no `write_memory`, so an instruction naming one would be telling the model to call
/// something it was never given — and the model would have no way out of a full window.
#[test]
fn a_memory_compaction_names_the_memory_strategys_own_calls() {
    let calls = MemoryStrategy::Markdown.calls(None);
    let instruction = PendingCompaction::MemoryWrites.instruction(None, calls.clone());
    assert!(instruction.contains("`create_memory`"), "{instruction}");
    assert!(instruction.contains("`edit_memory`"), "{instruction}");
    assert!(!instruction.contains("write_memory"), "{instruction}");

    let refusal = PendingCompaction::MemoryWrites.refusal("shell", None, calls);
    assert!(refusal.contains("`create_memory`"), "{refusal}");
    assert!(!refusal.contains("write_memory"), "{refusal}");
}

// ---------------------------------------------------------------------------
// The handoff transcript
// ---------------------------------------------------------------------------

/// The four transforms a handoff transcript performs, asserted together because it is their
/// conjunction the strategy depends on: the system prompt, skills and memories are dropped; every
/// surviving item becomes a `user` message; and each gets its `<label>\n----\n` heading — with an
/// assistant turn labelled `Assistant`, which is what stops the compaction model reading the
/// working model's output as its own.
#[test]
fn a_handoff_transcript_is_labelled_user_messages_with_no_state() {
    let mut ctx = model(false);
    ctx.set_system("SYSTEM PROMPT — do not show this to the summarizer");
    ctx.push_user_prompt("BUILD PROMPT");
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user("SKILL BODY"),
    );
    ctx.push(
        GgContextSource::Memory,
        Retention::Pinned,
        Message::user("MEMORY BODY"),
    );
    ctx.push_assistant(
        Some("ASSISTANT TURN".to_string()),
        vec![ToolCall {
            id: "call_1".to_string(),
            name: "shell".to_string(),
            arguments: json!({ "command": "ls" }),
        }],
    );
    ctx.push_tool_result(GgContextSource::ToolOutput, "call_1", "TOOL OUTPUT");

    let messages = handoff_messages(&ctx);
    assert!(
        messages.iter().all(|m| m.role == Role::User),
        "every message is flattened to `user`"
    );
    let bodies: Vec<String> = messages
        .iter()
        .map(|m| m.content.clone().unwrap_or_default())
        .collect();
    let all = bodies.join("\n");
    assert!(
        !all.contains("SYSTEM PROMPT"),
        "the system prompt is dropped"
    );
    assert!(!all.contains("SKILL BODY"), "skills are dropped");
    assert!(!all.contains("MEMORY BODY"), "memories are dropped");
    assert!(bodies.iter().any(|b| b.starts_with("Task\n----\n")));
    assert!(bodies.iter().any(|b| b.starts_with("Assistant\n----\n")));
    assert!(bodies.iter().any(|b| b.starts_with("Output\n----\n")));
    // The tool calls an assistant turn made are what it *did*; a transcript of narration with no
    // actions in it is not a thread worth summarizing.
    assert!(all.contains("called `shell`"), "{all}");
}

/// A code-mode window already carries its headings, so a handoff must not head them twice — the
/// compaction model would otherwise read `Task\n----\nTask\n----\n…` and treat the duplication as
/// content.
#[test]
fn a_code_mode_transcript_is_not_headed_twice() {
    let mut ctx = model(true);
    ctx.push_user_prompt("BUILD PROMPT");
    let body = handoff_messages(&ctx)
        .first()
        .and_then(|m| m.content.clone())
        .unwrap_or_default();
    assert_eq!(body, "Task\n----\nBUILD PROMPT");
}

/// A **text view** is the one band whose heading carries more than its band word — it reads
/// `View: {label}`, because the label is the only thing telling two of them apart. So the
/// already-headed check has to compare against the item's own heading rather than against the bare
/// word, or the transcript would carry `View\n----\nView: plan\n----\n…` and the compaction model
/// would reasonably read the second heading as content.
#[test]
fn a_text_view_keeps_its_selector_and_is_not_headed_twice() {
    let mut ctx = model(true);
    ctx.open_text_view("plan".to_string(), "1. read\n2. fix".to_string());
    let body = handoff_messages(&ctx)
        .first()
        .and_then(|m| m.content.clone())
        .unwrap_or_default();
    assert_eq!(body, "View: plan\n----\n1. read\n2. fix");
}

/// The same item in a **tool-calling** window carries no heading of its own, so the transcript adds
/// one — and it is still the qualified form, so the summarizer can tell one view from another.
#[test]
fn a_text_view_in_a_tool_calling_window_is_headed_by_the_transcript() {
    let mut ctx = model(false);
    ctx.open_text_view("plan".to_string(), "1. read\n2. fix".to_string());
    let body = handoff_messages(&ctx)
        .first()
        .and_then(|m| m.content.clone())
        .unwrap_or_default();
    assert_eq!(body, "View: plan\n----\n1. read\n2. fix");
}

/// The two handoff prompts open by telling the reader the thread is **a session transcript it has
/// been handed**, not its own work — the claim the flattening makes structurally true, and what
/// stops a first-person summary of work the compaction model never did.
#[test]
fn the_handoff_prompts_disown_the_thread() {
    for prompt in [
        handoff_summary_system_prompt(),
        handoff_compact_system_prompt(),
    ] {
        let flat = flat(prompt);
        assert!(
            flat.contains("compacting the session transcript attached below"),
            "{prompt}"
        );
        assert!(flat.contains("what was done previously"), "{prompt}");
    }
    // Each carries the marker its offline mock path keys off — and only its own.
    assert!(handoff_summary_system_prompt().contains(SUMMARIZATION_MARKER));
    assert!(!handoff_summary_system_prompt().contains(COMPACT_CALL_MARKER));
    assert!(handoff_compact_system_prompt().contains(COMPACT_CALL_MARKER));
    assert!(!handoff_compact_system_prompt().contains(SUMMARIZATION_MARKER));
}

// ---------------------------------------------------------------------------
// The memory strategy's summary
// ---------------------------------------------------------------------------

/// Memory compaction restarts the thread from a bare note that a boundary was crossed rather than
/// from a recap — its whole hypothesis is that the memories, which cross the boundary verbatim and
/// are still pinned above the note, are the better carrier. It re-reads no files, and it is not a
/// fallback, so it is not recorded as one.
#[test]
fn memory_compaction_restarts_from_a_note_that_the_thread_was_dropped() {
    let request = memory_compaction_request();
    assert!(request.summary.contains("Session compaction completed"));
    assert!(request.files.is_empty());
    assert!(!is_fallback(&request.summary));
}
