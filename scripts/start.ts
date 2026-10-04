// `npm start`: build the client if it has not been built, then run the server.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (!existsSync('dist/client/index.html')) {
  console.log('Building client…');
  execSync('npx vite build', { stdio: 'inherit' });
}

await import('../src/server/main.ts');
