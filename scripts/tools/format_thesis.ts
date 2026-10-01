import { readFileSync, writeFileSync } from "node:fs";

const source = "C:/Users/andre/Downloads/TESI_LANGIOTTI_MAGISTRALE_FINITA_1_.md";
const destination = "C:/Users/andre/Desktop/AndreaGPT/TESI_LANGIOTTI_MAGISTRALE_FINITA_1_CORRETTA.md";
const rawLines = readFileSync(source, "utf8").split(/\r?\n/);
const output: string[] = [];
let paragraph = "";
let bullet = "";
let pendingChapter: string | null = null;

const formulaEntries: Array<[number, number, string]> = [
  [328, 328, String.raw`$$E \in \mathbb{R}^{V \times d_{model}}$$`],
  [332, 332, String.raw`$$x_i = E[t_i] \in \mathbb{R}^{d_{model}}$$`],
  [340, 340, String.raw`$$z_i = x_i + p_i$$`],
  [396, 396, String.raw`$$Q \in \mathbb{R}^{N_q \times d_k}, \qquad K \in \mathbb{R}^{N_k \times d_k}, \qquad V \in \mathbb{R}^{N_k \times d_v}$$`],
  [413, 418, String.raw`$$\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V \in \mathbb{R}^{N_q \times d_v}$$`],
  [437, 440, String.raw`$$\operatorname{head}_i = \operatorname{Attention}(Q_i,K_i,V_i), \quad Q_i=QW_i^Q, \quad K_i=KW_i^K, \quad V_i=VW_i^V, \quad W_i^Q,W_i^K\in\mathbb{R}^{d_{model}\times d_k}, \quad W_i^V\in\mathbb{R}^{d_{model}\times d_v}$$`],
  [443, 443, String.raw`$$\operatorname{MHA}(Q,K,V) = \operatorname{Concat}(\operatorname{head}_1,\ldots,\operatorname{head}_h)W^O, \qquad W^O \in \mathbb{R}^{hd_v\times d_{model}}$$`],
  [581, 584, String.raw`$$S(i) \approx \frac{1}{N\,p_i}\sum_{n=1}^{N} f(I \odot M_n)\,M_n(i)$$`],
  [616, 618, String.raw`$$A_{ij} \propto \frac{\partial y}{\partial x_j}$$`],
  [621, 624, String.raw`$$G = \frac{\partial y}{\partial x}, \qquad D(A,G) = \lVert A - \operatorname{normalize}(G)\rVert_1$$`],
  [659, 659, String.raw`$$L(A) = \lambda_1\,\operatorname{Faithfulness}(A,f(x)) - \lambda_2\,\operatorname{Sparsity}(A) - \lambda_3\,\operatorname{Smoothness}(A)$$`],
  [742, 744, String.raw`$$d(M_i,M_j) = 1 - \frac{M_i M_j^{\top}}{\lVert M_i\rVert\,\lVert M_j\rVert}$$`],
  [764, 766, String.raw`$$H = \sum_{i=1}^{K} s_i\,M_i$$`],
  [825, 825, String.raw`$$T \in \mathbb{R}^{N_t \times D}$$`],
  [835, 835, String.raw`$$A \in \mathbb{R}^{N_t \times (L\cdot D)}$$`],
  [847, 847, String.raw`$$K = \operatorname{KMeans}(A,N_m)$$`],
  [850, 858, String.raw`$$M_{ij} = \begin{cases}1 & \text{se } K_{ij} \in \operatorname{topk}(K_j,N_k),\\0 & \text{altrimenti}\end{cases} \qquad F_j = \{T_i \mid M_{ij}=1\}$$`],
  [863, 863, String.raw`$$w_{j,c} = \operatorname{transformer}_c(F_j)$$`],
  [867, 870, String.raw`$$\operatorname{TIS}_c = \frac{\sum_{j=1}^{N} w_{j,c}\odot M_j}{\sum_{j=1}^{N} M_j}$$`],
  [899, 900, String.raw`$$Z^l = \{z_0^l,z_1^l,\ldots,z_n^l\} \in \mathbb{R}^{(n+1)\times d}$$`],
  [912, 912, String.raw`$$\hat{y} = \operatorname*{arg\,max}(C\bar{z})$$`],
  [924, 924, String.raw`$$s = \hat{y}[c]$$`],
  [936, 938, String.raw`$$\nabla A^L = \frac{\partial s}{\partial A^L} \in \mathbb{R}^{h\times(n+1)\times(n+1)}$$`],
  [956, 960, String.raw`$$\hat{E}^{L}(s) = \frac{1}{h(n+1)}\sum_{h}\sum_i \operatorname{ReLU}\!\left(\nabla A^L_{h,i,:}\right) + \varepsilon \in \mathbb{R}^{n+1}$$`],
  [965, 967, String.raw`$$E^L(s) = \operatorname{norm}\!\left(\operatorname{reshape}(\hat{E}^{L}(s)_{1:})\right) \in \mathbb{R}^{W\times H}$$`],
  [973, 973, String.raw`$$\hat{E}^{l}(s) \in \mathbb{R}^{n+1}, \qquad l=1,\ldots,L$$`],
  [977, 980, String.raw`$$\bar{E} = \frac{1}{L}\sum_{l=1}^{L}\hat{E}^{l}(s)_{1:}$$`],
  [983, 985, String.raw`$$E = \operatorname{norm}\!\left(\operatorname{reshape}(\bar{E})\right) \in \mathbb{R}^{W\times H}$$`],
  [995, 998, String.raw`$$\bar{E} = \frac{1}{L}\sum_{l=1}^{L}\hat{E}^{l}(s_l)_{1:}$$`],
  [1000, 1000, String.raw`$$E = \operatorname{norm}(\operatorname{reshape}(\bar{E})) \in \mathbb{R}^{W\times H}$$`],
  [1085, 1085, String.raw`$$A_l = \{\nabla Q_i^l,\nabla K_i^l,\nabla V_i^l\}$$`],
  [1090, 1094, String.raw`$$BM_j^l[n] = \begin{cases}1 & \text{se } a_j^l[n] \ge \mu_j^l,\\0 & \text{altrimenti}\end{cases}$$`],
  [1106, 1107, String.raw`$$H^{(I,c)} = \sum W M_j^l \in \mathcal{W}_M$$`],
  [1254, 1254, String.raw`$$Q^{(l)},K^{(l)},V^{(l)} \in \mathbb{R}^{B\times H\times N\times D_{head}}$$`],
  [1276, 1278, String.raw`$$A^{*(l)} = \frac{Q^{(l)}K^{(l)\top}}{\sqrt{D_{head}}}$$`],
  [1282, 1283, String.raw`$$A_{grezza}^{(l)} = \operatorname{softmax}\!\left(A^{*(l)}\right)$$`],
  [1297, 1308, String.raw`$$\operatorname{outdegree}_i = \sum_{j=1}^{N} A_{i,j}^{(l)}, \qquad \operatorname{indegree}_j = \sum_{i=1}^{N} A_{i,j}^{(l)}$$`],
  [1315, 1316, String.raw`$$\operatorname{outdegree}_i^{(l)} = 1 \qquad \forall l,\ \forall i$$`],
  [1350, 1350, String.raw`$$V^{(l)} = \{v_i^{(l)}\}_{i=1}^{N} \in \mathbb{R}^{B\times H\times N\times D_{head}}$$`],
  [1352, 1360, String.raw`$$g_i^{(l)} = \lVert v_i^{(l)}\rVert_2 = \sqrt{\sum_{k=1}^{D}(v_{i,k}^{(l)})^2}$$`],
  [1364, 1365, String.raw`$$G_{ij}^{(l)} = g_i^{(l)}g_j^{(l+1)}, \qquad G^{(l)}\in\mathbb{R}^{N\times N}$$`],
  [1371, 1372, String.raw`$$w_{ij}^{(l)} = G_{ij}^{(l)}\,\operatorname{indegree}_j^{(l+1)}$$`],
  [1379, 1380, String.raw`$$G_{ij}^{(l)}\in[0,1], \qquad \operatorname{indegree}_j^{(l+1)}\in[0,1]$$`],
  [1437, 1437, String.raw`$$P=(n_0,n_1,\ldots,n_k)$$`],
  [1442, 1444, String.raw`$$C(P)=\sum_{i=0}^{k-1}w(n_i,n_{i+1})$$`],
  [1449, 1450, String.raw`$$P^* = \operatorname*{arg\,min}_{P} C(P)$$`],
  [1462, 1462, String.raw`$$w_{ij}^{\prime}=1-w_{ij}$$`],
  [1492, 1494, String.raw`$$r_i=\frac{C_{max}-C_i}{C_{max}-C_{min}}\in[0,1]$$`],
  [1511, 1511, String.raw`$$H\in\mathbb{R}^{14\times14}$$`],
  [1514, 1516, String.raw`$$H_{norm}=\frac{H-\min(H)}{\max(H)-\min(H)}$$`],
  [1593, 1593, String.raw`$$I\in\mathbb{R}^{1\times3\times224\times224}$$`],
  [1599, 1599, String.raw`$$Q^{(l)},K^{(l)},V^{(l)}\in\mathbb{R}^{B\times H\times N\times D_{head}}\qquad\forall I$$`],
  [1604, 1607, String.raw`$$A^{*(l)}=\frac{Q^{(l)}K^{(l)\top}}{\sqrt{D_{head}}}$$`],
  [1611, 1612, String.raw`$$A_{grezza}^{(l)}=\operatorname{softmax}\!\left(A^{*(l)}\right)$$`],
  [1617, 1622, String.raw`$$\operatorname{outdegree}_i=\sum_{j=1}^{N}A_{i,j}^{(l)},\qquad \operatorname{indegree}_j=\sum_{i=1}^{N}A_{i,j}^{(l)}$$`],
  [1631, 1640, String.raw`$$V^{(l)}=\{v_i^{(l)}\}_{i=1}^{N}\in\mathbb{R}^{B\times H\times N\times D_{head}},\qquad g_i^{(l)}=\lVert v_i^{(l)}\rVert_2=\sqrt{\sum_{k=1}^{D}(v_{i,k}^{(l)})^2}$$`],
  [1643, 1644, String.raw`$$G^{(l)}\in\mathbb{R}^{N\times N},\qquad G_{ij}^{(l)}=g_i^{(l)}g_j^{(l+1)}$$`],
  [1647, 1650, String.raw`$$w_{ij}^{(l)}=G_{ij}^{(l)}\,\operatorname{indegree}_j^{(l+1)},\qquad G_{ij}^{(l)},\operatorname{indegree}_j^{(l+1)}\in[0,1]$$`],
  [1660, 1660, String.raw`$$w_{ij}^{\prime}=1-w_{ij}$$`],
  [1662, 1662, String.raw`$$P=(n_0,\ldots,n_k)$$`],
  [1664, 1667, String.raw`$$C(P)=\sum_{i=0}^{k-1}w^{\prime}(n_i,n_{i+1})$$`],
  [1669, 1670, String.raw`$$P^*=\operatorname*{arg\,min}_{P}C(P)$$`],
  [1672, 1674, String.raw`$$r_i=\frac{C_{max}-C_i}{C_{max}-C_{min}}\in[0,1]$$`],
  [1677, 1677, String.raw`$$H\in\mathbb{R}^{14\times14}$$`],
  [1679, 1681, String.raw`$$H_{norm}=\frac{H-\min(H)}{\max(H)-\min(H)}$$`],
];

