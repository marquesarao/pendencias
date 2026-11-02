import { normalizar } from './util.js';

// "igreja: comprar cadeiras" → prefixo "igreja", resto "comprar cadeiras".
// O prefixo precisa ter ao menos uma letra (para "10:30 reunião" não virar tag).
const PREFIXO = /^([^:/]{1,24}):\s*(\S[\s\S]*)$/;

/**
 * Interpreta o texto da captura.
 * @returns {{ titulo, tagId, tagInexistente, tituloSemPrefixo }}
 *  - tag existente: titulo sem o prefixo e tagId preenchido;
 *  - tag inexistente: titulo = texto original; tagInexistente = nome digitado;
 *  - sem prefixo: titulo = texto.
 */
export function interpretarCaptura(texto, tags) {
  const limpo = texto.trim();
  const m = limpo.match(PREFIXO);
  if (!m || !/\p{L}/u.test(m[1])) return { titulo: limpo, tagId: null, tagInexistente: null };

  const nome = m[1].trim();
  const resto = m[2].trim();
  const alvo = normalizar(nome);
  const tag = tags.find(t => normalizar(t.nome) === alvo);
  if (tag) return { titulo: resto, tagId: tag.id, tagInexistente: null };
  return { titulo: limpo, tagId: null, tagInexistente: nome, tituloSemPrefixo: resto };
}

// "ok ligar" / "✓ ligar" → { tipo: 'ok', texto: 'ligar' }; senão tipo 'falta'.
export function interpretarObservacao(texto) {
  const limpo = texto.trim();
  const m = limpo.match(/^(?:ok|✓|✔)\s+([\s\S]+)$/i);
  if (m) return { tipo: 'ok', texto: m[1].trim() };
  return { tipo: 'falta', texto: limpo };
}
