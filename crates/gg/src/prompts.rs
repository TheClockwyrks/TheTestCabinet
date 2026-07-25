//! gg's **model-facing prose**, authored as Handlebars templates rather than as Rust string
//! literals.
//!
//! Everything gg *says* to a model — the system prompt, the pinned context blocks that render
//! the task list, the epic/issue board and the memories, and the planning capability's plan-mode
//! guidance — lives in `crates/gg/templates/*.hbs` and is rendered here. The templates are
//! [embedded](include_str!) at compile time, so gg keeps its "no external resources" property:
//! the binary carries its prompts.
//!
//! # Why templates
//!
//! The prompt is a **maintained artifact**, not incidental code. gg's whole point is that its
//! capabilities are independently toggleable, so the prompt has to describe *exactly* the
//! capabilities a run enabled — which, written as Rust, means a dozen `push_str` calls scattered
//! across as many modules, each carrying a paragraph of prose in string-continuation syntax.
//! Templating collapses that into one readable file per artifact: the conditional sections are
//! `{{#if}}` blocks over the [rendering context](SystemContext), and a run's configuration
//! (memory caps, the task ceiling, the `read_file` line cap, the FSM's name) is interpolated
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

use std::sync::OnceLock;

use handlebars::Handlebars;
use serde::Serialize;

/// The system prompt: the base framing plus one conditional section per enabled capability.
const SYSTEM_TEMPLATE: &str = include_str!("../templates/system.hbs");

/// The pinned [task list](crate::tasks) block.
const TASKS_TEMPLATE: &str = include_str!("../templates/tasks.hbs");

/// The pinned [epic/issue board](crate::board) block.
const BOARD_TEMPLATE: &str = include_str!("../templates/board.hbs");

/// The pinned [memories](crate::memories) block.
const MEMORIES_TEMPLATE: &str = include_str!("../templates/memories.hbs");

/// The [default planner](crate::planning::DefaultPlanner)'s plan-mode guidance.
const PLAN_MODE_TEMPLATE: &str = include_str!("../templates/plan-mode.hbs");

/// The [default planner](crate::planning::DefaultPlanner)'s framing of an accepted plan.
const PLAN_FRAMING_TEMPLATE: &str = include_str!("../templates/plan-framing.hbs");

/// The template names registered with the [engine], in the order they are registered. Each name
/// is what [`render`] looks up, and the tests iterate this list to assert every template parses.
const TEMPLATES: &[(&str, &str)] = &[
    ("system", SYSTEM_TEMPLATE),
    ("tasks", TASKS_TEMPLATE),
    ("board", BOARD_TEMPLATE),
    ("memories", MEMORIES_TEMPLATE),
    ("plan-mode", PLAN_MODE_TEMPLATE),
    ("plan-framing", PLAN_FRAMING_TEMPLATE),
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
        for (name, source) in TEMPLATES {
            engine
                .register_template_string(name, source)
                .unwrap_or_else(|err| panic!("gg template `{name}` does not parse: {err}"));
        }
        engine
    })
}

/// Render the registered template `name` with `context`.
///
/// A render failure means a template references something its context does not carry — again a
/// bug in an embedded file, caught by the tests — so it panics with the template name and the
/// Handlebars error rather than handing a model a silently truncated prompt.
fn render<T: Serialize>(name: &str, context: &T) -> String {
    engine()
        .render(name, context)
        .unwrap_or_else(|err| panic!("gg template `{name}` failed to render: {err}"))
        .trim()
        .to_string()
}

/// Normalize the system prompt's whitespace: collapse any run of three or more newlines to a
/// blank-line separator.
///
/// This is what lets `system.hbs` stay readable. A `{{#if}}` section that renders nothing still
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

