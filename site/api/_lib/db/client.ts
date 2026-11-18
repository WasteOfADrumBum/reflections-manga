import pg from "pg";

/**
 * Minimal SQL client interface. Production uses node-postgres against any
 * Postgres (Neon free tier through the Vercel Marketplace is the documented
 * default). Tests use PGlite, a real Postgres engine compiled to WASM.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs fn inside BEGIN/COMMIT; rolls back on throw. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

let pool: pg.Pool | undefined;

export function createPgDb(connectionString: string): Db {
  pool ??= new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: true },
  });
  const p = pool;
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await p.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      const client = await p.connect();
      const inner: Db = {
        async query<R>(sql: string, params: unknown[] = []) {
          const res = await client.query(sql, params as unknown[]);
          return res.rows as R[];
        },
        tx: (f) => f(inner),
      };
      try {
        await client.query("BEGIN");
        const out = await fn(inner);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await p.end();
      pool = undefined;
    },
  };
  return db;
}

export async function one<T>(db: Db, sql: string, params?: unknown[]): Promise<T | undefined> {
  const rows = await db.query<T>(sql, params);
  return rows[0];
}
