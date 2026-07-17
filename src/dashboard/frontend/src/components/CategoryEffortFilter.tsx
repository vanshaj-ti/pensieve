import type { InsightCategory, EffortClass } from '../types';

interface Props {
  selectedCategories: InsightCategory[];
  selectedEfforts: EffortClass[];
  onToggleCategory: (category: InsightCategory) => void;
  onToggleEffort: (effort: EffortClass) => void;
}

const CATEGORIES: InsightCategory[] = [
  'strategic_value',
  'decision_record',
  'friction_audit',
  'high_potential_seeds',
  'ai_leverage',
  'ai_correction_load',
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
