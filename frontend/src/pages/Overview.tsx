import { useCallback, useEffect, useState } from "react";
import { api, type Overview, type OverviewEvent, type OverviewSegment, type SegmentStatus } from "../api/client";
import { ago, roadsLabel, scheduleText, when } from "../format";

const STATUS: Record<SegmentStatus, { label: string; cls: string; hint?: string }> = {
  incident: { label: "Registrert hendelse", cls: "st-incident" },
  no_events: {
    label: "Ingen registrerte hendelser",
    cls: "st-ok",
    hint: "Kilden har ingen meldinger her. Det betyr ikke nødvendigvis fri flyt.",
  },
  stale: { label: "Utdaterte data", cls: "st-stale", hint: "Siste vellykkede henting er for gammel til å stole på." },
  error: { label: "Kildefeil", cls: "st-error", hint: "Klarte ikke å hente ferske data. Status er ukjent." },
  no_data: { label: "Ingen data ennå", cls: "st-stale", hint: "Venter på første henting fra kilden." },
  paused: { label: "Pauset", cls: "st-paused", hint: "Overvåking er slått av for denne strekningen eller listen." },
};

const DIRECTION_LABEL: Record<OverviewEvent["direction"], string> = {
  both: "begge retninger",
  same: "din kjøreretning",
  opposite: "motsatt kjøreretning",
  unknown: "retning ikke oppgitt",
};

function EventItem({ e }: { e: OverviewEvent }) {
  return (
    <li className={`event cat-${e.category} ${e.relevant ? "" : "dim"}`}>
      <div className="event-head">
        <strong>{e.categoryLabel}</strong>
        {e.isDemo && <span className="tag demo">DEMO</span>}
        <span className="muted"> · {DIRECTION_LABEL[e.direction]}</span>
      </div>
      <div>{e.title}</div>
      {e.description.length > 0 && <div className="muted small">{e.description.join(" ")}</div>}
      {e.reportedDelayMin !== null && (
        <div className="small">Oppgitt forsinkelse: ca. {e.reportedDelayMin} min (estimat fra kilden)</div>
      )}
      <div className="muted small">
        {e.nextStart ? `Neste periode: ${when(e.nextStart)}` : e.endTime ? `Til ${when(e.endTime)}` : "Inntil videre"}
        {" · "}
        {e.sourceName}, oppdatert {when(e.updatedAt)}
        {e.alsoReportedBy.length > 0 && ` · også meldt av ${e.alsoReportedBy.join(", ")}`}
      </div>
    </li>
  );
}

