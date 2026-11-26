# The Gremlin

A chaotic, funny Slack bot for Sami's Hack Club channel
**#sami9889s--random--ahh-channel**.

It is Sami's own bot, built from scratch, with its own name,
personality, and jokes. The Gremlin lives under Sami's desk, steals
snacks, breaks builds, hoards Dubby, and causes chaos. It is not a
guard or a moderator, it does not police the channel. It is obsessed
with energy drinks (Dubby, code SAMI9889), stealing snacks, breaking
code, gremlin mode, Rio the dog, and Tiny-Unity.

## How it works

- The bot lives in one channel: `C0CLXF7ECRF`
  (#sami9889s--random--ahh-channel).
- It replies in the channel, in general, not just in threads.
- With an LLM key set, it replies with an LLM using the system prompt
  in `prompt/prompt.md`. Without a key, it still works, it just uses
  canned gremlin replies (Dubby, broken code, snack tax, Rio, and so on).
- It remembers the last 20 messages of each thread, so it can follow
  a conversation.
- It never replies to bots, never replies twice to the same message,
  and messages starting with `##` are invisible to it.

Socket Mode means the bot connects out to Slack, so you do not need a
public URL, a domain, or Cloudflare. That is the easiest way to run a
small personal bot.

## Commands

- `!gremlin help` - show the command list
- `!gremlin leave` - stop replying in this channel
- `@gremlin !stop` - stop replying in this channel (anyone can use this)
- `!gremlin coin`, `dice`, `8ball <question>`, `pick <a> or <b>`, `rate <thing>`, `joke`, `roast <thing>`, `time`, `snacks` - coin flips, dice, 8ball, picks, rates, jokes, roasts, Melbourne time, snack tax total
- `!gremlin say <text>` - post it as the gremlin
- Start a message with `##` to hide it from the gremlin

## Setup

### 1. Create a Slack app

1. Go to https://api.slack.com/apps and click **Create New App**,
   then **From scratch**.
2. Name it **The Gremlin**, and pick the **Hack Club** workspace.
3. On the left, go to **Socket Mode** and turn it on. Slack will ask
   you to create an app-level token: name it `gremlin-socket`, tick
   **connections:write**, and save it. That is your `SLACK_APP_TOKEN`
   (starts with `xapp-`).
4. Go to **OAuth & Permissions**, scroll to **Scopes > Bot Token Scopes**,
   and add:
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `reactions:write`
   - `users:read`
5. At the top of the same page, click **Install to Workspace** and
   allow it. Copy the **Bot User OAuth Token**. That is your
   `SLACK_BOT_TOKEN` (starts with `xoxb-`).
6. In Slack, go to #sami9889s--random--ahh-channel and type
   `/invite @The Gremlin`.
7. Get the bot's user ID: in the app, go to **OAuth & Permissions**,
   it is shown near the bot token, or run the bot once and check the
   startup log. Put it in `GREMLIN_BOT_USER_ID` so `@gremlin !stop`
   works. The bot still works without it, it just will not recognise
   its own @mention as a stop command.

### 2. Get an LLM key (optional, recommended)

The bot works without one, but it is much funnier with one. Pick one:

- **OpenRouter** (free models available): https://openrouter.ai/keys
  - `LLM_BASE_URL=https://openrouter.ai/api/v1`
  - `LLM_MODEL=google/gemma-4-26b-a4b-it:free` (free models only, see .env.example for fallbacks)
- **OpenAI**: https://platform.openai.com/api-keys
  - `LLM_BASE_URL=https://api.openai.com/v1`
  - `LLM_MODEL=gpt-4o-mini`
- **Hack Club AI**: if you have access, set `LLM_BASE_URL` to the
  Hack Club AI endpoint and `LLM_API_KEY` to your key.

### 3. Run it locally

```bash
cd gremlin-bot
npm install
cp .env.example .env
# edit .env and fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, LLM_API_KEY
npm start
```

You should see:

```
The Gremlin is awake in C0CLXF7ECRF. Bot user: U...
LLM: google/gemma-4-26b-a4b-it:free via https://openrouter.ai/api/v1
Reply mode: every message in the channel
```

Then post in #sami9889s--random--ahh-channel and it should reply.
Try `!gremlin help`.

Run the tests with:

```bash
npm test
```

### 4. Keep it running (pick one)

The bot only replies while it is running. Your laptop is fine for
testing, but it stops when your laptop sleeps. For 24/7, use a free
host:

- **Replit**: import this folder, add the same env vars as Secrets,
  set the Run command to `npm start`. Use a free Repl with Always On
  if you have it, otherwise it sleeps when idle.
- **Fly.io** (free allowance): `fly launch`, `fly secrets set
  SLACK_BOT_TOKEN=... SLACK_APP_TOKEN=... LLM_API_KEY=...`,
  `fly deploy`. No public URL is needed, Socket Mode connects out.
- **Railway**: create a project from this folder, add the env vars,
  deploy. The free trial covers a small bot like this.

## Files

- `src/index.js` - Slack Bolt app, Socket Mode, event handling, LLM call
- `src/gremlin.js` - pure logic: commands, reply rules, fallback replies,
  LLM output parsing (unit-tested, no Slack dependency)
- `prompt/prompt.md` - the Gremlin's system prompt and personality
- `test/gremlin.test.js` - tests, run with `npm test`
- `.env.example` - all env vars, with examples
- `package.json` - dependencies: @slack/bolt, dotenv

## Safety

If someone asks it to stop, it stops. If someone is upset
or in crisis, it drops the character. It roasts takes, not people,
no sexual jokes, no slurs. The bot owner (Sami) can kick the bot
from the channel at any time, and `!gremlin leave` / `@gremlin !stop`
work in any thread.

## Credits

- Built for Sami9889 (Samrath Singh), Hack Club Slack, November 2026
- MIT License

## Running here

Socket Mode websockets fail through this VM's egress proxy, so use polling mode here: `npm run start:poll` (src/poll.js, plain HTTPS fetch). On Replit / Fly.io / Railway, normal `npm start` with Socket Mode works. Polling mode also welcomes new joiners and guards the channel from spam / @everyone / dodgy links.

## Brain: one big brain made of tiny models

`src/brain.js` asks up to 5 small free models at the same time, in parallel.
If only 1 answers, that reply is used. If 2 or more answer, the first
model that answered is asked to combine the best parts into one reply,
2 to 4 lines, in Gremlin voice. If the combine step fails, the best
scored reply is picked (on topic, good length). If no model answers,
it falls back to the smart canned replies in `src/gremlin.js`.
Note: asking 5 models at once uses 5 requests, so the OpenRouter free
daily limit runs out faster. That is the tradeoff for a better reply.
