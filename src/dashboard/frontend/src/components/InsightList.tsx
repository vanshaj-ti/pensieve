import { useState } from 'react';
import type { TopInsight, InsightCategory, EffortClass } from '../types';
import { LabelEditor } from './LabelEditor';
import { CategoryEffortFilter } from './CategoryEffortFilter';

interface Props {
  insights: TopInsight[];
  onLabelSaved: () => void;
}

type SortKey = 'significance' | 'category' | 'effort';

function badgeRow(insight: TopInsight) {
  return (
    <div className="badge-row">
      <span className="badge badge-category">{insight.category.replace(/_/g, ' ')}</span>
      <span className={`badge badge-effort ${insight.effortClass}`}>{insight.effortClass}</span>
      <span className="badge badge-score">sig {insight.significanceScore.toFixed(1)}</span>
    </div>
  );
}

export function InsightList({ insights, onLabelSaved }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('significance');
  const [selectedCategories, setSelectedCategories] = useState<InsightCategory[]>([]);
  const [selectedEfforts, setSelectedEfforts] = useState<EffortClass[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  if (insights.length === 0) {
    return <div className="empty-state">No insights for this scope.</div>;
  }

  const query = searchQuery.trim().toLowerCase();
  const filtered = insights.filter(
    (insight) =>
      (selectedCategories.length === 0 || selectedCategories.includes(insight.category)) &&
      (selectedEfforts.length === 0 || selectedEfforts.includes(insight.effortClass)) &&
      (query === '' || insight.text.toLowerCase().includes(query)),
  );

  const toggleCategory = (category: InsightCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  };

  const toggleEffort = (effort: EffortClass) => {
    setSelectedEfforts((prev) =>
      prev.includes(effort) ? prev.filter((e) => e !== effort) : [...prev, effort],
    );
  };

  if (filtered.length === 0 && insights.length > 0) {
    return (
      <>
        <div className="sort-controls">
          <input
            type="search"
            className="search-box"
            placeholder="Search insight text…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <CategoryEffortFilter
            selectedCategories={selectedCategories}
            selectedEfforts={selectedEfforts}
            onToggleCategory={toggleCategory}
            onToggleEffort={toggleEffort}
          />
        </div>
        <div className="empty-state">No insights match the selected filters.</div>
      </>
    );
  }

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'significance') return b.significanceScore - a.significanceScore;
    if (sortKey === 'category') return a.category.localeCompare(b.category);
    return a.effortClass.localeCompare(b.effortClass);
  });

  return (
    <>
      <div className="sort-controls">
        <input
          type="search"
          className="search-box"
          placeholder="Search insight text…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <CategoryEffortFilter
          selectedCategories={selectedCategories}
          selectedEfforts={selectedEfforts}
          onToggleCategory={toggleCategory}
          onToggleEffort={toggleEffort}
        />
      </div>
      <div className="sort-controls">
        {(['significance', 'category', 'effort'] as SortKey[]).map((key) => (
          <button
            key={key}
            className={sortKey === key ? 'active' : ''}
            onClick={() => setSortKey(key)}
          >
            Sort by {key}
          </button>
        ))}
      </div>
      <ul className="insight-list scrollable">
        {sorted.map((insight) => (
          <li className="insight-item" key={insight.id}>
            <div className="insight-text">{insight.text}</div>
            {badgeRow(insight)}
            {insight.projectDir && (
              <div className="insight-meta">
                <span>
                  {insight.projectDir}
                  {insight.label ? ` · ${insight.label}` : ''}
                </span>
                <LabelEditor
                  projectDir={insight.projectDir}
                  sessionId={insight.sessionId}
                  currentLabel={insight.label || ''}
                  onSaved={onLabelSaved}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
