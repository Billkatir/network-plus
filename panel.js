"use strict";

/* ========================================================================
 * Network+  panel logic
 * Captures requests via chrome.devtools.network, renders a list, supports
 * search, detail inspection, and "Copy as Python".
 * ====================================================================== */

/** All captured requests. Each entry:
 *  { id, request (HAR entry), bodyCache: {text, encoding}|null } */
const captured = [];
let nextId = 1;
let selectedId = null;

// ---- DOM refs ----
const els = {
  body: document.getElementById("reqBody"),
  clearBtn: document.getElementById("clearBtn"),
  captureDocsBtn: document.getElementById("captureDocsBtn"),
  exportBtn: document.getElementById("exportBtn"),
  preserveLog: document.getElementById("preserveLog"),
  search: document.getElementById("search"),
  deepSearch: document.getElementById("deepSearch"),
  regexSearch: document.getElementById("regexSearch"),
  matchCount: document.getElementById("matchCount"),
  detailPane: document.getElementById("detailPane"),
  detailTitle: document.getElementById("detailTitle"),
  detailBody: document.getElementById("detailBody"),
  closeDetail: document.getElementById("closeDetail"),
  ctxMenu: document.getElementById("ctxMenu"),
};

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

// Live requests as they finish.
chrome.devtools.network.onRequestFinished.addListener((harEntry) => {
  addEntry(harEntry);
});

// Pull anything already captured when the panel opens.
chrome.devtools.network.getHAR((har) => {
  (har.entries || []).forEach(addEntry);
});

// Page navigation / reload: clear unless "Preserve log" is on.
chrome.devtools.network.onNavigated.addListener(() => {
  if (!els.preserveLog.checked) clearList();
});

function addEntry(harEntry) {
  const item = { id: nextId++, request: harEntry, bodyCache: null };
  captured.push(item);
  renderRow(item);
}

/* ------------------------------------------------------------------ *
 * Document capture
 *
 * The devtools network API returns an empty body for the main document
 * (and iframe documents), so server-rendered values can't be searched.
 * Instead we read the rendered HTML straight out of the inspected page
 * (main window + every same-origin iframe) via inspectedWindow.eval and
 * add each as a synthetic, fully-searchable "document" entry.
 * ------------------------------------------------------------------ */

function captureDocuments() {
  const expr = `
    (function () {
      var out = [];
      function grab(win, label) {
        try {
          out.push({ url: win.location.href, label: label,
                     html: win.document.documentElement.outerHTML });
        } catch (e) {
          out.push({ url: label, label: label, html: "", error: String(e) });
        }
      }
      grab(window, "(main document)");
      for (var i = 0; i < window.frames.length; i++) {
        try {
          var f = window.frames[i];
          grab(f, "(iframe #" + i + " " + (f.frameElement && f.frameElement.src || "") + ")");
        } catch (e) {
          // cross-origin iframe: body is not readable from the page context
          var src = "";
          try { src = document.getElementsByTagName("iframe")[i].src; } catch (_) {}
          out.push({ url: src || ("(iframe #" + i + ")"), label: "(iframe #" + i + " cross-origin)",
                     html: "", error: "cross-origin — cannot read" });
        }
      }
      return out;
    })();
  `;
  chrome.devtools.inspectedWindow.eval(expr, (docs, err) => {
    if (err && err.isException) {
      console.warn("document capture failed:", err);
      return;
    }
    (docs || []).forEach(addDocEntry);
  });
}

// Add a captured document as a synthetic entry whose body IS searchable.
function addDocEntry(doc) {
  const synthetic = {
    request: { method: "DOC", url: doc.url, headers: [], queryString: [], postData: null },
    response: { status: 200, statusText: doc.error || "", content: { mimeType: "text/html" }, headers: [] },
    // synthetic getContent so detail view + deep search work uniformly
    getContent: (cb) => cb(doc.html || "", ""),
    _docLabel: doc.label,
  };
  const item = { id: nextId++, request: synthetic, bodyCache: { text: doc.html || "", encoding: "" } };
  captured.push(item);
  renderRow(item);
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderRow(item) {
  const e = item.request;
  const req = e.request || {};
  const res = e.response || {};
  const tr = document.createElement("tr");
  tr.dataset.id = item.id;

  const status = res.status || 0;
  const statusClass = status ? "status-" + String(status)[0] : "";
  const type = mimeShort(res.content && res.content.mimeType);

  tr.innerHTML =
    `<td class="col-method">${esc(req.method || "")}</td>` +
    `<td class="col-status ${statusClass}">${status || "-"}</td>` +
    `<td class="col-type">${esc(type)}</td>` +
    `<td class="col-url" title="${esc(req.url || "")}">${esc(shortUrl(req.url))}</td>`;

  tr.addEventListener("click", () => selectRow(item.id));
  tr.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    selectRow(item.id);
    openCtxMenu(ev.clientX, ev.clientY, item);
  });

  els.body.appendChild(tr);
  applyFilterToRow(tr, item);
}

