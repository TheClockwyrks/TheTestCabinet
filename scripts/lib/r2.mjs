// R2 (S3-compatible) access for the sample-pack tooling, signed with AWS SigV4.
//
// The audio sample packs live in a PRIVATE R2 bucket (zero-egress, not publicly
// listable). Two operations are needed and no more, so — exactly like the backend's
// `crates/backend/src/r2.rs`, which this mirrors — we sign requests directly with
// SigV4 over `node:crypto` rather than pull in the AWS SDK:
//
//   - `putObject`      — the PUBLISH side: a curator uploads a built pack tarball
//                        (needs the write-scoped PUBLISH credentials).
//   - `presignGetUrl`  — the BUILD side: `containers/build.sh` mints a short-lived
//                        GET URL the `sfx-sample`/`music` image build fetches the
//                        pack from via `ADD --checksum` (needs only the read-scoped
//                        PRESIGN credentials; the URL itself is anonymous once
//                        minted, so no credential ever enters an image layer).
//
// R2 is path-style (`{endpoint}/{bucket}/{key}`) and signs region `auto`.

import { createHash, createHmac } from "node:crypto";

const SERVICE = "s3";
const REGION = "auto"; // R2 ignores the region but SigV4 must sign a consistent one.

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/**
 * URI-encode per SigV4's rules (RFC 3986 unreserved set kept verbatim, everything
 * else percent-encoded). With `encodeSlash === false`, `/` is preserved so a
 * multi-segment object key keeps its separators in the canonical URI.
 */
function uriEncode(str, encodeSlash = true) {
  let out = "";
  for (const b of Buffer.from(str, "utf8")) {
    if (
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      (b >= 0x30 && b <= 0x39) || // 0-9
      b === 0x2d || // -
      b === 0x2e || // .
      b === 0x5f || // _
      b === 0x7e // ~
    ) {
      out += String.fromCharCode(b);
    } else if (b === 0x2f && !encodeSlash) {
      out += "/";
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/** SigV4 timestamps: `{ amzDate: YYYYMMDDTHHMMSSZ, scopeDate: YYYYMMDD }` (UTC). */
function amzDates(now = new Date()) {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return { amzDate, scopeDate: amzDate.slice(0, 8) };
}

/** The SigV4 signing-key chain: HMAC(date) → region → service → aws4_request. */
function signingKey(secret, scopeDate) {
  const kDate = hmac(`AWS4${secret}`, scopeDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/** Host of an endpoint origin (e.g. `acct.r2.cloudflarestorage.com`). */
function hostOf(endpoint) {
  return new URL(endpoint).host;
}

/**
 * Upload one object: `PUT {endpoint}/{bucket}/{key}` with `body`, signed SigV4
 * single-chunk payload-signed. Throws on a non-2xx response.
 */
export async function putObject({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
  body,
  contentType = "application/octet-stream",
}) {
  const host = hostOf(endpoint);
  const { amzDate, scopeDate } = amzDates();
  const canonicalUri = `/${uriEncode(bucket, false)}/${uriEncode(key, false)}`;
  const payloadHash = sha256Hex(body);

  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${scopeDate}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;
  const signature = hmac(
    signingKey(secretAccessKey, scopeDate),
    stringToSign,
  ).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint.replace(/\/+$/, "")}${canonicalUri}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      // undici derives Host from the URL (matching what we signed) even if it
      // ignores an explicit Host header, so the signature stays valid either way.
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization,
      "Content-Type": contentType,
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `R2 PUT ${key} -> HTTP ${res.status} ${res.statusText}: ${detail}`,
    );
  }
}

/**
 * Presign a `GET {endpoint}/{bucket}/{key}` URL valid for `expiresIn` seconds
 * (query-string SigV4, `UNSIGNED-PAYLOAD`). The returned URL needs no credential to
 * fetch, so it is safe to hand to Docker's `ADD`. Max lifetime is 7 days; a build
 * only needs minutes, so the default is one hour.
 */
export function presignGetUrl({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
  expiresIn = 3600,
}) {
  const host = hostOf(endpoint);
  const { amzDate, scopeDate } = amzDates();
  const scope = `${scopeDate}/${REGION}/${SERVICE}/aws4_request`;

  const params = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = params
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalUri = `/${uriEncode(bucket, false)}/${uriEncode(key, false)}`;
  const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;
  const signature = hmac(
    signingKey(secretAccessKey, scopeDate),
    stringToSign,
  ).toString("hex");

  return `${endpoint.replace(/\/+$/, "")}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Resolve R2 connection config for a role from the environment. `role` is
 * `"publish"` (write) or `"presign"` (read); each has its own bucket-scoped key
 * pair so a read-only credential can live on CI and dev machines while the writer
 * stays local. The endpoint origin comes from `CLOUDFLARE_AUDIO_R2_S3_URL` (its
 * host, ignoring any bucket path) or is derived from `CLOUDFLARE_ACCOUNT_ID`.
 */
export function r2ConfigFromEnv(role) {
  const env = process.env;
  const prefix =
    role === "publish"
      ? "CLOUDFLARE_AUDIO_R2_PUBLISH"
      : "CLOUDFLARE_AUDIO_R2_PRESIGN";

  const accessKeyId = env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = env[`${prefix}_SECRET_ACCESS_KEY`];
  const bucket = env.CLOUDFLARE_AUDIO_R2_BUCKET;

  let endpoint;
  if (env.CLOUDFLARE_AUDIO_R2_S3_URL) {
    const u = new URL(env.CLOUDFLARE_AUDIO_R2_S3_URL);
    endpoint = `${u.protocol}//${u.host}`;
  } else if (env.CLOUDFLARE_ACCOUNT_ID) {
    endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }

  const missing = [];
  if (!accessKeyId) missing.push(`${prefix}_ACCESS_KEY_ID`);
  if (!secretAccessKey) missing.push(`${prefix}_SECRET_ACCESS_KEY`);
  if (!bucket) missing.push("CLOUDFLARE_AUDIO_R2_BUCKET");
  if (!endpoint)
    missing.push("CLOUDFLARE_AUDIO_R2_S3_URL or CLOUDFLARE_ACCOUNT_ID");
  if (missing.length > 0) {
    throw new Error(`missing R2 ${role} env: ${missing.join(", ")}`);
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket };
}
