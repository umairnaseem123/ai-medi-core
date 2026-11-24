import { config } from 'dotenv';
import { resolve } from 'path';

// Tests must never touch the dev database
config({ path: resolve(process.cwd(), '.env.test'), override: true });

if (!process.env.DATABASE_URL?.includes('medicore_test')) {
  throw new Error(
    'Refusing to run tests: DATABASE_URL does not point to medicore_test',
  );
}