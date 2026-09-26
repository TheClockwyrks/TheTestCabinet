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
    let skill = parse_skill(raw).expect("a well-formed skill parses");
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

/// **A file with no front matter is not a skill.**
///
/// It used to be read as one named after its own file and described as "(no description
/// provided)" — a line in the catalogue that tells the model nothing, over a body that still
/// contained whatever the author meant to be front matter.
#[test]
fn parse_without_front_matter_is_refused() {
    let raw = "# Just markdown\n\nNo front matter here.";
    let problem = parse_skill(raw).expect_err("a skill with no front matter is refused");
    assert!(problem.contains("front matter"), "{problem}");
    assert!(problem.contains("description"), "{problem}");
}

#[test]
fn parse_tolerates_quotes_and_bom_and_ignores_other_keys() {
    let raw = "\u{feff}---\nname: \"quoted-name\"\ntitle: ignored\ndescription: 'single quoted'\n---\nbody";
    let skill = parse_skill(raw).expect("other front-matter keys are none of gg's business");
    assert_eq!(skill.name(), "quoted-name");
    assert_eq!(skill.description(), "single quoted");
    assert_eq!(skill.body(), "body");
}

/// **An opening fence with no closing one is refused**, rather than read as a skill whose body is
/// its own front matter.
#[test]
fn parse_unclosed_front_matter_is_refused() {
    let raw = "---\nname: never-closed\n\nsome body without a closing fence\n";
    let problem = parse_skill(raw).expect_err("an unclosed fence is refused");
    assert!(problem.contains("never closed"), "{problem}");
}

/// **A blank `name` or `description` is refused**, on the same footing as an absent one: the two
/// fields are what the catalogue the model reads is made of.
#[test]
fn parse_empty_front_matter_field_is_refused() {
    let problem =
        parse_skill("---\nname:\ndescription:\n---\nbody").expect_err("a blank name is refused");
    assert!(problem.contains("`name`"), "{problem}");

    let problem = parse_skill("---\nname: has-a-name\ndescription:   \n---\nbody")
        .expect_err("a blank description is refused");
    assert!(problem.contains("`description`"), "{problem}");
}

// ---------------------------------------------------------------------------
// Library loading
// ---------------------------------------------------------------------------

/// Load `dir`, returning the defects rather than the library — the shape every refusal test below
/// asserts against.
fn defects(dir: &std::path::Path) -> Vec<String> {
    let mut report = crate::validate::LaunchReport::collecting();
    SkillLibrary::load(dir, &mut report);
    report
        .into_defects()
        .iter()
        .map(ToString::to_string)
        .collect()
}

/// **A missing skills directory is empty, not refused.** The default `.gg/skills` is absent from
/// every workspace that authored no skills, and an empty library is exactly right there. A
/// directory the capability's `dir` param *named* is a different question, answered by the
/// [workspace gate](crate::validate::validate_workspace).
#[test]
fn load_missing_directory_is_empty() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("does-not-exist");
    assert!(defects(&missing).is_empty());
    assert!(SkillLibrary::loaded(&missing).is_empty());
}

#[test]
fn load_reads_md_files_in_name_order() {
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

    let library = SkillLibrary::loaded(dir.path());
    assert_eq!(library.len(), 2);
    // Ordered by skill name.
    assert_eq!(library.skills()[0].name(), "alpha");
    assert_eq!(library.skills()[1].name(), "zeta");
    assert_eq!(library.get("alpha").unwrap().body(), "a body");
}

/// **An entry that is neither of the two shapes refuses the launch.** A guide written as
/// `notes.txt` is a guide the model is never offered, and nothing about the run says so.
#[test]
fn an_entry_that_is_not_a_skill_is_refused() {
    let dir = TempDir::new().unwrap();
    write(
        dir.path(),
        "alpha.md",
        "---\nname: alpha\ndescription: a real one.\n---\na body",
    );
    write(dir.path(), "notes.txt", "not a skill");

    let defects = defects(dir.path());
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(defects[0].contains("notes.txt"), "{defects:?}");
}

/// A **dotfile** is tooling's, not an author's: `.gitkeep` is how an empty directory is committed
/// at all, and a launch refused over one would be gg holding a file to a rule about skills that it
/// never claimed to be.
#[test]
fn a_dotfile_is_not_an_entry() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), ".gitkeep", "");
    write(dir.path(), ".DS_Store", "\u{0}");
    assert!(defects(dir.path()).is_empty());
    assert!(SkillLibrary::loaded(dir.path()).is_empty());
}

/// **Two entries claiming one name refuse the launch.** gg used to keep the first in path order,
/// so the second guide was simply never reachable — by a name that was in the catalogue.
#[test]
fn two_skills_claiming_one_name_are_refused() {
    let dir = TempDir::new().unwrap();
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

    let defects = defects(dir.path());
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(defects[0].contains("`dup`"), "{defects:?}");
    assert!(defects[0].contains("02-second.md"), "{defects:?}");
}

/// **A skill directory with no `skill.md` refuses the launch**, rather than being ignored: the
/// name and the description are what the catalogue is made of, and gg will not invent them from a
/// directory name.
#[test]
fn a_skill_directory_without_a_manifest_is_refused() {
    let dir = TempDir::new().unwrap();
    let skill = dir.path().join("helpers");
    std::fs::create_dir(&skill).unwrap();
    write(&skill, "skill.ts", "export const a = 1;");

    let defects = defects(dir.path());
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(defects[0].contains("skill.md"), "{defects:?}");
}

