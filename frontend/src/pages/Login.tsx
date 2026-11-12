import { useEffect, useState } from "react";
import { api } from "../api/client";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [canReset, setCanReset] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ canResetByEmail: boolean }>("/auth/config").then((c) => setCanReset(c.canResetByEmail)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "login") {
        await api.post("/auth/login", { email, password });
        onLoggedIn();
      } else {
        const r = await api.post<{ message: string }>("/auth/forgot", { email });
        setMessage({ text: r.message, kind: "info" });
      }
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form auth" onSubmit={submit}>
      <h1>{mode === "login" ? "Logg inn" : "Glemt passord"}</h1>
      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}
      <label className="field">
        <span className="label">E-post</span>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {mode === "login" && (
        <label className="field">
          <span className="label">Passord</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
      )}
      <button type="submit" disabled={busy}>
        {mode === "login" ? "Logg inn" : "Send lenke"}
      </button>
      <p className="small">
        {mode === "login" ? (
          <button type="button" className="link" onClick={() => setMode("forgot")}>
            Glemt passord?
          </button>
        ) : (
          <button type="button" className="link" onClick={() => setMode("login")}>
            Tilbake til innlogging
          </button>
        )}
      </p>
      {mode === "forgot" && !canReset && (
        <p className="muted small">E-post er ikke satt opp på serveren. Be administrator lage en lenke for nytt passord.</p>
      )}
      <p className="muted small">Ny bruker? Du trenger en invitasjon fra administrator.</p>
    </form>
  );
}
