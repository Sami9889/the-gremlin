// The Gremlin - polling mode for Muse VM, where Slack Socket Mode websockets
// fail through the egress proxy. Uses plain HTTPS fetch, which works here.
// Same logic as src/index.js, just a different transport.
// Run: npm run start:poll
require("dotenv").config();
const {
  HOME_CHANNEL_ID, HELP_TEXT, RANDOM_DROPS, pickFallbackReply, loadSystemPrompt,
  parseGremlinCommand, shouldReply, parseLlmOutput, buildLlmMessages,
  pickWelcome, isSpammy, pickGuardReply, ADMIN_USER_ID,
} = require("./gremlin");
const { askBrain, askGroq } = require("./brain");

const HOME_CHANNEL = process.env.GREMLIN_CHANNEL_ID || HOME_CHANNEL_ID;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const BOT_USER_ID = process.env.GREMLIN_BOT_USER_ID || "U0CM5DUJK7W";
const REPLY_TO_ALL = process.env.GREMLIN_REPLY_TO_ALL !== "false";
const RANDOM_PER_DAY = Number(process.env.GREMLIN_RANDOM_PER_DAY || 3);
const THREAD_MEMORY = Number(process.env.GREMLIN_THREAD_MEMORY || 20);
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "google/gemma-4-26b-a4b-it:free";
const LLM_FALLBACK_MODELS = (process.env.LLM_FALLBACK_MODELS || "").split(",").map(s=>s.trim()).filter(Boolean);
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODELS = (process.env.GROQ_MODELS || "qwen/qwen3.8-27b,openai/gpt-oss-20b,openai/gpt-oss-120b").split(",").map(s=>s.trim()).filter(Boolean);

let systemPrompt = "";
try { systemPrompt = loadSystemPrompt(); } catch { systemPrompt = "You are The Gremlin, a chaotic funny gremlin in Sami's Slack channel. Keep replies to 1-2 lines. Reply in this exact format:\nreply: <text>\nreaction: <emoji or blank>"; }

const threadHistory = new Map();
const joinedThreads = new Set();
const leftThreads = new Map();
const seen = new Set();
function threadKey(c, t){ return `${c}:${t}`; }
function isLeft(c, t){ const e = leftThreads.get(threadKey(c,t)); if(!e) return false; if(Date.now()>e){ leftThreads.delete(threadKey(c,t)); return false; } return true; }
function getHistory(c,t){ return threadHistory.get(threadKey(c,t)) || []; }
function pushHistory(c,t,r,txt){ const k=threadKey(c,t); const l=getHistory(c,t); l.push({role:r,text:txt}); threadHistory.set(k,l.slice(-THREAD_MEMORY)); }

async function slack(method, body){
  const res = await fetch(`https://slack.com/api/${method}`, {method:"POST", headers:{Authorization:`Bearer ${BOT_TOKEN}`,"Content-Type":"application/json"}, body: JSON.stringify(body||{}), signal: AbortSignal.timeout(10000)});
  return res.json();
}
async function postMessage(channel, text, thread_ts){
  if(thread_ts) knownThreads.add(thread_ts);
  console.log("posting", text.slice(0,80));
  const r = await slack("chat.postMessage", {channel, text, thread_ts});
  console.log("post ok:", r.ok, r.error||"");
  if(!r.ok) console.warn("postMessage failed", r.error);
  return r;
}
const DUBBY_LOGO = "https://cdn.shopify.com/s/files/1/0552/7253/8296/files/dubby_png_logo.png?v=1615500378&width=640";
async function postPromo(channel){
  const r = await slack("chat.postMessage", {channel, text: "<!channel> dubby promo! use code SAMI9889 at dubby.gg for 10% off. get it here: https://www.dubby.gg/discount/SAMI9889?ref=doihgpyc", blocks: [{type: "section", text: {type: "mrkdwn", text: "<!channel> dubby promo! use code *SAMI9889* at dubby.gg for *10% off*. sami is a dubby partner, and he is working on a custom peach slushy flavour that tastes like Peach Fanta. get it here: <https://www.dubby.gg/discount/SAMI9889?ref=doihgpyc|dubby.gg/discount/SAMI9889>"}}, {type: "image", image_url: DUBBY_LOGO, alt_text: "Dubby Energy logo"}]});
  console.log("promo post ok:", r.ok, r.error||"");
  return r;
}
async function getDisplayName(userId){
  try { const r = await slack("users.info", {user:userId}); return r.user?.profile?.display_name || r.user?.profile?.real_name || r.user?.name || ""; } catch { return ""; }
}
async function askLlm(history, userText, username){
  if(!LLM_API_KEY) return null;
  const messages = buildLlmMessages(systemPrompt, history, userText, username);
  const groq = await askGroq({ apiKey: GROQ_API_KEY, models: GROQ_MODELS, messages, userText, systemPrompt }).catch(()=>null);
  if (groq) return groq;
  return askBrain({ baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY, models: [LLM_MODEL, ...LLM_FALLBACK_MODELS], messages, userText, systemPrompt });
}

