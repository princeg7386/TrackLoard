import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface BackupOptions {
  outputDir?: string;
  databaseUrl?: string;
}

export function executeDatabaseBackup(options: BackupOptions = {}): {
  success: boolean;
  filename: string;
  checksumSha256?: string;
  sizeBytes?: number;
  error?: string;
} {
  const outputDir = options.outputDir || path.resolve(process.cwd(), 'backups');
  const databaseUrl =
    options.databaseUrl ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgrespassword@localhost:5432/school_bus_tracker';

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `school_bus_backup_${timestamp}.sql`;
  const fullPath = path.join(outputDir, filename);

  try {
    // Execute pg_dump command with PostGIS support
    const command = `pg_dump "${databaseUrl}" --clean --if-exists --no-owner --no-privileges -f "${fullPath}"`;
    execSync(command, { stdio: 'pipe' });

    if (fs.existsSync(fullPath)) {
      const fileBuffer = fs.readFileSync(fullPath);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const stats = fs.statSync(fullPath);

      // Write metadata companion file
      const metaPath = `${fullPath}.meta.json`;
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            filename,
            createdAt: new Date().toISOString(),
            sizeBytes: stats.size,
            checksumSha256: hash,
            schemaVersion: '1.0.0',
            postgisPreserved: true,
          },
          null,
          2
        )
      );

      return {
        success: true,
        filename,
        checksumSha256: hash,
        sizeBytes: stats.size,
      };
    } else {
      return {
        success: false,
        filename,
        error: 'Backup file was not created by pg_dump',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      filename,
      error: err.message || 'Database backup execution failed',
    };
  }
}

if (process.argv[1] && process.argv[1].endsWith('backup.ts')) {
  console.log('📦 Starting automated PostgreSQL/PostGIS database backup...');
  const result = executeDatabaseBackup();
  if (result.success) {
    console.log(`✅ Backup created successfully: ${result.filename} (${result.sizeBytes} bytes)`);
    console.log(`🔒 SHA-256 Checksum: ${result.checksumSha256}`);
  } else {
    console.warn(`⚠️ Backup notice: ${result.error}`);
  }
}