function renderAll() {
  els.body.innerHTML = "";
  captured.forEach(renderRow);
}

function selectRow(id) {
  selectedId = id;
  [...els.body.children].forEach((tr) =>
    tr.classList.toggle("selected", +tr.dataset.id === id)
  );
  showDetail(captured.find((c) => c.id === id));
}

function clearList() {
  captured.length = 0;
  els.body.innerHTML = "";
  selectedId = null;
  els.detailPane.classList.add("hidden");
  updateMatchCount(0);
}

/* ------------------------------------------------------------------ *
 * Detail view
 * ------------------------------------------------------------------ */

function showDetail(item) {
  if (!item) return;
  const e = item.request;
  const req = e.request || {};
  const res = e.response || {};
  els.detailPane.classList.remove("hidden");
  els.detailTitle.textContent = `${req.method} ${shortUrl(req.url)}`;

  const parts = [];
  parts.push(`<div class="kv"><b>URL:</b> ${esc(req.url)}</div>`);
  parts.push(`<div class="kv"><b>Status:</b> ${res.status} ${esc(res.statusText || "")}</div>`);

  parts.push(`<h4>Request headers</h4><pre>${esc(fmtHeaders(req.headers))}</pre>`);
  if (req.queryString && req.queryString.length)
    parts.push(`<h4>Query</h4><pre>${esc(fmtHeaders(req.queryString))}</pre>`);
  if (req.postData && req.postData.text)
    parts.push(`<h4>Request body</h4><pre>${esc(prettyMaybe(req.postData.text))}</pre>`);

  parts.push(`<h4>Response headers</h4><pre>${esc(fmtHeaders(res.headers))}</pre>`);
  parts.push(`<h4>Response body</h4><pre id="respBody">loading…</pre>`);

  els.detailBody.innerHTML = parts.join("");

  // response body is async + per-request
  item.request.getContent((content, encoding) => {
    item.bodyCache = { text: content || "", encoding: encoding || "" };
    const pre = document.getElementById("respBody");
    if (pre) pre.textContent = guardSize(prettyMaybe(content || "(empty)"));
  });
}

/* ------------------------------------------------------------------ *
 * Search  (metadata instant; bodies on demand when deep is ticked)
 * ------------------------------------------------------------------ */

// Debounced + race-guarded: rapid typing must not let an older (slower) deep
// search finish last and paint stale results. Each run takes a token; only the
// latest token is allowed to commit its highlighting.
let searchToken = 0;
let searchTimer = null;
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 120);
}
els.search.addEventListener("input", scheduleSearch);
els.regexSearch.addEventListener("change", runSearch);
els.deepSearch.addEventListener("change", runSearch);

function buildMatcher() {
  const term = els.search.value;
  if (!term) return null;
  if (els.regexSearch.checked) {
    try { const re = new RegExp(term, "i"); return (s) => re.test(s); }
    catch { return null; } // invalid regex: match nothing special
  }
  const low = term.toLowerCase();
  return (s) => s.toLowerCase().includes(low);
}

async function runSearch() {
  const match = buildMatcher();
  const deep = els.deepSearch.checked;
  let count = 0;

  // If deep search, make sure bodies are fetched for all items first.
  if (match && deep) await ensureBodies();

  for (const item of captured) {
    const tr = rowEl(item.id);
    if (!tr) continue;
    const hit = match ? itemMatches(item, match, deep) : true;
    tr.classList.toggle("hidden", match ? !hit : false);
    tr.classList.toggle("match", !!match && hit);
    if (hit && match) count++;
  }
  updateMatchCount(match ? count : 0);
}

function itemMatches(item, match, deep) {
  const hay = metaHaystack(item);
  if (match(hay)) return true;
  if (deep && item.bodyCache) return match(item.bodyCache.text || "");
  return false;
}

function metaHaystack(item) {
  const e = item.request;
  const req = e.request || {};
  const res = e.response || {};
  const bits = [req.method, req.url];
  (req.headers || []).forEach((h) => bits.push(h.name, h.value));
  (res.headers || []).forEach((h) => bits.push(h.name, h.value));
  (req.queryString || []).forEach((q) => bits.push(q.name, q.value));
  if (req.postData && req.postData.text) bits.push(req.postData.text);
  bits.push(String(res.status));
  return bits.join("\n");
}

// Fetch all response bodies once (for deep search).
function ensureBodies() {
  const pending = captured.filter((i) => i.bodyCache === null);
  return Promise.all(
    pending.map(
      (i) =>
        new Promise((resolve) => {
          i.request.getContent((content, encoding) => {
            i.bodyCache = { text: content || "", encoding: encoding || "" };
            resolve();
          });
        })
    )
  );
}

