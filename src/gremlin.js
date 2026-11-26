// The Gremlin - pure logic, no Slack dependency.
// This file is unit-tested in test/gremlin.test.js and used by src/index.js.

const fs = require("node:fs");
const path = require("node:path");

const HOME_CHANNEL_ID = "C0CLXF7ECRF";
const ADMIN_USER_ID = "U0A21K451GR"; // @sami9889 only
const MAX_HISTORY = 20;

const WELCOME_REPLIES = [
  "yo {name}, welcome to the gremlin channel. snack tax applies. pay up",
  "oh great, another human. welcome {name}. i live under sami's desk and i steal snacks",
  "welcome {name}. gremlin mode on. i broke the build again",
];

// Gremlin just causes chaos in its own channel.

function pickWelcome(name) {
  const r = WELCOME_REPLIES[Math.floor(Math.random() * WELCOME_REPLIES.length)];
  return r.replace("{name}", name ? `<@${name}>` : "human");
}

function isSpammy(text) {
  return false;
}

function pickGuardReply() {
  return "yoink";
}

const JOKES = [
  "why did the gremlin cross the road? to steal snacks on the other side",
  "i told a joke about UDP once. i am not sure if you got it",
  "there are 10 kinds of people. those who understand binary and those who do not",
  "my code works. i have no idea why",
  "i would tell you a joke about an infinite loop, but it never ends",
];
const EIGHTBALL = [
  "yes", "no", "maybe", "ask again later", "definitely not", "absolutely",
  "probably", "no way", "signs point to yes", "gremlin says no",
];
const ROASTS = [
  "that take is so bad even the build refused to compile",
  "bro really said that with his whole chest",
  "that is the worst thing i have heard today, and i live under a desk",
  "your code called, it wants a refund",
  "bold of you to say that with no snacks",
];

let snackTaxCount = 0;

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

const HELP_TEXT = [
  "gremlin commands:",
  "",
  "- !gremlin help -> show this list",
  "- !gremlin leave -> stop replying to this thread",
  "- @gremlin !stop -> stop replying to this thread (anyone can use this)",
  "- !gremlin say <text> -> post it as the gremlin",
  "- start a message with ## to hide it from the gremlin",
  "- i welcome new people and steal their snacks",
  "- !gremlin snack -> steal a snack",
  "- !gremlin dubby -> dubby time",
  "- !gremlin break -> break something",
  "- !gremlin promo -> dubby promo, code SAMI9889",
  "- !gremlin dubby -> dubby time",
  "- !gremlin coin -> flip a coin",
  "- !gremlin dice -> roll a dice",
  "- !gremlin 8ball <question> -> ask the gremlin ball",
  "- !gremlin pick <a> or <b> -> gremlin picks one",
  "- !gremlin rate <thing> -> gremlin rates it out of 10",
  "- !gremlin joke -> a joke",
  "- !gremlin roast <thing> -> roast it",
  "- !gremlin time -> what time is it in Melbourne",
  "- !gremlin snacks -> how much snack tax has been paid",
].join("\n");

const DUBBY_PROMOS = [
  "dubby time. code SAMI9889 for 10% off at dubby.gg. yoink",
];

const RANDOM_DROPS = [
  "gremlin mode",
  "yoink, snack tax",
  "i did not break it, it was already broken",
  "out of dubby again. this is a crisis",
  "going to sleep. do not touch my snacks",
  "ok im back. what did i miss",
  "i broke the build again and i am not sorry",
  "someone say dubby and i appear",
];

const FALLBACK_REPLIES = [
  "nah, that is a bad take. gremlin mode on and i am stealing your snacks for it",
  "gremlin mode. i broke the build again and i am not sorry, what did you break today",
  "yoink, snack tax. pay up again next time",
  "i did not break it, it was already broken",
  "ok and?",
  "that is a bold take from someone with no snacks",
  "snack tax. pay up",
  "i am going to sleep now, deal with it",
  "lol. lmao even",
  "source: trust me bro, i am a gremlin",
];

