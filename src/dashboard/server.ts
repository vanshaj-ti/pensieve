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

export function createDashboardServer(config: Config): Application {
  const app = express();
  const db = openDb(config.dbPath);

  const publicDir = path.join(__dirname, 'public');

  app.use(express.static(publicDir));

  app.get('/api/dates', (req: Request, res: Response) => {
    try {
      const dates = getInsightDates(db);
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
      const trend = getCategoryTrend(db, days);
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
      const insights = getTopInsights(db, date, limit);
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
      const chains = getRecurrenceChains(db, days);
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
      const rollup = getCrossProjectRollup(db, date);
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
      const breakdown = getEffortBreakdown(db, date);
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
      const trend = getEffortBreakdownTrend(db, days);
      res.json(trend);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch effort breakdown trend' });
    }
  });

  return app;
}

export function startDashboardServer(config: Config, port: number): http.Server {
  const app = createDashboardServer(config);
  const server = app.listen(port);
  return server;
}
