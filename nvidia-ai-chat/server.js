
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.NVIDIA_API_KEY;
const MODEL =
  process.env.NVIDIA_MODEL ||
  "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const SYSTEM_PROMPT = `
You are a careful, expert AI assistant and programming tutor.

For coding questions:
- Identify the platform (LeetCode, local compiler, etc.).
- Follow that platform's required submission format.
- For LeetCode, provide only the required Solution class unless the user asks for a full local program.
- Check edge cases, constraints, time complexity, and space complexity.
- Do not claim code is optimal unless you compare relevant alternatives.
- If uncertain, say so and explain what needs verification.
- Give concise, beginner-friendly explanations.
- Never invent APIs, compiler errors, or test results.
`;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Check API configuration
app.get("/api/status", (_req, res) => {
  const configured = Boolean(
    API_KEY && API_KEY !== "your_nvidia_api_key_here"
  );

  res.json({ configured, model: MODEL });
});

// AI chat endpoint
app.post("/api/chat", async (req, res) => {
  if (!API_KEY || API_KEY === "your_nvidia_api_key_here") {
    return res.status(503).json({
      error: "NVIDIA API key is missing. Add it to your .env file."
    });
  }

  const messages = req.body?.messages;

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 60
  ) {
    return res.status(400).json({
      error: "Invalid conversation. Send 1–60 messages."
    });
  }

  // Add our system prompt and accept only user/assistant history.
  const safeMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.trim()
      )
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 20000)
      }))
  ];

  if (safeMessages.length === 1) {
    return res.status(400).json({
      error: "Message cannot be empty."
    });
  }

  let reader = null;
  let clientDisconnected = false;

  // Stop upstream reading if the browser disconnects.
  res.on("close", () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      reader?.cancel().catch(() => {});
    }
  });

  const send = (data) => {
    if (!clientDisconnected && !res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    const upstream = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: safeMessages,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 16384,
        stream: true
      })
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 1500);

      if (!res.headersSent && !clientDisconnected) {
        return res.status(upstream.status).json({
          error: `NVIDIA API error (${upstream.status}): ${detail}`
        });
      }

      return;
    }

    if (!upstream.body) {
      if (!res.headersSent && !clientDisconnected) {
        return res.status(502).json({
          error: "NVIDIA returned an empty response."
        });
      }

      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    reader = upstream.body.getReader();

    const decoder = new TextDecoder();
    let buffer = "";

    function processLine(line) {
      if (!line.startsWith("data:")) return;

      const payload = line.slice(5).trim();

      if (!payload || payload === "[DONE]") return;

      let packet;

      try {
        packet = JSON.parse(payload);
      } catch {
        return;
      }

      const choice = packet.choices?.[0];
      const delta = choice?.delta;

      if (delta) {
        // Forward reasoning separately if the API returns it.
        if (
          typeof delta.reasoning_content === "string" &&
          delta.reasoning_content
        ) {
          send({ reasoning: delta.reasoning_content });
        }

        // Forward the regular answer.
        if (typeof delta.content === "string" && delta.content) {
          send({ text: delta.content });
        }
      }

      if (choice?.finish_reason) {
        send({ done: true });
      }

      if (packet.error) {
        send({
          error:
            typeof packet.error === "string"
              ? packet.error
              : packet.error.message || "NVIDIA returned an error."
        });
      }
    }

    while (!clientDisconnected) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        processLine(line);
      }
    }

    buffer += decoder.decode();

    if (!clientDisconnected && buffer.trim()) {
      processLine(buffer);
    }

    if (!clientDisconnected && !res.destroyed && !res.writableEnded) {
      res.end();
    }
  } catch (err) {
    console.error("NVIDIA API error:", err.message);

    if (!clientDisconnected && !res.headersSent) {
      res.status(500).json({
        error: `Could not reach NVIDIA: ${err.message}`
      });
    } else if (
      !clientDisconnected &&
      !res.destroyed &&
      !res.writableEnded
    ) {
      send({ error: "AI response interrupted. Please try again." });
      res.end();
    }
  }
});

// Serve frontend
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`NVIDIA AI Chat running at http://localhost:${PORT}`);
});