const formulas = new Map(formulaEntries.map(([start, end, text]) => [start, { end, text }]));

function blank() {
  if (output.length && output.at(-1) !== "") output.push("");
}

function block(text: string) {
  blank();
  output.push(...text.split("\n"));
  blank();
}

function repair(value: string) {
  let repaired = value
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=[A-Za-zÀ-ÖØ-öø-ÿ])/g, "$1 ")
    .replace(/\bquatitativi\b/giu, "quantitativi")
    .replace(/\bexplanabilitu\b/giu, "explainability")
    .replace(/\bexplanability\b/giu, "explainability")
    .replace(/\binizialemnte\b/giu, "inizialmente")
    .replace(/\bprela\b/giu, "prelevi")
    .replace(/\bapplicatoi\b/giu, "applicati")
    .replace(/\barfatti\b/giu, "artefatti")
    .replace(/\bappriccio\b/giu, "approccio")
    .replace(/\bseguneti\b/giu, "seguenti")
    .replace(/\bprepocessing\b/giu, "preprocessing")
    .replace(/\basseg[n]?anto\b/giu, "assegnato")
    .replace(/\bestenzione\b/giu, "estensione")
    .replace(/\bper ogniuno\b/giu, "per ognuno")
    .replace(/\bmedianti\b/giu, "mediante")
    .replace(/\buna aggregazione\b/giu, "un’aggregazione")
    .replace(/\bdei attention\b/giu, "degli attention")
    .replace(/\bdel indegree\b/giu, "dell’indegree")
    .replace(/\buna interpretabilità\b/giu, "un’interpretabilità")
    .replace(/introdotto da\.?\??/giu, "introdotto da Vaswani et al. [2017]")
    .replace(/Transformer\?? è stato/giu, "Transformer, introdotto da Vaswani et al. [2017], è stato")
    .replace(/prestazioni\?\s*Vaswani et al\.\s*\[2017\]/giu, "prestazioni. Vaswani et al. [2017]")
    .replace(/\bVit\b/g, "ViT");
  const urlIndex = repaired.indexOf("http");
  if (urlIndex >= 0) repaired = repaired.slice(0, urlIndex) + repaired.slice(urlIndex).replace(/\s+/g, "");
  return repaired;
}

