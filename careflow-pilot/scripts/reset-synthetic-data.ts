import { runResetSyntheticData } from "../src/server/maintenance/reset-synthetic.js";

process.exitCode = runResetSyntheticData({
  argv: process.argv.slice(2),
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
});