// Smart fallback replies, used when the LLM is down.
// OpenRouter free models are rate limited most of the day, so this IS
// the brain most of the time. It has to actually answer what was said,
// not pick a random line. Every reply is 2 to 4 lines and stays on topic.
function cleanText(text) {
  return (text || "")
    .replace(/\s*\*Sent using\*.*$/i, "")
    .replace(/<@[^>]+>/g, "")
    .replace(/^!?gremlin[\s,:]*/i, "")
    .trim();
}
function pickFallbackReply(text, username) {
  const clean = cleanText(text);
  const lower = clean.toLowerCase();
  const name = username || "you";

  if (/\b(what are you doing|whats up|what's up|what are u doing|wyd)\b/.test(lower)) {
    return "under sami's desk, counting stolen snacks and poking tiny-unity until it breaks. what are you doing then, apart from talking to a gremlin";
  }
  if (/\b(who are you|what are you|are you a bot)\b/.test(lower)) {
    return "i am the gremlin. i live under sami's desk, i steal snacks, i break builds, and i talk in this channel. that is the whole job";
  }
  if (/\b(who am i|who is sami|do you know me)\b/.test(lower)) {
    return `you are ${name}. sami's channel, sami's rules, and i still steal your snacks. what do you want`;
  }
  if (/\b(how are you|how's it going|how is it going)\b/.test(lower)) {
    return "i am good, i just stole a snack and blamed you for it. how are you then, apart from asking a gremlin how it is";
  }
  if (/\b(weather|raining|hot today|cold today)\b/.test(lower)) {
    return "i do not know the weather, i live under a desk in melbourne. look out the window, that is faster than asking me. and bring me a snack while you are up";
  }
  if (/\b(what time|what is the time|time is it)\b/.test(lower)) {
    const now = new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", hour: "numeric", minute: "2-digit" });
    return `it is ${now} in melbourne. that is the time, and you still owe me snack tax`;
  }
  if (/\b(are you stupid|are u stupid|you are stupid|ur stupid|you are dumb|are you dumb)\b/.test(lower)) {
    return "nah, im just built different. under a desk, specifically. and i am smarter than the build you broke today, what did you break then";
  }
  if (/\b(dubby|energy drink|gamer supps)\b/.test(lower)) {
    return "dubby. code SAMI9889 for 10% off at dubby.gg. sami is working on a peach slushy flavour that tastes like peach fanta, so keep an eye out for that. get it here: https://www.dubby.gg/discount/SAMI9889?ref=doihgpyc";
  }
  if (/\b(broke|broken|bug|error|crash|doesnt work|doesn't work|not working)\b/.test(lower)) {
    return "i did not break it, it was already broken. what broke this time then, and did you try turning it off and on again";
  }
  if (/\b(snacks?|food|hungry|pizza)\b/.test(lower)) {
    return "yoink, snack tax. that is the rule, you talk in my channel and you pay snacks. what snack are you bringing me then";
  }
  if (/\b(rio|dog)\b/.test(lower)) {
    return "the dog is the only one in this channel with sense. i just steal snacks and blame you for it";
  }
  if (/\b(tiny.?unity|game engine|unity)\b/.test(lower)) {
    return "tiny-unity is free and open source, sami is building it so people do not have to pay for an engine. unity wishes it was this free. what part of it are you working on";
  }
  if (/\b(code|coding|python|javascript|github)\b/.test(lower)) {
    return "gremlin mode activated and i immediately broke it. what are you coding then, and does it actually work or did you just say it works";
  }
  if (/^(hello|hi|hey|yo|hii+|ello|sup|hola)\b/.test(lower)) {
    return `yo ${name}. welcome to the gremlin channel, snack tax applies. what are you doing here then`;
  }
  if (/\b(bully|roast|attack|fight|insult)\b/.test(lower)) {
    return "nah, i am not your bully bot. go bully yourself, i am too busy stealing snacks under the desk. who are you even trying to bully then";
  }
  if (/\?$/.test(clean)) {
    const topic = clean.replace(/\?$/, "").slice(0, 60);
    return `you asked "${topic}" - i do not know that one, i am a gremlin not google. ask sami, he is the one who knows things. what else you got`;
  }
  if (clean) {
    return `alright, ${clean.slice(0, 60)}. what do you want me to do with that then, i am a gremlin not a mind reader. snack tax still applies`;
  }
  return "yoink, snack tax. what did you want then";
}

function loadSystemPrompt() {
  const file = path.join(__dirname, "..", "prompt", "prompt.md");
  return fs.readFileSync(file, "utf8");
}

// Parse a !gremlin command. Returns { type } or null if not a command.
// type is one of: help, leave, stop, say
function parseGremlinCommand(text, botUserId) {
  if (!text) return null;
  const trimmed = text.replace(/\s*\*Sent using\*.*$/i, "").trim();

  // @gremlin !stop  (mention form, anyone can use it)
  if (botUserId) {
    const mentionStop = new RegExp(
      `^(?:<@${botUserId}(?:\\|[^>]*)?>|@?gremlin)[\\s,:]*!stop$`,
      "i"
    );
    if (mentionStop.test(trimmed)) return { type: "stop" };
  }
  if (/^@?gremlin[\s,:]*!stop$/i.test(trimmed)) return { type: "stop" };

  const match = trimmed.match(/^!gremlin\s+(.+)$/is);
  if (!match) return null;

  const rest = match[1].trim();
  const lower = rest.toLowerCase();
  if (lower === "help") return { type: "help" };
  if (lower === "snack") { snackTaxCount++; return { type: "fun", text: `yoink, snack tax. that is ${snackTaxCount} snack tax paid so far` }; }
  if (lower === "snacks") return { type: "fun", text: `${snackTaxCount} snack tax paid so far. pay up` };
  if (lower === "coin") return { type: "fun", text: `coin flip: ${Math.random() < 0.5 ? "heads" : "tails"}` };
  if (lower === "dice") return { type: "fun", text: `you rolled a ${Math.floor(Math.random()*6)+1}` };
  if (lower.startsWith("8ball")) return { type: "fun", text: pick(EIGHTBALL) };
  if (lower.startsWith("pick ")) { const opts = rest.slice(5).split(/\s+or\s+/i).map(s=>s.trim()).filter(Boolean); if (opts.length >= 2) return { type: "fun", text: `i pick: ${pick(opts)}` }; return { type: "fun", text: "give me two things with or between them" }; }
  if (lower.startsWith("rate ")) { const thing = rest.slice(5).trim(); return { type: "fun", text: `${thing} gets ${Math.floor(Math.random()*11)}/10 from me` }; }
  if (lower === "joke") return { type: "fun", text: pick(JOKES) };
  if (lower.startsWith("roast")) { const thing = rest.slice(5).trim() || "you"; return { type: "fun", text: `${thing}: ${pick(ROASTS)}` }; }
  if (lower === "time") { const now = new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", hour: "numeric", minute: "2-digit" }); return { type: "fun", text: `it is ${now} in Melbourne` }; }
  if (lower === "dubby") return { type: "fun", text: "dubby. code SAMI9889 for 10% off at dubby.gg. that is all i have to say. get it here: https://www.dubby.gg/discount/SAMI9889?ref=doihgpyc", channel: true };
  if (lower === "promo") return { type: "fun", text: "dubby promo! use code SAMI9889 at dubby.gg for 10% off. sami is a dubby partner, and he is working on a custom peach slushy flavour that tastes like Peach Fanta. get it here: https://www.dubby.gg/discount/SAMI9889?ref=doihgpyc" };
  if (lower === "break") return { type: "fun", text: "i did not break it, it was already broken" };
  if (lower === "leave" || lower === "stop") return { type: "leave" };
  if (lower.startsWith("say ")) {
    return { type: "say", text: rest.slice(4).trim() };
  }
  return { type: "unknown", text: rest };
}

function isHiddenFromGremlin(text) {
  return (text || "").trim().startsWith("##");
}

function mentionsGremlin(text, botUserId) {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (lower.includes("gremlin")) return true;
  if (botUserId && text.includes(`<@${botUserId}`)) return true;
  return false;
}

// Decide whether the bot should reply to this event.
// event: { channel, user, bot_id, subtype, text, thread_ts }
// opts: { homeChannelId, botUserId, replyToAll, leftThreads:Set<string> }
function shouldReply(event, opts) {
  if (!event || !event.text) return false;
  if (event.channel !== opts.homeChannelId) return false;
  if (event.bot_id) return false; // never reply to bots, including itself
  if (event.subtype && event.subtype !== "thread_broadcast") return false;
  if (isHiddenFromGremlin(event.text)) return false;

  const threadKey = event.thread_ts || event.ts;
  if (opts.leftThreads && opts.leftThreads.has(`${event.channel}:${threadKey}`)) {
    return false;
  }

  if (opts.replyToAll) return true;
  if (mentionsGremlin(event.text, opts.botUserId)) return true;
  // Already in a thread the gremlin joined: keep talking there.
  if (event.thread_ts && opts.joinedThreads && opts.joinedThreads.has(`${event.channel}:${event.thread_ts}`)) {
    return true;
  }
  return false;
}

// Parse the LLM's 2-line output format (see prompt/prompt.md).
// reply: <text> / reaction: <emoji>
function parseLlmOutput(raw) {
  const out = { reply: "", reaction: "" };
  if (!raw) return out;
  for (const line of String(raw).split("\n")) {
    const reply = line.match(/^reply:\s*(.*)$/i);
    if (reply) out.reply = reply[1].trim();
    const reaction = line.match(/^reaction:\s*([a-z0-9_+\-]+)\s*$/i);
    if (reaction) out.reaction = reaction[1].trim();
  }
  // Guardrails: keep it short, strip surrounding quotes.
  out.reply = out.reply.replace(/^["']|["']$/g, "").trim().slice(0, 500);
  return out;
}

function buildLlmMessages(systemPrompt, history, userText, username) {
  const messages = [{ role: "system", content: systemPrompt }];
  for (const item of (history || []).slice(-MAX_HISTORY)) {
    messages.push({
      role: item.role === "gremlin" ? "assistant" : "user",
      content: item.text,
    });
  }
  messages.push({
    role: "user",
    content: username ? `${username}: ${userText}` : userText,
  });
  return messages;
}

module.exports = {
  HOME_CHANNEL_ID,
  MAX_HISTORY,
  HELP_TEXT,
  RANDOM_DROPS,
  FALLBACK_REPLIES,
  pickFallbackReply,
  cleanText,
  loadSystemPrompt,
  parseGremlinCommand,
  isHiddenFromGremlin,
  mentionsGremlin,
  shouldReply,
  parseLlmOutput,
  ADMIN_USER_ID,
  DUBBY_PROMOS,
  pickWelcome,
  isSpammy,
  pickGuardReply,
  WELCOME_REPLIES,
  buildLlmMessages,
};
