import { config } from "../config.js";
import { fetchJson } from "./http.js";

/* Kartverkets åpne stedsnavn- og adressesøk (ingen nøkkel). */

export interface Place {
  name: string;
  description: string;
  lat: number;
  lon: number;
}

interface StedsnavnResponse {
  navn?: Array<{
    skrivemåte: string;
    navneobjekttype?: string;
    fylker?: Array<{ fylkesnummer: string }>;
    kommuner?: Array<{ kommunenavn: string }>;
    representasjonspunkt?: { nord: number; øst: number };
  }>;
}
interface AdresseResponse {
  adresser?: Array<{
    adressetekst: string;
    poststed?: string;
    kommunenavn?: string;
    representasjonspunkt?: { lat: number; lon: number };
  }>;
}

interface PunktResponse {
  navn?: Array<{
    meterFraPunkt: number;
    navneobjekttype?: string;
    stedsnavn?: Array<{ skrivemåte: string }>;
  }>;
}

/** Nærmeste stedsnavn innen 1 km, eller null. */
export async function nearestPlaceName(lat: number, lon: number): Promise<{ name: string; distanceM: number } | null> {
  const params = new URLSearchParams({
    nord: String(lat),
    ost: String(lon),
    koordsys: "4326",
    utkoordsys: "4326",
    radius: "1000",
    treffPerSide: "20",
  });
  const res = await fetchJson<PunktResponse>(`${config.GEONORGE_URL}/stedsnavn/v1/punkt?${params}`, {
    retries: 0,
    timeoutMs: 8000,
  });
  const best = (res.navn ?? [])
    .filter((n) => {
      const name = n.stedsnavn?.[0]?.skrivemåte;
      // Bygninger sier lite for en bilist, og hovedvegens eget navn hjelper ikke.
      return name && !/bolig|bygning|hytte|kulturdetalj/i.test(n.navneobjekttype ?? "") && !/^(europaveg|riksveg|fylkesveg)/i.test(name);
    })
    .sort((a, b) => a.meterFraPunkt - b.meterFraPunkt)[0];
  return best ? { name: best.stedsnavn![0]!.skrivemåte, distanceM: best.meterFraPunkt } : null;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const base = config.GEONORGE_URL;
  const [steder, adresser] = await Promise.allSettled([
    fetchJson<StedsnavnResponse>(
      `${base}/stedsnavn/v1/navn?${new URLSearchParams({ sok: q, fuzzy: "true", utkoordsys: "4326", treffPerSide: "8" })}`,
      { retries: 0, timeoutMs: 8000 },
    ),
    fetchJson<AdresseResponse>(
      `${base}/adresser/v1/sok?${new URLSearchParams({ sok: q, utkoordsys: "4326", treffPerSide: "4" })}`,
      { retries: 0, timeoutMs: 8000 },
    ),
  ]);
  const out: Place[] = [];
  if (steder.status === "fulfilled") {
    // Trøndelag (fylke 50) først, ellers i rekkefølgen Kartverket returnerer.
    const sorted = [...(steder.value.navn ?? [])].sort(
      (a, b) => Number(b.fylker?.some((f) => f.fylkesnummer === "50") ?? false) - Number(a.fylker?.some((f) => f.fylkesnummer === "50") ?? false),
    );
    for (const n of sorted) {
      if (!n.representasjonspunkt) continue;
      out.push({
        name: n.skrivemåte,
        description: [n.navneobjekttype, n.kommuner?.[0]?.kommunenavn].filter(Boolean).join(", "),
        lat: n.representasjonspunkt.nord,
        lon: n.representasjonspunkt.øst,
      });
    }
  }
  if (adresser.status === "fulfilled") {
    for (const a of adresser.value.adresser ?? []) {
      if (!a.representasjonspunkt) continue;
      out.push({
        name: a.adressetekst,
        description: ["Adresse", a.poststed ?? a.kommunenavn].filter(Boolean).join(", "),
        lat: a.representasjonspunkt.lat,
        lon: a.representasjonspunkt.lon,
      });
    }
  }
  if (out.length === 0 && steder.status === "rejected" && adresser.status === "rejected") {
    throw new Error("Stedssøk er utilgjengelig");
  }
  return out;
}