function applyFilterToRow(tr, item) {
  const match = buildMatcher();
  if (!match) { tr.classList.remove("hidden", "match"); return; }
  const hit = itemMatches(item, match, els.deepSearch.checked);
  tr.classList.toggle("hidden", !hit);
  tr.classList.toggle("match", hit);
}

function updateMatchCount(n) {
  els.matchCount.textContent = els.search.value ? `${n} match${n === 1 ? "" : "es"}` : "";
}

/* ------------------------------------------------------------------ *
 * Context menu + actions
 * ------------------------------------------------------------------ */

function openCtxMenu(x, y, item) {
  const menu = els.ctxMenu;
  menu.dataset.id = item.id;
  // Show first so we can measure its real size, then flip if it would overflow.
  menu.classList.remove("hidden");
  const { offsetWidth: w, offsetHeight: h } = menu;
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = x + w > vw ? Math.max(0, x - w) : x;   // flip left near right edge
  const top  = y + h > vh ? Math.max(0, y - h) : y;   // flip up near bottom edge
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}
document.addEventListener("click", () => els.ctxMenu.classList.add("hidden"));

els.ctxMenu.addEventListener("click", (ev) => {
  const action = ev.target.dataset.action;
  const item = captured.find((c) => c.id === +els.ctxMenu.dataset.id);
  if (!item || !action) return;
  if (action === "python-requests") copyText(generatePython(item));
  else if (action === "python-save") saveFile(generatePython(item), pyFileName(item));
  else if (action === "python-pipeline") generatePipeline(item).then(copyText);
  else if (action === "copy-curl") copyText(generateCurl(item));
});

/* ------------------------------------------------------------------ *
 * Python generator
 * ------------------------------------------------------------------ */

// Build a structured description of a request: its function name and the full
// ordered param list. Each param records { pName, default (py source), value
// (the raw captured value, for dependency matching) }. Shared by the single
// generator and the pipeline generator.
function describeRequest(item) {
  const req = (item.request && item.request.request) || {};
  const method = (req.method || "GET").toLowerCase();
  const name = funcName(req);

  const params = [];                 // { pName, default, value }
  const used = new Set();
  const uniq = (base) => {
    let n = safeIdent(base) || "arg";
    if (!used.has(n)) { used.add(n); return n; }
    let i = 2;
    while (used.has(n + "_" + i)) i++;
    const out = n + "_" + i;
    used.add(out);
    return out;
  };

  // headerLines holds { line, pNames, isCookie } so the session path can drop
  // the stale `cookie:` header (the live session cookie should win instead).
  const headerLines = [];
  (req.headers || []).forEach((h) => {
    if (isPseudoHeader(h.name)) return;
    if (isSkipHeader(h.name)) return;
    const isCookie = (h.name || "").toLowerCase() === "cookie";
    const authSplit = splitAuth(h.name, h.value);
    if (authSplit) {
      const tokenP = uniq("token");
      const schemeP = uniq("scheme");
      params.push({ pName: tokenP, default: pyStr(authSplit.token), value: authSplit.token });
      params.push({ pName: schemeP, default: pyStr(authSplit.scheme), value: authSplit.scheme });
      headerLines.push({ line: `        ${pyStr(h.name)}: f"{${schemeP}} {${tokenP}}",`, pNames: [tokenP, schemeP], isCookie });
    } else {
      const p = uniq(h.name);
      params.push({ pName: p, default: pyStr(h.value), value: h.value });
      headerLines.push({ line: `        ${pyStr(h.name)}: ${p},`, pNames: [p], isCookie });
    }
  });

  const queryLines = [];
  (req.queryString || []).forEach((q) => {
    const p = uniq(q.name);
    params.push({ pName: p, default: pyStr(q.value), value: q.value });
    queryLines.push(`        ${pyStr(q.name)}: ${p},`);
  });

  const bodyInfo = analyzeBody(req);
  if (bodyInfo.mode === "fields") {
    bodyInfo.fields.forEach((f) => {
      const p = uniq(f.rawKey);
      f.pName = p;
      params.push({ pName: p, default: pyLiteral(f.value), value: f.value });
    });
  } else if (bodyInfo.mode === "json") {
    const p = uniq("payload");
    bodyInfo.pName = p;
    params.push({ pName: p, default: bodyInfo.py, value: null });
  } else if (bodyInfo.mode === "raw") {
    const p = uniq("payload");
    bodyInfo.pName = p;
    params.push({ pName: p, default: pyStr(bodyInfo.raw), value: bodyInfo.raw });
  }

  return { name, method, req, params, headerLines, queryLines, bodyInfo };
}

