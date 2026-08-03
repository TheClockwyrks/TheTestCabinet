//! gg's **model-facing prose**, authored as Handlebars templates rather than as Rust string
//! literals.
//!
//! Everything gg *says* to a model — the system prompt, the pinned context blocks that render
//! the task list, the epic/issue board and the memories, the [briefs](render_review_brief) it
//! dispatches agents with, and the [compaction](render_compaction_instruction),
//! [completion](render_completion_missing) and [context-pressure](render_context_pressure) prose
//! the loop injects between turns — lives in `crates/gg/templates/*.hbs` and is rendered here. The templates
//! are [embedded](include_str!) at compile time, so gg keeps its "no external resources" property:
//! the binary carries its prompts.
//!
//! **A prompt does not live anywhere else.** A sentence a model reads is prose that gets tuned, and
//! prose buried in a `format!` two thousand lines into `agent.rs` does not get tuned — it gets
//! copied. So the rule is total: if a model reads it, it is a `.hbs` file, and the Rust beside it
//! only assembles the [context](SystemContext) it renders against.
//!
//! # Why templates
//!
//! The prompt is a **maintained artifact**, not incidental code. gg's whole point is that its
//! capabilities are independently toggleable, so the prompt has to describe *exactly* the
//! capabilities a run enabled — which, written as Rust, means a dozen `push_str` calls scattered
//! across as many modules, each carrying a paragraph of prose in string-continuation syntax.
//! Templating collapses that into one readable file per artifact: the conditional sections are
//! `{{#if}}` blocks over the [rendering context](SystemContext), and a run's configuration
//! (memory caps, the task ceiling, the `read_file` line cap) is interpolated
//! inline instead of being restated in prose.
//!
//! # The contexts are the contract
//!
//! Every template renders in **strict mode** (as the test cases' own templates do in
//! `core`): referencing a variable the context does not carry is an error, not a silent blank.
//! The `…Context` structs in this module are therefore the documented surface a template may
//! reference — they name every variable, and this module's tests render each template with the
//! capability sections both on and off, so a typo in a `.hbs` file fails the build rather than
//! reaching a model.
//!
//! # No repetition between the prompt and the blocks
//!
//! *How* to use a capability is stated **once**, in the system prompt, gated on whether that
//! capability is enabled. The pinned blocks ([`render_tasks`], [`render_board`],
//! [`render_memories`]) are then pure **state** — a heading and the current items — rather than
//! re-teaching the tools on every turn they are refreshed.
//!
//! # The prompt does not describe the API — the model discovers it
//!
//! Under [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) the prompt names the
//! [API objects](SystemContext::apis) a program has (`fs`, `project`, `harness`, …) and how to
//! inspect them — `object.list()` and `view.openDocsView()` — rather than listing every signature up front.
//! The signatures and documentation live behind the [docs carve-out](crate::docs), reflected from
//! the SDK's own declarations, so a description the sandbox cannot back can never reach a model.
//!
//! # The prose gg *does* author, and why it is versioned like code
//!
//! What this module renders is this stage's product surface: the reply contract (your whole reply is
//! the program), the ending contract (an explicit, role-shaped call ends a session and nothing else
//! does), and the four turn feedbacks that answer a program that ran, one that did not compile, one
//! the sandbox stopped, and a reply that was never a program at all. Each sentence in those exists
//! because a real model got the contract wrong without it, so treat them as behaviour: change one
//! only with the same care as a code change, and keep the tests that pin them.
//!
//! # What a prompt does NOT say
//!
//! These are rules, not preferences, and they are why several fields a reader might expect are
//! absent from the contexts below:
//!
//! - **Nothing names gg, or the test case a run is scored against.** An agent is told what to do and
//!   how, never what is driving it.
//! - **No gg internals.** How a value is used after the model produces it is gg's business.
//! - **No history.** "X is no longer required" spends tokens on a state the reader never saw.
//! - **Nothing about what the reader cannot act on.** An agent with no delegation is not told other
//!   agents exist; an agent whose ending is `approve` is not told what `finish` would have done.
//! - **Nothing gg already says at the moment it matters.** Compaction is the clearest case: the
//!   instruction arrives when the window fills and says exactly what to do, so no other prompt
//!   mentions compaction at all — most sessions never compact, and every one of them would have paid
//!   for the paragraph.
//! - **No narration.** Exactly what is needed, and nothing else.
//!
//! The [briefs](render_review_brief) follow from the same rules. A brief is the *only* thing a
//! dispatched reviewer, fixer, merge agent, attempt or judge has ever been told, so it says what that
//! agent must do — and stops there. It does **not** teach the agent how to end its session: the
//! ending calls are in the system prompt already, and are the only ones that agent's role has.

use std::sync::OnceLock;

use handlebars::{Handlebars, RenderError};
use serde::Serialize;
use serde_json::json;

/// The **tool-calling** system prompt: the base framing plus one conditional section per enabled
/// capability, with each capability's tools named as the free-standing calls a tool-calling run
/// makes (`add_task`, `spawn_subagent`, `create_epic`).
const SYSTEM_TOOLS_TEMPLATE: &str = include_str!("../templates/system-tools.hbs");

/// The **responses-as-code** system prompt: the same capability sections, plus the code-protocol
/// framing (the reply *is* a program, discovery through `object.list()`/`view.openDocsView()`, the message
/// headings), with each capability's calls named in their grouped form — methods on an API object
/// (`tasks.addTask`, `agents.spawnSubagent`, `project.createEpic`) rather than free-standing tools.
///
/// The two templates are selected between by [`render_system`] on the run's execution mode; they are
/// separate files rather than one branching template because the code arm rewrites every section's
/// calls into their grouped form, so almost nothing between the arms is shared prose.
const SYSTEM_CODE_TEMPLATE: &str = include_str!("../templates/system-code.hbs");

/// The pinned [task list](crate::tasks) block.
const TASKS_TEMPLATE: &str = include_str!("../templates/tasks.hbs");

/// The pinned [epic/issue board](crate::board) block.
const BOARD_TEMPLATE: &str = include_str!("../templates/board.hbs");

/// The pinned [memories](crate::memories) block.
const MEMORIES_TEMPLATE: &str = include_str!("../templates/memories.hbs");

/// The pinned [memory index](crate::memories::MemoryStrategy::Markdown) block.
const MEMORY_INDEX_TEMPLATE: &str = include_str!("../templates/memory-index.hbs");

/// The [linked-memory notice](crate::memories::MemoriesRuntime::notice) — what another holder of a
/// shared memory instance did since this agent was last told.
const MEMORY_NOTICE_TEMPLATE: &str = include_str!("../templates/memory-notice.hbs");

/// The notice a [code program](crate::sandbox) that ran cleanly and put **nothing** in its own
/// window earns — the one message a successful program can produce, and only because a request has
/// to end on something for the model to answer.
///
/// There is deliberately no template for a program that *did* show itself something: the views are
/// the report, and a covering note over them would be gg narrating what the model can already read.
const CODE_NOTHING_SHOWN_TEMPLATE: &str = include_str!("../templates/code-nothing-shown.hbs");

