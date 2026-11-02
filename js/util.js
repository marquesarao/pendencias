// Utilitários sem dependência de DOM.

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  // Fallback para contextos não seguros (ex.: http://192.168.x.x).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Sem maiúsculas e sem acentos, para comparar nomes de tag e buscar.
export function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const doisDig = n => String(n).padStart(2, '0');

// Chave de dia no fuso local: "2026-11-02".
export function chaveDia(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  return `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`;
}

export function ehHoje(iso) {
  return !!iso && chaveDia(new Date(iso)) === chaveDia();
}

export function ddmm(iso) {
  const d = new Date(iso);
  return `${doisDig(d.getDate())}/${doisDig(d.getMonth() + 1)}`;
}

export function hhmm(iso) {
  const d = new Date(iso);
  return `${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`;
}

// "2026-11-15" (prazo, só data) → Date local à meia-noite.
export function dataLocal(chave) {
  const [a, m, d] = chave.split('-').map(Number);
  return new Date(a, m - 1, d);
}

// Situação de um prazo em relação a hoje.
export function situacaoPrazo(prazo) {
  if (!prazo) return null;
  const hoje = chaveDia();
  if (prazo < hoje) return 'vencido';
  if (prazo === hoje) return 'hoje';
  return 'futuro';
}

export function rotuloPrazo(prazo) {
  const s = situacaoPrazo(prazo);
  if (s === 'hoje') return 'hoje';
  const amanha = chaveDia(new Date(Date.now() + 864e5));
  if (prazo === amanha) return 'amanhã';
  const [, m, d] = prazo.split('-');
  return `${d}/${m}`;
}

const DIAS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

// Rótulo de um dia para o histórico: "Hoje", "Ontem", "seg., 28/10".
export function rotuloDia(chave) {
  if (chave === chaveDia()) return 'Hoje';
  if (chave === chaveDia(new Date(Date.now() - 864e5))) return 'Ontem';
  const d = dataLocal(chave);
  const ano = d.getFullYear() !== new Date().getFullYear() ? `/${d.getFullYear()}` : '';
  return `${DIAS[d.getDay()]}, ${doisDig(d.getDate())}/${doisDig(d.getMonth() + 1)}${ano}`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}
