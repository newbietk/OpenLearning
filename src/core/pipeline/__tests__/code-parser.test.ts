import { describe, it, expect } from 'vitest';
import { createCodeParser, makeId, detectLanguage, extractSymbols } from '../parsers/code';

// ============================================================================
// makeId
// ============================================================================
describe('makeId', () => {
  it('joins parts with underscore', () => {
    expect(makeId('src', 'utils.ts')).toBe('src_utils_ts');
  });

  it('lowercases and normalizes', () => {
    expect(makeId('SRC', 'Utils.TS')).toBe('src_utils_ts');
  });

  it('replaces non-word characters with underscore', () => {
    expect(makeId('path/to/file.ts')).toBe('path_to_file_ts');
  });

  it('collapses multiple underscores', () => {
    expect(makeId('path//to///file.ts')).toBe('path_to_file_ts');
  });

  it('strips leading and trailing underscores', () => {
    // makeId joins with _, collapses multiple __, and strips leading/trailing _
    expect(makeId('__test__')).toBe('test');
    expect(makeId('', '_prefix_', 'suffix_')).toBe('prefix_suffix');
  });

  it('handles empty parts gracefully', () => {
    const result = makeId('');
    expect(typeof result).toBe('string');
  });

  it('NFKC normalizes unicode characters', () => {
    // Full-width letters should normalize to ASCII
    const result = makeId('ＡＢＣ'); // ＡＢＣ -> abc
    expect(result).toBe('abc');
  });
});

// ============================================================================
// detectLanguage
// ============================================================================
describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('file.ts')).toBe('typescript');
    expect(detectLanguage('file.tsx')).toBe('typescript');
    expect(detectLanguage('file.mts')).toBe('typescript');
  });

  it('detects JavaScript', () => {
    expect(detectLanguage('file.js')).toBe('javascript');
    expect(detectLanguage('file.jsx')).toBe('javascript');
    expect(detectLanguage('file.mjs')).toBe('javascript');
  });

  it('detects Python', () => {
    expect(detectLanguage('file.py')).toBe('python');
    expect(detectLanguage('file.pyi')).toBe('python');
  });

  it('detects Go', () => {
    expect(detectLanguage('file.go')).toBe('go');
  });

  it('detects Rust', () => {
    expect(detectLanguage('file.rs')).toBe('rust');
  });

  it('detects Java', () => {
    expect(detectLanguage('file.java')).toBe('java');
  });

  it('returns unknown for unrecognized extensions', () => {
    expect(detectLanguage('file.xyz')).toBe('unknown');
  });

  it('handles upper case extensions', () => {
    expect(detectLanguage('file.TS')).toBe('typescript');
    expect(detectLanguage('file.PY')).toBe('python');
  });

  it('handles no extension', () => {
    expect(detectLanguage('Makefile')).toBe('unknown');
  });

  it('handles filePath without extension', () => {
    expect(detectLanguage('/path/to/Dockerfile')).toBe('unknown');
  });
});

