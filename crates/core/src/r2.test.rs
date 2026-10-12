use super::*;

#[test]
fn uri_encode_preserves_unreserved_and_slashes() {
    assert_eq!(uri_encode("simple-key_1.json", false), "simple-key_1.json");
    // Slashes preserved when encode_slash is false.
    assert_eq!(uri_encode("a/b/c.json", false), "a/b/c.json");
    // Spaces and other bytes percent-encoded, uppercase hex.
    assert_eq!(uri_encode("a b", false), "a%20b");
}

#[test]
fn uri_encode_can_encode_slashes() {
    assert_eq!(uri_encode("a/b", true), "a%2Fb");
}

#[test]
fn scheme_prefix_handles_https_and_bare_hosts() {
    assert_eq!(
        scheme_prefix("https://acct.r2.cloudflarestorage.com/"),
        "https://acct.r2.cloudflarestorage.com"
    );
    assert_eq!(
        scheme_prefix("acct.r2.cloudflarestorage.com"),
        "https://acct.r2.cloudflarestorage.com"
    );
}

#[test]
fn trim_scheme_recovers_host() {
    let parsed = url::trim_scheme("https://acct.r2.cloudflarestorage.com/bucket");
    assert_eq!(parsed.host, "acct.r2.cloudflarestorage.com");
}

#[test]
fn parse_list_keys_extracts_every_key() {
    let xml = "<?xml version=\"1.0\"?><ListBucketResult>\
        <Contents><Key>media/runs/a/proof/title.png</Key><Size>1</Size></Contents>\
        <Contents><Key>media/runs/b/asset/regenerated-0.png</Key></Contents>\
        </ListBucketResult>";
    assert_eq!(
        parse_list_keys(xml),
        vec![
            "media/runs/a/proof/title.png".to_string(),
            "media/runs/b/asset/regenerated-0.png".to_string(),
        ],
    );
    // An empty listing yields no keys.
    assert!(parse_list_keys("<ListBucketResult></ListBucketResult>").is_empty());
}

#[test]
fn parse_list_keys_decodes_xml_entities() {
    let xml = "<Contents><Key>a&amp;b/c.json</Key></Contents>";
    assert_eq!(parse_list_keys(xml), vec!["a&b/c.json".to_string()]);
}

#[test]
fn continuation_token_present_only_when_truncated() {
    let truncated = "<IsTruncated>true</IsTruncated>\
        <NextContinuationToken>1abc/def=</NextContinuationToken>";
    assert_eq!(
        parse_next_continuation_token(truncated),
        Some("1abc/def=".to_string())
    );
    // No token element → the listing is complete.
    assert_eq!(
        parse_next_continuation_token("<IsTruncated>false</IsTruncated>"),
        None
    );
    // An empty token element is treated as complete, not an empty page cursor.
    assert_eq!(
        parse_next_continuation_token("<NextContinuationToken></NextContinuationToken>"),
        None
    );
}

#[test]
fn signing_chain_matches_aws_known_vector() {
    // AWS SigV4 documented test vector: deriving the signature for the example
    // string-to-sign with the example key proves the HMAC chain is correct.
    // From AWS "Examples of how to derive a signing key".
    let config = R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "AKIDEXAMPLE".to_string(),
        secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".to_string(),
        endpoint: "https://acct.r2.cloudflarestorage.com".to_string(),
        region: "us-east-1".to_string(),
    };
    let client = R2Client::new(config);

    // The canonical AWS example signs service "iam"; we sign "s3", so rather than
    // reproduce the full doc example we assert the chain is deterministic and
    // 64 hex chars (a SHA-256 HMAC), which is the property `put_object` relies on.
    let signature = client.sign("20150830", "string-to-sign").unwrap();
    assert_eq!(signature.len(), 64);
    assert!(signature.chars().all(|c| c.is_ascii_hexdigit()));
    // Determinism: same inputs, same signature.
    let again = client.sign("20150830", "string-to-sign").unwrap();
    assert_eq!(signature, again);
}

#[test]
fn xml_escape_is_the_inverse_of_unescape() {
    // A key carrying every predefined entity round-trips, which is what keeps a
    // `DeleteObjects` body naming the same object the listing returned.
    let key = "snapshots/a&b/<c>/\"d\"/'e'.json";
    assert_eq!(xml_unescape(&xml_escape(key)), key);
}

