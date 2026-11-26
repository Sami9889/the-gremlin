// The Gremlin brain - one big brain made of lots of tiny models.
// Asks several small free models at the same time, then combines
// their replies into one good reply. If only one model answers,
// use that one. If none answer, return null and the caller falls
// back to the smart canned replies in gremlin.js.
const { parseLlmOutput } = require("./gremlin");

const ENSEMBLE_SIZE = 5;
// Sami is not paying. Hard caps, far below Groq's free tier
// (14,400 requests/day, 30/min). Once hit, Groq is off for the day
// and the bot falls back to OpenRouter free / Pollinations / canned.
const GROQ_DAILY_CAP = 500;
const GROQ_MINUTE_CAP = 20;
const GROQ_USAGE_FILE = require("node:path").join(__dirname, "..", "groq-usage.json");
const fs = require("node:fs");
function loadGroqUsage() {
  try {
    const d = JSON.parse(fs.readFileSync(GROQ_USAGE_FILE, "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    if (d.date !== today) return { date: today, count: 0, minute: 0, minuteStart: Date.now() };
    return d;
  } catch { return { date: new Date().toISOString().slice(0, 10), count: 0, minute: 0, minuteStart: Date.now() }; }
}
function saveGroqUsage(u) { try { fs.writeFileSync(GROQ_USAGE_FILE, JSON.stringify(u)); } catch {} }
function groqAllowed(n) {
  const u = loadGroqUsage();
  const now = Date.now();
  if (now - (u.minuteStart || 0) > 60000) { u.minute = 0; u.minuteStart = now; }
  if (u.count + n > GROQ_DAILY_CAP) { console.warn("brain: groq daily cap reached", u.count, "/", GROQ_DAILY_CAP); return false; }
  if (u.minute + n > GROQ_MINUTE_CAP) { console.warn("brain: groq minute cap reached"); return false; }
  u.count += n; u.minute += n; saveGroqUsage(u);
  return true;
}

async function callModel(baseUrl, apiKey, model, messages, maxTokens) {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: maxTokens || 200, ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.warn("brain model failed:", model, res.status); return null; }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    if (!raw) { console.warn("brain model returned empty content:", model); return null; }
    const parsed = parseLlmOutput(raw);
    if (!parsed.reply) return null;
    return { model, reply: parsed.reply, reaction: parsed.reaction || "" };
  } catch (e) {
    console.warn("brain model error:", model, e.message);
    return null;
  }
}

// Score a reply: on topic and a good length wins.
function scoreReply(reply, userText) {
  if (!reply) return -100;
  const r = reply.toLowerCase();
  const words = (userText || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 3 && w !== "gremlin");
  let score = 0;
  for (const w of new Set(words)) if (r.includes(w)) score += 3;
  if (reply.length >= 20 && reply.length <= 400) score += 5;
  if (reply.length < 10) score -= 10;
  if (r === (userText || "").toLowerCase()) score -= 20;
  if (/^(yo|nah|lol|ok)\.?$/.test(r.trim())) score -= 10;
  return score;
}

