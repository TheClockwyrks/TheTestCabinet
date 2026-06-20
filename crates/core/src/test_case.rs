//! Test case catalog: slugs, versions, and resolution.
//!
//! See `docs/testing/end-to-end/overview.md`. Test cases live under a top-level `test-cases/`
//! folder laid out as `test-cases/<slug>/<version>/`. Each version is
//! self-contained and immutable.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The on-disk `test-case.toml` manifest for a single version.
///
/// This is the machine-readable declaration of what a version contains: the
/// specification and assets that are seeded, the reference views (rendered to
/// screenshots and seeded as visual targets), and the opt-in validation checks.
/// See `docs/testing/end-to-end/manifests.md`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct Manifest {
    /// Human-readable display name, surfaced on the site.
    name: String,
    /// Relative difficulty of the case, surfaced on the site (for example
    /// `easy`, `medium`, `hard`). **Required**.
    difficulty: String,
    /// Free-form classification tags surfaced on the site (for example
    /// `arcade`, `2d`). **Required** (may be an empty list).
    tags: Vec<String>,
    /// Optional one- or two-sentence abstract, surfaced on the site's test case
    /// cards. Authored inline as plain text (not a file) so it renders safely
    /// inside the card's link and stays deliberately short; the longer
    /// [`Self::description`] is shown on the detail page. **Not** seeded into runs.
    #[serde(default)]
    summary: Option<String>,
    /// Optional site-facing prose, relative to the version folder, pointing at a
    /// Markdown file (for example `description.md`). This is **not** seeded into
    /// runs; it exists only to describe the case on the site.
    #[serde(default)]
    description: Option<PathBuf>,
    /// The prompt template handed to the harness, relative to the version folder.
    /// Rendered through Handlebars with the run's workspace and seeded spec paths;
    /// see [`crate::prompt`].
    prompt: PathBuf,
    /// The maximum wall-clock duration, in seconds, the harness session for this
    /// case is allowed before it is stopped. Supplies the per-case default that a
    /// run can override (for example `tcab run --max-runtime`). Defaults to
    /// [`default_max_runtime_seconds`] when omitted so a run is never unbounded.
    #[serde(default = "default_max_runtime_seconds")]
    max_runtime_seconds: u64,
    /// The commands the validator runs to build the produced implementation as a
    /// static site (the `[build]` table). **Required**: a case must state both
    /// commands explicitly, so absence is rejected at resolution rather than
    /// defaulted. Modeled as `Option` only to detect omission and report it.
    #[serde(default)]
    build: Option<ManifestBuild>,
    /// Specs seeded for **every** variant. Each maps a `source` inside the
    /// version folder to a `dest` in the run's workspace. Declared as repeated
    /// `[[spec]]` tables.
    #[serde(default, rename = "spec")]
    specs: Vec<ManifestSpec>,
    /// Optional starter **workspace** directory, relative to the version folder.
    /// Its contents are copied into the root of the run's workspace before the
    /// specs are seeded, giving every run a baseline project to build on (for
    /// example a `package.json`). A variant may override it with its own
    /// directory (see [`ManifestVariant::workspace`]). `None` seeds no starter
    /// files.
    #[serde(default)]
    workspace: Option<PathBuf>,
    /// Optional **init** command, run inside the run container once the workspace
    /// and specs are seeded and before the harness starts. It can be a plain
    /// command (for example `npm install`) or invoke a file the workspace
    /// supplies. `None` runs no init step.
    #[serde(default)]
    init: Option<String>,
    /// Asset files or directories, relative to the version folder (seeded).
    #[serde(default)]
    assets: Vec<PathBuf>,
    /// The variants this case offers. Each seeds the common `specs` plus its own
    /// additional specs; exactly one variant runs per run. At least one variant
    /// must be declared.
    #[serde(default)]
    variant: Vec<ManifestVariant>,
    /// Reference views. Each is either an HTML mockup rendered to a screenshot
    /// or a static image/video used as-is, seeded as a visual target; a rendered
    /// reference's source mockup is not seeded.
    #[serde(default)]
    reference: Vec<ManifestReference>,
    /// Proof-of-implementation artifacts the agent is asked to produce, declared
    /// for **every** variant. Each names a `dest` path the agent must write a
    /// screenshot or `.mp4` to; validation records whether it is present. Declared
    /// as repeated `[[proof]]` tables.
    #[serde(default)]
    proof: Vec<ManifestProof>,
    /// Opt-in validation checks. Only declared checks run.
    #[serde(default)]
    check: Vec<ManifestCheck>,
    /// Reviewer checklist items declared for **every** variant. Reviewer-facing
    /// and **not seeded**: they enumerate what a person must explicitly check
    /// after playing a build, so a case's major requirements are guaranteed to be
    /// verified by hand. Declared as repeated `[[review_item]]` tables.
    #[serde(default, rename = "review_item")]
    review_items: Vec<ManifestReviewItem>,
    /// Scoring domains the reviewer rates independently — for example a game's
    /// single-player and versus modes. The run's overall rating is the **worst**
    /// rating across all of them. At least one must be declared. Declared as
    /// repeated `[[domain]]` tables.
    #[serde(default, rename = "domain")]
    domains: Vec<ManifestDomain>,
}

/// The `[build]` table in the manifest: the commands the validator runs to turn
/// a produced implementation into a served static site. Both fields are required
/// — there are no defaults, so a case always records exactly how it is built.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestBuild {
    /// Command that installs dependencies (for example `npm ci`, which requires a
    /// committed lockfile).
    install: String,
    /// Command that produces the static build (for example `npm run build`).
    build: String,
}

/// A single spec mapping in the manifest (`[[spec]]` or a variant's `spec`
/// array): a `source` file inside the version folder seeded to a `dest` path in
/// the run's workspace.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestSpec {
    /// Source path, relative to the version folder.
    source: PathBuf,
    /// Destination path, relative to the run's workspace root.
    dest: PathBuf,
}

