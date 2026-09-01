//! The walk: which files of a produced tree the analysis will look at, and which the floor
//! removes.
//!
//! # The ignore files decide, not a hardcoded list
//!
//! The walk honours **`.gitignore`**, `.git/info/exclude` and nested ignore files rather
//! than a list of output directory names. A hardcoded list is both too narrow — a
//! model-configured output directory, a framework cache nobody anticipated — and
//! unnecessary, because a case's own ignore file already declares where its build output
//! goes.
//!
//! This stays deterministic because the ignore files are **content of the tree being
//! measured**. Two host-dependent sources are therefore switched off explicitly: a global
//! `core.excludesFile` and any `.gitignore` in a *parent* of the tree are machine state,
//! and honouring either would make the same tree measure differently on two hosts.
//!
//! A free consequence: gg's session-capture journal is excluded at seed time through
//! `.git/info/exclude`, so it can never pollute a code analysis. No coordination between
//! the two features was needed.
//!
//! # The floor, and the one deliberate reversal
//!
//! A hardcoded floor applies on top, and **everything it removes is counted**, never
//! silently dropped: dependency and vendored trees, the build-output directory names the
//! validator itself looks for (read from
//! [`BUILD_OUTPUTS`](test_cabinet_core::validator::BUILD_OUTPUTS), so the two lists cannot
//! diverge), minified and generated files, binaries, and files too large to read.
//!
//! Two of the floor's entries are matched **only at the tree root**, and one of those two is
//! matched only when the caller says the host actually wrote it.
//!
//! `.tcab/` is the directory The Test Cabinet writes its own material into. The host owns
//! that name outright, so it is floored at the root of every tree, unconditionally.
//!
//! `engine/` is not that. It is where an engine's documentation is seeded — but only on a run
//! whose engine *has* documentation to seed, and the same path on any other run holds the
//! model's own code: a `none`-engine build that organises its frame loop as `engine/loop.ts`,
//! or a case whose workspace seeds a skeleton the model is told to fill in at
//! `engine/src/lib.rs`. The tree cannot tell the two apart — the seed commit is made *after*
//! the documentation is copied, so a seeded `engine/` and a case's own `engine/` are
//! identical in it — so the walk does not guess. [`RootSeeding`] carries the answer from the
//! caller, which resolved the engine, and `engine/` is floored only when that answer is yes.
//! Getting this wrong in the other direction is not a rounding error: it deletes the whole of
//! a model's submission from every figure on the page.
//!
//! Neither can be floored the way `node_modules` is, by name at any depth, because a model's
//! own `src/engine/` is exactly the directory a build writing its own frame loop creates.
//!
//! One entry in that floor is reversed on purpose, and it lives in
//! [`caps`](crate::caps) rather than here: a file too large to **parse** is still
//! **counted for size**. A 300 KB god-file is precisely the interesting case; dropping it
//! entirely would bias every size metric against the worst outcomes.

use std::path::Path;

use test_cabinet_core::CodeLanguage;

/// The largest file the walk will read at all.
///
/// Above this the file is floored: it is not source in any language the analysis parses,
/// reading it would dominate the walk, and its bytes are still reported under the skipped
/// total. Distinct from [`MAX_PARSED_FILE_BYTES`](crate::caps::MAX_PARSED_FILE_BYTES),
/// which governs *parsing* a file the walk has already accepted.
pub const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;

/// What the analysis will do with a file it kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileRole {
    /// Parsed by a front end.
    Source(CodeLanguage),
    /// Scanned for `<script src>` entry points.
    ///
    /// HTML gets one extra pass because every end-to-end case is a bundler project whose
    /// real entry point is named from HTML and is otherwise invisible to an import walk —
    /// without it the whole application reads as orphaned.
    Html,
    /// Read as a package manifest, to discover crate roots and name external packages.
    ///
    /// Manifests are parsed **directly**, never by shelling out to the package manager,
    /// which resolves the dependency graph and therefore needs the registry.
    Manifest,
    /// Counted for size only: JSON, Markdown, CSS, shaders, and everything else.
    Data,
}

