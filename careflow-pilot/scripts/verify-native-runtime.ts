const stdoutWrite = process.stdout.write;
const stderrWrite = process.stderr.write;
const mutedWrite = (() => true) as typeof process.stdout.write;
const hasEsbuildBinaryOverride = Boolean(process.env.ESBUILD_BINARY_PATH);
const writeStdout = (message: string) => stdoutWrite.call(process.stdout, message);
const writeStderr = (message: string) => stderrWrite.call(process.stderr, message);

process.stdout.write = mutedWrite;
process.stderr.write = mutedWrite;

let verified = false;

try {
  if (hasEsbuildBinaryOverride) {
    throw new Error("Custom esbuild binary paths are not supported by the native runtime probe");
  }
  const { verifyNativeRuntime } = await import("../src/server/maintenance/native-runtime.js");
  await verifyNativeRuntime();
  verified = true;
} catch {
  // The fixed failure line below deliberately omits dependency diagnostics.
}

if (verified) {
  writeStdout("CareFlow native runtime verification complete\n");
} else {
  writeStderr("CareFlow native runtime verification failed\n");
  process.exitCode = 1;
}
