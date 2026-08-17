//! **The documentation-example gate** — every program gg's own documentation shows a model is
//! compiled by the arm that page is about.
//!
//! # What it is for
//!
//! The pages under `apps/docs/src/content/docs/gg/` are authoritative over this crate, and several
//! of them teach by showing a program. Nothing read those programs. A page could name a call the
//! SDK does not declare, spell an argument the signature does not take, or omit the `import` the
//! [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) require of every
//! program, and the tree would stay green while the page taught something that cannot run.
//!
//! Two of those went unnoticed until this gate was written, and both were the same defect: the
//! pages describing gg's own synthesized programs
//! ([autoload](crate::agent), [persistence](crate::persistence::restore_file_views)) printed them
//! without the import line those programs really open with, so the one thing a reader would have
//! copied was the one thing the invariants forbid.
//!
//! # What it drives
//!
//! Each gathered block goes through its arm's **real** [preparation](ProgramLanguage::prepare_program)
//! — the same call a turn makes, so the real compiler reads it against the real SDK. Nothing is
//! prepended and nothing is appended, because that is the rule the block is being held to: a fenced
//! program in these pages is a whole program of its arm, and one that needs a line the page did not
//! print is a page that has not shown the program.
//!
//! A page wanting to show a fragment leaves the fence untagged, which is what an untagged fence
//! already means in these pages: the shape of something rather than a program.
//!
//! # What is gathered
//!
//! Fenced blocks in `apps/docs/src/content/docs/gg/`, recursively, whose info string opens with a
//! tag in [`ARMS`]. That table is the one place a spelling is written down, and
//! [`every_tag_is_one_its_arm_would_heal`] holds each entry to the arm's own
//! [healing dialect](crate::healing::Dialect::program_fence_tags), so a tag here cannot name a
//! block gg itself would not read as that language's program.
//!
//! The tree is `gg/` alone rather than all of `apps/docs`. A TypeScript block on the web console's
//! page is TypeScript about a React app, and compiling it against gg's SDK would report a defect
//! that is not one.
//!
//! # What it costs
//!
//! One preparation per gathered block, and the cost is the arm's: an interpreted arm's is free, and
//! a compiled arm's is one compiler invocation. Measured over the pages as they stand — nine
//! programs across three arms, one of them `swiftc` and one of them Roslyn — the whole gate is
//! **1.2 seconds**, which is why it drives the real preparation rather than resolving each name
//! against the arm's catalogue. Name resolution is the cheaper question and answers less of one: it
//! cannot see a missing import, a wrong argument label or a program that is not a program.

use std::path::{Path, PathBuf};

use test_cabinet_core::gg::GgProgramLanguage;

use super::compile::PrepareContext;
use super::{ProgramLanguage, language};

/// The documentation tree whose fenced programs this gate compiles, relative to this crate.
const DOCS: &str = "../../apps/docs/src/content/docs/gg";

/// The Markdown info-string tags a page writes a program under, and the arm each is compiled by.
///
/// The ECMAScript spellings all resolve to [TypeScript](GgProgramLanguage::TypeScript), which is the
/// only checker in that family: the JavaScript arm's preparation reads nothing, so routing a `js`
/// block there would gather it and check nothing about it. `tsc` accepts a JavaScript program that
/// declares no types, so a block written for either arm is read by the one that can judge it.
const ARMS: &[(&str, GgProgramLanguage)] = &[
    ("ts", GgProgramLanguage::TypeScript),
    ("typescript", GgProgramLanguage::TypeScript),
    ("js", GgProgramLanguage::TypeScript),
    ("javascript", GgProgramLanguage::TypeScript),
    ("python", GgProgramLanguage::Python),
    ("py", GgProgramLanguage::Python),
    ("ruby", GgProgramLanguage::Ruby),
    ("rb", GgProgramLanguage::Ruby),
    ("purescript", GgProgramLanguage::PureScript),
    ("purs", GgProgramLanguage::PureScript),
    ("java", GgProgramLanguage::Java),
    ("kotlin", GgProgramLanguage::Kotlin),
    ("kt", GgProgramLanguage::Kotlin),
    ("rust", GgProgramLanguage::Rust),
    ("rs", GgProgramLanguage::Rust),
    ("swift", GgProgramLanguage::Swift),
    ("cpp", GgProgramLanguage::Cpp),
    ("c++", GgProgramLanguage::Cpp),
    ("csharp", GgProgramLanguage::CSharp),
    ("cs", GgProgramLanguage::CSharp),
    ("c#", GgProgramLanguage::CSharp),
];