/// One file the walk kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalkedFile {
    /// Path relative to the tree root, with `/` separators on every platform so a
    /// document is identical wherever it was produced.
    pub path: String,
    /// Bytes on disk.
    pub bytes: u64,
    /// What the analysis will do with it.
    pub role: FileRole,
}

/// What one walk of a tree found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Walk {
    /// Kept files, **sorted by path**. The sort is what makes a cap deterministic: which
    /// files a budget drops is then a function of the tree, not of directory order.
    pub files: Vec<WalkedFile>,
    /// Whether any ignore file was in play. Recorded because an over-broad `.gitignore`
    /// shrinks the measured tree and the model owns that file — this is what makes an
    /// implausibly small measurement explicable rather than mysterious.
    pub gitignore_applied: bool,
    /// Files the floor removed.
    pub skipped_files: u32,
    /// Bytes those files held.
    pub skipped_bytes: u64,
    /// Whether [`MAX_FILES`](crate::caps::MAX_FILES) truncated the file list.
    pub truncated: bool,
}

/// Directory names removed wherever they appear in a path.
///
/// Dependency and vendored trees, package-manager caches, and framework build caches. The
/// build-output names themselves are **not** here — they come from the validator's own
/// list, so a fourth output directory added there is removed here without a second edit.
///
/// `.gg` is belt to the braces of gg's seed-time `.git/info/exclude` entry, which is the
/// mechanism session capture leans on. Either alone excludes the journal; both together
/// mean it is excluded from a tree whose `.git` did not survive collection as well.
const VENDOR_DIRS: [&str; 15] = [
    "node_modules",
    ".git",
    ".gg",
    "target",
    "vendor",
    "bower_components",
    ".yarn",
    ".pnpm-store",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
];

/// The first path segment of `path` — for a repo-relative path constant, its top-level
/// directory.
///
/// `const` on purpose, so [`HOST_ROOT_DIR`] can be *derived* from the core crate's own path
/// constants instead of restating them as literals. The constants name children —
/// `.tcab/engine`, `.tcab/packages` — and what the floor wants is the parent they share.
const fn root_segment(path: &str) -> &str {
    let bytes = path.as_bytes();
    let mut end = 0;
    while end < bytes.len() && bytes[end] != b'/' {
        end += 1;
    }
    let (first, _) = path.split_at(end);
    first
}

/// The directory The Test Cabinet writes its own material into, removed **only when it is the
/// tree's own top-level directory**.
///
/// `.tcab/` is a namespace the host owns end to end: the vendored engine runtime
/// ([`TCAB_ENGINE_DIR`](test_cabinet_core::test_case::TCAB_ENGINE_DIR)), the case's vendored
/// packages ([`TCAB_VENDOR_DIR`](test_cabinet_core::test_case::TCAB_VENDOR_DIR)) and the
/// host-written validation media beside them. Counting any of it as authored code credits the
/// model with lines it did not write. It is floored **wholesale** rather than child by child
/// precisely because the namespace is the host's: a fourth child written into it later must
/// not need a second edit here to stay out of the authored set. Derived from the core crate's
/// own constants, so the name cannot be changed on one side only.
///
/// This also replaces an accident. Before the root-anchored floor existed the engine runtime
/// was dropped only because it happens to ship under a directory called `dist`, which is in
/// the validator's build-output names — a coincidence that would have stopped holding the
/// moment an engine shipped its runtime anywhere else.
///
/// **The anchoring is the whole point and is not an optimisation.** [`VENDOR_DIRS`] matches a
/// name at any depth, which is right for `node_modules` and wrong here: a `.tcab` below the
/// root is not the host's, and only the tree's own first path segment is tested.
const HOST_ROOT_DIR: &str = root_segment(test_cabinet_core::test_case::TCAB_ENGINE_DIR);

