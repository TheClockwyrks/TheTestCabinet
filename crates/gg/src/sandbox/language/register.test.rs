//! Tests for [the register gate](super).
//!
//! Half of these are **teeth**: each takes the clean v2 fixture, damages one description in one
//! specific way, and asserts the gate names it. A register gate nobody has watched fail is a gate
//! that will still be green the day the prose decays back into what it is today, which is the exact
//! failure it was written to prevent.

use serde_json::Value;

use super::*;
use crate::sandbox::signatures::fixture;

/// The complaints against a fixture whose `edit` damaged one description, as strings.
fn against(edit: impl FnOnce(&mut Value)) -> Vec<String> {
    complaints(fixture::v2_with(edit))
        .into_iter()
        .map(|complaint| complaint.to_string())
        .collect()
}

/// **The clean fixture passes.** Everything below is a statement about the damage rather than about
/// the fixture only because this holds.
#[test]
fn prose_written_in_the_register_passes() {
    assert_eq!(complaints(fixture::v2()), Vec::new());
}

/// **Every registered arm's prose passes**, and the two halves of that sentence mean different
/// things.
///
/// For an arm that has not been converted it means the gate is **inert**, which is the property
/// that lets the arms move one commit at a time: a v1 catalogue's brief is derived from a paragraph
/// nobody wrote to have one, and holding a derived line to a rule about authored lines would fail
/// ten arms for a property none of them has claimed.
///
/// For a converted arm it means the gate **passed** — every brief one line, every detail in the
/// register, every parameter description short and closed, and every operation id resolving to a
/// row of gg's table. That is the whole of what this file exists to assert, and it is asserted here
/// over each arm's real catalogue rather than over the fixture, because a fixture that passes
/// says nothing about the arm a model actually runs on.
///
/// One test for the two because the list of converted arms belongs in one place
/// (`crate::sandbox::signatures`'s `CONVERTED`), and because the assertion is
/// literally the same call either way: *no complaints*.
#[test]
fn every_registered_arms_prose_passes_the_register() {
    assert_eq!(complaints(fixture::v1()), Vec::new());
    for language in crate::sandbox::all_languages() {
        let found = complaints(language.catalogue());
        assert!(
            found.is_empty(),
            "{}'s documentation departs from the register:{}",
            language.display_name(),
            found
                .iter()
                .map(|complaint| format!("\n  - {complaint}"))
                .collect::<String>()
        );
    }
}

/// **A brief of more than one line is caught** — the structural check, and the one that would have
/// caught the swallowed-paragraph defect independently of any extractor.
#[test]
fn a_brief_of_more_than_one_line_is_caught() {
    let complaints = against(|json| {
        json["functions"][3]["brief"] =
            "Read a file's bytes into the program.\n\nAnd then narrow it.".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("more than one line")),
        "{complaints:?}"
    );
}

/// **A brief longer than the cap is caught.**
///
/// The value being defended is not brevity for its own sake: it is that the field is a *brief*, and
/// a paragraph pasted into it reaches the model where one line was promised. Measured over today's
/// catalogues, the longest derived first line is 249 characters on seven of the eleven
/// arms and 1,239 on Python — which is why this rule waits for an arm to be converted rather than
/// applying now.
#[test]
fn a_brief_over_the_cap_is_caught() {
    let complaints = against(|json| {
        json["functions"][3]["brief"] =
            "Read a file's bytes into the program, returning either the \
             decoded text or the raw image bytes, and never showing the picture to the model that \
             asked for it."
                .into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("capped at 120")),
        "{complaints:?}"
    );
}

