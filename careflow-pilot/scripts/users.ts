import { createInterface } from "node:readline/promises";
import { runUsersCli } from "../src/server/modules/platform/users-cli.js";

async function promptText(label: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return await terminal.question(label);
  } finally {
    terminal.close();
  }
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Interactive TTY required");
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") return finish(new Error("Prompt cancelled"));
      if (text === "\r" || text === "\n") return finish();
      if (text === "\u007f") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      value += text;
    };
    process.stdin.on("data", onData);
  });
}

process.exitCode = await runUsersCli({
  argv: process.argv.slice(2),
  env: process.env,
  promptSecret,
  promptText,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
});