/// What the host wrote into this tree's root, which the tree itself cannot say.
///
/// One question so far, and it is the one that decides whether a whole directory of a run
/// counts as the model's work. Every field defaults to *the host wrote nothing*, because that
/// is the only safe default: over-counting host-written markdown makes a size figure a little
/// large and leaves the authored-set ladder to catch it, while over-flooring removes the
/// model's own code from `files`, `codeLines`, the complexity figures, the symbol table and
/// the treemap, and reports the remainder as if it were the whole build.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RootSeeding {
    /// Whether this run's engine copied its own documentation to
    /// [`ENGINE_DOCS_DIR`](test_cabinet_core::execution::ENGINE_DOCS_DIR) at the tree root —
    /// [`ResolvedEngine::seeds_docs`](test_cabinet_core::ResolvedEngine::seeds_docs).
    ///
    /// True floors `engine/` at the root: the engine documents itself in markdown large
    /// enough to move a size figure on its own, and no line of it was written in the run.
    ///
    /// False keeps it, and keeping it is not a concession. On a
    /// [`NONE_SLUG`](test_cabinet_core::engine::NONE_SLUG) run nothing is seeded there at all,
    /// so a root `engine/` is by construction the model's; and a case may seed its own
    /// skeleton there and tell the build that filling it in is the whole task, in which case
    /// flooring the name would report a finished submission as an empty tree.
    pub engine_docs: bool,
}

/// File names removed outright: machine-written dependency resolutions, not authored code.
const LOCKFILES: [&str; 5] = [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
];

/// Extensions whose contents are not text the analysis has anything to say about.
const BINARY_EXTENSIONS: [&str; 25] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "mp3", "wav", "ogg", "flac", "mp4",
    "webm", "mov", "ttf", "otf", "woff", "woff2", "zip", "gz", "tar", "wasm", "pdf", "glb",
];