/// **Every defect in one directory is reported together.** An author fixing a skills directory
/// wants the whole list in one pass, not one launch per mistake.
#[test]
fn every_entry_that_does_not_load_is_reported_at_once() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "a-prose.md", "no front matter at all");
    write(dir.path(), "b-notes.txt", "not a skill");
    let empty = dir.path().join("c-empty");
    std::fs::create_dir(&empty).unwrap();

    let defects = defects(dir.path());
    assert_eq!(defects.len(), 3, "{defects:?}");
    assert!(defects[0].contains("a-prose.md"), "{defects:?}");
    assert!(defects[1].contains("b-notes.txt"), "{defects:?}");
    assert!(defects[2].contains("c-empty"), "{defects:?}");
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
    SkillsRuntime::new(Arc::new(SkillLibrary::loaded(dir.path())))
}

#[test]
fn disabled_runtime_offers_nothing() {
    let runtime = SkillsRuntime::disabled();
    assert!(!runtime.offers_skills());
    assert!(runtime.library().skills().is_empty());
    assert!(runtime.state_event().is_none());
}

#[test]
fn enabled_but_empty_runtime_offers_nothing() {
    let runtime = SkillsRuntime::new(Arc::new(SkillLibrary::empty()));
    assert!(!runtime.offers_skills());
    assert!(runtime.library().skills().is_empty());
    assert!(runtime.state_event().is_none());
}

/// The library the agent builds the prompt's catalog from carries every skill's name and
/// description — the "shown up front" affordance.
#[test]
fn the_offered_library_carries_each_skill_with_its_description() {
    let runtime = two_skill_runtime();
    let library = runtime.library();
    let listed: Vec<(&str, &str)> = library
        .skills()
        .iter()
        .map(|skill| (skill.name(), skill.description()))
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
    let library = SkillLibrary::loaded(root.path());
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
/// This is the library's answer, and it is the right one: refusing the *read*, or handing the agent
/// a module it cannot evaluate, would make a skill's shared half unusable because its unshared half
/// was authored for the run's other arm. What is refused, one layer up, is a directory whose code
/// no agent in the run could read at all — see
/// [the workspace gate](crate::validate::validate_workspace).
#[test]
fn a_module_in_another_language_is_not_offered() {
    let (_root, library) = library_with(&[("skill.fixture", "def helper(): return 1")]);
    let skill = library.get("helpers").expect("the skill loaded");

    assert_eq!(skill.code(lang(GgProgramLanguage::TypeScript)), None);
    assert!(skill.has_code(), "the skill does carry code, just not ours");
    assert_eq!(skill.code_spellings(), vec!["fixture"]);
    assert_eq!(skill.body(), "Prose.");
}

/// **One `skill.js` reaches both ECMAScript arms**, and each prefers its own spelling.
///
/// The pair exists to measure the type check, so a skill authored for both is authored in the
/// language they share: `tsc` compiles plain JavaScript, and the guest evaluates it, so `skill.js`
/// is a module either agent gets. `skill.ts` is TypeScript, and nothing on the unchecked arm erases
/// an annotation, so it is offered to the checked arm alone — which is what the extension means
/// everywhere else too.
#[test]
fn one_javascript_module_reaches_both_ecmascript_arms() {
    let (_root, only_js) = library_with(&[("skill.js", "export const a = 1;")]);
    let skill = only_js.get("helpers").unwrap();
    assert_eq!(
        skill.code(lang(GgProgramLanguage::TypeScript)),
        Some("export const a = 1;"),
        "a `.js` module must reach the checked arm"
    );
    assert_eq!(
        skill.code(lang(GgProgramLanguage::JavaScript)),
        Some("export const a = 1;")
    );

    let (_root, only_ts) = library_with(&[("skill.ts", "export const a = 1;")]);
    let skill = only_ts.get("helpers").unwrap();
    assert_eq!(
        skill.code(lang(GgProgramLanguage::JavaScript)),
        None,
        "a `.ts` module is TypeScript, and nothing on the unchecked arm erases an annotation"
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
        (
            "on-use.ts",
            "import * as gg from \"gg\";\ngg.views.openText(\"hi\", \"there\");",
        ),
        ("skill.fixture", "def helper(): return 1"),
    ]);
    let skill = library.get("helpers").unwrap();

    let typescript = lang(GgProgramLanguage::TypeScript);
    assert_eq!(
        skill.on_use(typescript),
        Some("import * as gg from \"gg\";\ngg.views.openText(\"hi\", \"there\");")
    );
    assert_eq!(skill.code(typescript), None);

    let fixture = crate::sandbox::fixture_languages().next().unwrap();
    assert_eq!(skill.on_use(fixture), None);
    assert_eq!(skill.code(fixture), Some("def helper(): return 1"));
}

/// **A blank code file refuses the launch.** An author who wrote `skill.ts` meant the agent to get
/// a module; binding `lib.<key>` to something that exports nothing is the skill's code half
/// switched off rather than written, and the arm the directory was authored for silently becomes
/// the arm without it. Both halves are reported, because both are wrong.
#[test]
fn a_blank_code_file_is_refused() {
    let root = TempDir::new().unwrap();
    let dir = root.path().join("helpers");
    std::fs::create_dir(&dir).unwrap();
    write(
        &dir,
        "skill.md",
        "---\nname: helpers\ndescription: helps.\n---\nProse.",
    );
    write(&dir, "skill.ts", "   \n\n");
    write(&dir, "on-use.ts", "");

    let defects = defects(root.path());
    assert_eq!(defects.len(), 2, "{defects:?}");
    assert!(defects[0].contains("skill.ts"), "{defects:?}");
    assert!(defects[1].contains("on-use.ts"), "{defects:?}");
}
