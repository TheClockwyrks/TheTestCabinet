//! The clone detector: one hash pass over normalised code lines.
//!
//! This answers "did the model abstract, or copy-paste the enemy AI five times?", and **no
//! other metric here catches it** — a tree of five near-identical files scores well on
//! every size, complexity and graph figure there is.
//!
//! # Why lines and not trees
//!
//! A token- or tree-based detector would catch renamed clones the line detector misses, at
//! the cost of a second traversal per language and a similarity threshold to tune. The
//! shape this corpus produces is *verbatim* duplication — a model pastes a block and edits
//! a constant — so a normalised line window finds it, costs one hash pass, and means the
//! same thing in both languages without either front end being involved.
//!
//! # Determinism
//!
//! Windows are hashed with SHA-256 rather than `DefaultHasher`, whose value is explicitly
//! not stable across releases or platforms — and the whole analysis claims to be a pure
//! function of the tree's bytes. Groups are then visited in hash order and instances in
//! (file, line) order, so the same tree yields the same groups, in the same order, with the
//! same lines attributed to each.

use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};

/// Consecutive code lines that must match before a run counts as a clone.
///
/// Six is long enough that a shared idiom — a guard clause, a loop header, a closing brace
/// run — does not register, and short enough to catch a pasted function body. Changing it
/// changes what "duplication" means, so it is a definition change and needs an analyzer
/// version bump.
pub const WINDOW_LINES: usize = 6;

/// The least normalised text a window must hold before it can be a clone.
///
/// Without it, six lines of `}` in two files are a clone group, which is true and useless.
const MIN_WINDOW_CHARS: usize = 60;

/// One file's lines, as the detector reads them.
pub struct CloneInput<'a> {
    /// Index of the file in the caller's own list, carried through to the result.
    pub file: usize,
    /// The file's text.
    pub source: &'a str,
}

/// One occurrence of a clone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CloneInstance {
    /// The caller's file index.
    pub file: usize,
    /// 1-based line the clone starts on, in the file's own numbering.
    pub line: u32,
}

/// One group of identical normalised runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloneGroup {
    /// Lines in each instance.
    pub lines: u32,
    /// Where it occurs, at least twice, in (file, line) order.
    pub instances: Vec<CloneInstance>,
}

/// What one pass over a tree found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Clones {
    /// Every group, in a deterministic order.
    pub groups: Vec<CloneGroup>,
    /// Code lines covered by at least one instance.
    pub cloned_lines: u32,
    /// Lines in the largest single group.
    pub largest_clone_lines: u32,
}

/// One code line, kept with the line number it came from.
struct NormalizedLine {
    number: u32,
    text: String,
}