/// A single `[[variant]]` entry in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestVariant {
    /// The stable slug naming this variant (recorded in run records).
    slug: String,
    /// Human-readable display name. Defaults to a humanized form of `slug`.
    name: Option<String>,
    /// Optional site-facing prose describing what the variant changes.
    #[serde(default)]
    description: Option<String>,
    /// Specs this variant seeds in addition to the common `specs`. Declared as a
    /// `spec` array of inline `{ source, dest }` tables.
    #[serde(default, rename = "spec")]
    specs: Vec<ManifestSpec>,
    /// Optional starter **workspace** directory for this variant, relative to the
    /// version folder. When present it **replaces** the case's common workspace
    /// for runs of this variant (it is not additive), so a variant can ship a
    /// different baseline project. `None` falls back to the common workspace.
    #[serde(default)]
    workspace: Option<PathBuf>,
    /// Reference views this variant declares in addition to the common
    /// references. Declared as a `reference` array of inline `{ view, path }`
    /// tables. A variant-specific reference lets one view (for example the title
    /// menu) differ per variant; its view slug must not collide with a common
    /// reference or another of this variant's references.
    #[serde(default, rename = "reference")]
    references: Vec<ManifestReference>,
    /// Proof-of-implementation artifacts this variant declares in addition to the
    /// common ones. Declared as a `proof` array of inline `{ id, name, dest }`
    /// tables; an id must not collide with a common proof or another of this
    /// variant's proofs.
    #[serde(default, rename = "proof")]
    proofs: Vec<ManifestProof>,
    /// Reviewer checklist items this variant declares in addition to the common
    /// items. Declared as a `review_item` array of inline `{ id, text }` tables.
    /// A variant-specific item lets a mode-only requirement be checked only when
    /// that variant runs; its id must not collide with a common item or another
    /// of this variant's items.
    #[serde(default, rename = "review_item")]
    review_items: Vec<ManifestReviewItem>,
}

/// A single `[[reference]]` entry in the manifest.
///
/// A reference is **either** an HTML mockup rendered to a screenshot (`path`) or
/// a static image/video served as-is (`media`). Exactly one of the two must be
/// set; resolution rejects declaring both or neither.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestReference {
    /// The view slug.
    view: String,
    /// The HTML mockup source path, relative to the version folder. Rendered to a
    /// PNG screenshot; the source is never seeded. Mutually exclusive with
    /// [`Self::media`].
    #[serde(default)]
    path: Option<PathBuf>,
    /// A static image or `.mp4` file path, relative to the version folder, used as
    /// the reference as-is (not rendered). Lets the "expected" side of a review
    /// item be a video or a prepared still. Mutually exclusive with [`Self::path`].
    #[serde(default)]
    media: Option<PathBuf>,
}

/// A single `[[proof]]` entry in the manifest (or a variant's `proof` array): one
/// proof-of-implementation artifact the agent is asked to produce.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestProof {
    /// Stable slug identifying this proof; recorded in the run's validation and
    /// used to pair a review item with the submitted media.
    id: String,
    /// Human-readable display name. Defaults to a humanized form of `id`.
    name: Option<String>,
    /// The path, relative to the run's workspace root, the agent must write the
    /// proof to. The media kind (image or video) is inferred from its extension.
    /// The spec that requests the proof must reference this same path.
    dest: PathBuf,
}

/// A single `[[check]]` entry in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestCheck {
    /// The view slug this check records its result under.
    view: String,
    /// Human-readable display name for the check. Defaults to a humanized form
    /// of `view` (for example `game-over` becomes `Game Over`) when omitted.
    name: Option<String>,
    /// The reference view whose rendered screenshot is the comparison baseline.
    /// Defaults to `view` when omitted.
    reference: Option<String>,
    /// The actions that drive the implementation into the view before capture.
    /// Empty means the view is whatever the implementation shows on load.
    #[serde(default)]
    actions: Vec<CheckAction>,
}

/// A single `[[review_item]]` entry in the manifest (or a variant's
/// `review_item` array): one item a reviewer must explicitly check.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestReviewItem {
    /// Stable slug identifying this item; recorded with the reviewer's verdict.
    id: String,
    /// A short heading shown above the item in the reviewer UI (a synthesized
    /// number is prefixed at display time).
    title: String,
    /// The prose a reviewer reads — what to check.
    text: String,
    /// Optional reference view to show the reviewer as the **expected** target for
    /// this item. Must name a reference that resolves for the item's variant.
    #[serde(default)]
    reference: Option<String>,
    /// Optional proof id whose **submitted** media is shown to the reviewer for
    /// this item. Must name a proof that resolves for the item's variant.
    #[serde(default)]
    proof: Option<String>,
    /// How many points this item is worth toward the run's score (an academic
    /// test's per-question marks). **Required** and must be greater than zero.
    weight: u32,
    /// Optional scoring domain this item belongs to. Must name a declared
    /// `[[domain]]`. `None` for a general item that belongs to no single domain.
    #[serde(default)]
    domain: Option<String>,
}

/// A single `[[domain]]` entry in the manifest: one scoring domain a reviewer
/// rates independently.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestDomain {
    /// Stable slug identifying this domain; recorded with the reviewer's
    /// per-domain rating.
    id: String,
    /// Human-readable display name. Defaults to a humanized form of `id`.
    name: Option<String>,
    /// A brief description of what the domain covers, shown to the reviewer so
    /// they know what they are rating. **Required**.
    description: String,
}

/// The manifest file name expected in every version folder.
const MANIFEST_FILE: &str = "test-case.toml";

/// A test case: a single game a model is asked to build, identified by a stable
/// slug and offering one or more independently versioned revisions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    /// The stable slug naming this test case (the `<slug>` directory).
    pub slug: String,
    /// The versions available for this test case.
    pub versions: Vec<String>,
}

/// The kind of a piece of media — used for both reference media and proof
/// artifacts so a UI knows whether to render an `<img>` or a `<video>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    /// A still image (`png`, `jpg`, `jpeg`, `webp`, `gif`).
    Image,
    /// A video clip (`mp4`).
    Video,
}

impl MediaKind {
    /// Infer the media kind from a path's file extension. Returns `None` for an
    /// extension that is neither a supported image nor a supported video.
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "gif" => Some(Self::Image),
            "mp4" => Some(Self::Video),
            _ => None,
        }
    }
}

/// How a reference view's source is turned into the seeded/served artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceKind {
    /// An HTML mockup rendered to a PNG screenshot. The served media is always an
    /// image.
    Rendered,
    /// A static image file used as-is.
    Image,
    /// A static video file (`mp4`) used as-is.
    Video,
}

impl ReferenceKind {
    /// The kind of media this reference ultimately presents (a rendered mockup is
    /// always an image).
    pub fn media_kind(self) -> MediaKind {
        match self {
            Self::Rendered | Self::Image => MediaKind::Image,
            Self::Video => MediaKind::Video,
        }
    }

    /// Whether the reference is an HTML mockup that must be rendered (rather than
    /// a static file served as-is).
    pub fn is_rendered(self) -> bool {
        matches!(self, Self::Rendered)
    }
}

/// A proof-of-implementation artifact a test case asks the agent to produce.
///
/// Unlike specs and references, a proof is **not** seeded into a run: it is
/// output the agent writes during the run to its [`Self::dest`] path (a screenshot
/// or short `.mp4`) to evidence that a feature works. Validation records whether
/// each declared proof is present (see [`crate::validation::ProofResult`]), and a
/// reviewer pairs it with the expected reference when judging the run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofFile {
    /// Stable slug identifying this proof; recorded in validation and used to pair
    /// a review item with the submitted media.
    pub id: String,
    /// Human-readable display name, surfaced in the reviewer UI.
    pub name: String,
    /// The media kind, inferred from [`Self::dest`]'s extension.
    pub kind: MediaKind,
    /// The path, relative to the run's workspace root, the agent must write the
    /// proof to.
    pub dest: PathBuf,
}

