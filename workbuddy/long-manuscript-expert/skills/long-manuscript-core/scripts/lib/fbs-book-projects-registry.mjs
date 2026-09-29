/**
 * Package-local, read-only registry adapter.
 *
 * A registry is consumed only when the caller supplies registryPath or sets
 * FBS_BOOK_REGISTRY_PATH. No user-global default path is inferred and this
 * module never writes host or memory state.
 */
import fs from "node:fs";
import path from "node:path";

const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;

function readRegistry(registryPath) {
  const selected = registryPath || process.env.FBS_BOOK_REGISTRY_PATH;
  if (!selected) return [];
  const absolute = path.resolve(String(selected));
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_REGISTRY_BYTES || path.extname(absolute).toLowerCase() !== ".json") return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : parsed.entries;
    return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object") : [];
  } catch {
    return [];
  }
}

export function listRegistryEntries(options = {}) {
  return readRegistry(options.registryPath).filter((entry) => {
    if (!entry.bookRoot || typeof entry.bookRoot !== "string") return false;
    const root = path.resolve(entry.bookRoot);
    if (!fs.existsSync(root)) return false;
    const stat = fs.lstatSync(root);
    return stat.isDirectory() && !stat.isSymbolicLink();
  });
}

export function searchBookProjects(keyword, options = {}) {
  const query = String(keyword || "").normalize("NFKC").trim().toLowerCase();
  if (!query) return [];
  return listRegistryEntries(options)
    .map((entry) => {
      const root = path.resolve(entry.bookRoot);
      const title = String(entry.bookTitle || "").toLowerCase();
      let score = 0;
      if (title.includes(query)) score += 3;
      if (root.toLowerCase().includes(query)) score += 1;
      if (path.basename(root).toLowerCase().includes(query)) score += 2;
      return { ...entry, bookRoot: root, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.bookRoot.localeCompare(right.bookRoot, "en"));
}
