import { useEffect, useState } from "react";
import { api, CATEGORY_LABELS, type Category, type NotificationLogEntry, type NotificationSettings } from "../api/client";
import { when } from "../format";
import { disablePushOnThisDevice, enablePushOnThisDevice, pushSupport } from "../push";

const STATUS_LABEL: Record<NotificationLogEntry["status"], string> = {
  dry_run: "Ikke sendt (testmodus)",
  sent: "Sendt",
  failed: "Feilet",
  skipped: "Hoppet over",
};
const CHANNEL_LABEL: Record<NotificationLogEntry["channel"], string> = { push: "Push", email: "E-post", none: "Ingen kanal" };

export function SettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [devices, setDevices] = useState(0);
  const [mode, setMode] = useState<"dry-run" | "live">("dry-run");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [sources, setSources] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" | "warn" } | null>(null);
  const support = pushSupport();

  async function load() {
    const s = await api.get<{
      settings: NotificationSettings;
      pushDevices: number;
      notifyMode: "dry-run" | "live";
      sources: Array<{ id: string; name: string; description: string }>;
    }>("/settings");
    setSettings(s.settings);
    setSources(s.sources);
    setDevices(s.pushDevices);
    setMode(s.notifyMode);
    setPublicKey((await api.get<{ publicKey: string | null }>("/push/config")).publicKey);
    setLog(await api.get<NotificationLogEntry[]>("/notifications"));
  }
  useEffect(() => {
    load().catch((e) => setMessage({ text: (e as Error).message, kind: "error" }));
  }, []);

  if (!settings) return <p>{message?.text ?? "Laster …"}</p>;
  const set = (patch: Partial<NotificationSettings>) => setSettings({ ...settings, ...patch });
  const toggleType = (c: Category) =>
    set({ eventTypes: settings.eventTypes.includes(c) ? settings.eventTypes.filter((x) => x !== c) : [...settings.eventTypes, c] });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.put("/settings", { ...settings, email: settings!.email?.trim() || null });
      setMessage({ text: "Innstillingene er lagret", kind: "info" });
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "error" });
    }
  }

  async function enablePush() {
    try {
      if (!publicKey) throw new Error("Serveren mangler VAPID-nøkler, så push kan ikke aktiveres ennå.");
      await enablePushOnThisDevice(publicKey);
      set({ pushEnabled: true });
      await api.put("/settings", { ...settings, pushEnabled: true });
      setMessage({ text: "Push er aktivert på denne enheten", kind: "info" });
      await load();
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "error" });
    }
  }

  async function test() {
    try {
      const r = await api.post<{ result: NotificationLogEntry }>("/notifications/test");
      setMessage({ text: `Testvarsel: ${STATUS_LABEL[r.result.status]}${r.result.error ? ` – ${r.result.error}` : ""}`, kind: "info" });
      await load();
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "error" });
    }
  }

  return (
    <>
      <h1>Varsler</h1>
      {mode === "dry-run" && (
        <div className="banner info">
          Serveren er i testmodus: varsler lagres i loggen nedenfor, men sendes ikke som push eller e-post.
        </div>
      )}
      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <form className="card form" onSubmit={save}>
        <h2>Kanaler</h2>
        <label>
          <input type="checkbox" checked={settings.pushEnabled} onChange={(e) => set({ pushEnabled: e.target.checked })} /> Push-varsel
        </label>
        <div className="indent small">
          {support.supported ? (
            <>
              <span className="muted">{devices} enhet(er) registrert. </span>
              <button type="button" className="secondary" onClick={enablePush}>
                Aktiver på denne enheten
              </button>{" "}
              <button
                type="button"
                className="link"
                onClick={async () => {
                  await disablePushOnThisDevice();
                  await load();
                }}
              >
                Fjern denne enheten
              </button>
            </>
          ) : (
            <span className="warn">{support.reason}</span>
          )}
        </div>
        <label>
          <input type="checkbox" checked={settings.emailEnabled} onChange={(e) => set({ emailEnabled: e.target.checked })} /> E-post
        </label>
        <input
          type="email"
          className="indent"
          placeholder="din@epost.no"
          value={settings.email ?? ""}
          onChange={(e) => set({ email: e.target.value })}
          aria-label="E-postadresse"
        />

        <h2>Datakilder</h2>
        <p className="muted small">Velg hvilke kilder som skal brukes for dine strekninger, både i oversikten og i varsler.</p>
        {sources.map((src) => {
          const on = !settings.disabledSources.includes(src.id);
          return (
            <label key={src.id} className="source-option">
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  set({
                    disabledSources: on
                      ? [...settings.disabledSources, src.id]
                      : settings.disabledSources.filter((x) => x !== src.id),
                  })
                }
              />{" "}
              <strong translate={src.id === "google" ? "no" : undefined}>{src.name}</strong>
              <span className="muted small block">{src.description}</span>
            </label>
          );
        })}
        {sources.length > 0 && sources.every((src) => settings.disabledSources.includes(src.id)) && (
          <p className="warn small">Minst én kilde må være på.</p>
        )}

        <h2>Hva skal varsles?</h2>
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
          <label key={c}>
            <input type="checkbox" checked={settings.eventTypes.includes(c)} onChange={() => toggleType(c)} /> {CATEGORY_LABELS[c]}
          </label>
        ))}

        <label className="field">
          <span className="label">Forsinkelsesterskel (minutter)</span>
          <input
            type="number"
            min={1}
            max={180}
            value={settings.delayThresholdMin}
            onChange={(e) => set({ delayThresholdMin: Number(e.target.value) })}
          />
          <span className="muted small">
            Brukes når kilden oppgir eller måler forsinkelse. Stengt veg varsles alltid. Meldinger uten forsinkelse varsles etter type.
          </span>
        </label>
        <label>
          <input type="checkbox" checked={settings.notifyOnResolved} onChange={(e) => set({ notifyOnResolved: e.target.checked })} /> Gi
          beskjed når en varslet hendelse er over
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.includeUnknownDirection}
            onChange={(e) => set({ includeUnknownDirection: e.target.checked })}
          />{" "}
          Varsle også når kilden ikke oppgir kjøreretning
        </label>
        <div className="row">
          <button type="submit">Lagre</button>
          <button type="button" className="secondary" onClick={test}>
            Send testvarsel
          </button>
        </div>
      </form>

      <h2>Varslingslogg</h2>
      {log.length === 0 && <p className="muted">Ingen varsler ennå.</p>}
      <ul className="plain log">
        {log.map((n) => (
          <li key={n.id} className="card">
            <div className="row between small">
              <span>{when(n.createdAt)}</span>
              <span className={`tag st-${n.status}`}>
                {CHANNEL_LABEL[n.channel]}: {STATUS_LABEL[n.status]}
              </span>
            </div>
            <strong>{n.title}</strong>
            <pre className="body">{n.body}</pre>
            {n.error && <div className="muted small">{n.error}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
