import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_CHUNKS = 1000;

// ============================================================================
// Token Estimation
// ============================================================================

// CJK character ranges
const CJK_RANGES = [
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
] as const;

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  for (const [start, end] of CJK_RANGES) {
    if (code >= start && code <= end) return true;
  }
  return false;
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  let cjkCount = 0;
  for (const char of trimmed) {
    if (isCJK(char)) cjkCount++;
  }

  const cjkRatio = cjkCount / trimmed.length;

  if (cjkRatio > 0.3) {
    // CJK-dominant: ~1.5 tokens per CJK char, ~0.3 per non-CJK char
    return Math.ceil(cjkCount * 1.5 + (trimmed.length - cjkCount) * 0.3);
  }

  // English-dominant: count words and multiply by ~1.3
  // Remove punctuation for cleaner word count
  const wordText = trimmed.replace(/[^\w\s]/g, ' ');
  const words = wordText.split(/\s+/).filter((w) => w.length > 0).length;

  // For very short texts, estimate by length
  if (words === 0) {
    return Math.max(1, Math.ceil(trimmed.length * 0.3));
  }

  return Math.max(1, Math.ceil(words * 1.3));
}

// ============================================================================
// Section Splitting
// ============================================================================

export function splitBySections(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];

  // Split at heading boundaries while keeping headings as section starts
  const sections: string[] = [];
  // Combine multiple newlines for cleaner splitting
  const normalized = trimmed.replace(/\n{3,}/g, '\n\n');

  // Split on headings (# through ######) that start on a new line
  // Only split on h1 and h2 headings; h3+ are subsections that stay within their parent
  const headingPattern = /^(#{1,2}\s+.+)$/gm;
  const parts: { text: string; isHeading: boolean }[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(normalized)) !== null) {
    // Text before this heading
    if (match.index > lastIndex) {
      const before = normalized.slice(lastIndex, match.index).trim();
      if (before) {
        parts.push({ text: before, isHeading: false });
      }
    }
    parts.push({ text: match[1], isHeading: true });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last heading
  if (lastIndex < normalized.length) {
    const after = normalized.slice(lastIndex).trim();
    if (after) {
      parts.push({ text: after, isHeading: false });
    }
  }

  // If no headings found, return entire content as one section
  if (parts.length === 0) {
    return [trimmed];
  }

  // Group heading + following content into sections
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].isHeading) {
      // Collect the heading and everything until the next heading
      let sectionText = parts[i].text;
      let j = i + 1;
      while (j < parts.length && !parts[j].isHeading) {
        sectionText += '\n\n' + parts[j].text;
        j++;
      }
      sections.push(sectionText.trim());
      i = j - 1; // Move to next heading (or end)
    } else if (i === 0) {
      // Preamble before first heading
      let preamble = parts[i].text;
      sections.push(preamble);
    }
  }

  return sections;
}

// ============================================================================
// Sentence Splitting
// ============================================================================

function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  // Handles: . ! ? (English) and 。！？ (CJK)
  const parts = text.split(/(?<=[.!?。！？])\s+/);
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ============================================================================
// Core Chunking
// ============================================================================

export function chunkText(
  content: string,
  maxTokensPerChunk: number = DEFAULT_MAX_TOKENS,
  maxChunks: number = DEFAULT_MAX_CHUNKS,
): { chunks: { index: number; text: string; tokenCount: number }[]; totalTokens: number } {
  // Split into paragraphs
  const rawParagraphs = content.split(/\n\n+/);
  const paragraphs: string[] = [];

  for (const p of rawParagraphs) {
    const trimmed = p.trim();
    if (trimmed.length === 0) continue;

    // Check if this paragraph exceeds maxTokens on its own
    const paraTokens = estimateTokens(trimmed);
    if (paraTokens > maxTokensPerChunk) {
      // Split large paragraph into sentences and add as sub-paragraphs
      const sentences = splitIntoSentences(trimmed);
      for (const s of sentences) {
        paragraphs.push(s);
      }
    } else {
      paragraphs.push(trimmed);
    }
  }

  const chunks: { index: number; text: string; tokenCount: number }[] = [];
  let currentText = '';
  let currentTokens = 0;
  let totalTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (currentTokens + paraTokens > maxTokensPerChunk && currentText.length > 0) {
      if (chunks.length >= maxChunks) break;
      const tokens = estimateTokens(currentText);
      chunks.push({ index: chunks.length, text: currentText, tokenCount: tokens });
      totalTokens += tokens;
      currentText = para;
      currentTokens = paraTokens;
    } else {
      currentText = currentText ? `${currentText}\n\n${para}` : para;
      currentTokens += paraTokens;
    }
  }

  // Push final chunk
  if (currentText && chunks.length < maxChunks) {
    const tokens = estimateTokens(currentText);
    chunks.push({ index: chunks.length, text: currentText, tokenCount: tokens });
    totalTokens += tokens;
  }

  return { chunks, totalTokens };
}

// ============================================================================
// Overlap Chunking
// ============================================================================

export function chunkTextWithOverlap(
  content: string,
  maxTokensPerChunk: number = DEFAULT_MAX_TOKENS,
  overlap: number = 0,
  maxChunks: number = DEFAULT_MAX_CHUNKS,
): { chunks: { index: number; text: string; tokenCount: number }[]; totalTokens: number } {
  if (overlap <= 0 || maxTokensPerChunk <= overlap) {
    return chunkText(content, maxTokensPerChunk, maxChunks);
  }

  // Create base chunks first
  const baseResult = chunkText(content, maxTokensPerChunk, maxChunks);
  const baseChunks = baseResult.chunks;

  if (baseChunks.length <= 1) return baseResult;

  const overlappedChunks: { index: number; text: string; tokenCount: number }[] = [];

  for (let i = 0; i < baseChunks.length; i++) {
    let text = baseChunks[i].text;

    if (i > 0) {
      // Estimate character overlap from previous chunk based on token ratio
      const prevText = baseChunks[i - 1].text;
      const prevTokens = Math.max(1, baseChunks[i - 1].tokenCount);
      const charsPerToken = prevText.length / prevTokens;
      const overlapChars = Math.min(prevText.length, Math.ceil(overlap * charsPerToken));
      const overlapPrefix = prevText.slice(prevText.length - overlapChars);
      text = overlapPrefix + ' ' + text;
    }

    const tokenCount = estimateTokens(text);
    overlappedChunks.push({ index: i, text, tokenCount });
  }

  const totalTokens = overlappedChunks.reduce((sum, c) => sum + c.tokenCount, 0);
  return { chunks: overlappedChunks, totalTokens };
}

// ============================================================================
// File Chunking
// ============================================================================

export async function chunkFile(
  filePath: string,
  maxTokensPerChunk: number = DEFAULT_MAX_TOKENS,
  maxChunks: number = DEFAULT_MAX_CHUNKS,
): Promise<{ chunks: { index: number; text: string; tokenCount: number }[]; totalTokens: number }> {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File exceeds maximum size of 100MB: ${(stat.size / 1024 / 1024).toFixed(1)}MB`,
    );
  }

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  return chunkText(lines.join('\n'), maxTokensPerChunk, maxChunks);
}
