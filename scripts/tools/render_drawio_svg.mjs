import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const input = path.resolve(process.argv[2] ?? "DRAW/architettura-andreagpt.drawio");
const output = path.resolve(process.argv[3] ?? input.replace(/\.drawio$/iu, ".svg"));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, processEntities: true });
const document = parser.parse(fs.readFileSync(input, "utf8"));
const rawCells = document.mxfile?.diagram?.mxGraphModel?.root?.mxCell ?? [];
const cells = Array.isArray(rawCells) ? rawCells : [rawCells];
const byId = new Map(cells.filter(cell => cell?.id).map(cell => [cell.id, cell]));

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const decode = value => String(value ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const escape = value => decode(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const styleOf = cell => Object.fromEntries(String(cell.style ?? "").split(";").filter(Boolean).map(item => { const [key, ...rest] = item.split("="); return [key, rest.join("=") || true]; }));
const color = (value, fallback) => /#[0-9a-f]{6}/iu.exec(String(value ?? ""))?.[0] ?? fallback;
const geometryOf = cell => cell.mxGeometry ?? {};

const absoluteGeometry = (id, stack = new Set()) => {
  const cell = byId.get(id);
  if (!cell || stack.has(id)) return { x: 0, y: 0, width: 0, height: 0 };
  const geometry = geometryOf(cell);
  const parent = cell.parent && byId.has(cell.parent) && cell.parent !== "1" ? absoluteGeometry(cell.parent, new Set([...stack, id])) : { x: 0, y: 0 };
  return { x: parent.x + number(geometry.x), y: parent.y + number(geometry.y), width: number(geometry.width), height: number(geometry.height) };
};

const vertices = cells.filter(cell => cell.vertex === "1" && cell.id !== "0" && cell.id !== "1").map(cell => ({ cell, geometry: absoluteGeometry(cell.id), style: styleOf(cell) }));
const width = Math.max(1800, ...vertices.map(item => item.geometry.x + item.geometry.width)) + 90;
const height = Math.max(1100, ...vertices.map(item => item.geometry.y + item.geometry.height)) + 90;
const vertexById = new Map(vertices.map(item => [item.cell.id, item]));

function labelLines(cell) {
  return decode(cell.value ?? "").replace(/<[^>]+>/g, "\n").split(/\n/u).map(value => value.trim()).filter(Boolean);
}

function renderText(cell, geometry, style, options = {}) {
  const lines = labelLines(cell);
  if (!lines.length) return "";
  const size = number(style.fontSize, options.size ?? 14);
  const colorValue = color(style.fontColor, options.color ?? "#1f2937");
  const centerX = geometry.x + geometry.width / 2;
  const startY = geometry.y + geometry.height / 2 - ((lines.length - 1) * size * 0.62) / 2;
  return `<text x="${centerX}" y="${startY}" text-anchor="middle" fill="${colorValue}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${style.fontStyle === "1" ? 700 : 400}">${lines.map((line, index) => `<tspan x="${centerX}" dy="${index ? size * 1.25 : 0}">${escape(line)}</tspan>`).join("")}</text>`;
}

function renderVertex(item) {
  const { cell, geometry, style } = item;
  const fill = color(style.fillColor, "#ffffff");
  const stroke = color(style.strokeColor, "#64748b");
  const radius = style.swimlane ? 12 : 8;
  const label = renderText(cell, geometry, style);
  if (style.swimlane) {
    const headerHeight = number(style.startSize, 30);
    return `<g><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="${radius}" fill="${color(style.swimlaneFillColor, fill)}" stroke="${stroke}" stroke-width="2"/><path d="M ${geometry.x} ${geometry.y + headerHeight} H ${geometry.x + geometry.width}" stroke="${stroke}" stroke-width="2"/><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${headerHeight}" rx="${radius}" fill="${fill}"/><text x="${geometry.x + 16}" y="${geometry.y + 22}" fill="${color(style.fontColor, "#ffffff")}" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escape(decode(cell.value ?? ""))}</text></g>`;
  }
  if (style.shape === "ellipse") return `<g><ellipse cx="${geometry.x + geometry.width / 2}" cy="${geometry.y + geometry.height / 2}" rx="${geometry.width / 2}" ry="${geometry.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${label}</g>`;
  if (style.shape === "cylinder") return `<g><rect x="${geometry.x}" y="${geometry.y + 10}" width="${geometry.width}" height="${Math.max(1, geometry.height - 20)}" fill="${fill}" stroke="${stroke}" stroke-width="2"/><ellipse cx="${geometry.x + geometry.width / 2}" cy="${geometry.y + 10}" rx="${geometry.width / 2}" ry="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/><ellipse cx="${geometry.x + geometry.width / 2}" cy="${geometry.y + geometry.height - 10}" rx="${geometry.width / 2}" ry="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${label}</g>`;
  return `<g><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${label}</g>`;
}

function renderEdge(cell) {
  const source = vertexById.get(cell.source)?.geometry;
  const target = vertexById.get(cell.target)?.geometry;
  if (!source || !target) return "";
  const x1 = source.x + source.width / 2, y1 = source.y + source.height / 2;
  const x2 = target.x + target.width / 2, y2 = target.y + target.height / 2;
  const style = styleOf(cell);
  const stroke = color(style.strokeColor, "#64748b");
  const dashed = style.dashed ? " stroke-dasharray=\"8 6\"" : "";
  const label = labelLines(cell)[0];
  const text = label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}" text-anchor="middle" fill="${color(style.fontColor, stroke)}" font-family="Arial, sans-serif" font-size="11">${escape(label)}</text>` : "";
  return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.8"${dashed} marker-end="url(#arrow)"/>${text}</g>`;
}

const edges = cells.filter(cell => cell.edge === "1");
const swimlanes = vertices.filter(item => item.style.swimlane);
const regularVertices = vertices.filter(item => !item.style.swimlane);
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M 0 0 L 10 4 L 0 8 z" fill="#64748b"/></marker></defs>
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <text x="40" y="42" fill="#0f172a" font-family="Arial, sans-serif" font-size="26" font-weight="700">Architettura AndreaGPT</text>
  <text x="40" y="70" fill="#475569" font-family="Arial, sans-serif" font-size="14">Flusso reale: UI → API/router → Brain/RAG + Micelio → modello o strumento locale</text>
  ${swimlanes.map(renderVertex).join("\n  ")}
  ${edges.map(renderEdge).join("\n  ")}
  ${regularVertices.map(renderVertex).join("\n  ")}
</svg>`;
fs.writeFileSync(output, svg, "utf8");
console.log(`Creato ${output}`);