// ============================================================================
// createCodeParser - Parser interface
// ============================================================================
describe('createCodeParser', () => {
  const parser = createCodeParser();

  it('has a name', () => {
    expect(parser.name).toBe('code');
  });

  it('supports many code types', () => {
    expect(parser.supportedTypes).toContain('ts');
    expect(parser.supportedTypes).toContain('py');
    expect(parser.supportedTypes).toContain('go');
    expect(parser.supportedTypes).toContain('java');
  });

  it('returns ParseResult with text and chunks', async () => {
    const result = await parser.parse({ content: 'const x = 1;', filePath: 'test.ts' });
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('chunks');
    expect(result.text).toBe('const x = 1;');
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it('creates a file node as first node', async () => {
    const result = await parser.parse({ content: 'function hello() {}', filePath: 'src/utils.ts' });
    const nodes = result.chunks.flatMap((c) => c.nodes);
    const fileNode = nodes.find((n) => n.type === 'file');
    expect(fileNode).toBeDefined();
    expect(fileNode!.label).toContain('utils.ts');
  });

  it('handles content without filePath', async () => {
    const result = await parser.parse({ content: 'function hello() {}' });
    expect(result.text).toBeDefined();
    expect(result.chunks).toBeDefined();
  });
});

// ============================================================================
// extractSymbols - TypeScript / JavaScript
// ============================================================================
describe('extractSymbols - TypeScript/JavaScript', () => {
  it('extracts function declarations', () => {
    const code = 'function add(a: number, b: number): number {\n  return a + b;\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    const funcNode = nodes.find((n) => n.type === 'function' && n.label === 'add');
    expect(funcNode).toBeDefined();
  });

  it('extracts async function declarations', () => {
    const code = 'async function fetchData(url: string): Promise<Response> {\n  return fetch(url);\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    const funcNode = nodes.find((n) => n.type === 'function' && n.label === 'fetchData');
    expect(funcNode).toBeDefined();
  });

  it('extracts arrow functions (const arrow)', () => {
    const code = 'const multiply = (a: number, b: number) => a * b;';
    const { nodes } = extractSymbols(code, 'typescript');
    const funcNode = nodes.find((n) => n.type === 'function' && n.label === 'multiply');
    expect(funcNode).toBeDefined();
  });

  it('extracts async arrow functions', () => {
    const code = 'const loadUsers = async (id: string) => {\n  return await fetch(id);\n};';
    const { nodes } = extractSymbols(code, 'typescript');
    const funcNode = nodes.find((n) => n.type === 'function' && n.label === 'loadUsers');
    expect(funcNode).toBeDefined();
  });

  it('extracts class declarations', () => {
    const code = 'class Calculator {\n  add(a: number, b: number): number { return a + b; }\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    const classNode = nodes.find((n) => n.type === 'class' && n.label === 'Calculator');
    expect(classNode).toBeDefined();
  });

  it('extracts class with extends (inherits edge)', () => {
    const code = 'class Dog extends Animal {\n  bark(): void {}\n}';
    const { nodes, edges } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Dog')).toBeDefined();
    const inheritsEdge = edges.find(
      (e) => e.relation === 'inherits' && e.source === 'Dog' && e.target === 'Animal'
    );
    expect(inheritsEdge).toBeDefined();
    expect(inheritsEdge!.confidence).toBe('EXTRACTED');
  });

  it('creates stub node for base class not defined in file', () => {
    const code = 'class Cat extends Feline {\n  meow(): void {}\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    const stubNode = nodes.find((n) => n.type === 'stub' && n.label === 'Feline');
    expect(stubNode).toBeDefined();
  });

  it('does NOT create stub node for base class defined in file', () => {
    const code = 'class Animal {}\nclass Dog extends Animal {}';
    const { nodes } = extractSymbols(code, 'typescript');
    const stubNode = nodes.find((n) => n.type === 'stub' && n.label === 'Animal');
    expect(stubNode).toBeUndefined();
  });

  it('extracts interface declarations', () => {
    const code = 'interface User {\n  id: string;\n  name: string;\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'interface' && n.label === 'User')).toBeDefined();
  });

  it('extracts interface with extends', () => {
    const code = 'interface Admin extends User {\n  permissions: string[];\n}';
    const { nodes, edges } = extractSymbols(code, 'typescript');
    const inheritsEdge = edges.find(
      (e) => e.relation === 'inherits' && e.source === 'Admin' && e.target === 'User'
    );
    expect(inheritsEdge).toBeDefined();
  });

  it('extracts type aliases', () => {
    const code = 'type Point = { x: number; y: number };';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'type' && n.label === 'Point')).toBeDefined();
  });

  it('extracts enum declarations', () => {
    const code = 'enum Color { Red, Green, Blue }';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'enum' && n.label === 'Color')).toBeDefined();
  });

  it('extracts named import with destructuring', () => {
    const code = "import { useState, useEffect } from 'react';";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'react')).toBe(true);
  });

  it('extracts default import', () => {
    const code = "import React from 'react';";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'react')).toBe(true);
  });

  it('extracts namespace import', () => {
    const code = "import * as utils from './utils';";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === './utils')).toBe(true);
  });

  it('extracts side-effect import', () => {
    const code = "import 'reflect-metadata';";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'reflect-metadata')).toBe(true);
  });

  it('extracts type-only import', () => {
    const code = "import type { User } from './types';";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === './types')).toBe(true);
  });

  it('extracts dynamic import expressions', () => {
    const code = "const mod = await import('./dynamic');";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === './dynamic')).toBe(true);
  });

  it('extracts require calls', () => {
    const code = "const fs = require('fs');";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'fs')).toBe(true);
  });

  it('extracts export function', () => {
    const code = 'export function hello() {}';
    const { nodes, edges } = extractSymbols(code, 'typescript');
    const funcNode = nodes.find((n) => n.type === 'function' && n.label === 'hello');
    expect(funcNode).toBeDefined();
    // Should still extract the function
    expect(funcNode!.label).toBe('hello');
  });

  it('extracts export default function', () => {
    const code = 'export default function main() {}';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'main')).toBeDefined();
  });

  it('extracts export class', () => {
    const code = 'export class MyService {}';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'MyService')).toBeDefined();
  });

  it('extracts class methods with contains edges from class to method', () => {
    const code = [
      'class Calculator {',
      '  add(a: number, b: number): number {',
      '    return a + b;',
      '  }',
      '  subtract(a: number, b: number): number {',
      '    return a - b;',
      '  }',
      '}',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'add')).toBeDefined();
    expect(nodes.find((n) => n.type === 'function' && n.label === 'subtract')).toBeDefined();
    const containsAdd = edges.find(
      (e) => e.relation === 'contains' && e.source === 'Calculator' && e.target === 'add'
    );
    expect(containsAdd).toBeDefined();
  });

  it('extracts async class methods', () => {
    const code = [
      'class Repository {',
      '  async findById(id: string) {',
      '    return await db.query(id);',
      '  }',
      '}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'findById')).toBeDefined();
  });

  it('extracts decorators on classes', () => {
    const code = '@Component\nexport class AppComponent {}';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'AppComponent')).toBeDefined();
  });

  it('extracts decorators on methods', () => {
    const code = [
      'class ApiService {',
      '  @Get("/users")',
      '  async getUsers() {',
      '    return [];',
      '  }',
      '}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'getUsers')).toBeDefined();
  });

  it('creates file node with contains edges to top-level symbols', () => {
    const code = 'function foo() {}\nclass Bar {}';
    const { nodes, edges } = extractSymbols(code, 'typescript', 'src/app.ts');
    expect(nodes.find((n) => n.type === 'file')).toBeDefined();
    expect(edges.some((e) => e.relation === 'contains' && e.source === 'file_src_app_ts' && e.target === 'foo')).toBe(true);
    expect(edges.some((e) => e.relation === 'contains' && e.source === 'file_src_app_ts' && e.target === 'Bar')).toBe(true);
  });

  it('handles generic arrow functions', () => {
    const code = 'const identity = <T>(value: T): T => value;';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'identity')).toBeDefined();
  });

  it('extracts static method from class with contains edge', () => {
    const code = [
      'class Utils {',
      '  static helpers(): string { return "helper"; }',
      '}',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'helpers')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Utils' && e.target === 'helpers')).toBeDefined();
  });

  it('extracts abstract class', () => {
    const code = 'abstract class BaseRepository {\n  abstract findById(id: string): unknown;\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'BaseRepository')).toBeDefined();
  });

  it('extracts abstract method from abstract class', () => {
    const code = 'abstract class Shape {\n  abstract area(): number;\n}';
    const { nodes, edges } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'area')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Shape' && e.target === 'area')).toBeDefined();
  });

  it('extracts generic class name', () => {
    const code = 'class Repository<T> {\n  private items: T[] = [];\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Repository')).toBeDefined();
  });

  it('extracts getter as method', () => {
    const code = [
      'class User {',
      '  private _name: string = "";',
      '  get name(): string { return this._name; }',
      '}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'name')).toBeDefined();
  });

  it('extracts setter as method', () => {
    const code = [
      'class User {',
      '  private _name: string = "";',
      '  set name(v: string) { this._name = v; }',
      '}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'name')).toBeDefined();
  });

  it('extracts export default class', () => {
    const code = 'export default class AppConfig {\n  debug = true;\n}';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'AppConfig')).toBeDefined();
  });

  it('extracts exported arrow function', () => {
    const code = 'export const getConfig = () => ({ env: "prod" });';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'getConfig')).toBeDefined();
  });

  it('extracts import with inline type keyword', () => {
    const code = "import { type User, Account } from './models';";
    const { edges } = extractSymbols(code, 'typescript');
    expect(edges.some((e) => e.relation === 'imports' && e.target === './models')).toBe(true);
  });

  it('does not create false symbols for re-export statements', () => {
    const code = "export { Foo, type Bar } from './module';";
    const { nodes } = extractSymbols(code, 'typescript');
    // Re-exports should not create function/class nodes
    const userNodes = nodes.filter((n) => n.type !== 'file' && n.type !== 'stub');
    expect(userNodes.length).toBe(0);
  });
});

