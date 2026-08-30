//! What the two caps promise the arms that call them, and what they promise the model reading the
//! result.
//!
//! Every case here is a string in and a string out, so the whole file runs in microseconds and none
//! of it needs a compiler. That is deliberate: the arms' own tests assert what their compilers say,
//! and this file asserts what happens to it afterwards — a bug in the second is a bug in every arm
//! at once, and it should not need a toolchain installed to catch.

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;

/// Three distinct renderings, in the order a compiler would have found them.
fn three() -> Vec<String> {
    vec!["one".to_string(), "two".to_string(), "three".to_string()]
}

#[test]
fn identical_renderings_are_folded_and_the_first_of_them_keeps_its_place() {
    // The measured case: one unsupported call reported once per call site, byte-identical every
    // time. A model that reads it four times has learned what it learned from reading it once and
    // paid four times for it.
    let rendered = capped(
        vec![
            "unresolved reference 'nope'".to_string(),
            "keep me".to_string(),
            "unresolved reference 'nope'".to_string(),
            "unresolved reference 'nope'".to_string(),
        ],
        8,
        "\n\n",
    );
    assert_eq!(rendered, "unresolved reference 'nope'\n\nkeep me");
    // Folded to the FIRST occurrence, not the last: the compiler's order is the file's order, and
    // the model reads the file top to bottom.
    assert!(rendered.starts_with("unresolved"), "{rendered}");
}

#[test]
fn folding_is_byte_identical_only_so_the_same_mistake_at_two_places_is_two_things_to_fix() {
    // The same message at two lines is two edits. Folding on the message alone would tell a model it
    // had one call site to fix when it has two, and it would find that out a turn later.
    let rendered = capped(
        vec![
            "program.kts:7:19: unresolved reference 'nope'".to_string(),
            "program.kts:9:4: unresolved reference 'nope'".to_string(),
        ],
        8,
        "\n\n",
    );
    assert_eq!(
        rendered,
        "program.kts:7:19: unresolved reference 'nope'\n\nprogram.kts:9:4: unresolved reference 'nope'"
    );
}

#[test]
fn a_list_that_exactly_fills_the_cap_is_not_counted_at_all() {
    // The boundary in both directions, because an off-by-one here is a model told there is "1 more"
    // of something it has already been shown — which sends it looking for a diagnostic that does not
    // exist.
    let rendered = capped(three(), 3, "\n\n");
    assert_eq!(rendered, "one\n\ntwo\n\nthree");
    assert!(!rendered.contains("more like these"), "{rendered}");
}

#[test]
fn one_over_the_cap_drops_exactly_one_and_says_so() {
    let rendered = capped(three(), 2, "\n\n");
    assert_eq!(rendered, "one\n\ntwo\n\n… and 1 more like these.");
}

#[test]
fn the_count_is_of_what_survived_folding_rather_than_of_what_arrived() {
    // Forty entries, two of them distinct. A count of what arrived would say "38 more" about a list
    // with nothing left in it, which is worse than saying nothing: it is gg reporting a number the
    // model cannot reconcile with what it was shown.
    let mut many: Vec<String> = vec!["distinct".to_string()];
    many.extend((0..39).map(|_| "repeated".to_string()));
    assert_eq!(
        capped(many, 1, " | "),
        "distinct | … and 1 more like these."
    );
}

#[test]
fn the_dropped_count_wording_is_the_one_the_kotlin_arm_has_always_printed() {
    // Asserted as a literal on purpose. This string is in a model's context window and in that
    // arm's own tests, and it is the one sentence in this module a reader has to be able to trust
    // without reading the module.
    let rendered = capped(
        (0..30).map(|line| format!("line {line}")).collect(),
        8,
        "\n\n",
    );
    assert!(
        rendered.ends_with("\n\n… and 22 more like these."),
        "{rendered}"
    );
}

#[test]
fn an_empty_list_is_an_empty_string_and_not_a_count_of_nothing() {
    assert_eq!(capped(Vec::new(), 8, "\n\n"), "");
    assert_eq!(capped(Vec::new(), 0, "\n\n"), "");
}

#[test]
fn a_cap_of_zero_is_the_count_alone_with_no_separator_in_front_of_it() {
    // "Tell it only how many" is a legal request, and the answer must not open with the separator
    // an empty kept-list would otherwise be joined to.
    assert_eq!(capped(three(), 0, "\n\n"), "… and 3 more like these.");
}

