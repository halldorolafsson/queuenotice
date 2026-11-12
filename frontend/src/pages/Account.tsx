import { useEffect, useState } from "react";
import { api } from "../api/client";
import { when } from "../format";

interface AdminUser {
  id: string;
  email: string;
  isAdmin: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
}
interface Invitation {
  id: string;
  email: string;
  isAdmin: boolean;
  expiresAt: string;
}

function CopyLink({ link, expiresAt }: { link: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="banner info">
      <p className="small">Del lenken privat (f.eks. SMS). Den virker én gang og utløper {when(expiresAt)}.</p>
      <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Lenke" style={{ width: "100%" }} />
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? "Kopiert" : "Kopier lenke"}
      </button>
    </div>
  );
}

function AdminSection({ myEmail }: { myEmail: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [link, setLink] = useState<{ link: string; expiresAt: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await api.get<{ users: AdminUser[]; invitations: Invitation[] }>("/admin/users");
    setUsers(r.users);
    setInvitations(r.invitations);
  }
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card">
      <h2>Brukere (administrator)</h2>
      {error && <div className="banner error">{error}</div>}
      {link && (
        <>
          <p className="small">{link.label}</p>
          <CopyLink link={link.link} expiresAt={link.expiresAt} />
        </>
      )}
      <ul className="plain">
        {users.map((u) => (
          <li key={u.id} className="row between user-row">
            <span>
              {u.email}
              {u.isAdmin && <span className="tag">admin</span>}
              {!u.hasPassword && <span className="tag">uten passord</span>}
              <div className="muted small">Sist innlogget: {u.lastLoginAt ? when(u.lastLoginAt) : "aldri"}</div>
            </span>
            {u.email !== myEmail && (
              <span className="row">
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    run(async () => {
                      const r = await api.post<{ link: string; expiresAt: string }>(`/admin/users/${u.id}/reset-link`);
                      setLink({ ...r, label: `Lenke for nytt passord til ${u.email}:` });
                    })
                  }
                >
                  Lenke for nytt passord
                </button>
                <button type="button" className="link" onClick={() => run(() => api.patch(`/admin/users/${u.id}`, { isAdmin: !u.isAdmin }))}>
                  {u.isAdmin ? "Fjern admin" : "Gjør til admin"}
                </button>
                <button
                  type="button"
                  className="link danger"
                  onClick={() => confirm(`Slette ${u.email} med alle lister og innstillinger?`) && run(() => api.del(`/admin/users/${u.id}`))}
                >
                  Slett
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {invitations.length > 0 && (
        <>
          <h3>Ventende invitasjoner</h3>
          <ul className="plain small">
            {invitations.map((i) => (
              <li key={i.id} className="row between">
                <span>
                  {i.email} {i.isAdmin && <span className="tag">admin</span>} – utløper {when(i.expiresAt)}
                </span>
                <button type="button" className="link danger" onClick={() => run(() => api.del(`/admin/invitations/${i.id}`))}>
                  Trekk tilbake
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api.post<{ link: string; expiresAt: string }>("/admin/invitations", { email, isAdmin });
            setLink({ ...r, label: `Invitasjon til ${email}:` });
            setEmail("");
            setIsAdmin(false);
          });
        }}
      >
        <h3>Inviter ny bruker</h3>
        <div className="row">
          <input type="email" placeholder="e-post" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="E-post" />
          <button type="submit">Lag invitasjon</button>
        </div>
        <label>
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Administrator
        </label>
      </form>
    </section>
  );
}

export function Account({ me, onLoggedOut }: { me: { email: string; isAdmin: boolean; authMode: string }; onLoggedOut: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setMessage({ text: "De nye passordene er ikke like", kind: "error" });
    try {
      await api.post("/account/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      setMessage({ text: "Passordet er endret. Andre enheter er logget ut.", kind: "info" });
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "error" });
    }
  }

  async function logout(all: boolean) {
    await api.post(all ? "/account/logout-all" : "/auth/logout");
    onLoggedOut();
  }

  return (
    <>
      <h1>Konto</h1>
      <section className="card">
        <p>
          Innlogget som <strong>{me.email}</strong>
          {me.isAdmin && <span className="tag">admin</span>}
        </p>
        {me.authMode === "password" && (
          <div className="row">
            <button type="button" className="secondary" onClick={() => logout(false)}>
              Logg ut
            </button>
            <button type="button" className="link" onClick={() => logout(true)}>
              Logg ut på alle enheter
            </button>
          </div>
        )}
      </section>

      {me.authMode === "password" && (
        <form className="card form" onSubmit={changePassword}>
          <h2>Endre passord</h2>
          {message && <div className={`banner ${message.kind}`}>{message.text}</div>}
          <label className="field">
            <span className="label">Nåværende passord</span>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Nytt passord (minst 12 tegn)</span>
            <input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Gjenta nytt passord</span>
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          </label>
          <button type="submit">Endre passord</button>
        </form>
      )}

      {me.isAdmin && <AdminSection myEmail={me.email} />}
    </>
  );
}