// ============================================================================
// extractSymbols - Python
// ============================================================================
describe('extractSymbols - Python', () => {
  it('extracts function definitions', () => {
    const code = 'def hello():\n    print("hello")';
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'hello')).toBeDefined();
  });

  it('extracts async function definitions', () => {
    const code = 'async def fetch_data(url):\n    return await aiohttp.get(url)';
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'fetch_data')).toBeDefined();
  });

  it('extracts class definitions', () => {
    const code = 'class MyModel:\n    pass';
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'MyModel')).toBeDefined();
  });

  it('extracts class with inheritance', () => {
    const code = 'class Dog(Animal):\n    pass';
    const { nodes, edges } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Dog')).toBeDefined();
    expect(edges.find((e) => e.relation === 'inherits' && e.source === 'Dog' && e.target === 'Animal')).toBeDefined();
  });

  it('extracts from-import statements', () => {
    const code = 'from os import path, environ';
    const { edges } = extractSymbols(code, 'python');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'os')).toBe(true);
  });

  it('extracts simple import statements', () => {
    const code = 'import json';
    const { edges } = extractSymbols(code, 'python');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'json')).toBe(true);
  });

  it('extracts methods inside classes', () => {
    const code = [
      'class Calculator:',
      '    def add(self, a, b):',
      '        return a + b',
      '    def subtract(self, a, b):',
      '        return a - b',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'add')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Calculator' && e.target === 'add')).toBeDefined();
  });

  it('extracts decorators on functions', () => {
    const code = '@staticmethod\ndef helper():\n    pass';
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'helper')).toBeDefined();
  });

  it('extracts nested class and creates contains edge from outer to inner', () => {
    const code = [
      'class Outer:',
      '    class Inner:',
      '        def deep_method(self):',
      '            pass',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Outer')).toBeDefined();
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Inner')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Outer' && e.target === 'Inner')).toBeDefined();
  });

  it('extracts method decorated with @property', () => {
    const code = [
      'class Circle:',
      '    @property',
      '    def radius(self):',
      '        return self._radius',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'radius')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Circle' && e.target === 'radius')).toBeDefined();
  });

  it('extracts dunder methods like __init__ and __str__', () => {
    const code = [
      'class Person:',
      '    def __init__(self, name):',
      '        self.name = name',
      '    def __str__(self):',
      '        return self.name',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === '__init__')).toBeDefined();
    expect(nodes.find((n) => n.type === 'function' && n.label === '__str__')).toBeDefined();
  });

  it('extracts function with decorator that takes arguments', () => {
    const code = '@app.route("/users")\ndef get_users():\n    return []';
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'get_users')).toBeDefined();
  });

  it('extracts function with type annotations', () => {
    const code = [
      'class Service:',
      '    def process(self, data: list[int]) -> dict[str, int]:',
      '        return {}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'process')).toBeDefined();
  });

  it('extracts class with multiple inheritance', () => {
    const code = 'class Child(Father, Mother):\n    pass';
    const { nodes } = extractSymbols(code, 'python');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Child')).toBeDefined();
  });

  it('does not extract typed class variable as function', () => {
    const code = 'class Config:\n    timeout: int = 30\n    name: str = "app"';
    const { nodes } = extractSymbols(code, 'python');
    // Should only have class node and file node, no function nodes from class variables
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(0);
  });

  it('does not extract lambda as named function', () => {
    const code = 'sort_key = lambda x: x.age';
    const { nodes } = extractSymbols(code, 'python');
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(0);
  });
});