#[test]
fn nothing_is_trimmed_off_an_entry_or_out_from_between_them() {
    // An excerpt and a caret only line up if nothing touched them, so leading and trailing
    // whitespace survives — including on the last entry, where a trim would be invisible until an
    // arm rendered a caret there.
    let rendered = capped(
        vec!["  indented\n     ^".to_string(), "trailing   ".to_string()],
        8,
        "\n\n",
    );
    assert_eq!(rendered, "  indented\n     ^\n\ntrailing   ");
}

/// The shape a text-reporting compiler writes: a located header, then the excerpt and caret that
/// belong to it.
fn group(line: usize) -> String {
    format!("main.swift:{line}:9: error: cannot find 'nope' in scope\n    nope()\n    ^~~~")
}

/// What [`capped_lines`] is handed on the text arms: an `error:` line opens, everything else does
/// not.
fn opens_on_error(line: &str) -> bool {
    line.contains(": error: ")
}

#[test]
fn a_group_is_kept_whole_with_its_excerpt_and_its_caret() {
    let text = format!("{}\n{}\n{}", group(7), group(9), group(11));
    let rendered = capped_lines(&text, opens_on_error, 2);
    assert_eq!(
        rendered,
        format!("{}\n{}\n… and 1 more like these.", group(7), group(9))
    );
    // The caret survived the cut with the header it points under. A cap that kept headers only would
    // be cheaper and would have told the model less than the compiler did.
    assert!(rendered.contains("    ^~~~"), "{rendered}");
}

#[test]
fn a_group_count_that_exactly_fills_the_cap_leaves_the_text_untouched() {
    let text = format!("{}\n{}", group(7), group(9));
    assert_eq!(capped_lines(&text, opens_on_error, 2), text);
    assert_eq!(capped_lines(&text, opens_on_error, 9), text);
}

#[test]
fn everything_before_the_first_group_is_a_preamble_and_survives() {
    // On the text arms this is where a driver's own trouble lands — printed before there was a
    // diagnostic to attach it to. Dropping it leaves a model reading about its program when the
    // sentence was about the machine.
    let text = format!(
        "warning: Unable to locate libSwiftScan\nremark: using toolchain at /usr\n{}\n{}",
        group(7),
        group(9)
    );
    let rendered = capped_lines(&text, opens_on_error, 1);
    assert_eq!(
        rendered,
        format!(
            "warning: Unable to locate libSwiftScan\nremark: using toolchain at /usr\n{}\n… and 1 more like these.",
            group(7)
        )
    );
}

#[test]
fn a_preamble_survives_a_cap_of_zero_and_every_group_is_counted() {
    let text = format!(
        "could not read the module cache\n{}\n{}",
        group(7),
        group(9)
    );
    assert_eq!(
        capped_lines(&text, opens_on_error, 0),
        "could not read the module cache\n… and 2 more like these."
    );
}

#[test]
fn a_cap_of_zero_with_no_preamble_is_the_count_alone() {
    let text = format!("{}\n{}", group(7), group(9));
    assert_eq!(
        capped_lines(&text, opens_on_error, 0),
        "… and 2 more like these."
    );
}

#[test]
fn text_with_no_opening_line_at_all_is_returned_exactly_as_it_arrived() {
    // A compiler that said something `opens` does not recognise has said one thing. Cutting it where
    // there is no evidence of a group would be gg discarding a diagnostic it did not understand —
    // and on the text arms, a driver failure is precisely that shape.
    let text = "ld: symbol(s) not found for architecture wasm32\n  referenced from: main.o";
    assert_eq!(capped_lines(text, opens_on_error, 0), text);
    assert_eq!(capped_lines(text, opens_on_error, 1), text);
    assert_eq!(capped_lines("", opens_on_error, 0), "");
}

#[test]
fn a_group_whose_own_text_contains_the_separator_is_still_one_group() {
    // The item cap joins with a separator; this one does not, and this is the case that shows why
    // the two shapes cannot be one function. A Swift excerpt routinely contains a blank line, which
    // is the item arms' separator — split on it and the caret becomes a diagnostic of its own, and
    // the cap starts counting pictures instead of problems.
    let text = format!(
        "main.swift:7:9: error: cannot find 'nope' in scope\n\n    nope()\n\n    ^~~~\n{}\n{}",
        group(9),
        group(11)
    );
    let rendered = capped_lines(&text, opens_on_error, 1);
    assert_eq!(
        rendered,
        "main.swift:7:9: error: cannot find 'nope' in scope\n\n    nope()\n\n    ^~~~\n… and 2 more like these."
    );
}

