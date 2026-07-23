const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const version =
  process.env.LUCKY_BACKEND_VERSION || require('../package.json').version;
const gitSha =
  process.env.GITHUB_SHA || process.env.LUCKY_BACKEND_GIT_SHA || 'local';
const metadata = { version, gitSha, builtAt: new Date().toISOString() };
const dist = join(__dirname, '..', 'dist');

mkdirSync(dist, { recursive: true });
writeFileSync(
  join(dist, 'release.json'),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