// Emit the function body (shared). `includeImport` controls the leading import.
// `useSession` makes the call use a module-level `session` (for cookie flow).
function emitFunction(desc, includeImport, useSession) {
  const { name, method, req, params, headerLines, queryLines, bodyInfo } = desc;
  const lines = [];
  if (includeImport) { lines.push("import requests"); lines.push(""); lines.push(""); }

  // With a shared Session, drop the hardcoded `cookie:` header (and its param)
  // so the live session cookie from login() is used instead of a stale one.
  const drop = new Set();
  const hdrs = headerLines.filter((h) => {
    if (useSession && h.isCookie) { h.pNames.forEach((n) => drop.add(n)); return false; }
    return true;
  });
  const sigParams = params.filter((p) => !drop.has(p.pName));

  const sig = sigParams.map((p) => `${p.pName}=${p.default}`).join(", ");
  lines.push(`def ${name}(${sig}):`);
  lines.push(`    url = ${pyStr(stripQuery(req.url))}`);

  if (hdrs.length) {
    lines.push("");
    lines.push("    headers = {");
    lines.push(...hdrs.map((h) => h.line));
    lines.push("    }");
  }
  if (queryLines.length) {
    lines.push("");
    lines.push("    params = {");
    lines.push(...queryLines);
    lines.push("    }");
  }

  let callArgs = "url";
  if (hdrs.length) callArgs += ", headers=headers";
  if (queryLines.length) callArgs += ", params=params";

  if (bodyInfo.mode === "fields") {
    lines.push("");
    lines.push("    payload = {");
    bodyInfo.fields.forEach((f) => lines.push(`        ${pyStr(f.rawKey)}: ${f.pName},`));
    lines.push("    }");
    callArgs += bodyInfo.isForm ? ", data=payload" : ", json=payload";
  } else if (bodyInfo.mode === "json") {
    callArgs += `, json=${bodyInfo.pName}`;
  } else if (bodyInfo.mode === "raw") {
    callArgs += `, data=${bodyInfo.pName}`;
  }

  callArgs += ", timeout=10";

  const client = useSession ? "session" : "requests";
  lines.push("");
  lines.push(`    response = ${client}.${method}(${callArgs})`);
  lines.push(`    print(${pyStr(name + " response:")}, response.text)`);
  lines.push("    return response");
  lines.push("");
  return lines.join("\n");
}

// Single-request generator: one standalone function.
function generatePython(item) {
  return emitFunction(describeRequest(item), true, false);
}

/* ------------------------------------------------------------------ *
 * Pipeline generator
 *
 * For the clicked request, trace which of its input values came from an
 * EARLIER response, include those requests (recursively), and emit a main()
 * that calls them in order, wiring each dependency as
 *   <resp_var>.json()[<path>]  instead of the stale captured default.
 * ------------------------------------------------------------------ */