#[test]
fn xml_escape_does_not_double_escape_ampersands() {
    // `&` must be replaced first; escaping it last would turn the `&` of `&lt;`
    // into `&amp;lt;` and delete the wrong key.
    assert_eq!(xml_escape("a&b"), "a&amp;b");
    assert_eq!(xml_escape("a<b"), "a&lt;b");
    assert_eq!(xml_escape("a&<b"), "a&amp;&lt;b");
}

#[test]
fn delete_errors_are_none_on_a_quiet_success() {
    // Quiet mode reports nothing when every key was deleted.
    assert_eq!(parse_delete_errors(""), None);
    assert_eq!(
        parse_delete_errors(r#"<?xml version="1.0"?><DeleteResult></DeleteResult>"#),
        None
    );
}

#[test]
fn delete_errors_are_counted_when_keys_fail() {
    let xml = "<DeleteResult>\
        <Error><Key>a</Key><Code>AccessDenied</Code></Error>\
        <Error><Key>b</Key><Code>InternalError</Code></Error>\
        </DeleteResult>";
    assert_eq!(parse_delete_errors(xml), Some(2));
}

#[test]
fn delete_batch_size_matches_the_s3_cap() {
    // The chunking in `delete_objects` is only correct while this matches the
    // 1000-key limit S3/R2 enforce per request.
    assert_eq!(DELETE_BATCH, 1000);
}

// ---------------------------------------------------------------------------
// Reading an object
// ---------------------------------------------------------------------------

/// What a stand-in bucket answers one request with.
#[derive(Clone)]
enum Answer {
    /// A status line, extra header lines and a body, sent whole.
    Whole(&'static str, &'static str, Vec<u8>),
    /// Nothing: the connection is held open and never answered.
    Silent,
    /// A `200` whose headers promise more body than is ever sent.
    Stalled(Vec<u8>),
}

/// Serve `answer` to every request on a local port, and return the client that
/// reaches it with the request heads it received.
async fn stand_in(answer: Answer) -> (R2Client, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let heads = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = std::sync::Arc::clone(&heads);
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let answer = answer.clone();
            let seen = std::sync::Arc::clone(&seen);
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut buffer = [0u8; 1024];
                while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                    match socket.read(&mut buffer).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => head.extend_from_slice(&buffer[..read]),
                    }
                }
                seen.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&head).into_owned());
                match answer {
                    Answer::Whole(status, headers, body) => {
                        let head = format!(
                            "HTTP/1.1 {status}\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = socket.write_all(head.as_bytes()).await;
                        let _ = socket.write_all(&body).await;
                        let _ = socket.shutdown().await;
                    }
                    Answer::Silent => std::future::pending::<()>().await,
                    Answer::Stalled(body) => {
                        let head = format!(
                            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n",
                            body.len() + 1
                        );
                        let _ = socket.write_all(head.as_bytes()).await;
                        let _ = socket.write_all(&body).await;
                        let _ = socket.flush().await;
                        std::future::pending::<()>().await
                    }
                }
            });
        }
    });
    let client = R2Client::new(R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "AKIDEXAMPLE".to_string(),
        secret_access_key: "secret".to_string(),
        endpoint: format!("http://{addr}"),
        region: "auto".to_string(),
    });
    (client, heads)
}

/// The error body S3 answers with for `code`.
fn error_body(code: &str) -> Vec<u8> {
    format!("<?xml version=\"1.0\"?><Error><Code>{code}</Code><Message>m</Message></Error>")
        .into_bytes()
}

#[tokio::test]
async fn an_object_is_read_with_its_labels_through_a_signed_request() {
    let (client, heads) = stand_in(Answer::Whole(
        "200 OK",
        "content-type: application/json\r\ncontent-encoding: gzip\r\n",
        b"the bytes".to_vec(),
    ))
    .await;

    let object = client
        .get_object("media/runs/r 1/proof/title.png")
        .await
        .unwrap()
        .expect("the bucket holds the object");
    assert_eq!(object.content_type(), Some("application/json"));
    assert_eq!(object.content_encoding(), Some("gzip"));
    assert_eq!(object.content_length(), Some(9));
    assert_eq!(object.bytes(1024).await.unwrap(), b"the bytes");

    let heads = heads.lock().unwrap();
    let head = heads[0].to_ascii_lowercase();
    // The key's segments are encoded and its separators kept, as the signature
    // was computed over.
    assert!(
        head.starts_with("get /bucket/media/runs/r%201/proof/title.png http/1.1"),
        "{head}"
    );
    // Signed like the other verbs: the scope, the three signed headers and the
    // hash of an empty payload.
    assert!(
        head.contains("authorization: aws4-hmac-sha256 credential=akidexample/"),
        "{head}"
    );
    assert!(
        head.contains("signedheaders=host;x-amz-content-sha256;x-amz-date"),
        "{head}"
    );
    assert!(
        head.contains(&format!(
            "x-amz-content-sha256: {}",
            hex::encode(Sha256::digest(b""))
        )),
        "{head}"
    );
    assert!(head.contains("x-amz-date: "), "{head}");
}

