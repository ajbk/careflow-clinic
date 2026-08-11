import { runExpireUatDoctorSession } from "../src/server/maintenance/expire-uat-doctor-session.js";

process.exitCode = runExpireUatDoctorSession({
  argv: process.argv.slice(2),
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
});
