import { describe, expect, it } from 'vitest';
import { findProblems, parseSecrets, parseWordList } from '../../scripts/guard.ts';

const check = (path: string, content = '', words: string[] = [], secrets: string[] = []) =>
  findProblems({ files: [{ path, content }], words, secrets });

describe('commit guard', () => {
  it('passes ordinary source files', () => {
    expect(check('src/engine/costBasis.ts', 'export const x = 1;', ['Example'], ['s3cretvalue'])).toEqual([]);
  });

  it('refuses environment files but not the example', () => {
    expect(check('.env')).toHaveLength(1);
    expect(check('client/.env.local')).toHaveLength(1);
    expect(check('.env.example', 'TIINGO_API_KEY=your-key')).toEqual([]);
  });

  it('refuses private folders, databases and spreadsheets', () => {
    expect(check('local-notes/README.md')).toHaveLength(1);
    expect(check('data/portfolio.db')).toHaveLength(1);
    expect(check('tests/fixtures/copy.sqlite')).toHaveLength(1);
    expect(check('Tracker.XLSX')).toHaveLength(1);
  });

  it('finds a private word as a whole word, case-sensitively, with its line', () => {
    expect(check('a.ts', 'one\nheld in Example today', ['Example'])).toEqual([
      'a.ts:2: contains the private word "Example"',
    ]);
    expect(check('a.css', '.zz-2 { margin: 0 } fizzy', ['ZZ'])).toEqual([]);
    expect(check('a.ts', 'const EXAMPLES = 1; Examples', ['Example'])).toEqual([]);
  });

  it('finds a private word in a file name, including after an underscore', () => {
    expect(check('tests/fixtures/meta_ZZZZ.json', '{}', ['ZZZZ'])).toHaveLength(1);
  });

  it('skips the word check for an image but still checks its name and scans it for a secret', () => {
    const png = '\x89PNG IHDR Example';
    expect(check('assets/screenshots/a.png', png, ['Example'])).toEqual([]);
    expect(check('assets/screenshots/a.PNG', png, ['Example'])).toEqual([]);
    expect(check('assets/screenshots/a.png', png + 's3cretvalue123', ['Example'], ['s3cretvalue123'])).toEqual([
      'assets/screenshots/a.png: contains a secret from .env',
    ]);
    expect(check('assets/Example.png', png, ['Example'])).toHaveLength(1);
    expect(check('assets/a.svg', '<text>Example</text>', ['Example'])).toHaveLength(1);
  });

  it('finds a secret anywhere and never prints it', () => {
    const problems = check('a.ts', 'url?token=s3cretvalue123', [], ['s3cretvalue123']);
    expect(problems).toEqual(['a.ts: contains a secret from .env']);
  });

  it('reads the word list, skipping comments and blank lines', () => {
    expect(parseWordList('# accounts\nExample\n\n  Other Name  \n')).toEqual(['Example', 'Other Name']);
  });

  it('reads secrets from .env text, ignoring short values', () => {
    expect(parseSecrets('# note\nKEY=abcdefgh1234\nQUOTED="longer value here"\nPORT=3000\n')).toEqual([
      'abcdefgh1234',
      'longer value here',
    ]);
  });
});
