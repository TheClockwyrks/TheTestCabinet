//! The gg **skills** capability: pre-authored markdown-with-front-matter guides the
//! model can read on demand, whose bodies are **retained across compaction**.
//!
//! A [skill](https://docs.testcabinet.ai/gg/skills/) is a markdown file with a small YAML
//! front-matter block naming it and describing what it is for. At the start of a session
//! every skill's **description** is listed in the system prompt, so the model knows the
//! skill exists and when to reach for it. Reading a skill (the
//! [`read_skill`](crate::tools) tool) differs from reading an ordinary file in two ways:
//!
//! - it **strips the front matter** and returns only the body, and
//! - the body is added to the context window as a
//!   [`Skill`](test_cabinet_core::gg::GgContextSource)-sourced, **pinned** item, so the
//!   [context accounting](crate::context) attributes it to skills and Phase 2 compaction
//!   carries it across the boundary verbatim (unlike a file view, which may be evicted or
//!   summarized). Reading the same skill twice does not duplicate that pinned item.
//!
//! # Shapes
//!
//! - [`Skill`] — one parsed skill (name, description, body).
//! - [`SkillLibrary`] — the immutable, [`load`](SkillLibrary::load)ed-once catalog for a
//!   run, shared (`Arc`) between the loop and the `read_skill` tool.
//! - [`SkillsRuntime`] — the loop's live view: the library plus which skills have been
//!   read, from which the system-prompt listing and the
//!   [`SkillsState`](test_cabinet_core::gg::GgTelemetryKind::SkillsState) telemetry are
//!   derived.
//!
//! The capability is **switchable**: when it is off the loop never builds a library
//! ([`SkillsRuntime::disabled`]), so there is no `read_skill` tool, no prompt listing, and
//! no telemetry — the feature vanishes.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

use test_cabinet_core::gg::{
    CAPABILITY_SKILLS, GgAgentConfig, GgContextSource, GgModuleOrigin, GgSkillState,
    GgTelemetryKind,
};

use crate::model::Message;
use crate::modules::{
    AdoptError, Module, ModuleHandle, ModuleIds, ModuleKind, ModuleResolveCtx, Ownership, Refresh,
    detached_ids,
};
use crate::prompts::SkillView;
use crate::sandbox::ProgramLanguage;

/// The default directory skills are loaded from, relative to the run workspace, when the
/// capability does not configure one via its `dir` param. `core`'s workspace seeding may
/// place authored skills here before the run starts.
pub const DEFAULT_SKILLS_DIR: &str = ".gg/skills";

/// The file extension a skill file must have to be loaded from a skills directory.
const SKILL_EXTENSION: &str = "md";

/// Placeholder description used for a skill file whose front matter omits `description`
/// (or has no front matter at all), so the catalog still lists it with *something*.
const MISSING_DESCRIPTION: &str = "(no description provided)";

/// One parsed skill: the front-matter [`name`](Self::name)/[`description`](Self::description)
/// shown to the model up front, the [`body`](Self::body) (front matter stripped) that
/// `read_skill` returns and pins into context, and — under
/// [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/tools/) — the
/// [code](Self::code) and [on-use script](Self::on_use) it carries.
///
/// All three of body, code and on-use are optional in the sense that matters: a skill may be pure
/// prose (what every skill was), pure code, an on-use script and nothing else, or any combination.
/// The one thing it must have is a name and a description, because those are what the
/// [index](SkillsRuntime::context_block) is made of.
///
/// # Why the code halves are keyed
///
/// A skill's prose is one text every agent reads. Its **code** cannot be: a program's language is
/// resolved per agent, so one run may drive two agents that could not evaluate each other's modules.
/// So a skill directory carries a module per language it was authored for —
/// `skill.ts`, `skill.py` — and this holds all of them, keyed by the extension each was spelled
/// with. Which one an agent gets is the agent's language's answer, asked at the moment it reads the
/// skill.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    /// The skill's stable name — the handle `read_skill` takes and the catalog lists.
    name: String,
    /// The one-line description shown to the model up front.
    description: String,
    /// The skill's body (front matter removed), loaded into context when the skill is read. Empty
    /// for a skill that is only code, or only an on-use script.
    body: String,
    /// The importable modules (`skill.<ext>`), by the extension each was spelled with, bound at
    /// `lib.<key>` once the skill is read. Ignored under native tool calling, which has no programs
    /// to bind them into.
    code: CodeFiles,
    /// The on-use scripts (`on-use.<ext>`), by extension, run once when the skill is first read.
    /// Their source is never shown to the model. Ignored under native tool calling for the same
    /// reason.
    on_use: CodeFiles,
}

