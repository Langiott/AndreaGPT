import type { ShapResult } from "../types/types";

const percent = (value: number) => `${value > 0 ? "" : value < 0 ? "−" : ""}${Math.abs(Math.round(value * 100))}%`;
const sourceName = (source: string) => source.split("/").at(-1) ?? source;

/** Pannello SHAP: quanto ogni parola della domanda ha portato verso le fonti scelte. */
export function ShapPanel({ shap }: { shap: ShapResult }) {
  const max = Math.max(...shap.overall.map(Math.abs), 0.01);
  const order = shap.words.map((word, i) => i).sort((a, b) => shap.overall[b] - shap.overall[a]);
  // Solo i problemi: le chat salvate prima conservano anche le frasi descrittive.
  const findings = shap.findings.filter(text => !/^(?:La ricerca è guidata|Nessuna parola domina|Tutte le parole importanti)/.test(text));
  return <div className="citation-panel shap-panel">
    {findings.length > 0 && <div className="shap-findings">{findings.map((finding, i) => <p key={i}>{finding}</p>)}</div>}
    <div className="shap-words">
      {order.map(i => <div key={shap.words[i]} className="shap-row">
        <b>{shap.words[i]}</b>
        <span className="shap-bar"><i className={shap.overall[i] < 0 ? "negative" : ""} style={{ width: `${Math.abs(shap.overall[i]) / max * 100}%` }} /></span>
        <span className="shap-value">{percent(shap.overall[i])}</span>
        <span className={`shap-covered ${shap.coveredBy[i] ? "" : "missing"}`} title="Fonti che contengono la parola">{shap.coveredBy[i]}/{shap.sources.length}</span>
      </div>)}
    </div>
    <details className="shap-details"><summary>Dettaglio per fonte</summary>
      <table><thead><tr><th>Fonte</th><th>Somiglianza</th>{order.map(i => <th key={i}>{shap.words[i]}</th>)}</tr></thead>
        <tbody>{shap.sources.map(source => { const top = Math.max(...source.shares); return <tr key={source.source}><td title={source.source}>{sourceName(source.source)}</td><td>{Math.round(source.similarity * 100)}%</td>
          {order.map(i => <td key={i} className={source.shares[i] === top ? "top" : source.shares[i] < 0 ? "negative" : ""}>{percent(source.shares[i])}{source.present[i] ? "" : "·"}</td>)}</tr>; })}</tbody>
      </table>
    </details>
  </div>;
}
