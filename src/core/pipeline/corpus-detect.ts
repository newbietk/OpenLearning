import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorpusDetectResult {
  scanRoot: string;
  totalFiles: number;
  totalWords: number;
  files: {
    code: string[];
    document: string[];
    paper: string[];
    image: string[];
    video: string[];
  };
  summary: {
    code: number;
    document: number;
    paper: number;
    image: number;
    video: number;
  };
  skippedSensitive: string[];
  subdirBreakdown: Array<{ dir: string; count: number }>;
}

type CorpusCategory = "code" | "document" | "paper" | "image" | "video";

// ---------------------------------------------------------------------------
// Extension-to-category lookup tables
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, CorpusCategory> = {
  // code
  py: "code", ts: "code", tsx: "code", js: "code", jsx: "code",
  go: "code", rs: "code", java: "code", c: "code", cpp: "code",
  h: "code", hpp: "code", rb: "code", php: "code", cs: "code",
  swift: "code", kt: "code", scala: "code", lua: "code",
  sh: "code", bash: "code", sql: "code", css: "code",
  html: "code", vue: "code", svelte: "code",
  // document
  md: "document", markdown: "document", txt: "document",
  mdx: "document", rst: "document", tex: "document", log: "document",
  csv: "document", json: "document", xml: "document", yaml: "document",
  yml: "document", toml: "document",
  // paper
  pdf: "paper",
  // image
  png: "image", jpg: "image", jpeg: "image", gif: "image",
  svg: "image", webp: "image", bmp: "image", ico: "image",
  // video
  mp4: "video", mp3: "video", wav: "video", avi: "video",
  mov: "video", mkv: "video", webm: "video", ogg: "video",
};

// ---------------------------------------------------------------------------
// Sensitive-file matchers
// ---------------------------------------------------------------------------

function isSensitive(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const base = path.basename(lower);

  // Extension-based patterns: .pem, .key, .token
  // Note: path.extname("dotfile") returns "" so we check base directly for dot-prefixed names.
  if (base === ".token" || base.endsWith(".pem") || base.endsWith(".key")) return true;

  // Exact filename matches
  if (base === ".env" || base === "id_rsa") return true;

  // ".env" suffix (e.g. "prod.env")
  if (base.endsWith(".env")) return true;

  // Substring matches for credential/secret files
  if (base.includes("credentials") || base.includes("secrets")) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Directories to skip
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".codegraph", "dist", "__pycache__",
  ".pytest_cache", ".venv", "venv", "build", "target", ".next", ".turbo",
]);

function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRS.has(dirName);
}

// ---------------------------------------------------------------------------
// Word counting
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// Extension extraction
// ---------------------------------------------------------------------------

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "";
  // Dotfiles like ".eslintrc.json": dot is at index 0, treat as normal
  if (dotIndex === 0) {
    // Check if there's another dot after the first char
    const nextDot = fileName.indexOf(".", 1);
    if (nextDot > 0) return fileName.slice(nextDot + 1).toLowerCase();
    return fileName.slice(1).toLowerCase();
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

function detectCorpus(rootPath: string): CorpusDetectResult {
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootPath}`);
  }

  const result: CorpusDetectResult = {
    scanRoot: rootPath,
    totalFiles: 0,
    totalWords: 0,
    files: { code: [], document: [], paper: [], image: [], video: [] },
    summary: { code: 0, document: 0, paper: 0, image: 0, video: 0 },
    skippedSensitive: [],
    subdirBreakdown: [],
  };

  const subdirCounts: Record<string, number> = {};

  walkDirectory(rootPath, rootPath, result, subdirCounts);

  // Build subdir breakdown: top 5 by count, ties broken alphabetically
  const entries = Object.entries(subdirCounts)
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.dir.localeCompare(b.dir);
    })
    .slice(0, 5);

  result.subdirBreakdown = entries;

  return result;
}

function walkDirectory(
  rootPath: string,
  currentPath: string,
  result: CorpusDetectResult,
  subdirCounts: Record<string, number>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return; // Permission errors etc. — skip silently
  }

  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walkDirectory(rootPath, fullPath, result, subdirCounts);
      continue;
    }

    if (!entry.isFile()) continue; // Skip symlinks, sockets, etc.

    // Sensitive-file check
    if (isSensitive(entry.name)) {
      result.skippedSensitive.push(relativePath);
      continue;
    }

    // Category check
    const ext = getExtension(entry.name);
    const category = ext ? EXTENSION_MAP[ext] : undefined;
    if (!category) continue; // Unknown extension — skip

    // Count the file
    result.totalFiles++;
    result.summary[category]++;
    result.files[category].push(relativePath);

    // Word count
    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      // Binary or unreadable — treat as 0 words
    }
    result.totalWords += countWords(content);

    // Subdir count
    const slashIndex = relativePath.indexOf("/");
    const topDir = slashIndex > 0 ? relativePath.slice(0, slashIndex) : ".";
    subdirCounts[topDir] = (subdirCounts[topDir] ?? 0) + 1;
  }
}

export { detectCorpus };
