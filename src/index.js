// The Gremlin - Slack bot for Sami's Hack Club channel.
// Built from scratch, inspired by sebashtioon's the-warden, not a copy.
// Warden runs on Cloudflare Workers with KV storage; Gremlin runs on
// Slack Bolt with Socket Mode, which is simpler to run on a laptop,
// Replit, Fly.io, or Railway. No public URL needed, no KV needed.
//
// Env vars: see .env.example. LLM key is optional, without it the bot
// uses canned gremlin replies from src/gremlin.js.

require("dotenv").config();
const { App } = require("@slack/bolt");
const {
  HOME_CHANNEL_ID,
  HELP_TEXT,
  RANDOM_DROPS,
  pickFallbackReply,
  loadSystemPrompt,
  parseGremlinCommand,
  shouldReply,
  parseLlmOutput,
  buildLlmMessages,
  ADMIN_USER_ID,
  pickWelcome,
  isSpammy,
  pickGuardReply,
} = require("./gremlin");
const { askBrain, askGroq } = require("./brain");

const HOME_CHANNEL = process.env.GREMLIN_CHANNEL_ID || HOME_CHANNEL_ID;
const BOT_USER_ID = process.env.GREMLIN_BOT_USER_ID || "";
const REPLY_TO_ALL = process.env.GREMLIN_REPLY_TO_ALL !== "false";
const RANDOM_PER_DAY = Number(process.env.GREMLIN_RANDOM_PER_DAY || 3);
const THREAD_MEMORY = Number(process.env.GREMLIN_THREAD_MEMORY || 20);

const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "google/gemma-4-26b-a4b-it:free";
const LLM_FALLBACK_MODELS = (process.env.LLM_FALLBACK_MODELS || "google/gemma-4-31b-it:free,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free,liquid/lfm-3-1.7b:free,baidu/ernie-5.5-flash-preview:free").split(",").map(s=>s.trim()).filter(Boolean);
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODELS = (process.env.GROQ_MODELS || "qwen/qwen3.8-27b,openai/gpt-oss-20b,openai/gpt-oss-120b").split(",").map(s=>s.trim()).filter(Boolean);

let systemPrompt = "";
try {
  systemPrompt = loadSystemPrompt();
} catch (err) {
  console.warn("Could not load prompt/prompt.md, using a short fallback prompt:", err.message);
  systemPrompt = "You are The Gremlin, a chaotic funny gremlin in Sami's Slack channel. Keep replies to 1-2 lines. Reply in this exact format:\nreply: <text>\nreaction: <emoji or blank>";
}

// In-memory state. Fine for one small channel; it resets on restart,
// which is also fine, the bot just forgets old threads.
const threadHistory = new Map(); // "channel:threadTs" -> [{ role, text }]
const joinedThreads = new Set();
const leftThreads = new Map(); // "channel:threadTs" -> expiry timestamp
const seenEvents = new Set(); // dedupe, "channel:eventTs"

function threadKey(channel, threadTs) {
  return `${channel}:${threadTs}`;
}

function isLeft(channel, threadTs) {
  const expiry = leftThreads.get(threadKey(channel, threadTs));
  if (!expiry) return false;
  if (Date.now() > expiry) {
    leftThreads.delete(threadKey(channel, threadTs));
    return false;
  }
  return true;
}

function getHistory(channel, threadTs) {
  return threadHistory.get(threadKey(channel, threadTs)) || [];
}

function pushHistory(channel, threadTs, role, text) {
  const key = threadKey(channel, threadTs);
  const list = threadHistory.get(key) || [];
  list.push({ role, text });
  threadHistory.set(key, list.slice(-THREAD_MEMORY));
}

async function askLlm(history, userText, username) {
  if (!LLM_API_KEY) return null;
  const messages = buildLlmMessages(systemPrompt, history, userText, username);
  const groq = await askGroq({ apiKey: GROQ_API_KEY, models: GROQ_MODELS, messages, userText, systemPrompt }).catch(()=>null);
  if (groq) return groq;
  return askBrain({ baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY, models: [LLM_MODEL, ...LLM_FALLBACK_MODELS], messages, userText, systemPrompt });
}

