import { config } from "../config.js";
import { createDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import * as authDb from "../services/auth.js";

/*
 * Brukeradministrasjon fra kommandolinjen. Brukes til å lage første administrator.
 *   npm run user -- invite <e-post> [--admin]   Lager invitasjonslenke (48 t)
 *   npm run user -- reset <e-post>               Lager lenke for nytt passord (30 min)
 *   npm run user -- rename <gammel> <ny>         Bytter e-post på en bruker (beholder lister)
 *   npm run user -- list                         Viser brukere
 */

const [command, ...args] = process.argv.slice(2);
const db = await createDb(config.DATABASE_URL);
if (db.kind === "pglite") await migrate(db);

function usage(): never {
  console.log("Bruk: invite <e-post> [--admin] | reset <e-post> | rename <gammel> <ny> | list");
  process.exit(1);
}

try {
  switch (command) {
    case "invite": {
      const email = args.find((a) => !a.startsWith("--"));
      if (!email) usage();
      const inv = await authDb.createAuthToken(db, { kind: "invitation", email, isAdmin: args.includes("--admin") });
      console.log(`Invitasjon for ${email}${args.includes("--admin") ? " (administrator)" : ""}, gyldig til ${inv.expiresAt.toLocaleString("nb-NO")}:`);
      console.log(inv.link);
      break;
    }
    case "reset": {
      const user = args[0] ? await authDb.findUserByEmail(db, args[0]) : null;
      if (!user) throw new Error("Fant ikke brukeren");
      const t = await authDb.createAuthToken(db, { kind: "reset", email: user.email });
      console.log(`Lenke for nytt passord til ${user.email}, gyldig til ${t.expiresAt.toLocaleString("nb-NO")}:`);
      console.log(t.link);
      break;
    }
    case "rename": {
      if (!args[0] || !args[1]) usage();
      console.log((await authDb.renameUser(db, args[0], args[1])) ? "Endret" : "Fant ikke brukeren");
      break;
    }
    case "list": {
      for (const u of await authDb.listUsers(db)) {
        console.log(`${u.email}${u.isAdmin ? " [admin]" : ""}${u.hasPassword ? "" : " (uten passord)"}`);
      }
      break;
    }
    default:
      usage();
  }
} finally {
  await db.close();
}