/// One fenced program a page shows, with where it came from so a failure names the page and the
/// line rather than the text.
#[derive(Debug, Clone)]
pub(super) struct Example {
    /// The page, relative to the documentation root, as a reader would cite it.
    page: String,
    /// The line the opening fence sits on, one-based, so an editor jumps to it.
    line: usize,
    /// The info-string tag the page wrote.
    tag: String,
    /// The arm [`ARMS`] resolved the tag to.
    arm: GgProgramLanguage,
    /// The block's body, exactly as the page carries it.
    source: String,
}

impl Example {
    /// Where this block is, as a failure cites it.
    fn cite(&self) -> String {
        format!("{}:{} (```{})", self.page, self.line, self.tag)
    }
}

/// The documentation root, resolved from this crate rather than from the working directory.
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(DOCS)
}

/// Every `.md` file under `directory`, recursively, in a stable order.
fn pages(directory: &Path, into: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("reading {}: {error}", directory.display()))
        .map(|entry| entry.expect("a directory entry").path())
        .collect();
    entries.sort();
    for entry in entries {
        if entry.is_dir() {
            pages(&entry, into);
        } else if entry.extension().is_some_and(|extension| extension == "md") {
            into.push(entry);
        }
    }
}

/// The fenced blocks of one page whose tag [`ARMS`] names.
///
/// Fences are read at the start of a line, three backticks or more, closed by a run of at least as
/// many — CommonMark's own rule, and the one that lets a block quoting a fence carry a longer one.
fn examples(page: &str, text: &str) -> Vec<Example> {
    let mut found = Vec::new();
    let mut lines = text.lines().enumerate();
    while let Some((index, line)) = lines.next() {
        let Some(rest) = line.strip_prefix("```") else {
            continue;
        };
        let extra = rest.len() - rest.trim_start_matches('`').len();
        let fence = 3 + extra;
        let info = rest[extra..].trim();
        let tag = info
            .split(|c: char| c.is_whitespace() || c == ',')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let arm = ARMS
            .iter()
            .find(|(spelling, _)| *spelling == tag)
            .map(|(_, arm)| *arm);
        let mut body = String::new();
        let mut closed = false;
        for (_, inner) in lines.by_ref() {
            if inner.starts_with(&"`".repeat(fence)) && inner.trim_end_matches('`').is_empty() {
                closed = true;
                break;
            }
            body.push_str(inner);
            body.push('\n');
        }
        assert!(closed, "{page}:{} opens a fence nothing closes", index + 1);
        if let Some(arm) = arm {
            found.push(Example {
                page: page.to_string(),
                line: index + 1,
                tag,
                arm,
                source: body,
            });
        }
    }
    found
}

/// Every fenced program the gg documentation shows, over every page.
pub(super) fn gathered() -> Vec<Example> {
    let root = root();
    let mut files = Vec::new();
    pages(&root, &mut files);
    let mut found = Vec::new();
    for file in files {
        let page = file
            .strip_prefix(&root)
            .expect("a page under the documentation root")
            .to_string_lossy()
            .into_owned();
        let text = std::fs::read_to_string(&file)
            .unwrap_or_else(|error| panic!("reading {}: {error}", file.display()));
        found.extend(examples(&page, &text));
    }
    found
}

/// Compile one example through its arm's real preparation, answering the diagnostic if it failed.
fn refused(example: &Example) -> Option<String> {
    let arm: &'static dyn ProgramLanguage = language(example.arm);
    match arm.prepare_program(&example.source, &[], &PrepareContext::new()) {
        Ok(_) => None,
        Err(failure) => Some(failure.to_string()),
    }
}

#[cfg(test)]
#[path = "docs.test.rs"]
mod tests;