/// **An unclosed code span is caught** — the defect the first-sentence derivation produced on the
/// two ECMAScript arms, where a brief ended mid-span with a dangling backtick.
#[test]
fn an_unbalanced_code_span_is_caught() {
    let complaints = against(|json| {
        json["functions"][3]["brief"] =
            "Read a file, returning either `{ kind: \"text\" ...".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("unclosed code span")),
        "{complaints:?}"
    );
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("`{` unclosed inside a code span")),
        "an unclosed brace is a separate fault from an unclosed span: {complaints:?}"
    );

    // And brackets are counted **inside a code span only**, because prose balances its own by
    // different rules: a half-open range is correct English and a bracket counter reading the whole
    // line would call it a fragment.
    let innocent = against(|json| {
        json["functions"][3]["brief"] = "Reads the half-open range [0, n) of a file.".into();
    });
    assert_eq!(innocent, Vec::<String>::new(), "{innocent:?}");
}

/// **A span that quotes a delimiter is a quotation, not a fragment.**
///
/// An SDK about paths, selectors and JSON documents its own delimiters, and the three below are the
/// ordinary way to do it. The check is a balance check over what a span *contains*, so a span whose
/// whole content is the bracket has nothing to balance — while a span carrying anything else beside
/// one is still the truncation the rule was written for.
#[test]
fn a_span_that_quotes_a_delimiter_is_not_unclosed() {
    for brief in [
        "Splits the path on `(`.",
        "The `[` that opens an index.",
        "Writes `}` at the end of the record.",
        // The doubled brace a format string escapes one with is the same quotation, twice.
        "Writes `{{` for a literal brace.",
    ] {
        let innocent = against(|json| {
            json["functions"][3]["brief"] = brief.into();
        });
        assert_eq!(innocent, Vec::<String>::new(), "{brief:?}");
    }

    // And a span carrying a bracket beside anything at all is checked exactly as it was: the
    // fragment is what an identifier before the bracket makes it.
    let truncated = against(|json| {
        json["functions"][3]["brief"] = "Reads a file with `read_file(path`.".into();
    });
    assert!(
        truncated
            .iter()
            .any(|complaint| complaint.contains("`(` unclosed inside a code span")),
        "{truncated:?}"
    );
}

/// **A brief that opens with a connective is the tail of a paragraph**, not a brief.
#[test]
fn a_brief_that_opens_with_a_connective_is_caught() {
    let complaints = against(|json| {
        json["functions"][3]["brief"] = "And it reads the file into the program.".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("opens its brief with `and`")),
        "{complaints:?}"
    );
}

/// **Second person is caught, on whole words only**: the register describes the call rather than
/// instructing its caller.
#[test]
fn second_person_is_caught_and_only_as_a_whole_word() {
    let complaints = against(|json| {
        json["functions"][3]["brief"] = "Reads bytes into your program.".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("addresses the model as `your`")),
        "{complaints:?}"
    );

    // `youth` is not `you`, and a substring match would make this gate about letters rather than
    // about who is being addressed.
    let innocent = against(|json| {
        json["functions"][3]["brief"] = "Reads a file written in the youth of the project.".into();
    });
    assert_eq!(innocent, Vec::<String>::new(), "{innocent:?}");
}

/// **Shouting is caught**: a phrase of capitals, unbroken by so much as a comma, is emphasis.
///
/// `NOT A FAILURE` is the module header's own example of the register this gate exists to hold, and
/// it is here because it is the case the rule used to *miss* — `NOT` and `A` were too short to count
/// as words at all, so the one phrase the documentation named passed.
#[test]
fn shouted_emphasis_is_caught() {
    for (brief, shouted) in [
        ("Reading an image NEVER EVER SHOWS it.", "NEVER EVER SHOWS"),
        ("An empty read is NOT A FAILURE.", "NOT A FAILURE"),
    ] {
        let complaints = against(|json| {
            json["functions"][3]["brief"] = brief.into();
        });
        assert!(
            complaints
                .iter()
                .any(|complaint| complaint.contains(&format!("shouts `{shouted}`"))),
            "{brief:?}: {complaints:?}"
        );
    }
}

