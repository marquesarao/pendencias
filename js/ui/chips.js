import { h, icone } from './dom.js';
import { tagsAtivas } from '../store.js';
import { FILTRO_AGUARDANDO, temFiltro } from '../util.js';

// Chips de filtro: "Todas", "Aguardando" (só quando há itens aguardando) e uma por tag,
// com a contagem de abertas. Vários podem ficar ativos (tags: OU; Aguardando: E).
// "Todas" limpa tudo e fica ativo quando nenhum filtro está ligado.
export function renderizarChips(raiz, abertas, filtros) {
  const tags = tagsAtivas();
  const contar = id => abertas.filter(p => p.tags.includes(id)).length;
  const aguardando = abertas.filter(p => p.aguardando).length;

  const chips = [
    h('button', { class: 'chip', type: 'button', 'data-filtro': '', 'aria-pressed': String(!temFiltro(filtros)) },
      'Todas', h('span', { class: 'chip-n num', text: String(abertas.length) })),
    aguardando
      ? h('button', {
        class: 'chip chip-tag', type: 'button', 'data-filtro': FILTRO_AGUARDANDO, 'data-cor': 'espera',
        'aria-pressed': String(filtros.aguardando),
      }, icone('wait', 'chip-icone'), icone('check', 'chip-check'), 'Aguardando', h('span', { class: 'chip-n num', text: String(aguardando) }))
      : null,
    ...tags.map(t => h('button', {
      class: 'chip chip-tag', type: 'button', 'data-filtro': t.id, 'data-cor': t.cor, 'aria-pressed': String(filtros.tags.includes(t.id)),
    }, h('span', { class: 'dot' }), icone('check', 'chip-check'), t.nome, h('span', { class: 'chip-n num', text: String(contar(t.id)) }))),
  ].filter(Boolean);
  if (!tags.length) {
    chips.push(h('button', { class: 'chip chip-ghost', type: 'button', 'data-act': 'abrir-tags' }, icone('plus'), 'Criar tags'));
  }
  const focado = raiz.contains(document.activeElement) ? document.activeElement.dataset.filtro : undefined;
  raiz.replaceChildren(...chips);
  if (focado !== undefined) raiz.querySelector(`[data-filtro="${focado}"]`)?.focus();
}
