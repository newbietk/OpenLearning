import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectCorpus, CorpusDetectResult } from "../corpus-detect";

describe("detectCorpus", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-detect-"));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function writeFile(relativePath: string, content = "test content"): void {
    const fullPath = path.join(tmpDir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
  }

  function writeEmptyFile(relativePath: string): void {
    writeFile(relativePath, "");
  }

  // ============================================================================
  // Empty directory
  // ============================================================================
  describe("empty directory", () => {
    it("returns zeroes for all fields", () => {
      const result = detectCorpus(tmpDir);

      expect(result.scanRoot).toBe(tmpDir);
      expect(result.totalFiles).toBe(0);
      expect(result.totalWords).toBe(0);
      expect(result.summary.code).toBe(0);
      expect(result.summary.document).toBe(0);
      expect(result.summary.paper).toBe(0);
      expect(result.summary.image).toBe(0);
      expect(result.summary.video).toBe(0);
      expect(result.files.code).toEqual([]);
      expect(result.files.document).toEqual([]);
      expect(result.files.paper).toEqual([]);
      expect(result.files.image).toEqual([]);
      expect(result.files.video).toEqual([]);
      expect(result.skippedSensitive).toEqual([]);
      expect(result.subdirBreakdown).toEqual([]);
    });
  });

  // ============================================================================
  // Non-existent directory
  // ============================================================================
  describe("non-existent directory", () => {
    it("throws an error for a path that does not exist", () => {
      const badPath = path.join(tmpDir, "does-not-exist");

      expect(() => detectCorpus(badPath)).toThrow();
    });
  });

  // ============================================================================
  // Path is a file, not a directory
  // ============================================================================
  describe("path is a file", () => {
    it("throws an error when given a file path", () => {
      writeFile("just-a-file.txt", "hello");
      const filePath = path.join(tmpDir, "just-a-file.txt");

      expect(() => detectCorpus(filePath)).toThrow();
    });
  });

  // ============================================================================
  // Code file detection
  // ============================================================================
  describe("code file detection", () => {
    const codeExtensions = [
      "py", "ts", "tsx", "js", "jsx", "go", "rs", "java",
      "c", "cpp", "h", "hpp", "rb", "php", "cs", "swift",
      "kt", "scala", "lua", "sh", "bash", "sql", "css",
      "html", "vue", "svelte",
    ];

    it("detects all code extensions", () => {
      for (const ext of codeExtensions) {
        writeFile(`src/file_${ext}.${ext}`, "code content here");
      }

      const result = detectCorpus(tmpDir);

      expect(result.summary.code).toBe(codeExtensions.length);
      expect(result.files.code).toHaveLength(codeExtensions.length);
      expect(result.totalFiles).toBe(codeExtensions.length);
    });

    it("detects code files in subdirectories", () => {
      writeFile("src/main.ts", "export const x = 1;");
      writeFile("lib/utils.py", "def hello(): pass");
      writeFile("components/App.tsx", "const App = () => null;");

      const result = detectCorpus(tmpDir);

      expect(result.summary.code).toBe(3);
      expect(result.files.code).toHaveLength(3);
    });
  });

  // ============================================================================
  // Document file detection
  // ============================================================================
  describe("document file detection", () => {
    const docExtensions = [
      "md", "markdown", "txt", "mdx", "rst", "tex",
      "log", "csv", "json", "xml", "yaml", "yml", "toml",
    ];

    it("detects all document extensions", () => {
      for (const ext of docExtensions) {
        writeFile(`docs/doc_${ext}.${ext}`, "document content goes here");
      }

      const result = detectCorpus(tmpDir);

      expect(result.summary.document).toBe(docExtensions.length);
      expect(result.files.document).toHaveLength(docExtensions.length);
      expect(result.totalFiles).toBe(docExtensions.length);
    });
  });

  // ============================================================================
  // Paper (PDF) detection
  // ============================================================================
  describe("paper file detection", () => {
    it("detects .pdf files as paper type", () => {
      writeFile("papers/research.pdf", "%PDF-1.4 fake content");
      writeFile("papers/notes.pdf", "%PDF-1.5 fake content");

      const result = detectCorpus(tmpDir);

      expect(result.summary.paper).toBe(2);
      expect(result.files.paper).toHaveLength(2);
      expect(result.files.paper.every((f) => f.endsWith(".pdf"))).toBe(true);
    });
  });

  // ============================================================================
  // Image file detection
  // ============================================================================
  describe("image file detection", () => {
    const imageExtensions = [
      "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico",
    ];

    it("detects all image extensions", () => {
      for (const ext of imageExtensions) {
        writeFile(`images/img_${ext}.${ext}`, "fake binary");
      }

      const result = detectCorpus(tmpDir);

      expect(result.summary.image).toBe(imageExtensions.length);
      expect(result.files.image).toHaveLength(imageExtensions.length);
    });
  });

  // ============================================================================
  // Video file detection
  // ============================================================================
  describe("video file detection", () => {
    const videoExtensions = [
      "mp4", "mp3", "wav", "avi", "mov", "mkv", "webm", "ogg",
    ];

    it("detects all video extensions", () => {
      for (const ext of videoExtensions) {
        writeFile(`media/clip_${ext}.${ext}`, "fake media content");
      }

      const result = detectCorpus(tmpDir);

      expect(result.summary.video).toBe(videoExtensions.length);
      expect(result.files.video).toHaveLength(videoExtensions.length);
    });
  });

  // ============================================================================
  // Mixed file types
  // ============================================================================
  describe("mixed file types", () => {
    it("correctly categorizes a mix of all types", () => {
      writeFile("src/app.ts", "code");
      writeFile("src/utils.go", "code");
      writeFile("docs/readme.md", "doc");
      writeFile("docs/notes.txt", "doc");
      writeFile("docs/data.json", "doc");
      writeFile("papers/paper.pdf", "pdf");
      writeFile("images/logo.png", "img");
      writeFile("images/banner.jpg", "img");
      writeFile("media/tutorial.mp4", "vid");

      const result = detectCorpus(tmpDir);

      expect(result.summary.code).toBe(2);
      expect(result.summary.document).toBe(3);
      expect(result.summary.paper).toBe(1);
      expect(result.summary.image).toBe(2);
      expect(result.summary.video).toBe(1);
      expect(result.totalFiles).toBe(9);
    });
  });

  // ============================================================================
  // Case-insensitive extensions
  // ============================================================================
  describe("case-insensitive extensions", () => {
    it("detects uppercase extensions", () => {
      writeFile("src/App.TS", "code");
      writeFile("docs/README.MD", "doc");
      writeFile("images/LOGO.PNG", "img");
      writeFile("papers/PAPER.PDF", "paper");
      writeFile("media/AUDIO.MP3", "audio");

      const result = detectCorpus(tmpDir);

      expect(result.summary.code).toBe(1);
      expect(result.summary.document).toBe(1);
      expect(result.summary.image).toBe(1);
      expect(result.summary.paper).toBe(1);
      expect(result.summary.video).toBe(1);
      expect(result.totalFiles).toBe(5);
    });

    it("detects mixed-case extensions", () => {
      writeFile("src/App.Ts", "code");
      writeFile("docs/Readme.Md", "doc");
      writeFile("images/Logo.PnG", "img");

      const result = detectCorpus(tmpDir);

      expect(result.summary.code).toBe(1);
      expect(result.summary.document).toBe(1);
      expect(result.summary.image).toBe(1);
    });
  });

  // ============================================================================
  // Files with no extension
  // ============================================================================
  describe("files with no extension", () => {
    it("ignores files without an extension", () => {
      writeFile("bin/executable", "binary content");
      writeFile("Makefile", "all: build");
      writeFile("Dockerfile", "FROM node:20");
      writeFile("LICENSE", "MIT");

      const result = detectCorpus(tmpDir);

      expect(result.totalFiles).toBe(0);
      expect(result.summary.code).toBe(0);
      expect(result.summary.document).toBe(0);
    });
  });

  // ============================================================================
  // Unknown extensions
  // ============================================================================
  describe("unknown extensions", () => {
    it("ignores files with unrecognized extensions", () => {
      writeFile("data/file.xyz", "unknown");
      writeFile("data/data.bin", "binary");
      writeFile("data/config.ini", "config");

      const result = detectCorpus(tmpDir);

      expect(result.totalFiles).toBe(0);
    });
  });

  // ============================================================================
  // Dotfiles with known extensions
  // ============================================================================
  describe("dotfiles with known extensions", () => {
    it("recognizes dotfiles that have known extensions", () => {
      writeFile(".eslintrc.json", '{"rules": {}}');
      writeFile(".prettierrc.yaml", "semi: true");

      const result = detectCorpus(tmpDir);

      expect(result.summary.document).toBe(2);
      expect(result.files.document).toHaveLength(2);
    });
  });

  // ============================================================================
  // Files with multiple dots
  // ============================================================================
  describe("files with multiple dots", () => {
    it("uses the last extension for categorization", () => {
      writeFile("src/main.test.ts", "test code");
      writeFile("docs/guide.v1.md", "docs");
      writeFile("images/site.min.svg", "svg content");

      const result = detectCorpus(tmpDir);

      expect(result.summary.code).toBe(1);
      expect(result.summary.document).toBe(1);
      expect(result.summary.image).toBe(1);
      expect(result.files.code[0]).toContain("main.test.ts");
      expect(result.files.document[0]).toContain("guide.v1.md");
      expect(result.files.image[0]).toContain("site.min.svg");
    });
  });

  // ============================================================================
  // Sensitive file skipping
  // ============================================================================
  describe("sensitive file skipping", () => {
    it("skips .env files", () => {
      writeFile(".env", "SECRET=key");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toContain(".env");
      expect(result.totalFiles).toBe(1); // only app.ts counted
      expect(result.summary.code).toBe(1);
    });

    it("skips files containing 'credentials' in name", () => {
      writeFile("credentials.json", "{}");
      writeFile("aws-credentials.txt", "key=value");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toHaveLength(2);
      expect(result.skippedSensitive).toContain("credentials.json");
      expect(result.skippedSensitive).toContain("aws-credentials.txt");
      expect(result.totalFiles).toBe(1);
    });

    it("skips files containing 'secrets' in name", () => {
      writeFile("secrets.yaml", "key: value");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toContain("secrets.yaml");
      expect(result.totalFiles).toBe(1);
    });

    it("skips .pem files", () => {
      writeFile("key.pem", "-----BEGIN CERTIFICATE-----");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toContain("key.pem");
      expect(result.totalFiles).toBe(1);
    });

    it("skips .key files", () => {
      writeFile("private.key", "-----BEGIN PRIVATE KEY-----");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toContain("private.key");
      expect(result.totalFiles).toBe(1);
    });

    it("skips files matching id_rsa pattern", () => {
      writeFile("id_rsa", "ssh key content");
      writeFile(".ssh/id_rsa", "ssh key content");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toHaveLength(2);
      expect(result.skippedSensitive).toContain("id_rsa");
      expect(result.totalFiles).toBe(1);
    });

    it("skips .token files", () => {
      writeFile(".token", "ghp_xxxxxxxx");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toContain(".token");
      expect(result.totalFiles).toBe(1);
    });

    it("skips sensitive files in subdirectories", () => {
      writeFile("config/.env", "SECRET=key");
      writeFile("config/prod.env", "SECRET=prod");
      writeFile("src/app.ts", "code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toHaveLength(2);
      expect(result.totalFiles).toBe(1);
    });

    it("does not skip files that merely contain sensitive substrings", () => {
      // "token" as a substring should not trigger skip
      writeFile("src/tokenizer.ts", "token code");
      // ".env" as a substring should not trigger skip
      writeFile("src/environment.ts", "env code");

      const result = detectCorpus(tmpDir);

      expect(result.skippedSensitive).toHaveLength(0);
      expect(result.totalFiles).toBe(2);
      expect(result.summary.code).toBe(2);
    });
  });

  // ============================================================================
  // Directory skipping
  // ============================================================================
  describe("directory skipping", () => {
    const skipDirs = [
      "node_modules",
      ".git",
      ".codegraph",
      "dist",
      "__pycache__",
      ".pytest_cache",
      ".venv",
      "venv",
      "build",
      "target",
      ".next",
      ".turbo",
    ];

    it("skips all known directories that should be ignored", () => {
      for (const dir of skipDirs) {
        writeFile(`${dir}/some-file.txt`, `content in ${dir}`);
      }
      // Add one real file outside skipped dirs
      writeFile("src/real-file.txt", "real content");

      const result = detectCorpus(tmpDir);

      // Only the real file above should be counted
      expect(result.summary.document).toBe(1);
      expect(result.totalFiles).toBe(1);
      expect(result.files.document).toHaveLength(1);
    });

    it("skips nested skip directories", () => {
      writeFile("packages/lib/node_modules/pkg/index.js", "module");
      writeFile("src/app.ts", "source");

      const result = detectCorpus(tmpDir);

      expect(result.totalFiles).toBe(1);
      expect(result.summary.code).toBe(1);
    });
  });

  // ============================================================================
  // Word counting
  // ============================================================================
  describe("word counting", () => {
    it("counts words by splitting on whitespace", () => {
      writeFile("docs/a.txt", "hello world");
      writeFile("docs/b.txt", "one two three four");

      const result = detectCorpus(tmpDir);

      // 2 words + 4 words = 6 words
      expect(result.totalWords).toBe(6);
    });

    it("handles multiple whitespace characters", () => {
      writeFile("docs/a.txt", "hello   world\nfoo\tbar");

      const result = detectCorpus(tmpDir);

      // hello, world, foo, bar = 4 words
      expect(result.totalWords).toBe(4);
    });

    it("counts words across all file types", () => {
      writeFile("src/a.ts", "const x = 1;");
      writeFile("docs/b.txt", "document text here");
      writeFile("papers/c.pdf", "PDF paper content");

      const result = detectCorpus(tmpDir);

      // 4 + 3 + 3 = 10
      expect(result.totalWords).toBe(10);
    });

    it("returns 0 for empty files", () => {
      writeFile("docs/empty.txt", "");
      writeFile("docs/whitespace.txt", "   \n  \t  ");

      const result = detectCorpus(tmpDir);

      expect(result.totalWords).toBe(0);
    });

    it("does not count words in sensitive files", () => {
      writeFile(".env", "SECRET_KEY=abc123 token=xyz");
      writeFile("docs/real.txt", "five words in this file");

      const result = detectCorpus(tmpDir);

      expect(result.totalWords).toBe(5);
    });

    it("does not count words in skipped directories", () => {
      writeFile("node_modules/readme.md", "many words in node modules here more");
      writeFile("docs/real.txt", "two words");

      const result = detectCorpus(tmpDir);

      expect(result.totalWords).toBe(2);
    });

    it("handles large files with many words", () => {
      const words = Array.from({ length: 10000 }, (_, i) => `word${i}`).join(" ");
      writeFile("docs/large.txt", words);

      const result = detectCorpus(tmpDir);

      expect(result.totalWords).toBe(10000);
    });
  });

  // ============================================================================
  // Subdir breakdown
  // ============================================================================
  describe("subdir breakdown", () => {
    it("returns top 5 subdirectories by file count", () => {
      // Create 8 subdirectories with varying file counts
      writeFile("a/f1.txt", "x");
      writeFile("a/f2.txt", "x");
      writeFile("a/f3.txt", "x");
      writeFile("a/f4.txt", "x");
      writeFile("a/f5.txt", "x");
      writeFile("a/f6.txt", "x"); // a: 6

      writeFile("b/f1.txt", "x");
      writeFile("b/f2.txt", "x");
      writeFile("b/f3.txt", "x");
      writeFile("b/f4.txt", "x"); // b: 4

      writeFile("c/f1.txt", "x");
      writeFile("c/f2.txt", "x");
      writeFile("c/f3.txt", "x"); // c: 3

      writeFile("d/f1.txt", "x");
      writeFile("d/f2.txt", "x"); // d: 2

      writeFile("e/f1.txt", "x");
      writeFile("e/f2.txt", "x"); // e: 2

      writeFile("f/f1.txt", "x"); // f: 1
      writeFile("g/f1.txt", "x"); // g: 1
      writeFile("h/f1.txt", "x"); // h: 1

      const result = detectCorpus(tmpDir);

      expect(result.subdirBreakdown).toHaveLength(5);
      expect(result.subdirBreakdown[0]).toEqual({ dir: "a", count: 6 });
      expect(result.subdirBreakdown[1]).toEqual({ dir: "b", count: 4 });
      expect(result.subdirBreakdown[2]).toEqual({ dir: "c", count: 3 });
      expect(result.subdirBreakdown[3]).toEqual({ dir: "d", count: 2 });
      expect(result.subdirBreakdown[4]).toEqual({ dir: "e", count: 2 });
    });

    it("handles fewer than 5 subdirectories", () => {
      writeFile("src/a.txt", "x");
      writeFile("docs/b.txt", "x");

      const result = detectCorpus(tmpDir);

      expect(result.subdirBreakdown).toHaveLength(2);
      expect(result.subdirBreakdown[0]).toEqual({ dir: "docs", count: 1 });
      expect(result.subdirBreakdown[1]).toEqual({ dir: "src", count: 1 });
    });

    it("handles nested subdirectories", () => {
      writeFile("a/b/c/file.txt", "x");
      writeFile("a/b/file.txt", "x");
      writeFile("a/file.txt", "x");
      writeFile("d/file.txt", "x");

      const result = detectCorpus(tmpDir);

      // All three files in "a" tree, one in "d"
      expect(result.subdirBreakdown[0]).toEqual({ dir: "a", count: 3 });
      expect(result.subdirBreakdown[1]).toEqual({ dir: "d", count: 1 });
    });

    it("excludes skipped directories from breakdown", () => {
      writeFile("node_modules/pkg/a.txt", "x");
      writeFile("node_modules/pkg/b.txt", "x");
      writeFile("node_modules/pkg/c.txt", "x");
      writeFile("src/real.txt", "x");

      const result = detectCorpus(tmpDir);

      // node_modules should not appear in breakdown
      const nodeModulesEntry = result.subdirBreakdown.find((e) => e.dir === "node_modules");
      expect(nodeModulesEntry).toBeUndefined();
      expect(result.subdirBreakdown[0]).toEqual({ dir: "src", count: 1 });
    });

    it("excludes sensitive files from subdir counts", () => {
      writeFile("src/.env", "secret");
      writeFile("src/real.txt", "real");
      writeFile("docs/real.txt", "real");

      const result = detectCorpus(tmpDir);

      expect(result.subdirBreakdown[0]).toEqual({ dir: "docs", count: 1 });
      expect(result.subdirBreakdown[1]).toEqual({ dir: "src", count: 1 });
    });

    it("breaks ties by alphabetical order", () => {
      writeFile("z/f1.txt", "x");
      writeFile("z/f2.txt", "x");
      writeFile("a/f1.txt", "x");
      writeFile("a/f2.txt", "x");
      writeFile("m/f1.txt", "x");
      writeFile("m/f2.txt", "x");

      const result = detectCorpus(tmpDir);

      // All tied at 2, should be alphabetical
      expect(result.subdirBreakdown[0]).toEqual({ dir: "a", count: 2 });
      expect(result.subdirBreakdown[1]).toEqual({ dir: "m", count: 2 });
      expect(result.subdirBreakdown[2]).toEqual({ dir: "z", count: 2 });
    });
  });

  // ============================================================================
  // Recursive traversal
  // ============================================================================
  describe("recursive traversal", () => {
    it("traverses deeply nested directories", () => {
      writeFile("a/b/c/d/e/deep-file.txt", "deep content");

      const result = detectCorpus(tmpDir);

      expect(result.totalFiles).toBe(1);
      expect(result.subdirBreakdown[0]).toEqual({ dir: "a", count: 1 });
    });

    it("collects files at all nesting levels", () => {
      writeFile("root-file.txt", "root");
      writeFile("level1/file.txt", "l1");
      writeFile("level1/level2/file.txt", "l2");
      writeFile("level1/level2/level3/file.txt", "l3");

      const result = detectCorpus(tmpDir);

      expect(result.totalFiles).toBe(4);
      expect(result.summary.document).toBe(4);
    });
  });

  // ============================================================================
  // Result structure completeness
  // ============================================================================
  describe("result structure", () => {
    it("returns a well-formed CorpusDetectResult with all required fields", () => {
      writeFile("src/app.ts", "code");
      writeFile("docs/readme.md", "doc");

      const result: CorpusDetectResult = detectCorpus(tmpDir);

      // Check all top-level fields exist
      expect(result).toHaveProperty("scanRoot");
      expect(result).toHaveProperty("totalFiles");
      expect(result).toHaveProperty("totalWords");
      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("skippedSensitive");
      expect(result).toHaveProperty("subdirBreakdown");

      // Check files sub-objects
      expect(Array.isArray(result.files.code)).toBe(true);
      expect(Array.isArray(result.files.document)).toBe(true);
      expect(Array.isArray(result.files.paper)).toBe(true);
      expect(Array.isArray(result.files.image)).toBe(true);
      expect(Array.isArray(result.files.video)).toBe(true);

      // Check summary has all number fields
      expect(typeof result.summary.code).toBe("number");
      expect(typeof result.summary.document).toBe("number");
      expect(typeof result.summary.paper).toBe("number");
      expect(typeof result.summary.image).toBe("number");
      expect(typeof result.summary.video).toBe("number");

      expect(Array.isArray(result.skippedSensitive)).toBe(true);
      expect(Array.isArray(result.subdirBreakdown)).toBe(true);
    });
  });

  // ============================================================================
  // totalFiles consistency
  // ============================================================================
  describe("totalFiles consistency", () => {
    it("equals the sum of all summary category counts", () => {
      writeFile("src/a.ts", "code");
      writeFile("src/b.py", "code");
      writeFile("docs/c.md", "doc");
      writeFile("docs/d.txt", "doc");
      writeFile("papers/e.pdf", "pdf");
      writeFile("images/f.png", "img");
      writeFile("images/g.jpg", "img");
      writeFile("images/h.svg", "img");
      writeFile("media/i.mp4", "vid");

      const result = detectCorpus(tmpDir);
      const summarySum =
        result.summary.code +
        result.summary.document +
        result.summary.paper +
        result.summary.image +
        result.summary.video;

      expect(result.totalFiles).toBe(summarySum);
      expect(summarySum).toBe(9);
    });
  });

  // ============================================================================
  // File path format
  // ============================================================================
  describe("file path format", () => {
    it("reports paths relative to scanRoot", () => {
      writeFile("src/main.ts", "code");
      writeFile("deeply/nested/readme.md", "doc");

      const result = detectCorpus(tmpDir);

      const codeFile = result.files.code.find((f) => f.endsWith("main.ts"));
      expect(codeFile).toBeDefined();
      expect(codeFile!.includes("..")).toBe(false);
      expect(codeFile!.startsWith(tmpDir)).toBe(false);

      const docFile = result.files.document.find((f) => f.endsWith("readme.md"));
      expect(docFile).toBeDefined();
      expect(docFile).toBe("deeply/nested/readme.md");
    });

    it("uses forward slashes in paths", () => {
      writeFile("a/b/c/file.txt", "content");

      const result = detectCorpus(tmpDir);

      expect(result.files.document[0]).toBe("a/b/c/file.txt");
      expect(result.files.document[0]).not.toContain("\\");
    });
  });
});