// Web search, free, no key, via Wikipedia. Used when a question needs
// real facts the models may not know. Returns a short fact string or "".
function needsSearch(userText) {
  if (!userText) return false;
  const lower = userText.toLowerCase();
  if (!lower.includes("?")) return false;
  if (/\b(gremlin|snack|dubby|joke|roast|coin|dice|8ball|time|who are you|what are you doing|how are you)\b/.test(lower)) return false;
  return /\b(who|what|when|where|which|how many|how much|how old|is|are|did|does|current|latest|news|today|price|weather|score|won|president|prime minister|capital|population)\b/.test(lower);
}
async function searchWeb(query) {
  try {
    const q = encodeURIComponent(query.replace(/[^a-zA-Z0-9 ]/g, " ").trim().slice(0, 80));
    const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&srlimit=2`, {
      headers: { "User-Agent": "TheGremlin/1.0 (sami-s.dev)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const hit = data?.query?.search?.[0];
    if (!hit) return "";
    const sum = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`, {
      headers: { "User-Agent": "TheGremlin/1.0 (sami-s.dev)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!sum.ok) return `Wikipedia: ${hit.title}: ${hit.snippet.replace(/<[^>]+>/g, "")}`;
    const s = await sum.json();
    const extract = (s.extract || "").slice(0, 400);
    if (!extract) return "";
    console.log("brain: search found:", hit.title);
    return `Wikipedia (${hit.title}): ${extract}`;
  } catch (e) {
    console.warn("brain search failed:", e.message);
    return "";
  }
}
async function withSearch(messages, userText) {
  if (!needsSearch(userText)) return messages;
  const facts = await searchWeb(userText);
  if (!facts) return messages;
  return [...messages, { role: "system", content: `Search results to use in your answer: ${facts} Use these facts to answer properly, in gremlin voice. If they do not answer the question, say so and give your best take anyway.` }];
}

// Pollinations: free, no API key, but 1 reply every 45 seconds per IP.
// Use it only as a last resort when OpenRouter is rate limited.
let lastPollinationsAt = 0;
async function tryPollinations(messages) {
  if (Date.now() - lastPollinationsAt < 50000) return null;
  lastPollinationsAt = Date.now();
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", messages, temperature: 0.9, max_tokens: 200 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.warn("pollinations failed:", res.status); return null; }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    if (!raw) { console.warn("brain model returned empty content:", model); return null; }
    const parsed = parseLlmOutput(raw);
    if (!parsed.reply) return null;
    console.log("brain: pollinations answered");
    return { model: "pollinations/openai", reply: parsed.reply, reaction: parsed.reaction || "" };
  } catch (e) {
    console.warn("pollinations error:", e.message);
    return null;
  }
}

async function askBrain({ baseUrl, apiKey, models, messages, userText, systemPrompt }) {
  if (!apiKey) return null;
  messages = await withSearch(messages, userText);
  const list = (models || []).slice(0, ENSEMBLE_SIZE);
  if (!list.length) return null;
  console.log("brain: asking", list.length, "models at once:", list.join(", "));
  const results = await Promise.all(list.map(m => callModel(baseUrl, apiKey, m, messages, 200)));
  const good = results.filter(Boolean);
  console.log("brain: got", good.length, "replies back");
  if (!good.length) {
    // OpenRouter is rate limited: try Pollinations, free with no key,
    // 1 reply every 45 seconds. If that is also limited, return null
    // and the caller uses the smart canned replies.
    return tryPollinations(messages);
  }
  if (good.length === 1) return good[0];

  // 2 or more replies: combine them into one best reply.
  // Use the first model that answered as the combiner.
  const judgeMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Someone said: ${userText}\n\nHere are replies from several small models. Combine the best parts into ONE reply, 2 to 4 short lines, in the Gremlin voice, on topic, more than 1 thing. Do not just pick one, make it better than all of them.\n\n${good.map((g, i) => `Reply ${i + 1} (${g.model}): ${g.reply}`).join("\n")}\n\nReply in this exact format:\nreply: <text>\nreaction: <emoji or blank>` },
  ];
  const judge = await callModel(baseUrl, apiKey, good[0].model, judgeMessages, 200);
  if (judge && judge.reply) {
    console.log("brain: combined into one reply using", judge.model);
    return judge;
  }
  // Judge failed: pick the best scored reply.
  good.sort((a, b) => scoreReply(b.reply, userText) - scoreReply(a.reply, userText));
  console.log("brain: judge failed, picked best reply from", good[0].model);
  return good[0];
}

// Groq: free, 14,400 requests a day, 30 a minute. Try it first if a key is set.
async function askGroq({ apiKey, models, messages, userText, systemPrompt }) {
  if (!apiKey) return null;
  messages = await withSearch(messages, userText);
  const list = (models || ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"]).slice(0, 3);
  if (!groqAllowed(list.length)) return null;
  console.log("brain: trying groq first:", list.join(", "));
  const results = await Promise.all(list.map(m => callModel("https://api.groq.com/openai/v1", apiKey, m, messages, 200)));
  const good = results.filter(Boolean);
  console.log("brain: groq got", good.length, "replies back");
  if (!good.length) return null;
  if (good.length === 1) return good[0];
  good.sort((a, b) => scoreReply(b.reply, userText) - scoreReply(a.reply, userText));
  return good[0];
}

module.exports = { askBrain, askGroq, callModel, scoreReply, tryPollinations, groqAllowed, GROQ_DAILY_CAP, GROQ_MINUTE_CAP, ENSEMBLE_SIZE, needsSearch, searchWeb };