/// A spec file seeded into a run.
///
/// Each spec is copied from its [`Self::source_path`] on the host into the run's
/// fresh repository at [`Self::dest`] (a path relative to the workspace root). A
/// case's common specs are seeded for every variant; a variant may seed
/// additional specs, and may even map a different source onto the same `dest` so
/// the model always sees a stable path regardless of variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecFile {
    /// Source path on the host, inside the version folder.
    pub source_path: PathBuf,
    /// Destination path relative to the run's workspace root, where the spec is
    /// seeded and where the rendered prompt points the model.
    pub dest: PathBuf,
}

/// A single starter file copied into a run's workspace from a test case's
/// **workspace** directory.
///
/// A case (or a variant overriding it) may declare a workspace directory whose
/// contents seed the root of the run's repository before the specs are written,
/// giving the model a baseline project to build on — a `package.json`, configs,
/// and whatever else a run should start with. Each file is enumerated from that
/// directory at resolution: [`Self::source_path`] is the file on the host and
/// [`Self::dest`] is its path **relative to the workspace directory**, which is
/// where it lands in the run (so `workspaces/base/package.json` seeds to
/// `package.json` at the repository root). Workspace files are seeded verbatim;
/// unlike specs, they are never rendered as templates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    /// Source path on the host, inside the version folder's workspace directory.
    pub source_path: PathBuf,
    /// Destination path relative to the run's workspace root, where the file is
    /// seeded.
    pub dest: PathBuf,
}

/// The commands the validator runs to build a produced implementation into a
/// served static site, resolved from the manifest's required `[build]` table.
///
/// Each command is run from the implementation's repository root. A case must
/// state both explicitly — there are no defaults. `npm ci` (which requires the
/// build to commit a lockfile) followed by `npm run build` is conventional; a
/// case may pin a different toolchain so long as it still emits a static build
/// the load check can serve.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCommands {
    /// Command that installs dependencies before the build.
    pub install: String,
    /// Command that produces the static build.
    pub build: String,
}

/// A named build target of a test case.
///
/// A variant seeds the case's common specs plus its own additional specs, so one
/// case can define multiple builds (for example, the same game with or without an
/// extra mode). Exactly one variant is selected per run and recorded in the run
/// record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    /// The stable slug naming this variant.
    pub slug: String,
    /// Human-readable display name, surfaced on the site.
    pub name: String,
    /// Optional site-facing prose describing what the variant changes.
    pub description: Option<String>,
    /// Specs this variant seeds in addition to the case's common specs.
    pub specs: Vec<SpecFile>,
    /// Starter workspace files for this variant, when it overrides the case's
    /// common workspace. `Some` **replaces** the common workspace for this
    /// variant (it is not additive); `None` falls back to
    /// [`TestCaseVersion::common_workspace`]. Resolve the effective set for a
    /// variant with [`TestCaseVersion::workspace_for`].
    pub workspace: Option<Vec<WorkspaceFile>>,
    /// Reference views this variant declares in addition to the case's common
    /// references. Rendered and seeded only when this variant is selected, so a
    /// view such as the title menu can differ per variant.
    pub references: Vec<ReferenceView>,
    /// Proof-of-implementation artifacts this variant declares in addition to the
    /// case's common proofs. Requested only when this variant is selected.
    pub proofs: Vec<ProofFile>,
    /// Reviewer checklist items this variant declares in addition to the case's
    /// common items. Surfaced to a reviewer only when this variant is selected, so
    /// a mode-specific check rides along only with the variant that adds the mode.
    pub review_items: Vec<ReviewItem>,
}

/// A reference view a test case declares as a visual target.
///
/// The reference is rendered to a screenshot which is **seeded** into a run so
/// the model can see what the screen should look like. The reference *source*
/// (the HTML/CSS mockup at [`Self::source_path`]) is never seeded — handing it
/// over would let a model copy the intended UI instead of building it from the
/// specification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceView {
    /// The view name (for example, `title`), matched against a declared
    /// [`Check`]'s baseline.
    pub view: String,
    /// How the reference is produced: a rendered HTML mockup, or a static
    /// image/video served as-is.
    pub kind: ReferenceKind,
    /// Path to the reference source on the host. For a [`ReferenceKind::Rendered`]
    /// reference this is the HTML mockup (rendered to a screenshot, never seeded);
    /// for a static reference it is the image or video file itself, which is
    /// seeded and served as-is.
    pub source_path: PathBuf,
}

impl ReferenceView {
    /// The file extension under which this reference is seeded and served:
    /// `png` for a rendered mockup, otherwise the static source's own extension.
    pub fn extension(&self) -> String {
        if self.kind.is_rendered() {
            return "png".to_string();
        }
        self.source_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .unwrap_or_else(|| "png".to_string())
    }
}

/// A single action that drives a served implementation toward a view.
///
/// Serializes to the JSON shape the browser driver consumes (an internally
/// tagged `{ "type": … }` object); see `packages/browser-driver/driver.mjs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CheckAction {
    /// Pause for `ms` milliseconds.
    Wait {
        /// Duration to wait, in milliseconds.
        ms: u64,
    },
    /// Press and release a key (Playwright key name, e.g. `Enter`, `ArrowUp`).
    Key {
        /// The key to press.
        key: String,
    },
    /// Hold a key down for `ms` milliseconds, then release it.
    Hold {
        /// The key to hold.
        key: String,
        /// How long to hold it, in milliseconds.
        ms: u64,
    },
    /// Click a logical-pixel point on the page.
    Click {
        /// Horizontal position, in logical pixels.
        x: f64,
        /// Vertical position, in logical pixels.
        y: f64,
    },
}

/// An opt-in validation check.
///
/// A check drives a produced implementation through [`Self::actions`],
/// screenshots it, and compares that capture against the screenshot rendered
/// from the [`Self::reference_view`] reference. Validation runs only the checks
/// a test case declares; a reference is not validated unless a check names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// The view slug this check records its result under.
    pub view: String,
    /// Human-readable display name for the check.
    pub name: String,
    /// The reference view whose rendered screenshot is the comparison baseline.
    pub reference_view: String,
    /// The actions that drive the implementation into the view before capture.
    pub actions: Vec<CheckAction>,
}

