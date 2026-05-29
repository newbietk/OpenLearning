"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { GraphNodeRecord, GraphEdgeRecord } from "@/core/pipeline/types";

interface GraphViewerProps {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  onNodeClick?: (node: GraphNodeRecord) => void;
  onEdgeClick?: (edge: GraphEdgeRecord) => void;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  nodeType: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relation: string;
}

const NODE_COLORS: Record<string, string> = {
  concept: "#4F46E5",
  heading: "#059669",
  function: "#D97706",
  type: "#DC2626",
  code: "#7C3AED",
  webpage: "#2563EB",
  document: "#0891B2",
  runtime: "#DB2777",
};

function getNodeColor(nodeType: string): string {
  return NODE_COLORS[nodeType] || "#6B7280";
}

export function GraphViewer({ nodes, edges, onNodeClick, onEdgeClick }: GraphViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current || nodes.length === 0) return;

    // Clear and create D3 container imperatively, outside React's virtual DOM
    mountRef.current.innerHTML = "";
    const container = document.createElement("div");
    container.className = "border border-gray-200 rounded-lg bg-white overflow-hidden";
    container.style.width = "100%";
    container.style.height = "500px";
    mountRef.current.appendChild(container);

    const width = container.clientWidth;
    const height = 500;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg.append("g");

    svg.call(
      d3.zoom<SVGSVGElement, unknown>().on("zoom", (evt: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", evt.transform.toString());
      }),
    );

    const simNodes: SimNode[] = nodes.map((n: GraphNodeRecord) => ({ ...n }));
    const simLinks: SimLink[] = edges.map((e: GraphEdgeRecord) => ({
      source: e.sourceNodeId,
      target: e.targetNodeId,
      relation: e.relation,
    }));

    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d: SimNode) => d.id)
          .distance(100),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(30));

    const link = g
      .append("g")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(simLinks, (_d: SimLink, i: number) => `link-${i}`)
      .join("line")
      .attr("stroke", "#D1D5DB")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.8);

    const edgeLabel = g
      .append("g")
      .selectAll<SVGTextElement, SimLink>("text")
      .data(simLinks, (_d: SimLink, i: number) => `el-${i}`)
      .join("text")
      .text((d: SimLink) => d.relation)
      .attr("font-size", "8px")
      .attr("fill", "#9CA3AF")
      .attr("text-anchor", "middle");

    const dragHandler = d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>, d: SimNode) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>, d: SimNode) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>, d: SimNode) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }) as d3.DragBehavior<SVGGElement, SimNode, SimNode>;

    const node = g
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes, (d: SimNode) => d.id)
      .join("g")
      .call(dragHandler);

    node
      .append("circle")
      .attr("r", 8)
      .attr("fill", (d: SimNode) => getNodeColor(d.nodeType))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    node
      .append("text")
      .text((d: SimNode) => d.label)
      .attr("x", 12)
      .attr("y", 4)
      .attr("font-size", "11px")
      .attr("fill", "#374151")
      .attr("font-family", "sans-serif");

    node
      .append("title")
      .text((d: SimNode) => `${d.label}\n类型: ${d.nodeType}`);

    node.on("click", (_event: MouseEvent, d: SimNode) => {
      onNodeClick?.({
        id: d.id, kbId: "", label: d.label, nodeType: d.nodeType,
        sourceDocId: null, metadata: {}, createdAt: "",
      });
    });

    link.on("click", (_event: MouseEvent, d: SimLink) => {
      onEdgeClick?.({
        id: "", kbId: "", sourceNodeId: (d.source as SimNode).id,
        targetNodeId: (d.target as SimNode).id, relation: d.relation,
        confidence: 1.0, createdAt: "",
      });
    });

    simulation.on("tick", () => {
      link
        .attr("x1", (d: SimLink) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d: SimLink) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d: SimLink) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d: SimLink) => (d.target as SimNode).y ?? 0);

      edgeLabel
        .attr("x", (d: SimLink) => {
          const sx = (d.source as SimNode).x ?? 0;
          const tx = (d.target as SimNode).x ?? 0;
          return (sx + tx) / 2;
        })
        .attr("y", (d: SimLink) => {
          const sy = (d.source as SimNode).y ?? 0;
          const ty = (d.target as SimNode).y ?? 0;
          return (sy + ty) / 2;
        });

      node.attr("transform", (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges]);

  const usedTypes = [...new Set(nodes.map((n) => n.nodeType))];

  return (
    <div>
      <div ref={mountRef} />
      {usedTypes.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {usedTypes.map((t) => (
            <div key={t} className="flex items-center gap-1 text-xs text-gray-600">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: getNodeColor(t) }}
              />
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
