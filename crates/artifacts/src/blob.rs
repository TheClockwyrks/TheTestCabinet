//! Azure Blob Storage over its REST API, signed by hand.
//!
//! The private run-tree container is a Blob container, and locally the public
//! dataset's bucket is one too (an Azurite container). The service needs a
//! handful of operations on them: write an object whole (`Put Blob`, or
//! `Put Block` and `Put Block List` for an object larger than one
//! [piece](crate::object::PIECE_SIZE)), read one as a stream (`Get Blob`,
//! optionally a range), read its properties, list a prefix page by page, delete
//! one, and create a container. As with [`r2`](crate::r2), signing these few
//! requests directly over `reqwest` costs far less than vendoring the Azure SDK.
//!
//! A request authenticates one of two ways ([`Credential`]):
//!
//! - **Workload identity**, in a cluster: an Entra access token for Azure
//!   Storage, minted from the pod's projected `ServiceAccount` token and cached
//!   ([`WorkloadIdentity`]), sent as `Authorization: Bearer`.
//! - **Shared Key**, against Azurite locally: the request is signed with the
//!   account key (see `blob.sign.rs`).
//!
//! The service version every request names is pinned ([`API_VERSION`]), so the
//! store's behaviour never shifts under the service.

use std::sync::Arc;

use bytes::Bytes;
use reqwest::Method;
use time::OffsetDateTime;

use crate::object::{
    ByteRange, ObjectBody, ObjectProperties, ObjectStream, PIECE_SIZE, Pieces, first_pieces,
    format_http_date, properties_from_headers, response_body,
};

#[path = "blob.identity.rs"]
mod identity;
#[path = "blob.sign.rs"]
mod sign;
#[path = "blob.xml.rs"]
mod xml;

pub use identity::WorkloadIdentity;

/// The Blob service version every request is sent under (`x-ms-version`).
/// Azurite accepts it from release 3.29.
pub const API_VERSION: &str = "2023-11-03";

/// A Blob request failed.
#[derive(Debug, thiserror::Error)]
pub enum BlobError {
    /// A workload-identity variable the webhook projects is unset.
    #[error(
        "the workload identity variable `{0}` is unset (the pod needs the \
         `azure.workload.identity/use` label and a federated ServiceAccount)"
    )]
    MissingEnv(&'static str),
    /// The projected `ServiceAccount` token could not be read.
    #[error("reading the federated token file `{path}`: {source}")]
    TokenFile {
        /// The file (`AZURE_FEDERATED_TOKEN_FILE`).
        path: String,
        /// Why it could not be read.
        source: std::io::Error,
    },
    /// The Entra token exchange failed.
    #[error("the workload identity token: {0}")]
    Token(String),
    /// The request could not be sent, or its response not read.
    #[error("Blob {operation} `{target}`: {source}")]
    Transport {
        /// The operation (`put`, `get`, `list`, …).
        operation: &'static str,
        /// The container or blob it named.
        target: String,
        /// The transport failure.
        source: reqwest::Error,
    },
    /// The store answered a status the operation does not accept.
    #[error("Blob {operation} `{target}` answered {status} {code}: {detail}")]
    Status {
        /// The operation.
        operation: &'static str,
        /// The container or blob it named.
        target: String,
        /// The HTTP status.
        status: u16,
        /// The store's error code (`x-ms-error-code`), empty when absent.
        code: String,
        /// The response body, which carries the store's explanation.
        detail: String,
    },
    /// The body being written failed to read.
    #[error("reading the body for Blob `{target}`: {source}")]
    Body {
        /// The blob being written.
        target: String,
        /// The body's read failure.
        source: std::io::Error,
    },
}

/// How the service authenticates to its storage account, as configured.
#[derive(Clone, PartialEq, Eq)]
pub enum BlobAuth {
    /// Workload identity: the pod's federated managed identity.
    WorkloadIdentity,
    /// Shared Key with the account's decoded key (Azurite locally).
    SharedKey(Vec<u8>),
}

impl std::fmt::Debug for BlobAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WorkloadIdentity => f.write_str("WorkloadIdentity"),
            Self::SharedKey(_) => f.write_str("SharedKey(<redacted>)"),
        }
    }
}