/// A reviewer checklist item a test case declares.
///
/// Reviewer checklist items are **not seeded** into a run; they are reporter-side
/// material that enumerates what a person must explicitly check after playing a
/// build, so a case's major requirements are guaranteed to be verified by hand
/// rather than left to whatever a reviewer happens to notice. Each item is
/// recorded against the run's review by [`Self::id`] together with the reviewer's
/// verdict (see [`crate::review`]). Items restate observable requirements the
/// seeded specification already states, so keeping them out of the run hides
/// nothing from the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    /// Stable slug identifying this item; recorded with the reviewer's verdict.
    pub id: String,
    /// A short heading shown above the item in the reviewer UI (a synthesized
    /// number is prefixed at display time).
    pub title: String,
    /// The prose a reviewer reads — what to check.
    pub text: String,
    /// Optional reference view shown to the reviewer as the **expected** target
    /// for this item. `None` when the item has no paired reference.
    pub reference: Option<String>,
    /// Optional proof id whose **submitted** media is shown to the reviewer for
    /// this item. `None` when the item has no paired proof.
    pub proof: Option<String>,
    /// How many points this item is worth toward the run's score. Always greater
    /// than zero. A run earns this item's weight when the reviewer marks it
    /// `pass`, and none when they mark it `fail`; the run's score is the earned
    /// weight over the total declared weight (see [`crate::review::score`]).
    pub weight: u32,
    /// The scoring [`Domain`] this item belongs to (by id), or `None` for a
    /// general item that belongs to no single domain. Used to group the score
    /// breakdown by domain in the reviewer and verdict UIs.
    pub domain: Option<String>,
}

/// A scoring domain a test case declares.
///
/// A reviewer rates each domain independently (for example a game's
/// single-player and versus modes), and the run's overall rating is the **worst**
/// rating across all of them — a flawless mode cannot mask a broken one. A case
/// declares at least one domain. Review items may be grouped under a domain (see
/// [`ReviewItem::domain`]) to break the score down per domain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    /// Stable slug identifying this domain; recorded with the reviewer's
    /// per-domain rating.
    pub id: String,
    /// Human-readable display name, surfaced in the reviewer and verdict UIs.
    pub name: String,
    /// A brief description of what the domain covers, shown to the reviewer so
    /// they know what they are rating.
    pub description: String,
}

// `Check` derives `Eq`, so its actions must too; the `Click` coordinates are the
// only floats. They originate as exact TOML literals and are only ever compared,
// never arithmetic'd, so treating them as `Eq` is sound here.
impl Eq for CheckAction {}

/// A resolved, exact test case version.
///
/// Holds the on-disk location and the manifest of what the version contains.
/// The specification, assets, and the *rendered* reference screenshots are
/// seeded into a run; the reference *source* mockups are not. The declared
/// [`Self::checks`] drive validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseVersion {
    /// The owning test case slug.
    pub slug: String,
    /// The exact version string (the `<version>` directory).
    pub version: String,
    /// Human-readable display name, surfaced on the site.
    pub name: String,
    /// Relative difficulty of the case, surfaced on the site.
    pub difficulty: String,
    /// Free-form classification tags surfaced on the site.
    pub tags: Vec<String>,
    /// Optional short, site-facing abstract shown on the test case cards.
    /// Authored inline as plain text in the manifest. `None` when the manifest
    /// declares none. This is **not** seeded into runs.
    pub summary: Option<String>,
    /// Path to the optional site-facing description Markdown, resolved inside
    /// the version folder. `None` when the manifest declares none. This is
    /// **not** seeded into runs.
    pub description_path: Option<PathBuf>,
    /// The version folder on the host: `test-cases/<slug>/<version>/`.
    pub root: PathBuf,
    /// Host path to the prompt template handed to the harness. Rendered through
    /// Handlebars with the run's workspace and seeded spec paths.
    pub prompt_path: PathBuf,
    /// The maximum wall-clock duration, in seconds, the harness session is
    /// allowed before it is stopped. This is the per-case default; a run may
    /// override it (see [`crate::RunRequest::max_runtime_override`]). Always
    /// positive, so a run is never unbounded.
    pub max_runtime_seconds: u64,
    /// The commands the validator runs to build the produced implementation into
    /// a served static site (from the manifest's `[build]` table).
    pub build: BuildCommands,
    /// Specs seeded for every variant (the common set).
    pub common_specs: Vec<SpecFile>,
    /// Starter workspace files seeded for every variant that does not override
    /// the workspace (the common set, enumerated from the manifest's `workspace`
    /// directory). Empty when the case declares no workspace. A variant may
    /// replace these with its own (see [`Variant::workspace`]); the effective set
    /// for a variant is [`Self::workspace_for`].
    pub common_workspace: Vec<WorkspaceFile>,
    /// The command run inside the run container once the workspace and specs are
    /// seeded and before the harness starts (the manifest's `init`). `None` when
    /// the case declares no init step. See [`crate::Orchestrator::execute`].
    pub init: Option<String>,
    /// Paths to assets the model should use (seeded).
    pub asset_paths: Vec<PathBuf>,
    /// The variants this case offers, in declared order. At least one is always
    /// present.
    pub variants: Vec<Variant>,
    /// Common reference views: rendered and seeded for **every** variant. A
    /// variant may declare additional references of its own (see
    /// [`Variant::references`]); the full set for a variant is
    /// [`Self::references_for`].
    pub common_references: Vec<ReferenceView>,
    /// Proof-of-implementation artifacts requested for **every** variant (the
    /// common set). A variant may declare additional proofs of its own (see
    /// [`Variant::proofs`]); the full set for a variant is [`Self::proofs_for`].
    pub common_proofs: Vec<ProofFile>,
    /// Opt-in validation checks declared by this version.
    pub checks: Vec<Check>,
    /// Reviewer checklist items declared for **every** variant (the common set). A
    /// variant may declare additional items of its own (see
    /// [`Variant::review_items`]); the full set for a variant is
    /// [`Self::review_items_for`]. **Not** seeded — reporter-side material a
    /// reviewer works through after playing a build.
    pub common_review_items: Vec<ReviewItem>,
    /// The scoring domains this case declares, in declared order. A reviewer
    /// rates each independently; the run's overall rating is the worst across
    /// them. At least one is always present. Unlike review items, domains are
    /// case-level rather than variant-scoped.
    pub domains: Vec<Domain>,
}

impl TestCaseVersion {
    /// Resolve a variant by its slug.
    pub fn variant(&self, slug: &str) -> Result<&Variant> {
        self.variants
            .iter()
            .find(|variant| variant.slug == slug)
            .ok_or_else(|| Error::VariantNotFound {
                slug: self.slug.clone(),
                version: self.version.clone(),
                variant: slug.to_string(),
            })
    }

