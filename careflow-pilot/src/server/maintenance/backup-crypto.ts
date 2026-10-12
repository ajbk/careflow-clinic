import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, fsyncSync, openSync, readSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import * as openpgp from "openpgp";

const maxPackBytes = 8 * 1024 * 1024 * 1024;
const cryptoConfig: openpgp.PartialConfig = {
  aeadProtect: true,
  preferredSymmetricAlgorithm: openpgp.enums.symmetric.aes256,
  preferredAEADAlgorithm: openpgp.enums.aead.gcm,
  preferredCompressionAlgorithm: openpgp.enums.compression.uncompressed,
  allowUnauthenticatedMessages: false, allowUnauthenticatedStream: false,
  minRSABits: 3072, maxDecompressedMessageSize: maxPackBytes,
};
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function lengthPrefix(bytes: Buffer): Buffer { const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); return Buffer.concat([size, bytes]); }
export function syncFile(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }

/** Standard RFC 9580 OpenPGP envelope; all key wrapping, AEAD framing and authentication are library-owned. */
export async function encryptSnapshot(snapshot: string, manifest: unknown, target: string, publicKeyArmored: string): Promise<string> {
  const keys = await openpgp.readKeys({ armoredKeys: publicKeyArmored });
  if (keys.length !== 1 || keys[0].isPrivate() || keys[0].keyPacket.version !== 6) throw new Error("Backup requires one public OpenPGP v6 recovery key");
  const publicKey = keys[0];
  const sessionKey = await openpgp.generateSessionKey({ encryptionKeys: publicKey, config: cryptoConfig });
  if (sessionKey.algorithm !== "aes256" || sessionKey.aeadAlgorithm !== "gcm") throw new Error("Recovery key must advertise OpenPGP SEIPDv2 AES-256/GCM support");
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.length > 65_536 || statSync(snapshot).size + manifestBytes.length + 4 > maxPackBytes) throw new Error("Backup exceeds reviewed size limit");
  async function* plaintext() { yield lengthPrefix(manifestBytes); for await (const bytes of createReadStream(snapshot)) yield bytes; }
  const message = await openpgp.createMessage({ binary: Readable.toWeb(Readable.from(plaintext())) as ReadableStream<Uint8Array> });
  const encrypted = await openpgp.encrypt({ message, encryptionKeys: publicKey, sessionKey, format: "binary", config: cryptoConfig });
  await pipeline(Readable.fromWeb(encrypted as NodeReadableStream<Uint8Array>), createWriteStream(target, { flags: "wx", mode: 0o600 }));
  syncFile(target);
  return publicKey.getFingerprint();
}

/** No snapshot is opened until the entire OpenPGP stream has authenticated successfully. */
export async function decryptSnapshot(archive: string, privateKeyArmored: string, packedPath: string, snapshotPath: string, expectedKeyId: string): Promise<unknown> {
  const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
  if (privateKey.keyPacket.version !== 6 || !privateKey.isDecrypted() || privateKey.getFingerprint() !== expectedKeyId) throw new Error("Backup recovery key mismatch or locked key");
  const message = await openpgp.readMessage({ binaryMessage: Readable.toWeb(createReadStream(archive)) as ReadableStream<Uint8Array>, config: cryptoConfig });
  const packet = message.packets.findPacket(openpgp.enums.packet.symEncryptedIntegrityProtectedData);
  if (!packet || !("version" in packet) || packet.version !== 2 || !("cipherAlgorithm" in packet) || packet.cipherAlgorithm !== openpgp.enums.symmetric.aes256 || !("aeadAlgorithm" in packet) || packet.aeadAlgorithm !== openpgp.enums.aead.gcm) throw new Error("Backup requires OpenPGP SEIPDv2 AES-256/GCM");
  const { data } = await openpgp.decrypt({ message, decryptionKeys: privateKey, format: "binary", config: cryptoConfig });
  let size = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    callback(size > maxPackBytes ? new Error("Decrypted backup exceeds reviewed size limit") : null, chunk);
  } });
  await pipeline(Readable.fromWeb(data as NodeReadableStream<Uint8Array>), limit, createWriteStream(packedPath, { flags: "wx", mode: 0o600 }));
  const packed = openSync(packedPath, "r"); let manifest: unknown; let databaseOffset: number;
  try {
    const prefix = Buffer.alloc(4); if (readSync(packed, prefix, 0, 4, 0) !== 4) throw new Error("Missing encrypted manifest");
    const length = prefix.readUInt32BE(); if (length > 65_536 || length < 2) throw new Error("Invalid encrypted manifest");
    const bytes = Buffer.alloc(length); if (readSync(packed, bytes, 0, length, 4) !== length) throw new Error("Truncated encrypted manifest");
    manifest = JSON.parse(bytes.toString("utf8")); databaseOffset = 4 + length;
  } finally { closeSync(packed); }
  await pipeline(createReadStream(packedPath, { start: databaseOffset }), createWriteStream(snapshotPath, { flags: "wx", mode: 0o600 }));
  return manifest;
}
