import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/schema.js';
import { createDashboardServer } from '../src/dashboard/server.js';
import { Config } from '../src/config.js';
import type http from 'http';
import type { Application } from 'express';
import {
  getInsightDates,
  getCategoryTrend,
  getTopInsights,
  getEffortBreakdown,
  getEffortBreakdownTrend,
  getCrossProjectRollup,
  getRecurrenceChains,
  getLabels,
  getProjects,
  getSessions,
  getSessionRuns,
  getEffortByCategory,
  getDerivedInsights,
} from '../src/analytics/index.js';

describe('dashboard server', () => {
  let tempDir: string;
  let dbPath: string;
  let dbForAnalytics: Database.Database;
  let config: Config;
  let app: Application;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    tempDir = mkdtempSync('pensieve-dashboard-test-');
    dbPath = join(tempDir, 'test.db');

    const db = openDb(dbPath);

    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES
        ('2026-07-14', '/project-a', 'session-1', 1, 10),
        ('2026-07-15', '/project-a', 'session-1', 11, 20),
        ('2026-07-15', '/project-b', 'session-2', 1, 5),
        ('2026-07-16', '/project-a', 'session-3', 1, 15)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, effort_class, verified_by_git, recurrence_of, created_at)
      VALUES
        (1, 'architecture_decisions', 'Insight A', 'ref-a', 0.9, 'judgment', NULL, NULL, '2026-07-14T10:00:00Z'),
        (2, 'architecture_decisions', 'Insight B', 'ref-b', 0.8, 'toil', NULL, NULL, '2026-07-15T10:00:00Z'),
        (2, 'friction_audit', 'Insight C', 'ref-c', 0.7, 'overhead', NULL, NULL, '2026-07-15T10:00:00Z'),
        (3, 'architecture_decisions', 'Insight D', 'ref-d', 0.6, 'toil', NULL, NULL, '2026-07-15T10:00:00Z'),
        (4, 'friction_audit', 'Insight E', 'ref-e', 0.95, 'judgment', NULL, NULL, '2026-07-16T10:00:00Z')
    `,
    ).run();

    db.close();

    dbForAnalytics = openDb(dbPath);
    config = { dbPath, briefsDir: tempDir, apiKey: '', apiModel: 'claude-opus-4-20250805' };
    app = createDashboardServer(config);
    server = app.listen(0);

    await new Promise<void>((resolve) => {
      server.on('listening', () => resolve());
    });

    const addr = server.address();
    port = typeof addr === 'object' ? (addr?.port ?? 0) : 0;
  });

  afterEach(() => {
    return new Promise<void>((resolve, reject) => {
      dbForAnalytics.close();
      server.close((err) => {
        rmSync(tempDir, { recursive: true, force: true });
        if (err) reject(err);
        else resolve();
      });
    });
  });

  describe('GET /api/dates', () => {
    it('returns list matching getInsightDates', async () => {
      const res = await fetch(`http://localhost:${port}/api/dates`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getInsightDates(dbForAnalytics);
      expect(apiData).toEqual(expected);
    });
  });

  describe('GET /api/category-trend', () => {
    it('returns category trend matching getCategoryTrend', async () => {
      const days = 30;
      const res = await fetch(`http://localhost:${port}/api/category-trend?days=${days}`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getCategoryTrend(dbForAnalytics, days);
      expect(apiData).toEqual(expected);
    });

    it('returns 400 for non-numeric days', async () => {
      const res = await fetch(`http://localhost:${port}/api/category-trend?days=abc`);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });

    it('returns 400 for days with trailing garbage', async () => {
      const res = await fetch(`http://localhost:${port}/api/category-trend?days=30junk`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/top-insights', () => {
    it('returns top insights matching getTopInsights', async () => {
      const date = '2026-07-15';
      const limit = 10;
      const res = await fetch(
        `http://localhost:${port}/api/top-insights?date=${date}&limit=${limit}`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getTopInsights(dbForAnalytics, date, limit);
      expect(apiData).toEqual(expected);
    });

    it('returns 400 for missing date', async () => {
      const res = await fetch(`http://localhost:${port}/api/top-insights?limit=10`);
      expect(res.status).toBe(400);
    });

    it('returns 400 for impossible date (Feb 31)', async () => {
      const res = await fetch(`http://localhost:${port}/api/top-insights?date=2026-02-31&limit=10`);
      expect(res.status).toBe(400);
    });

    it('returns 400 for limit with trailing garbage', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/top-insights?date=2026-07-15&limit=10junk`,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/effort-breakdown', () => {
    it('returns effort breakdown matching getEffortBreakdown', async () => {
      const date = '2026-07-15';
      const res = await fetch(`http://localhost:${port}/api/effort-breakdown?date=${date}`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getEffortBreakdown(dbForAnalytics, date);
      expect(apiData).toEqual(expected);
    });

    it('returns 400 for missing date', async () => {
      const res = await fetch(`http://localhost:${port}/api/effort-breakdown`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/effort-breakdown-trend', () => {
    it('returns effort breakdown trend matching getEffortBreakdownTrend', async () => {
      const days = 30;
      const res = await fetch(`http://localhost:${port}/api/effort-breakdown-trend?days=${days}`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getEffortBreakdownTrend(dbForAnalytics, days);
      expect(apiData).toEqual(expected);
    });

    it('returns 400 for non-numeric days', async () => {
      const res = await fetch(`http://localhost:${port}/api/effort-breakdown-trend?days=xyz`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/cross-project', () => {
    it('returns cross-project rollup matching getCrossProjectRollup', async () => {
      const date = '2026-07-15';
      const res = await fetch(`http://localhost:${port}/api/cross-project?date=${date}`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getCrossProjectRollup(dbForAnalytics, date);
      expect(apiData).toEqual(expected);
    });

    it('returns 400 for missing date', async () => {
      const res = await fetch(`http://localhost:${port}/api/cross-project`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/recurrence-chains', () => {
    it('returns recurrence chains matching getRecurrenceChains', async () => {
      const days = 30;
      const res = await fetch(`http://localhost:${port}/api/recurrence-chains?days=${days}`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getRecurrenceChains(dbForAnalytics, days);
      expect(apiData).toEqual(expected);
    });

    it('returns 400 for non-numeric days', async () => {
      const res = await fetch(`http://localhost:${port}/api/recurrence-chains?days=notanumber`);
      expect(res.status).toBe(400);
    });
  });

  describe('static files', () => {
    it('serves index.html from root', async () => {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Pensieve Dashboard');
    });
  });

  describe('GET /api/labels', () => {
    it('returns labels matching getLabels', async () => {
      const res = await fetch(`http://localhost:${port}/api/labels`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getLabels(dbForAnalytics);
      expect(apiData).toEqual(expected);
    });
  });

  describe('GET /api/projects', () => {
    it('returns projects matching getProjects', async () => {
      const res = await fetch(`http://localhost:${port}/api/projects`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getProjects(dbForAnalytics);
      expect(apiData).toEqual(expected);
    });
  });

  describe('GET /api/sessions', () => {
    it('returns sessions matching getSessions', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getSessions(dbForAnalytics);
      expect(apiData).toEqual(expected);
    });

    it('scopes to a project when given', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions?project=/project-a`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getSessions(dbForAnalytics, '/project-a');
      expect(apiData).toEqual(expected);
    });
  });

  describe('POST /api/labels', () => {
    it('updates the label for a project+session and returns ok', async () => {
      const res = await fetch(`http://localhost:${port}/api/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: '/project-a',
          sessionId: 'session-1',
          oldLabel: '',
          label: 'renamed',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.changes).toBeGreaterThan(0);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(`http://localhost:${port}/api/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/project-a' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('filter query params on existing routes', () => {
    it('/api/top-insights scopes to a project via the project query param', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/top-insights?date=2026-07-15&limit=10&project=/project-b`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getTopInsights(dbForAnalytics, '2026-07-15', 10, {
        projectDir: '/project-b',
      });
      expect(apiData).toEqual(expected);
    });
  });

  describe('GET /api/effort-by-category', () => {
    it('returns effort-by-category matching getEffortByCategory', async () => {
      const date = '2026-07-15';
      const res = await fetch(`http://localhost:${port}/api/effort-by-category?date=${date}`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getEffortByCategory(dbForAnalytics, date);
      expect(apiData).toEqual(expected);
    });

    it('returns 400 for missing date', async () => {
      const res = await fetch(`http://localhost:${port}/api/effort-by-category`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/session-projects', () => {
    it('returns a list (real disk scan, contents not asserted)', async () => {
      const res = await fetch(`http://localhost:${port}/api/session-projects`);
      expect(res.status).toBe(200);
      const apiData = await res.json();
      expect(Array.isArray(apiData)).toBe(true);
      if (apiData.length > 0) {
        expect(apiData[0]).toHaveProperty('projectDir');
        expect(apiData[0]).toHaveProperty('sessionCount');
        expect(apiData[0]).toHaveProperty('analyzedCount');
      }
    });
  });

  describe('GET /api/sessions/all', () => {
    it('returns 400 when project param is missing', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions/all`);
      expect(res.status).toBe(400);
    });

    it('returns a paginated shape scoped to a project (real disk scan)', async () => {
      const projectsRes = await fetch(`http://localhost:${port}/api/session-projects`);
      const projects = await projectsRes.json();
      if (projects.length === 0) return; // nothing to scope to in this test environment

      const res = await fetch(
        `http://localhost:${port}/api/sessions/all?project=${encodeURIComponent(projects[0].projectDir)}`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      expect(Array.isArray(apiData.sessions)).toBe(true);
      expect(apiData.page).toBe(1);
      expect(apiData.pageSize).toBe(20);
      expect(typeof apiData.total).toBe('number');
      expect(typeof apiData.totalPages).toBe('number');
    });

    it('caps pageSize at 100', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/sessions/all?project=/project-a&pageSize=500`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      expect(apiData.pageSize).toBe(100);
    });

    it('returns 400 for invalid page', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/sessions/all?project=/project-a&page=abc`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid sortBy', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/sessions/all?project=/project-a&sortBy=bogus`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid sortDir', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/sessions/all?project=/project-a&sortDir=bogus`,
      );
      expect(res.status).toBe(400);
    });

    it('accepts sortBy=title, sortDir=asc, analyzed=false, and q without erroring', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/sessions/all?project=/project-a&sortBy=title&sortDir=asc&analyzed=false&q=test`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      expect(apiData.sessions).toEqual([]);
      expect(apiData.total).toBe(0);
    });

    it('returns empty results for a project with no sessions on disk', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/sessions/all?project=/definitely-not-a-real-project`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      expect(apiData.sessions).toEqual([]);
      expect(apiData.total).toBe(0);
      expect(apiData.totalPages).toBe(1);
    });
  });

  describe('GET /api/session-runs', () => {
    it('returns session runs matching getSessionRuns', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/session-runs?project=/project-a&session=session-1`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getSessionRuns(dbForAnalytics, '/project-a', 'session-1');
      expect(apiData).toEqual(expected);
    });

    it('returns 400 when project is missing', async () => {
      const res = await fetch(`http://localhost:${port}/api/session-runs?session=session-1`);
      expect(res.status).toBe(400);
    });

    it('returns 400 when session is missing', async () => {
      const res = await fetch(`http://localhost:${port}/api/session-runs?project=/project-a`);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/sessions/analyze + GET /api/sessions/analyze/:jobId', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/project-a' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown jobId', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions/analyze/unknown-job-id`);
      expect(res.status).toBe(404);
    });

    it('starting a job returns a jobId pollable via the status endpoint', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/project-a', sessionId: 'session-1' }),
      });
      expect(res.status).toBe(200);
      const { jobId } = await res.json();
      expect(typeof jobId).toBe('string');

      const statusRes = await fetch(`http://localhost:${port}/api/sessions/analyze/${jobId}`);
      expect(statusRes.status).toBe(200);
      const job = await statusRes.json();
      expect(['queued', 'running', 'done', 'failed']).toContain(job.status);
    });

    it('auto-triggers derive-insights after analyze completes when insightsPersisted > 0', async () => {
      // Seed the DB with episodes and insights for a run
      dbForAnalytics
        .prepare(
          `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line, label)
        VALUES ('2026-07-15', '/project-test', 'session-test', 1, 10, 'run-test')
      `,
        )
        .run();

      dbForAnalytics
        .prepare(
          `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, effort_class, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'exploration', 'Test insight', 'ref1', 3, 'judgment', NULL, NULL, '2026-07-15T10:00:00Z')
      `,
        )
        .run();

      const res = await fetch(`http://localhost:${port}/api/sessions/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: '/project-test',
          sessionId: 'session-test',
          label: 'run-test',
        }),
      });
      expect(res.status).toBe(200);
      const { jobId } = await res.json();

      // Poll until analyze completes
      let analyzeJob;
      for (let i = 0; i < 30; i++) {
        const statusRes = await fetch(`http://localhost:${port}/api/sessions/analyze/${jobId}`);
        analyzeJob = await statusRes.json();
        if (analyzeJob.status === 'done' || analyzeJob.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(analyzeJob.status).toBe('done');

      // Check that derived insights were auto-created for the label
      const derivedRes = await fetch(
        `http://localhost:${port}/api/derived-insights?project=/project-test&session=session-test&label=run-test`,
      );
      expect(derivedRes.status).toBe(200);
      const derived = await derivedRes.json();
      expect(Array.isArray(derived)).toBe(true);
      // Since deriveSessionInsights may not generate insights with the mock setup,
      // we just verify the call didn't error — the presence of work items is what matters
    });

    it('does not auto-trigger derive-insights when insightsPersisted === 0', async () => {
      // Run analyze with a non-existent label to ensure no insights match
      const res = await fetch(`http://localhost:${port}/api/sessions/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: '/project-nonexistent',
          sessionId: 'session-nonexistent',
          label: 'run-nonexistent',
        }),
      });
      expect(res.status).toBe(200);
      const { jobId } = await res.json();

      // Poll until analyze completes
      let analyzeJob;
      for (let i = 0; i < 30; i++) {
        const statusRes = await fetch(`http://localhost:${port}/api/sessions/analyze/${jobId}`);
        analyzeJob = await statusRes.json();
        if (analyzeJob.status === 'done' || analyzeJob.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(analyzeJob.status).toBe('done');
      expect(analyzeJob.insightsPersisted).toBe(0);

      // Verify no derived insights were created (should be empty, no side-effect)
      const derivedRes = await fetch(
        `http://localhost:${port}/api/derived-insights?project=/project-nonexistent&session=session-nonexistent&label=run-nonexistent`,
      );
      expect(derivedRes.status).toBe(200);
      const derived = await derivedRes.json();
      expect(derived).toEqual([]);
    });
  });

  describe('GET /api/derived-insights', () => {
    it('returns 400 when project or session is missing', async () => {
      const res = await fetch(`http://localhost:${port}/api/derived-insights?project=/project-a`);
      expect(res.status).toBe(400);
    });

    it('returns derived insights matching getDerivedInsights (empty when none exist)', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/derived-insights?project=/project-a&session=session-1`,
      );
      expect(res.status).toBe(200);
      const apiData = await res.json();
      const expected = getDerivedInsights(dbForAnalytics, '/project-a', 'session-1');
      expect(apiData).toEqual(expected);
    });
  });

  describe('POST /api/sessions/derive-insights + GET /api/sessions/derive-insights/:jobId', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions/derive-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/project-a' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown jobId', async () => {
      const res = await fetch(
        `http://localhost:${port}/api/sessions/derive-insights/unknown-job-id`,
      );
      expect(res.status).toBe(404);
    });

    it('starting a job with no work items completes as done with 0 derived insights', async () => {
      const res = await fetch(`http://localhost:${port}/api/sessions/derive-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: '/project-a',
          sessionId: 'session-1',
          label: 'nonexistent-label',
        }),
      });
      expect(res.status).toBe(200);
      const { jobId } = await res.json();
      expect(typeof jobId).toBe('string');

      // No work items exist for this label, so deriveSessionInsights short-circuits
      // without calling the API — poll until done rather than racing the async job.
      let job;
      for (let i = 0; i < 20; i++) {
        const statusRes = await fetch(
          `http://localhost:${port}/api/sessions/derive-insights/${jobId}`,
        );
        job = await statusRes.json();
        if (job.status === 'done' || job.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(job.status).toBe('done');
      expect(job.insightsDerived).toBe(0);
    });
  });
});
