import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../src/db/schema.js';
import { writeBrief, renderBriefMarkdown } from '../src/brief.js';
import type { Insight } from '../src/types.js';

describe('brief', () => {
  let tempDir: string;
  let db: Database.Database;
  let briefsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync('pensieve-brief-test-');
    db = openDb(join(tempDir, 'test.db'));
    briefsDir = join(tempDir, 'briefs');
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('renders markdown with categories in fixed order', async () => {
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'ai_leverage',
        text: 'Used AI effectively',
        evidenceRef: 'session 123',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2026-07-15T10:00:00Z',
      },
      {
        episodeId: 1,
        category: 'strategic_value',
        text: 'Prevented a bug',
        evidenceRef: 'code review',
        significanceScore: 0.9,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2026-07-15T10:00:00Z',
      },
      {
        episodeId: 1,
        category: 'decision_record',
        text: 'Chose async over sync',
        evidenceRef: 'architecture',
        significanceScore: 0.7,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2026-07-15T10:00:00Z',
      },
    ];

    const markdown = renderBriefMarkdown(insights, '2026-07-15');

    // Check that Strategic Value comes before Decision Record before AI Leverage
    const strategicIdx = markdown.indexOf('## Strategic Value');
    const decisionIdx = markdown.indexOf('## Decision Record');
    const aiIdx = markdown.indexOf('## AI Leverage');

    expect(strategicIdx).toBeGreaterThan(-1);
    expect(decisionIdx).toBeGreaterThan(-1);
    expect(aiIdx).toBeGreaterThan(-1);
    expect(strategicIdx).toBeLessThan(decisionIdx);
    expect(decisionIdx).toBeLessThan(aiIdx);
  });

  it('omits empty categories', async () => {
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'strategic_value',
        text: 'Strategic insight',
        evidenceRef: 'test',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2026-07-15T10:00:00Z',
      },
    ];

    const markdown = renderBriefMarkdown(insights, '2026-07-15');

    expect(markdown).toContain('## Strategic Value');
    expect(markdown).not.toContain('## Friction Audit');
    expect(markdown).not.toContain('## AI Correction Load');
  });

  it('writeBrief creates directory and writes file', async () => {
    // Pre-populate with insights
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (1, 'strategic_value', 'Test insight', 'evidence', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    expect(result.path).toBe(join(briefsDir, '2026-07-15.md'));
    expect(result.insightCount).toBe(1);

    const fileContent = readFileSync(result.path, 'utf-8');
    expect(fileContent).toContain('Test insight');
    expect(fileContent).toContain('Strategic Value');
  });

  it('groups insights correctly across multiple dates', async () => {
    // Insert episodes for multiple dates
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-14', '/tmp/project', 'session-1', 1, 5)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 6, 10)
    `,
    ).run();

    // Insert insights for both dates
    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (1, 'strategic_value', 'Old insight', 'old', 0.8, NULL, NULL, '2026-07-14T10:00:00Z')
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (2, 'decision_record', 'New insight', 'new', 0.7, NULL, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    // Should only contain new insight, not old
    expect(fileContent).toContain('New insight');
    expect(fileContent).not.toContain('Old insight');
    expect(result.insightCount).toBe(1);
  });

  it('handles insights with missing evidence ref', async () => {
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'friction_audit',
        text: 'Time wasted',
        evidenceRef: '',
        significanceScore: 0.6,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2026-07-15T10:00:00Z',
      },
    ];

    const markdown = renderBriefMarkdown(insights, '2026-07-15');

    expect(markdown).toContain('Time wasted');
    expect(markdown).toContain('[0.6]');
  });

  it('marks verified insights with checkmark', async () => {
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'strategic_value',
        text: 'Verified insight',
        evidenceRef: 'git commit',
        significanceScore: 0.9,
        verifiedByGit: true,
        recurrenceOf: null,
        createdAt: '2026-07-15T10:00:00Z',
      },
      {
        episodeId: 1,
        category: 'decision_record',
        text: 'Unverified insight',
        evidenceRef: 'notes',
        significanceScore: 0.7,
        verifiedByGit: false,
        recurrenceOf: null,
        createdAt: '2026-07-15T10:00:00Z',
      },
    ];

    const markdown = renderBriefMarkdown(insights, '2026-07-15');

    expect(markdown).toContain('Verified insight');
    expect(markdown).toContain('✓ (verified)');
    expect(markdown).toContain('Unverified insight');
    // Unverified insight should NOT have the checkmark
    const verifiedIdx = markdown.indexOf('Verified insight');
    const unverifiedIdx = markdown.indexOf('Unverified insight');
    const checkmarkAfterVerified = markdown.indexOf('✓ (verified)', verifiedIdx);
    expect(checkmarkAfterVerified).toBeGreaterThan(verifiedIdx);
    expect(checkmarkAfterVerified).toBeLessThan(unverifiedIdx);
  });

  it('renders recurrence note with source date', async () => {
    // Insert referenced insight with known date
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-10', '/tmp/project', 'session-1', 1, 5)
    `,
    ).run();

    const refId = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Original insight', 'old', 0.9, NULL, NULL, '2026-07-10T10:00:00Z')
      `,
      )
      .run().lastInsertRowid;

    // Insert current day's episode
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 6, 10)
    `,
    ).run();

    const insights: Insight[] = [
      {
        episodeId: 2,
        category: 'strategic_value',
        text: 'Recurring insight',
        evidenceRef: 'new evidence',
        significanceScore: 0.85,
        verifiedByGit: null,
        recurrenceOf: Number(refId),
        createdAt: '2026-07-15T10:00:00Z',
        recurrenceDate: '2026-07-10',
      },
    ];

    const markdown = renderBriefMarkdown(insights, '2026-07-15');

    expect(markdown).toContain('Recurring insight');
    expect(markdown).toContain('recurring — also seen on 2026-07-10');
  });

  it('writeBrief queries real DB and preserves recurrence/verified markers', async () => {
    // Set up two episodes on different dates
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-10', '/tmp/project', 'session-1', 1, 5)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 6, 10)
    `,
    ).run();

    // Insert referenced insight
    const refId = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'strategic_value', 'Original', 'old', 0.9, 1, NULL, '2026-07-10T10:00:00Z')
      `,
      )
      .run().lastInsertRowid;

    // Insert current day's insights: one verified, one recurring
    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (2, 'decision_record', 'Verified decision', 'git', 0.8, 1, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (2, 'friction_audit', 'Recurring friction', 'notes', 0.6, NULL, ?, '2026-07-15T10:00:00Z')
    `,
    ).run(refId);

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).toContain('Verified decision');
    expect(fileContent).toContain('✓ (verified)');
    expect(fileContent).toContain('Recurring friction');
    expect(fileContent).toContain('recurring — also seen on 2026-07-10');
    expect(result.insightCount).toBe(2);
  });

  it('renders top insights section with highest scoring insights', async () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (1, 'strategic_value', 'Top insight', 'ref1', 0.95, NULL, NULL, '2026-07-15T10:00:00Z'),
             (1, 'friction_audit', 'Mid insight', 'ref2', 0.5, NULL, NULL, '2026-07-15T10:00:00Z'),
             (1, 'decision_record', 'High insight', 'ref3', 0.85, NULL, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).toContain('## Top Insights Today');
    expect(fileContent).toContain('1. Top insight');
    expect(fileContent).toContain('2. High insight');
  });

  it('omits top insights section for date with no insights', async () => {
    const insights: Insight[] = [];
    const markdown = renderBriefMarkdown(insights, '2026-07-15');

    expect(markdown).not.toContain('## Top Insights Today');
  });

  it('renders recurring patterns section with chains', async () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 5),
             ('2026-07-15', '/tmp/project', 'session-1', 6, 10),
             ('2026-07-15', '/tmp/project', 'session-1', 11, 15)
    `,
    ).run();

    // Create recurrence chain: A <- B <- C, all on same date so all appear in brief
    const rootId = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Root friction', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
      `,
      )
      .run().lastInsertRowid;

    const childId = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (2, 'friction_audit', 'Recurring friction occurrence 2', 'ref', 0.7, NULL, ?, '2026-07-15T10:00:00Z')
      `,
      )
      .run(rootId).lastInsertRowid;

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (3, 'friction_audit', 'Recurring friction occurrence 3', 'ref', 0.6, NULL, ?, '2026-07-15T10:00:00Z')
    `,
    ).run(childId);

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).toContain('## Recurring Patterns');
    expect(fileContent).toContain('recurred');
  });

  it('omits recurring patterns section when no recurrence', async () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (1, 'strategic_value', 'One-off insight', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).not.toContain('## Recurring Patterns');
  });

  it('renders by project section for multi-project days', async () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/project1', 'session-1', 1, 5),
             ('2026-07-15', '/project2', 'session-1', 6, 10)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (1, 'strategic_value', 'Project 1 insight', 'ref1', 0.8, NULL, NULL, '2026-07-15T10:00:00Z'),
             (2, 'strategic_value', 'Project 2 insight A', 'ref2', 0.7, NULL, NULL, '2026-07-15T10:00:00Z'),
             (2, 'strategic_value', 'Project 2 insight B', 'ref3', 0.6, NULL, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).toContain('## By Project');
    expect(fileContent).toContain('/project1: 1 insights');
    expect(fileContent).toContain('/project2: 2 insights');
  });

  it('omits by project section for single-project days', async () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (1, 'strategic_value', 'Single project insight', 'ref', 0.8, NULL, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).not.toContain('## By Project');
  });

  it('renders recurrence summary with elapsed days not occurrence count', async () => {
    // Create chain spanning 5 days: 07-10, 07-12, 07-15
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-10', '/tmp/project', 'session-1', 1, 5),
             ('2026-07-12', '/tmp/project', 'session-1', 6, 10),
             ('2026-07-15', '/tmp/project', 'session-1', 11, 15)
    `,
    ).run();

    const rootId = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (1, 'friction_audit', 'Root friction', 'ref', 0.8, NULL, NULL, '2026-07-10T10:00:00Z')
      `,
      )
      .run().lastInsertRowid;

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (2, 'friction_audit', 'Mid occurrence', 'ref', 0.7, NULL, ?, '2026-07-12T10:00:00Z')
    `,
    ).run(rootId);

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (3, 'friction_audit', 'Last occurrence', 'ref', 0.6, NULL, ?, '2026-07-15T10:00:00Z')
    `,
    ).run(rootId);

    const result = await writeBrief({
      client: null,
      db,
      date: '2026-07-15',
      briefsDir,
    });

    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).toContain('## Recurring Patterns');
    // 3 occurrences over 5 elapsed days (07-10 to 07-15)
    expect(fileContent).toContain('recurred 3 times over 5 days');
  });

  it('renders Effort Breakdown section with ratios when insights exist', async () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2026-07-15', '/tmp/project', 'session-1', 1, 10)
    `,
    ).run();

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, effort_class, verified_by_git, recurrence_of, created_at)
      VALUES (1, 'friction_audit', 'Toil insight', 'ref1', 3, 'toil', NULL, NULL, '2026-07-15T10:00:00Z'),
             (1, 'decision_record', 'Judgment insight', 'ref2', 4, 'judgment', NULL, NULL, '2026-07-15T10:00:00Z'),
             (1, 'decision_record', 'Judgment insight 2', 'ref3', 4, 'judgment', NULL, NULL, '2026-07-15T10:00:00Z'),
             (1, 'strategic_value', 'Overhead insight', 'ref4', 2, 'overhead', NULL, NULL, '2026-07-15T10:00:00Z')
    `,
    ).run();

    const result = await writeBrief({ db, date: '2026-07-15', briefsDir, client: null });
    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).toContain('## Effort Breakdown');
    expect(fileContent).toContain('50% judgment');
    expect(fileContent).toContain('25% toil');
    expect(fileContent).toContain('25% overhead');
    expect(fileContent).toContain('4 insights today');
  });

  it('omits Effort Breakdown section when there are no insights for the date', async () => {
    const result = await writeBrief({ db, date: '2026-07-15', briefsDir, client: null });
    const fileContent = readFileSync(result.path, 'utf-8');

    expect(fileContent).not.toContain('## Effort Breakdown');
  });
});