// ============================================================================
// extractSymbols - Go
// ============================================================================
describe('extractSymbols - Go', () => {
  it('extracts function definitions', () => {
    const code = 'func main() {\n\tfmt.Println("hello")\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'main')).toBeDefined();
  });

  it('extracts functions with receiver', () => {
    const code = 'func (u *User) Greet() string {\n\treturn "hello"\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'Greet')).toBeDefined();
  });

  it('extracts type struct definitions', () => {
    const code = 'type User struct {\n\tName string\n\tAge  int\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'User')).toBeDefined();
  });

  it('extracts type interface definitions', () => {
    const code = 'type Reader interface {\n\tRead(p []byte) (n int, err error)\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'interface' && n.label === 'Reader')).toBeDefined();
  });

  it('extracts imports from import block', () => {
    const code = 'import (\n\t"fmt"\n\t"os"\n)';
    const { edges } = extractSymbols(code, 'go');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'fmt')).toBe(true);
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'os')).toBe(true);
  });

  it('extracts single-line import', () => {
    const code = 'import "fmt"';
    const { edges } = extractSymbols(code, 'go');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'fmt')).toBe(true);
  });

  it('extracts pointer receiver method', () => {
    const code = 'func (p *Point) Scale(factor float64) {\n\tp.x *= factor\n\tp.y *= factor\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'Scale')).toBeDefined();
  });

  it('extracts function with multiple return values', () => {
    const code = 'func divide(a, b float64) (float64, error) {\n\tif b == 0 {\n\t\treturn 0, errors.New("division by zero")\n\t}\n\treturn a / b, nil\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'divide')).toBeDefined();
  });

  it('extracts embedded interface', () => {
    const code = 'type ReadWriter interface {\n\tReader\n\tWriter\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'interface' && n.label === 'ReadWriter')).toBeDefined();
  });

  it('extracts struct with embedded type', () => {
    const code = 'type ColoredBox struct {\n\tBox\n\tColor string\n}';
    const { nodes } = extractSymbols(code, 'go');
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'ColoredBox')).toBeDefined();
  });

  it('does not extract const keyword as function', () => {
    const code = 'const MaxLimit = 100';
    const { nodes } = extractSymbols(code, 'go');
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(0);
  });

  it('does not extract var declaration as function', () => {
    const code = 'var globalCounter int';
    const { nodes } = extractSymbols(code, 'go');
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(0);
  });

  it('does not extract goroutine call as function definition', () => {
    const code = 'func main() {\n\tgo worker()\n}';
    const { nodes } = extractSymbols(code, 'go');
    // Only 'main' should be extracted; 'go' and 'worker' (as call, not definition) should not appear
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(1);
    expect(funcNodes[0].label).toBe('main');
    // 'go' is keyword; 'worker' is a call in a goroutine, not a definition
    expect(nodes.find((n) => n.type === 'function' && n.label === 'worker')).toBeUndefined();
  });
});