/// The turn feedback for a reply that was not a program at all — prose, comments, an empty message.
///
/// It exists because under this protocol such a reply is a *failed turn* rather than a conclusion:
/// the run ends when a program calls `finish` and at no other time, so a model that says "done" has
/// to be told, in gg's own words, that saying it did nothing.
const CODE_NOT_A_PROGRAM_TEMPLATE: &str = include_str!("../templates/code-not-a-program.hbs");

/// The dispatch brief an [issue](crate::board) is handed to the agent that implements it.
const ISSUE_BRIEF_TEMPLATE: &str = include_str!("../templates/issue-brief.hbs");

/// The brief a [reviewer](crate::agent) of an issue's work is dispatched with.
const REVIEW_BRIEF_TEMPLATE: &str = include_str!("../templates/review-brief.hbs");

/// The brief an issue's own agent is re-dispatched with after a review requested changes.
const FIX_BRIEF_TEMPLATE: &str = include_str!("../templates/fix-brief.hbs");

/// The brief the merge agent is dispatched with when an issue's branch conflicts.
const MERGE_BRIEF_TEMPLATE: &str = include_str!("../templates/merge-brief.hbs");

/// The brief one attempt of a [speculative execution](crate::agent) is dispatched with.
const ATTEMPT_BRIEF_TEMPLATE: &str = include_str!("../templates/attempt-brief.hbs");

/// The brief the judge of a [speculative execution](crate::agent) is dispatched with.
const JUDGE_BRIEF_TEMPLATE: &str = include_str!("../templates/judge-brief.hbs");

/// The instruction that opens an in-loop [compaction](crate::compaction) — the message the model
/// reads at the top of the turn that must satisfy it. Also included as a partial by
/// [the unsatisfied feedback](COMPACTION_UNSATISFIED_TEMPLATE), which is the same instruction
/// prefaced by what went wrong.
const COMPACTION_INSTRUCTION_TEMPLATE: &str =
    include_str!("../templates/compaction-instruction.hbs");

/// The feedback for a reply that satisfied a pending [compaction](crate::compaction) in no way at
/// all.
const COMPACTION_UNSATISFIED_TEMPLATE: &str =
    include_str!("../templates/compaction-unsatisfied.hbs");

/// The refusal that answers a call a pending [compaction](crate::compaction) does not accept.
const COMPACTION_REFUSAL_TEMPLATE: &str = include_str!("../templates/compaction-refusal.hbs");

/// The system prompt the [handoff summarization](crate::compaction::CompactionStrategy::HandoffSummarization)
/// strategy gives the separate compaction model.
const COMPACTION_HANDOFF_SUMMARY_TEMPLATE: &str =
    include_str!("../templates/compaction-handoff-summary.hbs");

/// The system prompt the [handoff compaction](crate::compaction::CompactionStrategy::HandoffCompaction)
/// strategy gives the separate compaction model.
const COMPACTION_HANDOFF_COMPACT_TEMPLATE: &str =
    include_str!("../templates/compaction-handoff-compact.hbs");

/// The summary item a compacted thread is restarted from: the heading that frames it as a recap of
/// dropped history, then the summary itself.
const COMPACTION_PREFACE_TEMPLATE: &str = include_str!("../templates/compaction-preface.hbs");

/// The summary used when the summarization model call fails — compaction must never abort the run
/// it serves.
const COMPACTION_FALLBACK_TEMPLATE: &str = include_str!("../templates/compaction-fallback.hbs");

/// The "summary" a [memory compaction](crate::compaction::CompactionStrategy::Memory) restarts the
/// thread from, which points at the memories rather than recapping anything.
const COMPACTION_MEMORY_SUMMARY_TEMPLATE: &str =
    include_str!("../templates/compaction-memory-summary.hbs");

/// The feedback for a tool-calling turn that requested no tools — a text-only reply, which is an
/// error rather than an [ending](crate::ending).
const COMPLETION_MISSING_TEMPLATE: &str = include_str!("../templates/completion-missing.hbs");

/// The feedback for an ending a [validation command](crate::completion) rejected.
const COMPLETION_VALIDATION_FAILURE_TEMPLATE: &str =
    include_str!("../templates/completion-validation-failure.hbs");

/// The per-turn [context-pressure](crate::context) signal: how full the window is, what is filling
/// it, and how the agent can reclaim space itself.
const CONTEXT_PRESSURE_TEMPLATE: &str = include_str!("../templates/context-pressure.hbs");

/// The template names registered with the [engine], in the order they are registered. Each name
/// is what [`render`] looks up. The tests iterate this list to assert every template parses.
const TEMPLATES: &[(&str, &str)] = &[
    ("system-tools", SYSTEM_TOOLS_TEMPLATE),
    ("system-code", SYSTEM_CODE_TEMPLATE),
    ("tasks", TASKS_TEMPLATE),
    ("board", BOARD_TEMPLATE),
    ("memories", MEMORIES_TEMPLATE),
    ("memory-index", MEMORY_INDEX_TEMPLATE),
    ("memory-notice", MEMORY_NOTICE_TEMPLATE),
    ("code-nothing-shown", CODE_NOTHING_SHOWN_TEMPLATE),
    ("code-not-a-program", CODE_NOT_A_PROGRAM_TEMPLATE),
    ("issue-brief", ISSUE_BRIEF_TEMPLATE),
    ("review-brief", REVIEW_BRIEF_TEMPLATE),
    ("fix-brief", FIX_BRIEF_TEMPLATE),
    ("merge-brief", MERGE_BRIEF_TEMPLATE),
    ("attempt-brief", ATTEMPT_BRIEF_TEMPLATE),
    ("judge-brief", JUDGE_BRIEF_TEMPLATE),
    ("compaction-instruction", COMPACTION_INSTRUCTION_TEMPLATE),
    ("compaction-unsatisfied", COMPACTION_UNSATISFIED_TEMPLATE),
    ("compaction-refusal", COMPACTION_REFUSAL_TEMPLATE),
    (
        "compaction-handoff-summary",
        COMPACTION_HANDOFF_SUMMARY_TEMPLATE,
    ),
    (
        "compaction-handoff-compact",
        COMPACTION_HANDOFF_COMPACT_TEMPLATE,
    ),
    ("compaction-preface", COMPACTION_PREFACE_TEMPLATE),
    ("compaction-fallback", COMPACTION_FALLBACK_TEMPLATE),
    (
        "compaction-memory-summary",
        COMPACTION_MEMORY_SUMMARY_TEMPLATE,
    ),
    ("completion-missing", COMPLETION_MISSING_TEMPLATE),
    (
        "completion-validation-failure",
        COMPLETION_VALIDATION_FAILURE_TEMPLATE,
    ),
    ("context-pressure", CONTEXT_PRESSURE_TEMPLATE),
];

/// The process-wide Handlebars engine, built once with every template registered.
static ENGINE: OnceLock<Handlebars<'static>> = OnceLock::new();

