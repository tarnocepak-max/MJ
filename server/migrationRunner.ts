import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool, type PoolConfig } from 'pg';

export const FORWARD_MIGRATIONS = [
  '007_phase16a2_staging_schema_initialization.sql',
  '006_custom_authentication_schema.sql',
  '007_provision_primary_superadmin.sql',
  '008_phase1_custom_auth_session_version_alignment.sql',
  '009_pure_supabase_alignment.sql',
  '010_app_settings_navigation_alignment.sql',
  '011_global_config_versioning.sql',
  '012_wo_lifecycle_overhaul.sql',
  '013_installer_geotag_photo_locations.sql',
  '014_wo_expiry_overdue_management.sql',
  '015_installer_live_gps_tracking.sql',
  '016_password_reset_jobs_and_tokens.sql',
  '017_consolidate_roles_to_super_admin.sql',
  '018_kendala_reports_and_workflow_update.sql',
  '019_email_notification_system.sql',
  '020_enterprise_import_architecture.sql'
] as const;

export interface MigrationRunStatus {
  databaseUrlConfigured: boolean;
  status: 'idle' | 'running' | 'completed' | 'skipped_no_database_url' | 'error';
  totalPlanned: number;
  alreadyAppliedCount: number;
  newlyAppliedCount: number;
  appliedFiles: string[];
  skippedFiles: string[];
  failedFile: string | null;
  lastError: string | null;
  lastRunAt: string | null;
}

let lastMigrationStatus: MigrationRunStatus = {
  databaseUrlConfigured: false,
  status: 'idle',
  totalPlanned: FORWARD_MIGRATIONS.length,
  alreadyAppliedCount: 0,
  newlyAppliedCount: 0,
  appliedFiles: [],
  skippedFiles: [],
  failedFile: null,
  lastError: null,
  lastRunAt: null
};

let activeRunPromise: Promise<MigrationRunStatus> | null = null;

function resolveDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    ''
  ).trim();
}

export function isDatabaseUrlConfigured(): boolean {
  return resolveDatabaseUrl().length > 0;
}

export function getMigrationStatus(): MigrationRunStatus {
  return {
    ...lastMigrationStatus,
    databaseUrlConfigured: isDatabaseUrlConfigured(),
    appliedFiles: [...lastMigrationStatus.appliedFiles],
    skippedFiles: [...lastMigrationStatus.skippedFiles]
  };
}

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Strip any connection strings or embedded credentials
  return raw.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://[REDACTED]');
}

function stripTopLevelTransactionWrapper(sql: string): string {
  const lines = sql.split(/\r?\n/);

  const firstCodeIdx = lines.findIndex(line => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('--');
  });

  if (firstCodeIdx !== -1 && /^BEGIN\s*;?\s*$/i.test(lines[firstCodeIdx].trim())) {
    lines[firstCodeIdx] = '-- [managed transaction BEGIN]';
  }

  let lastCodeIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0 && !trimmed.startsWith('--')) {
      lastCodeIdx = i;
      break;
    }
  }

  if (lastCodeIdx !== -1 && /^COMMIT\s*;?\s*$/i.test(lines[lastCodeIdx].trim())) {
    lines[lastCodeIdx] = '-- [managed transaction COMMIT]';
  }

  return lines.join('\n');
}

function createPgPool(connectionString: string): Pool {
  let useSsl = true;
  try {
    const parsed = new URL(connectionString);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      useSsl = false;
    }
  } catch {
    // Keep SSL enabled by default for remote PostgreSQL
  }

  const config: PoolConfig = {
    connectionString,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    max: 1
  };

  if (useSsl) {
    config.ssl = { rejectUnauthorized: false };
  }

  try {
    return new Pool(config);
  } catch (err) {
    console.warn('[Migrations] Failed to initialize pg Pool — using safe no-op fallback:', sanitizeErrorMessage(err));
    return {
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {}
      }),
      end: async () => {}
    } as unknown as Pool;
  }
}

function describeConnectionConfigHint(connectionString: string, rawErrMsg?: string): string {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname || '';
    const port = parsed.port || '5432';
    const user = decodeURIComponent(parsed.username || '');
    const pass = decodeURIComponent(parsed.password || '');

    if (rawErrMsg && (rawErrMsg.includes('ECONNREFUSED') || rawErrMsg.includes('ENETUNREACH') || rawErrMsg.includes('EHOSTUNREACH')) && host.startsWith('db.') && host.endsWith('.supabase.co')) {
      return `Direct host ${host}:${port} hanya menyediakan IPv6 yang diblokir/tidak tersedia di container ini. Gunakan Session Pooler URI Supabase (IPv4: host *.pooler.supabase.com port 5432 dengan username postgres.<PROJECT_REF>).`;
    }
    if (!pass || /^\[.*\]$/.test(pass) || pass.toUpperCase().includes('YOUR-PASSWORD') || pass.toUpperCase().includes('YOUR_PASSWORD')) {
      return 'Password pada DATABASE_URL masih berupa placeholder atau kosong.';
    }
    if (host.includes('pooler.supabase.com') && !user.includes('.')) {
      return `Host Supavisor (${host}:${port}) memerlukan format username "postgres.<PROJECT_REF>", bukan "postgres" saja.`;
    }
    if (host.startsWith('db.') && host.endsWith('.supabase.co') && user.includes('.')) {
      return `Direct host (${host}:${port}) memerlukan username "postgres" (tanpa suffix project ref).`;
    }
    return `Host=${host}, Port=${port}, UsernameFormat=${user.includes('.') ? 'postgres.<ref>' : (user || 'empty')}. Periksa password database Supabase atau lakukan URL-encode jika password mengandung karakter khusus (@, #, $, %, /).`;
  } catch {
    return 'Format URI DATABASE_URL tidak valid (pastikan karakter khusus pada password sudah di-URL-encode).';
  }
}

