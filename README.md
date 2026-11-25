# BRITECH MD — WhatsApp Multi-Device Bot

<p align="center">
  <strong>BRIAN NDICHI · Node.js · Baileys</strong><br>
  A WhatsApp assistant with modular commands, media tools, group tools, utilities and optional AI.
</p>

<p align="center">
  <a href="https://github.com/brianndichi34/BRITECH-MD/fork"><img alt="Fork" src="https://img.shields.io/badge/FORK-BRITECH%20MD-8250df?style=for-the-badge"></a>
  <a href="https://github.com/brianndichi34/BRITECH-MD/actions/workflows/session.yml"><img alt="Generate session" src="https://img.shields.io/badge/GENERATE-SESSION%20ID-238636?style=for-the-badge"></a>
  <a href="https://github.com/brianndichi34/BRITECH-MD/archive/refs/heads/main.zip"><img alt="Download ZIP" src="https://img.shields.io/badge/DOWNLOAD-ZIP-0969da?style=for-the-badge"></a>
  <a href="https://github.com/brianndichi34/BRITECH-MD/actions/workflows/ci.yml"><img alt="Tests" src="https://img.shields.io/badge/TESTS-GITHUB%20ACTIONS-1f6feb?style=for-the-badge"></a>
</p>

<p align="center">
  <img src="assets/britech-md-avatar.png" alt="BRITECH MD — by Brian" width="220">
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

After dashboard pairing is confirmed, the dashboard sends the `SESSION_ID` to the WhatsApp DM for the entered phone number as a Word document and separately as plain text. It verifies that number against the connected account’s phone JID or verified PN alias, including accounts whose primary identity is a LID. It rejects groups, broadcasts, and identities that cannot be tied to the entered number. The GitHub Actions workflow uses the same phone-number routing. Delivery is reported only when Baileys emits a WhatsApp server acknowledgement for the corresponding message; a locally-created message ID is not treated as proof. Very long plain-text IDs are split into ordered chunks that must be joined with no spaces or line breaks. The Word document contains the complete ID and is attempted as a separate route. New `BRITECH3:` IDs use Brotli compression over the auth files directly; older `BRITECH2:` IDs remain supported. Open the Word file to copy the complete value. Treat it as a password; do not post it in issues, logs, screenshots, or chat. Configure the dashboard with `PAIRING_DASHBOARD_TOKEN` and `SESSION_DIR` before exposing it.

The command system also loads local modules from `plugins/`. The `.menu` command now opens with a generated BRITECH MD avatar and a redesigned, phone-readable layout using consistent color-coded emoji accents, bold section titles, compact command rows, and clear separators. `.settings` and `.doctor` use the same visual style. On first connection, the generated avatar is applied to the bot's WhatsApp profile by default; owners can use `.setmenuprofile https://...` with a direct public HTTPS image URL to update both the WhatsApp account photo and the image used by the menu. Set `AUTO_SET_BOT_PROFILE=false` to stop automatic profile updates. Image downloads are size-limited and local/private URLs are rejected. The configured `WELCOME_MESSAGE` is also sent once to the linked account's own WhatsApp chat after connection, with a persistent per-account marker preventing repeats on reconnect; it remains the group-join welcome text too. Other local features include stickers, QR images, native polls/reactions, AFK notices, group name/description changes, mute/unmute, and invite-link renewal.

Incoming WhatsApp statuses are automatically marked viewed and reacted to by default. Status messages are handled on both `notify` and `append` Baileys upserts, while normal chat commands are restricted to live `notify` events plus the linked account's own sent commands (`append` with `fromMe`). Status actions and chat commands in one event batch run concurrently so a slow status receipt does not delay command handling. Successful views are deduplicated; failed view/read attempts are logged and can retry on a later event. The bot uses the linked WhatsApp account, so the status owner can see its view and reaction. Each new status gets a cryptographically random reaction from the configured default pool `💕, 💞, 💖, 💯, 🥰`; retries for the same status reuse that selection and duplicate events do not send duplicate reactions. Commands are acknowledged with a random emoji from the same default pool when `AUTO_REACT_COMMANDS=true`. Set `AUTO_VIEW_STATUS=false` or `AUTO_LIKE_STATUS=false` in `.env` to turn viewing or reacting off independently. Set `STATUS_LIKE_EMOJIS` or `COMMAND_REACTION_EMOJIS` to comma-separated lists to customize the choices, or use the legacy `STATUS_LIKE_EMOJI` for one fixed status emoji. Normal chat read receipts remain controlled separately by `AUTO_READ`.

