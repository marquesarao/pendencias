// Seções "Em foco" e "Todas": seleção do que aparece, agrupamento, estados vazios.

import { h, icone, reconciliar, contem } from './dom.js';
import { criarLinha, atualizarLinha, ajustarAltura } from './row.js';
import { pendenciasAtivas, tagsDe, tagsAtivas, observacoesDe } from '../store.js';
import { ehHoje } from '../util.js';

const linhas = new Map(); // id → elemento (reaproveitado entre renders)
const grupos = new Map(); // chave → { el, zona, cab }
const vazios = new Map(); // chave → elemento

function linhaDe(id) {
  let el = linhas.get(id);
  if (!el) { el = criarLinha(id); linhas.set(id, el); }
  return el;
}

function vazio(chave, conteudo) {
  let el = vazios.get(chave);
  if (!el) { el = h('div', { class: 'empty' }); vazios.set(chave, el); }
  el.replaceChildren(...conteudo);
  return el;
}

// Concluídas de hoje ficam no fim da zona, riscadas.
const abertasPrimeiro = (a, b) => (a.feito - b.feito) || (a.ordem - b.ordem);

export function corresponde(p, termo) {
  if (!termo) return true;
  return contem(p.titulo, termo) || observacoesDe(p.id).some(o => contem(o.texto, termo));
}

/**
 * Desenha as seções. Devolve os ids visíveis na ordem da tela (para a navegação por teclado).
 * @param {object} ui estado da interface
 */
export function renderizarLista(ui) {
  const termo = ui.buscando ? ui.termo : '';
  const naLista = pendenciasAtivas().filter(p => !p.feito || ehHoje(p.feitoEm));
  let visiveis = naLista;
  if (ui.filtro) visiveis = visiveis.filter(p => p.tags.includes(ui.filtro));
  if (termo) visiveis = visiveis.filter(p => corresponde(p, termo));

  const foco = visiveis.filter(p => p.foco).sort(abertasPrimeiro);
  const resto = visiveis.filter(p => !p.foco).sort(abertasPrimeiro);
  const agrupar = ui.modo === 'agrupar' && !ui.filtro && !termo;
  const ordemTela = [];

  const opcoes = (p, ocultarPrimeiraTag) => ({
    ocultarPrimeiraTag, termo, aberto: ui.aberto === p.id, selecionado: ui.selecionado === p.id,
    confirmar: ui.confirmarExclusao === p.id,
  });
  const montar = (lista, ocultar) => lista.map(p => {
    const el = linhaDe(p.id);
    atualizarLinha(el, p, opcoes(p, ocultar));
    ordemTela.push(p.id);
    return el;
  });

  // Em foco
  const secFoco = document.getElementById('sec-foco');
  const zonaFoco = document.getElementById('foco');
  const filtrando = !!(ui.filtro || termo);
  secFoco.hidden = filtrando && !foco.length;
  document.getElementById('h-foco').dataset.n = foco.length || '';
  reconciliar(zonaFoco, foco.length ? montar(foco, false) : [vazio('foco', [
    icone('star'), h('span', {}, 'Nada em foco. Toque na estrela de um item para trazê-lo para cá.'),
  ])]);

  // Todas
  const raizTodas = document.getElementById('todas');
  document.getElementById('h-todas').dataset.n = resto.filter(p => !p.feito).length || '';
  document.getElementById('modo').hidden = filtrando;
  let blocos;

  if (!resto.length) {
    blocos = [vazio('todas', mensagemVazia(ui, termo, naLista.length, foco.length))];
  } else if (agrupar) {
    const porTag = new Map(tagsAtivas().map(t => [t.id, []]));
    const semTag = [];
    for (const p of resto) {
      const primeira = tagsDe(p)[0];
      (primeira ? porTag.get(primeira.id) : semTag).push(p);
    }
    blocos = [];
    for (const t of tagsAtivas()) {
      const itens = porTag.get(t.id);
      if (itens.length) blocos.push(grupo(t.id, t.nome, t.cor, itens, montar(itens, true)));
    }
    if (semTag.length) blocos.push(grupo('sem', 'Sem tag', null, semTag, montar(semTag, true)));
  } else {
    blocos = [grupo('corrida', null, null, resto, montar(resto, false))];
  }
  reconciliar(raizTodas, blocos);

  // Esquece linhas que sumiram (excluídas, concluídas em outro dia).
  const usados = new Set(ordemTela);
  for (const id of linhas.keys()) if (!usados.has(id)) linhas.delete(id);

  document.querySelectorAll('.row.is-open .d-title').forEach(ajustarAltura);
  return ordemTela;
}

function grupo(chave, nome, cor, itens, nos) {
  let g = grupos.get(chave);
  if (!g) {
    const zona = h('div', { class: 'zone', role: 'list' });
    const cab = nome ? h('div', { class: 'group-head' }) : null;
    g = { el: h('div', { class: 'group', 'data-grupo': chave }, cab, zona), zona, cab };
    grupos.set(chave, g);
  }
  if (g.cab) {
    const abertas = itens.filter(p => !p.feito).length;
    g.cab.replaceChildren(
      h('span', { class: 'dot', 'data-cor': cor || 'nenhuma' }),
      h('span', { class: 'group-name', text: nome }),
      h('span', { class: 'group-n num', text: String(abertas) }),
      h('span', { class: 'group-rule' }));
  }
  reconciliar(g.zona, nos);
  return g.el;
}

function mensagemVazia(ui, termo, totalNaLista, emFoco) {
  if (termo) return [icone('search'), h('span', {}, 'Nada encontrado para ', h('strong', { text: `“${ui.termoBruto}”` }), '.')];
  if (ui.filtro) return [icone('tag'), h('span', {}, emFoco ? 'O resto desta tag está em foco.' : 'Nada em aberto nesta tag.')];
  if (totalNaLista) return [icone('star'), h('span', {}, 'Tudo o que falta está em foco. Bom trabalho.')];
  return [icone('check'), h('span', {},
    h('strong', { text: 'Tudo em dia. ' }), 'Escreva acima e tecle Enter para anotar uma pendência. ',
    'Dica: comece com o nome de uma tag, como ', h('em', { text: 'casa: trocar a lâmpada' }), '.')];
}