// ============================================================================
// extractSymbols - Rust
// ============================================================================
describe('extractSymbols - Rust', () => {
  it('extracts function definitions', () => {
    const code = 'fn main() {\n    println!("hello");\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'main')).toBeDefined();
  });

  it('extracts struct definitions', () => {
    const code = 'pub struct Point {\n    x: f64,\n    y: f64,\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'Point')).toBeDefined();
  });

  it('extracts enum definitions', () => {
    const code = 'pub enum Color {\n    Red,\n    Green,\n    Blue,\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'enum' && n.label === 'Color')).toBeDefined();
  });

  it('extracts trait definitions', () => {
    const code = 'pub trait Display {\n    fn fmt(&self) -> String;\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'trait' && n.label === 'Display')).toBeDefined();
  });

  it('extracts impl blocks', () => {
    const code = 'impl Point {\n    fn new(x: f64, y: f64) -> Self {\n        Point { x, y }\n    }\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'impl' && n.label === 'Point')).toBeDefined();
  });

  it('extracts use statements', () => {
    const code = 'use std::collections::HashMap;';
    const { edges } = extractSymbols(code, 'rust');
    expect(edges.some((e) => e.relation === 'imports')).toBe(true);
  });

  it('extracts pub functions', () => {
    const code = 'pub fn calculate(x: i32) -> i32 {\n    x * 2\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'calculate')).toBeDefined();
  });

  it('extracts generic struct', () => {
    const code = 'pub struct Container<T> {\n    value: T,\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'Container')).toBeDefined();
  });

  it('extracts function with lifetime annotations', () => {
    const code = "fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {\n    if x.len() > y.len() { x } else { y }\n}";
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'longest')).toBeDefined();
  });

  it('extracts module declaration as import edge', () => {
    const code = 'mod graph;\nmod utils;';
    const { edges } = extractSymbols(code, 'rust');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'graph')).toBe(true);
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'utils')).toBe(true);
  });

  it('does not extract match keyword as function', () => {
    const code = 'fn check(v: i32) {\n    match v {\n        1 => println!("one"),\n        _ => println!("other"),\n    }\n}';
    const { nodes } = extractSymbols(code, 'rust');
    // Only 'check' should be a function; 'match' is a keyword
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(1);
    expect(funcNodes[0].label).toBe('check');
  });

  it('extracts struct with derive attribute', () => {
    const code = '#[derive(Debug, Clone)]\npub struct Entity {\n    pub id: u64,\n}';
    const { nodes } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'Entity')).toBeDefined();
  });

  it('extracts associated function from impl block', () => {
    const code = 'impl Calculator {\n    fn new() -> Self {\n        Calculator {}\n    }\n    fn add(&self, a: i32, b: i32) -> i32 {\n        a + b\n    }\n}';
    const { nodes, edges } = extractSymbols(code, 'rust');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'new')).toBeDefined();
    expect(nodes.find((n) => n.type === 'function' && n.label === 'add')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Calculator' && e.target === 'new')).toBeDefined();
  });
});