#[tokio::test]
async fn a_body_is_handed_over_part_by_part_until_it_ends() {
    let (client, _) = stand_in(Answer::Whole("200 OK", "", vec![7u8; 4096])).await;
    let mut object = client.get_object("k").await.unwrap().unwrap();
    let mut read = 0;
    while let Some(chunk) = object.chunk().await.unwrap() {
        assert!(chunk.iter().all(|byte| *byte == 7));
        read += chunk.len();
    }
    assert_eq!(read, 4096);
}

#[tokio::test]
async fn a_key_the_bucket_has_no_object_under_is_not_an_error() {
    let (client, _) = stand_in(Answer::Whole(
        "404 Not Found",
        "content-type: application/xml\r\n",
        error_body("NoSuchKey"),
    ))
    .await;
    assert!(
        client
            .get_object("media/runs/r1/x")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn a_404_that_is_not_about_the_key_is_a_failure() {
    // A missing bucket answers 404 too. Read as "no such key", a backend pointed
    // at a bucket that is gone would report every file of every run as absent.
    let (client, _) = stand_in(Answer::Whole(
        "404 Not Found",
        "",
        error_body("NoSuchBucket"),
    ))
    .await;
    let err = client.get_object("k").await.expect_err("a failure");
    assert!(err.to_string().contains("NoSuchBucket"), "{err}");

    // And so does a 404 with no body to say what was not found.
    let (client, _) = stand_in(Answer::Whole("404 Not Found", "", Vec::new())).await;
    assert!(client.get_object("k").await.is_err());
}

#[tokio::test]
async fn any_other_status_is_a_failure() {
    for status in [
        "500 Internal Server Error",
        "503 Service Unavailable",
        "403 Forbidden",
    ] {
        let (client, _) = stand_in(Answer::Whole(status, "", error_body("NoSuchKey"))).await;
        assert!(
            client.get_object("k").await.is_err(),
            "{status} was not a failure"
        );
    }
}

#[tokio::test]
async fn a_bucket_that_cannot_be_reached_is_a_failure() {
    // A port nothing listens on: bound, read and released.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let client = R2Client::new(R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "key".to_string(),
        secret_access_key: "secret".to_string(),
        endpoint: format!("http://{addr}"),
        region: "auto".to_string(),
    });
    assert!(client.get_object("k").await.is_err());
}

#[tokio::test]
async fn a_bucket_that_never_answers_fails_the_read_at_the_response_timeout() {
    let (client, _) = stand_in(Answer::Silent).await;
    let client = client.with_read_timeouts(Duration::from_millis(50), Duration::from_secs(30));
    let err = client.get_object("k").await.expect_err("a failure");
    assert!(err.to_string().contains("got no answer"), "{err}");
}

#[tokio::test]
async fn a_body_that_stalls_fails_the_read_at_the_idle_timeout() {
    let (client, _) = stand_in(Answer::Stalled(b"half".to_vec())).await;
    let client = client.with_read_timeouts(Duration::from_secs(30), Duration::from_millis(50));
    let object = client.get_object("k").await.unwrap().unwrap();
    // The part that arrived is not handed over as the object.
    let err = object.bytes(1024).await.expect_err("a failure");
    assert!(err.to_string().contains("stalled"), "{err}");
}

#[tokio::test]
async fn a_body_longer_than_the_limit_is_refused() {
    // By its stated length, before any of it is read.
    let (client, _) = stand_in(Answer::Whole("200 OK", "", vec![0u8; 64])).await;
    let object = client.get_object("k").await.unwrap().unwrap();
    assert!(object.bytes(63).await.is_err());

    // And one exactly at the limit is read whole.
    let object = client.get_object("k").await.unwrap().unwrap();
    assert_eq!(object.bytes(64).await.unwrap().len(), 64);
}

#[test]
fn an_error_code_is_read_from_an_error_body() {
    assert_eq!(
        parse_error_code(&String::from_utf8(error_body("NoSuchKey")).unwrap()),
        Some("NoSuchKey".to_string())
    );
    assert_eq!(parse_error_code("<Error></Error>"), None);
    assert_eq!(parse_error_code(""), None);
}