/// The source files a skill carries for one of its two code halves, keyed by the **lower-cased file
/// extension** they were spelled with — `"ts"`, `"py"`.
///
/// A map rather than one string because a skills directory is authored once and read by every agent
/// in a run, and [language is resolved per agent](crate::sandbox::ProgramLanguage). Ordered so a
/// directory carrying several spellings loads identically every time.
pub type CodeFiles = std::collections::BTreeMap<String, String>;

impl Skill {
    /// The skill's name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The skill's description.
    pub fn description(&self) -> &str {
        &self.description
    }

    /// The skill's body (front matter already stripped). Empty for a code-only skill, whose read
    /// answers with the note saying where its code went and nothing else.
    pub fn body(&self) -> &str {
        &self.body
    }

    /// The skill's importable module **as `language` spells one**, if it carries one.
    ///
    /// The language is asked rather than assumed because a skill directory may carry several
    /// modules and only one of them is a module *this* agent could evaluate. A language that accepts
    /// more than one spelling gets the first it names that the directory actually has.
    pub fn code(&self, language: &dyn ProgramLanguage) -> Option<&str> {
        pick(&self.code, language)
    }

    /// The skill's on-use script as `language` spells one, if it carries one. Resolved exactly as
    /// [`code`](Self::code) is.
    pub fn on_use(&self, language: &dyn ProgramLanguage) -> Option<&str> {
        pick(&self.on_use, language)
    }

    /// Whether this skill carries either code half **in any language at all**.
    ///
    /// Not the same question as "does this agent get code from it": a skill authored only in Python
    /// carries code and offers a TypeScript agent none. Telling those two apart is what lets a run
    /// say so rather than silently reading the skill as prose.
    pub fn has_code(&self) -> bool {
        !self.code.is_empty() || !self.on_use.is_empty()
    }

    /// Every extension this skill spells either of its code halves with, in order — what an operator
    /// is shown when the agent that read it could use none of them.
    pub fn code_spellings(&self) -> Vec<&str> {
        self.code
            .keys()
            .chain(self.on_use.keys())
            .map(String::as_str)
            .collect::<BTreeSet<&str>>()
            .into_iter()
            .collect()
    }

    /// This skill with `code` and `on_use` attached — the builder the
    /// [directory loader](SkillLibrary::load) and the [built-ins](builtin) both go through.
    ///
    /// A blank file is not a file: an empty or whitespace-only source is dropped rather than bound,
    /// so an agent is never handed a module that exports nothing.
    fn with_code(mut self, code: CodeFiles, on_use: CodeFiles) -> Self {
        let kept = |files: CodeFiles| -> CodeFiles {
            files
                .into_iter()
                .filter(|(_, source)| !source.trim().is_empty())
                .collect()
        };
        self.code = kept(code);
        self.on_use = kept(on_use);
        self
    }
}

/// The immutable catalog of skills available to a run, loaded once from the skills
/// directory and shared between the loop and the `read_skill` tool.
///
/// Skills are keyed by their front-matter [`name`](Skill::name); the catalog is ordered
/// by name for a stable prompt listing and telemetry order. An [`empty`](Self::empty)
/// library (no skills directory, or the capability off) offers nothing.
#[derive(Debug, Clone, Default)]
pub struct SkillLibrary {
    skills: Vec<Skill>,
}

impl SkillLibrary {
    /// An empty library — no skills. The state a disabled capability or a workspace with
    /// no skills directory resolves to.
    pub fn empty() -> Self {
        Self { skills: Vec::new() }
    }

