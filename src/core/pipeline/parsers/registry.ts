import type { Parser } from '../types';

export interface ParserRegistry {
  register(parser: Parser): void;
  get(type: string): Parser | undefined;
  list(): Parser[];
}

export function createParserRegistry(): ParserRegistry {
  const parsers = new Map<string, Parser>();

  return {
    register(parser) {
      for (const type of parser.supportedTypes) {
        parsers.set(type, parser);
      }
    },
    get(type) {
      return parsers.get(type);
    },
    list() {
      return Array.from(new Set(parsers.values()));
    },
  };
}
