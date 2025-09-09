const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
let router = express.Router();
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

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  async function PrabathPair() {
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    try {
      let PrabathPairWeb = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "fatal" }).child({ level: "fatal" }),
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.macOS("Safari"),
      });

      if (!PrabathPairWeb.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, "");
        const code = await PrabathPairWeb.requestPairingCode(num);
        if (!res.headersSent) {
          await res.send({ code });
        }
      }

      PrabathPairWeb.ev.on("creds.update", saveCreds);
      PrabathPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;
        if (connection === "open") {
          try {
            await delay(8000); // slight delay to ensure creds saved
            const auth_path = "./session/";
            const user_jid = jidNormalizedUser(PrabathPairWeb.user.id);

            // random file id
            function randomMegaId(length = 6, numberLength = 4) {
              const characters =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
              let result = "";
              for (let i = 0; i < length; i++) {
                result += characters.charAt(
                  Math.floor(Math.random() * characters.length),
                );
              }
              const number = Math.floor(
                Math.random() * Math.pow(10, numberLength),
              );
              return `${result}${number}`;
            }

            // upload session file
            const mega_url = await upload(
              fs.createReadStream(auth_path + "creds.json"),
              `${randomMegaId()}.json`,
            );

            const sid = mega_url.replace("https://mega.nz/file/", "");

            // send session info
            await PrabathPairWeb.sendMessage(user_jid, {
              image: {
                url: "https://github.com/dilshan62/DILSHAN-MD/blob/main/images/bot_connected.png?raw=true",
              },
              caption: `╭━━━━━❰ 🔐 *SESSION CONNECTED*
┃🔰 *WELCOME TO DILSHAN-MD* 🔰
┃───────────────────────
┃ 🪪 *Status:* Successfully Paired
┃ 📱 *Bot:* DILSHAN-MD 
┃───────────────────────
┃ ⚡ Powered by: *Dilshan Chanushka*
╰━━━━━━━━━━━━━━━━━━━━━╯
✅ Your session is now active. 
⚠️ Please do not share your Session ID with anyone!`,
            });

            await PrabathPairWeb.sendMessage(user_jid, { text: sid });

            // cleanup + shutdown
            await delay(2000);
            PrabathPairWeb.end(); // close socket
            removeFile("./session");
            process.exit(0);
          } catch (e) {
            console.error("Error in pairing flow:", e);
            exec("pm2 restart prabath");
          }
        } else if (
          connection === "close" &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output.statusCode !== 401
        ) {
          await delay(10000);
          PrabathPair();
        }
      });
    } catch (err) {
      exec("pm2 restart prabath-md");
      console.log("service restarted");
      removeFile("./session");
      if (!res.headersSent) {
        res.send({ code: "Service Unavailable" });
      }
    }
  }
  return await PrabathPair();
});

process.on("uncaughtException", function (err) {
  console.log("Caught exception: " + err);
  exec("pm2 restart prabath");
});

module.exports = router;
