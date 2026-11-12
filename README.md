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

## Keith MD–style pairing experience
The pairing page is designed to make phone-number pairing easy on mobile: enter the international WhatsApp number, request a code, then view the paired number and pairing code in separate display areas. Use **Copy Pair Code** to copy only the one-time code, paste it into WhatsApp → Linked devices → Link with phone number instead, and approve the request. Never share the one-time code.

After dashboard pairing is confirmed, the dashboard sends the `SESSION_ID` to the linked account’s self-chat as a Word document and separately as plain text. It verifies the account against the entered number and uses Baileys’ normalized self JID. Device-qualified phone JIDs, legacy `@c.us`, hosted PN/LID JIDs, and LIDs with a verified phone-number alias are handled; groups, broadcasts, and identities that cannot be tied to the entered number are rejected. The GitHub Actions workflow uses the same self-chat routing. The document is sent first, so it remains available if WhatsApp does not accept the long plain-text message. New `BRITECH3:` IDs use Brotli compression over the auth files directly, avoiding the size overhead of a compressed ZIP; older `BRITECH2:` IDs remain supported. Open the Word file to copy the complete value. Treat it as a password; do not post it in issues, logs, screenshots, or chat. Configure the dashboard with `PAIRING_DASHBOARD_TOKEN` and `SESSION_DIR` before exposing it.

The automated test suite checks the pairing display/copy controls, BRITECH session-ID encoding, number-match guard, standalone text-message delivery code path, delivery status, and documentation. It does not perform a real WhatsApp login or prove delivery to a phone; verify those only through a user-controlled live deployment.

## Generate a WhatsApp session ID

### Recommended: GitHub Actions (private repository)

1. Open the repository **Settings → Secrets and variables → Actions**.
2. Add a repository secret named `SESSION_ARCHIVE_PASSWORD`. Use a long, unique password and keep it private.
3. Open the **Actions** tab → **BRITECH MD — Generate WhatsApp Session** → **Run workflow**.
4. Enter your WhatsApp number with country code and digits only, e.g. `2547XXXXXXXX`.
5. Start the workflow. Open its run log and use the displayed one-time pairing code in WhatsApp → Linked devices → Link with phone number instead.
6. Approve the pairing and wait for the workflow to finish. The workflow sends the complete `SESSION_ID` in a Word document first, then attempts a separate plain-text WhatsApp message in the verified account’s self-chat.
7. Open `BRITECH-MD-SESSION_ID.docx` in WhatsApp and copy the complete `BRITECH3:` value into the `SESSION_ID` setting on your bot host. If WhatsApp accepts the plain-text version too, you can long-press that message to copy it. If either message fails, check the workflow result and use the encrypted artifacts under the run’s **Artifacts** section.
8. The `britech-session-id-encrypted` artifact contains the encrypted session string; `britech-session-encrypted` contains the encrypted auth folder. Decrypt these only on your own trusted device using the repository secret.

Both artifacts are encrypted with AES-256-CBC and PBKDF2 before upload. The workflow does not print the session string in Actions logs or commit session credentials to Git. The `BRITECH3:` value contains the compacted full auth data; the bot can import it when its auth folder is empty. Keep the pairing code and run access private. Do not share the run or its screenshots. GitHub Actions secrets are encrypted, but access to repository write permissions is still sensitive.

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
```

Enter the international WhatsApp number when prompted, then follow the pairing instructions printed in the terminal. Do not run the session generator and bot simultaneously against the same auth folder.

**Existing session safety:** the generator refuses to overwrite a non-empty auth folder by default. Back up existing credentials before intentionally replacing them; never share them.

## KataBump deployment

1. Download a fresh project ZIP from [GitHub Code → Download ZIP](https://github.com/brianndichi34/BRITECH-MD/archive/refs/heads/main.zip). Sign in at KataBump and create a Node.js server.
2. In KataBump, open **Files** and upload the project ZIP. Use the file manager’s **Extract/Unarchive** action. Make sure the extracted project contents (not an extra nested project folder) are in `/home/container`, with `package.json`, `index.js`, and `.env.example` together. If extraction creates a nested `BRITECH-MD-main` folder, move its contents into `/home/container` so the bot and `.env` use one project root.
3. In the KataBump **Startup** tab, select Node.js 20 or newer and set **JS FILE** to `index.js`. The app starts with `npm start`; do not put the SESSION_ID into the JS FILE or ADDITIONAL PACKAGES boxes.
4. In **Files**, select **New File** (or the equivalent file-creation action), type `.env` exactly, and create it in `/home/container` beside `package.json`. Open `.env.example`, copy its content, then open `.env` and paste the template. On the blank `SESSION_ID=` line, paste your complete new `BRITECH3:` value immediately after `=`. Keep it all on one line with no quotes or spaces around `=`.
5. Press **Save** in the file editor (or confirm the save prompt). Reopen `.env` to verify the line begins `SESSION_ID=BRITECH3:` and the full value is still present. Do not paste it into `package.json`, the source code, a public GitHub file, or chat. `.env` is intentionally excluded from Git, so each deployer creates this private file after extracting the ZIP.
6. Ensure `/home/container/session/auth` is persistent. If that folder already contains credentials, back it up and clear it before first startup with `SESSION_ID`; the bot will not overwrite an existing auth session when importing the ID.
7. Restart the server from the KataBump console. On startup, the bot imports the archive into `session/auth`; confirm logs show `Loaded SESSION_ID into auth folder` followed by `BRITECH MD connected`.

KataBump's web upload process requires a ZIP containing `package.json` and the entry file; its console can also clone a Git repository. KataBump documents `.env` placement at the project root and uploading via its web manager or SFTP. See [environment-variable instructions](https://docs.katabump.com/launch-your-bot/environment-variables/), [upload instructions](https://docs.katabump.com/launch-your-bot/upload-via-web/), and [FAQ](https://docs.katabump.com/faq/).

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
| `SESSION_ID` | Needed when importing a generated session | Complete `BRITECH3:` value; put it in `.env` at project root |
| `SESSION_DIR` | Hosted | `./session/auth`; use a persistent path |
| `PAIRING_DASHBOARD_TOKEN` | Yes for web pairing | Long random secret protecting the pairing page API |
| `PAIRING_PORT` / `PORT` | No | Web dashboard port; default `3000` |
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

GitHub Actions runs syntax and pairing/session behavior checks on pushes and pull requests. Locally:
```bash
npm install
npm test
```

Syntax checks do not prove a live WhatsApp login or message delivery. After pairing, test `.menu`, `.ping`, `.calc 5*5` and `.time` from another WhatsApp account.

## Security

- Never commit `.env`, pairing codes, session files, or auth archives. Treat the SESSION_ID WhatsApp message as a password and do not forward it or share screenshots of it.
- Keep this repository private while using the GitHub pairing workflow.
- Limit repository write access; collaborators with write access may be able to view workflow logs and repository secrets.
- Never expose `OPENAI_API_KEY` or `SESSION_ARCHIVE_PASSWORD`.
- WhatsApp protocol changes can require future Baileys updates. Use the bot responsibly and follow WhatsApp's terms.
