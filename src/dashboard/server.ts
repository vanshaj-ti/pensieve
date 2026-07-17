import express, { Application, Request, Response } from 'express';
import path from 'path';
import http from 'http';
import { statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { Config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listSessionFiles, readSessionMetadata } from '../ingest/scanner.js';
import { runDailyAnalysis } from '../pipeline.js';
import { deriveSessionInsights } from '../synthesis.js';
import {
  getCategoryTrend,
  getTopInsights,
  getRecurrenceChains,
  getCrossProjectRollup,
  getEffortBreakdown,
  getInsightDates,
  getEffortBreakdownTrend,
  getLabels,
  getProjects,
  getSessions,
  getSessionRuns,
  updateLabelsForSession,
  getEffortByCategory,
  getWorkItemsForRun,
  insertDerivedInsights,
  getDerivedInsights,
  type AnalyticsFilter,
} from '../analytics/index.js';

interface AnalyzeJob {
  status: 'queued' | 'running' | 'done' | 'failed';
  insightsPersisted?: number;
  error?: string;
}

interface DeriveInsightsJob {
  status: 'queued' | 'running' | 'done' | 'failed';
  insightsDerived?: number;
  error?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const iso = d.toISOString().split('T')[0];
  if (iso !== value) return null;
  return value;
}

function parsePositiveInt(value: string | undefined, defaultVal: number): number | null {
  if (!value) return defaultVal;
  if (!/^\d+$/.test(value)) return null;
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) return null;
  return num;
}

/**
 * Excludes scratch sessions run against macOS/Linux system temp dirs.
 * Accepts either a real path (from JSONL `cwd`, slash-separated) or a
 * sanitized project-dir name (dash-separated, e.g. Claude Code's own
 * `-private-tmp-foo` directory naming) as a fallback when `cwd` is
 * unavailable — both forms are checked against the same temp-dir prefixes.
 */
function isTempPath(p: string): boolean {
  return (
    p.startsWith('/tmp/') ||
    p.startsWith('/private/tmp/') ||
    p.startsWith('/private/tmp') ||
    p.startsWith('-private-tmp') ||
    p.startsWith('-tmp-') ||
    /^\/private\/var\/folders\/.*\/T\//.test(p) ||
    /^-private-var-folders-.*-T-/.test(p)
  );
}

function parseFilter(req: Request): AnalyticsFilter {
  const filter: AnalyticsFilter = {};
  const label = req.query.label as string | undefined;
  const project = req.query.project as string | undefined;
  const session = req.query.session as string | undefined;
  if (label !== undefined) filter.label = label;
  if (project !== undefined) filter.projectDir = project;
  if (session !== undefined) filter.sessionId = session;
  return filter;
}

