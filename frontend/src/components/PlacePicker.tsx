import { useState } from "react";
import { api, type Place } from "../api/client";

/** Søk i Kartverkets stedsnavn og adresser via serveren. */
export function PlacePicker({ label, value, onChange }: { label: string; value: Place | null; onChange: (p: Place | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<Place[]>(`/places?q=${encodeURIComponent(query.trim())}`);
      setResults(r);
      if (r.length === 0) setError("Ingen treff");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="field">
        <span className="label">{label}</span>
        <div className="row between chosen">
          <span>
            {value.name}{" "}
            <span className={value.onRoad === false ? "warn small" : "muted small"}>{value.description}</span>
          </span>
          <button type="button" className="link" onClick={() => onChange(null)}>
            Endre
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row">
        <input
          value={query}
          placeholder="Sted, kryss eller adresse"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" onClick={search} disabled={busy}>
          {busy ? "…" : "Søk"}
        </button>
      </div>
      {error && <div className="muted small">{error}</div>}
      {results.length > 0 && (
        <ul className="choices">
          {results.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <button
                type="button"
                className="choice"
                onClick={() => {
                  onChange(p);
                  setResults([]);
                }}
              >
                {p.name} <span className="muted small">{p.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