#[test]
fn the_count_line_does_not_add_a_blank_line_to_text_that_already_ended_at_one() {
    // The kept group ends on the blank line that separated it from the dropped one. Starting the
    // count after that boundary rather than after another one keeps the result the shape the
    // compiler was writing.
    let text = "a: error: first\n  excerpt\n\na: error: second\n  excerpt";
    assert_eq!(
        capped_lines(text, opens_on_error, 1),
        "a: error: first\n  excerpt\n… and 1 more like these."
    );
}

#[test]
fn interior_lines_keep_their_indentation_and_their_blank_lines() {
    let text = "a: error: first\n\n      deeply    indented   \n\n\n  ^\na: error: second";
    let rendered = capped_lines(text, opens_on_error, 1);
    assert!(
        rendered.starts_with("a: error: first\n\n      deeply    indented   \n\n\n  ^\n"),
        "{rendered}"
    );
}

#[test]
fn the_two_shapes_print_the_same_sentence_about_what_they_dropped() {
    // One wording, so a model that works in two languages is not learning two conventions for the
    // same fact — and so a reader grepping for it finds every place it can come from.
    let items = capped(three(), 1, "\n\n");
    let lines = capped_lines(&format!("{}\n{}", group(7), group(9)), opens_on_error, 1);
    assert!(items.ends_with("… and 2 more like these."), "{items}");
    assert!(lines.ends_with("… and 1 more like these."), "{lines}");
}

// The supporting material a compile failure carries: the matching that decides which of an arm's
// library set answers a diagnostic, and the one bound every arm holds the result to.

/// The names a rendered block offers, read back out of the lines a model reads.
fn offered(block: &str) -> Vec<String> {
    block
        .lines()
        .filter_map(|line| line.strip_prefix("- "))
        .filter_map(|line| line.split_once(": "))
        .flat_map(|(_, modules)| modules.split(", ").map(str::to_string))
        .collect()
}

/// Every distinct first path segment an arm's catalogue holds, offered at once — the largest
/// candidate list this arm's matcher can be asked to produce, since every module shares its first
/// segment with one of them.
fn every_namespace(catalogue: &crate::sandbox::signatures::SignatureCatalogue) -> Vec<String> {
    let mut names: Vec<String> = catalogue
        .libraries
        .iter()
        .flat_map(|group| group.modules.iter())
        .filter_map(|module| segments(module).into_iter().next())
        .collect();
    names.sort();
    names.dedup();
    names
}

/// **Every arm that declares a library set holds its supporting material to one bound.**
///
/// The assertion the whole design rests on: what a compile failure costs the next turn is
/// comparable from one arm to the next. It is asked of every registered arm rather than of a list,
/// so a twelfth arm is covered the day it is registered, and it is asked in both the case that
/// carries nothing but a diagnostic and the largest case the arm's own catalogue can produce.
#[test]
fn every_arm_holds_its_supporting_material_to_one_bound() {
    for language in crate::sandbox::all_languages() {
        let arm = language.id();
        let catalogue = language.catalogue();
        let Some(whole) = supporting(catalogue, &[]) else {
            assert!(
                catalogue.libraries.is_empty(),
                "{arm} declares a library set and answered a rejection with nothing"
            );
            continue;
        };
        let declared: Vec<&str> = catalogue
            .libraries
            .iter()
            .flat_map(|group| group.modules.iter().map(String::as_str))
            .collect();

        for (case, block) in [
            ("a diagnostic naming no import", whole.clone()),
            (
                "a diagnostic naming every namespace this arm has",
                supporting(catalogue, &every_namespace(catalogue))
                    .expect("an arm that declares a set answers with something"),
            ),
        ] {
            assert!(
                block.len() <= SUPPORTING,
                "{arm} answers {case} with {} bytes, over the {SUPPORTING} every arm holds to",
                block.len()
            );
            let offered = offered(&block);
            assert!(
                !offered.is_empty(),
                "{arm} answers {case} with a heading and no library at all:\n{block}"
            );
            for name in &offered {
                assert!(
                    declared.contains(&name.as_str()),
                    "{arm} answers {case} with `{name}`, which its catalogue does not declare — a \
                     name was cut in half rather than dropped whole:\n{block}"
                );
            }
            let dropped = declared.len() - offered.len();
            assert_eq!(
                block.contains("… and "),
                dropped > 0,
                "{arm} dropped {dropped} of {} names answering {case}, and the block says \
                 otherwise:\n{block}",
                declared.len()
            );
            if dropped > 0 {
                assert!(
                    block.ends_with(&more(dropped)),
                    "{arm} closes {case} with a count of what it dropped:\n{block}"
                );
            }
        }
    }
}