// ============================================================================
// extractSymbols - Java
// ============================================================================
describe('extractSymbols - Java', () => {
  it('extracts class definitions', () => {
    const code = 'public class HelloWorld {\n    public static void main(String[] args) {}\n}';
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'HelloWorld')).toBeDefined();
  });

  it('extracts class with extends', () => {
    const code = 'public class Dog extends Animal {}';
    const { nodes, edges } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Dog')).toBeDefined();
    expect(edges.find((e) => e.relation === 'inherits' && e.target === 'Animal')).toBeDefined();
  });

  it('extracts interface definitions', () => {
    const code = 'public interface Repository<T> {\n    T findById(String id);\n}';
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'interface' && n.label === 'Repository')).toBeDefined();
  });

  it('extracts method definitions with return types', () => {
    const code = 'public class Service {\n    public String getName() {\n        return "test";\n    }\n}';
    const { nodes } = extractSymbols(code, 'java');
    const funcNode = nodes.find((n) => n.type === 'function' && n.label === 'getName');
    expect(funcNode).toBeDefined();
  });

  it('extracts private methods', () => {
    const code = 'public class Helper {\n    private int calculate(int x) {\n        return x * 2;\n    }\n}';
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'calculate')).toBeDefined();
  });

  it('extracts static methods', () => {
    const code = 'public class Factory {\n    public static Factory create() {\n        return new Factory();\n    }\n}';
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'create')).toBeDefined();
  });

  it('extracts import statements', () => {
    const code = 'import java.util.List;\nimport java.util.ArrayList;';
    const { edges } = extractSymbols(code, 'java');
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'java.util.List')).toBe(true);
    expect(edges.some((e) => e.relation === 'imports' && e.target === 'java.util.ArrayList')).toBe(true);
  });

  it('extracts static import', () => {
    const code = 'import static org.junit.Assert.assertEquals;';
    const { edges } = extractSymbols(code, 'java');
    expect(edges.some((e) => e.target === 'org.junit.Assert.assertEquals')).toBe(true);
  });

  it('extracts generic class', () => {
    const code = 'public class Box<T> {\n    private T value;\n}';
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Box')).toBeDefined();
  });

  it('extracts generic method', () => {
    const code = 'public class Utils {\n    public <T> T identity(T value) {\n        return value;\n    }\n}';
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'identity')).toBeDefined();
  });

  it('extracts abstract class', () => {
    const code = 'public abstract class Shape {\n    public abstract double area();\n}';
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Shape')).toBeDefined();
  });

  it('extracts method annotated with Override when annotation is on separate line', () => {
    const code = [
      'public class SubHandler extends Handler {',
      '    @Override',
      '    public void handle() {',
      '        super.handle();',
      '    }',
      '}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'handle')).toBeDefined();
  });

  it('extracts inner class from enclosing class', () => {
    const code = [
      'public class Outer {',
      '    public class Inner {',
      '        public void run() {}',
      '    }',
      '}',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Outer')).toBeDefined();
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Inner')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Outer' && e.target === 'Inner')).toBeDefined();
  });

  it('extracts interface with multiple extends', () => {
    const code = 'public interface A extends B, C {\n    void process();\n}';
    const { nodes, edges } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'interface' && n.label === 'A')).toBeDefined();
    // Should at least detect one extends relationship for inheritance
    expect(edges.some((e) => e.relation === 'inherits' && e.source === 'A')).toBe(true);
  });

  it('extracts constructor as function node', () => {
    const code = [
      'public class Person {',
      '    private String name;',
      '    public Person(String name) {',
      '        this.name = name;',
      '    }',
      '}',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'java');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'Person')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Person' && e.target === 'Person')).toBeDefined();
  });
});

