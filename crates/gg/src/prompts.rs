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
//!
//! # The one prose gg does not author
//!
//! Under [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) the prompt has to
//! describe an **API**, and an API description written by hand is an API description that drifts.
//! So the tool list in that section — every signature, every sentence of documentation, every type
//! declaration, and the `finish` call that ends the run — is not written here at all: it is
//! [reflected](crate::sandbox::prompt_views) out of the sandbox SDK's own emitted declarations, and
//! this module only lays it out. The templates render [`ToolView`] and [`TypeView`], which are the
//! sandbox's types re-exported, precisely so a field cannot be added to what the prompt shows
//! without the catalogue being able to fill it.
//!
//! # The prose gg *does* author, and why it is versioned like code
//!
//! Everything around that list is this stage's product surface: the reply contract (your whole reply
//! is the program), the ending contract (only `finish` ends a session), and the four turn feedbacks
//! that answer a program that ran, one that did not compile, one the sandbox stopped, and a reply
//! that was never a program at all. Each sentence in those exists because a real model got the
//! contract wrong without it, so treat them as behaviour: change one only with the same care as a
//! code change, and keep the tests that pin them.

use std::sync::OnceLock;

use handlebars::{Handlebars, RenderError};
use serde::Serialize;

pub use crate::sandbox::{CodeTeachingView, ToolView, TypeView};

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

/// The turn feedback for a [code program](crate::sandbox) that **ran** — whether or not it threw.
const CODE_RESULT_TEMPLATE: &str = include_str!("../templates/code-result.hbs");

/// The turn feedback for a code program that did not compile, so nothing ran.
const CODE_TRANSPILE_ERROR_TEMPLATE: &str = include_str!("../templates/code-transpile-error.hbs");

/// The turn feedback for a code program the sandbox could not run to a result at all.
const CODE_SANDBOX_ERROR_TEMPLATE: &str = include_str!("../templates/code-sandbox-error.hbs");

/// The turn feedback for a reply that was not a program at all — prose, comments, an empty message.
///
/// It exists because under this protocol such a reply is a *failed turn* rather than a conclusion:
/// the run ends when a program calls `finish` and at no other time, so a model that says "done" has
/// to be told, in gg's own words, that saying it did nothing.
const CODE_NOT_A_PROGRAM_TEMPLATE: &str = include_str!("../templates/code-not-a-program.hbs");

/// The [healing](crate::healing) disclosure, included as a partial at the top of **all four** code
/// feedback templates.
///
/// One file rather than four copies because it is a *disclosure*, and a model shown two wordings of
/// one disclosure trusts neither. It has to appear on all four because what healing did happened to
/// the model's **message**, not to its program: a repaired reply may then run cleanly, fail to
/// compile, trap, or turn out not to have been a program at all, and in every one of those the model
/// is reading a diagnostic against source it did not quite send.
///
/// # The `ran` parameter
///
/// Each feedback template includes it as `{{> healing-note ran=…}}`, passing the one thing the
/// partial cannot see for itself: whether the repaired reply went on to **run**. The two templates
/// whose program ran — [the result](CODE_RESULT_TEMPLATE) and
/// [the sandbox limit](CODE_SANDBOX_ERROR_TEMPLATE) — pass `true`; the two whose reply never
/// executed — [the transpile failure](CODE_TRANSPILE_ERROR_TEMPLATE) and
/// [the not-a-program verdict](CODE_NOT_A_PROGRAM_TEMPLATE) — pass `false`.
///
/// It exists because the unconditional wording — *"gg repaired your reply before running it"* —
/// contradicted the body of the very feedback it opened, and did so on live traffic: a reply whose
/// prose was stripped and which was then refused as two pasted programs opened by telling the model
/// its reply had been run and closed by telling it nothing had. A model cannot act on a turn that
/// asserts both. The flag is threaded from the templates rather than added to the four contexts
/// because it is a property of *which feedback this is*, which each template knows statically and no
/// caller should have to restate — a context field would let a caller pair the running wording with
/// the not-a-program verdict again.
const HEALING_NOTE_TEMPLATE: &str = include_str!("../templates/healing-note.hbs");