Anti-delete is enabled by default for ordinary messages only. When Baileys receives a message-revocation event, BRITECH MD forwards the cached original message from a group or private chat directly into the linked account's own WhatsApp DM (self-chat), with the source chat and sender noted. Revoked status updates are explicitly ignored and never sent to the anti-delete DM. It falls back to `OWNER_NUMBER` only if the linked account identity is unavailable. It keeps up to 1,000 messages in memory for 48 hours; only messages received while the bot is online can be recovered, and the cache clears on restart. Set `AUTO_ANTI_DELETE=false` to disable this feature.

Maintenance commands include `.uptime`, `.runtime`, and `.jid` for diagnostics. The owner can run `.update check` to inspect npm updates and `.update deps` (or `.update`) to install dependency versions permitted by `package.json`; restart the process from the host panel afterward. This updates npm dependencies only, not bot source code, and it never edits or clears WhatsApp session files. BRITECH does not silently execute remote plugin scripts; only use trusted, reviewed updates.

If WhatsApp itself shows **“Waiting for this message. This may take a while”**, that is an end-to-end encryption/session synchronization notice, not a bot reply or typing indicator. Keep the phone online, confirm only one bot process is using the linked session, check `.diagnose`, and restart the host once. If it continues, pair a fresh session through the documented generator; back up existing credentials first and never share or commit them. Code changes cannot prove or repair a live WhatsApp encryption ratchet without a live session test.

