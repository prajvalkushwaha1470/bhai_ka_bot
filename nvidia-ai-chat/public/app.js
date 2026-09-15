
(() => {
  const $ = (id) => document.getElementById(id);

  const promptEl = $("prompt");
  const messagesEl = $("messages");
  const welcomeEl = $("welcome");

  let chats = [];
  let currentId = null;
  let busy = false;

  const makeId = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const current = () => chats.find((chat) => chat.id === currentId);

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);

  function markdown(text) {
    let safe = escapeHtml(text);
    const blocks = [];

    // Fenced code blocks
    safe = safe.replace(
      /```([\w+-]*)\n?([\s\S]*?)```/g,
      (_match, _language, code) => {
        const token = `§§CODE${blocks.length}§§`;
        blocks.push(`<pre><code>${code.trim()}</code></pre>`);
        return token;
      }
    );

    // Inline code and bold
    safe = safe
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    const html = safe
      .split(/\n{2,}/)
      .map((paragraph) =>
        paragraph.startsWith("§§CODE")
          ? paragraph
          : `<p>${paragraph.replace(/\n/g, "<br>")}</p>`
      )
      .join("");

    return html.replace(
      /§§CODE(\d+)§§/g,
      (_match, number) => blocks[Number(number)] || ""
    );
  }

  function toast(message) {
    const toastEl = $("toast");
    if (!toastEl) return;

    toastEl.textContent = message;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 4500);
  }

  function newChat() {
    const chat = {
      id: makeId(),
      title: "New chat",
      messages: [],
    };

    chats.unshift(chat);
    currentId = chat.id;

    renderHistory();
    renderMessages();
    promptEl.focus();
  }

  function renderHistory() {
    const historyEl = $("history");
    historyEl.innerHTML = "";

    chats.forEach((chat) => {
      const button = document.createElement("button");
      button.className =
        "history-item" + (chat.id === currentId ? " active" : "");
      button.textContent = chat.title;
      button.title = chat.title;

      button.onclick = () => {
        if (busy) return toast("Wait for the current response to finish.");

        currentId = chat.id;
        renderHistory();
        renderMessages();
        $("sidebar").classList.remove("open");
      };

      historyEl.appendChild(button);
    });
  }

  function renderMessages() {
    const chat = current();
    const hasMessages = Boolean(chat && chat.messages.length);

    welcomeEl.style.display = hasMessages ? "none" : "flex";
    messagesEl.classList.toggle("visible", hasMessages);
    messagesEl.innerHTML = "";

    if (!hasMessages) return;

    chat.messages.forEach((message) => {
      appendMessage(message.role, message.content, false);
    });

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessage(role, content, scroll = true) {
    const row = document.createElement("article");
    row.className = "message " + role;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? "Y" : "✦";

    const body = document.createElement("div");
    body.className = "message-body";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = role === "user" ? "You" : "NVIDIA AI";

    const contentEl = document.createElement("div");
    contentEl.className = "content";
    contentEl.innerHTML = markdown(content || "");

    body.append(label, contentEl);
    row.append(avatar, body);
    messagesEl.appendChild(row);

    if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;

    return contentEl;
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;

    if (!current()) newChat();

    const chat = current();
    chat.messages.push({ role: "user", content: text });

    if (chat.messages.length === 1) {
      chat.title = text.slice(0, 42) + (text.length > 42 ? "…" : "");
    }

    renderHistory();
    welcomeEl.style.display = "none";
    messagesEl.classList.add("visible");
    appendMessage("user", text);

    const assistant = {
      role: "assistant",
      content: "",
    };
    chat.messages.push(assistant);

    const output = appendMessage("assistant", "▍");

    busy = true;
    $("sendBtn").disabled = true;
    promptEl.disabled = true;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chat.messages.slice(0, -1),
        }),
      });

      if (!response.ok) {
        let data = {};
        try {
          data = await response.json();
        } catch {
          // Ignore non-JSON error responses.
        }
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this browser.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let reasoning = "";
      let responseText = "";

      while (true) {
        const { value, done } = await reader.read();

        buffer += decoder.decode(value || new Uint8Array(), {
          stream: !done,
        });

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";

        for (const event of events) {
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;

            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            let packet;
            try {
              packet = JSON.parse(data);
            } catch {
              continue;
            }

            if (packet.reasoning) {
              reasoning += packet.reasoning;
            }

            if (packet.text) {
              responseText += packet.text;
              assistant.content = responseText;
            }

            if (packet.error) {
              throw new Error(packet.error);
            }

            // Display the answer as it streams.
            // Reasoning is received separately and is not shown in the chat.
            output.innerHTML =
              markdown(responseText || "") +
              "<span class='cursor'>▍</span>";

            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }

        if (done) break;
      }

      // Keep reasoning separate from the saved assistant answer.
      output.innerHTML = markdown(responseText || "No response received.");

      if (!responseText) {
        assistant.content = "No response received.";
      }
    } catch (error) {
      chat.messages.pop();

      output.innerHTML =
        `<p class="error">${escapeHtml(error.message || "Something went wrong.")}</p>`;

      toast(error.message || "Something went wrong.");
    } finally {
      busy = false;
      $("sendBtn").disabled = false;
      promptEl.disabled = false;
      promptEl.focus();
    }
  }

  $("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const value = promptEl.value;
    promptEl.value = "";
    promptEl.style.height = "auto";

    send(value);
  });

  promptEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("chatForm").requestSubmit();
    }
  });

  promptEl.addEventListener("input", () => {
    promptEl.style.height = "auto";
    promptEl.style.height = Math.min(promptEl.scrollHeight, 180) + "px";
  });

  $("newChat").onclick = newChat;

  $("clearChat").onclick = () => {
    if (busy) return toast("Wait for the current response to finish.");
    newChat();
  };

  document.querySelectorAll(".suggestion").forEach((button) => {
    button.onclick = () => {
      promptEl.value = button.dataset.prompt || "";
      promptEl.focus();
      promptEl.style.height = "auto";
      promptEl.style.height = promptEl.scrollHeight + "px";
    };
  });

  $("openSidebar").onclick = () => $("sidebar").classList.add("open");
  $("closeSidebar").onclick = () => $("sidebar").classList.remove("open");

  fetch("/api/status")
    .then((response) => response.json())
    .then((status) => {
      $("statusDot").classList.toggle("ready", status.configured);
      $("statusText").textContent = status.configured
        ? "API connected · " + status.model
        : "API key needed";
    })
    .catch(() => {
      $("statusText").textContent = "Server unavailable";
    });

  newChat();
})();