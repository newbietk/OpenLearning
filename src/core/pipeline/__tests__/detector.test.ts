import { describe, it, expect } from 'vitest';
import { detectType } from '../detector';

describe('detector', () => {
  it('should detect .txt files', () => {
    expect(detectType({ fileName: 'notes.txt' })).toBe('text');
  });

  it('should detect .md files', () => {
    expect(detectType({ fileName: 'readme.md' })).toBe('markdown');
    expect(detectType({ fileName: 'docs.markdown' })).toBe('markdown');
  });

  it('should detect code files', () => {
    expect(detectType({ fileName: 'app.ts' })).toBe('code');
    expect(detectType({ fileName: 'index.tsx' })).toBe('code');
    expect(detectType({ fileName: 'main.py' })).toBe('code');
    expect(detectType({ fileName: 'server.go' })).toBe('code');
  });

  it('should detect URLs', () => {
    expect(detectType({ url: 'https://example.com/doc' })).toBe('link');
  });

  it('should default to text', () => {
    expect(detectType({})).toBe('text');
  });
});
