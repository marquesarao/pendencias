import { h, icone } from './dom.js';
import { tagsAtivas } from '../store.js';

// Chips de filtro: "Todas" + uma por tag, com a contagem de abertas.
export function renderizarChips(raiz, abertas, filtro) {
  const tags = tagsAtivas();
  const contar = id => abertas.filter(p => p.tags.includes(id)).length;

  const chips = [
    h('button', { class: 'chip', type: 'button', 'data-filtro': '', 'aria-pressed': String(!filtro) },
      'Todas', h('span', { class: 'chip-n num', text: String(abertas.length) })),
    ...tags.map(t => h('button', {
      class: 'chip', type: 'button', 'data-filtro': t.id, 'data-cor': t.cor, 'aria-pressed': String(filtro === t.id),
    }, h('span', { class: 'dot' }), t.nome, h('span', { class: 'chip-n num', text: String(contar(t.id)) }))),
  ];
  if (!tags.length) {
    chips.push(h('button', { class: 'chip chip-ghost', type: 'button', 'data-act': 'abrir-tags' }, icone('plus'), 'Criar tags'));
  }
  const focado = raiz.contains(document.activeElement) ? document.activeElement.dataset.filtro : undefined;
  raiz.replaceChildren(...chips);
  if (focado !== undefined) raiz.querySelector(`[data-filtro="${focado}"]`)?.focus();
}
