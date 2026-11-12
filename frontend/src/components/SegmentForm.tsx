import { lazy, Suspense, useEffect, useState } from "react";
import { api, type Place, type RoutePreview, type SegmentSummary } from "../api/client";
import { roadLabel } from "../format";
import { PlacePicker } from "./PlacePicker";

const RouteMap = lazy(() => import("./RouteMap"));

export function SegmentForm({
  listId,
  segment,
  onSaved,
  onCancel,
}: {
  listId: string;
  segment?: SegmentSummary;
  onSaved: (s: SegmentSummary) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState<Place | null>(
    segment ? { name: segment.startName, lat: segment.startLat, lon: segment.startLon } : null,
  );
  const [end, setEnd] = useState<Place | null>(segment ? { name: segment.endName, lat: segment.endLat, lon: segment.endLon } : null);
  const [direction, setDirection] = useState<"forward" | "both">(segment?.direction ?? "forward");
  const [bufferM, setBufferM] = useState(segment?.bufferM ?? 300);
  const [name, setName] = useState(segment?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!start || !end) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const p = await api.post<RoutePreview>("/segments/preview", {
          start: { lat: start.lat, lon: start.lon },
          end: { lat: end.lat, lon: end.lon },
        });
        if (!cancelled) setPreview(p);
      } catch (err) {
        if (!cancelled) setPreviewError((err as Error).message);
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setPreviewBusy(false);
    };
  }, [start?.lat, start?.lon, end?.lat, end?.lon]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) {
      setError("Velg både start og slutt");
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim() || undefined,
      start: { name: start.name, lat: start.lat, lon: start.lon },
      end: { name: end.name, lat: end.lat, lon: end.lon },
      direction,
      bufferM,
      active: segment?.active ?? true,
    };
    try {
      const saved = segment
        ? await api.put<SegmentSummary>(`/segments/${segment.id}`, body)
        : await api.post<SegmentSummary>(`/lists/${listId}/segments`, body);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>{segment ? "Endre strekning" : "Ny strekning"}</h3>
      <Suspense fallback={<div className="map" />}>
        <RouteMap
          start={start}
          end={end}
          geometry={preview && preview.source === "nvdb" ? preview.geometry : null}
          onPick={(which, p) => (which === "start" ? setStart(p) : setEnd(p))}
        />
      </Suspense>
      {previewBusy && <p className="muted small">Finner vegen mellom A og B …</p>}
      {preview?.source === "nvdb" && (
        <p className="small">
          Den blå linjen er strekningen som overvåkes
          {preview.roads.length > 0 && <> (følger {preview.roads.map(roadLabel).join(", ")})</>}.
        </p>
      )}
      {preview?.note && <p className="warn small">{preview.note}</p>}
      {previewError && <p className="warn small">{previewError}</p>}
      <PlacePicker label="Start (A)" value={start} onChange={setStart} />
      <PlacePicker label="Slutt (B)" value={end} onChange={setEnd} />
      <p className="muted small">
        Ruten følger europa-, riks- og fylkesveger. Velger den en annen veg enn du kjører, flytt A eller B, eller del
        strekningen i to.
      </p>
      <fieldset className="field">
        <legend className="label">Kjøreretning</legend>
        <label>
          <input type="radio" checked={direction === "forward"} onChange={() => setDirection("forward")} /> Bare fra start mot slutt
        </label>
        <label>
          <input type="radio" checked={direction === "both"} onChange={() => setDirection("both")} /> Begge retninger
        </label>
      </fieldset>
      <label className="field">
        <span className="label">Hvor nær vegen en melding må være</span>
        <select value={bufferM} onChange={(e) => setBufferM(Number(e.target.value))}>
          <option value={100}>100 m (streng)</option>
          <option value={300}>300 m (anbefalt)</option>
          <option value={600}>600 m</option>
          <option value={1000}>1 km (romslig)</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Navn (valgfritt)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Lages automatisk" />
      </label>
      {error && <div className="banner error">{error}</div>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Finner vegen …" : "Lagre"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </form>
  );
}