    /// The starter workspace files seeded for a variant: the variant's own set
    /// when it overrides the workspace, otherwise the case's common workspace.
    /// Unlike specs, a variant's workspace **replaces** the common one rather
    /// than layering on top, so this returns one or the other rather than a
    /// concatenation.
    pub fn workspace_for<'a>(&'a self, variant: &'a Variant) -> &'a [WorkspaceFile] {
        variant
            .workspace
            .as_deref()
            .unwrap_or(&self.common_workspace)
    }

    /// The full set of specs seeded for a variant: the common specs followed by
    /// the variant's own additional specs. Resolution forbids two specs sharing a
    /// `dest`, so the order is stable and unambiguous.
    pub fn seeded_specs(&self, variant: &Variant) -> Vec<SpecFile> {
        self.common_specs
            .iter()
            .chain(variant.specs.iter())
            .cloned()
            .collect()
    }

    /// The full set of reference views for a variant: the common references
    /// followed by the variant's own additional references. These are the views
    /// rendered to screenshots, seeded as visual targets, and used as validation
    /// baselines when this variant runs. Resolution forbids two references sharing
    /// a `view`, so the order is stable and each view slug is unambiguous.
    pub fn references_for(&self, variant: &Variant) -> Vec<ReferenceView> {
        self.common_references
            .iter()
            .chain(variant.references.iter())
            .cloned()
            .collect()
    }

    /// The full set of proof-of-implementation artifacts requested for a variant:
    /// the common proofs followed by the variant's own. Resolution forbids two
    /// proofs sharing an `id`, so the order is stable and each id is unambiguous.
    pub fn proofs_for(&self, variant: &Variant) -> Vec<ProofFile> {
        self.common_proofs
            .iter()
            .chain(variant.proofs.iter())
            .cloned()
            .collect()
    }

    /// The full set of reviewer checklist items for a variant: the common items
    /// followed by the variant's own additional items. These are what a reviewer
    /// must work through for a run on this variant. Resolution forbids two items
    /// sharing an `id`, so the order is stable and each id is unambiguous.
    pub fn review_items_for(&self, variant: &Variant) -> Vec<ReviewItem> {
        self.common_review_items
            .iter()
            .chain(variant.review_items.iter())
            .cloned()
            .collect()
    }
}

/// Resolves test case slugs and versions against an on-disk catalog.
///
/// The catalog is the `test-cases/` directory laid out as
/// `test-cases/<slug>/<version>/`.
#[derive(Debug, Clone)]
pub struct TestCaseCatalog {
    /// Root of the catalog (the `test-cases/` directory).
    root: PathBuf,
}

impl TestCaseCatalog {
    /// Open a catalog rooted at the given `test-cases/` directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The catalog root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// List every test case slug in the catalog, each with its versions newest
    /// first. Slugs with no version folders are skipped.
    pub fn list(&self) -> Result<Vec<TestCase>> {
        let mut cases = Vec::new();
        for slug in read_dir_names(&self.root)? {
            let versions = self.versions(&slug)?;
            if !versions.is_empty() {
                cases.push(TestCase { slug, versions });
            }
        }
        cases.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(cases)
    }

    /// List the versions available for a slug, newest first.
    pub fn versions(&self, slug: &str) -> Result<Vec<String>> {
        let slug_dir = self.root.join(slug);
        if !slug_dir.is_dir() {
            return Err(Error::TestCaseNotFound {
                slug: slug.to_string(),
            });
        }
        let mut versions = read_dir_names(&slug_dir)?;
        // Newest first. Versions are compared component-wise so `v1.10.0` sorts
        // after `v1.9.0` rather than lexically before it.
        versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
        Ok(versions)
    }

    /// Resolve an exact `<slug>@<version>` into a [`TestCaseVersion`], reading
    /// its manifest and validating that it is self-contained.
    pub fn resolve(&self, slug: &str, version: &str) -> Result<TestCaseVersion> {
        let slug_dir = self.root.join(slug);
        if !slug_dir.is_dir() {
            return Err(Error::TestCaseNotFound {
                slug: slug.to_string(),
            });
        }
        let root = slug_dir.join(version);
        if !root.is_dir() {
            return Err(Error::TestCaseVersionNotFound {
                slug: slug.to_string(),
                version: version.to_string(),
            });
        }

        let manifest = self.read_manifest(slug, version, &root)?;
        let invalid = |detail: String| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail,
        };

        // Every declared path must stay inside the version folder, keeping the
        // version self-contained.
        let resolve_inside = |rel: &Path, kind: &str| -> Result<PathBuf> {
            if escapes_folder(rel) {
                return Err(invalid(format!(
                    "{kind} path `{}` escapes the version folder",
                    rel.display()
                )));
            }
            Ok(root.join(rel))
        };

        // The prompt template is required. It is handed to the harness in
        // rendered form rather than copied into the run, but it is validated to
        // exist and to stay inside the version folder like every other path.
        let prompt_path = resolve_inside(&manifest.prompt, "prompt")?;
        if !prompt_path.is_file() {
            return Err(invalid(format!(
                "prompt `{}` does not exist",
                manifest.prompt.display()
            )));
        }

        // The runtime cap bounds the harness session so a run can never continue
        // unbounded. A zero cap would stop every run instantly, which is never
        // intended, so it is rejected rather than silently accepted.
        if manifest.max_runtime_seconds == 0 {
            return Err(invalid(
                "max_runtime_seconds must be greater than zero".to_string(),
            ));
        }

        // The `[build]` table is required: a case must state exactly how its
        // implementation is built rather than inheriting a default, so its absence
        // is rejected here. The validator then runs the commands verbatim; a blank
        // one would run nothing and silently skip a build step, so reject that too
        // rather than letting a typo'd `[build]` table degrade the load check.
        let build = manifest
            .build
            .ok_or_else(|| invalid("the [build] table is required".to_string()))?;
        if build.install.trim().is_empty() {
            return Err(invalid("build.install must not be empty".to_string()));
        }
        if build.build.trim().is_empty() {
            return Err(invalid("build.build must not be empty".to_string()));
        }

        // Scoring domains: a reviewer rates each independently and the run's
        // overall rating is the worst across them, so a case must declare at least
        // one. Ids must be unique (each keys a recorded per-domain rating) and a
        // description is required so the reviewer knows what they are rating.
        if manifest.domains.is_empty() {
            return Err(invalid(
                "at least one [[domain]] must be declared".to_string(),
            ));
        }
        let mut domains: Vec<Domain> = Vec::with_capacity(manifest.domains.len());
        for domain in &manifest.domains {
            if domain.id.trim().is_empty() {
                return Err(invalid("domain `id` must not be empty".to_string()));
            }
            if domain.description.trim().is_empty() {
                return Err(invalid(format!(
                    "domain `{}` has empty `description`",
                    domain.id
                )));
            }
            if domains.iter().any(|resolved| resolved.id == domain.id) {
                return Err(invalid(format!("duplicate domain id `{}`", domain.id)));
            }
            let name = domain.name.clone().unwrap_or_else(|| humanize(&domain.id));
            domains.push(Domain {
                id: domain.id.clone(),
                name,
                description: domain.description.clone(),
            });
        }

