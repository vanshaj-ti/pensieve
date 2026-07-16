import { useState } from 'react';
import { postLabel } from '../api';

interface Props {
  projectDir: string;
  sessionId: string;
  currentLabel: string;
  onSaved: () => void;
}

export function LabelEditor({ projectDir, sessionId, currentLabel, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLabel);

  if (!editing) {
    return (
      <button className="label-edit-btn" onClick={() => setEditing(true)}>
        edit label
      </button>
    );
  }

  const save = async () => {
    const newLabel = value.trim();
    if (!newLabel) return;
    try {
      await postLabel(projectDir, sessionId, currentLabel, newLabel);
      setEditing(false);
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save label');
    }
  };

  return (
    <span className="label-edit-form">
      <input
        type="text"
        value={value}
        placeholder="new label"
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={save}>save</button>
    </span>
  );
}
