/** Records the hackathon demo video: audits + agent society pipeline, with captions. */
import { chromium } from "playwright";

const BASE = "https://citeguard.boundy.workers.dev";
const OUT_DIR = "hackathon/video-raw";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();

// Playwright captures frames only on repaint; a tiny always-animating element
// forces ~constant repaints so the recording is smooth instead of ~5 fps.
await page.addInitScript(() => {
  const tick = () => {
    let el = document.getElementById("__fps");
    if (!el && document.body) {
      el = document.createElement("div");
      el.id = "__fps";
      el.style.cssText =
        "position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;z-index:9998;pointer-events:none;background:#fff";
      document.body.appendChild(el);
    }
    if (el) el.style.transform = `translateX(${performance.now() % 3}px)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:rgba(13,17,23,.92);" +
        "color:#e6edf3;font:600 20px/1.4 'Segoe UI',sans-serif;text-align:center;padding:14px 20px;" +
        "border-top:2px solid #3fb950";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function scrollSlow(px, durationMs = 3000) {
  await page.evaluate(
    ({ px, durationMs }) =>
      new Promise((resolve) => {
        const start = performance.now();
        const from = window.scrollY;
        const step = (now) => {
          const t = Math.min((now - start) / durationMs, 1);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          window.scrollTo(0, from + px * ease);
          if (t < 1) requestAnimationFrame(step);
          else resolve(undefined);
        };
        requestAnimationFrame(step);
      }),
    { px, durationMs },
  );
}

// --- Scene 1: intro + audit ---
await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
await caption("CiteGuard — AI text is full of citations that don't say what the text claims. Let's catch them.");
await page.waitForTimeout(4000);

await caption("Paste any document. CiteGuard fetches EVERY cited source and checks each claim against it.");
await page.waitForTimeout(3000);
await page.click("#auditBtn");
await page.waitForSelector("#auditOut .score", { timeout: 120000 });
await caption("Verdicts with verbatim evidence quotes — the Moon myth is CONTRADICTED by the very page it cites.");
await page.waitForTimeout(2500);
await scrollSlow(700, 3000);
await page.waitForTimeout(3000);

// --- Scene 2: agent society ---
await page.evaluate(() => document.querySelectorAll(".card")[1].scrollIntoView({ behavior: "smooth" }));
await page.waitForTimeout(1500);
await caption("Agent Society: a Qwen writer agent drafts... and a verifier agent audits it. Live.");
await page.waitForTimeout(2500);
await page.click("#agentBtn");
await caption("Writer agent (qwen) drafting a cited paragraph — this is happening live on Qwen Cloud...");
await page.waitForSelector("#agentOut h3", { timeout: 180000 });
await caption("Now the verifier fetched each source and judged every claim. Unsupported citations = BLOCKED.");
await page.waitForTimeout(2000);
await scrollSlow(900, 3500);
await page.waitForTimeout(4000);

// --- Scene 3: end card ---
await page.goto(
  "data:text/html," +
    encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#0d1117;color:#e6edf3;
    font-family:'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh">
    <div style="font-size:52px;font-weight:800">Cite<span style="color:#3fb950">Guard</span></div>
    <div style="font-size:20px;color:#8b949e;margin:14px 0 30px">The API-shaped fix for vibe citing</div>
    <div style="font-size:18px;line-height:2">
      Live demo: <b>citeguard.boundy.workers.dev/demo</b><br>
      Open source: <b>github.com/Franksterino/citeguard</b><br>
      MCP &middot; REST API &middot; Apify Actor &middot; powered by <b>Qwen Cloud</b>
    </div></body></html>`),
);
await page.waitForTimeout(5000);

await ctx.close();
await browser.close();
console.log("Video recorded to", OUT_DIR);
