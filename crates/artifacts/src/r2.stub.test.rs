//! The R2 client against a stub S3 service on a loopback socket, which checks
//! every request's SigV4 signature and payload hash as received.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method as HttpMethod, StatusCode, Uri};
use axum::response::Response;

use super::*;
use crate::object::{body_from_bytes, collect_body};

const SECRET: &str = "stub-secret";

/// One stored object.
#[derive(Clone)]
struct Stored {
    data: Bytes,
    content_type: Option<String>,
    content_encoding: Option<String>,
}

/// An open multipart upload: the key, its labels and its parts.
struct Upload {
    key: String,
    content_type: Option<String>,
    content_encoding: Option<String>,
    parts: BTreeMap<usize, Bytes>,
}

#[derive(Default)]
struct Stub {
    objects: BTreeMap<String, Stored>,
    uploads: HashMap<String, Upload>,
    next_upload: usize,
    /// A short name of every request, in order.
    log: Vec<String>,
    /// The listing page size.
    page_size: usize,
    /// A part number the stub refuses.
    fail_part: Option<usize>,
}

type Shared = Arc<Mutex<Stub>>;

fn decode(text: &str) -> String {
    percent_encoding::percent_decode_str(text)
        .decode_utf8_lossy()
        .into_owned()
}

fn status(code: u16, body: impl Into<Body>) -> Response {
    let mut response = Response::new(body.into());
    *response.status_mut() = StatusCode::from_u16(code).unwrap();
    response
}

fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// Recompute the request's signature from what arrived and compare.
fn verify(method: &HttpMethod, uri: &Uri, headers: &HeaderMap, body: &Bytes) -> bool {
    let authorization = header(headers, "authorization").unwrap_or_default();
    let Some(rest) = authorization.strip_prefix("AWS4-HMAC-SHA256 Credential=AKID/") else {
        return false;
    };
    let mut fields = rest.split(", ");
    let _scope = fields.next();
    let signed = fields
        .next()
        .and_then(|f| f.strip_prefix("SignedHeaders="))
        .unwrap_or("");
    let signature = fields
        .next()
        .and_then(|f| f.strip_prefix("Signature="))
        .unwrap_or("");
    if headers
        .keys()
        .any(|name| headers.get_all(name).iter().count() > 1)
    {
        return false;
    }
    let payload_hash = header(headers, "x-amz-content-sha256").unwrap_or_default();
    if payload_hash != hex::encode(Sha256::digest(body)) {
        return false;
    }
    let signed_headers: Vec<(String, String)> = signed
        .split(';')
        .map(|name| (name.to_string(), header(headers, name).unwrap_or_default()))
        .collect();
    let query: Vec<(String, String)> = uri
        .query()
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(name), decode(value))
        })
        .collect();
    let query: Vec<(&str, String)> = query
        .iter()
        .map(|(name, value)| (name.as_str(), value.clone()))
        .collect();
    let (canonical, _) = canonical_request(
        method.as_str(),
        uri.path(),
        &canonical_query(&query),
        &signed_headers,
        &payload_hash,
    );
    let amz_date = header(headers, "x-amz-date").unwrap_or_default();
    let (_, expected) = sign_v4(SECRET, "auto", &amz_date, &canonical).unwrap();
    expected == signature && signed.contains("host")
}

