//! Tests of the session record's published form.

use std::io::Write as _;

use super::*;

const KEY: &str = "sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01";

fn gzip(plain: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(plain).unwrap();
    encoder.finish().unwrap()
}

fn export(stored: &[u8]) -> Result<(Vec<u8>, bool), RecordFailure> {
    export_record(stored, &SecretScrubber::new(), usize::MAX)
}

fn md5_of(bytes: &[u8]) -> [u8; 16] {
    md5::Digest::finalize(md5::Digest::chain_update(md5::Md5::default(), bytes)).into()
}

#[test]
fn a_record_is_published_as_its_own_json_in_its_own_order() {
    let stored = br#" { "zeta" : [1, -2, 3.5, true, null, "text"],
        "alpha" : { "nested" : { "deep" : [ ] } }, "empty" : { } } "#;
    let (bytes, redacted) = export(stored).unwrap();
    assert!(!redacted);
    // Whitespace goes; the keys stay in the order the record wrote them.
    assert_eq!(
        String::from_utf8(bytes).unwrap(),
        r#"{"zeta":[1,-2,3.5,true,null,"text"],"alpha":{"nested":{"deep":[]}},"empty":{}}"#
    );
}

#[test]
fn a_repeated_key_and_a_wide_integer_survive() {
    let (bytes, _) =
        export(br#"{"a":1,"a":2,"n":18446744073709551615,"m":-9223372036854775808}"#).unwrap();
    assert_eq!(
        String::from_utf8(bytes).unwrap(),
        r#"{"a":1,"a":2,"n":18446744073709551615,"m":-9223372036854775808}"#
    );
}

#[test]
fn every_string_and_every_key_is_scrubbed() {
    let stored = format!(
        r#"{{"messages":[{{"body":"export KEY={KEY}"}}],"arguments":{{"{KEY}":1,"{KEY}x":2,"clean":"{KEY}"}}}}"#
    );
    let (bytes, redacted) = export(stored.as_bytes()).unwrap();
    assert!(redacted);
    let text = String::from_utf8(bytes).unwrap();
    assert!(!text.contains("sk-ant"), "{text}");
    // Two keys redacted to one text stay two members.
    assert_eq!(
        text,
        r#"{"messages":[{"body":"export KEY=[REDACTED]"}],"arguments":{"[REDACTED]":1,"[REDACTED] (2)":2,"clean":"[REDACTED]"}}"#
    );
    // The form parses, and holds every member.
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["arguments"].as_object().unwrap().len(), 3);
}

#[test]
fn a_gzip_record_of_one_member_or_several_is_read_whole() {
    let plain = br#"{"turns":[{"text":"one"},{"text":"two"}]}"#;
    let (from_plain, _) = export(plain).unwrap();
    assert_eq!(export(&gzip(plain)).unwrap().0, from_plain);
    // Two members that are one document between them.
    let (head, tail) = plain.split_at(17);
    let mut members = gzip(head);
    members.extend(gzip(tail));
    assert_eq!(export(&members).unwrap().0, from_plain);
}

#[test]
fn bytes_that_are_not_one_document_have_no_published_form() {
    for stored in [
        &b"prompt, not json"[..],
        br#"{"cut": "#,
        br#"{"one":1} {"two":2}"#,
        b"",
        b" ",
        // The gzip magic and nothing that inflates.
        &[0x1f, 0x8b, 0x00, 0x01, 0x02],
    ] {
        assert_eq!(
            export(stored).unwrap_err(),
            RecordFailure::NotADocument,
            "{stored:?}"
        );
        assert_eq!(record_digest(stored), None, "{stored:?}");
    }
    // A gzip member cut short.
    let whole = gzip(br#"{"turns":["a long enough body to be cut somewhere inside"]}"#);
    assert_eq!(
        export(&whole[..whole.len() / 2]).unwrap_err(),
        RecordFailure::NotADocument
    );
}

#[test]
fn a_record_over_the_bound_is_refused_and_one_at_it_is_not() {
    let stored = br#"{"text":"0123456789"}"#;
    let (bytes, _) = export(stored).unwrap();
    let scrubber = SecretScrubber::new();
    assert_eq!(
        export_record(&stored[..], &scrubber, bytes.len())
            .unwrap()
            .0,
        bytes
    );
    assert_eq!(
        export_record(&stored[..], &scrubber, bytes.len() - 1).unwrap_err(),
        RecordFailure::TooLarge
    );
    // A record that inflates far past the bound is refused without being held.
    let large = format!(r#"{{"text":"{}"}}"#, "x".repeat(4 * 1024 * 1024));
    assert_eq!(
        export_record(&gzip(large.as_bytes())[..], &scrubber, 64 * 1024).unwrap_err(),
        RecordFailure::TooLarge
    );
}

#[test]
fn the_digest_is_of_the_bytes_a_refresh_uploads() {
    let stored = format!(
        r#"{{"seed":{{"prompt":"build it"}},"turns":[{{"n":1.50,"key":"{KEY}"}},{{"n":2e3}}]}}"#
    );
    for stored in [stored.as_bytes().to_vec(), gzip(stored.as_bytes())] {
        let (bytes, _) = export(&stored).unwrap();
        assert_eq!(
            record_digest(&stored[..]),
            Some((bytes.len() as u64, md5_of(&bytes)))
        );
    }
}

#[test]
fn a_record_is_read_a_part_at_a_time() {
    /// Hands out one byte per read, as a reader is free to.
    struct Trickle<'a>(&'a [u8]);
    impl std::io::Read for Trickle<'_> {
        fn read(&mut self, into: &mut [u8]) -> std::io::Result<usize> {
            let Some((first, rest)) = self.0.split_first() else {
                return Ok(0);
            };
            into[0] = *first;
            self.0 = rest;
            Ok(1)
        }
    }
    let plain = br#"{"turns":[{"text":"one"}]}"#;
    let zipped = gzip(plain);
    let (expected, _) = export(plain).unwrap();
    let scrubber = SecretScrubber::new();
    for stored in [&plain[..], &zipped[..]] {
        let (bytes, _) = export_record(Trickle(stored), &scrubber, usize::MAX).unwrap();
        assert_eq!(bytes, expected);
    }
}
