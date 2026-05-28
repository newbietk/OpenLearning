import { describe, it, expect } from 'vitest';
import { createMarkdownParser } from '../parsers/markdown';

describe('markdown parser', () => {
  const parser = createMarkdownParser();

  it('should parse headings into nodes', async () => {
    const md = '# Introduction\n\nSome content here.\n\n## Getting Started\n\nMore content.';
    const result = await parser.parse({ content: md, filePath: 'doc.md' });
    const headingNodes = result.chunks.flatMap((c) => c.nodes.filter((n) => n.type === 'heading'));
    expect(headingNodes.length).toBeGreaterThanOrEqual(1);
    expect(headingNodes.some((n) => n.label === 'Introduction')).toBe(true);
    expect(headingNodes.some((n) => n.label === 'Getting Started')).toBe(true);
  });

  it('should create parent-child edges for nested headings', async () => {
    const md = '# Top\n\n## Child\n\n### Grandchild\n\n# Another Top';
    const result = await parser.parse({ content: md, filePath: 'doc.md' });
    const edges = result.chunks.flatMap((c) => c.edges);
    const containsEdges = edges.filter((e) => e.relation === 'contains');
    // Top -> Child, Child -> Grandchild, no edge from Top -> Grandchild or Another Top
    expect(containsEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('should parse links into edges', async () => {
    const md = 'See [React docs](https://react.dev) for more.';
    const result = await parser.parse({ content: md });
    const edges = result.chunks.flatMap((c) => c.edges);
    expect(edges.some((e) => e.relation === 'references')).toBe(true);
  });

  it('should extract code blocks as nodes', async () => {
    const md = '```ts\nconst x = 1;\n```';
    const result = await parser.parse({ content: md });
    expect(result.text).toContain('const x = 1');
    const codeNodes = result.chunks.flatMap((c) => c.nodes.filter((n) => n.type === 'code'));
    expect(codeNodes.length).toBeGreaterThanOrEqual(1);
  });
});
