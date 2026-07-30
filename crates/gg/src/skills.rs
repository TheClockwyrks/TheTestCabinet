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
//! The capability is **ablatable**: when it is off the loop never builds a library
//! ([`SkillsRuntime::disabled`]), so there is no `read_skill` tool, no prompt listing, and
//! no telemetry — the feature vanishes.

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

use test_cabinet_core::gg::{
    CAPABILITY_SKILLS, GgAgentConfig, GgContextSource, GgSkillState, GgTelemetryKind,
};

use crate::model::Message;
use crate::modules::{
    AdoptError, Module, ModuleHandle, ModuleKind, ModuleResolveCtx, Ownership, Refresh,
};
use crate::prompts::SkillView;

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
/// shown to the model up front, and the [`body`](Self::body) (front matter stripped) that
/// `read_skill` returns and pins into context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    /// The skill's stable name — the handle `read_skill` takes and the catalog lists.
    name: String,
    /// The one-line description shown to the model up front.
    description: String,
    /// The skill's body (front matter removed), loaded into context when the skill is read.
    body: String,
}

impl Skill {
    /// The skill's name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The skill's description.
    pub fn description(&self) -> &str {
        &self.description
    }

    /// The skill's body (front matter already stripped).
    pub fn body(&self) -> &str {
        &self.body
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

    /// Load every `*.md` skill file directly under `dir`, parsing each file's front matter
    /// and stripping it from the body. A missing or unreadable directory yields an
    /// [`empty`](Self::empty) library (skills are optional); an individual file that
    /// cannot be read is skipped. The result is ordered by skill name, and a duplicate
    /// name keeps the first file seen in that order.
    pub fn load(dir: &Path) -> Self {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Self::empty();
        };

        // Collect the skill files first, then load in a stable (path-sorted) order so a
        // duplicate front-matter name resolves deterministically to the first file.
        let mut paths: Vec<std::path::PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case(SKILL_EXTENSION))
            })
            .collect();
        paths.sort();

        let mut skills: Vec<Skill> = Vec::new();
        for path in &paths {
            let Ok(raw) = std::fs::read_to_string(path) else {
                continue;
            };
            let fallback = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            let skill = parse_skill(&raw, &fallback);
            // Keep the first file to claim a given name; ignore later duplicates.
            if !skills.iter().any(|existing| existing.name == skill.name) {
                skills.push(skill);
            }
        }

        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Self { skills }
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
/// (an ablation's off arm). It produces the catalog the
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
    /// Whether this holder's prompt carries the catalog — the "here are the skills you have"
    /// listing in the system prompt. An [unowned](crate::modules::Ownership::Unowned) holder still
    /// has `read_skill` and can still read any skill by name; it is simply not handed the menu.
    ownership: Ownership,
    /// The shared, immutable catalog.
    library: Arc<SkillLibrary>,
    /// The names of skills the model has read this session — behind a lock so linked holders of one
    /// window agree on what is already pinned in it.
    read: Arc<Mutex<HashSet<String>>>,
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
    /// An enabled runtime over `library`, with nothing read yet.
    pub fn new(library: Arc<SkillLibrary>) -> Self {
        Self {
            enabled: true,
            ownership: Ownership::Owned,
            library,
            read: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// A disabled runtime (the skills capability is off): no library, no tool, no
    /// telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ownership: Ownership::Owned,
            library: Arc::new(SkillLibrary::empty()),
            read: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// This runtime with its [ownership](Ownership) set.
    pub fn with_ownership(mut self, ownership: Ownership) -> Self {
        self.ownership = ownership;
        self
    }

    /// An **independent** runtime over the same catalog with a copy of the read set — what an
    /// agent built over the orchestrator's shared runtime takes, and what a fork of a window takes
    /// along with the window the read set describes.
    pub fn forked(&self) -> Self {
        Self {
            enabled: self.enabled,
            ownership: self.ownership,
            library: Arc::clone(&self.library),
            read: Arc::new(Mutex::new(
                self.read.lock().expect("skills read set lock").clone(),
            )),
        }
    }

    /// A **linked** runtime over the same catalog *and* the same read set.
    pub fn shared(&self) -> Self {
        Self {
            enabled: self.enabled,
            ownership: self.ownership,
            library: Arc::clone(&self.library),
            read: Arc::clone(&self.read),
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
        // An unowned skills module contributes nothing to the automatically assembled prompt, so
        // there is no menu — `read_skill` still reads any skill by name, which is the whole of what
        // "reachable through its tools and nothing else" means here.
        if !self.offers_skills() || self.ownership != Ownership::Owned {
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
        Some(GgTelemetryKind::SkillsState { skills })
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

    fn enabled(&self) -> bool {
        self.enabled
    }

    fn ownership(&self) -> Ownership {
        self.ownership
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

    /// Re-resolve the ownership from the receiving profile. The catalog itself is run-global and
    /// immutable, so there is nothing else to re-point.
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
        let _ = ctx;
        if !profile.is_enabled(CAPABILITY_SKILLS) {
            return Err(AdoptError::Disabled);
        }
        self.enabled = true;
        self.ownership = crate::modules::resolve_ownership(profile, CAPABILITY_SKILLS).0;
        Ok(())
    }
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

#[cfg(test)]
#[path = "skills.test.rs"]
mod tests;
