import { useEffect, useState } from "react";
import { api, type ScheduleRule, type SegmentSummary, type WatchList } from "../api/client";
import { ScheduleEditor } from "../components/ScheduleEditor";
import { SegmentForm } from "../components/SegmentForm";
import { roadsLabel } from "../format";

export function ListDetail({ id }: { id: string }) {
  const [list, setList] = useState<WatchList | null>(null);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState<ScheduleRule[]>([]);
  const [editing, setEditing] = useState<SegmentSummary | "new" | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" | "warn" } | null>(null);

  async function load() {
    const lists = await api.get<WatchList[]>("/lists");
    const l = lists.find((x) => x.id === id) ?? null;
    setList(l);
    if (l) {
      setName(l.name);
      setSchedule(l.schedule);
    }
  }
  useEffect(() => {
    load().catch((e) => setMessage({ text: (e as Error).message, kind: "error" }));
  }, [id]);

  if (!list) return <p>{message?.text ?? "Laster …"}</p>;

  async function saveList(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.patch(`/lists/${id}`, { name, schedule });
      setMessage({ text: "Lagret", kind: "info" });
      await load();
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "error" });
    }
  }

  async function removeList() {
    if (!confirm(`Slette listen «${list!.name}» med alle strekninger?`)) return;
    await api.del(`/lists/${id}`);
    window.location.hash = "#/lister";
  }

  async function toggleSegment(s: SegmentSummary) {
    await api.patch(`/segments/${s.id}`, { active: !s.active });
    await load();
  }

  async function removeSegment(s: SegmentSummary) {
    if (!confirm(`Slette strekningen «${s.name}»?`)) return;
    await api.del(`/segments/${s.id}`);
    await load();
  }

  return (
    <>
      <p>
        <a href="#/lister">← Alle lister</a>
      </p>
      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <form className="card form" onSubmit={saveList}>
        <label className="field">
          <span className="label">Navn på listen</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <div className="field">
          <span className="label">Når skal listen overvåkes?</span>
          <ScheduleEditor value={schedule} onChange={setSchedule} />
        </div>
        <div className="row between">
          <button type="submit">Lagre liste</button>
          <label className="switch">
            <input
              type="checkbox"
              checked={list.active}
              onChange={async () => {
                await api.patch(`/lists/${id}`, { active: !list.active });
                await load();
              }}
            />{" "}
            {list.active ? "Aktiv" : "Pauset"}
          </label>
        </div>
      </form>

      <h2>Strekninger</h2>
      {list.segments.map((s) => (
        <article key={s.id} className="card">
          <div className="row between">
            <strong>
              {roadsLabel(s)} {s.name}
            </strong>
            <label className="switch">
              <input type="checkbox" checked={s.active} onChange={() => toggleSegment(s)} /> {s.active ? "Aktiv" : "Pauset"}
            </label>
          </div>
          <div className="muted small">
            {s.startName} → {s.endName} · {s.direction === "both" ? "begge retninger" : "én retning"} · {s.bufferM} m korridor ·{" "}
            {s.geometrySource === "nvdb" ? "vegens geometri fra NVDB" : "rett linje (omtrentlig)"}
          </div>
          {s.geometryNote && <p className="warn small">{s.geometryNote}</p>}
          <div className="row">
            <button type="button" className="secondary" onClick={() => setEditing(s)}>
              Endre
            </button>
            <button type="button" className="link danger" onClick={() => removeSegment(s)}>
              Slett
            </button>
          </div>
        </article>
      ))}

      {editing ? (
        <SegmentForm
          listId={id}
          segment={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null);
            setMessage(
              saved.geometryNote
                ? { text: saved.geometryNote, kind: "warn" }
                : { text: "Strekningen er lagret med vegens geometri fra NVDB.", kind: "info" },
            );
            await load();
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditing("new")}>
          Legg til strekning
        </button>
      )}

      <hr />
      <button type="button" className="link danger" onClick={removeList}>
        Slett liste
      </button>
    </>
  );
}