/// The engine every prompt is rendered through: **strict mode**, so referencing a variable the
/// context does not carry is an error rather than a silent empty value, and HTML escaping
/// disabled, since a prompt is plain text (the same configuration `core` renders a test case's
/// `prompt.hbs` with).
///
/// Registration happens once, at first use. A template that fails to *parse* is a bug in a file
/// this crate embeds, so it panics loudly here rather than degrading a live run into a session
/// driven by a half-rendered prompt; this module's tests render every template, so such a bug
/// cannot reach a release.
fn engine() -> &'static Handlebars<'static> {
    ENGINE.get_or_init(|| {
        let mut engine = Handlebars::new();
        engine.set_strict_mode(true);
        engine.register_escape_fn(handlebars::no_escape);
        for (name, source) in TEMPLATES.iter() {
            engine
                .register_template_string(name, source)
                .unwrap_or_else(|err| panic!("gg template `{name}` does not parse: {err}"));
        }
        engine
    })
}

/// Render the registered template `name` with `context`, trimmed.
///
/// The fallible form, for the [code feedback](render_code_nothing_shown) renders that must degrade rather
/// than abort: their input is a model's own program output, so a render failure there costs a turn
/// its feedback and must never cost the run its process.
fn try_render<T: Serialize>(name: &str, context: &T) -> Result<String, RenderError> {
    engine()
        .render(name, context)
        .map(|rendered| rendered.trim().to_string())
}

/// Render the registered template `name` with `context`.
///
/// A render failure means a template references something its context does not carry — again a
/// bug in an embedded file, caught by the tests — so it panics with the template name and the
/// Handlebars error rather than handing a model a silently truncated prompt.
fn render<T: Serialize>(name: &str, context: &T) -> String {
    try_render(name, context)
        .unwrap_or_else(|err| panic!("gg template `{name}` failed to render: {err}"))
}

/// Normalize the system prompt's whitespace: collapse any run of three or more newlines to a
/// blank-line separator.
///
/// This is what lets the system templates stay readable. A `{{#if}}` section that renders nothing still
/// leaves its surrounding blank lines behind, so without this every one of its dozen conditional
/// sections would have to be written with Handlebars' `~` whitespace-control markers — exactly
/// the noise that makes a template hard to maintain. Collapsing here means a section can be
/// added, removed, or reordered without anyone thinking about whitespace.
///
/// Applied to the system prompt only: the pinned blocks interpolate text the *model* wrote (a
/// memory body, an issue's scope), and squeezing blank lines out of that would be editing the
/// agent's own words back at it.
fn tidy(rendered: &str) -> String {
    let mut out = String::with_capacity(rendered.len());
    let mut newlines = 0usize;
    for ch in rendered.chars() {
        if ch == '\n' {
            newlines += 1;
            // Two newlines (one blank line) is the paragraph separator; drop the rest.
            if newlines > 2 {
                continue;
            }
        } else {
            newlines = 0;
        }
        out.push(ch);
    }
    out.trim().to_string()
}

// ---------------------------------------------------------------------------
// The system prompt
// ---------------------------------------------------------------------------

/// The variables the system templates may reference — one field per capability the prompt describes,
/// carrying that capability's configuration so the prompt can state a run's actual limits
/// instead of restating a default in prose.
///
/// An `Option` field is `null` when the capability is off, which is what the template's
/// `{{#if …}}` gate tests: a disabled capability contributes **no prompt text at all**, which is
/// the property [toolset ablation](https://docs.testcabinet.ai/gg/toolset-ablation/) depends on.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemContext {
    /// Whether the run is in [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/)
    /// mode, where the tools are described as functions a program calls rather than as tool calls.
    pub responses_as_code: bool,
    /// The API objects a code program has this run, each with a one-line description — the section
    /// the prompt names so a model knows which objects to inspect with `object.list()`. Empty on the
    /// tool-calling path (where tools are in the request); on the code path it always carries at
    /// least `harness`. Not the *functions* — those are discovered on demand with `list()` and
    /// `view.openDocsView()`, which is the whole point of the redesign — only the objects and what each is for.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub apis: Vec<ApiView>,
    /// The [message headings](crate::context::code_heading) this run's synthesized `user` messages
    /// can carry — the vocabulary the prompt names so a model reading a plain-text transcript knows
    /// what a `Task`, an `Output`, or a `Memories` block in front of it is. Empty on the tool-calling
    /// path (message kinds are carried by role there); on the code path it lists the base headings
    /// plus one per enabled capability that synthesizes a message kind of its own — the same
    /// per-capability gating [`apis`](Self::apis) and every other section follows.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub code_headings: Vec<CodeHeadingView>,
    /// Operator-authored instructions for the agent whose prompt this is — the
    /// [`GgAgentConfig::custom_instructions`](test_cabinet_core::gg::GgAgentConfig::custom_instructions)
    /// of its profile. `None` (or empty) renders no additional-instructions section. The
    /// template inserts it near the top so it frames the whole session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
    /// Whether this agent may **spawn subagents** — the
    /// [subagents](test_cabinet_core::gg::CAPABILITY_SUBAGENTS) capability, as the offered toolset
    /// reflects it. This alone gates the prompt's Subagents section.
    ///
    /// It is deliberately **not** derived from [`spawnable_agents`](Self::spawnable_agents) being
    /// non-empty. An agent's roster and its ability to delegate are independent: a run may give an
    /// agent a roster purely so it can name issue implementers and reviewers, with no
    /// `spawn_subagent` anywhere in sight, and teaching that agent to delegate would be teaching it
    /// about a tool it does not have.
    pub subagents: bool,
    /// The agents this one may spawn as subagents (its roster's
    /// [`subagent`](test_cabinet_core::gg::GgSubagentScope::Subagent) scope), each with the
    /// caller-scoped description that tells this agent when to use it. Enumerated in the prompt so
    /// the model knows which names `spawn_subagent`/`speculate`/`run_workflow` accept. Rendered only
    /// when [`subagents`](Self::subagents) is on.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub spawnable_agents: Vec<SpawnableAgentView>,
    /// Whether [healing](crate::healing)'s fence-stripping strategy is armed this run.
    ///
    /// The prompt tells the model not to wrap its program in a code fence either way; what changes
    /// is the *reason*. With stripping on, "a fence is a syntax error" is simply false — gg removes
    /// it and says so — and a model that tests the claim learns that gg's rules are negotiable,
    /// which contaminates the instruction-following signal this capability exists to measure. So the
    /// armed arm states the repair honestly and calls it a repair rather than the contract.
    pub fences_are_stripped: bool,
    /// How much of a file one `read_file` call returns, so a capped run says so up front.
    pub read_file: ReadFileView,
    /// How much of a command's output one `shell` call returns, so an offloading run says up front
    /// that what comes back is a tail and where the rest of it lives.
    pub shell: ShellView,
    /// The available [skills](crate::skills), each with its one-line description. Empty when the
    /// capability is off or the library holds none.
    pub skills: Vec<SkillView>,
    /// The [memories](crate::memories) budget, or `None` when the capability is off.
    pub memories: Option<MemoriesView>,
    /// The [task list](crate::tasks) ceiling, or `None` when the capability is off.
    pub tasks: Option<TasksView>,
    /// The [epic/issue board](crate::board) ceilings, or `None` when **this agent** may not author
    /// the board (it has no project-management capability of its own, or the run has no board).
    pub board: Option<BoardView>,
    /// The [board issue](crate::board) this agent was dispatched to implement, or `None` when it
    /// was not dispatched off the board. Independent of [`board`](Self::board): an implementer is
    /// normally configured without the authoring capability, so this is usually the *only* board
    /// section such an agent is shown.
    pub assigned_issue: Option<AssignedIssueView>,
    /// Whether speculative execution (`speculate`) is available this run.
    pub speculative: bool,
    /// Whether this agent's opening context was pre-seeded with the test case's specifications and
    /// reference images, and if so whether they are locked into the window. `None` renders no
    /// section — the model was told nothing about a feature it does not have.
    pub autoload_specs: Option<AutoloadView>,
    /// Whether this agent is a [persistent](test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE) one:
    /// only one instance of it runs at a time, and its opening window already holds the file views it
    /// had open when it last finished, re-read from the workspace as it stands now.
    ///
    /// Worth a prompt section of its own precisely because the seeded views are indistinguishable from
    /// reads the model made itself — an agent that finds five `read_file` results at the top of a fresh
    /// session and is told nothing has to guess whether it is resuming, hallucinating, or being tested.
    pub persistence: bool,
    /// How this agent ends its session — the calls its [role](crate::ending::EndingRole) gives it.
    /// Always present: every agent must be told how to end, in either execution mode.
    pub ending: EndingView,
}