/// **Two adjacent acronyms are prose, not shouting** — the direction that matters most, because the
/// prose being refused here is correct English an SDK about wire formats cannot avoid writing.
///
/// Nothing about `ASCII TEXT` distinguishes it from `NEVER SHOWS`: both are two all-capital words of
/// four and five letters. That is why the rule counts three, and why a token carrying a digit, a
/// hyphen or an underscore — `UTF-8`, `PREVIEW1` — is vocabulary whatever it sits beside.
#[test]
fn adjacent_acronyms_are_not_shouting() {
    for brief in [
        "Decodes UTF-8 JSON bytes into a record.",
        "Returns HTTP JSON.",
        "Reads the WASI PREVIEW1 descriptor table.",
        "Emits ASCII TEXT only.",
        // A list of abbreviations is vocabulary however long it runs, because emphasis is a phrase
        // and a phrase is not punctuated between its own words.
        "Returns HTTP, JSON, ASCII payloads.",
        "Reads a file and decodes it as UTF-8 text.",
    ] {
        let innocent = against(|json| {
            json["functions"][3]["brief"] = brief.into();
        });
        assert_eq!(innocent, Vec::<String>::new(), "{brief:?}");
    }
}

/// **A missing brief is one complaint, not six.** An absent string fails every rule below it, and
/// reporting all of them would bury the one that says what to do.
#[test]
fn an_absent_brief_is_reported_once() {
    let complaints = against(|json| {
        json["functions"][3]["brief"] = "".into();
    });
    assert_eq!(complaints.len(), 1, "{complaints:?}");
    assert!(complaints[0].contains("has no brief"), "{complaints:?}");
}

/// **A detail that opens by repeating the brief is caught**: the first thing the model reads twice
/// is the only thing it had already read.
#[test]
fn a_detail_that_repeats_the_brief_is_caught() {
    let complaints = against(|json| {
        json["functions"][3]["detail"] = "Read a file's bytes into the program.".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("verbatim")),
        "{complaints:?}"
    );
}

/// **One fenced example in a detail is permitted; two are not.**
///
/// The permission is deliberate. On five of the six compiled arms the fenced narrowing block inside
/// `read_file` is the only place the closed-union idiom is taught, and a rule that deleted it to
/// satisfy "never narrative" would delete real teaching.
#[test]
fn a_detail_may_carry_one_fenced_example_and_not_two() {
    let one = against(|json| {
        json["functions"][3]["detail"] =
            "Narrow the result before use.\n\n```\nmatch read { … }\n```".into();
    });
    assert_eq!(one, Vec::<String>::new(), "{one:?}");

    let two = against(|json| {
        json["functions"][3]["detail"] =
            "Narrow the result before use.\n\n```\nmatch read { … }\n```\n\n```\nif let … {}\n```"
                .into();
    });
    assert!(
        two.iter()
            .any(|complaint| complaint.contains("2 fenced examples")),
        "{two:?}"
    );
}

/// **A fenced block belongs in the detail and never in the brief**, whose whole job is to be one
/// line.
#[test]
fn a_fenced_block_in_a_brief_is_caught() {
    let complaints = against(|json| {
        json["functions"][3]["brief"] = "Reads a file: ```read_file(path)```".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("fenced block in its brief")),
        "{complaints:?}"
    );
}

/// **A module's own header is prose a model reads**, so it is held to the same rule.
#[test]
fn a_modules_brief_is_held_to_the_same_rule() {
    let complaints = against(|json| {
        json["modules"][0]["brief"] = "Reads and writes the files in your workspace.".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("gg::files") && complaint.contains("`your`")),
        "{complaints:?}"
    );
}

/// **A parameter's line is prose a model reads**, and is held to the brief's shape — while carrying
/// no length cap of its own, because what a parameter has to say is short by nature.
#[test]
fn a_parameter_is_held_to_the_shape_and_not_to_the_cap() {
    let complaints = against(|json| {
        json["functions"][3]["signatures"][0]["parameters"][0]["doc"] =
            "The file to read.\nRelative to the workspace.".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("read_file(path)")
                && complaint.contains("more than one line")),
        "{complaints:?}"
    );

    let long = against(|json| {
        json["functions"][3]["signatures"][0]["parameters"][0]["doc"] = "The file to read, given \
             relative to the workspace root rather than to the directory any earlier command \
             happened to leave the program in, which is the distinction this argument exists to \
             make explicit."
            .into();
    });
    assert_eq!(
        long,
        Vec::<String>::new(),
        "a parameter carries no length cap: {long:?}"
    );
}

