//! Tests for the [encoding](super) the JVM arms reach gg through.
//!
//! The guest half of this is Java (`packages/gg-sandbox-java/src/gg/internal/Coding.java`) and is
//! exercised where it belongs — end to end, through a real compiled program, in
//! `crates/gg/src/sandbox/language/jvm.wire.test.rs`. What is asserted here is the half that can be
//! asserted cheaply and exhaustively: that a value survives the round trip, and that every way a
//! frame can be wrong is a fault rather than a plausible wrong answer.

use super::*;

/// Encode a value as a request would carry it, so the reader can be driven from a writer.
fn request(arguments: &[Value]) -> Vec<u8> {
    let mut out = Vec::new();
    write(&mut out, &Value::List(arguments.to_vec()));
    out
}

/// Every shape of value survives the crossing unchanged.
#[test]
fn every_shape_of_value_round_trips() {
    let values = vec![
        Value::None,
        Value::Bool(true),
        Value::Bool(false),
        Value::Int(0),
        Value::Int(-1),
        Value::Int(i64::MIN),
        Value::Int(i64::MAX),
        Value::Float(0.5),
        Value::Float(-0.0),
        Value::Text(String::new()),
        Value::Text("a path with a — dash and a 日本語 word".to_string()),
        Value::List(Vec::new()),
        Value::List(vec![Value::Int(1), Value::Text("two".to_string())]),
        Value::Record(Vec::new()),
        record([
            ("exit-code", Value::Int(0)),
            ("output", Value::Text("done".to_string())),
            ("truncated", Value::Bool(false)),
        ]),
        Value::List(vec![record([(
            "nested",
            Value::List(vec![Value::None, record([("deep", Value::Bool(true))])]),
        )])]),
    ];

    let decoded = decode_request(&request(&values)).expect("the frame decodes");
    assert_eq!(decoded, values, "a value changed on the way across");
}

/// A `u64` crosses whole. It is reinterpreted rather than saturated, so the top bit survives.
#[test]
fn a_wide_number_keeps_every_bit() {
    let decoded = decode_request(&request(&[wide(u64::MAX), wide(0), wide(1 << 62)]))
        .expect("the frame decodes");
    assert_eq!(
        decoded,
        vec![Value::Int(-1), Value::Int(0), Value::Int(1 << 62)],
        "a wide number was not reinterpreted"
    );
}

/// A response says which of the two things happened in its first byte, and both round trip.
#[test]
fn a_response_is_an_answer_or_three_fields() {
    let ok = encode_ok(&Value::Text("hello".to_string()));
    assert_eq!(ok[0], RESPONSE_OK, "a successful response is not tagged 0");
    assert_eq!(
        decode_response(&ok).expect("decodes"),
        Ok(Value::Text("hello".into()))
    );

    let failed = encode_error("read_file", "not-found", "`notes.txt` does not exist");
    assert_eq!(
        failed[0], RESPONSE_ERROR,
        "a failed response is not tagged 1"
    );
    assert_eq!(
        decode_response(&failed).expect("decodes"),
        Err((
            "read_file".to_string(),
            "not-found".to_string(),
            "`notes.txt` does not exist".to_string(),
        ))
    );
}

/// A frame that stops early is a fault, not a short read.
#[test]
fn a_truncated_frame_faults() {
    let whole = request(&[Value::Text("notes.txt".to_string())]);
    for cut in 0..whole.len() {
        assert!(
            decode_request(&whole[..cut]).is_err(),
            "a frame cut to {cut} of {} bytes decoded anyway",
            whole.len()
        );
    }
}

/// A frame with anything after the arguments is a fault, because the two sides disagree about the
/// shape and reading the prefix is how a disagreement becomes a wrong answer.
#[test]
fn a_frame_with_trailing_bytes_faults() {
    let mut whole = request(&[Value::Int(1)]);
    whole.push(0);
    let fault = decode_request(&whole).expect_err("trailing bytes are a fault");
    assert!(
        fault.to_string().contains("after the arguments"),
        "the fault does not say what was wrong: {fault}"
    );
}

