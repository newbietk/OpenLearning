import type { Parser, ParseInput, ParseResult } from '../types';

export function createTextParser(): Parser {
  return {
    name: 'text',
    supportedTypes: ['text', 'txt'],

    async parse(input: ParseInput): Promise<ParseResult> {
      return {
        text: input.content,
        chunks: [{
          chunkIndex: 0,
          content: input.content,
          nodes: [{ label: input.filePath || 'untitled', type: 'document' }],
          edges: [],
        }],
      };
    },
  };
}
