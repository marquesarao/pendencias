// Helpers mínimos de DOM.

/**
 * Cria um elemento. props: class, text, html (evitar), data-*, aria-*, on<Evento>, demais atributos.
 * Filhos: nós, strings ou arrays; null/false são ignorados.
 */
export function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && !k.includes('-') && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  anexar(el, filhos);
  return el;
}

function anexar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

const SVG = 'http://www.w3.org/2000/svg';

export function icone(nome, classe = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (classe) svg.setAttribute('class', classe);
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${nome}`);
  svg.append(use);
  return svg;
}

/**
 * Deixa `container` com exatamente `nos`, nessa ordem, mexendo o mínimo possível no DOM
 * (um nó que já está no lugar não é movido — assim um campo em edição não perde o foco).
 */
export function reconciliar(container, nos) {
  const desejados = new Set(nos);
  for (const filho of [...container.children]) if (!desejados.has(filho)) filho.remove();
  let cursor = container.firstElementChild;
  for (const no of nos) {
    if (no === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(no, cursor);
  }
}

// Texto em minúsculas e sem acentos, caractere a caractere, com mapa de volta para o original.
function dobrar(texto) {
  const chars = Array.from(texto);
  let norm = '';
  const mapa = [];
  chars.forEach((c, i) => {
    const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) { norm += n[k]; mapa.push(i); }
  });
  return { chars, norm, mapa };
}

export function contem(texto, termoNorm) {
  return !!termoNorm && dobrar(texto).norm.includes(termoNorm);
}

// Fragmento com as ocorrências de `termoNorm` (já normalizado) destacadas em <mark>.
export function realcar(texto, termoNorm) {
  const frag = document.createDocumentFragment();
  if (!termoNorm) { frag.append(texto); return frag; }
  const { chars, norm, mapa } = dobrar(texto);
  let pos = 0;
  let ultimo = 0;
  while ((pos = norm.indexOf(termoNorm, pos)) >= 0) {
    const ini = mapa[pos];
    const fim = mapa[pos + termoNorm.length - 1] + 1;
    if (ini > ultimo) frag.append(chars.slice(ultimo, ini).join(''));
    frag.append(h('mark', { text: chars.slice(ini, fim).join('') }));
    ultimo = fim;
    pos += termoNorm.length;
  }
  if (ultimo < chars.length) frag.append(chars.slice(ultimo).join(''));
  return frag;
}

// Trecho curto em volta da primeira ocorrência (para mostrar onde a busca achou).
export function trecho(texto, termoNorm, raio = 32) {
  const { chars, norm, mapa } = dobrar(texto);
  const pos = norm.indexOf(termoNorm);
  if (pos < 0) return texto.slice(0, raio * 2);
  const ini = Math.max(0, mapa[pos] - raio);
  const fim = Math.min(chars.length, mapa[pos] + termoNorm.length + raio);
  return (ini > 0 ? '…' : '') + chars.slice(ini, fim).join('') + (fim < chars.length ? '…' : '');
}

export const reduzirMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
