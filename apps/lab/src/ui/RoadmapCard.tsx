/** Static and inert on purpose: no link, input or button, so nothing here can be activated. */
export function RoadmapCard() {
  return (
    <div className="roadmap" aria-disabled="true">
      <span className="tag">ROADMAP</span>
      <strong>Export to WikiLLM</strong>
      <p>Disabled. Library is local only.</p>
    </div>
  );
}
