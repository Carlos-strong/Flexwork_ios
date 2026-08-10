// Démarre mailpit.exe (SMTP local pour les OTP par e-mail, voir src/lib/mail.ts) en même
// temps que `next dev`, via `npm run dev` (package.json). Si une instance tourne déjà sur
// le port SMTP (1025), ne relance rien — évite un crash "port already in use" qui ferait
// échouer tout `concurrently` si Mailpit était laissé ouvert d'une session précédente.
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const SMTP_PORT = 1025;
const HOST = "127.0.0.1";
const MAILPIT_BIN = path.join(__dirname, "..", "mailpit.exe");

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
  const inUse = await isPortInUse(SMTP_PORT, HOST);
  if (inUse) {
    console.log(`[mailpit] déjà en cours d'exécution sur ${HOST}:${SMTP_PORT} — ne relance pas.`);
    process.exit(0);
  }

  console.log("[mailpit] démarrage — UI http://localhost:8025, SMTP 127.0.0.1:1025");
  const child = spawn(MAILPIT_BIN, ["--listen", "127.0.0.1:8025", "--smtp", "127.0.0.1:1025"], {
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code ?? 0));
})();
