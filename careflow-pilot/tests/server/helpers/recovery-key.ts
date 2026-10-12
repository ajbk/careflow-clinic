import { enums, generateKey } from "openpgp";

/** Ephemeral synthetic fixtures only; no product key generation or persistent credentials. */
export function generateTestRecoveryKey() {
  return generateKey({ type: "curve25519", config: { v6Keys: true, aeadProtect: true, preferredSymmetricAlgorithm: enums.symmetric.aes256, preferredAEADAlgorithm: enums.aead.gcm }, userIDs: [{ name: "Synthetic CareFlow recovery test" }], format: "armored" });
}