/// How this agent ends its session, as the system prompt describes it: which
/// [role](crate::ending::EndingRole) it was dispatched in, and that role's calls named as this
/// execution mode writes them.
///
/// The three flags are mutually exclusive — an agent has one role — and are booleans rather than a
/// role name because the templates render in strict mode with no comparison helper: a name would
/// have to be re-derived in Handlebars, which is where a prompt and the loop it describes drift.
///
/// The four names are all populated whatever the role, and only the active role's are rendered. That
/// is deliberate: a missing variable is a strict-mode render error, and the cost of carrying three
/// unread strings is nothing against a prompt that fails to render at all.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndingView {
    /// [`Standard`](crate::ending::EndingRole::Standard): the agent reports what it did.
    pub standard: bool,
    /// [`Review`](crate::ending::EndingRole::Review): the agent returns a verdict.
    pub review: bool,
    /// [`Judge`](crate::ending::EndingRole::Judge): the agent names a winning attempt.
    pub judge: bool,
    /// The finish call, as this execution mode writes it (`finish` / `harness.finish`).
    pub finish: String,
    /// The approval call (`approve` / `review.approve`).
    pub approve: String,
    /// The change-request call (`request_changes` / `review.requestChanges`).
    pub request_changes: String,
    /// The winner call (`select_winner` / `judge.selectWinner`).
    pub select_winner: String,
}

/// The [autoload-specifications](test_cabinet_core::gg::CAPABILITY_AUTOLOAD_SPECS) section's state:
/// the capability is on (so the section renders at all), and whether the injected material is
/// **locked** into the window.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoloadView {
    /// Whether the autoloaded specs are pinned across compaction (and immune to eviction), so the
    /// prompt can promise the brief stays rather than that it merely started there.
    pub locked: bool,
}

/// How much of a file one `read_file` call returns — the
/// [read policy](crate::tools::ReadPolicy) as the prompt describes it.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileView {
    /// Whether `read_file` is offered at all this run. Everything else here describes how it
    /// behaves, so a run that withholds the tool states none of it.
    pub offered: bool,
    /// Whether a line cap is in force at all. False when `read_file` is not offered, or when it
    /// reads whole files.
    pub capped: bool,
    /// The cap, in lines. Meaningless (and unreferenced by the template) when not
    /// [capped](Self::capped).
    pub line_cap: usize,
    /// Whether this run's model can be shown an **image**.
    ///
    /// A test case's specs ship reference mockups, and whether reading one shows the
    /// model a picture or only describes it is a fact about the model, not the file.
    /// Stating it up front is what keeps a text-only run from spending turns re-reading
    /// a `.png` hoping for a different answer — the alternative is the model learning it
    /// one wasted read at a time. `false` **only** when the catalog positively declared
    /// the model text-only; a model whose modalities are unknown is described as able to
    /// see images, matching the optimistic default the tool itself takes.
    pub images: bool,
}

/// How much of a command's output one `shell` call returns — the
/// [output policy](crate::tools::OffloadPolicy) as the prompt describes it.
///
/// The [inline](crate::tools::OffloadPolicy::Inline) policy renders **nothing**: an agent whose
/// commands come back whole has no rule to learn. A truncating policy has something to say, and it
/// has to be said up front — a model that discovers the ceiling from a truncated build log will
/// assume the missing output is gone, and re-run the command with a narrower filter instead of
/// grepping the file it was handed.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellView {
    /// Whether `shell` output is offloaded this run. False when the tool is not offered, or when its
    /// output comes back inline — in which case nothing else here is referenced by the template.
    pub offloaded: bool,
    /// How much of the output does come back, in the words the truncation note uses: "last 200
    /// lines", "last 4000 characters", or both.
    pub tail: String,
    /// The directory the full stdout/stderr pair of every command is written to.
    pub directory: String,
}

/// One message [heading](crate::context::code_heading) the prompt documents: the exact word that
/// precedes a synthesized `user` message (before its `\n----\n` rule) and a one-line description of
/// what such a message carries, so the model reads the transcript's structure rather than inferring
/// it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeHeadingView {
    /// The heading word itself (`Task`, `Output`, `Memories`), matching what
    /// [`code_heading`](crate::context::code_heading) prefixes the message with.
    pub heading: String,
    /// A one-line description of what a message under this heading carries.
    pub description: String,
}

/// One API object a code program has, as the system prompt names it: the object identifier a
/// program reaches (`fs`) and a one-line description of what it is for. The functions on it are not
/// listed — the model discovers those with `object.list()` and `view.openDocsView()`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiView {
    /// The object identifier a program reaches (`fs`, `project`, `harness`).
    pub object: String,
    /// A one-line description of what the object is for.
    pub description: String,
}

/// One available skill as the system prompt lists it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    /// The skill's name — what `read_skill` is called with.
    pub name: String,
    /// The skill's one-line description.
    pub description: String,
}

/// One agent this agent may put to work, as the system prompt lists it — the target's name and the
/// caller-scoped description of when to use it. Used for all three roster
/// [scopes](test_cabinet_core::gg::GgSubagentScope).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnableAgentView {
    /// The target agent profile's name — a value the call this list belongs to accepts for its
    /// `agent`/`reviewers` argument.
    pub name: String,
    /// Caller-scoped guidance on when to use this agent. May be empty.
    pub description: String,
}

