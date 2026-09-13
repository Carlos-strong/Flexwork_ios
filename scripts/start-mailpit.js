// Démarre mailpit.exe (SMTP local pour les OTP par e-mail, voir src/lib/mail.ts) en même
// temps que `next dev`, via `npm run dev` (package.json). Si une instance tourne déjà sur
// le port SMTP (1025), ne relance rien — évite un crash "port already in use" qui ferait
// échouer tout `concurrently` si Mailpit était laissé ouvert d'une session précédente.
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const SMTP_PORT = 1025;
// "0.0.0.0" (au lieu de 127.0.0.1) : écoute sur toutes les interfaces réseau de la machine,
// pas seulement la boucle locale — permet d'ouvrir l'UI Mailpit (et d'envoyer du SMTP) depuis
// un autre appareil du même réseau (ex. téléphone de test, autre poste), pas seulement depuis
// ce Mac. La vérification du port ci-dessous reste sur 127.0.0.1 : un mailpit déjà lancé
// répond forcément aussi sur la boucle locale, quelle que soit l'interface choisie ici.
const HOST = "0.0.0.0";
const CHECK_HOST = "127.0.0.1";
// Binaire selon la plateforme : `mailpit` (macOS/Linux) ou `mailpit.exe` (Windows)
const MAILPIT_BIN = path.join(
  __dirname,
  "..",
  process.platform === "win32" ? "mailpit.exe" : "mailpit",
);

function isPortInUse(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

(async () => {
  const inUse = await isPortInUse(SMTP_PORT, CHECK_HOST);
  if (inUse) {
    console.log(`[mailpit] déjà en cours d'exécution sur ${CHECK_HOST}:${SMTP_PORT} — ne relance pas.`);
    process.exit(0);
  }

  console.log(`[mailpit] démarrage — UI http://0.0.0.0:8025 (accessible via toute IP de la machine), SMTP 0.0.0.0:1025`);
  const child = spawn(MAILPIT_BIN, ["--listen", `${HOST}:8025`, "--smtp", `${HOST}:1025`], {
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code ?? 0));
})();