/// Walk `root`, honouring its ignore files, and return the kept files in sorted order.
///
/// `seeding` says what the host wrote into the tree's own root, which the tree cannot say
/// for itself; see [`RootSeeding`]. A caller that does not know passes
/// [`RootSeeding::default`], which floors nothing it is unsure of.
///
/// Reading repository metadata is not "executing the produced code": nothing here runs a
/// build, a script, or a package manager.
pub fn walk(root: &Path, seeding: RootSeeding) -> Walk {
    let mut kept = Vec::new();
    let mut walk = Walk::default();

    let mut builder = ignore::WalkBuilder::new(root);
    builder
        // Ignore files that are content of the tree: its `.gitignore`s, nested and all,
        // and `.git/info/exclude`.
        .git_ignore(true)
        .git_exclude(true)
        // ...and nothing that is content of the *host*. A global `core.excludesFile` and a
        // `.gitignore` above the tree would both make the same bytes measure differently
        // on two machines, which is exactly what the determinism claim forbids.
        .git_global(false)
        .parents(false)
        // Non-git `.ignore` files are honoured for the same reason the `.gitignore`s are:
        // they are in the tree. `require_git(false)` keeps all of this working for a tree
        // whose `.git` did not survive collection.
        .ignore(true)
        .require_git(false)
        // Dotfiles are **not** skipped: `.gitignore`, `.eslintrc.json` and `.env.example`
        // are files the model wrote, and excluding them would quietly shrink the measured
        // tree. The dot-directories that must not be measured are named in the floor
        // instead, where they are counted rather than invisible — and `.git` is pruned
        // outright below, because descending it to floor a thousand object files one at a
        // time would dominate the walk.
        .hidden(false)
        .follow_links(false)
        // One thread: the walk is not the expensive part, and a parallel walk would hand
        // back files in a nondeterministic order that the sort below would only have to
        // undo.
        .threads(1);
    builder.filter_entry(|entry| entry.file_name() != std::ffi::OsStr::new(".git"));

    for entry in builder.build() {
        let Ok(entry) = entry else { continue };
        if entry.file_type().is_none_or(|kind| !kind.is_file()) {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let path = relative_path(relative);
        let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if floored(&path, bytes, seeding) {
            walk.skipped_files += 1;
            walk.skipped_bytes += bytes;
            continue;
        }
        kept.push(WalkedFile {
            role: role_of(&path),
            path,
            bytes,
        });
    }

    walk.gitignore_applied = ignore_files_present(root);
    kept.sort_by(|left, right| left.path.cmp(&right.path));
    if kept.len() > crate::caps::MAX_FILES {
        kept.truncate(crate::caps::MAX_FILES);
        walk.truncated = true;
    }
    walk.files = kept;
    walk
}

/// Render a relative path with `/` separators, so a document produced on Windows and one
/// produced on Linux are byte-identical.
fn relative_path(relative: &Path) -> String {
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Whether the hardcoded floor removes `path`.
///
/// Three directory tests, deliberately kept apart. [`VENDOR_DIRS`] and the validator's
/// build-output names match a *segment at any depth*, because a `node_modules` is a
/// `node_modules` wherever it sits. [`HOST_ROOT_DIR`] matches only the tree's own first
/// segment, because `.tcab` means "written here by the host" at the root and means the
/// model's own work anywhere else. And the engine documentation directory is matched at the
/// root *and* only when `seeding` says this run's engine put it there — the one test on this
/// floor that a name alone cannot answer.
///
/// Every path this returns `true` for is still counted into
/// [`Walk::skipped_files`]/[`Walk::skipped_bytes`] by the caller, so the provenance strip
/// keeps telling the truth about what was removed.
fn floored(path: &str, bytes: u64, seeding: RootSeeding) -> bool {
    if bytes > MAX_READ_BYTES {
        return true;
    }
    let segments: Vec<&str> = path.split('/').collect();
    let Some((name, dirs)) = segments.split_last() else {
        return true;
    };
    if dirs.iter().any(|dir| {
        VENDOR_DIRS.contains(dir) || test_cabinet_core::validator::BUILD_OUTPUTS.contains(dir)
    }) {
        return true;
    }
    // Root-anchored: `dirs` holds every segment but the file name, so `dirs.first()` is the
    // tree's own top-level directory — `None` for a root-level file, which is why `engine.ts`
    // beside `src/` is kept. `.tcab/` is the host's name at the root of any tree;
    // `engine/frame.md` is the host's only on a run that seeded engine documentation, and
    // `src/engine/loop.ts` is the model's on every run.
    if let Some(first) = dirs.first() {
        if *first == HOST_ROOT_DIR {
            return true;
        }
        if seeding.engine_docs && *first == test_cabinet_core::execution::ENGINE_DOCS_DIR {
            return true;
        }
    }
    if LOCKFILES.contains(name) {
        return true;
    }
    if name.ends_with(".min.js") || name.ends_with(".min.css") || name.ends_with(".map") {
        return true;
    }
    extension(name).is_some_and(|ext| BINARY_EXTENSIONS.contains(&ext.as_str()))
}

/// What the analysis will do with a kept file.
fn role_of(path: &str) -> FileRole {
    let name = path.rsplit('/').next().unwrap_or(path);
    if name == "Cargo.toml" || name == "package.json" {
        return FileRole::Manifest;
    }
    match extension(name).as_deref() {
        Some("ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs") => {
            FileRole::Source(CodeLanguage::TypeScript)
        }
        Some("rs") => FileRole::Source(CodeLanguage::Rust),
        Some("html" | "htm") => FileRole::Html,
        _ => FileRole::Data,
    }
}

/// The lowercase extension of `name`, if it has one.
///
/// Lowercased because a model that writes `Sprite.PNG` meant the same thing as `sprite.png`
/// and the floor should not depend on which.
fn extension(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() {
        return None;
    }
    Some(ext.to_ascii_lowercase())
}

/// Whether any ignore file the walk honours exists in the tree.
///
/// A shallow check on purpose: the question is whether ignore rules were *in play at all*,
/// which is what makes a small measurement explicable. Enumerating every nested
/// `.gitignore` would cost a second walk to sharpen a diagnostic.
fn ignore_files_present(root: &Path) -> bool {
    root.join(".gitignore").is_file()
        || root.join(".ignore").is_file()
        || root.join(".git").join("info").join("exclude").is_file()
}

#[cfg(test)]
#[path = "walk.test.rs"]
mod tests;