/// The per-capability sections of the [system prompt](SYSTEM_TEMPLATE), one file each under
/// `templates/capabilities/`.
///
/// `system.hbs` grows one optional section per toggleable capability, and inlining every one kept
/// a dozen `{{#if}}` blocks and their prose in a single file. Each section is instead its own
/// partial, gate and all, that `system.hbs` includes as `{{> capabilities/<name>}}` — the same
/// partial mechanism [`HEALING_NOTE_TEMPLATE`] uses. A partial renders against the enclosing
/// [`SystemContext`], so the `{{#if}}` gate inside each file still governs whether the capability
/// contributes any text: the ablation property is unchanged, the layout is one file per capability.
const CAPABILITY_TEMPLATES: &[(&str, &str)] = &[
    (
        "capabilities/read-file",
        include_str!("../templates/capabilities/read-file.hbs"),
    ),
    (
        "capabilities/skills",
        include_str!("../templates/capabilities/skills.hbs"),
    ),
    (
        "capabilities/memories",
        include_str!("../templates/capabilities/memories.hbs"),
    ),
    (
        "capabilities/tasks",
        include_str!("../templates/capabilities/tasks.hbs"),
    ),
    (
        "capabilities/board",
        include_str!("../templates/capabilities/board.hbs"),
    ),
    (
        "capabilities/planning",
        include_str!("../templates/capabilities/planning.hbs"),
    ),
    (
        "capabilities/process",
        include_str!("../templates/capabilities/process.hbs"),
    ),
    (
        "capabilities/code-reviews",
        include_str!("../templates/capabilities/code-reviews.hbs"),
    ),
    (
        "capabilities/speculative",
        include_str!("../templates/capabilities/speculative.hbs"),
    ),
];

/// The template names registered with the [engine], in the order they are registered. Each name
/// is what [`render`] looks up — and, for [`HEALING_NOTE_TEMPLATE`], what the four feedback
/// templates include as a `{{> partial}}`, since handlebars resolves a partial against the same
/// registry. The tests iterate this list to assert every template parses.
const TEMPLATES: &[(&str, &str)] = &[
    ("system", SYSTEM_TEMPLATE),
    ("tasks", TASKS_TEMPLATE),
    ("board", BOARD_TEMPLATE),
    ("memories", MEMORIES_TEMPLATE),
    ("plan-mode", PLAN_MODE_TEMPLATE),
    ("plan-framing", PLAN_FRAMING_TEMPLATE),
    ("code-result", CODE_RESULT_TEMPLATE),
    ("code-transpile-error", CODE_TRANSPILE_ERROR_TEMPLATE),
    ("code-sandbox-error", CODE_SANDBOX_ERROR_TEMPLATE),
    ("code-not-a-program", CODE_NOT_A_PROGRAM_TEMPLATE),
    ("healing-note", HEALING_NOTE_TEMPLATE),
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
        for (name, source) in TEMPLATES.iter().chain(CAPABILITY_TEMPLATES) {
            engine
                .register_template_string(name, source)
                .unwrap_or_else(|err| panic!("gg template `{name}` does not parse: {err}"));
        }
        engine
    })
}

