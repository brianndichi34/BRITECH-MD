# BRITECH MD — WhatsApp Multi-Device Bot

An independently built WhatsApp assistant using Node.js and Baileys.

## What is included

- General commands: menu, ping, alive, owner, info and repository link
- Utilities: date, time, calculator, quotes and echo
- Optional AI replies through the OpenAI API
- Group tools: group information, admin list, mentions, invite link and admin moderation
- WhatsApp linked-device pairing helper
- Docker, Render and Railway deployment configuration

## Requirements

- Node.js 20 or newer
- A WhatsApp account that can link another device
- A persistent disk/volume for the WhatsApp authentication files

## Pair WhatsApp locally

```bash
npm install
cp .env.example .env
# Edit .env if required
npm run session
```

Enter your WhatsApp number in international format, digits only (Kenya example: 2547XXXXXXXX). On your phone open WhatsApp → Linked devices → Link a device → Link with phone number instead. Enter the pairing code printed in the terminal. Wait for the connected confirmation, then run:

```bash
npm start
```

Do not run the session generator and bot simultaneously against the same auth directory.

## Environment variables

| Variable | Required | Default / example | Purpose |
|---|---|---|---|
| BOT_NAME | No | BRITECH MD | Bot display name |
| OWNER_NAME | No | BRIAN NDICHI | Owner display name |
| OWNER_NUMBER | Yes | 2547XXXXXXXX | Owner number, country code and digits only |
| OWNER_EMAIL | No | owner email | Contact shown by .owner |
| PREFIX | No | . | Command prefix |
| TIMEZONE | No | Africa/Nairobi | Time/date commands |
| SESSION_DIR | Yes for hosted worker | ./session/auth | Baileys auth directory |
| OPENAI_API_KEY | No | blank | Enables .ai; keep it secret |
| OPENAI_MODEL | No | gpt-4o-mini | Model available to your API account |
| AUTO_READ | No | false | Mark incoming messages as read |
| LOG_LEVEL | No | info | Pino log level |
| WELCOME_MESSAGE | No | blank | Optional group welcome text; supports {user} |

AUTO_TYPING is reserved and is not currently implemented. Do not set SESSION_DIR to an ephemeral filesystem on a hosted worker. Mount persistent storage at /app/session and set SESSION_DIR=/app/session/auth.

## Commands

### General
- .menu / .help
- .ping
- .alive
- .owner
- .info
- .repo

### Utilities
- .time
- .date
- .calc 25*(4+2)
- .quote
- .echo your text
- .ai your question (requires OPENAI_API_KEY)

### Group commands
- .groupinfo
- .admins
- .tagall [message]
- .hidetag [message]
- .link
- .close / .open
- .kick @member
- .promote @member
- .demote @member

For member-targeting commands, mention a member or reply to their message. The bot must be a group administrator for moderation actions. Group commands are intended for groups where the bot has appropriate permissions.

## Recommended deployment: Render Background Worker

This is an always-on WhatsApp connection, not a normal website. **Do not deploy the Baileys process as a Vercel Function.** Vercel can host the static information page in vercel-site/, but the bot needs a long-running process and persistent storage.

1. Push this repository to GitHub.
2. In Render choose New → Blueprint and select this repository.
3. Render reads render.yaml and defines a Docker Background Worker with a persistent disk mounted at /app/session.
4. Apply the Blueprint. The included starter worker and disk may incur charges; check Render's current pricing before confirming.
5. Configure environment variables. The render.yaml includes the owner details, prefix, timezone and session path as defaults. Add OPENAI_API_KEY only if you want the .ai command.
6. Pair WhatsApp once using the host's interactive shell/console with `npm run session`. Keep the auth directory on the persistent disk. Then start/restart the worker with `npm start`.

If the host cannot provide an interactive shell, generate the session on a trusted computer and transfer the entire session/auth directory securely to the persistent volume. Never commit or publicly share it.

### Railway / Docker / VPS

The repository includes railway.json and a Dockerfile. Use a persistent volume mounted at /app/session and set SESSION_DIR=/app/session/auth. Pair once through an interactive console, then run npm start. For Docker, build with `docker build -t britech-md .` and mount a persistent volume at /app/session.

### Vercel

The WhatsApp bot itself is not suitable for Vercel Functions because it requires a persistent, continuously running connection and durable auth storage. The optional static information page is in vercel-site/ and can be deployed separately; it does not run the bot.

## Security and account safety

- The session/auth directory contains credentials and encryption keys. Treat it like a password.
- Never commit .env, pairing codes, session files or screenshots of them.
- Keep OPENAI_API_KEY in your host's environment-variable settings, never in source code.
- Do not run bulk unsolicited messaging, spam, scraping or harassment. Follow WhatsApp's terms and applicable law.
- This is an unofficial WhatsApp Web client. Protocol changes may require a Baileys update; uninterrupted operation cannot be guaranteed.

## Tests

Run `npm test` to check JavaScript syntax. This does not verify a live WhatsApp login, message delivery, OpenAI access or hosted deployment. After pairing, test .menu, .ping, .calc 5*5 and .time from a separate WhatsApp account. Test group commands only in a test group where the bot has admin rights.