        // Resolve one spec mapping: the source must exist inside the version
        // folder, and the dest must be a relative path that stays inside the
        // run's workspace.
        let resolve_spec = |spec: &ManifestSpec| -> Result<SpecFile> {
            let source_path = resolve_inside(&spec.source, "spec source")?;
            if !source_path.is_file() {
                return Err(invalid(format!(
                    "spec source `{}` does not exist",
                    spec.source.display()
                )));
            }
            if escapes_folder(&spec.dest) {
                return Err(invalid(format!(
                    "spec dest `{}` escapes the run workspace",
                    spec.dest.display()
                )));
            }
            Ok(SpecFile {
                source_path,
                dest: spec.dest.clone(),
            })
        };

        let mut common_specs = Vec::with_capacity(manifest.specs.len());
        for spec in &manifest.specs {
            common_specs.push(resolve_spec(spec)?);
        }

        // Resolve a starter workspace directory into the list of files it seeds.
        // The directory must exist inside the version folder; each file's `dest`
        // is its path relative to that directory, so `workspaces/base/package.json`
        // seeds to `package.json` at the run's root. Shared by the common
        // workspace and each variant's override.
        let resolve_workspace = |dir: &Path, kind: &str| -> Result<Vec<WorkspaceFile>> {
            let path = resolve_inside(dir, kind)?;
            if !path.is_dir() {
                return Err(invalid(format!(
                    "{kind} `{}` is not a directory",
                    dir.display()
                )));
            }
            let mut files = Vec::new();
            collect_workspace_files(&path, &path, &mut files).map_err(|err| {
                invalid(format!("could not read {kind} `{}`: {err}", dir.display()))
            })?;
            // Stable, dest-ordered so seeding and the stored manifest are
            // deterministic regardless of directory read order.
            files.sort_by(|a, b| a.dest.cmp(&b.dest));
            Ok(files)
        };
        let common_workspace = match &manifest.workspace {
            Some(dir) => resolve_workspace(dir, "workspace")?,
            None => Vec::new(),
        };

        // The init command, when declared, runs in the container after seeding; a
        // blank string would be a no-op the author almost certainly did not mean,
        // so reject it rather than silently running nothing.
        if let Some(init) = &manifest.init
            && init.trim().is_empty()
        {
            return Err(invalid("init must not be empty when declared".to_string()));
        }

        // The site-facing description is validated to exist when declared, with
        // the same self-containment guard as every other path, but it is never
        // seeded into a run.
        let description_path = match &manifest.description {
            Some(description) => {
                let path = resolve_inside(description, "description")?;
                if !path.is_file() {
                    return Err(invalid(format!(
                        "description `{}` does not exist",
                        description.display()
                    )));
                }
                Some(path)
            }
            None => None,
        };