async fn handle(
    State(stub): State<Shared>,
    method: HttpMethod,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let mut stub = stub.lock().unwrap();
    if !verify(&method, &uri, &headers, &body) {
        return status(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>");
    }
    let path = uri.path().to_string();
    let Some(rest) = path.strip_prefix("/bucket") else {
        return status(404, "<Error><Code>NoSuchBucket</Code></Error>");
    };
    let key = decode(rest.trim_start_matches('/'));
    let query: HashMap<String, String> = uri
        .query()
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(name), decode(value))
        })
        .collect();

    match method {
        HttpMethod::PUT if query.contains_key("partNumber") => {
            stub.log.push("PUT part".to_string());
            let number: usize = query["partNumber"].parse().unwrap();
            if stub.fail_part == Some(number) {
                return status(500, "<Error><Code>InternalError</Code></Error>");
            }
            let Some(upload) = stub.uploads.get_mut(&query["uploadId"]) else {
                return status(404, "<Error><Code>NoSuchUpload</Code></Error>");
            };
            upload.parts.insert(number, body);
            let mut response = status(200, "");
            response
                .headers_mut()
                .insert("etag", format!("\"etag-{number}\"").parse().unwrap());
            response
        }
        HttpMethod::PUT => {
            stub.log.push("PUT".to_string());
            stub.objects.insert(
                key,
                Stored {
                    data: body,
                    content_type: header(&headers, "content-type"),
                    content_encoding: header(&headers, "content-encoding"),
                },
            );
            status(200, "")
        }
        HttpMethod::POST if query.contains_key("uploads") => {
            stub.log.push("POST uploads".to_string());
            stub.next_upload += 1;
            let id = format!("upload/{}", stub.next_upload);
            stub.uploads.insert(
                id.clone(),
                Upload {
                    key,
                    content_type: header(&headers, "content-type"),
                    content_encoding: header(&headers, "content-encoding"),
                    parts: BTreeMap::new(),
                },
            );
            status(
                200,
                format!(
                    "<InitiateMultipartUploadResult><UploadId>{id}</UploadId></InitiateMultipartUploadResult>"
                ),
            )
        }
        HttpMethod::POST if query.contains_key("uploadId") => {
            stub.log.push("POST complete".to_string());
            let Some(upload) = stub.uploads.remove(&query["uploadId"]) else {
                return status(404, "<Error><Code>NoSuchUpload</Code></Error>");
            };
            let listed = String::from_utf8_lossy(&body).to_string();
            let mut data = Vec::new();
            for (number, part) in &upload.parts {
                if !listed.contains(&format!(
                    "<PartNumber>{number}</PartNumber><ETag>&quot;etag-{number}&quot;</ETag>"
                )) {
                    return status(200, "<Error><Code>InvalidPart</Code></Error>");
                }
                data.extend_from_slice(part);
            }
            stub.objects.insert(
                upload.key,
                Stored {
                    data: Bytes::from(data),
                    content_type: upload.content_type,
                    content_encoding: upload.content_encoding,
                },
            );
            status(200, "<CompleteMultipartUploadResult/>")
        }
        HttpMethod::POST if query.contains_key("delete") => {
            stub.log.push("POST delete".to_string());
            let listed = String::from_utf8_lossy(&body).to_string();
            for part in listed.split("<Key>").skip(1) {
                let key = part.split("</Key>").next().unwrap_or("");
                stub.objects.remove(key);
            }
            status(200, "")
        }
        HttpMethod::DELETE if query.contains_key("uploadId") => {
            stub.log.push("DELETE abort".to_string());
            stub.uploads.remove(&query["uploadId"]);
            status(204, "")
        }
        HttpMethod::GET if query.get("list-type").map(String::as_str) == Some("2") => {
            stub.log.push("GET list".to_string());
            let prefix = query.get("prefix").cloned().unwrap_or_default();
            let after = query.get("continuation-token").cloned().unwrap_or_default();
            let keys: Vec<&String> = stub
                .objects
                .keys()
                .filter(|key| key.starts_with(&prefix) && **key > after)
                .collect();
            let page = stub.page_size.max(1);
            let mut xml = String::from("<ListBucketResult>");
            for key in keys.iter().take(page) {
                xml.push_str(&format!("<Contents><Key>{key}</Key></Contents>"));
            }
            if keys.len() > page {
                xml.push_str(&format!(
                    "<IsTruncated>true</IsTruncated><NextContinuationToken>{}</NextContinuationToken>",
                    keys[page - 1]
                ));
            }
            xml.push_str("</ListBucketResult>");
            status(200, xml)
        }
        HttpMethod::GET | HttpMethod::HEAD => {
            stub.log.push(method.to_string());
            let Some(stored) = stub.objects.get(&key) else {
                return status(404, "<Error><Code>NoSuchKey</Code></Error>");
            };
            let (code, data) = match header(&headers, "range") {
                None => (200, stored.data.clone()),
                Some(range) => {
                    let range = range.trim_start_matches("bytes=");
                    let (start, end) = range.split_once('-').unwrap();
                    let start: usize = start.parse().unwrap();
                    let end = end
                        .parse::<usize>()
                        .map_or(stored.data.len(), |end| (end + 1).min(stored.data.len()));
                    (206, stored.data.slice(start..end))
                }
            };
            let length = data.len();
            let mut response = status(
                code,
                if method == HttpMethod::HEAD {
                    Body::empty()
                } else {
                    Body::from(data)
                },
            );
            let headers = response.headers_mut();
            headers.insert("content-length", length.to_string().parse().unwrap());
            if let Some(content_type) = &stored.content_type {
                headers.insert("content-type", content_type.parse().unwrap());
            }
            if let Some(encoding) = &stored.content_encoding {
                headers.insert("content-encoding", encoding.parse().unwrap());
            }
            headers.insert(
                "last-modified",
                "Mon, 19 Oct 2026 12:03:04 GMT".parse().unwrap(),
            );
            response
        }
        _ => status(400, "<Error><Code>Unsupported</Code></Error>"),
    }
}

async fn serve() -> (R2Client, Shared) {
    let stub = Arc::new(Mutex::new(Stub {
        page_size: 1000,
        ..Stub::default()
    }));
    let app = axum::Router::new()
        .fallback(handle)
        .with_state(Arc::clone(&stub))
        .layer(axum::extract::DefaultBodyLimit::disable());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = R2Client::new(R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "AKID".to_string(),
        secret_access_key: SECRET.to_string(),
        endpoint: format!("http://{address}"),
        region: "auto".to_string(),
    });
    (client, stub)
}

