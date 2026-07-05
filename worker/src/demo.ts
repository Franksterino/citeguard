/** Demo page served at /demo — plain HTML+JS, no build step. */

export const DEMO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CiteGuard — catch fake citations before you publish</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
         background: #0d1117; color: #e6edf3; line-height: 1.55; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h1 .g { color: #3fb950; }
  .sub { color: #8b949e; margin: 0 0 28px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; margin-bottom: 24px; }
  .card h2 { margin: 0 0 6px; font-size: 18px; }
  .hint { color: #8b949e; font-size: 13px; margin: 0 0 12px; }
  textarea, input[type=text] { width: 100%; background: #0d1117; color: #e6edf3; border: 1px solid #30363d;
    border-radius: 8px; padding: 12px; font: 13px/1.5 ui-monospace, monospace; resize: vertical; }
  textarea { min-height: 130px; }
  button { margin-top: 12px; background: #238636; color: #fff; border: 0; border-radius: 8px;
    padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  .verdict { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .v-supported { background: #1a7f37; } .v-partially_supported { background: #9e6a03; }
  .v-contradicted { background: #b62324; } .v-unsupported { background: #b62324; }
  .v-uncertain { background: #57606a; } .v-could_not_fetch { background: #57606a; }
  .claim { border-top: 1px solid #21262d; padding: 14px 0; }
  .claim p { margin: 4px 0; }
  .ev { color: #8b949e; font-size: 13px; border-left: 3px solid #30363d; padding-left: 10px; margin-top: 6px; }
  .score { font-size: 40px; font-weight: 800; }
  .gate-ok { color: #3fb950; font-weight: 800; }
  .gate-block { color: #f85149; font-weight: 800; }
  a { color: #58a6ff; text-decoration: none; }
  .foot { color: #8b949e; font-size: 13px; margin-top: 40px; }
  .spin { color: #8b949e; font-size: 13px; margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Cite<span class="g">Guard</span></h1>
  <p class="sub">Per-claim citation verification for AI-generated text. Every verdict comes with a verbatim evidence quote — verify it yourself in seconds.</p>

  <div class="card">
    <h2>1 · Audit a document</h2>
    <p class="hint">Paste text with citations (markdown links, DOIs, bare URLs). CiteGuard fetches every source and checks whether it actually supports the claim.</p>
    <textarea id="doc">The Eiffel Tower is 330 metres tall ([Wikipedia](https://en.wikipedia.org/wiki/Eiffel_Tower)). The Great Wall of China is visible from the Moon with the naked eye ([Wikipedia](https://en.wikipedia.org/wiki/Great_Wall_of_China)). Transformers were introduced in 2017, see 10.48550/arXiv.1706.03762.</textarea>
    <button id="auditBtn" onclick="audit()">Audit citations</button>
    <div id="auditSpin" class="spin" hidden>Fetching sources and judging claims… (10–40 s)</div>
    <div id="auditOut"></div>
  </div>

  <div class="card">
    <h2>2 · Agent Society demo: writer&nbsp;+&nbsp;verifier</h2>
    <p class="hint">A writer agent (Qwen) drafts a cited paragraph on your topic. A verifier agent (CiteGuard + Qwen judge) audits every citation and gates the draft. Watch one AI catch another AI's fake citations, live.</p>
    <input type="text" id="topic" placeholder="Topic, e.g. 'history of the Prague astronomical clock'" value="history of the Prague astronomical clock">
    <button id="agentBtn" onclick="agentDemo()">Run writer → verifier pipeline</button>
    <div id="agentSpin" class="spin" hidden>Writer drafting, verifier auditing… (20–60 s)</div>
    <div id="agentOut"></div>
  </div>

  <p class="foot">
    Free tier: 50 requests/day. Open source: <a href="https://github.com/Franksterino/citeguard">github.com/Franksterino/citeguard</a> ·
    API docs at <a href="/">/</a> · MCP endpoint at <code>/mcp</code> ·
    <a href="https://apify.com/franksterino/ai-citation-auditor">Apify Actor</a>
  </p>
</div>
<script>
function esc(s) { return (s || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function renderReport(r) {
  if (!r.verdicts.length) return '<p class="hint">No verifiable citations found in the text — nothing to audit.</p>';
  let h = '<p class="score">' + r.integrityScore + '/100</p><p class="hint">citation integrity score — ' +
    r.summary.supported + ' supported · ' + r.summary.partiallySupported + ' partial · ' +
    r.summary.contradicted + ' contradicted · ' + r.summary.unsupported + ' unsupported · ' +
    r.summary.couldNotFetch + ' unfetchable</p>';
  for (const v of r.verdicts) {
    h += '<div class="claim"><span class="verdict v-' + v.verdict + '">' + v.verdict.replace(/_/g, " ") + '</span>' +
      '<p>' + esc(v.claim) + '</p>' +
      '<p class="hint"><a href="' + esc(v.source) + '" rel="nofollow">' + esc(v.source) + '</a>' +
      (v.sourceStatus.fromArchive ? ' · via archive.org' : '') +
      (v.sourceStatus.httpStatus >= 400 || v.sourceStatus.httpStatus === 0 ? ' · HTTP ' + v.sourceStatus.httpStatus : '') + '</p>' +
      (v.evidence ? '<p class="ev">“' + esc(v.evidence) + '”</p>' : '') +
      (v.reasoning ? '<p class="hint">' + esc(v.reasoning) + '</p>' : '') + '</div>';
  }
  return h;
}

async function audit() {
  const btn = document.getElementById("auditBtn"), spin = document.getElementById("auditSpin"),
        out = document.getElementById("auditOut");
  btn.disabled = true; spin.hidden = false; out.innerHTML = "";
  try {
    const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: document.getElementById("doc").value }) });
    const data = await res.json();
    out.innerHTML = res.ok ? renderReport(data) : '<p class="hint">Error: ' + esc(data.message || data.error) + '</p>';
  } catch (e) { out.innerHTML = '<p class="hint">Error: ' + esc(String(e)) + '</p>'; }
  btn.disabled = false; spin.hidden = true;
}

async function agentDemo() {
  const btn = document.getElementById("agentBtn"), spin = document.getElementById("agentSpin"),
        out = document.getElementById("agentOut");
  btn.disabled = true; spin.hidden = false; out.innerHTML = "";
  try {
    const res = await fetch("/api/agent-demo", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: document.getElementById("topic").value }) });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<p class="hint">Error: ' + esc(data.message || data.error) + '</p>'; }
    else {
      out.innerHTML =
        '<h3>Writer agent draft</h3><p style="white-space:pre-wrap">' + esc(data.draft) + '</p>' +
        '<h3>Verifier agent audit</h3>' + renderReport(data.report) +
        '<h3>Gate decision: <span class="' + (data.approved ? "gate-ok" : "gate-block") + '">' +
        (data.approved ? "APPROVED" : "BLOCKED — unsupported citations found") + '</span></h3>';
    }
  } catch (e) { out.innerHTML = '<p class="hint">Error: ' + esc(String(e)) + '</p>'; }
  btn.disabled = false; spin.hidden = true;
}
</script>
</body>
</html>`;
