//! Tests for the shared object shapes: cutting a body into pieces and the HTTP
//! date both stores speak.

use bytes::Bytes;
use time::macros::datetime;

use super::*;

/// A body delivered in the given chunks.
fn body(chunks: &[&[u8]]) -> ObjectBody {
    let chunks: Vec<std::io::Result<Bytes>> = chunks
        .iter()
        .map(|chunk| Ok(Bytes::copy_from_slice(chunk)))
        .collect();
    Box::pin(futures_util::stream::iter(chunks))
}

#[tokio::test]
async fn chunker_cuts_exact_pieces_across_chunk_boundaries() {
    let mut chunker = Chunker::new(body(&[b"abc", b"defgh", b"", b"ij"]), 4);
    let mut pieces = Vec::new();
    while let Some(piece) = chunker.next_piece().await.unwrap() {
        pieces.push(piece);
    }
    assert_eq!(
        pieces,
        vec![
            Bytes::from_static(b"abcd"),
            Bytes::from_static(b"efgh"),
            Bytes::from_static(b"ij"),
        ]
    );
}

#[tokio::test]
async fn chunker_surfaces_a_body_error() {
    let failing: ObjectBody = Box::pin(futures_util::stream::iter(vec![
        Ok(Bytes::from_static(b"ab")),
        Err(std::io::Error::other("cut")),
    ]));
    let mut chunker = Chunker::new(failing, 4);
    assert!(chunker.next_piece().await.is_err());
}

#[tokio::test]
async fn an_empty_body_is_one_empty_single_write() {
    match first_pieces(body(&[]), 4).await.unwrap() {
        Pieces::Single(bytes) => assert!(bytes.is_empty()),
        Pieces::Staged { .. } => panic!("an empty body needs no staging"),
    }
}

#[tokio::test]
async fn a_body_of_exactly_one_piece_is_a_single_write() {
    match first_pieces(body(&[b"ab", b"cd"]), 4).await.unwrap() {
        Pieces::Single(bytes) => assert_eq!(bytes, Bytes::from_static(b"abcd")),
        Pieces::Staged { .. } => panic!("one piece needs no staging"),
    }
}

#[tokio::test]
async fn a_body_over_one_piece_is_staged() {
    match first_pieces(body(&[b"abcdefghij"]), 4).await.unwrap() {
        Pieces::Single(_) => panic!("ten bytes in four-byte pieces must be staged"),
        Pieces::Staged {
            first,
            second,
            mut rest,
        } => {
            assert_eq!(first, Bytes::from_static(b"abcd"));
            assert_eq!(second, Bytes::from_static(b"efgh"));
            assert_eq!(
                rest.next_piece().await.unwrap(),
                Some(Bytes::from_static(b"ij"))
            );
            assert_eq!(rest.next_piece().await.unwrap(), None);
        }
    }
}

#[tokio::test]
async fn body_from_bytes_round_trips() {
    assert_eq!(
        collect_body(body_from_bytes(&b"hello"[..])).await.unwrap(),
        b"hello"
    );
    assert!(
        collect_body(body_from_bytes(Bytes::new()))
            .await
            .unwrap()
            .is_empty()
    );
}

#[test]
fn http_dates_round_trip() {
    let at = datetime!(2026-10-19 12:03:04 UTC);
    assert_eq!(format_http_date(at), "Mon, 19 Oct 2026 12:03:04 GMT");
    assert_eq!(parse_http_date("Mon, 19 Oct 2026 12:03:04 GMT"), Some(at));
    assert_eq!(parse_http_date("yesterday"), None);
}

#[test]
fn byte_ranges_render_as_http_ranges() {
    assert_eq!(
        ByteRange {
            start: 0,
            end: Some(99)
        }
        .header_value(),
        "bytes=0-99"
    );
    assert_eq!(
        ByteRange {
            start: 10,
            end: None
        }
        .header_value(),
        "bytes=10-"
    );
}
