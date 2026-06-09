// ═══════════════════════════════════════════════
// Aspo AI — Frontend Logic v4.1
// Features: Voice Input, File Upload, Inline Edit, TTS
// ═══════════════════════════════════════════════

let isWaiting = false;
let isDark = true;
let currentChatId = null;
let chats = [];
let lastSource = "";

// ── Voice Input ──────────────────────────────
let recognition = null;
let isRecording = false;
let voiceTranscript = "";

// ── File Attachment ───────────────────────────
let attachedFile = null;
let attachedFileContent = "";
let attachedFileName = "";

// ── TTS ───────────────────────────────────────
let ttsEnabled = false;
let currentUtterance = null;

// ─── Marked config ───────────────────────────
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

// ═══════════════════════════════════════════════
// CHAT LIST
// ═══════════════════════════════════════════════

async function loadChatList() {
  const res = await fetch("/chats");
  const data = await res.json();
  chats = data.chats || [];
  renderChatList();
}

function renderChatList() {
  const list = document.getElementById("chat-list");
  list.innerHTML = "";

  if (chats.length === 0) {
    list.innerHTML = `<div class="chat-list-empty">No conversations yet.<br>Start a new one above.</div>`;
    return;
  }

  chats.forEach(chat => {
    const item = document.createElement("div");
    item.classList.add("chat-item");
    if (chat.id === currentChatId) item.classList.add("active");
    item.dataset.id = chat.id;

    const body = document.createElement("div");
    body.classList.add("chat-item-body");

    const title = document.createElement("div");
    title.classList.add("chat-item-title");
    title.textContent = chat.title || "New Conversation";

    const preview = document.createElement("div");
    preview.classList.add("chat-item-preview");
    preview.textContent = chat.preview || "No messages yet";

    body.appendChild(title);
    body.appendChild(preview);

    const del = document.createElement("button");
    del.classList.add("chat-item-delete");
    del.title = "Delete";
    del.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
    del.onclick = e => { e.stopPropagation(); deleteChatById(chat.id); };

    item.appendChild(body);
    item.appendChild(del);
    item.onclick = () => switchToChat(chat.id);

    list.appendChild(item);
  });
}

// ═══════════════════════════════════════════════
// CREATE / SWITCH / DELETE
// ═══════════════════════════════════════════════

async function createNewChat() {
  const res = await fetch("/chats", { method: "POST" });
  const chat = await res.json();
  chats.unshift(chat);
  renderChatList();
  await switchToChat(chat.id);
}

async function switchToChat(chatId) {
  currentChatId = chatId;

  document.querySelectorAll(".chat-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === chatId);
  });

  const chat = chats.find(c => c.id === chatId);
  document.getElementById("chat-title-display").textContent = chat ? chat.title : "Conversation";
  document.getElementById("rename-btn").style.display = "inline-flex";
  document.getElementById("delete-btn").style.display = "inline-flex";
  cancelRename();

  const chatbox = document.getElementById("chatbox");
  chatbox.innerHTML = "";

  const res = await fetch(`/chats/${chatId}/messages`);
  const data = await res.json();
  const messages = data.messages || [];

  if (messages.length === 0) {
    showWelcome();
  } else {
    messages.forEach(m => appendMessage(m.role === "user" ? "user" : "bot", m.content));
  }
}

async function deleteChatById(chatId) {
  if (!confirm("Delete this conversation?")) return;
  await fetch(`/chats/${chatId}`, { method: "DELETE" });
  chats = chats.filter(c => c.id !== chatId);

  if (currentChatId === chatId) {
    currentChatId = null;
    document.getElementById("chat-title-display").textContent = "New Conversation";
    document.getElementById("rename-btn").style.display = "none";
    document.getElementById("delete-btn").style.display = "none";
    cancelRename();
    showWelcome();
    setSourceChip("", "");
  }
  renderChatList();
}

async function deleteCurrentChat() {
  if (!currentChatId) return;
  await deleteChatById(currentChatId);
}

// ═══════════════════════════════════════════════
// RENAME
// ═══════════════════════════════════════════════

