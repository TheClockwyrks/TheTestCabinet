//! Tests for the clone detector.

use super::*;

/// A block long enough and substantial enough to register.
fn block(label: &str) -> String {
    format!(
        "function update{label}(state) {{\n\
         \x20 const speed = state.speed * 1.5;\n\
         \x20 const angle = Math.atan2(state.dy, state.dx);\n\
         \x20 state.x += Math.cos(angle) * speed;\n\
         \x20 state.y += Math.sin(angle) * speed;\n\
         \x20 return state;\n\
         }}\n"
    )
}

fn detect_over(sources: &[String]) -> Clones {
    let inputs: Vec<CloneInput<'_>> = sources
        .iter()
        .enumerate()
        .map(|(file, source)| CloneInput {
            file,
            source: source.as_str(),
        })
        .collect();
    detect(&inputs)
}

/// The metric's whole reason for existing: the same block written twice, in two files that
/// every size, complexity and graph figure would call perfectly healthy.
#[test]
fn the_same_block_in_two_files_is_one_clone_group() {
    let clones = detect_over(&[block("A"), block("A")]);
    assert_eq!(clones.groups.len(), 1);
    assert_eq!(clones.groups[0].instances.len(), 2);
    assert_eq!(
        clones.groups[0].instances[0],
        CloneInstance { file: 0, line: 1 }
    );
    assert!(clones.largest_clone_lines >= WINDOW_LINES as u32);
}

/// Two genuinely different blocks are not a clone.
#[test]
fn different_blocks_are_not_a_clone() {
    let other = "function draw(ctx) {\n\
                 \x20 ctx.clearRect(0, 0, 800, 600);\n\
                 \x20 ctx.fillStyle = '#123456';\n\
                 \x20 ctx.fillRect(10, 20, 30, 40);\n\
                 \x20 ctx.strokeRect(1, 2, 3, 4);\n\
                 \x20 return ctx;\n\
                 }\n";
    let clones = detect_over(&[block("A"), other.to_string()]);
    assert!(clones.groups.is_empty(), "{:?}", clones.groups);
}

/// Reindentation and reflowed whitespace do not hide a clone — a pasted block is usually
/// pasted at a different indent.
#[test]
fn reindentation_does_not_hide_a_clone() {
    let indented: String = block("A")
        .lines()
        .map(|line| format!("    {line}\n"))
        .collect();
    let clones = detect_over(&[block("A"), indented]);
    assert_eq!(clones.groups.len(), 1);
}

/// A run longer than the window is reported as **one** long group, not as every overlapping
/// window inside it.
#[test]
fn a_long_run_is_one_group_not_many_overlapping_ones() {
    let long = format!("{}{}", block("A"), block("B"));
    let clones = detect_over(&[long.clone(), long]);
    assert_eq!(clones.groups.len(), 1);
    assert!(
        clones.groups[0].lines > WINDOW_LINES as u32,
        "the match must grow past one window: {} lines",
        clones.groups[0].lines
    );
}

/// Six lines of punctuation are identical and uninteresting; the content floor is what keeps
/// them out of the figure.
#[test]
fn boilerplate_punctuation_is_not_a_clone() {
    let braces = "}\n}\n}\n}\n}\n}\n";
    let clones = detect_over(&[braces.to_string(), braces.to_string()]);
    assert!(clones.groups.is_empty());
}

/// The detector is a pure function of the bytes: the same input yields the same groups, in
/// the same order, with the same lines. SHA-256 rather than `DefaultHasher` is what makes
/// that true across processes and platforms.
#[test]
fn detection_is_deterministic() {
    let sources = vec![block("A"), block("A"), block("A")];
    assert_eq!(detect_over(&sources), detect_over(&sources));
}

/// A block repeated inside one file is a clone of itself, and its instances never overlap.
#[test]
fn a_block_repeated_within_one_file_is_a_clone() {
    let doubled = format!("{}{}", block("A"), block("A"));
    let clones = detect_over(&[doubled]);
    assert_eq!(clones.groups.len(), 1);
    let instances = &clones.groups[0].instances;
    assert_eq!(instances.len(), 2);
    assert!(
        instances[1].line >= instances[0].line + clones.groups[0].lines,
        "instances must not overlap: {instances:?}"
    );
}
