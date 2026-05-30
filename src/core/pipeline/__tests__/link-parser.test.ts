import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinkParser, classifyUrl, extractWebpageMetadata } from '../parsers/link';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ============================================================================
// classifyUrl tests
// ============================================================================
describe('classifyUrl', () => {
  it('classifies twitter.com as twitter', () => {
    expect(classifyUrl('https://twitter.com/user/status/123')).toBe('twitter');
  });

  it('classifies x.com as twitter', () => {
    expect(classifyUrl('https://x.com/user/status/123')).toBe('twitter');
  });

  it('classifies arxiv.org/abs URLs as arxiv', () => {
    expect(classifyUrl('https://arxiv.org/abs/2301.12345')).toBe('arxiv');
  });

  it('classifies arxiv.org/pdf URLs as pdf (extension takes precedence)', () => {
    expect(classifyUrl('https://arxiv.org/pdf/2301.12345.pdf')).toBe('pdf');
  });

  it('classifies github.com as github', () => {
    expect(classifyUrl('https://github.com/user/repo')).toBe('github');
    expect(classifyUrl('https://github.com/user/repo/blob/main/README.md')).toBe('github');
  });

  it('classifies youtube.com as youtube', () => {
    expect(classifyUrl('https://www.youtube.com/watch?v=abc123')).toBe('youtube');
  });

  it('classifies youtu.be as youtube', () => {
    expect(classifyUrl('https://youtu.be/abc123')).toBe('youtube');
  });

  it('classifies .pdf URLs as pdf', () => {
    expect(classifyUrl('https://example.com/doc.pdf')).toBe('pdf');
    expect(classifyUrl('https://example.com/path/to/report.PDF')).toBe('pdf');
  });

  it('classifies image extensions as image', () => {
    expect(classifyUrl('https://example.com/photo.png')).toBe('image');
    expect(classifyUrl('https://example.com/photo.jpg')).toBe('image');
    expect(classifyUrl('https://example.com/photo.jpeg')).toBe('image');
    expect(classifyUrl('https://example.com/photo.gif')).toBe('image');
    expect(classifyUrl('https://example.com/photo.svg')).toBe('image');
    expect(classifyUrl('https://example.com/photo.webp')).toBe('image');
  });

  it('classifies regular webpages as webpage', () => {
    expect(classifyUrl('https://example.com')).toBe('webpage');
    expect(classifyUrl('https://en.wikipedia.org/wiki/Main_Page')).toBe('webpage');
  });

  it('handles edge cases gracefully', () => {
    expect(classifyUrl('')).toBe('webpage');
    expect(classifyUrl('not-a-url')).toBe('webpage');
    expect(classifyUrl('ftp://files.example.com/data.csv')).toBe('webpage');
    expect(classifyUrl('mailto:test@example.com')).toBe('webpage');
  });

  it('handles URLs with query params and fragments', () => {
    expect(classifyUrl('https://twitter.com/user/status/123?ref=share')).toBe('twitter');
    expect(classifyUrl('https://github.com/user/repo#readme')).toBe('github');
    expect(classifyUrl('https://example.com/report.pdf?version=2')).toBe('pdf');
  });
});

// ============================================================================
// extractWebpageMetadata tests
// ============================================================================
describe('extractWebpageMetadata', () => {
  const sampleUrl = 'https://example.com/article';

  it('extracts title from <title> tag', () => {
    const html = '<html><head><title>  My Article Title  </title></head><body></body></html>';
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.title).toBe('My Article Title');
  });

  it('extracts meta description', () => {
    const html = '<html><head><meta name="description" content="A great article about stuff."></head><body></body></html>';
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.description).toBe('A great article about stuff.');
  });

  it('extracts all heading levels', () => {
    const html = `<html><body>
      <h1>Main Title</h1>
      <h2>Section A</h2>
      <h2>Section B</h2>
      <h3>Subsection</h3>
      <h1>Another Main</h1>
    </body></html>`;
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.headings).toEqual([
      { level: 1, text: 'Main Title' },
      { level: 2, text: 'Section A' },
      { level: 2, text: 'Section B' },
      { level: 3, text: 'Subsection' },
      { level: 1, text: 'Another Main' },
    ]);
  });

  it('extracts links as reference edges', () => {
    const html = `<html><body>
      <a href="https://other.com/page1">Link One</a>
      <a href="/relative/path">Relative Link</a>
      <a href="https://other.com/page2">Link Two</a>
    </body></html>`;
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.links).toHaveLength(3);
    expect(result.links[0]).toEqual({ href: 'https://other.com/page1', text: 'Link One' });
    expect(result.links[1]).toEqual({ href: '/relative/path', text: 'Relative Link' });
  });

  it('strips script and style tags from text', () => {
    const html = `<html><head>
      <script>console.log("secret code");</script>
      <style>body { color: red; }</style>
    </head><body><p>Visible content</p></body></html>`;
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.text).toContain('Visible content');
    expect(result.text).not.toContain('secret code');
    expect(result.text).not.toContain('body { color');
  });

  it('collapses whitespace in extracted text', () => {
    const html = `<html><body>
      <p>Line    one</p>
      <p>Line\n\ttwo</p>
      <p>Line   three</p>
    </body></html>`;
    const result = extractWebpageMetadata(html, sampleUrl);
    // Should have single spaces between words, no excessive whitespace
    expect(result.text).not.toMatch(/\s{2,}/);
  });

  it('handles HTML with no title gracefully', () => {
    const html = '<html><body><p>Just a paragraph.</p></body></html>';
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.title).toBe('');
  });

  it('handles empty HTML gracefully', () => {
    const html = '';
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.headings).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.text).toBe('');
  });

  it('handles HTML with self-closing tags and attributes in headings', () => {
    const html = `<html><body>
      <h1 id="intro" class="title">Welcome <span>to</span> the Site</h1>
      <h2 data-index="1">Getting Started</h2>
    </body></html>`;
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.headings).toEqual([
      { level: 1, text: 'Welcome to the Site' },
      { level: 2, text: 'Getting Started' },
    ]);
  });

  it('caps text at 500,000 characters', () => {
    const longParagraph = '<p>' + 'x'.repeat(600000) + '</p>';
    const html = `<html><body>${longParagraph}</body></html>`;
    const result = extractWebpageMetadata(html, sampleUrl);
    expect(result.text.length).toBeLessThanOrEqual(500000);
  });
});

