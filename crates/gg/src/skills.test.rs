//! Tests for skill parsing (front-matter strip), library loading, and the runtime's
//! read-tracking / prompt / telemetry derivations.

use std::sync::Arc;

use tempfile::TempDir;
use test_cabinet_core::gg::GgTelemetryKind;

use super::*;

/// Write `contents` to `dir/name` and return nothing (a small fixture helper).
fn write(dir: &std::path::Path, name: &str, contents: &str) {
    std::fs::write(dir.join(name), contents).unwrap();
}

// ---------------------------------------------------------------------------
// Front-matter parsing / body stripping
// ---------------------------------------------------------------------------

#[test]
fn parse_strips_front_matter_and_extracts_fields() {
    let raw = "---\nname: platformer\ndescription: How to build a simple platformer.\n---\n\n# Platformer\n\nBody line one.\nBody line two.\n";
    let skill = parse_skill(raw, "fallback");
    assert_eq!(skill.name(), "platformer");
    assert_eq!(skill.description(), "How to build a simple platformer.");
    // The front matter is gone; the body is exactly the markdown after it (trimmed).
    assert_eq!(
        skill.body(),
        "# Platformer\n\nBody line one.\nBody line two."
    );
    assert!(!skill.body().contains("name:"));
    assert!(!skill.body().contains("---"));
}

#[test]
fn parse_falls_back_without_front_matter() {
    // No leading `---` fence: the whole file is the body, and the fallback names it.
    let raw = "# Just markdown\n\nNo front matter here.";
    let skill = parse_skill(raw, "my-file");
    assert_eq!(skill.name(), "my-file");
    assert_eq!(skill.description(), "(no description provided)");
    assert_eq!(skill.body(), "# Just markdown\n\nNo front matter here.");
}

#[test]
fn parse_tolerates_quotes_and_bom_and_ignores_other_keys() {
    let raw = "\u{feff}---\nname: \"quoted-name\"\ntitle: ignored\ndescription: 'single quoted'\n---\nbody";
    let skill = parse_skill(raw, "fallback");
    assert_eq!(skill.name(), "quoted-name");
    assert_eq!(skill.description(), "single quoted");
    assert_eq!(skill.body(), "body");
}

#[test]
fn parse_unclosed_front_matter_is_all_body() {
    // An opening fence with no closing fence is not front matter; treat it all as body.
    let raw = "---\nname: never-closed\n\nsome body without a closing fence\n";
    let skill = parse_skill(raw, "fallback");
    assert_eq!(skill.name(), "fallback");
    assert!(skill.body().contains("name: never-closed"));
}

#[test]
fn parse_empty_front_matter_field_falls_back() {
    let raw = "---\nname:\ndescription:\n---\nbody";
    let skill = parse_skill(raw, "fallback");
    assert_eq!(skill.name(), "fallback");
    assert_eq!(skill.description(), "(no description provided)");
}

// ---------------------------------------------------------------------------
// Library loading
// ---------------------------------------------------------------------------

#[test]
fn load_missing_directory_is_empty() {
    let dir = TempDir::new().unwrap();
    let library = SkillLibrary::load(&dir.path().join("does-not-exist"));
    assert!(library.is_empty());
    assert_eq!(library.len(), 0);
}

#[test]
fn load_reads_md_files_in_name_order_ignoring_non_md() {
    let dir = TempDir::new().unwrap();
    write(
        dir.path(),
        "zeta.md",
        "---\nname: zeta\ndescription: last alphabetically.\n---\nz body",
    );
    write(
        dir.path(),
        "alpha.md",
        "---\nname: alpha\ndescription: first alphabetically.\n---\na body",
    );
    // A non-markdown file is ignored.
    write(dir.path(), "notes.txt", "not a skill");

    let library = SkillLibrary::load(dir.path());
    assert_eq!(library.len(), 2);
    // Ordered by skill name.
    assert_eq!(library.skills()[0].name(), "alpha");
    assert_eq!(library.skills()[1].name(), "zeta");
    assert_eq!(library.get("alpha").unwrap().body(), "a body");
    assert!(library.get("notes").is_none());
}

#[test]
fn load_dedups_by_name_keeping_the_first_file() {
    let dir = TempDir::new().unwrap();
    // Two files declare the same skill name; the path-sorted first wins.
    write(
        dir.path(),
        "01-first.md",
        "---\nname: dup\ndescription: the first.\n---\nfirst body",
    );
    write(
        dir.path(),
        "02-second.md",
        "---\nname: dup\ndescription: the second.\n---\nsecond body",
    );

    let library = SkillLibrary::load(dir.path());
    assert_eq!(library.len(), 1);
    assert_eq!(library.get("dup").unwrap().body(), "first body");
}

// ---------------------------------------------------------------------------
// The runtime: read-tracking, prompt, telemetry
// ---------------------------------------------------------------------------

/// A runtime over a library with two skills, `a` and `b`.
fn two_skill_runtime() -> SkillsRuntime {
    let dir = TempDir::new().unwrap();
    write(
        dir.path(),
        "a.md",
        "---\nname: a\ndescription: does a.\n---\nbody a",
    );
    write(
        dir.path(),
        "b.md",
        "---\nname: b\ndescription: does b.\n---\nbody b",
    );
    SkillsRuntime::new(Arc::new(SkillLibrary::load(dir.path())))
}

#[test]
fn disabled_runtime_offers_nothing() {
    let runtime = SkillsRuntime::disabled();
    assert!(!runtime.offers_skills());
    assert!(runtime.prompt_section().is_none());
    assert!(runtime.state_event().is_none());
}

#[test]
fn enabled_but_empty_runtime_offers_nothing() {
    let runtime = SkillsRuntime::new(Arc::new(SkillLibrary::empty()));
    assert!(!runtime.offers_skills());
    assert!(runtime.prompt_section().is_none());
    assert!(runtime.state_event().is_none());
}

#[test]
fn prompt_section_lists_each_skill_with_its_description() {
    let runtime = two_skill_runtime();
    let section = runtime.prompt_section().expect("skills are offered");
    assert!(section.contains("read_skill"));
    assert!(section.contains("a: does a."));
    assert!(section.contains("b: does b."));
}

#[test]
fn record_read_reports_fresh_then_repeat_then_unknown() {
    let mut runtime = two_skill_runtime();
    assert_eq!(runtime.record_read("a"), ReadRecord::Fresh);
    assert_eq!(runtime.record_read("a"), ReadRecord::Repeat);
    assert_eq!(runtime.record_read("b"), ReadRecord::Fresh);
    assert_eq!(runtime.record_read("nope"), ReadRecord::Unknown);
}

#[test]
fn state_event_reflects_which_skills_are_read() {
    let mut runtime = two_skill_runtime();

    // At the start every skill is unread.
    let GgTelemetryKind::SkillsState { skills } = runtime.state_event().unwrap() else {
        panic!("expected a SkillsState event");
    };
    assert_eq!(skills.len(), 2);
    assert!(skills.iter().all(|s| !s.read));

    // After reading `a`, only it is marked read; its description travels with it.
    runtime.record_read("a");
    let GgTelemetryKind::SkillsState { skills } = runtime.state_event().unwrap() else {
        panic!("expected a SkillsState event");
    };
    let a = skills.iter().find(|s| s.name == "a").unwrap();
    assert!(a.read);
    assert_eq!(a.description, "does a.");
    assert!(!skills.iter().find(|s| s.name == "b").unwrap().read);
}
