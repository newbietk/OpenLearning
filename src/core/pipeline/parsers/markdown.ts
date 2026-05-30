import type { Parser, ParseInput, ParseResult, ParsedChunk } from '../types';

export function createMarkdownParser(): Parser {
  return {
    name: 'markdown',
    supportedTypes: ['markdown', 'md', 'mdx'],

    async parse(input: ParseInput): Promise<ParseResult> {
      const lines = input.content.split('\n');
      const nodes: ParsedChunk['nodes'] = [];
      const edges: ParsedChunk['edges'] = [];
      const headingStack: { label: string; level: number }[] = [];
      let textContent = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Headings with nesting hierarchy (heading-stack algorithm from graphify)
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const title = headingMatch[2].trim();
          nodes.push({ label: title, type: 'heading', metadata: { level } });

          // Pop stack until we find a parent heading (lower level number = higher in hierarchy)
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop();
          }

          // Create contains edge from parent heading (if any)
          if (headingStack.length > 0) {
            const parent = headingStack[headingStack.length - 1];
            edges.push({
              source: parent.label,
              target: title,
              relation: 'contains',
              confidence: 'EXTRACTED',
            });
          }

          headingStack.push({ label: title, level });
          textContent += `${title}\n`;
          continue;
        }

        // Links: [text](url)
        const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
        for (const m of linkMatches) {
          edges.push({
            source: input.filePath || 'document',
            target: m[2],
            relation: 'references',
            confidence: 'EXTRACTED',
          });
        }

        // Code blocks (fenced)
        const codeMatch = line.match(/^```(\w*)/);
        if (codeMatch) {
          const lang = codeMatch[1] || 'text';
          const codeLines: string[] = [];
          i++;
          while (i < lines.length && !lines[i].startsWith('```')) {
            codeLines.push(lines[i]);
            i++;
          }
          const code = codeLines.join('\n');
          const codeLabel = code.split('\n')[0]?.slice(0, 50) || 'code-block';
          nodes.push({ label: codeLabel, type: 'code', metadata: { language: lang } });
          textContent += code + '\n';
          continue;
        }

        textContent += line + '\n';
      }

      return {
        text: textContent.trim(),
        chunks: [{ chunkIndex: 0, content: textContent.trim(), nodes, edges }],
      };
    },
  };
}