/// **A name matches the module it meant, and nothing it did not.**
///
/// The three ways one matches, each written as the mistake it answers, and the neighbours that must
/// stay out. One rule for every arm, so this is where it is stated once rather than eleven times.
#[test]
fn a_name_matches_the_module_it_meant() {
    // The arm carries it: the diagnostic was about something else, and saying so is the most
    // informative of the three answers.
    assert!(matched("java.util", "java.util"));
    assert!(matched("Data.Array", "data.array"));

    // One extends the other at a separator. The name reached into a module that exists, or named a
    // namespace whose modules do.
    assert!(matched("java.util", "java.util.Stuff"));
    assert!(matched("kotlin.math", "kotlin"));
    assert!(matched("std::collections", "std"));
    assert!(
        !matched("java.utility", "java.util"),
        "a prefix that stops inside a segment is not a path"
    );

    // The misspelling this whole path exists for, on the last segment.
    assert!(matched("java.util", "java.utl"));
    assert!(matched("itertools", "itertool"));
    assert!(matched("System.Text.Json", "System.Text.Jsn"));
    assert!(matched("Data.Array", "Data.Arary"));
    assert!(matched("Algorithms", "Algorithm"));
    assert!(
        matched("System.Text.Json", "System.Xml.Jsn"),
        "the segments in front of the last one are not compared, so a name is answered wherever \
         its author filed it"
    );
    assert!(
        !matched("System.Text.Json", "System.Text.Xml"),
        "a sibling under the same namespace is not a resemblance"
    );
    assert!(
        !matched("Data.Array", "Data.Lens"),
        "two modules of one namespace do not answer for each other"
    );
    assert!(
        !matched("std::fmt", "std::ops"),
        "two edits over three letters is not a resemblance, so a short segment is held to equality"
    );

    // Both sides are normalised: a compiler quotes a name, and the C++ catalogue spells a module
    // with the brackets a program writes around it.
    assert!(matched("<vector>", "'vectr'"));
    assert!(matched("<vector>", "vector"));
    assert!(matched("Algorithms", "`Algorithm`"));
}

/// **A cut block drops whole names and says how many.**
///
/// The one cut in this module that would otherwise lie: a truncated module name reads as a library
/// the arm does not have, which is the false negative the set is carried to prevent. So names go
/// whole and the count is what keeps the rest honest.
#[test]
fn a_cut_block_drops_whole_names_and_counts_them() {
    let catalogue = crate::sandbox::language(GgProgramLanguage::PureScript).catalogue();
    let whole = supporting(catalogue, &[]).expect("this arm declares a library set");
    let declared: usize = catalogue
        .libraries
        .iter()
        .map(|group| group.modules.len())
        .sum();
    let offered = offered(&whole);
    assert!(
        offered.len() < declared,
        "this arm's whole set is under the bound, so nothing here is being measured"
    );
    assert!(whole.ends_with(&more(declared - offered.len())));
    assert!(whole.len() <= SUPPORTING);
}

/// **A diagnostic naming an import the arm carries nothing like is answered with the whole set.**
///
/// The fallback is load-bearing rather than a leftover. A model that misremembered a name badly
/// enough to match nothing is the one that has learned least about what this arm offers, and the
/// set exists nowhere else: no prompt carries a package inventory.
#[test]
fn a_name_that_matches_nothing_is_answered_with_the_whole_set() {
    let catalogue = crate::sandbox::language(GgProgramLanguage::Rust).catalogue();
    let whole = supporting(catalogue, &[]).expect("this arm declares a library set");
    assert_eq!(
        supporting(catalogue, &["nlohmann".to_string()]),
        Some(whole),
        "a name resembling nothing this arm carries is answered with the inventory"
    );
}

/// **The parse the arms share reads what is between the delimiters and nothing else.**
#[test]
fn a_name_is_read_between_the_delimiters_the_arm_states() {
    assert_eq!(
        named("unresolved import `serd`", "`", "`"),
        vec!["serd".to_string()]
    );
    assert_eq!(
        named(
            "The type or namespace name 'Jsn' does not exist in the namespace 'System.Text'",
            "'",
            "'"
        ),
        vec!["Jsn".to_string(), "System.Text".to_string()]
    );
    assert_eq!(
        named(
            "package java.utl does not exist",
            "package ",
            " does not exist"
        ),
        vec!["java.utl".to_string()]
    );
    assert!(
        named("no such module 'Algorithm", "no such module '", "'").is_empty(),
        "a delimiter the line never closed is a sentence this arm did not recognise"
    );
    assert!(
        named("nothing to see here", "`", "`").is_empty(),
        "a line with no delimiter names nothing"
    );
}