    /// Load every skill under `dir`, in either of the two shapes a skill takes.
    ///
    /// * `<name>.md` — a **prose** skill. Front matter, then the body. Exactly what a skill has
    ///   always been.
    /// * `<name>/` — a **skill directory**, which is how a skill carries code:
    ///   * `skill.md` — required. The front matter (and, optionally, a body).
    ///   * `skill.<ext>` — optional. The importable module, bound at `lib.<key>` once the skill is
    ///     read. One per program language the skill was authored for (`skill.ts`, `skill.py`); an
    ///     agent reads the one [its own language names](ProgramLanguage::module_file_extensions).
    ///   * `on-use.<ext>` — optional. The script gg runs once, when the skill is first read.
    ///     Resolved per language exactly as the module is.
    ///
    /// A directory without a `skill.md` is not a skill and is ignored: the name and the description
    /// are what the index is made of, and inventing them from a file name would put a line in front
    /// of the model that says nothing.
    ///
    /// A missing or unreadable directory yields an [`empty`](Self::empty) library (skills are
    /// optional); an individual file that cannot be read is skipped. The result is ordered by skill
    /// name, and a duplicate name keeps the first entry seen in path order.
    pub fn load(dir: &Path) -> Self {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Self::empty();
        };

        // Collect the entries first, then load in a stable (path-sorted) order so a duplicate
        // front-matter name resolves deterministically to the first one.
        let mut paths: Vec<std::path::PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        paths.sort();

        let mut skills: Vec<Skill> = Vec::new();
        for path in &paths {
            let Some(skill) = load_one(path) else {
                continue;
            };
            // Keep the first entry to claim a given name; ignore later duplicates.
            if !skills.iter().any(|existing| existing.name == skill.name) {
                skills.push(skill);
            }
        }

        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Self { skills }
    }

    /// This library with `builtins` added — gg's own skills, one per family of functions the agent
    /// has, offered under whatever names the authored library did **not** already claim.
    ///
    /// Authored wins, deliberately: a workspace that writes its own `gg-filesystem` means to replace
    /// gg's, and a run in which both existed would put two lines with one name in the index.
    pub fn with_builtins(mut self, builtins: Vec<Skill>) -> Self {
        for skill in builtins {
            if !self
                .skills
                .iter()
                .any(|existing| existing.name == skill.name)
            {
                self.skills.push(skill);
            }
        }
        self.skills.sort_by(|a, b| a.name.cmp(&b.name));
        self
    }

    /// Whether the library offers no skills.
    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// The number of skills in the library.
    pub fn len(&self) -> usize {
        self.skills.len()
    }

    /// The skill with the given name, if any.
    pub fn get(&self, name: &str) -> Option<&Skill> {
        self.skills.iter().find(|skill| skill.name == name)
    }

    /// The skills, in catalog (name) order.
    pub fn skills(&self) -> &[Skill] {
        &self.skills
    }
}

/// The loop's live view of the skills capability: the [`SkillLibrary`] plus the set of
/// skills read so far.
///
/// Constructed [enabled](Self::new) with a loaded library or [disabled](Self::disabled)
/// (a configuration with the capability off). It produces the catalog the
/// [system prompt](crate::prompts::SystemContext::skills) lists
/// ([`prompt_entries`](Self::prompt_entries)), the
/// [`SkillsState`](GgTelemetryKind::SkillsState) telemetry
/// ([`state_event`](Self::state_event)), and records reads
/// ([`record_read`](Self::record_read)) — the loop uses the result to pin a freshly read
/// skill's body exactly once.
///
/// It is a [module](crate::modules::Module) whose two halves are copied differently: the catalog is
/// immutable and always shared, while the **read set** is a promise about the window — "these skill
/// bodies are already pinned, do not pin them twice". A [fork](Self::forked) copies the read set
/// because it travels with a copy of the window it describes; a [share](Self::shared) aliases it
/// because two holders of one window would otherwise each re-pin what the other had already read.
/// It is deliberately not `Clone`; see [the module model](crate::modules).
#[derive(Debug)]
pub struct SkillsRuntime {
    /// Whether the skills capability is enabled for this run. When `false` the runtime is
    /// inert regardless of the (empty) library.
    enabled: bool,
    /// The shared, immutable catalog.
    library: Arc<SkillLibrary>,
    /// The names of skills the model has read this session — behind a lock so linked holders of one
    /// window agree on what is already pinned in it.
    read: Arc<Mutex<BTreeSet<String>>>,
    /// The [identity](crate::modules::ModuleIdMint) of that read set. The *library* is immutable
    /// and shared by everything, so it identifies nothing; what one holder can be said to hold, and
    /// another to share, is the promise about a window that the read set is.
    id: Arc<str>,
    /// The mint a copy of this read set takes its id from — see [`ModuleIds`].
    ids: ModuleIds,
    /// How this holder came by the read set.
    origin: GgModuleOrigin,
}

