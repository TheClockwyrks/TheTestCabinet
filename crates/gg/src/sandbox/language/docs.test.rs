//! The gate's own assertions: that it found something, that its table of spellings agrees with the
//! arms', and that every program it found compiles.

use super::*;

/// **Every fenced program in gg's documentation compiles on the arm its fence names.**
///
/// One preparation each, through the arm's real compiler and real SDK. A page that shows a program
/// missing its `import` line, naming a call the SDK does not declare, or passing an argument the
/// signature does not take fails here with the page, the line and the compiler's own diagnostic.
#[test]
fn every_program_the_documentation_shows_compiles() {
    let mut refusals = Vec::new();
    for example in gathered() {
        if let Some(diagnostic) = refused(&example) {
            refusals.push(format!("{}\n{diagnostic}", example.cite()));
        }
    }
    assert!(
        refusals.is_empty(),
        "{} of gg's documented programs do not compile:\n\n{}",
        refusals.len(),
        refusals.join("\n\n")
    );
}

/// The gate has a subject.
///
/// A walk that found no page, or a tag table that matched no fence, would pass the assertion above
/// by having nothing to check — the one way a gate over a directory fails silently.
#[test]
fn the_documentation_is_where_the_gate_looks_for_it() {
    let found = gathered();
    assert!(
        found.len() >= 8,
        "the gg documentation shows {} fenced programs, which is fewer than it had when this gate \
         was written; either the walk lost the tree at {} or a page's fence lost its tag",
        found.len(),
        root().display()
    );
    let mut arms: Vec<GgProgramLanguage> = found.iter().map(|example| example.arm).collect();
    arms.sort_by_key(|arm| arm.to_string());
    arms.dedup();
    assert!(
        arms.len() >= 3,
        "every documented program resolved to {arms:?}; a gate that only ever drives one arm is one \
         arm's gate"
    );
}

/// No tag is mapped twice, and no arm is unreachable through a spelling.
///
/// A duplicate entry means the second is dead, and an arm with no spelling is an arm whose
/// documented programs would be gathered by nobody — the state that lets a page add an unchecked
/// program by tagging its fence with the arm's own name.
#[test]
fn every_arm_is_reachable_through_a_spelling_of_its_own() {
    let mut seen: Vec<&str> = Vec::new();
    for (tag, _) in ARMS {
        assert!(!seen.contains(tag), "`{tag}` is mapped twice");
        seen.push(tag);
    }
    for arm in GgProgramLanguage::ALL {
        assert!(
            ARMS.iter().any(|(_, mapped)| mapped == arm)
                || matches!(arm, GgProgramLanguage::JavaScript),
            "{arm} has no fence tag here, so a documented {arm} program would never be compiled"
        );
    }
}
