import type { InsightCategory, EffortClass } from '../types';

interface Props {
  selectedCategories: InsightCategory[];
  selectedEfforts: EffortClass[];
  onToggleCategory: (category: InsightCategory) => void;
  onToggleEffort: (effort: EffortClass) => void;
}

const CATEGORIES: InsightCategory[] = [
  'architecture_decisions',
  'exploration',
  'mechanical_labor',
  'bug_fix',
  'ai_correction_load',
  'friction_audit',
  'high_potential_seeds',
];

const EFFORTS: EffortClass[] = ['toil', 'judgment', 'overhead'];

export function CategoryEffortFilter({
  selectedCategories,
  selectedEfforts,
  onToggleCategory,
  onToggleEffort,
}: Props) {
  return (
    <>
      <div className="sort-controls">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={selectedCategories.includes(cat) ? 'active' : ''}
            onClick={() => onToggleCategory(cat)}
          >
            {cat.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <div className="sort-controls">
        {EFFORTS.map((effort) => (
          <button
            key={effort}
            className={selectedEfforts.includes(effort) ? 'active' : ''}
            onClick={() => onToggleEffort(effort)}
          >
            {effort}
          </button>
        ))}
      </div>
    </>
  );
}