#[tokio::test]
async fn an_object_is_written_read_ranged_and_probed() {
    let (client, _stub) = serve().await;
    client
        .put_object(
            "media/runs/r/validation/pass__a.json.gz",
            b"0123456789".to_vec(),
            "application/json",
            Some("gzip"),
        )
        .await
        .unwrap();

    let read = client
        .get_object("media/runs/r/validation/pass__a.json.gz", None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        read.properties.content_type.as_deref(),
        Some("application/json")
    );
    assert_eq!(read.properties.content_encoding.as_deref(), Some("gzip"));
    assert!(read.properties.last_modified.is_some());
    assert_eq!(collect_body(read.body).await.unwrap(), b"0123456789");

    let ranged = client
        .get_object(
            "media/runs/r/validation/pass__a.json.gz",
            Some(ByteRange {
                start: 8,
                end: None,
            }),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(collect_body(ranged.body).await.unwrap(), b"89");

    let head = client
        .head_object("media/runs/r/validation/pass__a.json.gz")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(head.content_length, 10);

    assert!(client.get_object("missing", None).await.unwrap().is_none());
    assert!(client.head_object("missing").await.unwrap().is_none());
}

#[tokio::test]
async fn a_small_body_is_one_put() {
    let (client, stub) = serve().await;
    let written = client
        .upload(
            "index.json",
            body_from_bytes(&b"{}"[..]),
            "application/json",
            None,
        )
        .await
        .unwrap();
    assert_eq!(written, 2);
    assert_eq!(stub.lock().unwrap().log, ["PUT"]);
}

#[tokio::test]
async fn a_large_body_is_a_multipart_upload_of_equal_parts() {
    let (client, stub) = serve().await;
    let data: Vec<u8> = (0..(2 * PIECE_SIZE + 5)).map(|i| (i % 253) as u8).collect();
    let chunks: Vec<std::io::Result<Bytes>> = data
        .chunks(999_983)
        .map(|chunk| Ok(Bytes::copy_from_slice(chunk)))
        .collect();
    let written = client
        .upload(
            "media/runs/r/proof/clip.mp4",
            Box::pin(futures_util::stream::iter(chunks)),
            "video/mp4",
            None,
        )
        .await
        .unwrap();
    assert_eq!(written, data.len() as u64);
    {
        let stub = stub.lock().unwrap();
        assert_eq!(
            stub.log,
            [
                "POST uploads",
                "PUT part",
                "PUT part",
                "PUT part",
                "POST complete"
            ]
        );
        assert!(stub.uploads.is_empty());
    }
    let read = client
        .get_object("media/runs/r/proof/clip.mp4", None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(read.properties.content_type.as_deref(), Some("video/mp4"));
    assert_eq!(collect_body(read.body).await.unwrap(), data);
}

#[tokio::test]
async fn a_failed_part_aborts_the_upload() {
    let (client, stub) = serve().await;
    stub.lock().unwrap().fail_part = Some(2);
    let data = vec![7u8; 2 * PIECE_SIZE + 1];
    let result = client
        .upload(
            "big",
            body_from_bytes(data),
            "application/octet-stream",
            None,
        )
        .await;
    assert!(result.is_err());
    let stub = stub.lock().unwrap();
    assert_eq!(
        stub.log,
        ["POST uploads", "PUT part", "PUT part", "DELETE abort"]
    );
    assert!(stub.uploads.is_empty());
    assert!(!stub.objects.contains_key("big"));
}

#[tokio::test]
async fn listing_follows_continuation_and_deletes_in_batches() {
    let (client, stub) = serve().await;
    for key in ["media/a", "media/b", "media/c", "other/d"] {
        client
            .put_object(key, b".".to_vec(), "text/plain", None)
            .await
            .unwrap();
    }
    stub.lock().unwrap().page_size = 2;
    let keys = client.list_keys("media/").await.unwrap();
    assert_eq!(keys, ["media/a", "media/b", "media/c"]);

    assert_eq!(client.delete_objects(&keys).await.unwrap(), 3);
    assert_eq!(client.list_keys("").await.unwrap(), ["other/d"]);
}

#[tokio::test]
async fn a_wrong_secret_is_refused() {
    let (client, _stub) = serve().await;
    let mut config = client.config.clone();
    config.secret_access_key = "wrong".to_string();
    let wrong = R2Client::new(config);
    assert!(wrong.head_object("anything").await.is_err());
}

#[tokio::test]
async fn the_bucket_serves_as_the_public_store() {
    use crate::public::PublicStore;

    let (client, _stub) = serve().await;
    let written = PublicStore::put(
        &client,
        "runs/r.json",
        body_from_bytes(&b"{}"[..]),
        "application/json",
        None,
    )
    .await
    .unwrap();
    assert_eq!(written, 2);
    assert!(
        PublicStore::head(&client, "runs/r.json")
            .await
            .unwrap()
            .is_some()
    );
    let read = PublicStore::get(&client, "runs/r.json", None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(collect_body(read.body).await.unwrap(), b"{}");
    assert_eq!(
        PublicStore::list_keys(&client, "runs/").await.unwrap(),
        ["runs/r.json"]
    );
}