// ============================================================================
// Edge cases
// ============================================================================
describe('extractSymbols - edge cases', () => {
  it('returns empty nodes/edges for non-code content', () => {
    const { nodes, edges } = extractSymbols('Just some plain text with no code.', 'unknown');
    // File node is always created (plus any stub nodes from inherits)
    const nonFileNodes = nodes.filter((n) => n.type !== 'file');
    expect(nonFileNodes.length).toBe(0);
    expect(edges.filter((e) => e.relation !== 'imports' && e.relation !== 'contains').length).toBe(0);
  });

  it('handles empty content', () => {
    const { nodes, edges } = extractSymbols('', 'typescript');
    expect(nodes.filter((n) => n.type === 'file').length).toBe(1);
    const codeNodes = edges.filter((e) => e.relation !== 'contains');
    expect(codeNodes.length).toBe(0);
  });

  it('does not match keywords as function names', () => {
    const code = 'if (x) {}\nwhile (true) {}\nfor (let i = 0; i < 10; i++) {}\nswitch (v) {}';
    const { nodes } = extractSymbols(code, 'typescript');
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(0);
  });

  it('handles multi-line function signatures', () => {
    const code = [
      'function veryLongFunctionName(',
      '  param1: string,',
      '  param2: number,',
      '  param3: boolean',
      '): Result {',
      '  return {};',
      '}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'veryLongFunctionName')).toBeDefined();
  });

  it('handles nested classes', () => {
    const code = [
      'class Outer {',
      '  innerMethod() {}',
      '  class Inner {',
      '    deepMethod() {}',
      '  }',
      '}',
    ].join('\n');
    const { nodes, edges } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Outer')).toBeDefined();
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Inner')).toBeDefined();
    expect(nodes.find((n) => n.type === 'function' && n.label === 'innerMethod')).toBeDefined();
    expect(nodes.find((n) => n.type === 'function' && n.label === 'deepMethod')).toBeDefined();
    // Outer contains Inner and innerMethod; Inner contains deepMethod
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Outer' && e.target === 'Inner')).toBeDefined();
    expect(edges.find((e) => e.relation === 'contains' && e.source === 'Inner' && e.target === 'deepMethod')).toBeDefined();
  });

  it('handles let and var arrow functions', () => {
    const code = 'let fn1 = () => {};\nvar fn2 = () => {};';
    const { nodes } = extractSymbols(code, 'typescript');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'fn1')).toBeDefined();
    expect(nodes.find((n) => n.type === 'function' && n.label === 'fn2')).toBeDefined();
  });

  it('handles C code', () => {
    const code = [
      '#include <stdio.h>',
      'int add(int a, int b) {',
      '    return a + b;',
      '}',
      'struct Point {',
      '    int x;',
      '    int y;',
      '};',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'c');
    expect(nodes.find((n) => n.type === 'function' && n.label === 'add')).toBeDefined();
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'Point')).toBeDefined();
  });

  it('handles C++ code with classes', () => {
    const code = [
      '#include <iostream>',
      'class Rectangle : public Shape {',
      'public:',
      '    int area() { return width * height; }',
      'private:',
      '    int width, height;',
      '};',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'cpp');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Rectangle')).toBeDefined();
  });

  it('extracts C struct with fields', () => {
    const code = 'struct Point {\n    int x;\n    int y;\n};';
    const { nodes } = extractSymbols(code, 'c');
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'Point')).toBeDefined();
  });

  it('does not extract function pointer declaration as function definition', () => {
    const code = 'void (*callback)(int);';
    const { nodes } = extractSymbols(code, 'c');
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(0);
  });

  it('extracts typedef struct alias', () => {
    const code = 'typedef struct {\n    int x;\n    int y;\n} Point;';
    const { nodes } = extractSymbols(code, 'c');
    expect(nodes.find((n) => n.type === 'struct' && n.label === 'Point')).toBeDefined();
  });

  it('does not extract preprocessor define as function', () => {
    const code = '#define MAX_SIZE 1024\n#define MIN_SIZE 64';
    const { nodes } = extractSymbols(code, 'c');
    const funcNodes = nodes.filter((n) => n.type === 'function');
    expect(funcNodes.length).toBe(0);
  });

  it('does not extract include guards as symbols', () => {
    const code = '#ifndef HEADER_H\n#define HEADER_H\n#endif';
    const { nodes } = extractSymbols(code, 'c');
    const userNodes = nodes.filter((n) => n.type !== 'file');
    expect(userNodes.length).toBe(0);
  });

  it('does not extract extern function declaration as definition', () => {
    const code = 'extern void foo(int x);';
    const { nodes } = extractSymbols(code, 'c');
    const funcNodes = nodes.filter((n) => n.type === 'function');
    // extern declarations ending with ; should not be extracted as function definitions
    expect(funcNodes.length).toBe(0);
  });

  it('extracts class inside C++ namespace', () => {
    const code = [
      'namespace app {',
      '  class Controller {',
      '  public:',
      '    void init() {}',
      '  };',
      '}',
    ].join('\n');
    const { nodes } = extractSymbols(code, 'cpp');
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Controller')).toBeDefined();
  });

  it('creates contains edges from file to top-level nodes via parser', async () => {
    const parser = createCodeParser();
    const code = 'function top() {}\nconst arrow = () => {};';
    const result = await parser.parse({ content: code, filePath: 'lib/test.ts' });
    const allEdges = result.chunks.flatMap((c) => c.edges);
    // Should have contains edges from file node to function nodes
    const containsEdges = allEdges.filter((e) => e.relation === 'contains');
    expect(containsEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('includes filePath in file node metadata', async () => {
    const parser = createCodeParser();
    const result = await parser.parse({ content: 'const x = 1;', filePath: '/app/src/index.ts' });
    const fileNode = result.chunks.flatMap((c) => c.nodes).find((n) => n.type === 'file');
    expect(fileNode).toBeDefined();
    expect(fileNode!.metadata).toHaveProperty('filePath');
    expect(fileNode!.metadata!.filePath).toBe('/app/src/index.ts');
  });
});