        let mut asset_paths = Vec::with_capacity(manifest.assets.len());
        for asset in &manifest.assets {
            let path = resolve_inside(asset, "asset")?;
            if !path.exists() {
                return Err(invalid(format!(
                    "asset `{}` does not exist",
                    asset.display()
                )));
            }
            asset_paths.push(path);
        }
        // The run-relative dest of each seeded asset, used by the per-variant
        // collision check below. An asset keeps its path relative to the version
        // folder when seeded (a directory recursively under that path).
        let asset_dests: Vec<PathBuf> = asset_paths
            .iter()
            .map(|path| {
                path.strip_prefix(&root)
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|_| path.clone())
            })
            .collect();

        // Resolve one reference mapping. A reference is either an HTML mockup
        // rendered to a screenshot (`path`) or a static image/video served as-is
        // (`media`); exactly one must be declared. The source must exist inside the
        // version folder. Shared by the common references and each variant's own.
        let resolve_reference = |reference: &ManifestReference| -> Result<ReferenceView> {
            let (rel, kind) = match (&reference.path, &reference.media) {
                (Some(path), None) => (path, ReferenceKind::Rendered),
                (None, Some(media)) => {
                    let kind = MediaKind::from_path(media).ok_or_else(|| {
                        invalid(format!(
                            "reference media `{}` for view `{}` has an unsupported extension \
                             (expected an image or .mp4)",
                            media.display(),
                            reference.view
                        ))
                    })?;
                    let kind = match kind {
                        MediaKind::Image => ReferenceKind::Image,
                        MediaKind::Video => ReferenceKind::Video,
                    };
                    (media, kind)
                }
                (Some(_), Some(_)) => {
                    return Err(invalid(format!(
                        "reference for view `{}` declares both `path` and `media`; \
                         exactly one is allowed",
                        reference.view
                    )));
                }
                (None, None) => {
                    return Err(invalid(format!(
                        "reference for view `{}` declares neither `path` nor `media`",
                        reference.view
                    )));
                }
            };
            let source_path = resolve_inside(rel, "reference")?;
            if !source_path.is_file() {
                return Err(invalid(format!(
                    "reference `{}` for view `{}` does not exist",
                    rel.display(),
                    reference.view
                )));
            }
            Ok(ReferenceView {
                view: reference.view.clone(),
                kind,
                source_path,
            })
        };

        // Resolve one proof-of-implementation declaration: its id must be
        // non-empty, its dest must stay inside the run workspace, and the media
        // kind is inferred from the dest extension. Shared by the common proofs
        // and each variant's own.
        let resolve_proof = |proof: &ManifestProof| -> Result<ProofFile> {
            if proof.id.trim().is_empty() {
                return Err(invalid("proof `id` must not be empty".to_string()));
            }
            if escapes_folder(&proof.dest) {
                return Err(invalid(format!(
                    "proof `{}` dest `{}` escapes the run workspace",
                    proof.id,
                    proof.dest.display()
                )));
            }
            let kind = MediaKind::from_path(&proof.dest).ok_or_else(|| {
                invalid(format!(
                    "proof `{}` dest `{}` has an unsupported extension \
                     (expected an image or .mp4)",
                    proof.id,
                    proof.dest.display()
                ))
            })?;
            let name = proof.name.clone().unwrap_or_else(|| humanize(&proof.id));
            Ok(ProofFile {
                id: proof.id.clone(),
                name,
                kind,
                dest: proof.dest.clone(),
            })
        };

        let mut common_references = Vec::with_capacity(manifest.reference.len());
        for reference in &manifest.reference {
            common_references.push(resolve_reference(reference)?);
        }

        // Resolve one reviewer checklist item: its id, title, and text must all be
        // non-empty, since the id keys a recorded verdict, the title heads the item
        // in the reviewer UI, and the text is what the reviewer reads. Shared by the
        // common items and each variant's own.
        let resolve_review_item = |item: &ManifestReviewItem| -> Result<ReviewItem> {
            if item.id.trim().is_empty() {
                return Err(invalid("review_item `id` must not be empty".to_string()));
            }
            if item.title.trim().is_empty() {
                return Err(invalid(format!(
                    "review_item `{}` has empty `title`",
                    item.id
                )));
            }
            if item.text.trim().is_empty() {
                return Err(invalid(format!(
                    "review_item `{}` has empty `text`",
                    item.id
                )));
            }
            // The weight is the item's point value toward the score; a zero-weight
            // item could never affect the score, which is never intended, so it is
            // rejected rather than silently scored as nothing.
            if item.weight == 0 {
                return Err(invalid(format!(
                    "review_item `{}` must have a `weight` greater than zero",
                    item.id
                )));
            }
            // An item's domain, when declared, must name a domain the case
            // declares so its points roll up to a real per-domain score.
            if let Some(domain) = &item.domain
                && !domains.iter().any(|resolved| &resolved.id == domain)
            {
                return Err(invalid(format!(
                    "review_item `{}` names domain `{}`, which is not declared",
                    item.id, domain
                )));
            }
            Ok(ReviewItem {
                id: item.id.clone(),
                title: item.title.clone(),
                text: item.text.clone(),
                reference: item.reference.clone(),
                proof: item.proof.clone(),
                weight: item.weight,
                domain: item.domain.clone(),
            })
        };

        let mut common_review_items = Vec::with_capacity(manifest.review_items.len());
        for item in &manifest.review_items {
            common_review_items.push(resolve_review_item(item)?);
        }

        let mut common_proofs = Vec::with_capacity(manifest.proof.len());
        for proof in &manifest.proof {
            common_proofs.push(resolve_proof(proof)?);
        }

        // A case must offer at least one variant; a run always selects exactly
        // one. Variant slugs must be unique so a run records an unambiguous
        // choice.
        if manifest.variant.is_empty() {
            return Err(invalid(
                "at least one [[variant]] must be declared".to_string(),
            ));
        }
        let mut variants: Vec<Variant> = Vec::with_capacity(manifest.variant.len());
        for variant in &manifest.variant {
            if variants
                .iter()
                .any(|resolved| resolved.slug == variant.slug)
            {
                return Err(invalid(format!(
                    "duplicate variant slug `{}`",
                    variant.slug
                )));
            }
            let mut specs = Vec::with_capacity(variant.specs.len());
            for spec in &variant.specs {
                specs.push(resolve_spec(spec)?);
            }
            // A variant's workspace, when declared, replaces the common workspace
            // for this variant rather than layering on top of it.
            let workspace = match &variant.workspace {
                Some(dir) => Some(resolve_workspace(dir, "variant workspace")?),
                None => None,
            };

            let mut references = Vec::with_capacity(variant.references.len());
            for reference in &variant.references {
                references.push(resolve_reference(reference)?);
            }

            let mut proofs = Vec::with_capacity(variant.proofs.len());
            for proof in &variant.proofs {
                proofs.push(resolve_proof(proof)?);
            }
            // The common proofs and the variant's own are recorded under one id
            // each; two proofs sharing an id would make a recorded result
            // ambiguous, so a collision is rejected.
            let mut seen_proof_ids = std::collections::BTreeSet::new();
            for proof in common_proofs.iter().chain(proofs.iter()) {
                if !seen_proof_ids.insert(&proof.id) {
                    return Err(invalid(format!(
                        "variant `{}` declares two proofs with the same id `{}`",
                        variant.slug, proof.id
                    )));
                }
            }

            // The common references and the variant's own are rendered and seeded
            // together under one view slug each; two references sharing a view
            // would clobber each other (a view is either common or owned by this
            // variant, never both), so a collision is rejected.
            let mut seen_views = std::collections::BTreeSet::new();
            for reference in common_references.iter().chain(references.iter()) {
                if !seen_views.insert(&reference.view) {
                    return Err(invalid(format!(
                        "variant `{}` declares two references for the same view `{}`",
                        variant.slug, reference.view
                    )));
                }
            }

            // The workspace files, the common and variant specs, the assets, and
            // the rendered reference screenshots are all seeded into the one run
            // tree. Two of them landing on the same dest would clobber each other,
            // so any collision across them — for example a workspace that ships a
            // file at a spec's `dest` — is rejected here rather than silently
            // resolved at seed time. The effective workspace is the variant's own
            // when it overrides, otherwise the case's common workspace.
            let workspace_files = workspace.as_deref().unwrap_or(&common_workspace);
            let mut seeded_dests: std::collections::BTreeMap<PathBuf, &'static str> =
                std::collections::BTreeMap::new();
            let mut claim = |dest: PathBuf, kind: &'static str| -> Result<()> {
                if let Some(prev) = seeded_dests.insert(dest.clone(), kind) {
                    return Err(invalid(format!(
                        "variant `{}` seeds two entries ({prev} and {kind}) to the same dest `{}`",
                        variant.slug,
                        dest.display()
                    )));
                }
                Ok(())
            };
            for file in workspace_files {
                claim(file.dest.clone(), "workspace")?;
            }
            for spec in common_specs.iter().chain(specs.iter()) {
                claim(spec.dest.clone(), "spec")?;
            }
            for dest in &asset_dests {
                claim(dest.clone(), "asset")?;
            }
            // The reference media seeds under `reference/<view>.<ext>` (a rendered
            // mockup is a `.png`; a static reference keeps its own extension), with
            // a `reference/README.md` notice alongside them when any are present.
            for reference in common_references.iter().chain(references.iter()) {
                claim(
                    Path::new("reference").join(format!(
                        "{}.{}",
                        reference.view,
                        reference.extension()
                    )),
                    "reference",
                )?;
            }
            if !common_references.is_empty() || !references.is_empty() {
                claim(Path::new("reference").join("README.md"), "reference")?;
            }
            // A proof is produced by the agent at its `dest`, not seeded; but a
            // proof dest that collides with a seeded file would have the agent and
            // the seeder fight over the same path, so reject the collision here.
            for proof in common_proofs.iter().chain(proofs.iter()) {
                claim(proof.dest.clone(), "proof")?;
            }

            let mut review_items = Vec::with_capacity(variant.review_items.len());
            for item in &variant.review_items {
                review_items.push(resolve_review_item(item)?);
            }
            // The common items and the variant's own are recorded under one id
            // each; two items sharing an id would make a recorded verdict
            // ambiguous, so a collision is rejected.
            let mut seen_ids = std::collections::BTreeSet::new();
            for item in common_review_items.iter().chain(review_items.iter()) {
                if !seen_ids.insert(&item.id) {
                    return Err(invalid(format!(
                        "variant `{}` declares two review items with the same id `{}`",
                        variant.slug, item.id
                    )));
                }
            }

            // A review item may pair an expected reference and a submitted proof
            // with its checklist entry; both must resolve for this variant so the
            // reviewer UI can always show them whichever variant runs.
            for item in common_review_items.iter().chain(review_items.iter()) {
                if let Some(reference) = &item.reference
                    && !common_references
                        .iter()
                        .chain(references.iter())
                        .any(|r| &r.view == reference)
                {
                    return Err(invalid(format!(
                        "review item `{}` references reference view `{}`, which variant `{}` does not declare",
                        item.id, reference, variant.slug
                    )));
                }
                if let Some(proof) = &item.proof
                    && !common_proofs
                        .iter()
                        .chain(proofs.iter())
                        .any(|p| &p.id == proof)
                {
                    return Err(invalid(format!(
                        "review item `{}` references proof `{}`, which variant `{}` does not declare",
                        item.id, proof, variant.slug
                    )));
                }
            }

            let name = variant
                .name
                .clone()
                .unwrap_or_else(|| humanize(&variant.slug));
            variants.push(Variant {
                slug: variant.slug.clone(),
                name,
                description: variant.description.clone(),
                specs,
                workspace,
                references,
                proofs,
                review_items,
            });
        }

        // Every check must name a reference view that resolves for **every**
        // variant — either a common reference or one each variant declares — so
        // its baseline can always be rendered whichever variant runs. This keeps
        // validation declarations honest across variant-specific references.
        let mut checks = Vec::with_capacity(manifest.check.len());
        for check in &manifest.check {
            let reference_view = check
                .reference
                .clone()
                .unwrap_or_else(|| check.view.clone());
            let common = common_references.iter().any(|r| r.view == reference_view);
            if let Some(missing) = variants.iter().find(|variant| {
                !common && !variant.references.iter().any(|r| r.view == reference_view)
            }) {
                return Err(invalid(format!(
                    "check `{}` references reference view `{}`, which variant `{}` does not declare",
                    check.view, reference_view, missing.slug
                )));
            }
            let name = check.name.clone().unwrap_or_else(|| humanize(&check.view));
            checks.push(Check {
                view: check.view.clone(),
                name,
                reference_view,
                actions: check.actions.clone(),
            });
        }

        Ok(TestCaseVersion {
            slug: slug.to_string(),
            version: version.to_string(),
            name: manifest.name,
            difficulty: manifest.difficulty,
            tags: manifest.tags,
            summary: manifest.summary,
            description_path,
            root,
            prompt_path,
            max_runtime_seconds: manifest.max_runtime_seconds,
            build: BuildCommands {
                install: build.install,
                build: build.build,
            },
            common_specs,
            common_workspace,
            init: manifest.init,
            asset_paths,
            variants,
            common_references,
            common_proofs,
            checks,
            common_review_items,
            domains,
        })
    }

    /// Resolve the latest version of a slug.
    pub fn resolve_latest(&self, slug: &str) -> Result<TestCaseVersion> {
        let version = self.versions(slug)?.into_iter().next().ok_or_else(|| {
            Error::TestCaseVersionNotFound {
                slug: slug.to_string(),
                version: "latest".to_string(),
            }
        })?;
        self.resolve(slug, &version)
    }

    /// Read and parse a version's `test-case.toml` manifest.
    fn read_manifest(&self, slug: &str, version: &str, root: &Path) -> Result<Manifest> {
        let manifest_path = root.join(MANIFEST_FILE);
        let raw = fs::read_to_string(&manifest_path).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("could not read {MANIFEST_FILE}: {err}"),
        })?;
        toml::from_str(&raw).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("invalid {MANIFEST_FILE}: {err}"),
        })
    }
}

