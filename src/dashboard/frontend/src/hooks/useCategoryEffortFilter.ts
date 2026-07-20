import { useState } from 'react';
import type { InsightCategory, EffortClass } from '../types';

export function useCategoryEffortFilter() {
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

  return { selectedCategories, selectedEfforts, toggleCategory, toggleEffort };
}
