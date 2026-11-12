import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import { About } from "./pages/About";
import { Account } from "./pages/Account";
import { ListDetail } from "./pages/ListDetail";
import { Lists } from "./pages/Lists";
import { Login } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { SetPassword } from "./pages/SetPassword";
import { SettingsPage } from "./pages/Settings";

interface Me {
  email: string;
  isAdmin: boolean;
  authMode: string;
}

/** Minimal ruter basert på #-adresser, så serveren bare trenger å levere index.html. */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

const NAV = [
  { href: "#/", label: "Oversikt", match: (r: string) => r === "/" },
  { href: "#/lister", label: "Lister", match: (r: string) => r.startsWith("/lister") },
  { href: "#/varsler", label: "Varsler", match: (r: string) => r.startsWith("/varsler") },
  { href: "#/konto", label: "Konto", match: (r: string) => r.startsWith("/konto") || r.startsWith("/om") },
];

export function App() {
  const route = useHashRoute();
  // undefined = laster, null = ikke innlogget
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/me"));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    const onUnauthorized = () => setMe(null);
    window.addEventListener("kv:unauthorized", onUnauthorized);
    return () => window.removeEventListener("kv:unauthorized", onUnauthorized);
  }, [loadMe]);

  const invitation = route.match(/^\/invitasjon\/([A-Za-z0-9_-]{20,100})$/);
  const reset = route.match(/^\/tilbakestill\/([A-Za-z0-9_-]{20,100})$/);
  const listMatch = route.match(/^\/lister\/([0-9a-f-]{36})$/);

  let page;
  if (invitation) page = <SetPassword kind="invitation" token={invitation[1]!} onDone={loadMe} />;
  else if (reset) page = <SetPassword kind="reset" token={reset[1]!} onDone={() => setMe(null)} />;
  else if (me === undefined) page = <p>Laster …</p>;
  else if (me === null) page = <Login onLoggedIn={loadMe} />;
  else if (listMatch) page = <ListDetail id={listMatch[1]!} />;
  else if (route.startsWith("/lister")) page = <Lists />;
  else if (route.startsWith("/varsler")) page = <SettingsPage />;
  else if (route.startsWith("/om")) page = <About />;
  else if (route.startsWith("/konto"))
    page = (
      <>
        <Account me={me} onLoggedOut={() => setMe(null)} />
        <p>
          <a href="#/om">Om data og varsler</a>
        </p>
      </>
    );
  else page = <OverviewPage />;

  const showNav = !!me && !invitation && !reset;

  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">Køvarsel</a>
      </header>
      <main className="content">{page}</main>
      {showNav && (
        <nav className="tabbar" aria-label="Hovedmeny">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={n.match(route) ? "active" : ""} aria-current={n.match(route) ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </>
  );
}
