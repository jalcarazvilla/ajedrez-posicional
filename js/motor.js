// Envoltorio de Stockfish (Web Worker). El motor va incluido en la app (vendor/stockfish.js, Stockfish 10, licencia GPL),
// así funciona sin conexión.
const STOCKFISH_URL = new URL("../vendor/stockfish.js", import.meta.url);

class Motor {
  constructor() {
    this.cola = Promise.resolve();
    this.listo = null;
  }

  _arrancar() {
    if (!this.listo) {
      this.listo = (async () => {
        this.worker = new Worker(STOCKFISH_URL);
        this.oyentes = new Set();
        this.worker.onmessage = (e) => this.oyentes.forEach((f) => f(String(e.data)));
        await this._esperar("uci", (l) => l === "uciok");
        await this._esperar("isready", (l) => l === "readyok");
      })();
    }
    return this.listo;
  }

  enviar(cmd) { this.worker.postMessage(cmd); }

  _esperar(cmd, fin, alLinea) {
    return new Promise((ok) => {
      const f = (l) => {
        if (alLinea) alLinea(l);
        if (fin(l)) { this.oyentes.delete(f); ok(l); }
      };
      this.oyentes.add(f);
      this.enviar(cmd);
    });
  }

  // Analiza una posición durante `tiempo` ms. Devuelve [{movs:[uci...], cp, mate}],
  // con la puntuación desde el punto de vista del bando que mueve.
  analizar(fen, { tiempo = 3000, multipv = 1, movimientos = null } = {}) {
    const tarea = async () => {
      await this._arrancar();
      this.enviar(`setoption name MultiPV value ${multipv}`);
      this.enviar(`position fen ${fen}`);
      const lineas = {};
      const restr = movimientos ? ` searchmoves ${movimientos.join(" ")}` : "";
      await this._esperar(`go movetime ${tiempo}${restr}`, (l) => l.startsWith("bestmove"), (l) => {
        const m = l.match(/ depth (\d+) .*?multipv (\d+) score (cp|mate) (-?\d+).*? pv (.+)$/);
        if (m) lineas[m[2]] = { prof: +m[1], movs: m[5].split(" "), cp: m[3] === "cp" ? +m[4] : null, mate: m[3] === "mate" ? +m[4] : null };
      });
      return Object.keys(lineas).sort((a, b) => a - b).map((k) => lineas[k]);
    };
    const r = this.cola.then(tarea);
    this.cola = r.catch(() => {});
    return r;
  }
}

export const motor = new Motor();

// Puntuación en centipeones (mates a ±10000) desde el bando que mueve.
export function aCp(l) {
  if (!l) return 0;
  if (l.mate !== null) return l.mate > 0 ? 10000 - l.mate : -10000 - l.mate;
  return l.cp;
}

// Texto legible de una evaluación desde el punto de vista de las blancas.
export function textoEval(cpBlancas) {
  if (Math.abs(cpBlancas) >= 9000) return cpBlancas > 0 ? "Mate para blancas" : "Mate para negras";
  const v = (cpBlancas / 100).toFixed(2);
  return (cpBlancas > 0 ? "+" : "") + v;
}