function startRename() {
  document.getElementById("title-static").style.display = "none";
  const bar = document.getElementById("rename-bar");
  bar.style.display = "flex";
  const input = document.getElementById("rename-input");
  input.value = document.getElementById("chat-title-display").textContent;
  input.focus();
  input.select();
}

function cancelRename() {
  document.getElementById("rename-bar").style.display = "none";
  document.getElementById("title-static").style.display = "flex";
}

async function submitRename() {
  if (!currentChatId) return cancelRename();
  const input = document.getElementById("rename-input");
  const newTitle = input.value.trim();
  if (!newTitle) return cancelRename();

  const res = await fetch(`/chats/${currentChatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: newTitle })
  });
  const data = await res.json();
  cancelRename();

  const chat = chats.find(c => c.id === currentChatId);
  if (chat) chat.title = data.title;
  document.getElementById("chat-title-display").textContent = data.title;
  renderChatList();
}

// ═══════════════════════════════════════════════
// FILE ATTACHMENT
// ═══════════════════════════════════════════════

function getFileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  const icons = { pdf: "📕", txt: "📄", md: "📝", csv: "📊", json: "🔧", py: "🐍", js: "🟨", html: "🌐", css: "🎨", xml: "📋", docx: "📘", xlsx: "📗" };
  return icons[ext] || "📎";
}

function handleFileAttach(event) {
  const file = event.target.files[0];
  if (!file) return;

  const maxSize = 2 * 1024 * 1024; // 2MB
  if (file.size > maxSize) {
    showToast("⚠️ File too large. Max 2MB.");
    event.target.value = "";
    return;
  }

  attachedFile = file;
  attachedFileName = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    attachedFileContent = e.target.result;

    // Show file preview bar
    const bar = document.getElementById("file-preview-bar");
    const nameEl = document.getElementById("file-preview-name");
    const sizeEl = document.getElementById("file-preview-size");
    const iconEl = document.getElementById("file-preview-icon");

    nameEl.textContent = file.name;
    sizeEl.textContent = formatSize(file.size);
    iconEl.textContent = getFileIcon(file.name);
    bar.style.display = "flex";

    // Focus textarea
    document.getElementById("user-input").focus();
  };

  reader.onerror = () => showToast("⚠️ Failed to read file.");

  // Read as text for text files, or as data URL for binary
  const textTypes = ["txt", "md", "csv", "json", "py", "js", "html", "css", "xml"];
  const ext = file.name.split(".").pop().toLowerCase();
  if (textTypes.includes(ext)) {
    reader.readAsText(file);
  } else {
    reader.readAsDataURL(file);
  }

  event.target.value = "";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function clearAttachment() {
  attachedFile = null;
  attachedFileContent = "";
  attachedFileName = "";
  document.getElementById("file-preview-bar").style.display = "none";
  document.getElementById("file-input").value = "";
}

function showToast(msg) {
  const t = document.getElementById("upload-toast");
  document.getElementById("upload-toast-text").textContent = msg;
  t.style.display = "flex";
  setTimeout(() => t.style.display = "none", 3000);
}

// ═══════════════════════════════════════════════
// VOICE INPUT
// ═══════════════════════════════════════════════

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const r = new SpeechRecognition();
  r.continuous = true;
  r.interimResults = true;
  r.lang = "en-US";

  r.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    voiceTranscript += final;
    const display = voiceTranscript + interim;
    document.getElementById("voice-transcript").textContent = display;
  };

  r.onerror = (e) => {
    console.error("Speech recognition error:", e.error);
    if (e.error === "not-allowed") {
      document.getElementById("voice-status").textContent = "⚠️ Microphone access denied";
    } else {
      document.getElementById("voice-status").textContent = "⚠️ Error: " + e.error;
    }
  };

  r.onend = () => {
    if (isRecording) {
      // Auto-restart if still supposed to be recording
      try { r.start(); } catch(e) {}
    }
  };

  return r;
}

function toggleVoiceInput() {
  if (isRecording) {
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("⚠️ Voice input not supported in this browser.");
    return;
  }

  voiceTranscript = "";
  recognition = initSpeechRecognition();

  try {
    recognition.start();
    isRecording = true;

    // Update mic button
    const micBtn = document.getElementById("voice-btn");
    micBtn.classList.add("recording");

    // Show overlay
    document.getElementById("voice-overlay").style.display = "flex";
    document.getElementById("voice-status").textContent = "Listening…";
    document.getElementById("voice-transcript").textContent = "";
  } catch(e) {
    showToast("⚠️ Could not start microphone.");
  }
}

function stopVoiceInput() {
  isRecording = false;
  if (recognition) {
    recognition.stop();
    recognition = null;
  }

  // Update mic button
  const micBtn = document.getElementById("voice-btn");
  micBtn.classList.remove("recording");

  // Hide overlay
  document.getElementById("voice-overlay").style.display = "none";

  // Put transcript into input
  const transcript = voiceTranscript.trim();
  if (transcript) {
    const input = document.getElementById("user-input");
    input.value = (input.value + " " + transcript).trim();
    autoResize(input);
    updateCharCount();
    input.focus();
  }
  voiceTranscript = "";
}

// ═══════════════════════════════════════════════
// TEXT TO SPEECH (TTS)
// ═══════════════════════════════════════════════

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById("tts-toggle-btn");
  const icon = document.getElementById("tts-icon");

  if (ttsEnabled) {
    btn.classList.add("tts-active");
    icon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    `;
    showToast("🔊 Voice responses ON");
  } else {
    btn.classList.remove("tts-active");
    icon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
    `;
    if (currentUtterance) {
      speechSynthesis.cancel();
      currentUtterance = null;
    }
    showToast("🔇 Voice responses OFF");
  }
}

function speakText(text) {
  if (!ttsEnabled || !window.speechSynthesis) return;

  // Strip markdown for speech
  const plain = text
    .replace(/```[\s\S]*?```/g, "code block")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/\n+/g, ". ")
    .trim();

  if (!plain) return;

  speechSynthesis.cancel();
  currentUtterance = new SpeechSynthesisUtterance(plain);
  currentUtterance.rate = 1.0;
  currentUtterance.pitch = 1.0;
  currentUtterance.volume = 1.0;

  // Pick a good voice if available
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes("Google") && v.lang.startsWith("en")) ||
                    voices.find(v => v.lang.startsWith("en"));
  if (preferred) currentUtterance.voice = preferred;

  speechSynthesis.speak(currentUtterance);
}

// ═══════════════════════════════════════════════
// INLINE MESSAGE EDITING
// ═══════════════════════════════════════════════

function makeUserBubbleEditable(bubble, originalText, messageIndex) {
  // Already editing? Don't double-wrap
  if (bubble.querySelector(".edit-textarea")) return;

  const originalContent = bubble.textContent;

  const editArea = document.createElement("textarea");
  editArea.className = "edit-textarea";
  editArea.value = originalText;
  editArea.rows = Math.max(2, originalText.split("\n").length);

  const editActions = document.createElement("div");
  editActions.className = "edit-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "pill-btn pill-btn-sm";
  saveBtn.textContent = "Resend";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "pill-btn pill-btn-sm ghost";
  cancelBtn.textContent = "Cancel";

  editActions.appendChild(cancelBtn);
  editActions.appendChild(saveBtn);

  bubble.innerHTML = "";
  bubble.appendChild(editArea);
  bubble.appendChild(editActions);
  editArea.focus();
  editArea.select();

  cancelBtn.onclick = () => {
    bubble.innerHTML = "";
    bubble.textContent = originalContent;
    addEditButton(bubble, originalText, messageIndex);
  };

  saveBtn.onclick = async () => {
    const newMsg = editArea.value.trim();
    if (!newMsg || newMsg === originalText) {
      cancelBtn.onclick();
      return;
    }

    // Remove everything after this message in the DOM
    const chatbox = document.getElementById("chatbox");
    const rows = chatbox.querySelectorAll(".message-row");
    let found = false;
    rows.forEach(row => {
      if (found) row.remove();
      if (row.contains(bubble)) found = true;
    });

    // Update bubble
    bubble.innerHTML = "";
    bubble.textContent = newMsg;
    addEditButton(bubble, newMsg, messageIndex);

    // Send new message
    await sendEditedMessage(newMsg);
  };

  // Auto-resize
  editArea.addEventListener("input", () => {
    editArea.style.height = "auto";
    editArea.style.height = editArea.scrollHeight + "px";
  });
  editArea.style.height = "auto";
  editArea.style.height = editArea.scrollHeight + "px";
}

function addEditButton(bubble, text, idx) {
  // Don't add duplicate
  if (bubble.querySelector(".msg-edit-btn")) return;

  const btn = document.createElement("button");
  btn.className = "msg-edit-btn";
  btn.title = "Edit message";
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  btn.onclick = () => makeUserBubbleEditable(bubble, text, idx);
  bubble.appendChild(btn);
}

async function sendEditedMessage(message) {
  if (!currentChatId) return;

  const typingEl = showTyping();
  isWaiting = true;
  document.getElementById("send-btn").disabled = true;

  try {
    const res = await fetch(`/chats/${currentChatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    const data = await res.json();
    removeTyping(typingEl);

    if (data.error) {
      appendMessage("bot", data.reply, "", "error", "⚠️ Error");
    } else {
      appendMessage("bot", data.reply, data.timestamp || "", data.source || "llm", data.source_label || "✦ AI");
      setSourceChip(data.source, data.source_label);
      if (ttsEnabled) speakText(data.reply);

      const chat = chats.find(c => c.id === currentChatId);
      if (chat) {
        chat.title = data.title || chat.title;
        chat.preview = message.substring(0, 80);
        chats = [chat, ...chats.filter(c => c.id !== currentChatId)];
      }
      document.getElementById("chat-title-display").textContent = data.title || "Conversation";
      renderChatList();
    }
  } catch (err) {
    removeTyping(typingEl);
    appendMessage("bot", "⚠️ Could not connect to the server. Please try again.");
  }

  isWaiting = false;
  document.getElementById("send-btn").disabled = false;
}

// ═══════════════════════════════════════════════
// SEND MESSAGE
// ═══════════════════════════════════════════════

async function sendMessage() {
  if (isWaiting) return;

  const input = document.getElementById("user-input");
  let message = input.value.trim();

  // Append file content if attached
  let displayMessage = message;
  if (attachedFile && attachedFileContent) {
    const ext = attachedFileName.split(".").pop().toLowerCase();
    const textTypes = ["txt", "md", "csv", "json", "py", "js", "html", "css", "xml"];
    if (textTypes.includes(ext)) {
      const fileContext = `\n\n[Attached file: ${attachedFileName}]\n\`\`\`\n${attachedFileContent.substring(0, 8000)}\n\`\`\``;
      message = (message || `Please analyze this file: ${attachedFileName}`) + fileContext;
      displayMessage = (input.value.trim() || `📎 ${attachedFileName}`) ;
    } else {
      message = (message || `I've attached a file: ${attachedFileName}`) + `\n\n[File attached: ${attachedFileName} — binary/unsupported format for direct reading]`;
      displayMessage = input.value.trim() || `📎 ${attachedFileName}`;
    }
  }

  if (!message) return;

  // Auto-create chat if none
  if (!currentChatId) {
    const res = await fetch("/chats", { method: "POST" });
    const chat = await res.json();
    chats.unshift(chat);
    currentChatId = chat.id;
    document.getElementById("chat-title-display").textContent = chat.title;
    document.getElementById("rename-btn").style.display = "inline-flex";
    document.getElementById("delete-btn").style.display = "inline-flex";
    renderChatList();
  }

  // Remove welcome
  const welcome = document.getElementById("welcome-screen");
  if (welcome) welcome.remove();

  // Display message (with file indicator if attached)
  const userDisplay = attachedFile ? `${displayMessage}${displayMessage && !displayMessage.includes("📎") ? "" : ""}\n📎 ${attachedFileName}` : displayMessage;
  const msgRow = appendMessage("user", userDisplay.trim());

  // Clear input & attachment
  input.value = "";
  autoResize(input);
  updateCharCount();
  clearAttachment();

  const typingEl = showTyping();
  isWaiting = true;
  document.getElementById("send-btn").disabled = true;

  try {
    const res = await fetch(`/chats/${currentChatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    const data = await res.json();
    removeTyping(typingEl);

    if (data.error) {
      appendMessage("bot", data.reply, "", "error", "⚠️ Error");
    } else {
      appendMessage("bot", data.reply, data.timestamp || "", data.source || "llm", data.source_label || "✦ AI");
      setSourceChip(data.source, data.source_label);
      if (ttsEnabled) speakText(data.reply);

      const chat = chats.find(c => c.id === currentChatId);
      if (chat) {
        chat.title = data.title || chat.title;
        chat.preview = message.substring(0, 80);
        chats = [chat, ...chats.filter(c => c.id !== currentChatId)];
      }
      document.getElementById("chat-title-display").textContent = data.title || "Conversation";
      renderChatList();
    }

  } catch (err) {
    removeTyping(typingEl);
    appendMessage("bot", "⚠️ Could not connect to the server. Please try again.");
  }

  isWaiting = false;
  document.getElementById("send-btn").disabled = false;
  input.focus();
}

// ═══════════════════════════════════════════════
// DOM HELPERS
// ═══════════════════════════════════════════════

function showWelcome() {
  const chatbox = document.getElementById("chatbox");
  chatbox.innerHTML = "";
  const el = document.createElement("div");
  el.className = "welcome-screen";
  el.id = "welcome-screen";
  el.innerHTML = `
    <div class="welcome-glyph">
      <div class="welcome-ring">
        <span class="welcome-icon-inner">S</span>
      </div>
    </div>
    <h1 class="welcome-headline">How can I help?</h1>
    <p class="welcome-sub">Ask anything — or upload a file, use your voice</p>
    <div class="rag-pill">
      <span>●</span> Aspo AI + Groq LLM
    </div>
    <div class="chips">
      <button class="chip" onclick="useChip(this)">About us</button>
      <button class="chip" onclick="useChip(this)">Write a Python function</button>
      <button class="chip" onclick="useChip(this)">Explain RAG in simple terms</button>
      <button class="chip" onclick="useChip(this)">Help me write an email</button>
    </div>
  `;
  chatbox.appendChild(el);
}

function appendMessage(role, text, timestamp = "", source = "", sourceLabel = "") {
  const chatbox = document.getElementById("chatbox");

  const row = document.createElement("div");
  row.classList.add("message-row", role);

  const avatar = document.createElement("div");
  avatar.classList.add("avatar", role === "bot" ? "bot-avatar" : "user-avatar");
  avatar.textContent = role === "bot" ? "✦" : "U";

  const col = document.createElement("div");
  col.classList.add("bubble-col");

  const bubble = document.createElement("div");
  bubble.classList.add("bubble", role === "bot" ? "bot-bubble" : "user-bubble");

  if (role === "bot") {
    bubble.innerHTML = marked.parse(text);
    bubble.querySelectorAll("pre").forEach(pre => {
      const btn = document.createElement("button");
      btn.className = "copy-code-btn";
      btn.textContent = "copy";
      btn.onclick = () => {
        navigator.clipboard.writeText(pre.querySelector("code")?.innerText || "").then(() => {
          btn.textContent = "copied!";
          setTimeout(() => btn.textContent = "copy", 2000);
        });
      };
      pre.appendChild(btn);
    });
    bubble.querySelectorAll("pre code").forEach(b => hljs.highlightElement(b));

    // TTS button on bot message
    const ttsBtn = document.createElement("button");
    ttsBtn.className = "msg-tts-btn";
    ttsBtn.title = "Read aloud";
    ttsBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
    ttsBtn.onclick = () => speakText(text);
    bubble.appendChild(ttsBtn);

  } else {
    // User bubble: show text & add edit button
    bubble.textContent = text;
    addEditButton(bubble, text, Date.now());
  }

  col.appendChild(bubble);

  // Meta row
  if (role === "bot" && (source || timestamp)) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";

    if (source && source !== "user") {
      const badge = document.createElement("span");
      badge.className = `source-badge ${source === "data_file" ? "badge-kb" : "badge-ai"}`;
      badge.textContent = sourceLabel || (source === "data_file" ? "📄 KB" : "✦ AI");
      meta.appendChild(badge);
    }

    if (timestamp) {
      const ts = document.createElement("span");
      ts.className = "msg-time";
      ts.textContent = timestamp;
      meta.appendChild(ts);
    }

    col.appendChild(meta);
  }

  row.appendChild(avatar);
  row.appendChild(col);
  chatbox.appendChild(row);
  chatbox.scrollTop = chatbox.scrollHeight;
  return row;
}

function showTyping() {
  const chatbox = document.getElementById("chatbox");
  const row = document.createElement("div");
  row.className = "typing-row";

  const avatar = document.createElement("div");
  avatar.classList.add("avatar", "bot-avatar");
  avatar.textContent = "✦";

  const bubble = document.createElement("div");
  bubble.className = "typing-bubble";
  bubble.innerHTML = "<span></span><span></span><span></span>";

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatbox.appendChild(row);
  chatbox.scrollTop = chatbox.scrollHeight;
  return row;
}

function removeTyping(el) {
  if (el?.parentNode) el.parentNode.removeChild(el);
}

function setSourceChip(source, label) {
  const chip = document.getElementById("source-chip");
  const text = document.getElementById("source-chip-text");
  if (!source) { chip.style.display = "none"; return; }
  chip.style.display = "inline-flex";
  chip.className = `source-chip${source === "data_file" ? " kb" : ""}`;
  text.textContent = label || (source === "data_file" ? "📄 KB" : "✦ AI");
}

// ═══════════════════════════════════════════════
// UI UTILS
// ═══════════════════════════════════════════════

function useChip(btn) {
  const input = document.getElementById("user-input");
  input.value = btn.textContent;
  input.focus();
  autoResize(input);
  updateCharCount();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("hidden");
}

function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle("light", !isDark);
  document.getElementById("theme-icon").textContent = isDark ? "🌙" : "☀️";
  document.getElementById("theme-label").textContent = isDark ? "Dark" : "Light";
  localStorage.setItem("theme", isDark ? "dark" : "light");
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function updateCharCount() {
  const input = document.getElementById("user-input");
  document.getElementById("char-count").textContent = `${input.value.length} / 4000`;
}

// ═══════════════════════════════════════════════
// DRAG & DROP file upload
// ═══════════════════════════════════════════════

function setupDragDrop() {
  const zone = document.getElementById("input-card");
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) {
      // Simulate file input
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById("file-input");
      input.files = dt.files;
      handleFileAttach({ target: input });
    }
  });
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  const input = document.getElementById("user-input");

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener("input", function() { autoResize(this); updateCharCount(); });

  document.getElementById("rename-input").addEventListener("keydown", e => {
    if (e.key === "Enter") submitRename();
    if (e.key === "Escape") cancelRename();
  });

  // Keyboard shortcut: Escape closes voice overlay
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isRecording) stopVoiceInput();
  });

  // Restore theme
  const saved = localStorage.getItem("theme");
  if (saved === "light") {
    isDark = false;
    document.body.classList.add("light");
    document.getElementById("theme-icon").textContent = "☀️";
    document.getElementById("theme-label").textContent = "Light";
  }

  // Init TTS icon (off state)
  const ttsIcon = document.getElementById("tts-icon");
  ttsIcon.innerHTML = `
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
  `;

  // Load voices for TTS
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
  }

  setupDragDrop();

  await loadChatList();

  if (chats.length > 0) {
    await switchToChat(chats[0].id);
  } else {
    showWelcome();
  }

  input.focus();
});