function flushBullet() {
  if (bullet) {
    output.push(bullet);
    bullet = "";
  }
}

function flushParagraph() {
  if (paragraph) {
    output.push(paragraph);
    paragraph = "";
  }
}

function flushAll() {
  flushBullet();
  flushParagraph();
}

function addLine(line: string) {
  const value = repair(line);
  if (!value) return;
  if (paragraph) paragraph = paragraph.endsWith("-") ? paragraph.slice(0, -1) + value : `${paragraph} ${value}`;
  else paragraph = value;
}

for (let index = 0; index < rawLines.length; index += 1) {
  const number = index + 1;
  const raw = rawLines[index];
  if (number <= 69) continue;
  if (number >= 70 && number <= 188) continue;

  const formula = formulas.get(number);
  if (formula) {
    flushAll();
    block(formula.text);
    index = formula.end - 1;
    continue;
  }

  let line = repair(raw);
  if (!line) {
    flushAll();
    continue;
  }
  if (line === "√" || line === "?" || line === "⟂") continue;
  if (/^§/.test(line) || /^\d+$/.test(line) || /^BIBLIOGRAFIA\s+\d+$/i.test(line)) continue;
  if (/^CAPITOLO\s+(\d+)$/i.test(line)) {
    flushAll();
    pendingChapter = line.match(/\d+/)?.[0] ?? null;
    continue;
  }
  if (pendingChapter) {
    flushAll();
    block(`# ${pendingChapter} ${line}`);
    pendingChapter = null;
    continue;
  }
  if (/^(Introduzione|Conclusioni|Bibliografia|Sitografia|Ringraziamenti)$/i.test(line)) {
    flushAll();
    block(`# ${line}`);
    continue;
  }
  if (/^\d+\.\d+\s+/.test(line)) {
    flushAll();
    block(`## ${line}`);
    continue;
  }
  if (/^(Figura|Tabella)\s+\d+(?:\.\d+)?\s*:/.test(line)) {
    flushAll();
    for (const caption of line.replace(/\s+(?=Figura\s+\d+\.\d+:)/g, "\n").split("\n")) {
      block(`*${caption.replace(/,?\s*\?$/, "")}*`);
    }
    continue;
  }
  const listMatch = line.match(/^(?:•|–|-)\s*(.*)$/);
  if (listMatch) {
    flushParagraph();
    flushBullet();
    bullet = `- ${listMatch[1].trim()}`;
    continue;
  }
  if (bullet) {
    bullet += ` ${line}`;
    continue;
  }

  line = line
    .replace("U NIVERSITÀ P OLITECNICA DELLE M ARCHE", "UNIVERSITÀ POLITECNICA DELLE MARCHE")
    .replace("FACOLTÀ DI I NGEGNERIA", "FACOLTÀ DI INGEGNERIA")
    .replace("T ESI DI L AUREA", "TESI DI LAUREA")
    .replace("A NNO A CCADEMICO", "ANNO ACCADEMICO")
    .replace(/Transformer \? è stato/g, "Transformer, introdotto da Vaswani et al. [2017], è stato")
    .replace(/introdotto da \. \?,/g, "introdotto da Vaswani et al. [2017],")
    .replace(/prestazioni\?\s*Vaswani et al\. \[2017\]/g, "prestazioni. Vaswani et al. [2017]")
    .replace(/prestazioni\?$/g, "prestazioni.")
    .replace(/,\s*\?$/g, "")
    .replace(/\s+\?$/g, "");
  addLine(line);
}