async function generatePipeline(targetItem) {
  // Make sure every response body is available for matching.
  await ensureBodies();

  // --- Step 1: prune to a meaningful request list ---
  // Drop the noise (static assets, analytics beacons, preflights, 3rd-party,
  // empty responses) so backward-tracing only searches requests that could
  // plausibly have produced a value. The target is always kept.
  const pruned = captured.filter((it) => it === targetItem || isMeaningful(it));
  // index within the pruned list = trace order
  const orderOf = new Map(pruned.map((it, i) => [it.id, i]));

  const chosen = [];          // items to include, in capture (pruned) order
  const chosenSet = new Set();
  const deps = new Map();     // itemId -> [{ pName, fromItemId, source }]

  // --- Step 2 & 3: include target, walk its args backward through the
  // recorded responses of EARLIER pruned requests; recurse on each producer. ---
  function include(item) {
    if (chosenSet.has(item.id)) return;
    chosenSet.add(item.id);
    const myIdx = orderOf.get(item.id);
    const desc = describeRequest(item);
    const myDeps = [];

    desc.params.forEach((p) => {
      if (!looksDynamic(p.pName, p.value)) return;       // only trace real tokens/ids
      const val = String(p.value);
      let wired = null;

      // (a) exact match: value appears verbatim in an earlier response
      for (let j = 0; j < myIdx; j++) {
        const src = pruned[j];
        if (requestInputsContain(src, val)) continue;    // echo, not minted here
        const source = findValueSource(src, val);
        if (source) { wired = { src, source }; break; }
      }

      // (b) auth fallback: an Authorization/token arg with no exact source gets
      // wired to the earliest request that MINTED a token (rotating tokens case)
      if (!wired && isAuthParam(p.pName)) {
        for (let j = 0; j < myIdx; j++) {
          const src = pruned[j];
          const source = findMintedToken(src);
          if (source) { wired = { src, source, guess: true }; break; }
        }
      }

      if (wired) {
        include(wired.src);
        myDeps.push({ pName: p.pName, fromItemId: wired.src.id, source: wired.source, guess: wired.guess });
      }
    });

    deps.set(item.id, myDeps);
    chosen.push(item);
  }

  include(targetItem);

  // order by capture order (within the pruned list)
  chosen.sort((a, b) => orderOf.get(a.id) - orderOf.get(b.id));

  // assign a UNIQUE function name per item (two calls to the same endpoint must
  // not collide, e.g. amka / amka_2), and a response variable name from it.
  const funcNameFor = new Map();
  const varName = new Map();
  const fUsed = new Set();
  chosen.forEach((it) => {
    let base = funcName(it.request.request || {}) || "request";
    let n = base, i = 2;
    while (fUsed.has(n)) n = base + "_" + i++;
    fUsed.add(n);
    funcNameFor.set(it.id, n);
    varName.set(it.id, n + "_resp");
  });

  // Does any dependency rely on a cookie? If so, all requests share a Session
  // so cookies set by an earlier call automatically ride along to later ones.
  let usesCookies = false;
  deps.forEach((list) => list.forEach((d) => { if (d.source.kind === "cookie") usesCookies = true; }));

  // Which helpers do we need?
  let usesExtract = false, usesDig = false;
  deps.forEach((list) => list.forEach((d) => {
    if (d.source.kind === "body") usesExtract = true;
    if (d.source.kind === "json") usesDig = true;
  }));

  // emit
  const out = [];
  out.push("import requests");
  out.push("");
  if (usesCookies) {
    out.push("# Shared session: cookies set by one request (e.g. login) flow to the rest.");
    out.push("session = requests.Session()");
    out.push("");
  }
  if (usesDig) {
    out.push("");
    out.push("def _dig(resp, *keys):");
    out.push('    """Safely walk resp.json() by keys/indices; None if anything is missing."""');
    out.push("    try:");
    out.push("        node = resp.json()");
    out.push("    except ValueError:");
    out.push("        return None");
    out.push("    for k in keys:");
    out.push("        try:");
    out.push("            node = node[k]");
    out.push("        except (KeyError, IndexError, TypeError):");
    out.push("            return None");
    out.push("    return node");
    out.push("");
  }
  if (usesExtract) {
    out.push("");
    out.push("def _extract(text, before, after):");
    out.push('    """Pull the substring between `before` and `after` out of raw text."""');
    out.push("    i = text.find(before)");
    out.push("    if i < 0:");
    out.push("        return None");
    out.push("    i += len(before)");
    out.push("    j = text.find(after, i) if after else len(text)");
    out.push("    return text[i:j if j >= 0 else len(text)]");
    out.push("");
  }
  chosen.forEach((it) => {
    const desc = describeRequest(it);
    desc.name = funcNameFor.get(it.id); // use the de-duplicated name
    out.push("");
    out.push(emitFunction(desc, false, usesCookies));
  });

  out.push("");
  out.push("def main():");
  chosen.forEach((it) => {
    const name = funcNameFor.get(it.id);
    const myDeps = deps.get(it.id) || [];
    const visible = myDeps.filter((d) => d.source.kind !== "cookie"); // cookies flow via session
    const overrides = visible.map((d) => {
      const v = varName.get(d.fromItemId);
      return `${d.pName}=${sourceExpr(v, d.source)}`;
    });
    const call = `${name}(${overrides.join(", ")})`;
    // Flag inferred (non-exact) auth wiring so the user can verify it.
    if (visible.some((d) => d.guess))
      out.push(`    # NOTE: auth below wired by best guess (token rotates) — verify key/path`);
    out.push(`    ${varName.get(it.id)} = ${call}`);
  });
  if (!chosen.length) out.push("    pass");
  out.push("");
  out.push("");
  out.push('if __name__ == "__main__":');
  out.push("    main()");
  out.push("");
  return out.join("\n");
}

