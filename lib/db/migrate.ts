import postgres from 'postgres';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error('POSTGRES_URL not set');
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

async function migrate() {
  const migrationsDir = join(__dirname, 'migrations');

  // Discover all .sql migration files and sort them by name
  const migrationFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log('Found migration files:', migrationFiles.join(', '));

  for (const file of migrationFiles) {
    console.log('
Running migration:', file);
    const migrationSQL = readFileSync(join(migrationsDir, file), 'utf-8');

    const statements = migrationSQL
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
      try {
        await sql.unsafe(statements[i]);
        console.log('  Statement ' + (i + 1) + '/' + statements.length + ' succeeded');
      } catch (err: any) {
        if (err.message?.includes('already exists')) {
          console.log('  Statement ' + (i + 1) + '/' + statements.length + ' skipped (already exists)');
        } else {
          console.error('  Statement ' + (i + 1) + '/' + statements.length + ' failed:', err.message);
          throw err;
        }
      }
    }
  }

  console.log('
All migrations complete!');
  await sql.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