/// Find the clone groups across `files`.
pub fn detect(files: &[CloneInput<'_>]) -> Clones {
    let normalized: Vec<Vec<NormalizedLine>> =
        files.iter().map(|file| normalize(file.source)).collect();

    // hash of a window → every place it starts, and the same starts in position order.
    let mut windows: BTreeMap<String, Vec<(usize, usize)>> = BTreeMap::new();
    let mut order: Vec<(usize, usize, String)> = Vec::new();
    for (position, lines) in normalized.iter().enumerate() {
        if lines.len() < WINDOW_LINES {
            continue;
        }
        for start in 0..=lines.len() - WINDOW_LINES {
            let window = &lines[start..start + WINDOW_LINES];
            let content: usize = window.iter().map(|line| line.text.len()).sum();
            if content < MIN_WINDOW_CHARS {
                continue;
            }
            let hash = hash_window(window);
            windows
                .entry(hash.clone())
                .or_default()
                .push((files[position].file, start));
            order.push((files[position].file, start, hash));
        }
    }
    // Groups are claimed in **position** order, not hash order. Greedy left-to-right is what
    // makes a forty-line pasted block one forty-line group: whichever window happened to
    // hash first would otherwise claim the middle of the run and leave the head and tail to
    // be reported as further, overlapping groups.
    order.sort_unstable();

    // Which (file, normalised-line-offset) pairs are already attributed, so a run that
    // extends past a window is not also reported as its own overlapping group.
    let mut claimed: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut clones = Clones::default();
    let by_position: BTreeMap<usize, usize> = files
        .iter()
        .enumerate()
        .map(|(position, file)| (file.file, position))
        .collect();

    for (file, start, hash) in &order {
        if claimed.contains(&(*file, *start)) {
            continue;
        }
        let mut instances: Vec<(usize, usize)> = windows[hash]
            .iter()
            .copied()
            .filter(|(file, start)| !claimed.contains(&(*file, *start)))
            .collect();
        instances.sort_unstable();
        instances.dedup();
        if instances.len() < 2 {
            continue;
        }
        // Grow the match while every instance still agrees, so a forty-line pasted function
        // is one forty-line group rather than thirty-five six-line ones.
        let mut length = WINDOW_LINES;
        loop {
            let next: Vec<Option<&str>> = instances
                .iter()
                .map(|(file, start)| {
                    let lines = &normalized[by_position[file]];
                    lines.get(start + length).map(|line| line.text.as_str())
                })
                .collect();
            let Some(Some(first)) = next.first().copied() else {
                break;
            };
            if !next.iter().all(|line| *line == Some(first)) {
                break;
            }
            // An already-claimed line belongs to an earlier group; running over it would
            // attribute the same line to two clones and inflate the covered total.
            if instances
                .iter()
                .any(|(file, start)| claimed.contains(&(*file, start + length)))
            {
                break;
            }
            // Two instances that have caught up with each other inside one file would
            // otherwise extend forever over a repeating block.
            if overlapping(&instances, length + 1) {
                break;
            }
            length += 1;
        }
        for (file, start) in &instances {
            for offset in 0..length {
                claimed.insert((*file, start + offset));
            }
        }
        clones.largest_clone_lines = clones.largest_clone_lines.max(length as u32);
        clones.groups.push(CloneGroup {
            lines: length as u32,
            instances: instances
                .iter()
                .map(|(file, start)| CloneInstance {
                    file: *file,
                    line: normalized[by_position[file]][*start].number,
                })
                .collect(),
        });
    }

    clones.cloned_lines = claimed.len() as u32;
    clones
}

/// Whether any two instances in the same file would overlap at `length` lines.
fn overlapping(instances: &[(usize, usize)], length: usize) -> bool {
    instances.windows(2).any(|pair| {
        let (left_file, left_start) = pair[0];
        let (right_file, right_start) = pair[1];
        left_file == right_file && right_start < left_start + length
    })
}

/// Reduce a file to the code lines a clone can be made of.
///
/// Blank lines and whole-line comments are dropped, and each remaining line has its
/// internal whitespace collapsed — so a pasted block that was reindented, or reformatted
/// across a line break in its argument list, still matches. Identifiers and literals are
/// **not** normalised: a clone whose variables were renamed is a different question
/// ("similar code") from the one this metric asks ("the same code, twice").
fn normalize(source: &str) -> Vec<NormalizedLine> {
    source
        .lines()
        .enumerate()
        .filter_map(|(offset, line)| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed.starts_with("//")
                || trimmed.starts_with('#')
                || trimmed.starts_with('*')
                || trimmed.starts_with("/*")
            {
                return None;
            }
            Some(NormalizedLine {
                number: offset as u32 + 1,
                text: trimmed.split_whitespace().collect::<Vec<_>>().join(" "),
            })
        })
        .collect()
}

/// The content address of one window.
fn hash_window(window: &[NormalizedLine]) -> String {
    let mut digest = Sha256::new();
    for line in window {
        digest.update(line.text.as_bytes());
        digest.update(*b"\n");
    }
    hex(&digest.finalize())
}

/// Lowercase hex, without pulling in a dependency for sixteen characters.
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[cfg(test)]
#[path = "clones.test.rs"]
mod tests;
