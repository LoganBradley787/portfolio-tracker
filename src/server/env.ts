import { existsSync } from 'node:fs';

/** Loads `.env.local` then `.env` into process.env (earlier files win). */
export function loadEnv(): void {
  for (const f of ['.env.local', '.env']) {
    if (existsSync(f)) {
      try {
        process.loadEnvFile(f);
      } catch (e) {
        console.warn(`Could not read ${f}: ${(e as Error).message}`);
      }
    }
  }
}