const DUBBY_LOGO = "https://cdn.shopify.com/s/files/1/0552/7253/8296/files/dubby_png_logo.png?v=1615500378&width=640";
async function postPromo(client, channel){
  const r = await client.chat.postMessage({channel, text: "<!channel> dubby promo! use code SAMI9889 at dubby.gg for 10% off. get it here: https://www.dubby.gg/discount/SAMI9889?ref=doihgpyc", blocks: [{type: "section", text: {type: "mrkdwn", text: "<!channel> dubby promo! use code *SAMI9889* at dubby.gg for *10% off*. sami is a dubby partner, and he is working on a custom peach slushy flavour that tastes like Peach Fanta. get it here: <https://www.dubby.gg/discount/SAMI9889?ref=doihgpyc|dubby.gg/discount/SAMI9889>"}}, {type: "image", image_url: DUBBY_LOGO, alt_text: "Dubby Energy logo"}]});
  return r;
}
async function getDisplayName(client, userId) {
  if (!userId) return "";
  try {
    const info = await client.users.info({ user: userId });
    return (
      info.user?.profile?.display_name ||
      info.user?.profile?.real_name ||
      info.user?.name ||
      ""
    );
  } catch {
    return "";
  }
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.event("message", async ({ event, client, say }) => {
  try {
    if (!event || event.channel !== HOME_CHANNEL) return;
    if (event.bot_id) return;
    if (event.subtype === "channel_join") {
      const name = await getDisplayName(client, event.user);
      await say({ text: pickWelcome(event.user) });
      return;
    }
    if (event.subtype && event.subtype !== "thread_broadcast") return;

    // Dedupe: Slack can deliver the same event twice.
    const dedupeKey = `${event.channel}:${event.ts}`;
    if (seenEvents.has(dedupeKey)) return;
    seenEvents.add(dedupeKey);
    if (seenEvents.size > 1000) seenEvents.clear();

    const text = event.text || "";
    const threadTs = event.thread_ts || event.ts; // always reply in a thread to the message, never as a top-level channel message

    // Commands first, even in a left thread (so !gremlin help still works).
    const command = parseGremlinCommand(text, BOT_USER_ID);
    if (command && (command.type==="say" || command.type==="leave" || command.type==="stop") && event.user !== ADMIN_USER_ID) {
      await say({ text: "nope. only @sami9889 can run that one. gremlin admin only", thread_ts: threadTs });
      return;
    }
    if (command && command.type === "fun" && command.text && command.text.startsWith("dubby promo!")) {
      await postPromo(client, event.channel);
      return;
    }
    if (command) {
      if (command.type === "help") {
        await say({ text: HELP_TEXT, thread_ts: threadTs });
        return;
      }
      if (command.type === "leave" || command.type === "stop") {
        leftThreads.set(threadKey(event.channel, threadTs), Date.now() + 7 * 24 * 60 * 60 * 1000);
        joinedThreads.delete(threadKey(event.channel, threadTs));
        await say({ text: "aight im out. gremlin gone", thread_ts: threadTs });
        return;
      }
      if ((command.type === "say" || command.type === "fun") && command.text) {
        await say(command.channel ? { text: command.text } : { text: command.text, thread_ts: threadTs });
        return;
      }
      if (command.type === "unknown") {
        await say({ text: "that is not a gremlin command. try !gremlin help", thread_ts: threadTs });
        return;
      }
    }

    if (isSpammy(text)) {
      await say({ text: pickGuardReply(), thread_ts: threadTs });
      return;
    }

    if (isLeft(event.channel, threadTs)) return;

    const leftSet = new Set([...leftThreads.keys()]);
    if (!shouldReply(event, {
      homeChannelId: HOME_CHANNEL,
      botUserId: BOT_USER_ID,
      replyToAll: REPLY_TO_ALL,
      leftThreads: leftSet,
      joinedThreads,
    })) return;

    const username = await getDisplayName(client, event.user);
    const history = getHistory(event.channel, threadTs);
    pushHistory(event.channel, threadTs, "user", text);

    let reply = "";
    let reaction = "";

    const llm = await askLlm(history, text, username).catch((err) => {
      console.warn("LLM error, falling back:", err.message);
      return null;
    });

    if (llm && llm.reply) {
      reply = llm.reply;
      reaction = llm.reaction;
    } else {
      reply = pickFallbackReply(text, username);
    }

    if (reaction) {
      try {
        await client.reactions.add({
          channel: event.channel,
          timestamp: event.ts,
          name: reaction,
        });
      } catch {
        // Emoji may not exist in this workspace. Ignore it.
      }
    }

    if (reply) {
      await say({ text: reply, thread_ts: threadTs });
      pushHistory(event.channel, threadTs, "gremlin", reply);
      joinedThreads.add(threadKey(event.channel, threadTs));
    }
  } catch (err) {
    console.error("Gremlin message handler error:", err);
  }
});

// Random unprompted gremlin drops, a few times a day at most.
// Off when GREMLIN_RANDOM_PER_DAY is 0.
if (RANDOM_PER_DAY > 0) {
  const intervalMs = (24 * 60 * 60 * 1000) / RANDOM_PER_DAY;
  setInterval(async () => {
    try {
      const drop = RANDOM_DROPS[Math.floor(Math.random() * RANDOM_DROPS.length)];
      await app.client.chat.postMessage({ channel: HOME_CHANNEL, text: drop });
    } catch (err) {
      console.warn("Random gremlin drop failed:", err.message);
    }
  }, intervalMs);
}

(async () => {
  await app.start();
  const botId = BOT_USER_ID || "(set GREMLIN_BOT_USER_ID to enable @gremlin !stop matching)";
  console.log(`The Gremlin is awake in ${HOME_CHANNEL}. Bot user: ${botId}`);
  console.log(`LLM: ${LLM_API_KEY ? `${LLM_MODEL} via ${LLM_BASE_URL}` : "none, using canned replies"}`);
  console.log(`Reply mode: ${REPLY_TO_ALL ? "every message in the channel" : "only mentions / gremlin"}`);
})();