/// The [memory](crate::memories) shape and budget the prompt states.
///
/// The three strategies are carried as booleans rather than as the strategy's id, because a
/// template can branch on a flag but not compare a string — and each strategy's paragraph says
/// something different enough that a shared one with holes in it would read as neither.
///
/// Every limit is optional, and `None` (unlimited, or not used by this strategy) renders as
/// nothing at all rather than as the word "unlimited": a sentence about a budget that does not
/// exist is a sentence about something the model then has to think about.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoriesView {
    /// The [scratchpad](crate::memories::MemoryStrategy::Scratchpad) strategy: every memory is in
    /// the window.
    pub scratchpad: bool,
    /// The [markdown](crate::memories::MemoryStrategy::Markdown) strategy: a pinned index over
    /// files read on demand.
    pub markdown: bool,
    /// The [keyword-search](crate::memories::MemoryStrategy::KeywordSearch) strategy: files found
    /// by search, nothing pinned.
    pub keyword_search: bool,
    /// The maximum number of memories that may exist at once.
    pub max_count: Option<usize>,
    /// The maximum body length, in characters, of any single memory.
    pub max_len_per_memory: Option<usize>,
    /// The maximum total body length, in characters, across every memory.
    pub max_total_len: Option<usize>,
    /// The maximum length, in characters, of the pinned index.
    pub max_len_index: Option<usize>,
    /// The maximum length, in characters, of a memory's one-line description. Stated because a
    /// model that finds out about this limit by being refused has already spent a call on it.
    pub max_len_description: Option<usize>,
    /// The most memories one search reports.
    pub max_results: Option<usize>,
    /// Whether this agent holds the memories **read-only** — a
    /// [`read-only`](crate::memories::MemoryScope::ReadOnly) handle onto another agent's instance.
    /// It flips each strategy's paragraph from "curate these" to "these are another agent's, and
    /// here is how to read them", because an agent told to write memories regularly and then
    /// offered no call that writes one is an agent that will spend turns looking for it.
    pub read_only: bool,
    /// Whether this agent's memory instance may be held by **other agents too** — every
    /// [scope](crate::memories::MemoryScope) but `isolated`. It is what earns the paragraph
    /// explaining the notices: an agent that will be told "another agent added a memory" mid-thread
    /// has to know in advance that such a message is gg reporting a fact, not the model being
    /// addressed by a stranger.
    pub linked: bool,
    /// The [scope](crate::memories::MemoryScope) this agent bound under, named literally so the
    /// prompt and a run's recorded configuration use one vocabulary.
    pub scope: String,
}

/// The task-list ceiling the prompt states.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksView {
    /// The maximum number of tasks the list may hold at once.
    pub max_tasks: usize,
}

/// The board ceilings and rosters the prompt states.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    /// The maximum number of epics the board may hold at once.
    pub max_epics: usize,
    /// The maximum number of issues the board may hold at once.
    pub max_issues: usize,
    /// How many times gg re-dispatches a failed issue before marking it failed.
    pub max_retries: usize,
    /// Whether this agent must name one or more reviewers on every issue it files (as opposed to
    /// naming them being optional).
    pub reviewers_required: bool,
    /// The agents this one may assign an issue to — its roster's
    /// [`implementer`](test_cabinet_core::gg::GgSubagentScope::Implementer) scope.
    ///
    /// Listed in the project-management section rather than left to the tool schema because the two
    /// rosters are genuinely different sets: a model told only "choose an agent" reaches for a name
    /// it may spawn but may not assign, spends a call finding out, and learns nothing it could not
    /// have been told up front.
    pub issue_agents: Vec<SpawnableAgentView>,
    /// The agents this one may name as an issue's reviewers — its roster's
    /// [`reviewer`](test_cabinet_core::gg::GgSubagentScope::Reviewer) scope.
    pub reviewer_agents: Vec<SpawnableAgentView>,
}

/// The [board issue](crate::board) an auto-dispatched agent was sent to implement, as its prompt
/// names it.
///
/// The id is the whole of it, and it is here rather than left to the brief because the brief says
/// what to build while this says how the work is *recorded*: an implementer that ends its session
/// without recording its issue finished has its worktree discarded and its issue attempted again,
/// however good the work was.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignedIssueView {
    /// The id of the issue this agent is implementing.
    pub id: String,
}

/// The built-in template name for a run's execution mode: the code arm under
/// [responses-as-code](SystemContext::responses_as_code), the tool-calling arm otherwise. The two
/// are registered separately (see [`TEMPLATES`]) and this is the only place that decides between
/// them, so a run is rendered against exactly the arm whose contract it will actually be held to.
fn system_template_name(responses_as_code: bool) -> &'static str {
    if responses_as_code {
        "system-code"
    } else {
        "system-tools"
    }
}

/// Render the [system prompt](SystemContext) for a run.
///
/// The built-in template is chosen by the run's [execution mode](SystemContext::responses_as_code):
/// the [code arm](SYSTEM_CODE_TEMPLATE) for a responses-as-code run, the
/// [tool-calling arm](SYSTEM_TOOLS_TEMPLATE) otherwise.
///
/// `template_override` is an agent profile's
/// [full-template override](test_cabinet_core::gg::GgAgentConfig::system_prompt_template): when
/// present (and non-blank) it is rendered against the same [`SystemContext`] instead of the
/// built-in template. A malformed override — one that references a variable the context does not
/// carry — falls back to the built-in template for the run's mode rather than aborting the run,
/// since it is operator-authored input, not an embedded artifact the tests pin.
pub fn render_system(context: &SystemContext, template_override: Option<&str>) -> String {
    let builtin = system_template_name(context.responses_as_code);
    let rendered = match template_override.map(str::trim).filter(|t| !t.is_empty()) {
        Some(template) => engine()
            .render_template(template, context)
            .unwrap_or_else(|_| render(builtin, context)),
        None => render(builtin, context),
    };
    tidy(&rendered)
}

/// The built-in **tool-calling** system-prompt template, verbatim — the default an operator's
/// [`GgAgentConfig::system_prompt_template`](test_cabinet_core::gg::GgAgentConfig::system_prompt_template)
/// override starts from for a tool-calling agent, and what the console seeds its editor with for
/// one. The per-capability sections are inlined into this one file, so it is self-contained
/// Handlebars (no partials).
///
/// The console's copy is generated from the same `.hbs` file (see `scripts/gen-contract.mjs`); this
/// accessor is the in-crate mirror, used by the prompt tests to pin that the template parses and
/// renders on its own.
#[allow(dead_code)]
pub fn default_system_prompt_template() -> &'static str {
    SYSTEM_TOOLS_TEMPLATE
}

/// The built-in **responses-as-code** system-prompt template, verbatim — the default an operator's
/// override starts from for a code-mode agent, and what the console seeds its editor with for one.
/// Like its tool-calling sibling it is self-contained Handlebars (no partials).
#[allow(dead_code)]
pub fn default_system_prompt_template_code() -> &'static str {
    SYSTEM_CODE_TEMPLATE
}

// ---------------------------------------------------------------------------
// The code-turn feedback
// ---------------------------------------------------------------------------

