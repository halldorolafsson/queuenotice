import { useEffect, useState } from "react";
import { api, type WatchList } from "../api/client";
import { roadsLabel, scheduleText } from "../format";

export function Lists() {
  const [lists, setLists] = useState<WatchList[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => setLists(await api.get<WatchList[]>("/lists"));
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const list = await api.post<WatchList>("/lists", { name });
      window.location.hash = `#/lister/${list.id}`;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggle(list: WatchList) {
    await api.patch(`/lists/${list.id}`, { active: !list.active });
    await load();
  }

  return (
    <>
      <h1>Overvåkingslister</h1>
      {error && <div className="banner error">{error}</div>}
      <form className="card row" onSubmit={create}>
        <input
          aria-label="Navn på ny liste"
          placeholder="F.eks. Til jobb"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit">Lag liste</button>
      </form>
      {lists?.map((l) => (
        <article key={l.id} className="card">
          <div className="row between">
            <h2>
              <a href={`#/lister/${l.id}`}>{l.name}</a>
            </h2>
            <label className="switch">
              <input type="checkbox" checked={l.active} onChange={() => toggle(l)} /> {l.active ? "Aktiv" : "Pauset"}
            </label>
          </div>
          <p className="muted small">{scheduleText(l.schedule)}</p>
          <ul className="plain small">
            {l.segments.map((s) => (
              <li key={s.id} className={s.active ? "" : "muted"}>
                {roadsLabel(s)} {s.startName} → {s.endName}
                {s.direction === "both" && " (begge retninger)"}
                {!s.active && " – pauset"}
              </li>
            ))}
            {l.segments.length === 0 && <li className="muted">Ingen strekninger ennå</li>}
          </ul>
        </article>
      ))}
    </>
  );
}