/// A tag no value has is a fault naming the offset, so a drifted guest is debuggable.
#[test]
fn an_unknown_tag_faults() {
    let fault = decode_request(&[99]).expect_err("tag 99 is not a value");
    assert!(
        fault.to_string().contains("99"),
        "the fault does not name the tag: {fault}"
    );
}

/// A request that is not a list of arguments is a fault: every call sends a list, including the ones
/// with no arguments at all.
#[test]
fn a_request_that_is_not_an_argument_list_faults() {
    let mut framed = Vec::new();
    write(&mut framed, &Value::Text("notes.txt".to_string()));
    let fault = decode_request(&framed).expect_err("a bare string is not a request");
    assert!(
        fault
            .to_string()
            .contains("rather than a list of arguments"),
        "the fault does not say what arrived: {fault}"
    );
}

/// A length that claims more than the frame holds is a fault rather than a panic or a slice out of
/// somebody else's bytes.
#[test]
fn a_length_past_the_end_of_the_frame_faults() {
    // A list saying it holds four billion values, and then nothing.
    let framed = [6, 0xff, 0xff, 0xff, 0xff];
    assert!(
        decode_request(&framed).is_err(),
        "a list claiming u32::MAX values decoded"
    );
    // A string saying it is four billion bytes long, and then nothing.
    let framed = [6, 1, 0, 0, 0, 5, 0xff, 0xff, 0xff, 0xff];
    assert!(
        decode_request(&framed).is_err(),
        "a string claiming u32::MAX bytes decoded"
    );
}

/// A string whose bytes are not UTF-8 is a fault rather than a lossy conversion, because a guest
/// that lowered a Java `String` cannot produce one and every offset after it is meaningless.
#[test]
fn a_string_that_is_not_utf8_faults() {
    let framed = [6, 1, 0, 0, 0, 5, 2, 0, 0, 0, 0xff, 0xfe];
    let fault = decode_request(&framed).expect_err("invalid UTF-8 is a fault");
    assert!(
        fault.to_string().contains("UTF-8"),
        "the fault does not say what was wrong: {fault}"
    );
}

/// An argument read as the wrong shape says so in words a developer chasing drift can act on.
#[test]
fn reading_an_argument_as_the_wrong_shape_names_both_sides() {
    let fault = Value::Int(3)
        .text("the path")
        .expect_err("a number is not text");
    assert_eq!(
        fault.to_string(),
        "the path arrived as a whole number rather than text"
    );

    let fault = Value::Text("x".into())
        .list("the ranges")
        .expect_err("text is not a list");
    assert_eq!(
        fault.to_string(),
        "the ranges arrived as text rather than a list"
    );

    let fault = record([("a", Value::None)])
        .field("the patch", "title")
        .expect_err("a missing field is a fault");
    assert_eq!(fault.to_string(), "the patch carried no `title` field");
}

/// A whole number outside the width the call takes is a fault rather than a silent truncation.
#[test]
fn a_number_outside_the_calls_width_faults() {
    assert_eq!(
        Value::Int(7).integer::<u32>("the offset").expect("fits"),
        7_u32
    );
    let fault = Value::Int(-1)
        .integer::<u32>("the offset")
        .expect_err("a negative offset does not fit u32");
    assert!(
        fault.to_string().contains("outside the range"),
        "the fault does not say what was wrong: {fault}"
    );
}

/// A whole number is accepted where a double is wanted, so a guest whose own type for `timeout-secs`
/// is an integer does not have to know that this one argument is different.
#[test]
fn a_whole_number_is_accepted_as_a_double() {
    assert_eq!(
        Value::Int(30)
            .optional_number("the timeout")
            .expect("reads"),
        Some(30.0)
    );
    assert_eq!(
        Value::Float(1.5)
            .optional_number("the timeout")
            .expect("reads"),
        Some(1.5)
    );
    assert_eq!(
        Value::None.optional_number("the timeout").expect("reads"),
        None
    );
}

/// An argument the call was not given is a fault naming the call and the count, which is what a
/// developer reading a drift report needs.
#[test]
fn a_missing_argument_names_the_call() {
    let fault = argument(&[], "files.read_file", 0).expect_err("there is no argument 0");
    assert_eq!(
        fault.to_string(),
        "`files.read_file` was called with 0 arguments and wants at least 1"
    );
}
