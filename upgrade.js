import { execSync } from 'child_process';
import 'dotenv';

const run = (cmd) => {
  console.log(`[Running] ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

const branchNameMap = {
  production: 'prod',
  development: 'dev',
  staging: 'staging',
};

(async () => {
  console.log('Starting upgrade process...');

  const branch = branchNameMap[process.env.ENV];

  if (!branch) {
    throw new Error('Invalid environment');
  }

  // Step 1: Pull latest code
  run(`git pull origin ${branch}`);

  // Step 2: Prisma migrations
  run('npx prisma migrate deploy');
  run('npx prisma generate');

  // Step 3: Dependencies
  run('yarn install');

  // Step 4: Build
  run('yarn build');

  run('yarn start:prod');

  console.log('Upgrade completed.');
})();
