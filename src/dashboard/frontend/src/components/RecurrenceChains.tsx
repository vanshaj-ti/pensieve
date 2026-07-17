import { useState } from 'react';
import type { RecurrenceChain, InsightCategory, EffortClass } from '../types';
import { CategoryEffortFilter } from './CategoryEffortFilter';

interface Props {
  chains: RecurrenceChain[];
}

export function RecurrenceChains({ chains }: Props) {
  const [selectedCategories, setSelectedCategories] = useState<InsightCategory[]>([]);
  const [selectedEfforts, setSelectedEfforts] = useState<EffortClass[]>([]);

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

  if (chains.length === 0) {
    return <div className="empty-state">No recurring patterns found.</div>;
  }

  const filtered = chains.filter((chain) => {
    const firstInsight = chain.insights[0];
    return (
      (selectedCategories.length === 0 || selectedCategories.includes(firstInsight.category)) &&
      (selectedEfforts.length === 0 || selectedEfforts.includes(firstInsight.effortClass))
    );
  });

  if (filtered.length === 0) {
    return (
      <>
        <CategoryEffortFilter
          selectedCategories={selectedCategories}
          selectedEfforts={selectedEfforts}
          onToggleCategory={toggleCategory}
          onToggleEffort={toggleEffort}
        />
        <div className="empty-state">No recurring patterns match the selected filters.</div>
      </>
    );
  }

  return (
    <>
      <CategoryEffortFilter
        selectedCategories={selectedCategories}
        selectedEfforts={selectedEfforts}
        onToggleCategory={toggleCategory}
        onToggleEffort={toggleEffort}
      />
      <ul className="insight-list">
        {filtered.map((chain) => {
          const firstInsight = chain.insights[0];
          const lastInsight = chain.insights[chain.insights.length - 1];

          return (
            <li className="chain-item" key={chain.rootId}>
              <div className="chain-header">
                <span className="badge badge-category">
                  {firstInsight.category.replace(/_/g, ' ')}
                </span>
                <span className={`badge badge-effort ${lastInsight.effortClass}`}>
                  {lastInsight.effortClass}
                </span>
                <span className="chain-label">
                  Recurred {chain.insights.length}× over {chain.span.firstDate} →{' '}
                  {chain.span.lastDate}
                </span>
              </div>

              <div className="chain-occurrence-list">
                <div className="chain-occurrence">
                  <div className="occurrence-marker">First</div>
                  <div className="occurrence-text">{firstInsight.text}</div>
                </div>
                {chain.insights.length > 1 && (
                  <div className="chain-occurrence">
                    <div className="occurrence-marker">Latest</div>
                    <div className="occurrence-text">{lastInsight.text}</div>
                  </div>
                )}
              </div>

              {chain.insights.length > 2 && (
                <details className="chain-details">
                  <summary>Show all {chain.insights.length} occurrences</summary>
                  <div className="chain-details-list">
                    {chain.insights.map((insight, idx) => (
                      <div className="chain-details-item" key={insight.id ?? idx}>
                        {idx + 1}. {insight.text}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="chain-date-span">
                {chain.span.firstDate} → {chain.span.lastDate}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
