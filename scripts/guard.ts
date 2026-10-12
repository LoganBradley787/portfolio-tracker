// The checks behind the commit guard: which files and which text must never be committed.
// Pure, so it can be tested; `commit-guard.ts` feeds it from git.

export interface GuardInput {
  files: { path: string; content: string }[];
  /** Private words, matched whole and case-sensitively: `ZZ` does not match `zz-2`. */
  words: string[];
  /** Secret values, matched anywhere. */
  secrets: string[];
}

const FORBIDDEN_FOLDERS = ['local-notes/', 'data/'];
const FORBIDDEN_EXTENSIONS = ['.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3', '.xlsx', '.xls'];

/** Screenshots and icons: binary, so the private-word check does not apply to their contents. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'];

const fileName = (path: string) => (path.split('/').pop() ?? path).toLowerCase();

function forbiddenPath(path: string): string | null {
  const name = path.split('/').pop() ?? path;
  if ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example') return 'environment file';
  const folder = FORBIDDEN_FOLDERS.find((f) => path.startsWith(f));
  if (folder) return `inside ${folder}`;
  const ext = FORBIDDEN_EXTENSIONS.find((e) => name.toLowerCase().endsWith(e));
  if (ext) return `${ext} file`;
  return null;
}

function wholeWord(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`);
}

/** One line per problem; empty when the files are safe to commit. Secret values are never echoed. */
export function findProblems({ files, words, secrets }: GuardInput): string[] {
  const problems: string[] = [];
  const patterns = words.map((w) => ({ word: w, re: wholeWord(w) }));
  for (const { path, content } of files) {
    const reason = forbiddenPath(path);
    if (reason) {
      problems.push(`${path}: ${reason}`);
      continue;
    }
    for (const { word, re } of patterns) {
      if (re.test(path)) problems.push(`${path}: file name contains the private word "${word}"`);
    }
    if (secrets.some((s) => content.includes(s))) problems.push(`${path}: contains a secret from .env`);
    // An image read as text is noise: a two-letter word turns up in its bytes by chance.
    // Its name and any secret are still checked above; only the word check is skipped.
    if (IMAGE_EXTENSIONS.some((e) => fileName(path).endsWith(e))) continue;
    content.split('\n').forEach((line, i) => {
      for (const { word, re } of patterns) {
        if (re.test(line)) problems.push(`${path}:${i + 1}: contains the private word "${word}"`);
      }
    });
  }
  return problems;
}

/** Words from a list file: one per line; blank lines and `#` comments are ignored. */
export function parseWordList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Values worth guarding from a `.env` file. Short values would match by accident. */
export function parseSecrets(env: string): string[] {
  return env
    .split('\n')
    .map((l) => l.match(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '')
    .filter((v) => v.length >= 8);
}
