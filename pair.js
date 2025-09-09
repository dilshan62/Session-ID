const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const router = express.Router();
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega");

// Absolute path to session directory
const sessionPath = path.join(__dirname, "session");

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
    console.log("✅ Removed session folder:", filePath);
  }
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: "Missing ?number= parameter" });

  async function PrabathPair() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    // Cleanup after 2 minutes if pairing not completed
    const cleanupTimeout = setTimeout(() => {
      console.log("🕒 Timeout: Cleaning up unused session.");
      removeFile(sessionPath);
    }, 2 * 60 * 1000);

    try {
      const PrabathPairWeb = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "fatal" }).child({})
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }).child({}),
        browser: Browsers.macOS("Safari"),
      });

      if (!PrabathPairWeb.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, "");
        const code = await PrabathPairWeb.requestPairingCode(num);
        if (!res.headersSent) {
          return res.send({ code });
        }
      }

      PrabathPairWeb.ev.on("creds.update", saveCreds);
      PrabathPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          clearTimeout(cleanupTimeout); // Stop timeout cleanup

          try {
            await delay(10000);

            const user_jid = jidNormalizedUser(PrabathPairWeb.user.id);
            const credsFile = path.join(sessionPath, "creds.json");

            // Generate random ID for filename
            function randomMegaId(length = 6, numberLength = 4) {
              const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
              const letters = Array.from({ length }, () =>
                chars.charAt(Math.floor(Math.random() * chars.length))
              ).join("");
              const numbers = Math.floor(Math.random() * Math.pow(10, numberLength));
              return `${letters}${numbers}`;
            }

            const megaUrl = await upload(
              fs.createReadStream(credsFile),
              `${randomMegaId()}.json`
            );

            const sid = megaUrl.replace("https://mega.nz/file/", "");

            await PrabathPairWeb.sendMessage(user_jid, { text: sid });
          } catch (err) {
            console.error("❌ Error during upload or message:", err);
            exec("pm2 restart prabath");
          }

          await delay(100);
          removeFile(sessionPath);
          process.exit(0);
        }

        if (
          connection === "close" &&
          lastDisconnect?.error?.output?.statusCode !== 401
        ) {
          clearTimeout(cleanupTimeout);
          console.log("🔁 Reconnecting...");
          await delay(10000);
          removeFile(sessionPath);
          PrabathPair(); // Restart pairing
        }
      });
    } catch (err) {
      clearTimeout(cleanupTimeout);
      console.error("❌ Exception during pairing:", err);
      removeFile(sessionPath);
      exec("pm2 restart prabath-md");
      if (!res.headersSent) {
        res.status(500).send({ code: "Service Unavailable" });
      }
    }
  }

  await PrabathPair();
});

// Auto-restart on crash
process.on("uncaughtException", (err) => {
  console.error("Caught exception:", err);
  exec("pm2 restart prabath");
});

module.exports = router;
