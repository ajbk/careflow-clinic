import {
  chmodSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface HostLock {
  databasePath: string;
  lockPath: string;
  release: () => void;
}

function pathKind(path: string): "missing" | "symlink" | "directory" | "file" {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    return "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

function assertPrivateParent(parentPath: string): void {
  if (process.platform === "win32") return;
  if ((statSync(parentPath).mode & 0o077) !== 0) {
    throw new Error("CareFlow database parent must have private permissions");
  }
}

export function resolveDatabaseTarget(inputPath: string): { databasePath: string; lockPath: string } {
  if (process.platform !== "win32") process.umask(0o077);

  const absoluteTarget = resolve(inputPath);
  const unresolvedParent = dirname(absoluteTarget);
  const targetKind = pathKind(absoluteTarget);
  if (targetKind === "symlink") throw new Error("CareFlow database target must not be a symbolic link");
  if (targetKind === "directory") throw new Error("CareFlow database target must be a file");

  const parentKind = pathKind(unresolvedParent);
  if (parentKind === "missing") {
    mkdirSync(unresolvedParent, { mode: 0o700 });
  } else if (parentKind !== "directory" && parentKind !== "symlink") {
    throw new Error("CareFlow database parent must be a directory");
  }

  let canonicalParent: string;
  try {
    canonicalParent = realpathSync(unresolvedParent);
  } catch {
    throw new Error("CareFlow database parent could not be canonicalized");
  }
  if (!statSync(canonicalParent).isDirectory()) {
    throw new Error("CareFlow database parent must be a directory");
  }
  assertPrivateParent(canonicalParent);

  let databasePath = join(canonicalParent, basename(absoluteTarget));
  const canonicalTargetKind = pathKind(databasePath);
  if (canonicalTargetKind === "symlink") {
    throw new Error("CareFlow database target must not be a symbolic link");
  }
  if (canonicalTargetKind === "directory") throw new Error("CareFlow database target must be a file");
  if (canonicalTargetKind === "file") {
    databasePath = realpathSync(databasePath);
    if (statSync(databasePath).nlink > 1) {
      throw new Error("CareFlow database target must not have filesystem aliases");
    }
  }

  return {
    databasePath,
    lockPath: join(canonicalParent, `${basename(databasePath)}.careflow-running`),
  };
}

export function acquireHostLock(inputPath: string): HostLock {
  const target = resolveDatabaseTarget(inputPath);
  try {
    mkdirSync(target.lockPath, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(target.lockPath, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("CareFlow Clinic Host is already running or has a stale lock");
    }
    throw error;
  }

  let released = false;
  return {
    ...target,
    release: () => {
      if (released) return;
      rmdirSync(target.lockPath);
      released = true;
    },
  };
}