/// The outcome of recording a `read_skill` call against the [`SkillsRuntime`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadRecord {
    /// The skill was read for the first time this session — the loop pins its body.
    Fresh,
    /// The skill was already read — its body is already pinned, so the loop must not
    /// duplicate it.
    Repeat,
    /// No skill by that name exists in the library (a defensive case: a successful
    /// `read_skill` call names a real skill, so the loop treats this like ordinary tool
    /// output).
    Unknown,
}

impl SkillsRuntime {
    /// An enabled runtime over `library`, with nothing read yet, identified out of a
    /// [detached](detached_ids) sequence — the by-hand constructor, which in practice means the
    /// tests. A run loads its library through [`Self::new_in`].
    pub fn new(library: Arc<SkillLibrary>) -> Self {
        Self::new_in(library, &detached_ids())
    }

    /// The same, identified out of the run's [mint](ModuleIds). This is the orchestrator's own
    /// runtime, over the library it loaded once; each agent takes a [fork](Self::forked) of it.
    pub fn new_in(library: Arc<SkillLibrary>, ids: &ModuleIds) -> Self {
        Self {
            enabled: true,
            library,
            read: Arc::new(Mutex::new(BTreeSet::new())),
            id: ids.next(ModuleKind::Skills),
            ids: Arc::clone(ids),
            origin: GgModuleOrigin::Created,
        }
    }

