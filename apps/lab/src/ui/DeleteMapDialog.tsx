import { useEffect, useRef, useState } from "react";

export function DeleteMapDialog({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel(): void; onConfirm(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typedName, setTypedName] = useState("");
  const matches = typedName === name;
  useEffect(() => { if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal(); }, []);
  return <dialog ref={dialogRef} className="delete-map-dialog" aria-labelledby="delete-map-title" aria-describedby="delete-map-warning" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <form aria-label="Confirm map deletion" onSubmit={(event) => { event.preventDefault(); if (matches && !busy) onConfirm(); }}>
      <h2 id="delete-map-title">Delete map?</h2>
      <p id="delete-map-warning">This removes <strong>{name}</strong> and its saved polygon from Saved maps.</p>
      <label>Type map name to confirm<input autoFocus value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="off" spellCheck={false} placeholder={name} /></label>
      <p className="hint">Enter <strong>{name}</strong> exactly to enable Delete.</p>
      <div className="delete-map-actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn primary" disabled={!matches || busy}>Delete map</button></div>
    </form>
  </dialog>;
}