/// Render the registered template `name` with `context`, trimmed.
///
/// The fallible form, for the [code feedback](render_code_result) renders that must degrade rather
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
    ///
    /// The tool-calling section lists each [`name`](ToolView::name); the code section renders each
    /// [`signature`](ToolView::signature) and [`doc`](ToolView::doc) instead, and skips an entry
    /// that has none — which is exactly the three turn-level transitions, named separately in
    /// [`turn_level_tools`](Self::turn_level_tools) as things a program cannot call.
    pub tools: Vec<ToolView>,
    /// Whether the run is in [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/)
    /// mode, where the tools are described as functions a program calls rather than as tool calls.
    pub responses_as_code: bool,
    /// How a program ends the session — `finish`, with the signature and sentence the
    /// [SDK](crate::sandbox::prompt_views) itself declares for it.
    ///
    /// `Some` in code mode and `None` otherwise, which is what the ending section's `{{#if session}}`
    /// gate tests. Two properties fall out of the `Option`, and both are load-bearing:
    /// [`SystemContext::default()`] stays derivable (a bare context renders no ending section rather
    /// than an empty bullet), and a tool-calling run — whose ending rule is the untouched "stop
    /// calling tools" one — can never be shown a function it has no way to call.
    ///
    /// Unlike every other entry in this context it is **not** a projection of the run's enabled set:
    /// no capability offers it and no ablation withholds it, so a run that enables nothing at all is
    /// still told how to say it is done. A prompt that gated it would, for some toolset, teach a
    /// model a protocol with no exit.
    pub session: Option<ToolView>,
    /// Whether this agent is a **delegated** worker rather than the run's root agent — set from the
    /// agent's depth in the spawn tree.
    ///
    /// A subagent renders this same prompt, so the ending section has to say what `finish` actually
    /// ends *for the reader*: a root agent's summary is the run's last word, while a subagent's is
    /// the answer it hands back to whoever asked for the work. A delegated model told "this ends the
    /// run" has a strong reason not to call it — and a worker that never calls it never returns a
    /// verdict, which is the exact failure that leaves a Code Review unaccepted and a speculation
    /// judge without a winner.
    pub delegated: bool,
    /// Whether [healing](crate::healing)'s fence-stripping strategy is armed this run.
    ///
    /// The prompt tells the model not to wrap its program in a code fence either way; what changes
    /// is the *reason*. With stripping on, "a fence is a syntax error" is simply false — gg removes
    /// it and says so — and a model that tests the claim learns that gg's rules are negotiable,
    /// which contaminates the instruction-following signal this capability exists to measure. So the
    /// armed arm states the repair honestly and calls it a repair rather than the contract.
    pub fences_are_stripped: bool,
    /// Which of the code section's tool-specific teaching this run may write — its worked example,
    /// and the three bullets that illustrate themselves with a named function.
    ///
    /// Gated for the same reason every other section is: prose that names a function the run
    /// withheld is prose the model cannot act on. An ungated worked example is worse still, because
    /// it is the one piece of the prompt a model copies verbatim — a `listDir` in an example shown
    /// to a `shell`-only run is a `ReferenceError` on turn one.
    ///
    /// The sentence that *introduces* the example is shared by all four, because what it says —
    /// this is one program that looks, decides, acts, checks, and ends the run only on the branch
    /// where the work is done — is the shape every one of them has, and stating it once is what
    /// keeps the four bodies from having to argue for themselves. It leans on the projection's
    /// invariant that **exactly one** example flag is set
    /// (`exactly_one_worked_example_is_chosen_and_it_only_names_bound_tools`): a context that set
    /// none would render the framing with nothing under it.
    pub code: CodeTeachingView,
    /// The type declarations the code-mode signatures reference, deduplicated and in declaration
    /// order. Only the types the **enabled** tools actually use, so a disabled capability
    /// contributes no prompt text here either. Always includes `ToolError`, so the error contract
    /// reaches the model as a declaration rather than as a paragraph.
    pub types: Vec<TypeView>,
    /// The helper functions bound alongside an enabled tool (today just `readTextFile`). They are
    /// not gg tools in their own right, so they are listed after the tools rather than among them.
    pub helpers: Vec<ToolView>,
    /// The turn-level transitions this run's capabilities offer, which a program cannot use.
    /// Empty when neither planning nor the FSM is on.
    ///
    /// Naming them is not pedantry: a model that has been told it has `planning` and then cannot
    /// find `enterPlanMode` in its scope will spend turns looking for it. The section says plainly
    /// that these change the *turn*, not a value.
    pub turn_level_tools: Vec<String>,
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
// The code-turn feedback
// ---------------------------------------------------------------------------

