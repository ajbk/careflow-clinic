import { createHash } from "node:crypto";
import type { DatabaseHandle } from "../db/client.js";
import { ApiError } from "../errors.js";

function limited(): never {
  throw new ApiError({ code: "RATE_LIMITED", messageTh: "มีการลองรหัสผ่านมากเกินไป กรุณารอสักครู่", retryAfterSeconds: 60 });
}

/** Fixed one-minute budgets count admission, including in-flight work and successes.
 * No account existence signal, unbounded map, or IP rotation bypass. A restart keeps budgets. */
export function createPasswordLimiter(database: DatabaseHandle, clock: () => number,
  options: { maxBuckets?: number; maxConcurrent?: number } = {}) {
  let pending = 0;
  const maxBuckets = options.maxBuckets ?? 1024;
  const maxConcurrent = options.maxConcurrent ?? 2;
  return {
    admit(account: string, ip: string): () => void {
      if (pending >= maxConcurrent) limited();
      const now = clock();
      const buckets = [
        { key: `account:${account.normalize("NFKC").trim().toLocaleLowerCase("en-US")}`, limit: 5 },
        { key: `ip:${ip}`, limit: 30 },
      ].map(({ key, limit }) => ({ key: createHash("sha256").update(key).digest("hex"), limit }));
      database.sqlite.transaction(() => {
        database.sqlite.prepare("DELETE FROM auth_rate_limits WHERE expires_at <= ?").run(now);
        let count = database.sqlite.prepare("SELECT count(*) FROM auth_rate_limits").pluck().get() as number;
        for (const { key, limit } of buckets) {
          const row = database.sqlite.prepare("SELECT attempts FROM auth_rate_limits WHERE bucket = ?").get(key) as { attempts: number } | undefined;
          if (row && row.attempts >= limit) limited();
          if (!row && ++count > maxBuckets) limited();
          database.sqlite.prepare(`INSERT INTO auth_rate_limits (bucket, attempts, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1`).run(key, now + 60_000);
        }
      }).immediate();
      pending++;
      let released = false;
      return () => { if (!released) { pending--; released = true; } };
    },
  };
}
