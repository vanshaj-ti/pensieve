import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './src/db/schema.ts';
import { createDashboardServer } from './src/dashboard/server.ts';

const tempDir = mkdtempSync(join('/tmp', 'pensieve-smoke-'));
const dbPath = join(tempDir, 'test.db');
const db = openDb(dbPath);

const now = new Date().toISOString();
const date = '2026-07-20';

const ep1 = db
  .prepare(`INSERT INTO episodes (date, project_dir, session_id, start_line, end_line) VALUES (?,?,?,?,?)`)
  .run(date, '/proj/a', 'sess1', 1, 10).lastInsertRowid;
const ep2 = db
  .prepare(`INSERT INTO episodes (date, project_dir, session_id, start_line, end_line) VALUES (?,?,?,?,?)`)
  .run(date, '/proj/b', 'sess2', 1, 10).lastInsertRowid;

const ins = db.prepare(
  `INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, created_at, effort_class) VALUES (?,?,?,?,?,?,?)`,
);
ins.run(ep1, 'bugfix', 'toil work', 'ref1', 0.5, now, 'toil');
ins.run(ep1, 'bugfix', 'judgment work', 'ref2', 0.5, now, 'judgment');
ins.run(ep2, 'bugfix', 'overhead work', 'ref3', 0.5, now, 'overhead');
ins.run(ep2, 'bugfix', 'toil work 2', 'ref4', 0.5, now, 'toil');

const config = { dbPath, port: 0 };
const app = createDashboardServer(config);
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const res = await fetch(`http://localhost:${port}/api/project-effort-breakdown?date=${date}`);
const json = await res.json();
console.log('status', res.status);
console.log(JSON.stringify(json, null, 2));

server.close();
db.close();
rmSync(tempDir, { recursive: true, force: true });