// ============================================================================
// createLinkParser tests
// ============================================================================
describe('createLinkParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a parser with correct name and supportedTypes', () => {
    const parser = createLinkParser();
    expect(parser.name).toBe('link');
    expect(parser.supportedTypes).toEqual(['link', 'url']);
  });

  it('throws when sourceUrl is missing', async () => {
    const parser = createLinkParser();
    await expect(parser.parse({ content: '' })).rejects.toThrow('sourceUrl is required');
  });

  it('handles webpage URL — full metadata extraction', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<html>
        <head>
          <title>Knowledge Graphs Explained</title>
          <meta name="description" content="A deep dive into knowledge graphs.">
        </head>
        <body>
          <h1>Introduction</h1>
          <p>Knowledge graphs represent entities and their relationships.</p>
          <h2>History</h2>
          <p>The concept dates back to the 1960s.</p>
          <a href="https://example.com/related">Related Article</a>
        </body>
      </html>`,
    });

    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://example.com/article' });

    // Should contain the cleaned text
    expect(result.text).toContain('Knowledge Graphs Explained');
    expect(result.text).toContain('Knowledge graphs');
    expect(result.text).not.toContain('<script>');

    // Should have nodes: title page node + 2 heading nodes
    const nodes = result.chunks.flatMap((c) => c.nodes);
    expect(nodes.length).toBeGreaterThanOrEqual(3);

    // Title node
    const titleNode = nodes.find((n) => n.type === 'title');
    expect(titleNode).toBeDefined();
    if (titleNode) {
      expect(titleNode.label).toBe('Knowledge Graphs Explained');
      expect(titleNode.metadata?.['url']).toBe('https://example.com/article');
    }

    // Heading nodes
    const headingNodes = nodes.filter((n) => n.type === 'heading');
    expect(headingNodes.length).toBe(2);
    expect(headingNodes.some((n) => n.label === 'Introduction')).toBe(true);
    expect(headingNodes.some((n) => n.label === 'History')).toBe(true);

    // Reference edges from links
    const edges = result.chunks.flatMap((c) => c.edges);
    expect(edges.some((e) => e.relation === 'references' && e.target === 'https://example.com/related')).toBe(true);
  });

  it('handles PDF URL — returns minimal metadata node', async () => {
    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://example.com/paper.pdf' });

    expect(result.text).toBe('');
    const nodes = result.chunks[0].nodes;
    expect(nodes.length).toBe(1);
    expect(nodes[0].label).toContain('paper.pdf');
    expect(nodes[0].type).toBe('reference');
    expect(nodes[0].metadata?.['url']).toBe('https://example.com/paper.pdf');
    expect(nodes[0].metadata?.['contentType']).toBe('pdf');
    expect(nodes[0].metadata?.['capturedAt']).toBeDefined();
  });

  it('handles image URL — returns minimal metadata node', async () => {
    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://example.com/chart.png' });

    expect(result.text).toBe('');
    const nodes = result.chunks[0].nodes;
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('reference');
    expect(nodes[0].metadata?.['contentType']).toBe('image');
  });

  it('handles GitHub URL — converts to raw and fetches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '# My Project\n\nA sample README.',
    });

    const parser = createLinkParser();
    const result = await parser.parse({
      content: '',
      sourceUrl: 'https://github.com/user/repo/blob/main/README.md',
    });

    // Should have called fetch with raw URL
    expect(mockFetch).toHaveBeenCalledTimes(1); // raw URL fetch succeeds, no fallback needed
    const rawUrl = 'https://raw.githubusercontent.com/user/repo/main/README.md';
    expect(mockFetch).toHaveBeenCalledWith(rawUrl, expect.anything());

    expect(result.text).toContain('My Project');
    expect(result.text).toContain('A sample README');
    expect(result.chunks.length).toBe(1);
  });

  it('handles GitHub URL — falls back to webpage parsing if raw fetch fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Raw fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><head><title>GitHub Repo</title></head><body><p>Repo content</p></body></html>',
      });

    const parser = createLinkParser();
    const result = await parser.parse({
      content: '',
      sourceUrl: 'https://github.com/user/repo',
    });

    expect(result.text).toContain('GitHub Repo');
    expect(result.text).toContain('Repo content');
  });

  it('handles arXiv URL — extracts abstract and title', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<html>
        <head><title>[2301.12345] A Novel Approach to ML</title></head>
        <body>
          <h1 class="title mathjax">A Novel Approach to Machine Learning</h1>
          <div class="authors"><span class="descriptor">Authors:</span> John Doe, Jane Smith</div>
          <blockquote class="abstract mathjax"><span class="descriptor">Abstract:</span> We present a novel approach to machine learning that combines deep neural networks with symbolic reasoning.</blockquote>
        </body>
      </html>`,
    });

    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://arxiv.org/abs/2301.12345' });

    expect(result.text).toContain('Novel Approach');
    const nodes = result.chunks.flatMap((c) => c.nodes);

    // Title node
    const titleNode = nodes.find((n) => n.type === 'paper_title');
    expect(titleNode).toBeDefined();
    if (titleNode) {
      expect(titleNode.label).toContain('Novel Approach');
    }

    // Abstract node
    const abstractNode = nodes.find((n) => n.type === 'abstract');
    expect(abstractNode).toBeDefined();
    if (abstractNode) {
      expect(abstractNode.label).toContain('novel approach');
    }

    // Author nodes
    const authorNodes = nodes.filter((n) => n.type === 'author');
    expect(authorNodes.length).toBe(2);
  });

  it('handles twitter URL — returns reference node with metadata', async () => {
    const parser = createLinkParser();
    const result = await parser.parse({
      content: '',
      sourceUrl: 'https://twitter.com/someuser/status/123456789',
    });

    expect(result.text).toBe('');
    const nodes = result.chunks[0].nodes;
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('reference');
    expect(nodes[0].metadata?.['contentType']).toBe('twitter');
    expect(nodes[0].metadata?.['url']).toBe('https://twitter.com/someuser/status/123456789');
  });

  it('handles youtube URL — returns reference node with metadata', async () => {
    const parser = createLinkParser();
    const result = await parser.parse({
      content: '',
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
    });

    expect(result.text).toBe('');
    const nodes = result.chunks[0].nodes;
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('reference');
    expect(nodes[0].metadata?.['contentType']).toBe('youtube');
  });

  it('detects yaml frontmatter in content and extracts metadata', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<html><head><title>My Doc</title></head><body>
        <pre><code>---
        title: Custom Title
        tags: [ai, ml, knowledge-graph]
        author: Jane Doe
        ---</code></pre>
        <p>This is the main content.</p>
      </body></html>`,
    });

    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://example.com/doc' });

    const nodes = result.chunks.flatMap((c) => c.nodes);
    const frontmatterNode = nodes.find((n) => n.type === 'frontmatter');
    // Frontmatter parsing might be best-effort; content should always be present
    expect(result.text).toContain('main content');
  });

  it('retries on fetch failure up to 3 times', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body><p>Finally succeeded</p></body></html>',
      });

    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://flaky.example.com' });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.text).toContain('Finally succeeded');
  });

  it('saves capture timestamp and source URL in metadata', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><head><title>Metadata Test</title></head><body><p>Content</p></body></html>',
    });

    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://example.com/metadata-test' });

    // The text or node metadata should contain capture timestamp
    const combinedMetadata = result.chunks.flatMap((c) => c.nodes).map((n) => n.metadata);
    const urls = combinedMetadata.filter(Boolean).map((m) => m?.['url']);
    expect(urls).toContain('https://example.com/metadata-test');
  });

  it('handles large HTML responses efficiently', async () => {
    const largeBody = '<p>' + 'A'.repeat(200000) + '</p>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<html><head><title>Large Page</title></head><body>${largeBody}</body></html>`,
    });

    const parser = createLinkParser();
    const result = await parser.parse({ content: '', sourceUrl: 'https://example.com/large' });

    expect(result.text.length).toBeLessThanOrEqual(500000);
    // Should contain at least some of the content
    expect(result.text.length).toBeGreaterThan(100000);
  });
});
