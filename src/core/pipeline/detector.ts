const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'rb', 'php', 'swift', 'kt', 'scala', 'cs', 'sh', 'bash', 'sql',
]);

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'toml']);

export interface DetectInput {
  fileName?: string;
  url?: string;
  contentHint?: string;
}

export function detectType(input: DetectInput): string {
  if (input.url) return 'link';

  if (input.fileName) {
    const ext = input.fileName.split('.').pop()?.toLowerCase();
    if (ext) {
      if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
      if (CODE_EXTENSIONS.has(ext)) return 'code';
      if (TEXT_EXTENSIONS.has(ext)) return 'text';
    }
  }

  return 'text';
}
