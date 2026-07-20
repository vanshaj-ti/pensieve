/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryEffortFilter } from './CategoryEffortFilter';
import type { InsightCategory, EffortClass } from '../types';

// @vitest-environment jsdom
describe('CategoryEffortFilter', () => {
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

  it('renders all buttons', () => {
    const onToggleCategory = vi.fn();
    const onToggleEffort = vi.fn();

    render(
      <CategoryEffortFilter
        selectedCategories={[]}
        selectedEfforts={[]}
        onToggleCategory={onToggleCategory}
        onToggleEffort={onToggleEffort}
      />,
    );

    // Categories are displayed with underscores replaced by spaces
    expect(screen.getByRole('button', { name: 'architecture decisions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'exploration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'toil' })).toBeInTheDocument();
  });

  it('renders with selected categories marked as active', () => {
    const onToggleCategory = vi.fn();
    const onToggleEffort = vi.fn();

    const { container } = render(
      <CategoryEffortFilter
        selectedCategories={['architecture_decisions', 'exploration']}
        selectedEfforts={[]}
        onToggleCategory={onToggleCategory}
        onToggleEffort={onToggleEffort}
      />,
    );

    const activeButtons = container.querySelectorAll('button.active');
    expect(activeButtons.length).toBeGreaterThan(0);
  });

  it('renders with selected efforts', () => {
    const onToggleCategory = vi.fn();
    const onToggleEffort = vi.fn();

    const { container } = render(
      <CategoryEffortFilter
        selectedCategories={[]}
        selectedEfforts={['toil', 'overhead']}
        onToggleCategory={onToggleCategory}
        onToggleEffort={onToggleEffort}
      />,
    );

    const activeButtons = container.querySelectorAll('button.active');
    expect(activeButtons.length).toBeGreaterThan(0);
  });
});