    /// A disabled runtime (the skills capability is off): no library, no tool, no
    /// telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::new(Arc::new(SkillLibrary::empty()))
        }
    }

    /// An **independent** runtime over the same catalog with a copy of the read set — what an
    /// agent built over the orchestrator's shared runtime takes, and what a fork of a window takes
    /// along with the window the read set describes.
    pub fn forked(&self) -> Self {
        Self {
            enabled: self.enabled,
            library: Arc::clone(&self.library),
            read: Arc::new(Mutex::new(
                self.read.lock().expect("skills read set lock").clone(),
            )),
            // A new read set, so a new id: it is a promise about a *different* window.
            id: self.ids.next(ModuleKind::Skills),
            ids: Arc::clone(&self.ids),
            origin: self.origin,
        }
    }

    /// A **linked** runtime over the same catalog *and* the same read set.
    pub fn shared(&self) -> Self {
        Self {
            enabled: self.enabled,
            library: Arc::clone(&self.library),
            read: Arc::clone(&self.read),
            id: Arc::clone(&self.id),
            ids: Arc::clone(&self.ids),
            origin: self.origin,
        }
    }

    /// Whether the capability actually offers anything this run — enabled **and** the
    /// library has at least one skill. When `false` the loop offers no `read_skill` tool
    /// and adds no prompt listing.
    pub fn offers_skills(&self) -> bool {
        self.enabled && !self.library.is_empty()
    }

    /// The shared library, for handing an `Arc` to the `read_skill` tool.
    pub fn library(&self) -> Arc<SkillLibrary> {
        Arc::clone(&self.library)
    }

    /// Join gg's own [built-in](builtin) skills to this holder's catalogue.
    ///
    /// It re-points the `Arc` rather than mutating in place, because the authored library really is
    /// shared — one copy, loaded once for the run — while the built-ins are **this agent's**: they
    /// describe the functions its own profile gave it, and another agent with a different toolset
    /// gets a different set. Two agents therefore end up holding two catalogues that agree about
    /// every authored skill and differ exactly where their capabilities do.
    pub fn offer_builtins(&mut self, builtins: Vec<Skill>) {
        if builtins.is_empty() {
            return;
        }
        self.library = Arc::new(
            SkillLibrary {
                skills: self.library.skills().to_vec(),
            }
            .with_builtins(builtins),
        );
    }

    /// The number of skills the model has read this session — the read skill bodies pinned
    /// in the window, reported as the skills figure of a
    /// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary's retention proof.
    pub fn read_count(&self) -> usize {
        self.read.lock().expect("skills read set lock").len()
    }

    /// Each offered skill's name and description, for the
    /// [system prompt](crate::prompts::SystemContext::skills) to list — empty when no skills are
    /// offered, which is what makes the prompt's skills section vanish. This is the "shown up
    /// front" affordance: the model sees what skills exist and reads one by name when it is
    /// relevant.
    pub fn prompt_entries(&self) -> Vec<SkillView> {
        if !self.offers_skills() {
            return Vec::new();
        }
        self.library
            .skills()
            .iter()
            .map(|skill| SkillView {
                name: skill.name().to_string(),
                description: skill.description().to_string(),
            })
            .collect()
    }

    /// The [`SkillsState`](GgTelemetryKind::SkillsState) telemetry for the current read
    /// set, or `None` when the capability offers no skills (nothing to report). Emitted at
    /// session start and after each fresh read.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.offers_skills() {
            return None;
        }
        let skills = self
            .library
            .skills()
            .iter()
            .map(|skill| GgSkillState {
                name: skill.name().to_string(),
                description: skill.description().to_string(),
                read: self
                    .read
                    .lock()
                    .expect("skills read set lock")
                    .contains(skill.name()),
            })
            .collect();
        Some(GgTelemetryKind::SkillsState {
            module_id: self.id.to_string(),
            skills,
        })
    }

    /// Record that the model read the skill named `name`, reporting whether this was the
    /// first read ([`Fresh`](ReadRecord::Fresh)), a repeat
    /// ([`Repeat`](ReadRecord::Repeat)), or a name the library does not know
    /// ([`Unknown`](ReadRecord::Unknown)).
    pub fn record_read(&mut self, name: &str) -> ReadRecord {
        if self.library.get(name).is_none() {
            return ReadRecord::Unknown;
        }
        if self
            .read
            .lock()
            .expect("skills read set lock")
            .insert(name.to_string())
        {
            ReadRecord::Fresh
        } else {
            ReadRecord::Repeat
        }
    }
}

impl Module for SkillsRuntime {
    fn kind(&self) -> ModuleKind {
        ModuleKind::Skills
    }

    fn instance_id(&self) -> &str {
        &self.id
    }

    fn origin(&self) -> GgModuleOrigin {
        self.origin
    }

    fn set_origin(&mut self, origin: GgModuleOrigin) {
        self.origin = origin;
    }

    fn enabled(&self) -> bool {
        self.enabled
    }

    /// Always [owned](Ownership::Owned). The catalogue *is* the state a skills module holds, and a
    /// holder that was not told what skills exist could only ever reach one by being handed its name
    /// — which is not an arm of anything, it is the capability switched off with extra steps.
    fn ownership(&self) -> Ownership {
        Ownership::Owned
    }

    /// None: skills do not occupy a single block. A read skill's body is pinned as its own
    /// [`Skill`](GgContextSource::Skill) item at the moment it is read and is never rebuilt, so
    /// there is no block for a refresh to replace.
    fn context_source(&self) -> Option<GgContextSource> {
        None
    }

    fn refresh(&self) -> Refresh {
        Refresh::Never
    }

    fn context_block(&self) -> Option<Message> {
        None
    }

    fn state_events(&self) -> Vec<GgTelemetryKind> {
        self.state_event().into_iter().collect()
    }

