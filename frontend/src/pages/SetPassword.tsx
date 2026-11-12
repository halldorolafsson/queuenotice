import { useEffect, useState } from "react";
import { api } from "../api/client";

/** Felles side for invitasjon (ny bruker) og lenke for nytt passord. */
export function SetPassword({ kind, token, onDone }: { kind: "invitation" | "reset"; token: string; onDone: () => void }) {
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (kind !== "invitation") return;
    api
      .post<{ email: string }>("/auth/invitation/check", { token })
      .then((r) => setEmail(r.email))
      .catch((e) => setMessage({ text: (e as Error).message, kind: "error" }));
  }, [kind, token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== repeat) {
      setMessage({ text: "Passordene er ikke like", kind: "error" });
      return;
    }
    try {
      if (kind === "invitation") {
        await api.post("/auth/invitation/accept", { token, password });
        window.location.hash = "#/";
        onDone();
      } else {
        await api.post("/auth/reset", { token, password });
        setDone(true);
        setMessage({ text: "Passordet er endret. Du kan nå logge inn.", kind: "info" });
      }
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "error" });
    }
  }

  return (
    <form className="card form auth" onSubmit={submit}>
      <h1>{kind === "invitation" ? "Velkommen til Køvarsel" : "Lag nytt passord"}</h1>
      {email && <p>Du er invitert som <strong>{email}</strong>. Velg et passord for å komme i gang.</p>}
      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}
      {done ? (
        <a className="button" href="#/" onClick={onDone}>
          Til innlogging
        </a>
      ) : (
        <>
          <label className="field">
            <span className="label">Nytt passord (minst 12 tegn)</span>
            <input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Gjenta passord</span>
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          </label>
          <p className="muted small">Tips: en setning med flere ord er både lett å huske og sterk.</p>
          <button type="submit">Lagre passord</button>
        </>
      )}
    </form>
  );
}