async function handle(event){
  console.log("handle", event.ts, JSON.stringify(event.text||"").slice(0,120));
  if(!event || event.channel !== HOME_CHANNEL) return;
  if(event.bot_id) return;
  if(event.subtype === "channel_join"){
    if(event.user === "U08G06U8PS8") return; // @at-channel is not a real person, do not welcome it
    await postMessage(event.channel, pickWelcome(event.user));
    return;
  }
  if(event.subtype && event.subtype !== "thread_broadcast") return;
  const key = `${event.channel}:${event.ts}`;
  if(seen.has(key)) return; seen.add(key); if(seen.size>1000) seen.clear();
  const text = event.text || "";
  if(event.thread_ts) knownThreads.add(event.thread_ts);
  if(event.ts) knownThreads.add(event.ts);
  const threadTs = event.thread_ts || event.ts; // always reply in a thread to the message, never as a top-level channel message
  const command = parseGremlinCommand(text, BOT_USER_ID);
  console.log("command:", JSON.stringify(command));
  if (command && (command.type==="say" || command.type==="leave" || command.type==="stop") && event.user !== ADMIN_USER_ID) {
    await postMessage(event.channel, "nope. only @sami9889 can run that one. gremlin admin only", threadTs);
    return;
  }
  if(command){
    if(command.type==="help"){ await postMessage(event.channel, HELP_TEXT, threadTs); return; }
    if(command.type==="leave"||command.type==="stop"){ leftThreads.set(threadKey(event.channel,threadTs), Date.now()+7*24*60*60*1000); joinedThreads.delete(threadKey(event.channel,threadTs)); await postMessage(event.channel, "aight im out. gremlin gone", threadTs); return; }
    if(command.type==="fun"&&command.text&&command.text.startsWith("dubby promo!")){ await postPromo(event.channel); return; }
    if((command.type==="say"||command.type==="fun")&&command.text){ await postMessage(event.channel, command.text, command.channel ? undefined : threadTs); return; }
    if(command.type==="unknown"){ await postMessage(event.channel, "that is not a gremlin command. try !gremlin help", threadTs); return; }
  }
  if(isSpammy(text)){ await postMessage(event.channel, pickGuardReply(), threadTs); return; }
  if(isLeft(event.channel, threadTs)) return;
  if(!shouldReply(event, {homeChannelId:HOME_CHANNEL, botUserId:BOT_USER_ID, replyToAll:REPLY_TO_ALL, leftThreads:new Set([...leftThreads.keys()]), joinedThreads})) return;
  const username = await getDisplayName(event.user);
  const history = getHistory(event.channel, threadTs);
  pushHistory(event.channel, threadTs, "user", text);
  let reply="", reaction="";
  const llm = await askLlm(history, text, username).catch(()=>null);
  if(llm && llm.reply){ reply=llm.reply; reaction=llm.reaction; } else { reply=pickFallbackReply(text, username); }
  if(reaction){ try{ await slack("reactions.add", {channel:event.channel, timestamp:event.ts, name:reaction}); }catch{} }
  if(reply){ await postMessage(event.channel, reply, threadTs); pushHistory(event.channel, threadTs, "gremlin", reply); joinedThreads.add(threadKey(event.channel, threadTs)); }
}

