// Headless screenshot harness for Glean.
// Drives the REAL app in headless Edge: injects a representative subset of a sample
// library, lets the similarity map build, then captures (1) the map and (2) a sequencer
// with a kit + pattern set up. Run:  npm run shoot
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const LIB = process.env.GLEAN_LIB || "E:/Samples/digitakt-out";
const APP = "file://" + path.resolve("app/index.html").replace(/\\/g, "/");
const OUT = path.resolve("docs");
const CATS = ["KICKS","SNARES","HATS","CLAPS","PERC","TOMS","CYMBALS","BASS","LEADS","PADS","FX","LOOPS"];
const KIT  = ["KICKS","SNARES","HATS","CLAPS","PERC","TOMS","BASS","CYMBALS"]; // 8 tracks
const PER_CAT = 18, MAX_BYTES = 400*1024;

// gather a small, varied subset (smallest files per category) from the library
function gather(){
  const out = [];
  for (const cat of CATS){
    const dir = path.join(LIB, cat);
    if (!fs.existsSync(dir)) continue;
    let files = fs.readdirSync(dir).filter(f=>/\.wav$/i.test(f))
      .map(f=>({abs:path.join(dir,f), name:f, size:fs.statSync(path.join(dir,f)).size}))
      .filter(f=>f.size<=MAX_BYTES).sort((a,b)=>a.size-b.size).slice(0,PER_CAT);
    for (const f of files) out.push({ b64: fs.readFileSync(f.abs).toString("base64"),
      name: f.name, rel: `digitakt-out/${cat}/${f.name}` });
  }
  return out;
}

const STEPS = { // per-track 16-step pattern, indexed by KIT order
  0:[0,4,8,12], 1:[4,12], 2:[0,2,4,6,8,10,12,14], 3:[4,12],
  4:[2,6,10,14], 5:[13,15], 6:[0,3,8,11], 7:[0]
};

const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1320, height: 800 }, deviceScaleFactor: 2 });
  page.on("console", m => { if (m.type()==="error") console.log("PAGE ERR:", m.text()); });
  await page.goto(APP);

  console.log("injecting library subset…");
  const files = gather();
  console.log(`  ${files.length} files`);
  await page.evaluate(async (files) => {
    const list = files.map(f => {
      const bytes = Uint8Array.from(atob(f.b64), c => c.charCodeAt(0));
      const file = new File([bytes], f.name, { type: "audio/wav" });
      Object.defineProperty(file, "webkitRelativePath", { value: f.rel });
      return file;
    });
    window.index(list);
  }, files);

  console.log("waiting for similarity map to build…");
  await page.waitForFunction(() =>
    document.querySelector("#prog").textContent === "" &&
    /\d+ of \d+ sounds/.test(document.querySelector("#maphint").textContent || ""),
    null, { timeout: 120000 });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, "screenshot-map.png") });
  console.log("✔ map screenshot");

  // ---- build a kit by driving the UI: per track → assign mode → filter category → click map ----
  const canvas = await page.$("#map");
  const box = await canvas.boundingBox();
  for (let t = 0; t < KIT.length; t++){
    await page.evaluate(i => document.querySelectorAll(".track")[i].querySelector(".slot").click(), t); // → assign mode (empty track)
    await sleep(120);
    await page.evaluate(() => { const a=[...document.querySelectorAll(".crumb")].find(c=>c.textContent==="All"); if(a) a.click(); }); // root
    await sleep(120);
    await page.evaluate(cat => { const f=[...document.querySelectorAll("#side .cat .lbl")].find(l=>l.textContent.trim()===cat); if(f) f.click(); }, KIT[t]);
    await sleep(150);
    // click the centroid of the visible (filtered) dots → assigns nearest, returns to sequencer
    await page.mouse.click(box.x + box.width*0.5, box.y + box.height*0.5);
    await sleep(150);
  }
  console.log("✔ kit assigned");

  // program the pattern
  await page.evaluate(STEPS => {
    const rows = document.querySelectorAll(".track");
    for (const r in STEPS){ const steps = rows[r].querySelectorAll(".step");
      for (const s of STEPS[r]) steps[s].click(); }
  }, STEPS);

  // tweak a couple of knobs (drag) for visual interest: lower the BASS filter, open SNARE a touch
  async function dragKnob(track, knobIdx, dy){
    const k = await page.evaluateHandle(({t,i})=>document.querySelectorAll(".track")[t].querySelectorAll(".knob2")[i], {t:track,i:knobIdx});
    const b = await k.boundingBox(); if(!b) return;
    const cx=b.x+b.width/2, cy=b.y+b.height/2;
    await page.mouse.move(cx,cy); await page.mouse.down(); await page.mouse.move(cx,cy-dy,{steps:6}); await page.mouse.up();
  }
  await dragKnob(6, 2, 26);   // bass: filter down
  await dragKnob(4, 1, 18);   // perc: pan
  await sleep(100);

  await page.evaluate(() => window.setView("seq"));
  await sleep(150);
  await page.click("#play");
  await sleep(280);           // let the playhead advance a few steps
  await page.screenshot({ path: path.join(OUT, "screenshot-sequencer.png") });
  console.log("✔ sequencer screenshot");

  await browser.close();
  console.log("done →", OUT);
})().catch(e => { console.error(e); process.exit(1); });
