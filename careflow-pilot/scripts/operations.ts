import { runOperationsCli } from "../src/server/maintenance/operations-cli.js";
process.exitCode = await runOperationsCli({ argv: process.argv.slice(2), stdout: (line) => process.stdout.write(`${line}\n`), stderr: (line) => process.stderr.write(`${line}\n`) });
