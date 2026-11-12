# BRITECH MD — WhatsApp Multi-Device Bot

<p align="center">
  <strong>BRIAN NDICHI · Node.js · Baileys</strong><br>
  A WhatsApp assistant with commands, group tools, utilities and optional AI.
</p>

<p align="center">
  <a href="https://github.com/brianndichi34/BRITECH-MD/fork"><img alt="Fork" src="https://img.shields.io/badge/FORK-BRITECH%20MD-8250df?style=for-the-badge"></a>
  <a href="https://github.com/brianndichi34/BRITECH-MD/actions/workflows/session.yml"><img alt="Generate session" src="https://img.shields.io/badge/GENERATE-SESSION%20ID-238636?style=for-the-badge"></a>
  <a href="https://github.com/brianndichi34/BRITECH-MD/archive/refs/heads/main.zip"><img alt="Download ZIP" src="https://img.shields.io/badge/DOWNLOAD-ZIP-0969da?style=for-the-badge"></a>
  <a href="https://github.com/brianndichi34/BRITECH-MD/actions/workflows/ci.yml"><img alt="Tests" src="https://img.shields.io/badge/TESTS-GITHUB%20ACTIONS-1f6feb?style=for-the-badge"></a>
</p>

## Deployment options

| Platform | Method | Notes |
|---|---|---|
| [KataBump](https://control.katabump.com/) | Upload ZIP or clone repository | Node.js server; configure persistent files and environment variables. |
| [Railway](https://railway.com/) | Deploy from GitHub using `railway.json` and Dockerfile | Attach a persistent volume at `/app/session`; usage may be charged. |
| [Render](https://dashboard.render.com/) | New → Blueprint, select this repository | Background worker blueprint; persistent disk/worker may be paid. |
| [Heroku](https://dashboard.heroku.com/new?template=https://github.com/brianndichi34/BRITECH-MD) | Deploy button / dashboard | Check current pricing; configure durable session storage separately. |
| [Docker / VPS](https://docs.docker.com/get-started/) | Build the included Dockerfile | Mount persistent storage at `/app/session`. |

**Important:** WhatsApp requires a long-running process and durable authentication storage. Do not deploy `index.js` as a Vercel Function or a serverless function. Vercel is suitable only for a separate static information page.

## Generate a WhatsApp session ID

### Recommended: GitHub Actions (private repository)

1. Open the repository **Settings → Secrets and variables → Actions**.
2. Add a repository secret named `SESSION_ARCHIVE_PASSWORD`. Use a long, unique password and keep it private.
3. Open the **Actions** tab → **BRITECH MD — Generate WhatsApp Session** → **Run workflow**.
4. Enter your WhatsApp number with country code and digits only, e.g. `2547XXXXXXXX`.
5. Start the workflow. Open its run log and use the displayed one-time pairing code in WhatsApp → Linked devices → Link with phone number instead.
6. Approve the pairing and wait for the workflow to finish. The workflow attempts to send the generated `SESSION_ID` directly as a WhatsApp DM to the same account you just linked.
7. Check your WhatsApp self-chat for **BRITECH MD — Your WhatsApp SESSION_ID**. Copy the complete session string into the `SESSION_ID` setting on your bot host. If DM delivery fails, the encrypted artifacts remain available under the run's **Artifacts** section.
8. The `britech-session-id-encrypted` artifact contains the encrypted session string; `britech-session-encrypted` contains the encrypted auth folder. Decrypt these only on your own trusted device using the repository secret.

Both artifacts are encrypted with AES-256-CBC and PBKDF2 before upload. The workflow does not print the session string in Actions logs or commit session credentials to Git. It sends the plain session string only to the WhatsApp account that was paired, using that account's self-chat. Keep the pairing code and run access private. Do not share the run or its screenshots. GitHub Actions secrets are encrypted, but access to repository write permissions is still sensitive.

To decrypt on Linux/macOS with OpenSSL:
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in session-auth.zip.enc -out session-auth.zip
unzip session-auth.zip
```

On Windows, use an OpenSSL build to decrypt, then extract the ZIP. Never upload the decrypted archive or auth folder to a public location.

### Generate locally / on an interactive host

```bash
npm install
npm run session
``

Enter the international WhatsApp number when prompted, then follow the pairing instructions printed in the terminal. Do not run the session generator and bot simultaneously against the same auth folder.

**Existing session safety:** the generator refuses to overwrite a non-empty auth folder by default. Back up existing credentials before intentionally replacing them; never share them.

## KataBump deployment

1. Sign in at [KataBump](https://katabump.com/) and create a Node.js server.
2. Upload the repository ZIP from the [Code → Download ZIP](https://github.com/brianndichi34/BRITECH-MD/archive/refs/heads/main.zip) link, or clone the private repository using credentials configured securely in the panel.
3. Extract the ZIP so `package.json` and `index.js` are at the project root.
4. Set Node.js 20 or newer and the startup command to `npm start`.
5. Configure the environment variables below in the host panel.
6. Ensure the host preserves the `session/auth` directory across restarts. Upload your generated session folder securely to that persistent location.
7. Start the server and confirm the log reports that BRITECH MD is connected.

KataBump's web upload process requires a ZIP containing `package.json` and the entry file; its console can also clone a Git repository. See [official upload instructions](https://docs.katabump.com/launch-your-bot/upload-via-web/) and [FAQ](https://docs.katabump.com/faq/).

## Requirements

- Node.js 20+
- WhatsApp account with linked-device access
- Persistent storage for authentication files

## Environment variables

| Variable | Required | Default / purpose |
|---|---|---|
| `BOT_NAME` | No | `BRITECH MD` |
| `OWNER_NAME` | No | `BRIAN NDICHI` |
| `OWNER_NUMBER` | Recommended | Owner number in international digits |
| `OWNER_EMAIL` | No | Contact shown by owner command |
| `PREFIX` | No | `.` |
| `TIMEZONE` | No | `Africa/Nairobi` |
| `SESSION_DIR` | Hosted | `./session/auth`; use a persistent path |\n| `PAIRING_DASHBOARD_TOKEN` | Yes for web pairing | Long random secret protecting the pairing page API |\n| `PAIRING_PORT` / `PORT` | No | Web dashboard port; default `3000` |
| `OPENAI_API_KEY` | No | Enables AI command; keep secret |
| `OPENAI_MODEL` | No | `gpt-4o-mini` |
| `AUTO_READ` | No | `false` |
| `LOG_LEVEL` | No | `info` |
| `WELCOME_MESSAGE` | No | Optional group welcome message; supports `{user}` |

## Commands

- General: `.menu`, `.help`, `.ping`, `.alive`, `.owner`, `.info`, `.repo`
- Utilities: `.time`, `.date`, `.calc 25*(4+2)`, `.quote`, `.echo text`, `.ai question`
- Groups: `.groupinfo`, `.admins`, `.tagall`, `.hidetag`, `.link`, `.close`, `.open`, `.kick`, `.promote`, `.demote`

Group moderation commands require the bot to be an administrator. Use only in groups where you have permission.

## Tests

GitHub Actions runs syntax checks on pushes and pull requests. Locally:
```bash
npm install
npm test
``

Syntax checks do not prove a live WhatsApp login or message delivery. After pairing, test `.menu`, `.ping`, `.calc 5*5` and `.time` from another WhatsApp account.

## Security

- Never commit `.env`, pairing codes, session files, or auth archives. Treat the SESSION_ID DM as a password and do not forward it or share screenshots of it.
- Keep this repository private while using the GitHub pairing workflow.
- Limit repository write access; collaborators with write access may be able to view workflow logs and repository secrets.
- Never expose `OPENAI_API_KEY` or `SESSION_ARCHIVE_PASSWORD`.
- WhatsApp protocol changes can require future Baileys updates. Use the bot responsibly and follow WhatsApp's terms.