/// The variables `code-not-a-program.hbs` may reference: the notice for a turn whose reply never
/// became something to run.
///
/// The only code message that takes a context at all, and it is still narrow: the reply was prose,
/// or comments, or empty, or several candidate blocks, and the two things the model needs are which
/// of those it was and what a turn is supposed to look like instead. A compiler or runtime error
/// needs no context because it *is* its error.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeNotAProgramContext {
    /// Why the reply was not a program, as
    /// [`NotAProgramReason::message`](crate::healing::NotAProgramReason::message) words it.
    ///
    /// Pre-rendered in Rust rather than branched on here: the reason is an enum with one sentence
    /// per variant, and a template that reproduced that mapping would be a second place for the six
    /// sentences to live.
    pub reason: String,
    /// This agent's [ending calls](crate::ending::EndingRole), as a program writes them.
    ///
    /// It matters most on this template of the four: this is the turn a model takes when it has
    /// answered in prose because it believes the work is done, so it is precisely the moment to name
    /// the call it should have made instead — and naming a call the agent's role does not have would
    /// send it looking for a function that is not in its scope.
    pub ending_calls: Vec<String>,
}

/// The notice a program that ran cleanly and showed itself nothing earns.
///
/// Falls back to a plain sentence rather than panicking, as every model-facing render here does: a
/// turn with degraded wording is recoverable where a panicked run is not.
pub fn render_code_nothing_shown() -> String {
    try_render("code-nothing-shown", &json!({})).unwrap_or_else(|_| {
        "Your program ran and put nothing in your context. Open a view to see something: \
         `view.openText(label, body)` for a value you computed, `view.openFile(path)` for a file."
            .to_string()
    })
}

/// The model-facing feedback for a reply that was **not a program**, so nothing ran at all.
///
/// Falls back to a plain sentence for the same reason the other three do — its input is derived from
/// a model's own output — and the fallback keeps the two facts the turn exists to deliver: why the
/// reply was refused, and which call would actually have ended the session.
pub fn render_code_not_a_program(context: &CodeNotAProgramContext) -> String {
    try_render("code-not-a-program", context).unwrap_or_else(|_| {
        format!(
            "{} Every turn is a program: reply with code alone. Saying the work is done does not \
             end your session — call {} instead.",
            context.reason,
            context
                .ending_calls
                .iter()
                .map(|call| format!("`{call}`"))
                .collect::<Vec<_>>()
                .join(" or ")
        )
    })
}

// ---------------------------------------------------------------------------
// The pinned context blocks
// ---------------------------------------------------------------------------

/// The variables `tasks.hbs` may reference: the current [task list](crate::tasks), in add order.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksBlockContext {
    /// The tasks, in add order.
    pub tasks: Vec<TaskItemView>,
}

/// One task as the pinned block renders it. The ready/blocked derivation is done in Rust (the
/// store owns the DAG), so the template only lays the line out.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItemView {
    /// The task's id.
    pub id: String,
    /// The task's title.
    pub title: String,
    /// The task's description, when it has one.
    pub description: Option<String>,
    /// The status word (`pending`, `in progress`, `done`).
    pub status: String,
    /// The checkbox-style status marker (`[ ]`, `[~]`, `[x]`).
    pub marker: String,
    /// Whether the task is actionable now: open, with every blocker done.
    pub ready: bool,
    /// The task's incomplete blockers, pre-formatted (``` `a`, `b` ```), or `None` when the task
    /// is ready or done.
    pub blocked_by: Option<String>,
    /// What the task covers — present only in the tasks capability's **issues**
    /// [mode](crate::tasks), which requires the structured sections. `None` in **simple** mode.
    pub in_scope: Option<String>,
    /// What the task deliberately does not cover — present only in **issues** mode.
    pub out_of_scope: Option<String>,
    /// What makes the task done — present only in **issues** mode.
    pub completion_criteria: Option<String>,
}

/// Render the pinned [task list](crate::tasks) block.
pub fn render_tasks(context: &TasksBlockContext) -> String {
    render("tasks", context)
}

/// The variables `board.hbs` may reference: the current [board](crate::board).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardBlockContext {
    /// The epics, in creation order.
    pub epics: Vec<EpicItemView>,
    /// The issues, in creation order.
    pub issues: Vec<IssueItemView>,
}

/// One epic as the pinned block renders it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicItemView {
    /// The epic's id.
    pub id: String,
    /// The epic's title.
    pub title: String,
    /// The epic's description.
    pub description: String,
}

/// One issue as the pinned block renders it — the line, plus the structured brief (scope and
/// completion criteria) that makes an issue dispatchable.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueItemView {
    /// The issue's id.
    pub id: String,
    /// The issue's title.
    pub title: String,
    /// The issue's overview, when it has one.
    pub description: Option<String>,
    /// The status word (`open`, `in progress`, `done`).
    pub status: String,
    /// The checkbox-style status marker.
    pub marker: String,
    /// The id of the epic the issue belongs to, when it is grouped under one.
    pub epic_id: Option<String>,
    /// Whether the issue is actionable now.
    pub ready: bool,
    /// The issue's incomplete blockers, pre-formatted, or `None` when it is ready or done.
    pub blocked_by: Option<String>,
    /// What the issue covers.
    pub in_scope: String,
    /// What the issue deliberately does not cover.
    pub out_of_scope: String,
    /// What makes the issue done.
    pub completion_criteria: String,
    /// The agent profile the issue is assigned to — who gg dispatches it under.
    pub agent: String,
    /// The issue's reviewer profiles, pre-formatted, or `None` when it was filed without any.
    pub reviewers: Option<String>,
}

/// Render the pinned [epic/issue board](crate::board) block.
pub fn render_board(context: &BoardBlockContext) -> String {
    render("board", context)
}

/// The variables `memories.hbs` may reference: the in-play [memories](crate::memories).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoriesBlockContext {
    /// The memories, in write order.
    pub memories: Vec<MemoryItemView>,
}

/// One memory as the pinned block renders it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItemView {
    /// The memory's name.
    pub name: String,
    /// The memory's one-line description.
    pub description: String,
    /// The memory's body.
    pub body: String,
}

/// Render the pinned [memories](crate::memories) block.
pub fn render_memories(context: &MemoriesBlockContext) -> String {
    render("memories", context)
}

/// The variables `memory-index.hbs` may reference: the
/// [markdown](crate::memories::MemoryStrategy::Markdown) strategy's pinned index.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryIndexContext {
    /// The index exactly as the store renders it — one `- \`slug\` — description` line per
    /// memory. It arrives pre-rendered rather than as a list the template formats because the
    /// store measures this very text against the index limit, and a template that spelled an
    /// entry differently would be quoting the model a budget it is not being charged.
    pub index: String,
}

/// Render the [markdown](crate::memories::MemoryStrategy::Markdown) strategy's pinned index block.
pub fn render_memory_index(context: &MemoryIndexContext) -> String {
    render("memory-index", context)
}

/// The variables `memory-notice.hbs` may reference: what **another** holder of this agent's shared
/// memory instance has done since it was last told.
///
/// The notice is the whole of gg's linked-memory signalling, and it is deliberately small. It is
/// appended at the tail of the window rather than folded into the pinned index, because the index
/// is the prefix every provider caches and rewriting it on a turn this agent did nothing would
/// re-bill the whole request. So the news arrives as an ordinary message, once, naming what
/// changed and leaving the agent to decide whether it bears on the work it is doing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNoticeContext {
    /// What changed, one line per memory rather than one per write, in the order each memory first
    /// appeared in the batch.
    pub entries: Vec<MemoryNoticeEntry>,
    /// The call this run's [strategy](crate::memories::MemoryStrategy) reads a memory with, in
    /// this agent's execution mode — `None` under the
    /// [scratchpad](crate::memories::MemoryStrategy::Scratchpad), which has none because its
    /// memories are already in the window. A notice must be actionable, and a pointer to a call
    /// the agent does not have is not.
    pub read_call: Option<String>,
    /// Whether each entry carries the memory's body inline — what the scratchpad does *instead* of
    /// naming a read call.
    pub inline_bodies: bool,
    /// Whether a pinned [index](MemoryIndexContext) is lagging behind this news until the agent's
    /// next compaction, which is worth saying so the model does not read the index as a
    /// contradiction of what it has just been told.
    pub indexed: bool,
}