flushAll();

const preface = [
  "# Sviluppo di un Algoritmo di Explainability per Vision Transformer",
  "## Development of an Explainability Algorithm for Vision Transformers",
  "",
  "**Università Politecnica delle Marche**  ",
  "Facoltà di Ingegneria  ",
  "Dipartimento di Ingegneria dell’Informazione  ",
  "Corso di Laurea Magistrale in Ingegneria Informatica e dell’Automazione",
  "",
  "**Relatore:** Prof. Domenico Ursino  ",
  "**Candidato:** Andrea Langiotti  ",
  "**Correlatori:** Dott. Luca Virgili; Dott. Davide Traini",
  "",
  "**Anno accademico:** 2024–2025",
  "",
  "> Meglio curiosi che intelligenti.  ",
  "> Il curioso si meraviglia, l’intelligente capisce e basta.  ",
  ">  ",
  "> Trova il tuo buco nero. Qualcosa che ti catturi, che ti trascini dentro e ti faccia dimenticare tutto, perfino del tempo.  ",
  "> — Andrea Langiotti",
  "",
  "## Sommario",
  "",
  "I Vision Transformer (ViT) stanno ottenendo risultati sempre più rilevanti in numerosi ambiti, tra cui la classificazione di immagini e diversi task di comprensione visiva, grazie alla capacità della self-attention di modellare relazioni tra regioni anche molto distanti. Tuttavia, la loro natura di tipo black-box rende centrale il tema dell’explainability, poiché risultano osservabili solo input e output, ma non i processi decisionali interni. Di conseguenza, si sviluppano algoritmi volti a interpretare e rendere più trasparente il funzionamento dei modelli. In questa tesi viene proposto un nuovo metodo di explainability per i ViT che integra multi-head attention e gradienti. Il metodo sfrutta self-attention, parametri di embedding e una rappresentazione a grafo dei token, o pixel, dell’immagine, al fine di individuare le zone più rilevanti per il modello.",
  "",
  "**Keywords:** Vision Transformer; Explainability; Token; Multi-Head Self-Attention; Gradient-Based Methods; Graph Representation; Shortest Path Analysis; Saliency Evaluation; Insertion/Deletion.",
  "",
];
const body = output.filter((line, index) => line !== "" || output[index - 1] !== "").map(line => line.trimEnd());
const tables: Record<string, string[]> = {
  "*Tabella 4.1:": [
    "| Immagine | Classe | Confidence | Label | AUC Ins. ↑ | AUC Del. ↓ | Score |",
    "|---|---:|---:|---|---:|---:|---:|",
    "| 00041.jpg | 41 | 0.4541 | lion | 0.832 | 0.241 | 0.591 |",
    "| 00024.jpg | 24 | 0.2187 | duck | 0.811 | 0.263 | 0.548 |",
    "| 00014.jpg | 14 | 0.6206 | dragonfly | 0.785 | 0.274 | 0.511 |",
    "| 00089.jpg | 89 | 0.9914 | persian cat | 0.754 | 0.301 | 0.453 |",
    "| 00033.jpg | 33 | 0.9253 | hummingbird | 0.732 | 0.295 | 0.437 |",
  ],
  "*Tabella 4.2:": [
    "| Immagine | Classe | Confidence | Label | AUC Ins. ↑ | AUC Del. ↓ | Score |",
    "|---|---:|---:|---|---:|---:|---:|",
    "| 00006.jpg | 345 | 0.6963 | fox | 0.0338 | 0.2835 | -0.2497 |",
    "| 00017.jpg | 22 | 0.9294 | elephant | 0.2584 | 0.4830 | -0.2246 |",
    "| 00029.jpg | 279 | 0.4765 | hedgehog | 0.0854 | 0.2503 | -0.1650 |",
    "| 00039.jpg | 314 | 0.9876 | cockroach | 0.3262 | 0.4650 | -0.1389 |",
    "| 00083.jpg | 150 | 0.9855 | turtle | 0.3248 | 0.4154 | -0.0907 |",
  ],
  "*Tabella 5.1:": [
    "| Immagine | Classe | Confidence | Label | AUC Ins. ↑ | AUC Del. ↓ | Score |",
    "|---|---:|---:|---|---:|---:|---:|",
    "| 075.jpg | 10 | 0.3406 | snake | 0.2910 | 0.1062 | 0.1849 |",
    "| 076.jpg | 10 | 0.3406 | bird | 0.2910 | 0.1062 | 0.1849 |",
    "| 086.jpg | 224 | 0.6469 | wolf | 0.4180 | 0.0818 | 0.3362 |",
  ],
  "*Tabella 5.2:": [
    "| Metodo | Insertion | Deletion | Score (Ins − Del) |",
    "|---|---:|---:|---:|",
    "| Nostro metodo | 0.89 | 0.17 | 0.72 |",
    "| GradMask | 0.78 | 0.09 | 0.69 |",
  ],
};
const tableBody: string[] = [];
for (let i = 0; i < body.length; i += 1) {
  const key = Object.keys(tables).find(candidate => body[i].startsWith(candidate));
  if (!key) {
    tableBody.push(body[i]);
    continue;
  }
  tableBody.push(body[i], "", ...tables[key], "");
  i += 1;
  while (i < body.length && body[i] === "") i += 1;
  while (i < body.length && body[i] !== "" && !/^\*(?:Figura|Tabella)/.test(body[i]) && !/^#/.test(body[i])) i += 1;
  i -= 1;
}
const combined = [...preface, ...tableBody];
const clean: string[] = [];
for (const originalLine of combined) {
  let line = originalLine;
  line = line.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  const urlIndex = line.indexOf("http");
  if (urlIndex >= 0) line = line.slice(0, urlIndex) + line.slice(urlIndex).replace(/\s+/g, "");
  if (line === "") {
    if (clean.at(-1) !== "") clean.push("");
    continue;
  }
  if (/^\s*\d+\s*$/.test(line) || /^\s*§/.test(line)) continue;
  if (/^(?:\$\$|#|##|[-*]|>)/.test(line) || line.length <= 110) {
    clean.push(line.trimEnd());
    continue;
  }
  const words = line.trim().split(/\s+/);
  let wrapped = "";
  for (const word of words) {
    if (wrapped && wrapped.length + word.length + 1 > 105) {
      clean.push(wrapped);
      wrapped = word;
    } else {
      wrapped = wrapped ? `${wrapped} ${word}` : word;
    }
  }
  if (wrapped) clean.push(wrapped);
}
while (clean.at(-1) === "") clean.pop();
writeFileSync(destination, `${clean.join("\r\n")}\r\n`, "utf8");
console.log(`Creato: ${destination}`);
console.log(`Righe: ${clean.length}`);