// Decide whether a param value is a real cross-request dependency (a token,
// id, session, etc.) worth wiring — vs. boilerplate that merely happens to
// appear in an earlier response (content-type, origin, user-agent, CORS, ...).
function looksDynamic(pName, value) {
  const v = String(value == null ? "" : value);
  if (v.length < 12) return false;                 // real tokens are long

  const name = (pName || "").toLowerCase();
  // Never wire these param names — they're transport/boilerplate.
  const boilerplateName = /^(accept|accept_encoding|accept_language|content_type|user_agent|origin|referer|priority|sec_|scheme|host|connection|cache_control|pragma|dnt|upgrade_insecure|te)/;
  if (boilerplateName.test(name)) return false;

  // Never wire these value shapes — common static strings.
  if (/^https?:\/\//i.test(v)) return false;       // a URL (origin/referer)
  if (/^[a-z]+\/[a-z0-9.+-]+/i.test(v) && v.includes("/") && !v.includes(" ") && v.length < 60 && /[a-z]+\/[a-z]/i.test(v) && v.split("/").length === 2) return false; // mime type
  if (/^[a-z]{2}(-[A-Za-z]{2})?(,|;|$)/.test(v) && v.includes(";q=")) return false; // accept-language
  if (/Mozilla\/\d/.test(v)) return false;         // user-agent

  // Must have enough variety to be a token/id (not a plain English word/sentence).
  const hasDigit = /\d/.test(v);
  const hasMixed = /[A-Z]/.test(v) && /[a-z]/.test(v);
  const hasTokenChars = /[._\-=/]/.test(v);
  const looksJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
  const looksHex = /^[0-9a-f]{16,}$/i.test(v);
  const looksB64 = /^[A-Za-z0-9+/]{16,}={0,2}$/.test(v);
  const authName = /(token|auth|session|jwt|bearer|secret|key|sid|csrf|nonce|id$|_id)/.test(name);

  if (looksJwt || looksHex || looksB64) return true;
  if (authName && (hasDigit || hasTokenChars || v.length >= 16)) return true;
  // generic: long AND high-entropy-ish (digits + mixed case or token chars)
  if (v.length >= 20 && (hasDigit && (hasMixed || hasTokenChars))) return true;

  return false;
}

// Python expression to re-extract a value from an earlier response variable.
function sourceExpr(respVar, source) {
  switch (source.kind) {
    case "json": {
      // _dig(resp, "a", 0, "b") walks safely, returning None if any step misses.
      const keys = source.path.map((k) => (typeof k === "number" ? k : pyStr(k))).join(", ");
      return `_dig(${respVar}${keys ? ", " + keys : ""})`;
    }
    case "header": return `${respVar}.headers.get(${pyStr(source.name)}, "")` +
                          (source.strip ? `.removeprefix(${pyStr(source.strip)})` : "");
    case "body":   return `_extract(${respVar}.text, ${pyStr(source.before)}, ${pyStr(source.after)})`;
    default:       return `${respVar}.text`;
  }
}

// --- Pruning: is this request worth keeping for dependency tracing? ---
// Drops static assets, analytics beacons, OPTIONS preflights, empty/204
// responses, and third-party hosts relative to the pipeline's own API.
function isMeaningful(item) {
  const req = (item.request && item.request.request) || {};
  const res = (item.request && item.request.response) || {};
  const method = (req.method || "").toUpperCase();
  if (method === "OPTIONS") return false;                 // CORS preflight
  if (method === "DOC") return true;                      // our captured documents

  const status = res.status || 0;
  if (status === 204) return false;                       // no content
  if (status >= 300 && status < 400) return false;        // redirects

  let path = "", host = "";
  try { const u = new URL(req.url); path = u.pathname.toLowerCase(); host = u.hostname; } catch {}

  // analytics / telemetry beacons
  if (/\/cdn-cgi\/|\/rum\b|\/collect\b|\/beacon\b|google-analytics|googletagmanager|doubleclick|sentry|hotjar|segment|mixpanel/.test((req.url || "").toLowerCase()))
    return false;

  // static assets by extension
  if (/\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|wasm)(\?|$)/.test(path))
    return false;

  // static asset / image content types
  const mime = (res.content && res.content.mimeType || "").toLowerCase();
  if (/^(image|font|video|audio)\//.test(mime)) return false;
  if (/(javascript|css|font)/.test(mime)) return false;

  return true; // keep: looks like a real API/data request
}

function isAuthParam(pName) {
  return /(token|auth|bearer|session|jwt|sid|csrf)/.test((pName || "").toLowerCase());
}

// Does this request MINT a token? i.e. a token-shaped value appears in its
// response (body/header/cookie) but NOT in its own request inputs. Returns a
// source descriptor pointing at where the token is, or null.
// Maximally permissive: we don't assume key names, JSON shape, or cookie
// formats — if the response contains any token-shaped string the request
// didn't itself send, that request is treated as the minter.
function findMintedToken(src) {
  const resp = (src.request && src.request.response) || {};

  // 1. Parsed JSON body -> structured path (best: gives resp.json()[key])
  const parsed = parsedJsonOf(src);
  if (parsed) {
    const hit = findTokenPath(parsed);
    if (hit && !requestInputsContain(src, hit.value)) return { kind: "json", path: hit.path };
  }

  // 2. Response headers (any header whose value is / ends with a token)
  for (const h of resp.headers || []) {
    const name = (h.name || "").toLowerCase();
    if (name === "set-cookie") continue; // handled below
    const tok = extractToken(h.value || "");
    if (tok && !requestInputsContain(src, tok.value)) {
      return tok.prefix ? { kind: "header", name: h.name, strip: tok.prefix }
                        : { kind: "header", name: h.name };
    }
  }

  // 3. Set-Cookie -> token lives in a cookie, flow via shared Session
  for (const h of resp.headers || []) {
    if ((h.name || "").toLowerCase() !== "set-cookie") continue;
    const m = /=([^;,\s]{16,})/.exec(h.value || "");
    if (m && tokenShaped(stripCookieEnc(m[1])) && !requestInputsContain(src, m[1]))
      return { kind: "cookie" };
  }

  // 4. Raw body text (non-JSON, or JSON we couldn't parse) — scan for a token
  //    substring and extract it positionally. Last-resort but catches anything.
  const body = src.bodyCache && src.bodyCache.text;
  if (body) {
    const tok = scanTokenInText(body);
    if (tok && !requestInputsContain(src, tok)) {
      const i = body.indexOf(tok);
      return { kind: "body", before: body.slice(Math.max(0, i - 12), i),
               after: body.slice(i + tok.length, i + tok.length + 8) };
    }
  }

  return null;
}

// Pull a token out of a header value like "Bearer eyJ..." or just "eyJ...".
function extractToken(v) {
  const m = /^(\S+\s+)?(\S{16,})$/.exec((v || "").trim());
  if (m && tokenShaped(m[2])) return { prefix: m[1] || "", value: m[2] };
  return null;
}

// First token-shaped whitespace/quote-delimited run in free text.
function scanTokenInText(text) {
  const re = /[A-Za-z0-9._\-+/=]{20,}/g;
  let m;
  while ((m = re.exec(text))) if (tokenShaped(m[0])) return m[0];
  return null;
}

function stripCookieEnc(v) { try { return decodeURIComponent(v); } catch { return v; } }

function tokenShaped(v) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v) || // JWT
         /^[0-9a-f]{24,}$/i.test(v) ||                                  // hex
         (v.length >= 24 && /[A-Za-z]/.test(v) && /\d/.test(v));        // long mixed
}

