use super::*;

#[test]
fn a_gzipped_json_document_is_labelled_json_and_gzip_encoded() {
    let labels = for_gz("no-tunnel__serve.json.gz");
    assert_eq!(labels.content_type, "application/json");
    assert_eq!(labels.content_encoding, Some("gzip"));
}

#[test]
fn the_run_archive_is_a_gzip_document_and_carries_no_content_encoding() {
    // Labelling this one would have a client silently inflate the archive, handing
    // back a bare tar under a `.tar.gz` name.
    let labels = for_gz("archive.tar.gz");
    assert_eq!(labels.content_type, "application/gzip");
    assert_eq!(labels.content_encoding, None);
}

#[test]
fn the_two_are_told_apart_by_the_compound_suffix_not_the_last_extension() {
    // Both names have the single extension `gz`, so matching on it alone cannot
    // distinguish them.
    assert_ne!(for_gz("replay.json.gz"), for_gz("run-abc.tar.gz"));
}

#[test]
fn an_unrecognized_gz_is_served_as_the_gzip_document_it_is() {
    // The safe direction: an unlabelled body is never inflated by mistake.
    assert_eq!(for_gz("dump.gz"), ContentLabels::plain("application/gzip"));
    assert_eq!(
        for_gz("events.jsonl.gz"),
        ContentLabels::plain("application/gzip")
    );
}

#[test]
fn the_suffix_match_ignores_case() {
    assert_eq!(for_gz("SERVE.JSON.GZ").content_encoding, Some("gzip"));
}
