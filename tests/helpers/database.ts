import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Execute real SQLite statements and real rollback semantics, not mocked query results.
export function testDatabase(migrate = true) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(
    readFileSync(
      new URL('../../drizzle/0000_lyrical_tusk.sql', import.meta.url),
      'utf8',
    ),
  );
  const upgrade = () => {
    for (const file of readdirSync(new URL('../../drizzle/', import.meta.url))
      .filter((file) => file.endsWith('.sql') && !file.startsWith('0000'))
      .sort())
      sqlite.exec(
        readFileSync(new URL('../../drizzle/' + file, import.meta.url), 'utf8'),
      );
  };
  if (migrate) upgrade();
  const prepare = (sql: string, values: unknown[] = []) => {
    const execute = () => {
      const query = sqlite.prepare(sql);
      const args = values as Array<string | number | null>;
      // all() executes writes too, returning [] when there is no RETURNING clause.
      // Avoid columns(), which is unavailable in the project's earliest Node 22 release.
      return { results: query.all(...args), success: true, meta: {} };
    };
    return {
      bind: (...next: unknown[]) => prepare(sql, next),
      execute,
      all: async () => execute(),
      first: async () => execute().results[0] ?? null,
      run: async () => execute(),
    };
  };
  const database = {
    prepare,
    batch: async (statements: Array<ReturnType<typeof prepare>>) => {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((stmt) => stmt.execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return { database, sqlite, upgrade };
}
