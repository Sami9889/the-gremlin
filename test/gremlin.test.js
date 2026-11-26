// Tests for The Gremlin. Run: npm test
// Uses only Node's built-in test runner, no extra dependencies.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const gremlin = require("../src/gremlin");

test("prompt exists and is Gremlin, not Warden", () => {
  const prompt = fs.readFileSync(path.join(__dirname, "..", "prompt", "prompt.md"), "utf8");
  assert.match(prompt, /Gremlin/);
  assert.match(prompt, /gremlin mode/);
  assert.match(prompt, /Dubby/);
  assert.match(prompt, /Reply in a thread to the message you are replying to, always/);
  // No Warden stuff at all in the prompt, not even in a do-not list.
  assert.doesNotMatch(prompt, /warden/i);
  assert.doesNotMatch(prompt, /guard/i);
  assert.doesNotMatch(prompt, /moderator/i);
  assert.doesNotMatch(prompt, /bouncer/i);
  assert.doesNotMatch(prompt, /go to the hole/i);
  assert.doesNotMatch(prompt, /cheese/i);
  assert.doesNotMatch(prompt, /canberra is better/i);
});

test("commands parse", () => {
  assert.equal(gremlin.parseGremlinCommand("!gremlin help").type, "help");
  assert.equal(gremlin.parseGremlinCommand("!gremlin leave").type, "leave");
  assert.equal(gremlin.parseGremlinCommand("!gremlin stop").type, "leave");
  assert.equal(gremlin.parseGremlinCommand("@gremlin !stop").type, "stop");
  assert.equal(gremlin.parseGremlinCommand("<@U123|gremlin> !stop", "U123").type, "stop");
  assert.deepEqual(gremlin.parseGremlinCommand("!gremlin say hello world"), {
    type: "say",
    text: "hello world",
  });
  assert.equal(gremlin.parseGremlinCommand("hello world"), null);
  assert.equal(gremlin.parseGremlinCommand("!gremlin frobnicate").type, "unknown");
});

test("## hides a message from the gremlin", () => {
  assert.equal(gremlin.isHiddenFromGremlin("## do not reply to this"), true);
  assert.equal(gremlin.isHiddenFromGremlin("hello"), false);
});

test("shouldReply respects channel, bots, and left threads", () => {
  const base = {
    homeChannelId: "C0CLXF7ECRF",
    botUserId: "U123",
    replyToAll: true,
    leftThreads: new Set(),
    joinedThreads: new Set(),
  };
  assert.equal(gremlin.shouldReply({ channel: "C0CLXF7ECRF", text: "hi", ts: "1" }, base), true);
  assert.equal(gremlin.shouldReply({ channel: "C999", text: "hi", ts: "1" }, base), false);
  assert.equal(gremlin.shouldReply({ channel: "C0CLXF7ECRF", text: "hi", ts: "1", bot_id: "B1" }, base), false);
  assert.equal(gremlin.shouldReply({ channel: "C0CLXF7ECRF", text: "## hi", ts: "1" }, base), false);
  const left = { ...base, leftThreads: new Set(["C0CLXF7ECRF:1"]) };
  assert.equal(gremlin.shouldReply({ channel: "C0CLXF7ECRF", text: "hi", ts: "1" }, left), false);
});

test("shouldReply in mention-only mode", () => {
  const opts = {
    homeChannelId: "C0CLXF7ECRF",
    botUserId: "U123",
    replyToAll: false,
    leftThreads: new Set(),
    joinedThreads: new Set(),
  };
  assert.equal(gremlin.shouldReply({ channel: "C0CLXF7ECRF", text: "hi", ts: "1" }, opts), false);
  assert.equal(gremlin.shouldReply({ channel: "C0CLXF7ECRF", text: "hey gremlin", ts: "1" }, opts), true);
  assert.equal(gremlin.shouldReply({ channel: "C0CLXF7ECRF", text: "hey <@U123>", ts: "1" }, opts), true);
});

test("fallback replies hit the right keywords", () => {
  assert.match(gremlin.pickFallbackReply("i love dubby", "sami"), /SAMI9889/);
  assert.match(gremlin.pickFallbackReply("my code is broken", "sami"), /already broken/);
  assert.match(gremlin.pickFallbackReply("give me a snack", "sami"), /snack tax/);
  assert.match(gremlin.pickFallbackReply("rio is cute", "sami"), /dog/i);
  assert.doesNotMatch(gremlin.pickFallbackReply("rio is cute", "sami"), /rio/i);
  assert.match(gremlin.pickFallbackReply("tiny-unity is cool", "sami"), /tiny-unity/i);
  assert.equal(typeof gremlin.pickFallbackReply("random words here", "sami"), "string");
});

test("LLM output parser", () => {
  assert.deepEqual(gremlin.parseLlmOutput("reply: nah\nreaction: loll"), {
    reply: "nah",
    reaction: "loll",
  });
  assert.deepEqual(gremlin.parseLlmOutput("reply: \nreaction: "), { reply: "", reaction: "" });
  assert.deepEqual(gremlin.parseLlmOutput(""), { reply: "", reaction: "" });
  const long = gremlin.parseLlmOutput(`reply: ${"x".repeat(600)}\nreaction: `);
  assert.equal(long.reply.length, 500);
});

test("LLM message builder keeps history bounded", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: "user", text: `msg ${i}` }));
  const msgs = gremlin.buildLlmMessages("system", history, "hello", "sami");
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs.length, 1 + gremlin.MAX_HISTORY + 1);
  assert.match(msgs[msgs.length - 1].content, /sami: hello/);
});
