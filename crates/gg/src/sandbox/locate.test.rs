//! **What a source map is allowed to change about a frame**, driven against maps written by hand so
//! the expected answer is arithmetic nobody has to trust.
//!
//! The arm's own end-to-end proof is `typescript.substrate.test.rs`, which runs a real program
//! through a real `tsc` and a real guest. These are the unit checks under it: the reader finds the
//! map, the rewrite moves the numbers the map says to move, a name no map covers is left exactly as
//! the engine wrote it, and a frame naming a place the model has no program at is struck.

use super::Locations;

/// A map from a two-line generated text to a four-line source, as a `sourceMappingURL` comment.
///
/// Written out rather than generated: the point of these tests is that the *reader* is right, and a
/// map produced by the same library that reads it would prove nothing about the format.
fn inline(mappings: &str, source: &str) -> String {
    let map = serde_json::json!({
        "version": 3,
        "file": "program.js",
        "sources": [source],
        "names": [],
        "mappings": mappings,
    });
    let encoded = base64_encode(&serde_json::to_string(&map).expect("the map serialises"));
    format!("//# sourceMappingURL=data:application/json;base64,{encoded}")
}

/// Standard base64, which is what a `data:` URL carries.
fn base64_encode(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(text)
}

/// Generated line 1 column 1 is source line 3 column 1; generated line 2 column 1 is source line 5
/// column 3. Both are the `AAAA`-style VLQ groups a real map is made of.
const MAPPINGS: &str = "AAEA;AAEE";

/// **A frame is rewritten into the file, line and column the map resolves to.**
#[test]
fn a_mapped_frame_reads_as_its_own_source() {
    let source = format!(
        "const a = 1;\nconst b = 2;\n{}",
        inline(MAPPINGS, "program.ts")
    );
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map");
    assert_eq!(
        locations.rewrite("    at inner (program.js:1:1)"),
        "    at inner (program.ts:3:1)"
    );
    assert_eq!(
        locations.rewrite("    at outer (program.js:2:1)"),
        "    at outer (program.ts:5:3)"
    );
}

/// **A frame in a name no map covers is left exactly as the engine wrote it.**
///
/// The SDK's own frames are the reason: `sdk:gg/files.js` is gg's code, reported at gg's own
/// coordinates, and a rewrite that guessed at one would be gg's account of a failure in front of the
/// engine's.
#[test]
fn an_unmapped_frame_is_untouched() {
    let source = format!("const a = 1;\n{}", inline(MAPPINGS, "program.ts"));
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map");
    let said = "    at readFile (sdk:gg/files.js:31:11)";
    assert_eq!(locations.rewrite(said), said);
}

/// **A mention of the name that is not a frame is left alone**, so a message naming the file does
/// not acquire coordinates.
#[test]
fn a_name_without_a_position_is_left_alone() {
    let source = format!("const a = 1;\n{}", inline(MAPPINGS, "program.ts"));
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map");
    let said = "SyntaxError: program.js could not be parsed";
    assert_eq!(locations.rewrite(said), said);
}

/// **A caller may name what a frame reads as**, which is what a code module needs: its map's own
/// source is the file `tsc` compiled, and the name that identifies it to a reader is the specifier
/// the program imported it by.
#[test]
fn a_caller_may_name_what_a_frame_reads_as() {
    let source = format!("const a = 1;\n{}", inline(MAPPINGS, "module.ts"));
    let locations = Locations::read([(
        "lib:helper".to_string(),
        Some("lib:helper".to_string()),
        source.as_str(),
    )])
    .expect("the source carries a map");
    assert_eq!(
        locations.rewrite("    at firstWord (lib:helper:1:1)"),
        "    at firstWord (lib:helper:3:1)"
    );
}

/// **A source with no map contributes nothing**, and a set with no maps at all is `None` rather than
/// an identity rewrite nobody has to run.
#[test]
fn a_source_with_no_map_contributes_nothing() {
    assert!(Locations::read([("program.js".to_string(), None, "const a = 1;\n")]).is_none());
}

