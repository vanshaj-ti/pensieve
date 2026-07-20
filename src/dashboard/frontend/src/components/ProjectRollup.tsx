import { useState } from 'react';
import type { ProjectEffortBreakdown } from '../types';

interface Props {
  projects: ProjectEffortBreakdown[];
}

type SortKey = 'total' | 'toil' | 'toilRatio';

export function ProjectRollup({ projects }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('toil');

  if (projects.length <= 1) {
    return null;
  }

  const sorted = [...projects].sort((a, b) => b[sortKey] - a[sortKey]);

  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`sort-toggle ${sortKey === key ? 'active' : ''}`}
      onClick={() => setSortKey(key)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="sort-controls">
        Sort by: {sortButton('toil', 'Toil count')} {sortButton('toilRatio', 'Toil %')}{' '}
        {sortButton('total', 'Work items')}
      </div>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Work Items</th>
            <th>Toil</th>
            <th>Judgment</th>
            <th>Overhead</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.projectDir}>
              <td>{p.projectDir}</td>
              <td>{p.total}</td>
              <td className="badge-effort toil">{Math.round(p.toilRatio * 100)}%</td>
              <td className="badge-effort judgment">{Math.round(p.judgmentRatio * 100)}%</td>
              <td className="badge-effort overhead">{Math.round(p.overheadRatio * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
