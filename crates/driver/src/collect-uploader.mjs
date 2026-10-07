// The sandbox end of the run-tree collection channel.
//
// The driver ships this script inside its own binary and execs it into the
// sandbox pod with the sandbox image's Node runtime once the harness session has
// ended, so both ends of the channel come from the same driver build. It streams
// a `tar` of the working tree to the driver's listener and ends the stream with
// the archive's byte count and SHA-256 digest, which the driver verifies before
// it accepts the tree. The exec that starts this script carries nothing but the
// command: the bytes never cross the exec transport, whose stdout can be cut
// short behind a successful exit status.
//
// Usage: node --input-type=module -e "<this script>" -- <host> <port> <token> <workdir> [exclude...]
//
// Wire protocol (`tcab-collect/1`), all integers big-endian:
//   header   `tcab-collect/1 <token>\n`
//   frame    [kind: u8][length: u32][payload]
//     kind 0 data     payload = archive bytes
//     kind 1 end      payload = total archive length (u64) + SHA-256 (32 bytes)
//     kind 2 failure  payload = UTF-8 message (tar did not produce the archive)
//   reply    `ok\n` from the driver once the archive is verified
//
// Exit codes: 0 acknowledged, 2 the channel failed, 3 `tar` failed.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";

const [host, port, token, workdir, ...excludes] = process.argv.slice(1);
if (!host || !port || !token || !workdir) {
  process.stderr.write("usage: host port token workdir [exclude...]\n");
  process.exit(2);
}

const DATA = 0;
const END = 1;
const FAILURE = 2;
// Chunks the archive is framed in. Large enough that framing is negligible,
// small enough that a frame never needs a large contiguous buffer on either end.
const CHUNK = 1024 * 1024;
// How long to wait for the driver's acknowledgement after the terminator: the
// driver verifies a digest it computed while receiving, so the reply is prompt.
const ACK_TIMEOUT_MS = 120_000;

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function frame(kind, payload) {
  const header = Buffer.alloc(5);
  header.writeUInt8(kind, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/// Write to the socket, honouring backpressure so a large tree never piles up in
/// memory ahead of a slower network.
function write(socket, bytes) {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error("connection closed"));
      return;
    }
    const ok = socket.write(bytes, (err) => (err ? reject(err) : undefined));
    if (ok) {
      resolve();
    } else {
      socket.once("drain", resolve);
    }
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: Number(port) });
    socket.setNoDelay(true);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/// Read the driver's reply line after the terminator was sent.
function awaitAck(socket) {
  return new Promise((resolve, reject) => {
    let reply = "";
    const timer = setTimeout(
      () => reject(new Error("no acknowledgement in time")),
      ACK_TIMEOUT_MS,
    );
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.includes("\n")) {
        clearTimeout(timer);
        resolve(reply.trim());
      }
    });
    socket.once("end", () => {
      clearTimeout(timer);
      resolve(reply.trim());
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  const socket = await connect();
  let socketError = null;
  socket.on("error", (err) => {
    socketError = err;
  });
  await write(socket, Buffer.from(`tcab-collect/1 ${token}\n`, "utf8"));

  const args = [
    "-c",
    ...excludes.map((dir) => `--exclude=${dir}`),
    "-f",
    "-",
    "-C",
    workdir,
    ".",
  ];
  const tar = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
  let tarStderr = "";
  tar.stderr.on("data", (chunk) => {
    tarStderr += chunk.toString("utf8");
  });
  const tarExit = new Promise((resolve) => {
    tar.once("close", (code, signal) => resolve({ code, signal }));
  });

  const hash = createHash("sha256");
  let total = 0;
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of tar.stdout) {
      hash.update(chunk);
      total += chunk.length;
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= CHUNK) {
        await write(socket, frame(DATA, pending.subarray(0, CHUNK)));
        pending = pending.subarray(CHUNK);
      }
    }
    if (pending.length > 0) {
      await write(socket, frame(DATA, pending));
    }
  } catch (err) {
    tar.kill();
    fail(2, `streaming failed: ${socketError ?? err}`);
  }

  const { code, signal } = await tarExit;
  if (code === 1) {
    // GNU tar's "some files differ": a file changed while it was being read. The
    // archive is whole; the run just still had a writer alive. Say so and go on.
    process.stderr.write(`tar warned: ${tarStderr.trim()}\n`);
  } else if (code !== 0) {
    const why = signal ? `tar was killed by ${signal}` : `tar exited ${code}`;
    const message = `${why}: ${tarStderr.trim()}`;
    try {
      await write(socket, frame(FAILURE, Buffer.from(message, "utf8")));
    } catch {
      // The failure is reported through the exit code and stderr regardless.
    }
    socket.end();
    fail(3, message);
  }

  const terminator = Buffer.alloc(8 + 32);
  terminator.writeBigUInt64BE(BigInt(total), 0);
  hash.digest().copy(terminator, 8);
  try {
    await write(socket, frame(END, terminator));
    const reply = await awaitAck(socket);
    if (reply !== "ok") {
      fail(2, `upload refused: ${reply || "no reply"}`);
    }
  } catch (err) {
    fail(2, `finishing failed: ${socketError ?? err}`);
  }
  socket.end();
  process.stderr.write(`uploaded ${total} bytes\n`);
  process.exit(0);
}

main().catch((err) => fail(2, `failed: ${err}`));
