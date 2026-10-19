//! Tests for reading a `List Blobs` page and writing a block list.

use time::macros::datetime;

use super::*;

/// A page shaped as Azure answers it: blobs with properties, a virtual
/// directory, and a continuation marker.
const PAGE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://acct.blob.core.windows.net/" ContainerName="runs">
  <Prefix>run-1/</Prefix><Marker /><MaxResults>2</MaxResults><Delimiter>/</Delimiter>
  <Blobs>
    <Blob>
      <Name>run-1/current</Name>
      <Properties>
        <Creation-Time>Mon, 19 Oct 2026 11:00:00 GMT</Creation-Time>
        <Last-Modified>Mon, 19 Oct 2026 12:03:04 GMT</Last-Modified>
        <Etag>0x8DC0000000000A</Etag>
        <Content-Length>36</Content-Length>
        <Content-Type>text/plain</Content-Type>
        <Content-Encoding />
        <BlobType>BlockBlob</BlobType>
      </Properties>
      <OrMetadata />
    </Blob>
    <BlobPrefix><Name>run-1/g/</Name></BlobPrefix>
    <Blob>
      <Name>run-1/a&amp;b.json.gz</Name>
      <Properties>
        <Content-Length>7</Content-Length>
        <Content-Type>application/json</Content-Type>
        <Content-Encoding>gzip</Content-Encoding>
      </Properties>
    </Blob>
  </Blobs>
  <NextMarker>2!88!MDAwMDQ1</NextMarker>
</EnumerationResults>"#;

#[test]
fn a_page_reads_blobs_prefixes_and_the_marker() {
    let page = parse_list(PAGE);
    assert_eq!(page.blobs.len(), 2);
    let pointer = &page.blobs[0];
    assert_eq!(pointer.name, "run-1/current");
    assert_eq!(pointer.properties.content_length, 36);
    assert_eq!(
        pointer.properties.content_type.as_deref(),
        Some("text/plain")
    );
    assert_eq!(pointer.properties.content_encoding, None);
    assert_eq!(
        pointer.properties.last_modified,
        Some(datetime!(2026-10-19 12:03:04 UTC))
    );
    assert_eq!(pointer.properties.etag.as_deref(), Some("0x8DC0000000000A"));

    let recording = &page.blobs[1];
    assert_eq!(recording.name, "run-1/a&b.json.gz");
    assert_eq!(
        recording.properties.content_encoding.as_deref(),
        Some("gzip")
    );

    assert_eq!(page.prefixes, vec!["run-1/g/".to_string()]);
    assert_eq!(page.next_marker.as_deref(), Some("2!88!MDAwMDQ1"));
}

#[test]
fn the_last_page_has_no_marker() {
    let page = parse_list("<EnumerationResults><Blobs /><NextMarker /></EnumerationResults>");
    assert!(page.blobs.is_empty());
    assert!(page.prefixes.is_empty());
    assert_eq!(page.next_marker, None);
}

#[test]
fn a_block_list_commits_every_id_in_order() {
    assert_eq!(
        block_list(&["MDE=".to_string(), "MDI=".to_string()]),
        r#"<?xml version="1.0" encoding="utf-8"?><BlockList><Latest>MDE=</Latest><Latest>MDI=</Latest></BlockList>"#
    );
}