The `.ai <question>` command uses OpenAI when `OPENAI_API_KEY` is set. Otherwise it uses Google's Gemini API with the default `gemini-3.6-flash` model when `GEMINI_API_KEY` is set. Gemini offers a free developer tier for eligible models, subject to model availability and quota limits; Google says free-tier content may be used to improve its products. For sensitive prompts, review Google's terms and do not send private data. Create a key in [Google AI Studio](https://aistudio.google.com/apikey), put it in the private `GEMINI_API_KEY` environment variable on KataBump, and restart the bot. A GitHub Actions secret is not automatically available to a separately hosted bot. Keep the key out of Git and never put it in a publicly shared `.env` file. The optional `GEMINI_MODEL` setting can select another model available to your key.

The owner-only `.manus <prompt>` command starts a **private** Manus API v2 task and replies with its task link; the answer is read in Manus rather than relayed back into WhatsApp. To enable it, create a Manus API key in your Manus API settings and set it privately as `MANUS_API_KEY` in KataBump's environment variables or the host-only root `.env`, then restart. Keep the repository's `.env.example` and committed `.env` value blank: a GitHub Actions secret is not automatically passed to a separately hosted KataBump bot. Use `.manuscheck` to verify the key against Manus's read-only `user.me` endpoint; the bot reports only success/failure and never displays the key. This uses task creation, not a synchronous chat-completions endpoint. If the key is absent, `.manus` returns setup guidance.

`.doctor` opens WhatsApp quick-reply buttons for **Identify Problem** (`.diagnose`) and **Auto-fix Safe Issues** (`.autofix`). Diagnosis checks runtime major, connection state, session-file presence/registration, environment-file presence, Baileys installation, avatar asset, and feature toggles without showing secret values. Auto-fix is owner-only: it may create the configured auth directory or restore a missing root `.env` from the safe template, but never overwrites a file, edits environment values, or deletes/replaces WhatsApp credentials. Node version selection, invalid sessions, missing host packages, and network/pairing problems still require operator action; it reports those next steps.

The automated test suite checks the pairing display/copy controls, BRITECH session-ID encoding, number-match guard, phone-number DM routing, Word/text generation, chunking, acknowledgement handling, plugin loading, local media/poll/group behavior, status event routing, anti-delete caching/self-chat forwarding, menu/profile safety, and Manus task request construction. It does not perform a real WhatsApp login or prove live WhatsApp delivery or Manus API key validity. Verify these on a user-controlled live deployment.

## Generate a WhatsApp session ID

### Recommended: GitHub Actions (private repository)

1. Open the repository **Settings → Secrets and variables → Actions**.
2. Add a repository secret named `SESSION_ARCHIVE_PASSWORD`. Use a long, unique password and keep it private.
3. Open the **Actions** tab → **BRITECH MD — Generate WhatsApp Session** → **Run workflow**.
4. Enter your WhatsApp number with country code and digits only, e.g. `2547XXXXXXXX`.
5. Start the workflow. Open its run log and use the displayed one-time pairing code in WhatsApp → Linked devices → Link with phone number instead.
6. Approve the pairing and wait for the workflow to finish. The workflow sends the complete `SESSION_ID` to the entered number’s WhatsApp DM as a Word document and separate plain-text message(s), and reports whether WhatsApp acknowledged each format.
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

After a successful link, the generator writes a complete, compact `BRITECH3:` value to `SESSION_ID.txt` (or the path set by `SESSION_ID_FILE`). Keep this file private; it contains the full WhatsApp auth material needed to restore the session on a host.

**Existing session safety:** the generator refuses to overwrite a non-empty auth folder by default. Back up existing credentials before intentionally replacing them; never share them.

## KataBump deployment

1. Download a fresh project ZIP from [GitHub Code → Download ZIP](https://github.com/brianndichi34/BRITECH-MD/archive/refs/heads/main.zip). Sign in at KataBump and create a Node.js server.
2. In KataBump, open **Files** and upload the project ZIP. Use the file manager’s **Extract/Unarchive** action. Make sure the extracted project contents (not an extra nested project folder) are in `/home/container`, with `package.json`, `index.js`, and the safe starter `.env` together. If extraction creates a nested `BRITECH-MD-main` folder, move its contents into `/home/container` so the bot and `.env` use one project root.
3. In the KataBump **Startup** tab, select the Node.js **20.9+** runtime and set **JS FILE** to `index.js`. The app starts with `npm start`; dependencies are declared in `package.json` and pinned by `package-lock.json`. Do not put the SESSION_ID into the JS FILE or ADDITIONAL PACKAGES boxes.
4. The ZIP now includes a safe `.env` starter beside `package.json`. Open it in KataBump **Files**; if it is missing, select **New File**, name it `.env`, and copy the template from `.env.example`. Set your complete `BRITECH3:` value after `SESSION_ID=` on one line, without spaces around `=`. The starter enables `AUTO_VIEW_STATUS=true`, `AUTO_LIKE_STATUS=true`, and `AUTO_ANTI_DELETE=true`.
5. Press **Save** in the file editor (or confirm the save prompt), then reopen `.env` to confirm it saved and the line begins `SESSION_ID=BRITECH3:`. The committed `.env` is only a public starter: its `SESSION_ID`, API key, and dashboard token are blank. Never commit or upload a populated `.env`, session ID, auth folder, or real token to GitHub; fill private values only in the KataBump copy. Keep the session ID on one line with no quotes or spaces around `=`.
6. Ensure `/home/container/session/auth` is persistent. If that folder already contains credentials, back it up and clear it before first startup with `SESSION_ID`; the bot will not overwrite an existing auth session when importing the ID.
7. Restart the server from the KataBump console. On startup, the bot imports the archive into `session/auth`; confirm logs show `Loaded SESSION_ID into auth folder` followed by `BRITECH MD connected`.
8. Keep at least one validated backup beside the active `session/auth` directory, such as `auth.backup-<date>` or `auth.before-restore-<date>`. After three repeated Baileys `Bad MAC` or session-cipher decryption errors, the bot preserves the failing auth folder, rotates in the newest validated unused backup, and restarts. If no validated backup exists, `.autofix` reports that a fresh `BRITECH3:` session is required; it never overwrites credentials or secrets automatically.

KataBump's web upload process requires a ZIP containing `package.json` and the entry file; its console can also clone a Git repository. KataBump documents `.env` placement at the project root and uploading via its web manager or SFTP. See [environment-variable instructions](https://docs.katabump.com/launch-your-bot/environment-variables/), [upload instructions](https://docs.katabump.com/launch-your-bot/upload-via-web/), and [FAQ](https://docs.katabump.com/faq/).

## Requirements

- Node.js 20.9+ LTS (GitHub Actions and Docker use the same portable baseline; newer LTS releases are also supported)
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
| `OPENAI_API_KEY` | No | Optional `.ai` provider; preferred when configured; keep secret |
| `OPENAI_MODEL` | No | `gpt-4o-mini` |
| `GEMINI_API_KEY` | No | Free-tier alternative for `.ai`; create in Google AI Studio and store privately on the bot host |
| `GEMINI_MODEL` | No | `gemini-3.6-flash`; must be available to the API key |
| `MANUS_API_KEY` | No | Optional owner-only `.manus` and `.manuscheck`; set privately on the bot host, never commit a real key |
| `AUTO_READ` | No | `false` |
| `AUTO_VIEW_STATUS` | No | `true`; automatically mark incoming contact statuses viewed |
| `AUTO_LIKE_STATUS` | No | `true`; send a status reaction once per status |
| `STATUS_LIKE_EMOJIS` | No | Comma-separated, randomly selected status reactions; defaults to `💕,💞,💖,💯,🥰` |
| `AUTO_REACT_COMMANDS` | No | `true`; acknowledge handled commands with a random configured emoji |
| `COMMAND_REACTION_EMOJIS` | No | Comma-separated command acknowledgement reactions; defaults to `💕,💞,💖,💯,🥰` |
| `AUTO_SESSION_RECOVERY` | No | `true`; rotate to a validated auth backup after repeated decryption errors |
| `BAD_MAC_RECOVERY_THRESHOLD` | No | `3`; consecutive Bad MAC events required before recovery |
| `AUTO_ANTI_DELETE` | No | `true`; forward cached revoked messages from groups and chats to the owner DM |
| `AUTO_SET_BOT_PROFILE` | No | `true`; apply the generated or custom avatar to the linked WhatsApp account on startup |
| `STATUS_LIKE_EMOJI` | No | `💕`; legacy single status reaction fallback |
| `LOG_LEVEL` | No | `info` |
| `WELCOME_MESSAGE` | No | Group-join welcome and one-time linked-account connection DM; defaults to `WELCOME TO BRITECH BOT🔥💯` / `FOUNDED BY BRIAN N.🌺`; `{user}` is available for group joins |

## Commands

- General: `.menu`, `.settings`, `.doctor` (interactive health actions), `.diagnose`, `.autofix` (owner-only safe repair), `.help`, `.ping`, `.alive`, `.owner`, `.info`, `.repo`
- Utilities: `.time`, `.date`, `.calc 25*(4+2)`, `.quote`, `.echo text`, `.ai question`
- Brand & AI: `.setmenuprofile https://example.com/image.jpg` (owner only), `.manus question` (owner only; optional `MANUS_API_KEY`), `.manuscheck` (owner-only key validation)
- Groups: `.groupinfo`, `.admins`, `.tagall`, `.hidetag`, `.link`, `.close`, `.open`, `.kick`, `.promote`, `.demote`
- Maintenance: `.uptime`, `.runtime`, `.jid`, `.update check`, `.update deps` (owner-only for update checks/install)
- Plugins: `.sticker` (reply to or caption an image), `.toimg` (reply to a sticker), `.qr text`, `.poll Question | Option 1 | Option 2`, `.react 👍` (reply to a message), `.afk reason`, `.back`, `.setname`, `.setdesc`, `.mute`, `.unmute`, `.revoke`

Group management commands require a group administrator or the configured bot owner, and the bot itself must be a group admin for WhatsApp group updates. Use moderation actions only in groups where you have permission. AFK state is held in memory and resets when the process restarts. Image conversion accepts images up to 8 MB and static stickers; animated/video conversion is not enabled because it needs additional system tooling.

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