export async function runPendingSupabaseMigrations(): Promise<MigrationRunStatus> {
  if (activeRunPromise) {
    return activeRunPromise;
  }

  const run = async (): Promise<MigrationRunStatus> => {
    const databaseUrl = resolveDatabaseUrl();
    if (!databaseUrl) {
      lastMigrationStatus = {
        databaseUrlConfigured: false,
        status: 'skipped_no_database_url',
        totalPlanned: FORWARD_MIGRATIONS.length,
        alreadyAppliedCount: 0,
        newlyAppliedCount: 0,
        appliedFiles: [],
        skippedFiles: [],
        failedFile: null,
        lastError: 'DATABASE_URL / SUPABASE_DB_URL tidak dikonfigurasi pada environment server.',
        lastRunAt: new Date().toISOString()
      };
      return getMigrationStatus();
    }

    lastMigrationStatus = {
      databaseUrlConfigured: true,
      status: 'running',
      totalPlanned: FORWARD_MIGRATIONS.length,
      alreadyAppliedCount: 0,
      newlyAppliedCount: 0,
      appliedFiles: [],
      skippedFiles: [],
      failedFile: null,
      lastError: null,
      lastRunAt: new Date().toISOString()
    };

    const pool = createPgPool(databaseUrl);
    const client = await pool.connect().catch((connErr) => {
      const msg = sanitizeErrorMessage(connErr);
      const hint = describeConnectionConfigHint(databaseUrl, msg);
      lastMigrationStatus = {
        ...lastMigrationStatus,
        status: 'error',
        lastError: `Gagal terhubung ke PostgreSQL: ${msg}. (${hint})`,
        lastRunAt: new Date().toISOString()
      };
      console.error(`[Migrations] Connection failed: ${msg} | ${hint}`);
      return null;
    });

    if (!client) {
      await pool.end().catch(() => {});
      return getMigrationStatus();
    }

    const appliedFiles: string[] = [];
    const skippedFiles: string[] = [];

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.morajaws_schema_migrations (
          filename text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      const existingRes = await client.query(
        'SELECT filename, checksum FROM public.morajaws_schema_migrations'
      );
      const alreadyAppliedSet = new Set(
        (existingRes.rows as Array<{ filename: string; checksum: string }>).map(r => r.filename)
      );

      for (const filename of FORWARD_MIGRATIONS) {
        if (alreadyAppliedSet.has(filename)) {
          skippedFiles.push(filename);
          continue;
        }

        const filePath = path.resolve(process.cwd(), 'migrations', filename);
        if (!fs.existsSync(filePath)) {
          throw new Error(`File migrasi tidak ditemukan: ${filename}`);
        }

        const rawSql = fs.readFileSync(filePath, 'utf8');
        const checksum = crypto.createHash('sha256').update(rawSql).digest('hex');
        const managedSql = stripTopLevelTransactionWrapper(rawSql);

        try {
          await client.query('BEGIN');
          await client.query(managedSql);
          await client.query(
            `INSERT INTO public.morajaws_schema_migrations (filename, checksum)
             VALUES ($1, $2)
             ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum`,
            [filename, checksum]
          );
          await client.query('COMMIT');
          appliedFiles.push(filename);
          console.log(`[Migrations] Applied ${filename}`);
        } catch (fileErr) {
          await client.query('ROLLBACK').catch(() => {});
          const safeMsg = sanitizeErrorMessage(fileErr);
          lastMigrationStatus = {
            databaseUrlConfigured: true,
            status: 'error',
            totalPlanned: FORWARD_MIGRATIONS.length,
            alreadyAppliedCount: skippedFiles.length,
            newlyAppliedCount: appliedFiles.length,
            appliedFiles,
            skippedFiles,
            failedFile: filename,
            lastError: `Error pada ${filename}: ${safeMsg}`,
            lastRunAt: new Date().toISOString()
          };
          console.error(`[Migrations] Failed on ${filename}: ${safeMsg}`);
          return getMigrationStatus();
        }
      }

      // Ensure service_role has privileges on all newly created objects and PostgREST reloads schema cache
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            GRANT USAGE ON SCHEMA public TO service_role;
            GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
            GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
            GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;
          END IF;
        END $$;
      `);
      await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});

      lastMigrationStatus = {
        databaseUrlConfigured: true,
        status: 'completed',
        totalPlanned: FORWARD_MIGRATIONS.length,
        alreadyAppliedCount: skippedFiles.length,
        newlyAppliedCount: appliedFiles.length,
        appliedFiles,
        skippedFiles,
        failedFile: null,
        lastError: null,
        lastRunAt: new Date().toISOString()
      };

      console.log(
        `[Migrations] Completed: ${appliedFiles.length} applied, ${skippedFiles.length} already applied.`
      );
      return getMigrationStatus();
    } catch (err) {
      const safeMsg = sanitizeErrorMessage(err);
      lastMigrationStatus = {
        databaseUrlConfigured: true,
        status: 'error',
        totalPlanned: FORWARD_MIGRATIONS.length,
        alreadyAppliedCount: skippedFiles.length,
        newlyAppliedCount: appliedFiles.length,
        appliedFiles,
        skippedFiles,
        failedFile: null,
        lastError: safeMsg,
        lastRunAt: new Date().toISOString()
      };
      console.error(`[Migrations] Runner error: ${safeMsg}`);
      return getMigrationStatus();
    } finally {
      client.release();
      await pool.end().catch(() => {});
    }
  };

  activeRunPromise = run().finally(() => {
    activeRunPromise = null;
  });

  return activeRunPromise;
}
