import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

/**
 * Every query runs through withTenant(): sets app.tenant_id for RLS,
 * so tenant isolation is enforced by Postgres, not by remembering WHERE clauses.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private pool = new Pool({
    host: process.env.PGHOST ?? 'localhost',
    user: process.env.PGUSER ?? 'rf',
    password: process.env.PGPASSWORD ?? 'rf',
    database: process.env.PGDATABASE ?? 'ratefamily',
    max: 10,
  });

  async withTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      // parameterized set_config — no string interpolation into SQL
      await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
      return await fn(client);
    } finally {
      await client.query("SELECT set_config('app.tenant_id', '', false)");
      client.release();
    }
  }

  /** tenant slug -> id, cached (4 tenants, effectively static) */
  private tenantCache = new Map<string, string>();
  async tenantId(slug: string): Promise<string | null> {
    if (this.tenantCache.has(slug)) return this.tenantCache.get(slug)!;
    const r = await this.pool.query('SELECT id FROM tenant WHERE slug = $1', [slug]);
    if (!r.rows[0]) return null;
    this.tenantCache.set(slug, r.rows[0].id);
    return r.rows[0].id;
  }

  onModuleDestroy() { return this.pool.end(); }
}
