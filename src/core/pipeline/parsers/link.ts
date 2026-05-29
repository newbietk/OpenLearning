import type { Parser, ParseInput, ParseResult, ParsedChunk } from '../types';

// ============================================================================
// URL Classification
// ============================================================================

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff',
]);

function extractExtension(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

function extractHostname(url: string): string {
  const match = url.match(/^(?:https?:\/\/)?([^/:?#]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, '') : '';
}

export function classifyUrl(url: string): string {
  if (!url) return 'webpage';

  const ext = extractExtension(url);

  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';

  const hostname = extractHostname(url);

  if (hostname === 'twitter.com' || hostname === 'x.com') return 'twitter';
  if (hostname === 'youtube.com' || hostname === 'youtu.be') return 'youtube';
  if (hostname === 'github.com') return 'github';
  if (hostname === 'arxiv.org') return 'arxiv';

  return 'webpage';
}

// ============================================================================
// Webpage Metadata Extraction
// ============================================================================

interface HeadingInfo {
  level: number;
  text: string;
}

interface LinkInfo {
  href: string;
  text: string;
}

export interface WebpageMetadata {
  title: string;
  description: string;
  headings: HeadingInfo[];
  links: LinkInfo[];
  text: string;
}

export function extractWebpageMetadata(html: string, _url: string): WebpageMetadata {
  // Strip script and style tags first
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Extract title
  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, '').trim()
    : '';

  // Extract meta description
  const descMatch =
    cleaned.match(
      /<meta\s[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i,
    ) ??
    cleaned.match(
      /<meta\s[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i,
    );
  const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Extract headings
  const headings: HeadingInfo[] = [];
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRegex.exec(cleaned)) !== null) {
    const text = hm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      headings.push({ level: parseInt(hm[1], 10), text });
    }
  }

  // Extract links
  const links: LinkInfo[] = [];
  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRegex.exec(cleaned)) !== null) {
    const href = lm[1].trim();
    const linkText = lm[2].replace(/<[^>]+>/g, '').trim();
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      links.push({ href, text: linkText });
    }
  }

  // Extract plain text
  const text = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#?\w+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500000);

  return { title, description, headings, links, text };
}

// ============================================================================
// GitHub URL Conversion
// ============================================================================

function convertToRawGithubUrl(githubUrl: string): string | null {
  // github.com/user/repo/blob/branch/path → raw.githubusercontent.com/user/repo/branch/path
  const match = githubUrl.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
  );
  if (!match) return null;
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
}

// ============================================================================
// arXiv Extraction
// ============================================================================

interface ArxivMetadata {
  title: string;
  abstract: string;
  authors: string[];
}