/// The storage account and private container the run trees are written to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobConfig {
    /// The storage account (`TCAB_ARTIFACTS_BLOB_ACCOUNT`).
    pub account: String,
    /// The private run-tree container (`TCAB_ARTIFACTS_BLOB_CONTAINER`).
    pub container: String,
    /// The account's Blob endpoint, without a trailing slash: the public
    /// `https://<account>.blob.core.windows.net`, or a path-style endpoint such
    /// as Azurite's `http://azurite:10000/devstoreaccount1`
    /// (`TCAB_ARTIFACTS_BLOB_ENDPOINT`).
    pub endpoint: String,
    /// How requests authenticate.
    pub auth: BlobAuth,
}

impl BlobConfig {
    /// The endpoint of `account` in the Azure public cloud.
    pub fn default_endpoint(account: &str) -> String {
        format!("https://{account}.blob.core.windows.net")
    }
}

/// The credential a request is authenticated with.
#[derive(Debug, Clone)]
pub enum Credential {
    /// An Entra token from workload identity, sent as a bearer token.
    WorkloadIdentity(Arc<WorkloadIdentity>),
    /// Shared Key signing with the account's decoded key.
    SharedKey(Arc<Vec<u8>>),
}

/// One blob of a listing page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedBlob {
    /// The blob's full name within its container.
    pub name: String,
    /// Its properties as the listing reports them.
    pub properties: ObjectProperties,
}

/// One page of a `List Blobs` response.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ListPage {
    /// The blobs on this page, in name order.
    pub blobs: Vec<ListedBlob>,
    /// The virtual directories on this page, when a delimiter was given: each
    /// a name prefix ending in the delimiter.
    pub prefixes: Vec<String>,
    /// The marker the next page starts from, `None` on the last page.
    pub next_marker: Option<String>,
}

/// The account-level part of a client, shared by the clients of every
/// container on the account.
#[derive(Debug)]
struct Account {
    account: String,
    endpoint: String,
    /// The endpoint's own path (`/devstoreaccount1` for a path-style endpoint,
    /// empty for the public cloud's), which every request path starts with.
    endpoint_path: String,
    credential: Credential,
    http: reqwest::Client,
}

/// A client of one Blob container.
#[derive(Debug, Clone)]
pub struct BlobClient {
    account: Arc<Account>,
    container: String,
}

/// A header a request is sent and signed with.
type Header = (String, String);

impl BlobClient {
    /// A client of the configured container. Workload identity reads the
    /// variables the webhook projects from the process environment.
    pub fn new(config: &BlobConfig, http: reqwest::Client) -> Result<Self, BlobError> {
        let credential = match &config.auth {
            BlobAuth::SharedKey(key) => Credential::SharedKey(Arc::new(key.clone())),
            BlobAuth::WorkloadIdentity => Credential::WorkloadIdentity(Arc::new(
                WorkloadIdentity::from_lookup(|key| std::env::var(key).ok(), http.clone())?,
            )),
        };
        Ok(Self::with_credential(
            &config.account,
            &config.endpoint,
            &config.container,
            credential,
            http,
        ))
    }

    /// A client of `container` on `account` at `endpoint`, with `credential`.
    pub fn with_credential(
        account: &str,
        endpoint: &str,
        container: &str,
        credential: Credential,
        http: reqwest::Client,
    ) -> Self {
        let endpoint = endpoint.trim_end_matches('/').to_string();
        let endpoint_path = endpoint
            .split_once("://")
            .map_or(endpoint.as_str(), |(_, rest)| rest)
            .split_once('/')
            .map(|(_, path)| format!("/{path}"))
            .unwrap_or_default();
        Self {
            account: Arc::new(Account {
                account: account.to_string(),
                endpoint,
                endpoint_path,
                credential,
                http,
            }),
            container: container.to_string(),
        }
    }

    /// A client of another container on the same account, sharing this one's
    /// credential (and its cached token).
    pub fn for_container(&self, container: &str) -> Self {
        Self {
            account: Arc::clone(&self.account),
            container: container.to_string(),
        }
    }

    /// The container this client addresses.
    pub fn container(&self) -> &str {
        &self.container
    }

    /// Create the container. `Ok(true)` when it was created, `Ok(false)` when it
    /// already existed. Only the local stack creates containers; in a cluster
    /// they are provisioned with the account.
    #[tracing::instrument(name = "blob.create_container", skip(self), fields(blob.container = %self.container), err)]
    pub async fn create_container(&self) -> Result<bool, BlobError> {
        let response = self
            .send(
                "create-container",
                Method::PUT,
                None,
                &[("restype", "container".to_string())],
                Vec::new(),
                Bytes::new(),
            )
            .await?;
        match response.status().as_u16() {
            201 => Ok(true),
            409 => Ok(false),
            _ => Err(status_error("create-container", &self.container, response).await),
        }
    }

