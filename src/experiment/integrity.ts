import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface DirectoryManifestEntry { path: string; size: number; sha256: string }

/** Sorted file manifest of a directory tree; symlinks are rejected, not followed. */
export function directoryManifest(root: string): DirectoryManifestEntry[] {
  const entries: DirectoryManifestEntry[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isSymbolicLink()) throw new Error(`snapshot refuses symlink: ${rel}`);
      if (item.isDirectory()) walk(full, rel);
      else if (item.isFile()) {
        const data = readFileSync(full);
        entries.push({ path: rel, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      }
    }
  };
  walk(root, '');
  return entries;
}

/** One content hash over the whole manifest; tampering with any file changes it. */
export function manifestHash(entries: DirectoryManifestEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) hash.update(`${entry.path}\n${entry.size}\n${entry.sha256}\n`);
  return hash.digest('hex');
}

export function hashDirectory(root: string): { entries: DirectoryManifestEntry[]; hash: string } {
  const entries = directoryManifest(root);
  return { entries, hash: manifestHash(entries) };
}

/** Recompute a directory's hash and compare with the frozen one. */
export function verifyDirectory(root: string, expectedHash: string): boolean {
  try {
    return hashDirectory(root).hash === expectedHash;
  } catch {
    return false;
  }
}

export function directorySize(root: string): number {
  return directoryManifest(root).reduce((total, entry) => total + entry.size, 0);
}

export function isDirectoryEmpty(root: string): boolean {
  try {
    return readdirSync(root).length === 0;
  } catch {
    return true;
  }
}
