export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="Maggie Salmerón, asesora financiera">
      <span className="brand__mark">MS.</span>
      <span className="brand__copy">
        <strong>Maggie Salmerón</strong>
        <small>Asesora financiera</small>
      </span>
    </div>
  );
}
