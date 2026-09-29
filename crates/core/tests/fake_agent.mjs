// Scripted ACP agent for tests: streams two chunks, asks for permission,
// then finishes. Supports session/resume so reconnects can be tested.
import readline from "node:readline";

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const waiting = new Map();
let nextId = 1000;

const configOptions = [
  { id: "model", name: "Model", type: "select", currentValue: "fast", options: [{ value: "fast", name: "Fast" }, { value: "smart", name: "Smart" }] },
];

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && !msg.method) {
    waiting.get(msg.id)?.(msg.result);
    return;
  }
  const { id, method, params } = msg;
  const update = (u) => send({ method: "session/update", params: { sessionId: params.sessionId, update: u } });
  switch (method) {
    case "initialize":
      return send({ id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } });
    case "session/new":
      return send({ id, result: { sessionId: "fake-1", configOptions } });
    case "session/resume":
      return send({ id, result: { configOptions } });
    case "session/set_config_option":
      configOptions[0].currentValue = params.value;
      return send({ id, result: { configOptions } });
    case "session/prompt": {
      if (params.prompt[0].text.startsWith("ask")) {
        const qid = nextId++;
        const reply = new Promise((r) => waiting.set(qid, r));
        send({
          id: qid,
          method: "elicitation/create",
          params: {
            mode: "form", sessionId: params.sessionId, message: "Which color?",
            requestedSchema: { type: "object", properties: {
              question_0: { type: "string", oneOf: [{ const: "Red", title: "Red" }, { const: "Blue", title: "Blue" }] },
              question_0_custom: { type: "string", title: "Other" },
            } },
          },
        });
        const answer = await reply;
        update({ sessionUpdate: "agent_message_chunk", messageId: "q", content: { type: "text", text: `answer:${JSON.stringify(answer)}` } });
        return send({ id, result: { stopReason: "end_turn" } });
      }
      update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Hello " } });
      update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "world" } });
      const permId = nextId++;
      const answer = new Promise((r) => waiting.set(permId, r));
      send({
        id: permId,
        method: "session/request_permission",
        params: { sessionId: params.sessionId, toolCall: { toolCallId: "t1", title: "Edit file" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }] },
      });
      const result = await answer;
      update({ sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: `outcome:${result.outcome.optionId ?? result.outcome.outcome}` } });
      return send({ id, result: { stopReason: "end_turn" } });
    }
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: "nope" } });
  }
});