let lastTs = ((Date.now()/1000) - 120).toString();
const STARTED_AT = Date.now()/1000;
const knownThreads = new Set(); // thread parent ts values to poll for replies
const threadLastTs = new Map();
async function poll(){
  try{
    const r = await slack("conversations.history", {channel:HOME_CHANNEL, oldest:lastTs, limit:20});
    if(!r.ok){ console.warn("history failed", r.error); return; }
    console.log("poll ok, messages:", (r.messages||[]).length);
    const msgs = (r.messages||[]).slice().reverse();
    for(const m of msgs){
      if(parseFloat(m.ts) > parseFloat(lastTs)) lastTs = m.ts;
      if(m.reply_count) knownThreads.add(m.ts);
      if(m.thread_ts) knownThreads.add(m.thread_ts);
      m.channel = HOME_CHANNEL; await handle(m);
    }
    // Poll every thread we know about, so a message in a thread gets
    // an auto reply without anyone having to say gremlin again.
    for(const parentTs of [...knownThreads]){
      try{
        const trRes = await fetch(`https://slack.com/api/conversations.replies?channel=${HOME_CHANNEL}&ts=${parentTs}`, {headers:{Authorization:`Bearer ${BOT_TOKEN}`}, signal: AbortSignal.timeout(10000)});
        const tr = await trRes.json();
        if(!tr.ok) continue;
        const replies = (tr.messages||[]).slice().sort((a,b)=>parseFloat(a.ts)-parseFloat(b.ts));
        for(const m of replies){
          if(m.ts === parentTs) continue;
          const last = threadLastTs.get(parentTs) || "0";
          if(parseFloat(m.ts) <= parseFloat(last)) continue;
          if(parseFloat(m.ts) < STARTED_AT) { threadLastTs.set(parentTs, m.ts); continue; }
          threadLastTs.set(parentTs, m.ts);
          m.channel = HOME_CHANNEL; m.thread_ts = parentTs;
          await handle(m);
        }
      }catch(e){ console.warn("thread poll error", e.message); }
    }
  }catch(e){ console.warn("poll error", e.message); }
}
(async()=>{
  console.log(`The Gremlin is awake in ${HOME_CHANNEL} (polling mode). Bot user: ${BOT_USER_ID}`);
  // Seed known threads from recent history, so threads started before
  // this restart still get auto replies.
  try{
    const hr = await slack("conversations.history", {channel:HOME_CHANNEL, limit:20});
    for(const m of (hr.messages||[])){ if(m.reply_count) { knownThreads.add(m.ts); threadLastTs.set(m.ts, m.latest_reply || m.ts); } if(m.thread_ts) knownThreads.add(m.thread_ts); }
    console.log("seeded threads:", [...knownThreads].length);
  }catch(e){ console.warn("thread seed failed", e.message); }
  console.log(`LLM: ${LLM_API_KEY ? `${LLM_MODEL} via ${LLM_BASE_URL}` : "none, using canned replies"}`);
  await poll();
  setInterval(poll, 3000);
  if(RANDOM_PER_DAY>0){
    setInterval(async()=>{
      const drop = RANDOM_DROPS[Math.floor(Math.random()*RANDOM_DROPS.length)];
      await postMessage(HOME_CHANNEL, drop);
    }, (24*60*60*1000)/RANDOM_PER_DAY);
  }
})();
