import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../src/db/schema.js';
import {
  getCategoryTrend,
  getTopInsights,
  getRecurrenceChains,
  getCrossProjectRollup,
} from '../src/analytics/index.js';

describe('analytics', () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync('pensieve-analytics-test-');
    db = openDb(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getCategoryTrend', () => {
    it('returns empty array for empty database', () => {
      const result = getCategoryTrend(db, 30);
      expect(result).toEqual([]);
    });

    it('groups insights by date and category', () => {
      // Insert episodes
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10),
               ('2026-07-16', '/tmp/project', 'session-1', 11, 20)
      `,
      ).run();

      // Insert insights
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Insight 1', 'ref1', 0.8, NULL, NULL, '2026-07-15T10:00:00Z'),
               (1, 'strategic_value', 'Insight 2', 'ref2', 0.7, NULL, NULL, '2026-07-15T10:00:00Z'),
               (1, 'friction_audit', 'Insight 3', 'ref3', 0.6, NULL, NULL, '2026-07-15T10:00:00Z'),
               (2, 'strategic_value', 'Insight 4', 'ref4', 0.9, NULL, NULL, '2026-07-16T10:00:00Z')
      `,
      ).run();

      const result = getCategoryTrend(db, 30);

      // Expect 3 rows: 2026-07-15 strategic_value (2), 2026-07-15 friction_audit (1), 2026-07-16 strategic_value (1)
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ date: '2026-07-15', category: 'friction_audit', count: 1 });
      expect(result[1]).toEqual({ date: '2026-07-15', category: 'strategic_value', count: 2 });
      expect(result[2]).toEqual({ date: '2026-07-16', category: 'strategic_value', count: 1 });
    });
  });

  describe('getTopInsights', () => {
    it('returns empty array for date with no insights', () => {
      const result = getTopInsights(db, '2026-07-15', 5);
      expect(result).toEqual([]);
    });

    it('orders insights by significance score descending', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Low score', 'ref1', 0.3, NULL, NULL, '2026-07-15T10:00:00Z'),
               (1, 'friction_audit', 'High score', 'ref2', 0.9, NULL, NULL, '2026-07-15T10:00:00Z'),
               (1, 'decision_record', 'Mid score', 'ref3', 0.6, NULL, NULL, '2026-07-15T10:00:00Z')
      `,
      ).run();

      const result = getTopInsights(db, '2026-07-15', 5);

      expect(result).toHaveLength(3);
      expect(result[0]?.text).toBe('High score');
      expect(result[0]?.significanceScore).toBe(0.9);
      expect(result[1]?.text).toBe('Mid score');
      expect(result[2]?.text).toBe('Low score');
    });

    it('respects limit parameter', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 20)
      `,
      ).run();

      for (let i = 0; i < 10; i++) {
        db.prepare(
          `
          INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
          VALUES (1, 'strategic_value', ?, ?, ?, NULL, NULL, '2026-07-15T10:00:00Z')
        `,
        ).run(`Insight ${i}`, `ref${i}`, 0.5 + i * 0.01);
      }

      const result = getTopInsights(db, '2026-07-15', 3);
      expect(result).toHaveLength(3);
    });

    it('includes projectDir in result', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/home/user/project', 'session-1', 1, 10)
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Test insight', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
      `,
      ).run();

      const result = getTopInsights(db, '2026-07-15', 5);

      expect(result).toHaveLength(1);
      expect(result[0]?.projectDir).toBe('/home/user/project');
    });
  });

  describe('getRecurrenceChains', () => {
    it('returns empty array when no recurrence', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Test', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
      `,
      ).run();

      const result = getRecurrenceChains(db, 30);
      expect(result).toEqual([]);
    });

    it('builds a chain of length 3 (A -> B -> C)', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-14', '/tmp/project', 'session-1', 1, 5),
               ('2026-07-15', '/tmp/project', 'session-1', 6, 10),
               ('2026-07-16', '/tmp/project', 'session-1', 11, 15)
      `,
      ).run();

      // Insert root insight
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Root insight', 'ref', 0.8, NULL, NULL, '2026-07-14T10:00:00Z')
      `,
      ).run();

      const rootId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      // Insert child pointing to root (C -> B -> A: grandchild points to child)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'friction_audit', 'Second occurrence', 'ref', 0.7, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      ).run(rootId.id);

      const childId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      // Insert grandchild pointing to child
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (3, 'friction_audit', 'Third occurrence', 'ref', 0.6, NULL, ?, '2026-07-16T10:00:00Z')
      `,
      ).run(childId.id);

      const result = getRecurrenceChains(db, 30);

      expect(result).toHaveLength(1);
      expect(result[0]?.rootId).toBe(rootId.id);
      expect(result[0]?.insights).toHaveLength(3);
      // Verify chain includes root and its children
      const texts = result[0]?.insights.map((i) => i.text) || [];
      expect(texts).toContain('Root insight');
      expect(texts).toContain('Second occurrence');
      expect(texts).toContain('Third occurrence');
      expect(result[0]?.span.firstDate).toBe('2026-07-14');
      expect(result[0]?.span.lastDate).toBe('2026-07-16');
    });

    it('sorts chains by length descending', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-14', '/tmp/project', 'session-1', 1, 5),
               ('2026-07-15', '/tmp/project', 'session-1', 6, 10),
               ('2026-07-16', '/tmp/project', 'session-1', 11, 15)
      `,
      ).run();

      // Insert first chain (length 2)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Chain1 root', 'ref', 0.8, NULL, NULL, '2026-07-14T10:00:00Z')
      `,
      ).run();

      const chain1Root = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'friction_audit', 'Chain1 child', 'ref', 0.7, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      ).run(chain1Root.id);

      // Insert second chain (length 3)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'decision_record', 'Chain2 root', 'ref', 0.8, NULL, NULL, '2026-07-14T10:00:00Z')
      `,
      ).run();

      const chain2Root = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'decision_record', 'Chain2 child1', 'ref', 0.7, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      ).run(chain2Root.id);

      const chain2Child = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (3, 'decision_record', 'Chain2 child2', 'ref', 0.6, NULL, ?, '2026-07-16T10:00:00Z')
      `,
      ).run(chain2Child.id);

      const result = getRecurrenceChains(db, 30);

      expect(result).toHaveLength(2);
      // Longest chain (length 3) should come first
      expect(result[0]?.insights.length).toBe(3);
      expect(result[1]?.insights.length).toBe(2);
    });

    it('handles dangling recurrence pointers gracefully', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
      `,
      ).run();

      // Insert insight with recurrence pointing to non-existent id
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Orphan insight', 'ref', 0.8, NULL, 999, '2026-07-15T10:00:00Z')
      `,
      ).run();

      const result = getRecurrenceChains(db, 30);

      // Should not crash; the orphan is treated as its own root with length 1, excluded
      expect(result).toEqual([]);
    });

    it('includes root outside the window when child is in window', () => {
      // Insert root episode (40 days ago, outside 30-day window)
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-06-06', '/tmp/project', 'session-1', 1, 5)
      `,
      ).run();

      // Insert root insight
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Ancient root', 'ref', 0.8, NULL, NULL, '2026-06-06T10:00:00Z')
      `,
      ).run();

      const rootId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      // Insert child episode (recent, within window)
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/tmp/project', 'session-1', 6, 10)
      `,
      ).run();

      // Insert child insight pointing to root
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'friction_audit', 'Recent child', 'ref', 0.7, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      ).run(rootId.id);

      const result = getRecurrenceChains(db, 30);

      // Should find the chain with both root and child, even though root is outside window
      expect(result).toHaveLength(1);
      expect(result[0]?.insights).toHaveLength(2);
      expect(result[0]?.insights[0]?.text).toBe('Ancient root');
      expect(result[0]?.insights[1]?.text).toBe('Recent child');
      expect(result[0]?.span.firstDate).toBe('2026-06-06');
      expect(result[0]?.span.lastDate).toBe('2026-07-15');
    });

    it('handles cyclic linkage deterministically', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 5),
               ('2026-07-15', '/tmp/project', 'session-1', 6, 10)
      `,
      ).run();

      // Create two-node cycle: A → B → A
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Insight A', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
      `,
      ).run();

      const aId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'friction_audit', 'Insight B', 'ref', 0.7, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      ).run(aId.id);

      const bId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      // Complete the cycle: A now points to B
      db.prepare(`UPDATE insights SET recurrence_of = ? WHERE id = ?`).run(bId.id, aId.id);

      const result = getRecurrenceChains(db, 30);

      // Should detect cycle and stop immediately without hanging or hitting iteration cap
      // Cycle is excluded because both insights have recurrence_of set (neither is a true root)
      expect(result).toEqual([]);
    });

    it('includes intermediate ancestors outside the window', () => {
      // Root: 40 days old (outside 30-day window)
      // Middle: 35 days old (outside 30-day window)
      // Child: today (in window)
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-06-06', '/tmp/project', 'session-1', 1, 5),
               ('2026-06-11', '/tmp/project', 'session-1', 6, 10),
               ('2026-07-15', '/tmp/project', 'session-1', 11, 15)
      `,
      ).run();

      // Insert root (outside window)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Ancient root', 'ref', 0.8, NULL, NULL, '2026-06-06T10:00:00Z')
      `,
      ).run();

      const rootId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      // Insert middle (outside window, points to root)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'friction_audit', 'Middle ancestor', 'ref', 0.7, NULL, ?, '2026-06-11T10:00:00Z')
      `,
      ).run(rootId.id);

      const middleId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      // Insert child (in window, points to middle)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (3, 'friction_audit', 'Recent child', 'ref', 0.6, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      ).run(middleId.id);

      const result = getRecurrenceChains(db, 30);

      // Should include all three: root, middle, child
      expect(result).toHaveLength(1);
      expect(result[0]?.insights).toHaveLength(3);
      expect(result[0]?.insights[0]?.text).toBe('Ancient root');
      expect(result[0]?.insights[1]?.text).toBe('Middle ancestor');
      expect(result[0]?.insights[2]?.text).toBe('Recent child');
      expect(result[0]?.span.firstDate).toBe('2026-06-06');
      expect(result[0]?.span.lastDate).toBe('2026-07-15');
    });

    it('returns insights in chronological order root-first', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-10', '/tmp/project', 'session-1', 1, 5),
               ('2026-07-15', '/tmp/project', 'session-1', 6, 10),
               ('2026-07-12', '/tmp/project', 'session-1', 11, 15)
      `,
      ).run();

      // Insert root
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Root', 'ref', 0.8, NULL, NULL, '2026-07-10T10:00:00Z')
      `,
      ).run();

      const rootId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

      // Insert middle child (inserted last, but middle chronologically)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (3, 'friction_audit', 'Middle', 'ref', 0.6, NULL, ?, '2026-07-12T10:00:00Z')
      `,
      ).run(rootId.id);

      // Insert last child (inserted second, but last chronologically)
      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'friction_audit', 'Last', 'ref', 0.7, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      ).run(rootId.id);

      const result = getRecurrenceChains(db, 30);

      expect(result).toHaveLength(1);
      expect(result[0]?.insights).toHaveLength(3);
      // Verify chronological order despite insertion order
      expect(result[0]?.insights[0]?.text).toBe('Root');
      expect(result[0]?.insights[1]?.text).toBe('Middle');
      expect(result[0]?.insights[2]?.text).toBe('Last');
    });
  });

  describe('getCrossProjectRollup', () => {
    it('returns single-project result even for single project', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/home/user/project', 'session-1', 1, 10)
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Test', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
      `,
      ).run();

      const result = getCrossProjectRollup(db, '2026-07-15');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ projectDir: '/home/user/project', insightCount: 1 });
    });

    it('groups multiple projects with counts sorted descending', () => {
      db.prepare(
        `
        INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
        VALUES ('2026-07-15', '/project1', 'session-1', 1, 5),
               ('2026-07-15', '/project2', 'session-1', 6, 15),
               ('2026-07-15', '/project3', 'session-1', 16, 18)
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Insight 1', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z'),
               (2, 'strategic_value', 'Insight 2', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z'),
               (2, 'friction_audit', 'Insight 3', 'ref', 0.7, NULL, NULL, '2026-07-15T10:00:00Z'),
               (2, 'decision_record', 'Insight 4', 'ref', 0.7, NULL, NULL, '2026-07-15T10:00:00Z'),
               (3, 'strategic_value', 'Insight 5', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
      `,
      ).run();

      const result = getCrossProjectRollup(db, '2026-07-15');

      expect(result).toHaveLength(3);
      // Sorted by count DESC: project2 has 3, project1 and project3 each have 1
      expect(result[0]?.projectDir).toBe('/project2');
      expect(result[0]?.insightCount).toBe(3);
      expect(result[1]?.insightCount).toBe(1);
      expect(result[2]?.insightCount).toBe(1);
    });
  });
});