export function createDashboardServer(config: Config): Application {
  const app = express();
  const db = openDb(config.dbPath);
  const analyzeJobs = new Map<string, AnalyzeJob>();
  const deriveInsightsJobs = new Map<string, DeriveInsightsJob>();

  // Always resolves to the repo root's dist/dashboard/public, regardless of
  // whether this file is running from src/dashboard (dev/test via tsx/vitest)
  // or dist/dashboard (compiled) — both are two directories under repo root,
  // and the Vite frontend only ever builds into dist/dashboard/public.
  const publicDir = path.join(__dirname, '..', '..', 'dist', 'dashboard', 'public');

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/dates', (req: Request, res: Response) => {
    try {
      const dates = getInsightDates(db, parseFilter(req));
      res.json(dates);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch dates' });
    }
  });

  app.get('/api/category-trend', (req: Request, res: Response) => {
    try {
      const days = parsePositiveInt(req.query.days as string, 30);
      if (days === null) {
        return res
          .status(400)
          .json({ error: 'Invalid days parameter: must be a positive integer' });
      }
      const trend = getCategoryTrend(db, days, parseFilter(req));
      res.json(trend);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch category trend' });
    }
  });

  app.get('/api/top-insights', (req: Request, res: Response) => {
    try {
      const date = parseDate(req.query.date as string);
      if (!date) {
        return res
          .status(400)
          .json({ error: 'Invalid or missing date parameter: must be YYYY-MM-DD' });
      }
      const limit = parsePositiveInt(req.query.limit as string, 10);
      if (limit === null) {
        return res
          .status(400)
          .json({ error: 'Invalid limit parameter: must be a positive integer' });
      }
      const insights = getTopInsights(db, date, limit, parseFilter(req));
      res.json(insights);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch top insights' });
    }
  });

  app.get('/api/recurrence-chains', (req: Request, res: Response) => {
    try {
      const days = parsePositiveInt(req.query.days as string, 30);
      if (days === null) {
        return res
          .status(400)
          .json({ error: 'Invalid days parameter: must be a positive integer' });
      }
      const chains = getRecurrenceChains(db, days, parseFilter(req));
      res.json(chains);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch recurrence chains' });
    }
  });

  app.get('/api/cross-project', (req: Request, res: Response) => {
    try {
      const date = parseDate(req.query.date as string);
      if (!date) {
        return res
          .status(400)
          .json({ error: 'Invalid or missing date parameter: must be YYYY-MM-DD' });
      }
      const rollup = getCrossProjectRollup(db, date, parseFilter(req));
      res.json(rollup);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch cross-project rollup' });
    }
  });

  app.get('/api/effort-breakdown', (req: Request, res: Response) => {
    try {
      const date = parseDate(req.query.date as string);
      if (!date) {
        return res
          .status(400)
          .json({ error: 'Invalid or missing date parameter: must be YYYY-MM-DD' });
      }
      const breakdown = getEffortBreakdown(db, date, parseFilter(req));
      res.json(breakdown);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch effort breakdown' });
    }
  });

  app.get('/api/effort-breakdown-trend', (req: Request, res: Response) => {
    try {
      const days = parsePositiveInt(req.query.days as string, 30);
      if (days === null) {
        return res
          .status(400)
          .json({ error: 'Invalid days parameter: must be a positive integer' });
      }
      const trend = getEffortBreakdownTrend(db, days, parseFilter(req));
      res.json(trend);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch effort breakdown trend' });
    }
  });

  app.get('/api/effort-by-category', (req: Request, res: Response) => {
    try {
      const date = parseDate(req.query.date as string);
      if (!date) {
        return res
          .status(400)
          .json({ error: 'Invalid or missing date parameter: must be YYYY-MM-DD' });
      }
      const breakdown = getEffortByCategory(db, date, parseFilter(req));
      res.json(breakdown);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch effort by category' });
    }
  });

  app.get('/api/labels', (req: Request, res: Response) => {
    try {
      res.json(getLabels(db));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch labels' });
    }
  });

  app.get('/api/projects', (req: Request, res: Response) => {
    try {
      res.json(getProjects(db));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  });

  app.get('/api/sessions', (req: Request, res: Response) => {
    try {
      const project = req.query.project as string | undefined;
      res.json(getSessions(db, project));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  app.get('/api/session-projects', (req: Request, res: Response) => {
    try {
      // One representative session's cwd stands in for the whole project's
      // display name (all sessions under one projectDir share the same
      // real filesystem path) — only reads one file per project, not one
      // per session, so this stays cheap even with thousands of sessions.
      const analyzed = getSessions(db);
      const analyzedCountByProject = new Map<string, number>();
      for (const s of analyzed) {
        analyzedCountByProject.set(
          s.projectDir,
          (analyzedCountByProject.get(s.projectDir) ?? 0) + 1,
        );
      }

      const byProject = new Map<string, { sessionCount: number; sampleFilePath: string }>();
      for (const sf of listSessionFiles()) {
        if (isTempPath(sf.projectDir)) continue;
        const existing = byProject.get(sf.projectDir);
        if (existing) {
          existing.sessionCount++;
        } else {
          byProject.set(sf.projectDir, { sessionCount: 1, sampleFilePath: sf.filePath });
        }
      }

      const projects = Array.from(byProject.entries())
        .map(([projectDir, { sessionCount, sampleFilePath }]) => {
          const { cwd } = readSessionMetadata(sampleFilePath);
          return {
            projectDir,
            cwd,
            sessionCount,
            analyzedCount: analyzedCountByProject.get(projectDir) ?? 0,
          };
        })
        .sort((a, b) => (a.cwd ?? a.projectDir).localeCompare(b.cwd ?? b.projectDir));

      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: 'Failed to list session projects' });
    }
  });

  app.get('/api/sessions/all', (req: Request, res: Response) => {
    try {
      const projectDir = req.query.project as string | undefined;
      if (!projectDir) {
        return res.status(400).json({ error: 'project query param is required' });
      }

      const page = parsePositiveInt(req.query.page as string, 1);
      if (page === null) {
        return res
          .status(400)
          .json({ error: 'Invalid page parameter: must be a positive integer' });
      }
      const rawPageSize = parsePositiveInt(req.query.pageSize as string, 20);
      if (rawPageSize === null) {
        return res
          .status(400)
          .json({ error: 'Invalid pageSize parameter: must be a positive integer' });
      }
      const pageSize = Math.min(rawPageSize, 100);

      const sortBy = (req.query.sortBy as string) || 'mtime';
      if (!['mtime', 'title', 'analyzed'].includes(sortBy)) {
        return res.status(400).json({ error: 'Invalid sortBy: must be mtime, title, or analyzed' });
      }
      const sortDir = (req.query.sortDir as string) || 'desc';
      if (!['asc', 'desc'].includes(sortDir)) {
        return res.status(400).json({ error: 'Invalid sortDir: must be asc or desc' });
      }
      const analyzedFilter = req.query.analyzed as string | undefined; // 'true' | 'false' | undefined
      const query = ((req.query.q as string) || '').trim().toLowerCase();

      // Filter/sort/paginate on cheap fields (dir name, stat mtime) first —
      // readSessionMetadata does a full-file read per session, which at
      // real scale (thousands of sessions in one project) is too slow to
      // run on every session on every request. Only when a title-dependent
      // operation is requested (sort by title, or a search query — which
      // must match against title, not just the opaque session id) do we
      // read metadata for every session in the project up front; otherwise
      // only the final page's worth of sessions get their JSONL read.
      const analyzed = getSessions(db, projectDir);
      const analyzedMap = new Map(analyzed.map((s) => [`${s.projectDir}/${s.sessionId}`, s]));

      const light = listSessionFiles()
        .filter((sf) => sf.projectDir === projectDir)
        .map((sf) => {
          let mtime = '';
          try {
            mtime = statSync(sf.filePath).mtime.toISOString();
          } catch {
            mtime = '';
          }
          const dbEntry = analyzedMap.get(`${sf.projectDir}/${sf.sessionId}`);
          return {
            projectDir: sf.projectDir,
            sessionId: sf.sessionId,
            filePath: sf.filePath,
            mtime,
            analyzed: dbEntry !== undefined,
            runCount: dbEntry?.count ?? 0,
          };
        });

      const needsFullMetadataUpfront = sortBy === 'title' || query.length > 0;

      let withMeta = light.map((s) => {
        if (!needsFullMetadataUpfront) {
          return { ...s, cwd: null as string | null, title: null as string | null };
        }
        const { cwd, title } = readSessionMetadata(s.filePath);
        return { ...s, cwd, title };
      });

      if (analyzedFilter === 'true') {
        withMeta = withMeta.filter((s) => s.analyzed);
      } else if (analyzedFilter === 'false') {
        withMeta = withMeta.filter((s) => !s.analyzed);
      }

      if (query) {
        withMeta = withMeta.filter(
          (s) =>
            s.sessionId.toLowerCase().includes(query) ||
            (s.title ?? '').toLowerCase().includes(query),
        );
      }

      const dirMul = sortDir === 'asc' ? 1 : -1;
      withMeta.sort((a, b) => {
        if (sortBy === 'title') {
          return dirMul * (a.title ?? '').localeCompare(b.title ?? '');
        }
        if (sortBy === 'analyzed') {
          return dirMul * (Number(a.analyzed) - Number(b.analyzed));
        }
        return dirMul * a.mtime.localeCompare(b.mtime);
      });

      const total = withMeta.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const start = (page - 1) * pageSize;
      const pageSlice = withMeta.slice(start, start + pageSize);

      const sessions = pageSlice.map(({ filePath, cwd, title, ...rest }) => {
        if (needsFullMetadataUpfront) {
          return { ...rest, cwd, title };
        }
        const meta = readSessionMetadata(filePath);
        return { ...rest, cwd: meta.cwd, title: meta.title };
      });

      res.json({ sessions, page, pageSize, total, totalPages });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  app.get('/api/session-runs', (req: Request, res: Response) => {
    try {
      const project = req.query.project as string | undefined;
      const session = req.query.session as string | undefined;
      if (!project || !session) {
        return res.status(400).json({ error: 'project and session query params are required' });
      }
      res.json(getSessionRuns(db, project, session));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch session runs' });
    }
  });

  app.post('/api/sessions/analyze', (req: Request, res: Response) => {
    try {
      const { projectDir, sessionId, label } = req.body as {
        projectDir?: string;
        sessionId?: string;
        label?: string;
      };
      if (!projectDir || !sessionId) {
        return res.status(400).json({ error: 'Body must include projectDir and sessionId' });
      }

      const jobId = randomUUID();
      analyzeJobs.set(jobId, { status: 'queued' });

      analyzeJobs.set(jobId, { status: 'running' });
      runDailyAnalysis({
        projectFilter: projectDir,
        sessionFilter: sessionId,
        label,
        force: true,
        db,
      })
        .then((result) => {
          analyzeJobs.set(jobId, {
            status: 'done',
            insightsPersisted: result.insightsPersisted,
          });
        })
        .catch((err) => {
          analyzeJobs.set(jobId, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        });

      res.json({ jobId });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start analysis' });
    }
  });

  app.get('/api/sessions/analyze/:jobId', (req: Request, res: Response) => {
    const job = analyzeJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  app.post('/api/sessions/derive-insights', (req: Request, res: Response) => {
    try {
      const { projectDir, sessionId, label } = req.body as {
        projectDir?: string;
        sessionId?: string;
        label?: string;
      };
      if (!projectDir || !sessionId || !label) {
        return res
          .status(400)
          .json({ error: 'Body must include projectDir, sessionId, and label' });
      }

      const jobId = randomUUID();
      deriveInsightsJobs.set(jobId, { status: 'running' });

      const workItems = getWorkItemsForRun(db, projectDir, sessionId, label);
      deriveSessionInsights({ projectDir, sessionId, label, workItems })
        .then((derived) => {
          insertDerivedInsights(db, derived);
          deriveInsightsJobs.set(jobId, { status: 'done', insightsDerived: derived.length });
        })
        .catch((err) => {
          deriveInsightsJobs.set(jobId, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        });

      res.json({ jobId });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start derive-insights job' });
    }
  });

  app.get('/api/sessions/derive-insights/:jobId', (req: Request, res: Response) => {
    const job = deriveInsightsJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  app.get('/api/derived-insights', (req: Request, res: Response) => {
    try {
      const projectDir = req.query.project as string | undefined;
      const sessionId = req.query.session as string | undefined;
      const label = req.query.label as string | undefined;
      if (!projectDir || !sessionId) {
        return res.status(400).json({ error: 'project and session query params are required' });
      }
      res.json(getDerivedInsights(db, projectDir, sessionId, label));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch derived insights' });
    }
  });

  app.post('/api/labels', (req: Request, res: Response) => {
    try {
      const { projectDir, sessionId, oldLabel, label } = req.body as {
        projectDir?: string;
        sessionId?: string;
        oldLabel?: string;
        label?: string;
      };
      if (!projectDir || !sessionId || oldLabel === undefined || !label) {
        return res.status(400).json({
          error: 'Body must include projectDir, sessionId, oldLabel, and label',
        });
      }
      const changes = updateLabelsForSession(db, projectDir, sessionId, oldLabel, label);
      res.json({ ok: true, changes });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update label' });
    }
  });

  // SPA fallback: any non-API GET (e.g. /sessions, /project/x) is a client-side
  // route the React router owns, not a real server resource — serve the app
  // shell and let it resolve the path. Must come after every /api/* route.
  app.get(/^(?!\/api\/).*/, (req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

export function startDashboardServer(config: Config, port: number): http.Server {
  const app = createDashboardServer(config);
  const server = app.listen(port);
  return server;
}
