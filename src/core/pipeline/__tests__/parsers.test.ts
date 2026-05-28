import { describe, it, expect } from 'vitest';
import { createParserRegistry } from '../parsers/registry';
import { createTextParser } from '../parsers/text';

describe('parsers', () => {
  it('should parse plain text into chunks', async () => {
    const parser = createTextParser();
    const result = await parser.parse({ content: 'Hello world.\n\nThis is paragraph two.' });
    expect(result.text).toContain('Hello world');
    expect(result.text).toContain('paragraph two');
  });

  it('should register and retrieve parsers', () => {
    const registry = createParserRegistry();
    const textParser = createTextParser();
    registry.register(textParser);
    const found = registry.get('text');
    expect(found).toBeDefined();
    expect(found!.name).toBe('text');
  });

  it('should return undefined for unregistered type', () => {
    const registry = createParserRegistry();
    expect(registry.get('pdf')).toBeUndefined();
  });

  it('should list all registered parsers', () => {
    const registry = createParserRegistry();
    registry.register(createTextParser());
    expect(registry.list().length).toBe(1);
  });
});
