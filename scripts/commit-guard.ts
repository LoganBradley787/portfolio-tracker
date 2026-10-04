// Refuses a commit that carries private files, private words or a secret.
// Run by the hooks in `.githooks/`; `npm install` points git at them.
//
//   tsx scripts/commit-guard.ts                  check the staged files
//   tsx scripts/commit-guard.ts --message FILE   check a commit message
//   tsx scripts/commit-guard.ts --all            check every file git would track
//
// Private words come from `local-notes/blocked-words.txt` (git-ignored), secrets from `.env`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { findProblems, parseSecrets, parseWordList } from './guard.ts';

const WORD_LIST = 'local-notes/blocked-words.txt';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function paths(...args: string[]): string[] {
  return git(...args, '-z').split('\0').filter(Boolean);
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

const [mode, messageFile] = process.argv.slice(2);
let files: { path: string; content: string }[];
if (mode === '--message') {
  files = [{ path: 'commit message', content: readFileSync(messageFile, 'utf8') }];
} else if (mode === '--all') {
  files = paths('ls-files', '--cached', '--others', '--exclude-standard')
    .filter((path) => existsSync(path))
    .map((path) => ({ path, content: readFileSync(path, 'utf8') }));
} else {
  files = paths('diff', '--cached', '--name-only', '--diff-filter=ACMR').map((path) => ({
    path,
    content: git('show', `:${path}`),
  }));
}

const problems = findProblems({
  files,
  words: parseWordList(read(WORD_LIST)),
  secrets: [...parseSecrets(read('.env')), ...parseSecrets(read('.env.local'))],
});

if (problems.length > 0) {
  console.error('Commit guard: this must not be committed.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nUnstage or fix these, then commit again. Private words are listed in ${WORD_LIST}.`);
  process.exit(1);
}
