// Copies app/ to dist/ and stamps the build sha (R6) into the meta tag and the footer.
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sha = process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString().trim();
rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
const html = readFileSync('dist/index.html', 'utf8').replaceAll('__BUILD_SHA__', sha);
writeFileSync('dist/index.html', html);
console.log(`dist/ built at ${sha}`);