/// One memory a [notice](MemoryNoticeContext) reports, as of the last thing that happened to it in
/// the batch being reported.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNoticeEntry {
    /// The memory's slug.
    pub name: String,
    /// What happened to it: `added`, `updated` or `deleted`. Deletions are reported too — an agent
    /// acting on a memory that has since been deleted is the failure the notice exists to prevent.
    pub change: String,
    /// The memory's one-line description as of that change; empty on a deletion, and under a
    /// strategy that does not require one.
    pub description: String,
    /// The memory's body, carried only where there is no read call to fetch it with. Already
    /// bounded by [`maxLenPerMemory`](crate::memories::MemoryCaps::max_len_per_memory).
    pub body: Option<String>,
}

/// Render the [linked-memory notice](crate::memories::MemoriesRuntime::notice).
pub fn render_memory_notice(context: &MemoryNoticeContext) -> String {
    render("memory-notice", context)
}

/// The empty rendering context, for the templates that interpolate nothing and exist purely so
/// their prose is a file an operator can edit rather than a Rust literal.
#[derive(Debug, Serialize)]
struct NoContext {}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------
//
// The prose gg hands to an agent it *dispatches*, as opposed to the prose it hands to the agent it
// is already talking to. A brief is the whole task from its reader's point of view — it is the only
// thing a freshly spawned reviewer, fixer, merge agent, attempt, or judge has ever been told — so
// it is product text of exactly the same weight as the system prompt, and lives in the same place.
//
// Every brief that ends in a **verdict or a summary** takes a `code` flag, because under
// [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) there is no final message
// to end and no stopping that is not a `finish` call. A brief that teaches the wrong ending fails
// silently: the child does the work, never reaches `completed`, and everything gated on that status
// discards it.

/// The variables `issue-brief.hbs` may reference: one [board issue](crate::board) as its assigned
/// agent is given it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueBriefContext {
    /// The issue's id.
    pub id: String,
    /// The issue's title.
    pub title: String,
    /// The issue's overview, when it has one.
    pub description: Option<String>,
    /// What the issue covers.
    pub in_scope: String,
    /// What the issue deliberately does not cover.
    pub out_of_scope: String,
    /// What makes the issue done.
    pub completion_criteria: String,
}

/// Render an [issue](crate::board)'s dispatch brief.
pub fn render_issue_brief(context: &IssueBriefContext) -> String {
    render("issue-brief", context)
}

/// The variables `review-brief.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewBriefContext {
    /// The [issue brief](render_issue_brief) of the work under review, verbatim.
    pub issue_brief: String,
    /// The verdicts earlier rounds already returned, oldest first. Empty on a first review, which
    /// renders no history section — a reviewer that cannot see what a previous round asked for
    /// re-litigates it, and one shown an empty section wonders what it is missing.
    pub history: Vec<ReviewRecordView>,
    /// Where the work is and what it touched.
    pub changes: ReviewChangesView,
}

/// One earlier round's verdict, as the reviewer's brief recounts it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRecordView {
    /// The agent profile that reviewed.
    pub reviewer: String,
    /// Whether it approved the work.
    pub approved: bool,
    /// The changes it asked for, when it did not approve.
    pub items: Vec<String>,
}

/// **Where the work under review is, and what it touched** — deliberately not the work itself.
///
/// A reviewer is dispatched *into* the worktree it is reviewing, so it reads the code at exactly
/// the depth it needs. Pasting the whole patch in instead made every review prompt carry every
/// generated file the work touched (a regenerated lockfile alone can dwarf the code under review).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChangesView {
    /// The per-file summary of the change (`git diff --stat`), or `None` when nothing changed
    /// against the baseline — stated plainly so the reviewer does not hallucinate changes.
    pub summary: Option<String>,
    /// The commit the work branched from, when there is one: what a reviewer with a shell diffs
    /// against to see the change itself.
    pub baseline: Option<String>,
}

/// Render the brief a [reviewer](crate::agent) of an issue's work is dispatched with.
pub fn render_review_brief(context: &ReviewBriefContext) -> String {
    render("review-brief", context)
}

/// One item of an ordered, model-facing list, numbered by the caller because Handlebars' `@index`
/// counts from zero and a prompt counts from one.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberedItem {
    /// The item's 1-based number.
    pub number: usize,
    /// The item's text.
    pub text: String,
}

/// The variables `fix-brief.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixBriefContext {
    /// The [issue brief](render_issue_brief) of the work being redone, verbatim.
    pub issue_brief: String,
    /// The reviewer's actionable items. Never empty: `request_changes` refuses a verdict with
    /// nothing in it, so the assigned agent always has something to act on.
    pub items: Vec<NumberedItem>,
}

/// Render the brief an issue's own agent is re-dispatched with after a review requested changes.
/// The `## Requested changes` heading it renders is a stable marker (a worker can detect it is on a
/// fix pass).
pub fn render_fix_brief(context: &FixBriefContext) -> String {
    render("fix-brief", context)
}

/// The variables `merge-brief.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeBriefContext {
    /// The branch being merged.
    pub branch: String,
    /// What git reported.
    pub reason: String,
}

/// Render the [merge agent](crate::agent)'s brief.
///
/// It is deliberately concrete about the end state — a committed merge, no conflict markers left —
/// because that is what gg checks afterwards, and an agent that thinks "resolved" means "edited the
/// files" would leave the workspace mid-merge.
pub fn render_merge_brief(context: &MergeBriefContext) -> String {
    render("merge-brief", context)
}

/// The variables `attempt-brief.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptBriefContext {
    /// The shared task every attempt is given.
    pub base: String,
    /// This attempt's 1-based number.
    pub index: usize,
    /// How many attempts are running.
    pub count: usize,
    /// This attempt's assigned approach hint, when one was given.
    pub approach: Option<String>,
}

/// Render one attempt's brief for a [speculative execution](crate::agent).
pub fn render_attempt_brief(context: &AttemptBriefContext) -> String {
    render("attempt-brief", context)
}

/// The variables `judge-brief.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeBriefContext {
    /// The task every attempt was given.
    pub task: String,
    /// The candidates, renumbered 1..N — the judge never sees the attempts that were discarded, and
    /// the caller maps its pick back to the original attempt index.
    pub attempts: Vec<JudgeAttemptView>,
    /// How many candidates there are.
    pub count: usize,
}