/// Read the immediate subdirectory names of a directory, ignoring files and
/// hidden entries.
fn read_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str()
            && !name.starts_with('.')
        {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

/// A comparable key for a version string so versions order component-wise.
///
/// Leading `v` is ignored and dot-separated numeric components are compared
/// numerically; any non-numeric tail is ignored for ordering. Versions that do
/// not parse sort before those that do.
fn version_key(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

/// The default maximum harness runtime, in seconds, applied when a manifest
/// omits `max_runtime_seconds`.
///
/// One hour is a generous ceiling for even the hard cases: it exists to stop a
/// stuck or runaway session from running forever, not to pace a healthy run. A
/// case that needs a tighter or looser bound declares its own value, and any run
/// can override it per invocation.
fn default_max_runtime_seconds() -> u64 {
    3600
}

/// Recursively enumerate the files under a workspace directory into
/// [`WorkspaceFile`]s, computing each file's `dest` as its path relative to
/// `base` (the workspace directory's root). Directories are descended into;
/// only files become entries, so an empty directory contributes nothing.
///
/// Hidden entries (names beginning with `.`) are skipped, matching how the
/// backend copies a version folder into its store: a dotfile would be listed
/// here but never distributed, so a backend-driven run would fail to fetch it.
/// Keeping the two in lockstep means a workspace seeds the same set locally and
/// remotely.
/// Render a relative path with forward slashes so a workspace file's dest is
/// stable across hosts (a Windows `\` separator would otherwise leak into the
/// run-relative dest and the serialized manifest).
fn forward_slash_path(rel: &Path) -> PathBuf {
    PathBuf::from(
        rel.components()
            .filter_map(|component| component.as_os_str().to_str())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

fn collect_workspace_files(
    base: &Path,
    dir: &Path,
    out: &mut Vec<WorkspaceFile>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_workspace_files(base, &path, out)?;
        } else {
            // Normalize the dest to forward slashes so the seeded path — and the
            // serialized manifest — are stable regardless of the host that
            // resolved the workspace; otherwise a Windows host's `\` separator
            // would leak into the run-relative dest.
            let dest = path
                .strip_prefix(base)
                .map(forward_slash_path)
                .unwrap_or_else(|_| path.clone());
            out.push(WorkspaceFile {
                source_path: path,
                dest,
            });
        }
    }
    Ok(())
}

/// Humanize a slug into a display name by splitting on `-`/`_` and capitalizing
/// each word (for example `game-over` becomes `Game Over`).
fn humanize(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether a relative path would escape the folder it is resolved against.
///
/// A path escapes if it is absolute, or if its `..` components ever rise above
/// its starting point. `.` components are ignored.
fn escapes_folder(rel: &Path) -> bool {
    use std::path::Component;

    let mut depth: i32 = 0;
    for component in rel.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => return true,
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return true;
                }
            }
            Component::CurDir => {}
            Component::Normal(_) => depth += 1,
        }
    }
    false
}

#[cfg(test)]
#[path = "test_case.test.rs"]
mod tests;