    /// Write `body` as blob `key` in one `Put Blob`, replacing any blob of that
    /// name, with the given content type and encoding stored on it.
    #[tracing::instrument(name = "blob.put", skip(self, body), fields(blob.key = %key, blob.bytes = body.len()), err)]
    pub async fn put(
        &self,
        key: &str,
        body: Bytes,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<(), BlobError> {
        let mut headers = content_headers(content_type, content_encoding);
        headers.push(("x-ms-blob-type".to_string(), "BlockBlob".to_string()));
        let response = self
            .send("put", Method::PUT, Some(key), &[], headers, body)
            .await?;
        expect(response, 201, "put", key).await
    }

    /// Stage one block of blob `key` (`Put Block`). Every block of a blob must
    /// carry an id of the same length; [`Self::upload`] numbers them.
    #[tracing::instrument(name = "blob.put_block", skip(self, body), fields(blob.key = %key, blob.bytes = body.len()), err)]
    pub async fn put_block(&self, key: &str, block_id: &str, body: Bytes) -> Result<(), BlobError> {
        let query = [
            ("comp", "block".to_string()),
            ("blockid", block_id.to_string()),
        ];
        let response = self
            .send(
                "put-block",
                Method::PUT,
                Some(key),
                &query,
                Vec::new(),
                body,
            )
            .await?;
        expect(response, 201, "put-block", key).await
    }

    /// Commit the staged blocks `ids`, in order, as blob `key` (`Put Block
    /// List`), with the given content type and encoding. The blob appears, or is
    /// replaced, whole at this moment.
    #[tracing::instrument(name = "blob.put_block_list", skip(self, ids), fields(blob.key = %key, blob.blocks = ids.len()), err)]
    pub async fn put_block_list(
        &self,
        key: &str,
        ids: &[String],
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<(), BlobError> {
        let body = Bytes::from(xml::block_list(ids));
        let mut headers = content_headers(content_type, content_encoding);
        headers.push((
            "content-type".to_string(),
            "application/xml; charset=utf-8".to_string(),
        ));
        let response = self
            .send(
                "put-block-list",
                Method::PUT,
                Some(key),
                &[("comp", "blocklist".to_string())],
                headers,
                body,
            )
            .await?;
        expect(response, 201, "put-block-list", key).await
    }

    /// Write a streamed `body` as blob `key`, holding at most one
    /// [piece](PIECE_SIZE) of it: a body of one piece or less in one `Put Blob`,
    /// a larger one staged block by block and committed whole. Returns the number
    /// of bytes written. A failure part-way leaves any earlier blob of the name
    /// in place; the staged blocks are discarded by the store.
    #[tracing::instrument(name = "blob.upload", skip(self, body), fields(blob.key = %key), err)]
    pub async fn upload(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<u64, BlobError> {
        let body_error = |source| BlobError::Body {
            target: key.to_string(),
            source,
        };
        match first_pieces(body, PIECE_SIZE).await.map_err(body_error)? {
            Pieces::Single(bytes) => {
                let length = bytes.len() as u64;
                self.put(key, bytes, content_type, content_encoding).await?;
                Ok(length)
            }
            Pieces::Staged {
                first,
                second,
                mut rest,
            } => {
                let mut ids = Vec::new();
                let mut length = 0u64;
                let mut next = Some(first);
                let mut queued = Some(second);
                while let Some(piece) = next {
                    let id = block_id(ids.len());
                    length += piece.len() as u64;
                    self.put_block(key, &id, piece).await?;
                    ids.push(id);
                    next = match queued.take() {
                        Some(piece) => Some(piece),
                        None => rest.next_piece().await.map_err(body_error)?,
                    };
                }
                self.put_block_list(key, &ids, content_type, content_encoding)
                    .await?;
                Ok(length)
            }
        }
    }

    /// Read blob `key`, or `range` of it, as a stream. `Ok(None)` when there is
    /// no such blob. The body is relayed as stored: a blob stored with a content
    /// encoding arrives still encoded.
    #[tracing::instrument(name = "blob.get", skip(self), fields(blob.key = %key), err)]
    pub async fn get(
        &self,
        key: &str,
        range: Option<ByteRange>,
    ) -> Result<Option<ObjectStream>, BlobError> {
        let headers = range
            .map(|range| vec![("x-ms-range".to_string(), range.header_value())])
            .unwrap_or_default();
        let response = self
            .send("get", Method::GET, Some(key), &[], headers, Bytes::new())
            .await?;
        match response.status().as_u16() {
            200 | 206 => Ok(Some(ObjectStream {
                properties: properties_from_headers(response.headers()),
                body: response_body(response),
            })),
            404 => Ok(None),
            _ => Err(status_error("get", key, response).await),
        }
    }

    /// Read blob `key`'s properties (`Get Blob Properties`), `Ok(None)` when
    /// there is no such blob.
    #[tracing::instrument(name = "blob.properties", skip(self), fields(blob.key = %key), err)]
    pub async fn properties(&self, key: &str) -> Result<Option<ObjectProperties>, BlobError> {
        let response = self
            .send(
                "properties",
                Method::HEAD,
                Some(key),
                &[],
                Vec::new(),
                Bytes::new(),
            )
            .await?;
        match response.status().as_u16() {
            200 => Ok(Some(properties_from_headers(response.headers()))),
            404 => Ok(None),
            _ => Err(status_error("properties", key, response).await),
        }
    }

    /// Read one page of the blobs whose names start with `prefix`. With a
    /// `delimiter`, names continuing past it are rolled up into
    /// [`ListPage::prefixes`]. `marker` is the previous page's
    /// [`ListPage::next_marker`]; `max_results` caps the page (the store's own
    /// cap, 5000, otherwise).
    #[tracing::instrument(name = "blob.list_page", skip(self), fields(blob.prefix = %prefix), err)]
    pub async fn list_page(
        &self,
        prefix: &str,
        delimiter: Option<&str>,
        marker: Option<&str>,
        max_results: Option<u32>,
    ) -> Result<ListPage, BlobError> {
        let mut query = vec![
            ("restype", "container".to_string()),
            ("comp", "list".to_string()),
        ];
        if !prefix.is_empty() {
            query.push(("prefix", prefix.to_string()));
        }
        if let Some(delimiter) = delimiter {
            query.push(("delimiter", delimiter.to_string()));
        }
        if let Some(marker) = marker {
            query.push(("marker", marker.to_string()));
        }
        if let Some(max_results) = max_results {
            query.push(("maxresults", max_results.to_string()));
        }
        let response = self
            .send("list", Method::GET, None, &query, Vec::new(), Bytes::new())
            .await?;
        if response.status().as_u16() != 200 {
            return Err(status_error("list", prefix, response).await);
        }
        let text = response
            .text()
            .await
            .map_err(|source| BlobError::Transport {
                operation: "list",
                target: prefix.to_string(),
                source,
            })?;
        Ok(xml::parse_list(&text))
    }

    /// Every blob and virtual directory under `prefix`, following the pages to
    /// the end.
    pub async fn list(&self, prefix: &str, delimiter: Option<&str>) -> Result<ListPage, BlobError> {
        let mut all = ListPage::default();
        let mut marker: Option<String> = None;
        loop {
            let page = self
                .list_page(prefix, delimiter, marker.as_deref(), None)
                .await?;
            all.blobs.extend(page.blobs);
            all.prefixes.extend(page.prefixes);
            match page.next_marker {
                Some(next) => marker = Some(next),
                None => return Ok(all),
            }
        }
    }

    /// Delete blob `key` and any snapshots of it. `Ok(true)` when it existed,
    /// `Ok(false)` when there was nothing to delete.
    #[tracing::instrument(name = "blob.delete", skip(self), fields(blob.key = %key), err)]
    pub async fn delete(&self, key: &str) -> Result<bool, BlobError> {
        let headers = vec![("x-ms-delete-snapshots".to_string(), "include".to_string())];
        let response = self
            .send(
                "delete",
                Method::DELETE,
                Some(key),
                &[],
                headers,
                Bytes::new(),
            )
            .await?;
        match response.status().as_u16() {
            202 => Ok(true),
            404 => Ok(false),
            _ => Err(status_error("delete", key, response).await),
        }
    }

    /// Send one authenticated request against the container, or against blob
    /// `key` in it.
    async fn send(
        &self,
        operation: &'static str,
        method: Method,
        key: Option<&str>,
        query: &[(&str, String)],
        mut headers: Vec<Header>,
        body: Bytes,
    ) -> Result<reqwest::Response, BlobError> {
        let account = &self.account;
        let mut path = format!(
            "{}/{}",
            account.endpoint_path,
            sign::encode(&self.container, false)
        );
        if let Some(key) = key {
            path.push('/');
            path.push_str(&sign::encode(key, true));
        }
        let target = key.unwrap_or(&self.container).to_string();

        headers.push((
            "x-ms-date".to_string(),
            format_http_date(OffsetDateTime::now_utc()),
        ));
        headers.push(("x-ms-version".to_string(), API_VERSION.to_string()));
        if !body.is_empty() || method == Method::PUT {
            headers.push(("content-length".to_string(), body.len().to_string()));
        }

        let authorization = match &account.credential {
            Credential::SharedKey(secret) => {
                let query: Vec<(String, String)> = query
                    .iter()
                    .map(|(name, value)| ((*name).to_string(), value.clone()))
                    .collect();
                let string_to_sign = sign::string_to_sign(&sign::SignedRequest {
                    method: method.as_str(),
                    headers: &headers,
                    account: &account.account,
                    path: &path,
                    query: &query,
                });
                format!(
                    "SharedKey {}:{}",
                    account.account,
                    sign::signature(secret, &string_to_sign)
                )
            }
            Credential::WorkloadIdentity(identity) => format!("Bearer {}", identity.token().await?),
        };

        let origin = account
            .endpoint
            .strip_suffix(&account.endpoint_path)
            .unwrap_or(&account.endpoint);
        let mut url = format!("{origin}{path}");
        if !query.is_empty() {
            let encoded: Vec<String> = query
                .iter()
                .map(|(name, value)| {
                    format!(
                        "{}={}",
                        sign::encode(name, false),
                        sign::encode(value, false)
                    )
                })
                .collect();
            url.push('?');
            url.push_str(&encoded.join("&"));
        }

        // The current span's trace context joins the request to the caller's
        // trace; it is not signed, so the store ignores it.
        let mut trace_headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut trace_headers);

        let mut request = account
            .http
            .request(method, &url)
            .header("authorization", authorization)
            .headers(trace_headers);
        for (name, value) in &headers {
            request = request.header(name.as_str(), value.as_str());
        }
        if !body.is_empty() {
            request = request.body(body);
        }
        let response = request
            .send()
            .await
            .map_err(|source| BlobError::Transport {
                operation,
                target: target.clone(),
                source,
            })?;
        if response.status().as_u16() == 401
            && let Credential::WorkloadIdentity(identity) = &account.credential
        {
            // A token the store refuses is not reused: the next request mints one.
            identity.invalidate().await;
        }
        Ok(response)
    }
}

/// The blob property headers a write stores its content labels with.
fn content_headers(content_type: &str, content_encoding: Option<&str>) -> Vec<Header> {
    let mut headers = vec![(
        "x-ms-blob-content-type".to_string(),
        content_type.to_string(),
    )];
    if let Some(encoding) = content_encoding {
        headers.push((
            "x-ms-blob-content-encoding".to_string(),
            encoding.to_string(),
        ));
    }
    headers
}

/// The id of the `index`th block of a blob: base64 of a fixed-width number, so
/// every id of the blob has the same length as the store requires.
fn block_id(index: usize) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(format!("{index:010}"))
}

/// Accept `response` when it has status `want`, else turn it into an error.
async fn expect(
    response: reqwest::Response,
    want: u16,
    operation: &'static str,
    target: &str,
) -> Result<(), BlobError> {
    if response.status().as_u16() == want {
        Ok(())
    } else {
        Err(status_error(operation, target, response).await)
    }
}

/// The error for a response whose status the operation does not accept.
async fn status_error(
    operation: &'static str,
    target: &str,
    response: reqwest::Response,
) -> BlobError {
    let status = response.status().as_u16();
    let code = response
        .headers()
        .get("x-ms-error-code")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let detail = response.text().await.unwrap_or_default();
    BlobError::Status {
        operation,
        target: target.to_string(),
        status,
        code,
        detail,
    }
}

#[cfg(test)]
#[path = "blob.stub.test.rs"]
mod tests;