/// One candidate as the judge's brief presents it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeAttemptView {
    /// The candidate's 1-based number, as the judge names it in its verdict.
    pub number: usize,
    /// The attempt's own closing summary, or `None` when it gave none.
    pub summary: Option<String>,
}

/// Render the judge's brief for a [speculative execution](crate::agent).
pub fn render_judge_brief(context: &JudgeBriefContext) -> String {
    render("judge-brief", context)
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/// The variables the [compaction](crate::compaction) templates may reference: which requirement is
/// pending, how this run's model makes the calls that satisfy it, and (for the refusal) what was
/// refused.
///
/// The requirement is three booleans rather than a strategy name for the same reason
/// [`EndingView`] carries booleans: the templates render in strict mode with no comparison helper,
/// so a name would have to be re-derived in Handlebars — which is where a prompt and the loop it
/// describes drift.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionPromptContext {
    /// The next reply's text **is** the summary.
    pub summary: bool,
    /// The agent must call [`compact`](crate::compaction).
    pub compact_call: bool,
    /// The agent must record its working state as [memories](crate::memories).
    pub memory_writes: bool,
    /// Whether the run is in [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/)
    /// mode, so the instruction names the call the way that run's model actually makes it.
    pub code_mode: bool,
    /// The name of the compact tool, so the prompt names it from one source.
    pub compact_tool: String,
    /// The call that records a memory, as this run's
    /// [memory strategy](crate::memories::MemoryStrategy) names it in this execution mode —
    /// backticks included, since they arrive already quoted. Interpolated rather than written into
    /// the template, which would otherwise name the scratchpad's tools at a run that was never
    /// offered them.
    pub memory_create: String,
    /// The call that revises a memory. See [`memory_create`](Self::memory_create).
    pub memory_revise: String,
    /// The call that deletes a memory. See [`memory_create`](Self::memory_create).
    pub memory_delete: String,
    /// The call the refusal answers, named because a model told "do X" while its Y silently fails
    /// reads the failure as gg being broken and retries Y. Only the refusal renders it.
    pub refused: Option<String>,
}

/// Render the instruction that opens an in-loop [compaction](crate::compaction).
pub fn render_compaction_instruction(context: &CompactionPromptContext) -> String {
    render("compaction-instruction", context)
}

/// Render the feedback for a reply that satisfied a pending compaction in no way at all.
pub fn render_compaction_unsatisfied(context: &CompactionPromptContext) -> String {
    render("compaction-unsatisfied", context)
}

/// Render the refusal that answers a call a pending compaction does not accept.
pub fn render_compaction_refusal(context: &CompactionPromptContext) -> String {
    render("compaction-refusal", context)
}

/// Render the system prompt the
/// [handoff summarization](crate::compaction::CompactionStrategy::HandoffSummarization) strategy
/// gives the separate compaction model.
pub fn render_compaction_handoff_summary() -> String {
    render("compaction-handoff-summary", &NoContext {})
}

/// Render the system prompt the
/// [handoff compaction](crate::compaction::CompactionStrategy::HandoffCompaction) strategy gives
/// the separate compaction model.
pub fn render_compaction_handoff_compact(compact_tool: &str) -> String {
    render(
        "compaction-handoff-compact",
        &CompactionPromptContext {
            compact_tool: compact_tool.to_string(),
            ..CompactionPromptContext::default()
        },
    )
}

/// Render the summary item a compacted thread is restarted from: the heading that frames it as a
/// recap of dropped history, then `summary` itself.
pub fn render_compaction_preface(summary: &str) -> String {
    render("compaction-preface", &SummaryContext { summary })
}

/// The variables `compaction-preface.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryContext<'a> {
    /// The summary the thread is restarted from.
    summary: &'a str,
}

/// Render the summary used when the summarization model call fails.
pub fn render_compaction_fallback() -> String {
    render("compaction-fallback", &NoContext {})
}

/// Render the "summary" a [memory compaction](crate::compaction::CompactionStrategy::Memory)
/// restarts the thread from.
pub fn render_compaction_memory_summary() -> String {
    render("compaction-memory-summary", &NoContext {})
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/// The variables `completion-missing.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EndingCallsContext<'a> {
    /// The agent's [ending calls](crate::ending::EndingRole), so the prompt names the ones this
    /// reader actually has from one source.
    ending_calls: &'a [&'a str],
}

/// Render the feedback for a tool-calling turn that requested no tools — a text-only reply, which is
/// an error rather than an ending.
pub fn render_completion_missing(ending_calls: &[&str]) -> String {
    render("completion-missing", &EndingCallsContext { ending_calls })
}

/// The variables `completion-validation-failure.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationFailureContext<'a> {
    /// Which command failed, 1-based.
    pub index: usize,
    /// How many commands gate completion.
    pub total: usize,
    /// The command as it reads in the prompt.
    pub command: &'a str,
    /// What it printed.
    pub output: &'a str,
}

/// Render the feedback for a completion a [validation command](crate::completion) rejected.
pub fn render_completion_validation_failure(context: &ValidationFailureContext<'_>) -> String {
    render("completion-validation-failure", context)
}

// ---------------------------------------------------------------------------
// Context pressure
// ---------------------------------------------------------------------------

/// The variables `context-pressure.hbs` may reference: what share of the window each category holds,
/// and — for the one category the agent can act on file by file — which files are inside it.
///
/// Every figure arrives here **pre-formatted as a percentage string**. The template's job is layout;
/// deciding what a number means (and to how many places) belongs with the accounting that produced
/// it, in [`crate::context`].
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPressureContext {
    /// How much of the window is in use, as a percentage.
    pub overall: String,
    /// One entry per [source](crate::context) actually holding something, in a stable order.
    pub categories: Vec<UsageCategoryView>,
    /// Whether to point the agent at `evict_file_view`.
    pub can_evict: bool,
    /// Whether to point the agent at `view.close`, which is the reclaim call under
    /// [responses-as-code](crate::agent) and the only one that can close a **text view**. Without
    /// this the block can report a `Text Views` band whose tokens the agent is told no way to get
    /// back — the exact defect the per-file breakdown's `can_evict` gate exists to prevent, one
    /// level up.
    pub can_close_views: bool,
    /// Whether to point the agent at `archive_thread`.
    pub can_archive: bool,
}

/// One category of the [context-usage](ContextPressureContext) block: what it is called, what share
/// of the window it holds, and (only for file views, and only for an agent that can evict) the
/// individual files inside it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCategoryView {
    /// The category's model-facing name — also the heading its nested list gets (`Top <label>`).
    pub label: String,
    /// Its share of the window, as a percentage.
    pub percent: String,
    /// The largest individual contributors inside this category, largest first. Empty renders no
    /// nested list.
    pub top_files: Vec<UsageFileView>,
}

/// One file inside the [file-view breakdown](UsageCategoryView::top_files).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageFileView {
    /// The workspace path, exactly as `evict_file_view { path }` takes it.
    pub path: String,
    /// Its share of the window, as a percentage.
    pub percent: String,
}

/// Render the per-turn [context-usage](crate::context) signal.
pub fn render_context_pressure(context: &ContextPressureContext) -> String {
    render("context-pressure", context)
}

#[cfg(test)]
#[path = "prompts.test.rs"]
mod tests;
