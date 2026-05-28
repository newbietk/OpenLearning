/**
 * Generate interactive D3.js graph HTML with community colors.
 * Run: npx tsx scripts/render-graph.ts [data-dir]
 *   data-dir: path to verify-output/<kb_id> directory (default: verify-output/learn_coding)
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const DATA_DIR = argv[0] || "verify-output/learn_coding";
const OUT_FILE = path.join(DATA_DIR, "graph.html");

// Read data from the pipeline output
const nodesRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "nodes.json"), "utf-8"));
const edgesRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "edges.json"), "utf-8"));

// Only include nodes with degrees > 0 (connected) for cleaner visualization
const nodeMap = new Map(nodesRaw.map((n: any) => [n.id, n]));
const validEdges = edgesRaw.filter((e: any) => nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId));

const degrees = new Map<string, number>();
for (const e of validEdges) {
  degrees.set(e.sourceNodeId, (degrees.get(e.sourceNodeId) ?? 0) + 1);
  degrees.set(e.targetNodeId, (degrees.get(e.targetNodeId) ?? 0) + 1);
}

// Community color palette (20 distinct colors)
const COMM_COLORS = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
  "#aec7e8", "#ffbb78", "#98df8a", "#ff9896", "#c5b0d5",
  "#c49c94", "#f7b6d2", "#c7c7c7", "#dbdb8d", "#9edae5",
];

function commColor(cid: number): string {
  return COMM_COLORS[cid % COMM_COLORS.length];
}

// Separate connected vs isolated nodes
const connectedNodes = nodesRaw.filter((n: any) => (degrees.get(n.id) ?? 0) > 0);
const isolatedCount = nodesRaw.length - connectedNodes.length;

// Build D3 data
const graphNodes = connectedNodes.map((n: any) => {
  const cid = n._community ?? -1;
  return {
    id: n.id,
    label: n.label,
    type: n.nodeType,
    community: cid,
    color: commColor(cid),
    degree: degrees.get(n.id) ?? 0,
    radius: Math.max(3, Math.min(18, Math.sqrt((degrees.get(n.id) ?? 1)) * 2.5)),
  };
});

const graphLinks = validEdges
  .filter((e: any) => degrees.has(e.sourceNodeId) && degrees.has(e.targetNodeId))
  .map((e: any, i: number) => ({
    source: e.sourceNodeId,
    target: e.targetNodeId,
    relation: e.relation,
    color: e.relation === "contains" ? "#444" : e.relation === "imports" ? "#ff7f0e" : e.relation === "inherits" ? "#2ca02c" : "#1f77b4",
    id: `e${i}`,
  }));

// Community summary
const commSummary = new Map<number, { count: number; labels: string[] }>();
for (const n of graphNodes) {
  const s = commSummary.get(n.community) ?? { count: 0, labels: [] };
  s.count++;
  if (s.labels.length < 2) s.labels.push(n.label);
  commSummary.set(n.community, s);
}
const sortedComms = Array.from(commSummary.entries())
  .filter(([cid]) => cid >= 0)
  .sort(([, a], [, b]) => b.count - a.count);

// Count by type
const typeCounts: Record<string, number> = {};
for (const n of graphNodes) typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;

console.log(`Rendering: ${graphNodes.length} connected nodes, ${graphLinks.length} edges, ${sortedComms.length} communities`);
console.log(`Filtered: ${isolatedCount} isolated nodes hidden`);
console.log(`Writing: ${OUT_FILE}`);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Knowledge Graph — learn-coding</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"Microsoft YaHei",sans-serif;overflow:hidden;background:#1a1a2e}
#graph{width:100vw;height:100vh}
svg{width:100%;height:100%}
.link{stroke-opacity:0.25;transition:stroke-opacity .2s}
.link:hover{stroke-opacity:0.7}
.node circle{cursor:pointer;transition:opacity .2s}
.node text{font-size:9px;fill:#ccc;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.9)}
#tooltip{position:absolute;padding:10px 14px;background:rgba(0,0,0,.88);color:#eee;
  border-radius:6px;font-size:13px;pointer-events:none;opacity:0;transition:opacity .15s;
  max-width:400px;border:1px solid rgba(255,255,255,.1);z-index:100}
#tooltip .label{font-size:15px;font-weight:600;margin-bottom:4px}
#tooltip .meta{color:#aaa;font-size:11px}
#panel{position:absolute;top:10px;left:10px;background:rgba(0,0,0,.85);color:#ccc;
  padding:10px 14px;border-radius:8px;font-size:11px;border:1px solid rgba(255,255,255,.1);
  max-height:85vh;overflow-y:auto;z-index:50;min-width:240px}
#panel h3{font-size:13px;margin:0 0 6px;color:#fff}
#panel .sec{margin-top:8px;font-size:10px;color:#aaa;font-weight:600}
#panel .row{display:flex;align-items:center;gap:5px;margin:2px 0;font-size:10px;cursor:pointer}
#panel .row:hover{background:rgba(255,255,255,.05)}
#panel .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
#panel .count{color:#888;font-size:9px;flex-shrink:0}
#search{position:absolute;top:10px;right:10px;z-index:50}
#search input{padding:7px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.15);
  background:rgba(0,0,0,.85);color:#eee;font-size:12px;width:200px;outline:none}
#search input::placeholder{color:#555}
#results{background:rgba(0,0,0,.9);margin-top:3px;border-radius:6px;
  max-height:180px;overflow-y:auto;display:none;border:1px solid rgba(255,255,255,.1)}
#results .r{padding:5px 8px;cursor:pointer;font-size:10px;color:#ccc;border-bottom:1px solid rgba(255,255,255,.03)}
#results .r:hover{background:rgba(255,255,255,.08)}
#info{position:absolute;bottom:8px;left:10px;color:#555;font-size:10px;z-index:50}
.comm-toggle{display:none}
</style>
</head>
<body>
<div id="panel">
  <h3>learn-coding · Knowledge Graph</h3>
  <div style="font-size:10px;color:#888;margin-bottom:6px">
    ${graphNodes.length} nodes · ${graphLinks.length} edges · ${sortedComms.length} communities<br>
    <span style="color:#666">${isolatedCount} isolated nodes hidden</span>
  </div>
  <div class="sec">Communities</div>
  ${sortedComms.slice(0, 15).map(([cid, s], i) => `
    <div class="row" data-comm="${cid}" onclick="toggleComm(${cid})">
      <div class="dot" style="background:${commColor(cid)}"></div>
      <span style="flex:1">C${cid}: ${s.labels.join(", ").slice(0, 30)}</span>
      <span class="count">${s.count}</span>
    </div>`).join("")}
  ${sortedComms.length > 15 ? `<div style="font-size:9px;color:#555;margin-top:3px">+ ${sortedComms.length - 15} more communities</div>` : ""}
  <div class="sec" style="margin-top:10px">Node Types</div>
  ${Object.entries(typeCounts).sort(([,a],[,b]) => b - a).slice(0, 8).map(([t, c]) => `
    <div class="row"><div class="dot" style="background:${commColor(999)}"></div><span style="flex:1">${t}</span><span class="count">${c}</span></div>`).join("")}
</div>
<div id="search">
  <input type="text" id="search-input" placeholder="Search nodes...">
  <div id="results"></div>
</div>
<div id="tooltip"></div>
<div id="info">🖱 Drag pan · Scroll zoom · Drag nodes · Click node to highlight · Press Esc to reset</div>
<div id="graph"></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const data = ${JSON.stringify({ nodes: graphNodes, links: graphLinks })};
const W = window.innerWidth, H = window.innerHeight;

const svg = d3.select("#graph").append("svg").attr("viewBox",[0,0,W,H]);
const g = svg.append("g");

const zoom = d3.zoom().scaleExtent([0.05,6]).on("zoom",e=>g.attr("transform",e.transform));
svg.call(zoom);

const sim = d3.forceSimulation(data.nodes)
  .force("link", d3.forceLink(data.links).id(d=>d.id).distance(60))
  .force("charge", d3.forceManyBody().strength(-120))
  .force("center", d3.forceCenter(W/2,H/2))
  .force("collision", d3.forceCollide().radius(d=>d.radius+4));

const link = g.append("g").selectAll("line").data(data.links).join("line")
  .attr("class","link").attr("stroke",d=>d.color)
  .attr("stroke-width",d=>d.relation==="inherits"?2:d.relation==="imports"?1:.5);

const node = g.append("g").selectAll("g").data(data.nodes).join("g").attr("class","node")
  .call(d3.drag().on("start",(e,d)=>{if(!e.active)sim.alphaTarget(.3).restart();d.fx=d.x;d.fy=d.y})
    .on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y})
    .on("end",(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null}));

node.append("circle").attr("r",d=>d.radius).attr("fill",d=>d.color)
  .attr("stroke","#fff").attr("stroke-width",.5).attr("opacity",.85);

node.append("text").text(d=>d.label.length>30?d.label.slice(0,30)+"...":d.label)
  .attr("x",d=>d.radius+4).attr("y",2.5);

const tip = d3.select("#tooltip");
node.on("mouseenter",(e,d)=>{
  tip.style("opacity",1).html(\`<div class="label">\${d.label}</div>
    <div class="meta">type: \${d.type} · degree: \${d.degree} · community: \${d.community}</div>\`);
}).on("mousemove",e=>{tip.style("left",(e.pageX+12)+"px").style("top",(e.pageY-10)+"px")})
 .on("mouseleave",()=>tip.style("opacity",0));

// Click to highlight neighbors
let highlightedComm = -1;
node.on("click",(e,d)=>{
  e.stopPropagation();
  const nid = d.id;
  const connected = new Set();
  data.links.forEach(l=>{
    if(l.source.id===nid||l.target.id===nid){
      connected.add(l.source.id===nid?l.target.id:l.source.id);
    }
  });
  node.select("circle").attr("opacity",n=>connected.has(n.id)||n.id===nid?1:.08);
  node.select("text").attr("opacity",n=>connected.has(n.id)||n.id===nid?1:.05);
  link.attr("stroke-opacity",l=>l.source.id===nid||l.target.id===nid?.7:.03);
  highlightedComm = d.community;
});

// Toggle community visibility
window.toggleComm = function(cid) {
  if (highlightedComm === cid) {
    // Reset
    node.select("circle").attr("opacity",.85);
    node.select("text").attr("opacity",1);
    link.attr("stroke-opacity",.25);
    highlightedComm = -1;
    return;
  }
  highlightedComm = cid;
  node.select("circle").attr("opacity",n=>n.community===cid?1:.06);
  node.select("text").attr("opacity",n=>n.community===cid?1:.03);
  link.attr("stroke-opacity",l=>{
    const s = data.nodes.find(n=>n.id===l.source.id);
    const t = data.nodes.find(n=>n.id===l.target.id);
    return (s&&s.community===cid)||(t&&t.community===cid)?.5:.02;
  });
};

// Reset on background click or Escape
svg.on("click",()=>{
  node.select("circle").attr("opacity",.85);
  node.select("text").attr("opacity",1);
  link.attr("stroke-opacity",.25);
  highlightedComm = -1;
});
d3.select("body").on("keydown",e=>{
  if(e.key==="Escape"){
    node.select("circle").attr("opacity",.85);
    node.select("text").attr("opacity",1);
    link.attr("stroke-opacity",.25);
    highlightedComm = -1;
  }
});

// Search
const si = d3.select("#search-input");
const sr = d3.select("#results");
si.on("input",()=>{
  const q = si.property("value").toLowerCase().trim();
  if(q.length<2){sr.style("display","none");return}
  const m = data.nodes.filter(n=>n.label.toLowerCase().includes(q)||n.type===q).slice(0,15);
  if(!m.length){sr.style("display","none");return}
  sr.style("display","block").html(m.map(n=>
    \`<div class="r" data-id="\${n.id}"><span style="color:\${n.color};font-weight:600">\${n.label}</span>
    <span style="color:#888;margin-left:6px">[\${n.type}]</span><span style="color:#555;float:right">c\${n.community}</span></div>\`
  ).join(""));
  sr.selectAll(".r").on("click",(e,d)=>{
    const nid = e.target.closest(".r").dataset.id;
    const tgt = data.nodes.find(n=>n.id===nid);
    if(!tgt)return;
    const tr = d3.zoomIdentity.translate(W/2,H/2).scale(1.5).translate(-tgt.x,-tgt.y);
    svg.transition().duration(500).call(zoom.transform,tr);
    sr.style("display","none");
    si.property("value",tgt.label);
    // Also highlight
    const connected=new Set();
    data.links.forEach(l=>{if(l.source.id===tgt.id||l.target.id===tgt.id)connected.add(l.source.id===tgt.id?l.target.id:l.source.id)});
    node.select("circle").attr("opacity",n=>connected.has(n.id)||n.id===tgt.id?1:.08);
    node.select("text").attr("opacity",n=>connected.has(n.id)||n.id===tgt.id?1:.05);
    link.attr("stroke-opacity",l=>l.source.id===tgt.id||l.target.id===tgt.id?.7:.03);
  });
});
si.on("keydown",e=>{if(e.key==="Enter"){const f=sr.select(".r");if(!f.empty())f.dispatch("click")}});

sim.on("tick",()=>{
  link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
  node.attr("transform",d=>\`translate(\${d.x},\${d.y})\`);
});

// Initial zoom to fit
const s=0.25;
svg.call(zoom.transform,d3.zoomIdentity.translate(W/2,H/2).scale(s).translate(-W/2,-H/2));
</script>
</body>
</html>`;

fs.writeFileSync(OUT_FILE, html, "utf-8");
console.log(`Done: ${OUT_FILE}`);