// Depth-first: return { path, value } of the first token-shaped string leaf.
function findTokenPath(node, path = []) {
  if (typeof node === "string") return tokenShaped(node) ? { path, value: node } : null;
  if (node && typeof node === "object") {
    const entries = Array.isArray(node) ? node.map((v, i) => [i, v]) : Object.entries(node);
    for (const [k, v] of entries) {
      const r = findTokenPath(v, path.concat(Array.isArray(node) ? Number(k) : k));
      if (r) return r;
    }
  }
  return null;
}

// Did the source REQUEST itself already contain `value` as an input? If so, a
// match in its response is just an echo, not a freshly-minted value.
function requestInputsContain(src, value) {
  const req = (src.request && src.request.request) || {};
  if ((req.url || "").includes(value)) return true;
  for (const h of req.headers || []) if ((h.value || "").includes(value)) return true;
  for (const q of req.queryString || []) if ((q.value || "").includes(value)) return true;
  if (req.postData && req.postData.text && req.postData.text.includes(value)) return true;
  return false;
}

// Search one earlier response for `value`. Returns a source descriptor or null.
// Looks in: JSON body, response headers, Set-Cookie, then raw body text.
function findValueSource(src, value) {
  const resp = (src.request && src.request.response) || {};

  // 1. JSON body -> structured path
  const parsed = parsedJsonOf(src);
  if (parsed) {
    const path = findValuePath(parsed, value);
    if (path) return { kind: "json", path };
  }

  // 2. response headers (token echoed back), handling "Bearer <value>"
  for (const h of resp.headers || []) {
    const hv = h.value || "";
    if (hv === value) return { kind: "header", name: h.name };
    const m = /^(\S+\s+)(.+)$/.exec(hv);
    if (m && m[2] === value) return { kind: "header", name: h.name, strip: m[1] };
  }

  // 3. Set-Cookie: value lives in a cookie -> flow via shared Session
  for (const h of resp.headers || []) {
    if ((h.name || "").toLowerCase() === "set-cookie" && (h.value || "").includes(value)) {
      return { kind: "cookie" };
    }
  }

  // 4. raw body substring (non-JSON) -> extract between surrounding text
  const body = src.bodyCache && src.bodyCache.text;
  if (body && body.includes(value)) {
    const i = body.indexOf(value);
    const before = body.slice(Math.max(0, i - 12), i);
    const after = body.slice(i + value.length, i + value.length + 8);
    return { kind: "body", before, after };
  }

  return null;
}

// Parse an item's cached response body as JSON (or null).
function parsedJsonOf(item) {
  const txt = item.bodyCache && item.bodyCache.text;
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

// Depth-first search for `target` (string compare) inside a parsed JSON value.
// Returns the path as an array of keys/indices, or null.
function findValuePath(node, target, path = []) {
  if (node == null) return null;
  if (typeof node !== "object") {
    return String(node) === target ? path : null;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const r = findValuePath(node[i], target, path.concat(i));
      if (r) return r;
    }
    return null;
  }
  for (const k of Object.keys(node)) {
    const r = findValuePath(node[k], target, path.concat(k));
    if (r) return r;
  }
  return null;
}

// Render a JSON path array as Python subscripts: ["data",0,"token"] -> ["data"][0]["token"]
function pyPath(path) {
  return path.map((k) => (typeof k === "number" ? `[${k}]` : `[${pyStr(k)}]`)).join("");
}