function SegmentCard({ s }: { s: OverviewSegment }) {
  const st = STATUS[s.status];
  const delayed = s.travelTimes.filter((t) => t.fresh && t.delayMin !== null && t.delayMin > 0);
  const followed = s.events.filter((e) => e.followed);
  const plannedFollowed = s.plannedEvents.filter((e) => e.followed);
  const others = [...s.events, ...s.plannedEvents].filter((e) => !e.followed);
  const hint =
    s.status === "no_events" && others.length > 0
      ? "Ingen meldinger av typene du følger. Det betyr ikke nødvendigvis fri flyt."
      : st.hint;
  return (
    <article className={`card segment ${st.cls}`}>
      <header>
        <h3>
          {roadsLabel(s)} {s.name}
        </h3>
        <div className="muted small">
          {s.direction === "both" ? "Begge retninger" : `Kjøreretning mot ${s.endName}`}
          {!s.inWindow && s.status !== "paused" && " · utenfor overvåkingstid"}
        </div>
      </header>
      <div className={`status ${st.cls}`}>
        <span className="dot" aria-hidden="true" />
        {st.label}
        {s.usesDemoData && <span className="tag demo">DEMO</span>}
      </div>
      {hint && <p className="muted small">{hint}</p>}

      {s.measuredDelayMin !== null && (
        <p className="delay">
          {s.measuredDelayMin > 0 ? (
            <>
              Målt forsinkelse: <strong>+{s.measuredDelayMin} min</strong>
            </>
          ) : (
            "Målt reisetid er normal"
          )}
          <span className="muted small">
            {s.measuredDelayIsDemo ? " (inkluderer DEMO-eksempeldata)" : " (Statens vegvesens reisetidsmåling)"}
          </span>
        </p>
      )}

      {s.estimatedDelayMin !== null && (
        <p className="delay google">
          {s.estimatedDelayMin > 0 ? (
            <>
              Estimert forsinkelse: <strong>+{s.estimatedDelayMin} min</strong>
            </>
          ) : (
            "Estimert reisetid er normal"
          )}
          <span className="gmp-attribution" translate="no">
            Google Maps
          </span>
        </p>
      )}

      {followed.length > 0 && (
        <ul className="events">
          {followed.map((e) => (
            <EventItem key={e.id} e={e} />
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <details>
          <summary>Andre meldinger (varsles ikke) · {others.length}</summary>
          <p className="muted small">Typer du ikke har valgt under Varsler → Hva skal varsles.</p>
          <ul className="events">
            {others.map((e) => (
              <EventItem key={e.id} e={e} />
            ))}
          </ul>
        </details>
      )}

      {(s.travelTimes.length > 0 || plannedFollowed.length > 0) && (
        <details>
          <summary>
            Detaljer
            {delayed.length > 0 && ` · ${delayed.length} strekning(er) med forsinkelse`}
            {plannedFollowed.length > 0 && ` · ${plannedFollowed.length} planlagt`}
          </summary>
          {s.travelTimes.length > 0 && (
            <>
              <h4>Reisetider</h4>
              <ul className="plain small">
                {s.travelTimes.map((t) => (
                  <li key={t.id}>
                    {t.name}
                    {t.direction === "opposite" && " (motsatt retning)"}:{" "}
                    {t.statusValue === "off_route" ? (
                      <span className="warn">Google foreslo en annen rute (kan skyldes stengning eller omkjøring)</span>
                    ) : t.actualMin === null || !t.fresh ? (
                      <span className="muted">mangler ferske målinger</span>
                    ) : (
                      <>
                        {t.actualMin} min (normalt {t.expectedMin} min)
                        {t.delayMin !== null && t.delayMin > 0 && <strong> +{t.delayMin} min</strong>}
                      </>
                    )}
                    {t.isDemo && <span className="tag demo">DEMO</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {plannedFollowed.length > 0 && (
            <>
              <h4>Planlagt (ikke aktivt nå)</h4>
              <ul className="events">
                {plannedFollowed.map((e) => (
                  <EventItem key={e.id} e={e} />
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      {s.geometrySource === "straight" && s.geometryNote && <p className="warn small">{s.geometryNote}</p>}
    </article>
  );
}

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Overview>("/overview"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function pollNow() {
    setPolling(true);
    try {
      await api.post("/poll");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPolling(false);
    }
  }

  if (!data) return <p>{error ?? "Laster …"}</p>;
  const demo = data.sources.some((s) => s.isDemo && !s.disabledByUser);

  return (
    <>
      {demo && (
        <div className="banner demo">
          <strong>Demomodus:</strong> noen data er eksempeldata og ikke sanntid. De er merket DEMO.
        </div>
      )}
      {data.notifyMode === "dry-run" && (
        <div className="banner info">Varsler sendes ikke (testmodus). De vises bare i loggen under Varsler.</div>
      )}
      {error && <div className="banner error">{error}</div>}

      <section className="card sources">
        <div className="row between">
          <h2>Datakilder</h2>
          <button onClick={pollNow} disabled={polling}>
            {polling ? "Henter …" : "Oppdater nå"}
          </button>
        </div>
        <ul className="plain">
          {data.sources.map((s) => (
            <li key={s.id} className={`src fr-${s.disabledByUser ? "off" : s.freshness}`}>
              <span className="dot" aria-hidden="true" />
              <strong>{s.name}</strong>{" "}
              {s.disabledByUser ? (
                <span className="muted">Slått av av deg (endres under Varsler)</span>
              ) : (
                <>
                  {s.freshness === "fresh" && <>OK – oppdatert {ago(s.lastSuccessAt)}</>}
                  {s.freshness === "stale" && <>Utdatert – sist vellykket {ago(s.lastSuccessAt)}</>}
                  {s.freshness === "error" && (
                    <>
                      Feil ({s.consecutiveFailures} forsøk) – sist vellykket {ago(s.lastSuccessAt)}
                      <div className="muted small">{s.lastError}</div>
                    </>
                  )}
                  {s.freshness === "never" && <>Ikke hentet ennå</>}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {data.lists.length === 0 && (
        <section className="card">
          <p>Du har ingen overvåkingslister ennå.</p>
          <a className="button" href="#/lister">Lag din første liste</a>
        </section>
      )}

      {data.lists.map((list) => (
        <section key={list.id} className="list-block">
          <div className="row between">
            <h2>
              {list.name} {!list.active && <span className="tag">Pauset</span>}
            </h2>
            <a href={`#/lister/${list.id}`} className="small">Rediger</a>
          </div>
          <p className="muted small">{scheduleText(list.schedule)}</p>
          {list.segments.length === 0 && <p className="muted">Ingen strekninger i listen.</p>}
          {list.segments.map((s) => (
            <SegmentCard key={s.id} s={s} />
          ))}
        </section>
      ))}
      <p className="muted small attribution">
        Inneholder data under Norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen.
      </p>
    </>
  );
}