/// **A position the map does not resolve is struck, and the striking is counted.**
///
/// A generated line past the end of the mappings is text the compiler added of its own. Reporting
/// the nearest thing that happens to have a token would be gg inventing a location, and reporting
/// the engine's own coordinate would name a line in a program the model has never seen — so the
/// frame goes, and the report closes by saying how many did.
#[test]
fn an_unresolvable_position_is_struck_and_counted() {
    let source = format!("const a = 1;\n{}", inline(MAPPINGS, "program.ts"));
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map");
    assert_eq!(
        locations.rewrite(
            "Error: boom\n    at inner (program.js:1:1)\n    at <anonymous> (program.js:900:1)\n"
        ),
        "Error: boom\n    at inner (program.ts:3:1)\n… and 1 more frame (external code)"
    );
}

/// **A frame in a source gg itself wrote is struck**, which is what a bundled arm's generated entry
/// module is: it resolves perfectly well, and what it resolves to is a file the model never wrote
/// and cannot open.
#[test]
fn a_frame_in_ggs_own_source_is_struck() {
    let source = format!("const a = 1;\n{}", inline(MAPPINGS, "entry.js"));
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map")
        .hiding(["entry.js".to_string()]);
    assert_eq!(
        locations.rewrite("Error: boom\n    at <anonymous> (program.js:1:1)\n"),
        "Error: boom\n… and 1 more frame (external code)"
    );
}

/// **A source gg's own is named by prefix, so a whole directory is hidden at once.**
///
/// A bundled arm compiles gg's own SDK into the model's program, and the SDK arrives in the map as
/// every one of its own module paths rather than as one file name. The test is written against the
/// resolved source rather than the rendered frame because that is where the knowledge is: the frame
/// reads `libs/gg-sdk/src/Gg/Views.purs:3:1`, and only the map says which of the bundle's sources
/// produced it.
#[test]
fn a_frame_under_a_hidden_prefix_is_struck() {
    let source = format!(
        "const a = 1;\n{}",
        inline(MAPPINGS, "libs/gg-sdk/src/Gg/Views.purs")
    );
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map")
        .hiding(["libs/gg-sdk/".to_string()]);
    assert_eq!(
        locations.rewrite("Error: boom\n    at <anonymous> (program.js:1:1)\n"),
        "Error: boom\n… and 1 more frame (external code)"
    );
}

/// **A prefix matches at the start of the source's name and nowhere else.**
///
/// The name a map resolves to is a path, and the same directory name deeper in one is a different
/// place: a library that happened to vendor a directory called `gg-sdk` is code the model's program
/// really was compiled against, so its frames are reported.
#[test]
fn a_prefix_matched_later_in_a_path_is_kept() {
    let source = format!(
        "const a = 1;\n{}",
        inline(MAPPINGS, "libs/vendored-7.0.0/libs/gg-sdk/src/Main.purs")
    );
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map")
        .hiding(["libs/gg-sdk/".to_string()]);
    assert_eq!(
        locations.rewrite("    at inner (program.js:1:1)"),
        "    at inner (libs/vendored-7.0.0/libs/gg-sdk/src/Main.purs:3:1)"
    );
}

/// **A line the map has a token on, but none at or before the position the engine named, answers
/// with that line's first token.**
///
/// A compiler maps a compound expression to the innermost token it emitted, which can sit past the
/// column the engine reports the frame at. The answer is still the map's, about the generated line
/// the engine named, rather than a number computed here.
#[test]
fn the_first_token_on_the_line_answers_when_nothing_is_at_or_before() {
    // Generated line 1, column 10 → source line 3, column 1. Nothing is mapped at column 1.
    let source = format!("const a = 1;\n{}", inline("SAEA", "program.ts"));
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map");
    assert_eq!(
        locations.rewrite("    at inner (program.js:1:1)"),
        "    at inner (program.ts:3:1)"
    );

    // The same, where the token at or before the position is on an EARLIER generated line: the
    // lookup answers with it, and it is rejected in favour of the queried line's own first token.
    let source = format!("const a = 1;\n{}", inline("AAEA;SAEE", "program.ts"));
    let locations = Locations::read([("program.js".to_string(), None, source.as_str())])
        .expect("the source carries a map");
    assert_eq!(
        locations.rewrite("    at inner (program.js:2:1)"),
        "    at inner (program.ts:5:3)"
    );
}