/// The variables `system.hbs` may reference — one field per capability the prompt describes,
/// carrying that capability's configuration so the prompt can state a run's actual limits
/// instead of restating a default in prose.
///
/// An `Option` field is `null` when the capability is off, which is what the template's
/// `{{#if …}}` gate tests: a disabled capability contributes **no prompt text at all**, which is
/// the property [toolset ablation](https://docs.testcabinet.ai/gg/toolset-ablation/) depends on.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemContext {
    /// The tools offered this run, in registry order. Empty when the capability set offers none
    /// — the template then tells the model it can only reply in text.
    pub tools: Vec<ToolView>,
    /// Whether the run is in [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/)
    /// mode, where the tools are described as functions a program calls rather than as tool calls.
    pub responses_as_code: bool,
    /// How much of a file one `read_file` call returns, so a capped run says so up front.
    pub read_file: ReadFileView,
    /// The available [skills](crate::skills), each with its one-line description. Empty when the
    /// capability is off or the library holds none.
    pub skills: Vec<SkillView>,
    /// The [memories](crate::memories) budget, or `None` when the capability is off.
    pub memories: Option<MemoriesView>,
    /// The [task list](crate::tasks) ceiling, or `None` when the capability is off.
    pub tasks: Option<TasksView>,
    /// The [epic/issue board](crate::board) ceilings, or `None` when the capability is off.
    pub board: Option<BoardView>,
    /// Whether the [planning](crate::planning) capability is on.
    pub planning: bool,
    /// The [FSM](crate::fsm) driving the run, or `None` when no machine drives it.
    pub fsm: Option<FsmView>,
    /// Whether Code Reviews gate issue acceptance this run.
    pub code_reviews: bool,
    /// Whether speculative execution (`speculate`) is available this run.
    pub speculative: bool,
}

/// One offered tool as the system prompt sees it.
///
/// Carries what *both* modes need: the traditional tool-calling section lists the
/// [`name`](Self::name), while the [responses-as-code](SystemContext::responses_as_code) section
/// renders each tool as a callable function, so it also needs the argument names and a one-line
/// description.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolView {
    /// The tool's name, as the model calls it.
    pub name: String,
    /// The tool's argument names, comma-joined (pre-joined so the template needs no separator
    /// logic). Empty for a tool taking no arguments.
    pub args: String,
    /// The first line of the tool's description.
    pub description: String,
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
    /// Whether the cap is a **ceiling** the agent cannot argue past (as opposed to a default it
    /// may exceed with an explicit `limit`).
    pub hard_cap: bool,
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

/// One available skill as the system prompt lists it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    /// The skill's name — what `read_skill` is called with.
    pub name: String,
    /// The skill's one-line description.
    pub description: String,
}

/// The memories budget the prompt states.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoriesView {
    /// The maximum number of memories that may exist at once.
    pub max_count: usize,
    /// The maximum body length, in characters, of any single memory.
    pub max_len_per_memory: usize,
    /// The maximum total body length, in characters, across every memory.
    pub max_total_len: usize,
}

/// The task-list ceiling the prompt states.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksView {
    /// The maximum number of tasks the list may hold at once.
    pub max_tasks: usize,
}

/// The board ceilings the prompt states.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    /// The maximum number of epics the board may hold at once.
    pub max_epics: usize,
    /// The maximum number of issues the board may hold at once.
    pub max_issues: usize,
}

/// The process driving the run, named in the prompt.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsmView {
    /// The active machine's name (for example `tdd`).
    pub machine: String,
}

/// Render the [system prompt](SystemContext) for a run.
pub fn render_system(context: &SystemContext) -> String {
    tidy(&render("system", context))
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

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/// Render the [default planner](crate::planning::DefaultPlanner)'s plan-mode guidance — the
/// block injected into the context when an agent enters read-only plan mode. It takes no
/// variables, but renders through the same engine so all of gg's prose lives in one place.
pub fn render_plan_mode() -> String {
    render("plan-mode", &PlanContext { plan: None })
}

/// Render the [default planner](crate::planning::DefaultPlanner)'s framing of an accepted
/// `plan`: the heading that orients the agent, followed by the plan verbatim.
pub fn render_plan_framing(plan: &str) -> String {
    render(
        "plan-framing",
        &PlanContext {
            plan: Some(plan.trim().to_string()),
        },
    )
}

/// The variables the two planning templates may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanContext {
    /// The submitted plan, verbatim. `None` for the plan-mode guidance, which has no plan yet.
    plan: Option<String>,
}

#[cfg(test)]
#[path = "prompts.test.rs"]
mod tests;
