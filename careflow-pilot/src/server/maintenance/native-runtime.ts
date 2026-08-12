import argon2 from "argon2";
import Database from "better-sqlite3";
import { transform } from "esbuild";

const probeBytes = Buffer.from("careflow-native-runtime-probe", "utf8");

export async function verifyNativeRuntime(): Promise<void> {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("CREATE TABLE native_probe (value TEXT NOT NULL)");
    const writeAndRead = sqlite.transaction((value: string): string | undefined => {
      sqlite.prepare("INSERT INTO native_probe (value) VALUES (?)").run(value);
      return sqlite.prepare("SELECT value FROM native_probe").pluck().get() as string | undefined;
    });
    if (writeAndRead("native-runtime") !== "native-runtime") {
      throw new Error("SQLite native runtime verification failed");
    }
  } finally {
    sqlite.close();
  }

  const passwordHash = await argon2.hash(probeBytes, {
    type: argon2.argon2id,
    memoryCost: 8_192,
    timeCost: 1,
    parallelism: 1,
  });
  if (!(await argon2.verify(passwordHash, probeBytes))) {
    throw new Error("Argon2 native runtime verification failed");
  }

  const transformed = await transform("const nativeProbe: number = 1;", {
    loader: "ts",
    target: "es2022",
  });
  if (!transformed.code.includes("const nativeProbe = 1")) {
    throw new Error("esbuild runtime verification failed");
  }
}