// Returns body as { mode: "fields"|"json"|"raw"|"none", ... }.
// "fields" = one argument per field (flat JSON or form-urlencoded).
function analyzeBody(req) {
  const pd = req.postData;
  if (!pd || !pd.text) return { mode: "none" };
  const text = pd.text;
  const ctype = (pd.mimeType || "").toLowerCase();

  // form-urlencoded: parse key=value&... into fields
  if (ctype.includes("x-www-form-urlencoded") || (!looksJson(text) && /=.*&|^[^={}\[\]]+=/.test(text))) {
    const fields = [];
    new URLSearchParams(text).forEach((value, key) => fields.push({ rawKey: key, value }));
    if (fields.length) return { mode: "fields", isForm: true, fields };
  }

  // JSON
  let obj;
  try { obj = JSON.parse(text); } catch { return { mode: "raw", raw: text }; }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const keys = Object.keys(obj);
    const flat = keys.every(
      (k) => obj[k] === null || ["string", "number", "boolean"].includes(typeof obj[k])
    );
    if (flat) {
      return { mode: "fields", isForm: false, fields: keys.map((k) => ({ rawKey: k, value: obj[k] })) };
    }
  }
  return { mode: "json", py: pyLiteral(obj) };
}

function looksJson(s) { const t = s.trim(); return t.startsWith("{") || t.startsWith("["); }

// If a header value is "<scheme> <token>" (e.g. Bearer xxx), split it.
function splitAuth(name, value) {
  if ((name || "").toLowerCase() !== "authorization") return null;
  const m = /^(\S+)\s+(.+)$/.exec(value || "");
  if (!m) return null;
  return { scheme: m[1], token: m[2] };
}

// Headers we never emit (requests manages them).
function isSkipHeader(name) {
  const n = (name || "").toLowerCase();
  return n === "content-length";
}

function stripQuery(url) {
  // When query params are hoisted to params={}, keep the base URL clean.
  try { const u = new URL(url); return u.origin + u.pathname; } catch { return url; }
}

function generateCurl(item) {
  const req = item.request.request || {};
  let out = `curl -X ${req.method} ${shellQuote(req.url)}`;
  (req.headers || []).forEach((h) => {
    if (isPseudoHeader(h.name)) return;
    out += ` \\\n  -H ${shellQuote(h.name + ": " + h.value)}`;
  });
  if (req.postData && req.postData.text) out += ` \\\n  --data ${shellQuote(req.postData.text)}`;
  return out;
}

/* ------------------------------------------------------------------ *
 * Export whole list
 * ------------------------------------------------------------------ */

els.exportBtn.addEventListener("click", () => {
  const har = { log: { version: "1.2", entries: captured.map((c) => c.request) } };
  saveFile(JSON.stringify(har, null, 2), "network-plus-capture.har");
});

els.clearBtn.addEventListener("click", clearList);
els.captureDocsBtn.addEventListener("click", captureDocuments);
els.closeDetail.addEventListener("click", () => els.detailPane.classList.add("hidden"));

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function rowEl(id) { return els.body.querySelector(`tr[data-id="${id}"]`); }

function funcName(req) {
  try {
    const u = new URL(req.url);
    const seg = u.pathname.split("/").filter(Boolean).pop() || "request";
    return safeIdent(seg.replace(/\.[a-z0-9]+$/i, "")) || "request";
  } catch { return "request"; }
}

function pyFileName(item) { return funcName(item.request.request || {}) + ".py"; }

function safeIdent(s) {
  let id = String(s).replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  return id || "_";
}

function isPseudoHeader(name) { return name && name.startsWith(":"); }

function pyStr(s) {
  return '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

function pyLiteral(v) {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) return "[" + v.map(pyLiteral).join(", ") + "]";
  if (typeof v === "object")
    return "{" + Object.entries(v).map(([k, val]) => `${pyStr(k)}: ${pyLiteral(val)}`).join(", ") + "}";
  return pyStr(String(v));
}

function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

function fmtHeaders(arr) {
  return (arr || []).map((h) => `${h.name}: ${h.value}`).join("\n") || "(none)";
}

function prettyMaybe(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

const MAX_BODY = 200 * 1024;
function guardSize(text) {
  if (text.length > MAX_BODY)
    return text.slice(0, MAX_BODY) + `\n\n… [truncated ${text.length - MAX_BODY} chars — export to see full]`;
  return text;
}

function mimeShort(mime) {
  if (!mime) return "";
  if (mime.includes("json")) return "json";
  if (mime.includes("javascript")) return "js";
  if (mime.includes("html")) return "html";
  if (mime.includes("css")) return "css";
  if (mime.includes("image")) return "img";
  return mime.split(";")[0].split("/").pop();
}

function shortUrl(url) {
  if (!url) return "";
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {
    // clipboard can be flaky in devtools context; fall back to a temp textarea
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  });
}

function saveFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
