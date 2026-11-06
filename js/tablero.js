// Tablero interactivo: Chessground (dibujo y arrastre) + chess.js (reglas).
import { Chessground } from "../vendor/chessground.js";
import { Chess } from "../vendor/chess.js";

export { Chess };

function destinos(juego) {
  const d = new Map();
  for (const m of juego.moves({ verbose: true })) {
    if (!d.has(m.from)) d.set(m.from, []);
    d.get(m.from).push(m.to);
  }
  return d;
}

const color = (juego) => (juego.turn() === "w" ? "white" : "black");

export class Tablero {
  // opciones: { orientacion: 'white'|'black', alMover: (movimiento chess.js) => void }
  constructor(el, fen, { orientacion = "white", alMover = null } = {}) {
    this.juego = new Chess(fen);
    this.alMover = alMover;
    this.bloqueado = !alMover;
    this.cg = Chessground(el, {
      fen,
      orientation: orientacion,
      coordinates: true,
      animation: { duration: 220 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, showDests: true },
      draggable: { showGhost: true },
      premovable: { enabled: false },
      drawable: { enabled: true, visible: true },
      events: { move: (o, d) => this._movido(o, d) },
    });
    this._sincronizar();
  }

  _sincronizar(ultimo) {
    const libre = !this.bloqueado;
    this.cg.set({
      fen: this.juego.fen(),
      turnColor: color(this.juego),
      check: this.juego.inCheck(),
      lastMove: ultimo,
      movable: { color: libre ? color(this.juego) : undefined, dests: libre ? destinos(this.juego) : new Map() },
    });
  }

  _movido(origen, destino) {
    let m;
    try {
      m = this.juego.move({ from: origen, to: destino, promotion: "q" });
    } catch {
      this._sincronizar();
      return;
    }
    this._sincronizar([origen, destino]);
    if (this.alMover) this.alMover(m);
  }

  // Juega una jugada en SAN o {from,to}; devuelve el movimiento o null si es ilegal.
  jugar(jugada) {
    let m;
    try { m = this.juego.move(jugada); } catch { return null; }
    this._sincronizar([m.from, m.to]);
    return m;
  }

  deshacer() {
    const m = this.juego.undo();
    this._sincronizar();
    return m;
  }

  poner(fen) { this.juego.load(fen); this._sincronizar(); }
  bloquear(b = true) { this.bloqueado = b; this._sincronizar(); }
  fen() { return this.juego.fen(); }
  turno() { return this.juego.turn(); }

  // flechas: [["e2","e4"], ["d5"]] -> flechas y círculos. Colores: green, red, blue, yellow.
  flechas(lista = [], pincel = "green") {
    this.cg.setAutoShapes(lista.map(([o, d, p]) => ({ orig: o, dest: d || undefined, brush: p || pincel })));
  }

  destruir() { this.cg.destroy(); }
}

// Convierte una jugada UCI ("e2e4", "e7e8q") a SAN en una posición.
export function uciASan(fen, uci) {
  const j = new Chess(fen);
  try {
    return j.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" }).san;
  } catch { return uci; }
}

// Línea UCI -> texto SAN numerado ("26...e5 27. Axe5 Tdd2").
export function lineaSan(fen, ucis, max = 8) {
  const j = new Chess(fen);
  let n = +fen.split(" ")[5], out = [];
  for (const [i, u] of ucis.slice(0, max).entries()) {
    const blancas = j.turn() === "w";
    let m;
    try { m = j.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); } catch { break; }
    if (blancas) out.push(`${n}. ${m.san}`);
    else out.push(i === 0 ? `${n}...${m.san}` : m.san);
    if (!blancas) n++;
  }
  return out.join(" ");
}
