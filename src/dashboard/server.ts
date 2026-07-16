import express, { Application, Request, Response } from 'express';
import path from 'path';
import http from 'http';
import type Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { Config } from '../config.js';
import { openDb } from '../db/schema.js';
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
  updateLabelsForSession,
  getEffortByCategory,
  type AnalyticsFilter,
} from '../analytics/index.js';

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

  return app;
}

export function startDashboardServer(config: Config, port: number): http.Server {
  const app = createDashboardServer(config);
  const server = app.listen(port);
  return server;
}
