//! Tests for skill parsing (front-matter strip), library loading, and the runtime's
//! read-tracking / prompt / telemetry derivations.

use std::sync::Arc;

use tempfile::TempDir;
use test_cabinet_core::gg::{GgProgramLanguage, GgTelemetryKind};

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
    assert!(runtime.prompt_entries().is_empty());
    assert!(runtime.state_event().is_none());
}

#[test]
fn enabled_but_empty_runtime_offers_nothing() {
    let runtime = SkillsRuntime::new(Arc::new(SkillLibrary::empty()));
    assert!(!runtime.offers_skills());
    assert!(runtime.prompt_entries().is_empty());
    assert!(runtime.state_event().is_none());
}

/// The catalog the system prompt lists carries every skill's name and description — the
/// "shown up front" affordance.
#[test]
fn prompt_entries_carry_each_skill_with_its_description() {
    let entries = two_skill_runtime().prompt_entries();
    let listed: Vec<(&str, &str)> = entries
        .iter()
        .map(|entry| (entry.name.as_str(), entry.description.as_str()))
        .collect();
    assert_eq!(listed, vec![("a", "does a."), ("b", "does b.")]);
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
    let GgTelemetryKind::SkillsState { skills, .. } = runtime.state_event().unwrap() else {
        panic!("expected a SkillsState event");
    };
    assert_eq!(skills.len(), 2);
    assert!(skills.iter().all(|s| !s.read));

    // After reading `a`, only it is marked read; its description travels with it.
    runtime.record_read("a");
    let GgTelemetryKind::SkillsState { skills, .. } = runtime.state_event().unwrap() else {
        panic!("expected a SkillsState event");
    };
    let a = skills.iter().find(|s| s.name == "a").unwrap();
    assert!(a.read);
    assert_eq!(a.description, "does a.");
    assert!(!skills.iter().find(|s| s.name == "b").unwrap().read);
}

// ---------------------------------------------------------------------------
// A skill's code, per language
// ---------------------------------------------------------------------------

/// A skill directory with `files` written into it, under a library loaded from its parent.
fn library_with(files: &[(&str, &str)]) -> (TempDir, SkillLibrary) {
    let root = TempDir::new().unwrap();
    let dir = root.path().join("helpers");
    std::fs::create_dir(&dir).unwrap();
    write(
        &dir,
        "skill.md",
        "---\nname: helpers\ndescription: helps.\n---\nProse.",
    );
    for (name, contents) in files {
        write(&dir, name, contents);
    }
    let library = SkillLibrary::load(root.path());
    (root, library)
}

/// The registered language with the given id.
fn lang(id: GgProgramLanguage) -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(id)
}

/// **Each language reads the module spelled the way it spells one.**
///
/// One directory, two modules, two agents: the whole point of keying a skill's code rather than
/// holding one string. The fixture language stands in for the ordinary case — a language whose
/// modules nothing else could evaluate — so the two answers here are genuinely different files.
#[test]
fn each_language_reads_the_module_spelled_for_it() {
    let (_root, library) = library_with(&[
        ("skill.ts", "export const which = \"typescript\";"),
        ("skill.fixture", "def which(): return \"fixture\""),
    ]);
    let skill = library.get("helpers").expect("the skill loaded");

    assert_eq!(
        skill.code(lang(GgProgramLanguage::TypeScript)),
        Some("export const which = \"typescript\";")
    );
    let fixture = crate::sandbox::fixture_languages().next().unwrap();
    assert_eq!(skill.code(fixture), Some("def which(): return \"fixture\""));
}

/// **A skill authored in a language this agent does not write offers it no code at all** — and its
/// prose still reads.
///
/// The alternative — refusing the read, or handing the agent a module it cannot evaluate — would
/// make a skill's shared half unusable because its unshared half was authored elsewhere.
#[test]
fn a_module_in_another_language_is_not_offered() {
    let (_root, library) = library_with(&[("skill.fixture", "def helper(): return 1")]);
    let skill = library.get("helpers").expect("the skill loaded");

    assert_eq!(skill.code(lang(GgProgramLanguage::TypeScript)), None);
    assert!(skill.has_code(), "the skill does carry code, just not ours");
    assert_eq!(skill.code_spellings(), vec!["fixture"]);
    assert_eq!(skill.body(), "Prose.");
}

/// **The two arms that share a runtime share a skill's code**, and each prefers its own spelling.
///
/// TypeScript and JavaScript differ in whether a program is type-checked and in nothing else. A
/// directory carrying only `skill.ts` must therefore reach the JavaScript agent too: a skill present
/// on one arm and absent on the other would be a far larger difference than the one the pair exists
/// to measure. Where both spellings are present, each arm still takes its own.
#[test]
fn the_two_ecmascript_arms_read_each_others_spellings_but_prefer_their_own() {
    let (_root, only_ts) = library_with(&[("skill.ts", "export const a = 1;")]);
    let skill = only_ts.get("helpers").unwrap();
    assert_eq!(
        skill.code(lang(GgProgramLanguage::JavaScript)),
        Some("export const a = 1;"),
        "a `.ts` module must reach the unchecked arm"
    );

    let (_root, both) = library_with(&[
        ("skill.ts", "export const a = 1;"),
        ("skill.js", "export const a = 2;"),
    ]);
    let skill = both.get("helpers").unwrap();
    assert_eq!(
        skill.code(lang(GgProgramLanguage::TypeScript)),
        Some("export const a = 1;")
    );
    assert_eq!(
        skill.code(lang(GgProgramLanguage::JavaScript)),
        Some("export const a = 2;")
    );
}

/// An on-use script is resolved exactly as a module is, and the two halves are independent: a
/// directory may spell one of them for a language and not the other.
#[test]
fn an_on_use_script_is_resolved_per_language_too() {
    let (_root, library) = library_with(&[
        ("on-use.ts", "view.openText(\"hi\", \"there\");"),
        ("skill.fixture", "def helper(): return 1"),
    ]);
    let skill = library.get("helpers").unwrap();

    let typescript = lang(GgProgramLanguage::TypeScript);
    assert_eq!(
        skill.on_use(typescript),
        Some("view.openText(\"hi\", \"there\");")
    );
    assert_eq!(skill.code(typescript), None);

    let fixture = crate::sandbox::fixture_languages().next().unwrap();
    assert_eq!(skill.on_use(fixture), None);
    assert_eq!(skill.code(fixture), Some("def helper(): return 1"));
}

/// A blank module file is not a module: it is dropped rather than bound, so an agent is never handed
/// a `lib.<key>` that exports nothing.
#[test]
fn a_blank_module_file_is_not_loaded() {
    let (_root, library) = library_with(&[("skill.ts", "   \n\n"), ("on-use.ts", "")]);
    let skill = library.get("helpers").unwrap();
    assert!(!skill.has_code());
    assert_eq!(skill.code(lang(GgProgramLanguage::TypeScript)), None);
    assert_eq!(skill.on_use(lang(GgProgramLanguage::TypeScript)), None);
}