/// **A type, its members and the member functions it lists are all prose a model reads**, and all
/// three are held to the rule.
#[test]
fn a_types_own_prose_is_held_to_the_rule() {
    let complaints = against(|json| {
        json["types"][0]["brief"] = "The result of YOUR OWN FILE read.".into();
        json["types"][0]["members"][0]["brief"] = "A text file.\nDecoded.".into();
        json["types"][1]["memberFunctions"][0]["brief"] = "And it closes the view.".into();
    });
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("gg::files::FileRead:")
                && complaint.contains("shouts")),
        "{complaints:?}"
    );
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("FileRead.Text")
                && complaint.contains("more than one line")),
        "{complaints:?}"
    );
    assert!(
        complaints
            .iter()
            .any(|complaint| complaint.contains("OpenView::close")
                && complaint.contains("opens its brief with `and`")),
        "{complaints:?}"
    );
}

/// **A misspelled operation id fails, by arm, by entry and by id.**
///
/// This is the one complaint that is not about prose, and it is the loudest thing in the file. An id
/// gg has no row for is read everywhere downstream as *this agent does not have that operation*:
/// [`bound`](crate::docs::DocsRuntime::bound) refuses it, the search index skips it, and the
/// function is then absent from every search and from every documentation view — while the SDK
/// still compiles it and still documents it to every human who reads the source. One
/// character costs a capability and nothing else in the tree changes colour.
///
/// A converted arm writes about forty-seven of these by hand, which is why the gate quotes the id
/// back rather than reporting that something did not resolve.
#[test]
fn an_operation_id_gg_does_not_have_is_caught() {
    let complaints = against(|json| {
        json["functions"][3]["operation"] = "files.raed_file".into();
    });
    assert_eq!(complaints.len(), 1, "{complaints:?}");
    assert!(
        complaints[0].starts_with("[rust] gg::files::read_file:")
            && complaints[0].contains("`files.raed_file`"),
        "a complaint has to name the arm, the entry and the id it could not resolve: {complaints:?}"
    );
}

/// **And in the two places where nothing else in the tree would notice.**
///
/// `every_catalogued_function_has_an_operation` reads the projection, and the projection carries one
/// id per entry — so an [alias](crate::sandbox::signatures::FunctionSignature::alias_of) and the
/// operation a type writes beside a [member function](crate::sandbox::signatures::MemberFunction)
/// are ids no other gate looks at. A typo in either is silent everywhere else.
#[test]
fn a_misspelled_alias_or_member_operation_is_caught() {
    let alias = against(|json| {
        json["functions"][1]["aliasOf"] = "views.cloze".into();
    });
    assert_eq!(alias.len(), 1, "{alias:?}");
    assert!(
        alias[0].starts_with("[rust] gg::views::OpenView::close:") && alias[0].contains("cloze"),
        "{alias:?}"
    );

    let member = against(|json| {
        json["types"][1]["memberFunctions"][0]["operation"] = "views.cloze".into();
    });
    assert_eq!(member.len(), 1, "{member:?}");
    assert!(
        member[0].starts_with("[rust] gg::views::OpenView::close:")
            && member[0].contains("gg::views::OpenView")
            && member[0].contains("cloze"),
        "{member:?}"
    );
}

/// **A complaint says whose catalogue it is and what in it is wrong**, because a gate that runs over
/// eleven arms and reports a bare sentence is a gate whose failure costs a bisect.
#[test]
fn a_complaint_names_the_arm_and_the_subject() {
    let complaint = complaints(fixture::v2_with(|json| {
        json["functions"][3]["brief"] = "".into();
    }))
    .pop()
    .expect("the damaged fixture complains");
    assert_eq!(complaint.subject, "gg::files::read_file");
    assert!(
        complaint
            .to_string()
            .starts_with("[rust] gg::files::read_file")
    );
}
