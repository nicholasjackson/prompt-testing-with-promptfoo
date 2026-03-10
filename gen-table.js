const path = require('path');
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('Usage: node gen-table.js <results.json>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const results = data.results.results;
const groups = {};
for (const r of results) {
  const model = (r.provider && r.provider.label) ? r.provider.label : 'unknown';
  const promptLabel = (r.prompt && r.prompt.label) ? r.prompt.label : '';
  const promptKey = promptLabel.includes('without') ? 'without-context' : 'with-context';
  const key = model + '|' + promptKey;
  if (!groups[key]) groups[key] = { model, prompt: promptKey, warmTtft: [], coldTtft: [], decodeTps: [], prefillTps: [], totalMs: [], promptTokens: [], responseTokens: [] };
  const m = r.metadata;
  // Warm TTFT = prefill only (model already in VRAM)
  if (m && m.promptEvalDurationMs != null) groups[key].warmTtft.push(m.promptEvalDurationMs);
  // Cold TTFT = load + prefill (total minus decode)
  if (m && m.totalDurationMs != null && m.evalDurationMs != null) groups[key].coldTtft.push(m.totalDurationMs - m.evalDurationMs);
  if (m && m.decodeTps != null) groups[key].decodeTps.push(m.decodeTps);
  if (m && m.prefillTps != null) groups[key].prefillTps.push(m.prefillTps);
  if (m && m.totalDurationMs != null) groups[key].totalMs.push(m.totalDurationMs);
  if (m && m.promptEvalCount != null) groups[key].promptTokens.push(m.promptEvalCount);
  if (m && m.evalCount != null) groups[key].responseTokens.push(m.evalCount);
}
const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 'N/A';
const pct = (arr, p) => {
  if (!arr.length) return 'N/A';
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p / 100)];
};
console.log('| Model | Prompt | Avg Prompt Tokens | Avg Response Tokens | Warm TTFT p50 (ms) | Warm TTFT p95 (ms) | Cold TTFT p50 (ms) | Cold TTFT p95 (ms) | Avg Decode (tok/s) | Avg Prefill (tok/s) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
const sorted = Object.values(groups).sort((a, b) =>
  a.model.localeCompare(b.model) || a.prompt.localeCompare(b.prompt)
);
for (const g of sorted) {
  console.log('| ' + [g.model, g.prompt, avg(g.promptTokens), avg(g.responseTokens), pct(g.warmTtft, 50), pct(g.warmTtft, 95), pct(g.coldTtft, 50), pct(g.coldTtft, 95), avg(g.decodeTps), avg(g.prefillTps)].join(' | ') + ' |');
}