function extractArxivMetadata(html: string): ArxivMetadata {
  // Extract title from <h1 class="title mathjax">
  const titleMatch = html.match(
    /<h1[^>]*class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : '';

  // Extract abstract from <blockquote class="abstract mathjax">
  const abstractMatch = html.match(
    /<blockquote[^>]*class\s*=\s*["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/i,
  );
  const abstract = abstractMatch
    ? abstractMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : '';

  // Extract authors from <div class="authors">
  const authors: string[] = [];
  const authorsMatch = html.match(
    /<div[^>]*class\s*=\s*["'][^"']*authors[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  if (authorsMatch) {
    const authorText = authorsMatch[1].replace(/<[^>]+>/g, '').replace(/Authors?:/i, '').trim();
    // Split by comma, "and", or newline
    const authorParts = authorText.split(/,(?:\s+and\s+)?|\s+and\s+/i);
    for (const part of authorParts) {
      const name = part.trim();
      if (name.length > 0 && name.length < 200) {
        authors.push(name);
      }
    }
  }

  return { title, abstract, authors };
}

// ============================================================================
// Frontmatter Detection
// ============================================================================

interface FrontmatterData {
  properties: Record<string, string>;
}

function detectFrontmatter(text: string): FrontmatterData | null {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return null;

  const properties: Record<string, string> = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const kvMatch = line.match(/^\s*([a-zA-Z_-][a-zA-Z0-9_-]*)\s*:\s*(.+)\s*$/);
    if (kvMatch) {
      properties[kvMatch[1]] = kvMatch[2].trim();
    }
  }

  return { properties };
}

// ============================================================================
// Fetch with Retry
// ============================================================================

async function fetchWithRetry(
  url: string,
  retries = 3,
  timeoutMs = 15000,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === retries - 1) throw lastError;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  throw lastError ?? new Error('Unreachable');
}

// ============================================================================
// Parse Helpers
// ============================================================================

function buildReferenceNode(
  url: string,
  contentType: string,
  label?: string,
): ParsedChunk {
  const urlPath = url.split('/').pop() || url;
  return {
    chunkIndex: 0,
    content: '',
    nodes: [
      {
        label: label || urlPath,
        type: 'reference',
        metadata: {
          url,
          contentType,
          capturedAt: new Date().toISOString(),
        },
      },
    ],
    edges: [],
  };
}

function buildWebpageChunk(
  metadata: WebpageMetadata,
  url: string,
): ParsedChunk {
  const nodes: ParsedChunk['nodes'] = [];

  if (metadata.title) {
    nodes.push({
      label: metadata.title,
      type: 'title',
      metadata: { url, capturedAt: new Date().toISOString() },
    });
  }

  for (const heading of metadata.headings) {
    nodes.push({
      label: heading.text,
      type: 'heading',
      metadata: { level: heading.level, url, capturedAt: new Date().toISOString() },
    });
  }

  const edges: ParsedChunk['edges'] = metadata.links.map((link) => ({
    source: url,
    target: link.href,
    relation: 'references',
    confidence: 'EXTRACTED' as const,
  }));

  return {
    chunkIndex: 0,
    content: metadata.text,
    nodes,
    edges,
  };
}

function buildArxivChunk(
  metadata: ArxivMetadata,
  url: string,
): ParsedChunk {
  const nodes: ParsedChunk['nodes'] = [];
  const capturedAt = new Date().toISOString();

  if (metadata.title) {
    nodes.push({
      label: metadata.title,
      type: 'paper_title',
      metadata: { url, capturedAt },
    });
  }

  if (metadata.abstract) {
    nodes.push({
      label: metadata.abstract,
      type: 'abstract',
      metadata: { url, capturedAt },
    });
  }

  for (const author of metadata.authors) {
    nodes.push({
      label: author,
      type: 'author',
      metadata: { url, capturedAt },
    });
  }

  const fullText = [metadata.title, metadata.abstract]
    .filter(Boolean)
    .join('\n\n');

  return {
    chunkIndex: 0,
    content: fullText,
    nodes,
    edges: [],
  };
}

// ============================================================================
// Main Parser Factory
// ============================================================================

export function createLinkParser(): Parser {
  return {
    name: 'link',
    supportedTypes: ['link', 'url'],

    async parse(input: ParseInput): Promise<ParseResult> {
      const url = input.sourceUrl;
      if (!url) throw new Error('sourceUrl is required for link parser');

      const urlType = classifyUrl(url);

      switch (urlType) {
        case 'webpage': {
          const response = await fetchWithRetry(url);
          const html = await response.text();
          const metadata = extractWebpageMetadata(html, url);
          const chunk = buildWebpageChunk(metadata, url);

          // Check for frontmatter in extracted text
          const fmData = detectFrontmatter(metadata.text);
          if (fmData && Object.keys(fmData.properties).length > 0) {
            chunk.nodes.push({
              label: JSON.stringify(fmData.properties),
              type: 'frontmatter',
              metadata: { url, capturedAt: new Date().toISOString() },
            });
          }

          return { text: metadata.text, chunks: [chunk] };
        }

        case 'github': {
          const rawUrl = convertToRawGithubUrl(url);

          if (rawUrl) {
            try {
              const response = await fetchWithRetry(rawUrl);
              const content = await response.text();
              const chunk: ParsedChunk = {
                chunkIndex: 0,
                content,
                nodes: [
                  {
                    label: rawUrl.split('/').pop() || content.slice(0, 100),
                    type: 'code',
                    metadata: {
                      url: rawUrl,
                      sourceUrl: url,
                      capturedAt: new Date().toISOString(),
                    },
                  },
                ],
                edges: [{ source: url, target: rawUrl, relation: 'references', confidence: 'EXTRACTED' as const }],
              };
              return { text: content, chunks: [chunk] };
            } catch {
              // Fall through to webpage parsing
            }
          }

          // Fallback: parse as webpage
          const response = await fetchWithRetry(url);
          const html = await response.text();
          const metadata = extractWebpageMetadata(html, url);
          const chunk = buildWebpageChunk(metadata, url);
          return { text: metadata.text, chunks: [chunk] };
        }

        case 'arxiv': {
          const response = await fetchWithRetry(url);
          const html = await response.text();
          const arxivMeta = extractArxivMetadata(html);
          const chunk = buildArxivChunk(arxivMeta, url);
          return { text: chunk.content, chunks: [chunk] };
        }

        case 'twitter':
          return {
            text: '',
            chunks: [buildReferenceNode(url, 'twitter')],
          };

        case 'youtube':
          return {
            text: '',
            chunks: [buildReferenceNode(url, 'youtube')],
          };

        case 'pdf':
          return {
            text: '',
            chunks: [buildReferenceNode(url, 'pdf')],
          };

        case 'image':
          return {
            text: '',
            chunks: [buildReferenceNode(url, 'image')],
          };

        default:
          throw new Error(`Unknown URL type: ${urlType}`);
      }
    },
  };
}