    /// Nothing: the read set's telemetry is **snapshot-only** — the whole catalog with its read
    /// flags is re-emitted by the loop after each fresh read.
    fn drain_events(&mut self) -> Vec<GgTelemetryKind> {
        Vec::new()
    }

    fn retained(&self) -> u64 {
        self.read_count() as u64
    }

    fn fork(&self) -> ModuleHandle {
        ModuleHandle::Skills(self.forked())
    }

    fn share(&self) -> ModuleHandle {
        ModuleHandle::Skills(self.shared())
    }

    /// Re-point the id mint and record how the read set arrived. The catalog itself is run-global
    /// and immutable, so there is nothing to re-resolve.
    ///
    /// A read set is a promise about a **window**: it says which skill bodies are already pinned in
    /// it, so the loop answers a repeat read with a note instead of a second copy. That promise is
    /// only true where the window is, which is why this module is carried by exactly the same
    /// transfers that carry [history](crate::modules::ModuleKind::History) — a read set adopted
    /// without its window would suppress a pin the successor's window does not have.
    fn adopt(
        &mut self,
        profile: &GgAgentConfig,
        ctx: &ModuleResolveCtx<'_>,
    ) -> Result<(), AdoptError> {
        if !profile.is_enabled(CAPABILITY_SKILLS) {
            return Err(AdoptError::Disabled);
        }
        self.enabled = true;
        self.ids = Arc::clone(ctx.ids);
        self.origin = GgModuleOrigin::Transferred;
        Ok(())
    }
}

/// The file a skill directory's front matter and body live in.
const SKILL_MANIFEST: &str = "skill.md";

/// The stem of the file a skill directory's importable module lives in — `skill.<ext>`, where the
/// extension is [the reading agent's language's](ProgramLanguage::module_file_extensions).
const SKILL_MODULE_STEM: &str = "skill";

/// The stem of the file a skill directory's on-use script lives in — `on-use.<ext>`.
const SKILL_ON_USE_STEM: &str = "on-use";

/// The source `files` holds for `language`: the first of the extensions that language names that the
/// map actually has.
///
/// Preference order is the language's, so a language that reads a second spelling still gets its own
/// when both are present — which is what stops a directory carrying both from silently handing two
/// arms of a study the same file.
fn pick<'a>(files: &'a CodeFiles, language: &dyn ProgramLanguage) -> Option<&'a str> {
    language
        .module_file_extensions()
        .iter()
        .find_map(|extension| files.get(*extension))
        .map(String::as_str)
}

/// Every extension a skill's code may be spelled with: the union of what the registered languages
/// name.
///
/// Derived from the registry rather than listed, so a language added to the seam is read out of a
/// skills directory without anything here being edited. The fixture (`sandbox/language/fixture.rs`)
/// languages join it under test for the same reason they join every other iteration of the seam: a
/// mechanism exercised against one spelling is a mechanism nobody has watched choose.
fn code_extensions() -> BTreeSet<&'static str> {
    #[cfg_attr(not(test), allow(unused_mut))]
    let mut extensions: BTreeSet<&'static str> = crate::sandbox::all_languages()
        .flat_map(|language| language.module_file_extensions().iter().copied())
        .collect();
    #[cfg(test)]
    extensions.extend(
        crate::sandbox::fixture_languages()
            .flat_map(|language| language.module_file_extensions().iter().copied()),
    );
    extensions
}

/// The `<stem>.<ext>` files present under `dir`, one entry per extension that has one.
fn read_code_files(dir: &Path, stem: &str) -> CodeFiles {
    code_extensions()
        .into_iter()
        .filter_map(|extension| {
            let source = std::fs::read_to_string(dir.join(format!("{stem}.{extension}"))).ok()?;
            Some((extension.to_string(), source))
        })
        .collect()
}

