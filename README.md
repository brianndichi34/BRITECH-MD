# BRITECH MD

WhatsApp multi-device bot built with Node.js and Baileys.

## Requirements
- Node.js 20+
- Persistent storage for the WhatsApp session

## Run
1. `npm install`
2. `npm run session` to pair WhatsApp
3. `npm start`

Do not commit `.env` or `session/auth` files. Deploy the always-on bot as a persistent worker, not a Vercel Function.
