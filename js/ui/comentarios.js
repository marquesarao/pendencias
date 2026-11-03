// Comentários: texto com links clicáveis (montado com nós — nunca innerHTML) e rótulos de data.

import { h, realcar } from './dom.js';

// http(s)://… ou www.… até o próximo espaço. Só esses dois começos viram link: "javascript:" e
// afins nunca chegam a ser href.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const PONTUACAO_FINAL = /[.,;:!?'"»”’]+$/;

// Tira pontuação colada no fim ("veja https://x.com.") e ")" sem "(" correspondente.
function limparFim(url) {
  let u = url.replace(PONTUACAO_FINAL, '');
  while (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) {
    u = u.slice(0, -1).replace(PONTUACAO_FINAL, '');
  }
  return u;
}

/** Fragmento com o texto (quebras preservadas pelo CSS), links e o termo da busca realçado. */
export function textoComLinks(texto, termo) {
  const frag = document.createDocumentFragment();
  let ultimo = 0;
  for (const m of texto.matchAll(URL_RE)) {
    const url = limparFim(m[0]);
    if (!url) continue;
    if (m.index > ultimo) frag.append(realcar(texto.slice(ultimo, m.index), termo));
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    frag.append(h('a', { class: 'cmt-link', href, target: '_blank', rel: 'noopener noreferrer' }, realcar(url, termo)));
    ultimo = m.index + url.length;
  }
  if (ultimo < texto.length) frag.append(realcar(texto.slice(ultimo), termo));
  return frag;
}

const dois = n => String(n).padStart(2, '0');

/** "03/11/2026 10:14" (fuso do aparelho). */
export function dataHora(iso) {
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** "03/11 10:14". */
export function dataHoraCurta(iso) {
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** "03/11/2026 10:14 · editado em 03/11 10:20". */
export function rotuloComentario(c) {
  return dataHora(c.criadoEm) + (c.editadoEm ? ` · editado em ${dataHoraCurta(c.editadoEm)}` : '');
}

/** Lista só para leitura (painel Concluídas): data e texto inteiro, sem editar/excluir. */
export function listaSomenteLeitura(comentarios) {
  return h('ul', { class: 'cmt-lista cmt-leitura' }, ...comentarios.map(c => h('li', { class: 'cmt' },
    h('div', { class: 'cmt-cab' }, h('span', { class: 'cmt-data num', text: rotuloComentario(c) })),
    h('div', { class: 'cmt-texto is-aberto' }, textoComLinks(c.texto, '')))));
}