/// One entry of a skills directory, as a [`Skill`] — or `None` for an entry that is not one.
fn load_one(path: &Path) -> Option<Skill> {
    if path.is_dir() {
        let raw = std::fs::read_to_string(path.join(SKILL_MANIFEST)).ok()?;
        let fallback = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Some(parse_skill(&raw, &fallback).with_code(
            read_code_files(path, SKILL_MODULE_STEM),
            read_code_files(path, SKILL_ON_USE_STEM),
        ));
    }
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(SKILL_EXTENSION))
    {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    let fallback = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    Some(parse_skill(&raw, &fallback))
}

/// The `name` and `description` fields parsed from a skill's YAML front matter. Any other
/// keys (for example `title`) are ignored — only these two drive the skills capability.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct FrontMatter {
    name: Option<String>,
    description: Option<String>,
}

/// Parse a skill file into a [`Skill`], stripping its front matter from the body.
///
/// `fallback_name` (typically the file stem) names the skill when the front matter omits
/// `name`; a missing `description` falls back to a placeholder. Exposed to the loop via
/// [`SkillLibrary::load`]; the front-matter split itself is [`split_front_matter`].
pub(crate) fn parse_skill(raw: &str, fallback_name: &str) -> Skill {
    let (front, body) = split_front_matter(raw);
    let name = front
        .name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| fallback_name.trim().to_string());
    let description = front
        .description
        .map(|description| description.trim().to_string())
        .filter(|description| !description.is_empty())
        .unwrap_or_else(|| MISSING_DESCRIPTION.to_string());
    Skill {
        name,
        description,
        body: body.trim().to_string(),
        code: CodeFiles::new(),
        on_use: CodeFiles::new(),
    }
}

/// Split a skill file into its parsed [`FrontMatter`] and its body.
///
/// Front matter is a leading block delimited by a line containing exactly `---` on both
/// sides (a leading UTF-8 BOM is tolerated), the convention markdown authoring tools use.
/// A file that does not open with a `---` fence, or whose fence is never closed, has no
/// front matter: the whole file is the body and the fields are empty. Front-matter fields
/// are parsed line by line as `key: value`; only `name` and `description` are retained.
///
/// This is a **minimal** parser sufficient for the two scalar fields the skills capability
/// needs — not a general YAML implementation — so no YAML dependency is pulled in.
fn split_front_matter(raw: &str) -> (FrontMatter, String) {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    // `lines()` drops line terminators; the body is rejoined with `\n`, which is fine for
    // markdown skill bodies (exact original terminators are not load-bearing).
    let lines: Vec<&str> = raw.lines().collect();
    let is_fence = |line: &str| line.trim() == "---";

    if lines.first().is_some_and(|line| is_fence(line)) {
        // The closing fence is the first `---` line after the opening one.
        if let Some(offset) = lines.iter().skip(1).position(|line| is_fence(line)) {
            let close = offset + 1;
            let front = parse_front_matter_fields(&lines[1..close]);
            let body = lines[close + 1..].join("\n");
            return (front, body);
        }
    }

    (FrontMatter::default(), raw.to_string())
}

/// Parse the `key: value` lines of a front-matter block, retaining only `name` and
/// `description`. A line without a colon, or with an unrecognized key, is ignored.
fn parse_front_matter_fields(lines: &[&str]) -> FrontMatter {
    let mut front = FrontMatter::default();
    for line in lines {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = unquote(value.trim()).to_string();
        match key.trim() {
            "name" => front.name = Some(value),
            "description" => front.description = Some(value),
            // Only `name`/`description` steer the capability; ignore any other key.
            _ => {}
        }
    }
    front
}

/// Strip a single pair of matching surrounding quotes (`"` or `'`) from a front-matter
/// scalar, if present; otherwise return it unchanged.
fn unquote(value: &str) -> &str {
    for quote in ['"', '\''] {
        if value.len() >= 2 && value.starts_with(quote) && value.ends_with(quote) {
            return &value[1..value.len() - 1];
        }
    }
    value
}

// Crate-visible rather than private: the [reference](crate::reference) reads the family table this
// module owns, which is gg's one grouping of its own model-facing surface.
#[path = "skills.builtin.rs"]
pub(crate) mod builtin;

pub use builtin::builtin_skills;

#[cfg(test)]
#[path = "skills.test.rs"]
mod tests;