/// The variables `code-result.hbs` may reference: everything one
/// [program](crate::sandbox::run_program) produced, as the model is shown it.
///
/// It is one context for both endings — ran out, or threw — because a program that threw still
/// *did* everything up to the throw, and the model needs the same roster, the same logs and the same
/// nudges either way. The template's `{{#if error}}` is the only thing that differs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeResultContext {
    /// What [healing](crate::healing) repaired in the reply before it was compiled, one
    /// already-rendered clause per repair — [`Healed::notes`](crate::healing::Healed::notes).
    ///
    /// Empty for a reply that needed no repair, which is what the note is gated on: a well-formed
    /// turn must not spend its opening line on a rule the model did not break.
    pub healing: Vec<String>,
    /// The throw the program did not catch, or `None` if it ran to its end.
    pub error: Option<CodeErrorView>,
    /// Whether the program ended with a `return` that carried a value — which gg discarded.
    ///
    /// The value is not here because it is nowhere: `console.log` is a program's only channel, and
    /// this flag is how a model that used the wrong one is told so in the turn it did it. Saying it
    /// once, in the moment, is what keeps the rule one sentence long in the system prompt instead of
    /// a section about what may be returned.
    pub returned_value: bool,
    /// Whether the program declared the run finished and then **lost** that ending by throwing.
    ///
    /// Without it the model reads an ordinary failed turn and has no reason to think its `finish`
    /// did not take — so it fixes the throw, does not call `finish` again, and the run carries on
    /// past the point the model believes it ended.
    pub finish_revoked: bool,
    /// The tool calls the roster kept, in call order.
    pub calls: Vec<CodeCallView>,
    /// How many calls the program actually made — which exceeds `calls.len()` when the sandbox's
    /// roster cap stopped describing them, so the sentence counts what happened rather than what
    /// is listed.
    pub call_count: usize,
    /// How many of those calls the roster cap did not describe. Named for the same reason
    /// [`logs_suppressed`](Self::logs_suppressed) and
    /// [`refusals_suppressed`](Self::refusals_suppressed) are: a model told its program made 738
    /// calls and then shown 500 would read the gap as calls that vanished, rather than as a listing
    /// that stopped.
    pub calls_suppressed: u64,
    /// Calls the sandbox refused before they reached gg's toolset (a withheld tool, a turn-level
    /// transition, a spent wall-clock budget), pre-rendered one per line.
    pub refusals: Vec<String>,
    /// How many refusals the capture caps discarded. Reported for the same reason
    /// [`logs_suppressed`](Self::logs_suppressed) is: the shape that hits the cap is a program that
    /// swallows the throws and keeps calling after the run's budget is spent, and a model shown
    /// only the first hundred would read the list as the whole story.
    pub refusals_suppressed: u64,
    /// The `console.*` lines the capture kept, in order.
    pub logs: Vec<String>,
    /// How many log lines the capture caps discarded, so the feedback says so rather than lying by
    /// omission.
    pub logs_suppressed: u64,
    /// Whether the program logged nothing, returned nothing and threw nothing — the one outcome
    /// that tells the model absolutely nothing, and therefore the one worth naming.
    pub silent: bool,
    /// How many pictures the per-program budget dropped.
    pub images_dropped: u32,
    /// How many pictures one program may show. Only rendered when
    /// [`images_dropped`](Self::images_dropped) is non-zero, so a model told about the budget is
    /// always told it in the moment it hit it.
    pub image_budget: u32,
    /// The sandbox's note that the program deferred work into a microtask that ran after the program
    /// had already ended — the failure mode a `.then()` produces, which is otherwise invisible.
    pub deferred: Option<String>,
    /// gg's note that the reply carried top-level statements after a top-level `return`, which
    /// therefore did not run. `None` — the ordinary case — when every statement the model wrote was
    /// reachable.
    ///
    /// It is here for the same reason [`deferred`](Self::deferred) is: a program can do something
    /// that has no effect and looks from the outside exactly like a program that ran cleanly, and a
    /// model cannot fix what it is not told. This one is the sharper of the two, because the shape
    /// that produces it is a model pasting a second draft after the first — where the half that
    /// never ran is the half that wrote the deliverable and ended the run.
    pub unreachable: Option<String>,
    /// Whether the agent being addressed is a **delegated** worker rather than the run's root — the
    /// same fact [`SystemContext::delegated`] carries, for the same reason.
    ///
    /// This template's closing line is the one channel that repeats the termination rule *every
    /// turn*, and it sits far later in the context than the system prompt that stated it first. If
    /// the two disagree, the later one wins: a reviewer subagent told each turn that `finish` ends
    /// **the run** has the strongest reason available not to call it, and a reviewer that never
    /// calls it never returns a verdict.
    pub delegated: bool,
}

/// The throw a program did not catch, as the feedback renders it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeErrorView {
    /// What was thrown, already naming the tool (or the identifiers this run offers).
    pub message: String,
    /// Where in the **program's own** coordinates it happened (`line 5, column 12`), or `None`
    /// when no usable frame was found.
    pub location: Option<String>,
}

/// One composed tool call, as the feedback's roster renders it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeCallView {
    /// The gg tool name the program called.
    pub name: String,
    /// Whether it succeeded.
    pub ok: bool,
    /// Why it failed, when it did. Carried even for a failure the program *caught*, because a
    /// caught failure is otherwise invisible to the model — the program carried on as if nothing had
    /// happened, and the roster would say only that one call went wrong.
    pub error: Option<String>,
}

/// The variables `code-transpile-error.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeTranspileErrorContext {
    /// What [healing](crate::healing) repaired before the compile, one clause per repair.
    ///
    /// It matters most on this path of the four. The diagnostic is located in the **healed**
    /// source's coordinates — the program gg actually compiled — so a model told "line 4" without
    /// also being told that a fence came off the top of its reply cannot reconcile the two, and
    /// spends its next turn fixing a line that was never wrong.
    pub healing: Vec<String>,
    /// The compiler's diagnostic, already located in the program's own coordinates.
    pub error: String,
    /// Whether the agent being addressed is a **delegated** worker rather than the run's root, for
    /// the same reason [`CodeResultContext::delegated`] carries it: this template also names what
    /// `finish` ends, and naming the wrong thing to a worker is what stops it ever finishing.
    pub delegated: bool,
}

