import type { ProjectRollup as ProjectRollupType } from '../types';

interface Props {
  projects: ProjectRollupType[];
}

export function ProjectRollup({ projects }: Props) {
  if (projects.length <= 1) {
    return null;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Work Items</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <tr key={p.projectDir}>
            <td>{p.projectDir}</td>
            <td>{p.insightCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
