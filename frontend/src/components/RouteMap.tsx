import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { api, type Place } from "../api/client";

type End = "start" | "end";

const TRONDHEIM: L.LatLngTuple = [63.43, 10.39];

function pinIcon(which: End) {
  return L.divIcon({
    className: `pin pin-${which}`,
    html: which === "start" ? "A" : "B",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Kart der start (A) og slutt (B) settes med klikk/trykk og kan dras. */
export default function RouteMap({
  start,
  end,
  geometry,
  onPick,
}: {
  start: Place | null;
  end: Place | null;
  geometry: [number, number][] | null;
  onPick: (which: End, place: Place) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Partial<Record<End, L.Marker>>>({});
  const line = useRef<L.Polyline | null>(null);
  const [target, setTarget] = useState<End>(start ? "end" : "start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaflet-hendelser lever lenger enn én render; les alltid ferske verdier via ref.
  const latest = useRef({ target, onPick, start, end });
  latest.current = { target, onPick, start, end };

  async function pick(which: End, lat: number, lon: number) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6) });
      const place = await api.get<Place>(`/places/at?${params}`);
      latest.current.onPick(which, place);
      if (which === "start" && !latest.current.end) setTarget("end");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: TRONDHEIM, zoom: 9 });
    L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => void pick(latest.current.target, e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current = {};
      line.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const [which, place] of [
      ["start", start],
      ["end", end],
    ] as const) {
      const existing = markers.current[which];
      if (!place) {
        existing?.remove();
        delete markers.current[which];
        continue;
      }
      if (existing) {
        existing.setLatLng([place.lat, place.lon]);
      } else {
        const mk = L.marker([place.lat, place.lon], { icon: pinIcon(which), draggable: true, keyboard: false }).addTo(m);
        mk.on("dragend", () => {
          const p = mk.getLatLng();
          void pick(which, p.lat, p.lng);
        });
        markers.current[which] = mk;
      }
    }
    if (!geometry?.length) {
      const pts = [start, end].filter((p): p is Place => p !== null).map((p) => L.latLng(p.lat, p.lon));
      if (pts.length === 2) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 });
      else if (pts.length === 1 && !m.getBounds().contains(pts[0]!)) m.panTo(pts[0]!);
    }
  }, [start?.lat, start?.lon, end?.lat, end?.lon]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    line.current?.remove();
    line.current = null;
    if (geometry && geometry.length >= 2) {
      line.current = L.polyline(
        geometry.map(([lon, lat]) => [lat, lon] as L.LatLngTuple),
        { color: "#1d3557", weight: 5, opacity: 0.8 },
      ).addTo(m);
      m.fitBounds(line.current.getBounds(), { padding: [30, 30], maxZoom: 15 });
    }
  }, [geometry]);

  return (
    <div className="field">
      <div className="row between">
        <span className="label">Kart</span>
        <div className="row segmented" role="group" aria-label="Hva neste trykk i kartet setter">
          <button type="button" className={target === "start" ? "on" : "secondary"} onClick={() => setTarget("start")}>
            Sett start (A)
          </button>
          <button type="button" className={target === "end" ? "on" : "secondary"} onClick={() => setTarget("end")}>
            Sett slutt (B)
          </button>
        </div>
      </div>
      <div ref={el} className="map" />
      <div className="muted small">
        {busy
          ? "Finner stedet …"
          : `Trykk i kartet for å sette ${target === "start" ? "start (A)" : "slutt (B)"}. Markørene kan dras.`}
      </div>
      {error && <div className="warn small">{error}</div>}
    </div>
  );
}