/// The variables `code-sandbox-error.hbs` may reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSandboxErrorContext {
    /// What [healing](crate::healing) repaired before the program ran, one clause per repair.
    pub healing: Vec<String>,
    /// What the sandbox could not do, as it states it.
    pub error: String,
    /// Whether the program declared the run finished before the sandbox stopped it, and therefore
    /// lost that ending. Carried here as well as on [`CodeResultContext`] because the two are the
    /// two ways a program can fail after a `finish`, and a model told nothing on this one would
    /// believe the run ended on a turn it did not.
    pub finish_revoked: bool,
    /// How many tool calls the program had already landed — they stand, and saying so is what
    /// stops a model redoing work it already did.
    pub calls: usize,
    /// Whether the failure was the **fuel** ceiling, in which case the model is additionally told
    /// which direction of the membrane is expensive. A memory cap or a trap is not a budgeting
    /// problem, so it is not given budgeting advice.
    pub output_heavy: bool,
}

/// The variables `code-not-a-program.hbs` may reference: the fourth code feedback, for a turn whose
/// reply never became something to run.
///
/// The narrowest of the four contexts, because there is nothing to report: no roster, no logs, no
/// diagnostic. The reply was prose, or comments, or empty, or several candidate blocks —
/// and the only two things the model needs are which of those it was, and what a turn is supposed to
/// look like instead.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeNotAProgramContext {
    /// What [healing](crate::healing) repaired before it gave up on the reply, one clause per
    /// repair.
    ///
    /// Non-empty more often than it looks: a reply whose fence was stripped and whose remainder
    /// turned out to be comments only was both repaired *and* refused, and a model shown only the
    /// refusal would conclude that gg never saw the fence.
    pub healing: Vec<String>,
    /// Why the reply was not a program, as
    /// [`NotAProgramReason::message`](crate::healing::NotAProgramReason::message) words it.
    ///
    /// Pre-rendered in Rust rather than branched on here: the reason is an enum with one sentence
    /// per variant, and a template that reproduced that mapping would be a second place for the six
    /// sentences to live.
    pub reason: String,
    /// Whether the agent being addressed is a **delegated** worker rather than the run's root.
    ///
    /// It matters most on this template of the four: this is the turn a model takes when it has
    /// answered in prose because it believes the work is done, so it is precisely the moment a
    /// delegated worker is told what `finish` would end. Telling it "the run" here is telling it
    /// that returning its verdict would end somebody else's work.
    pub delegated: bool,
}

/// The model-facing feedback for a program that **ran** — whether or not it threw.
///
/// Falls back to a plain sentence rather than panicking: this is the one render whose context is
/// built from a model's own output, and a turn with degraded feedback is recoverable where a
/// panicked run is not.
pub fn render_code_result(context: &CodeResultContext) -> String {
    try_render("code-result", context).unwrap_or_else(|_| {
        format!(
            "Your program ran. Continue by emitting your next program. When the work is done and \
             you have checked it, end {} with `finish(\"...\")` from inside a program — nothing \
             else ends it.",
            ending(context.delegated)
        )
    })
}

/// What `finish` ends, for the agent being addressed.
///
/// Every fallback that names the termination rule goes through this, so a degraded render cannot
/// tell a delegated worker something the template and the system prompt would not have.
fn ending(delegated: bool) -> &'static str {
    if delegated { "your session" } else { "the run" }
}

/// The model-facing feedback for a program that did not compile. Nothing ran.
pub fn render_code_transpile_error(context: &CodeTranspileErrorContext) -> String {
    try_render("code-transpile-error", context).unwrap_or_else(|_| {
        format!(
            "Your program did not compile: {}\n\nNothing ran, so nothing changed. Fix the syntax \
             and reply with a corrected program.",
            context.error
        )
    })
}

/// The model-facing feedback for a program the **sandbox** could not run to a result.
pub fn render_code_sandbox_error(context: &CodeSandboxErrorContext) -> String {
    try_render("code-sandbox-error", context).unwrap_or_else(|_| {
        format!(
            "Your program could not be run to completion: {}. Split the task across several \
             smaller programs, one per turn.",
            context.error
        )
    })
}

/// The model-facing feedback for a reply that was **not a program**, so nothing ran at all.
///
/// Falls back to a plain sentence for the same reason the other three do — its input is derived from
/// a model's own output — and the fallback keeps the two facts the turn exists to deliver: why the
/// reply was refused, and that only `finish` ends the run.
pub fn render_code_not_a_program(context: &CodeNotAProgramContext) -> String {
    try_render("code-not-a-program", context).unwrap_or_else(|_| {
        format!(
            "{} Every turn of this run is a program: reply with code alone. If you believe the \
             task is complete, saying so does not end {} — call `finish(\"...\")` from inside a \
             program instead.",
            context.reason,
            ending(context.delegated)
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
