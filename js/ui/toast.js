import { h } from './dom.js';

const MAX = 3;

/**
 * Aviso discreto no rodapé.
 * @param {string} mensagem
 * @param {{ acao?: { rotulo: string, fn: Function }, tempo?: number, tipo?: 'erro' }} opcoes
 *   tempo em ms (padrão 5 s); 0 deixa o aviso aberto até o usuário agir.
 */
export function toast(mensagem, { acao, tempo = 5000, tipo } = {}) {
  const raiz = document.getElementById('toasts');
  const el = h('div', { class: 'toast' + (tipo === 'erro' ? ' toast-erro' : '') },
    h('span', { class: 'toast-msg', text: mensagem }));

  const fechar = () => {
    if (!el.isConnected || el.classList.contains('saindo')) return;
    el.classList.add('saindo');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // caso a animação esteja desligada
  };

  if (acao) {
    el.append(h('button', {
      class: 'toast-acao', type: 'button', text: acao.rotulo,
      onClick: () => { fechar(); acao.fn(); },
    }));
  }
  el.append(h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Dispensar', text: '×', onClick: fechar }));

  raiz.append(el);
  while (raiz.children.length > MAX) raiz.firstElementChild.remove();

  if (tempo) { // tempo 0 = fica até o usuário agir
    let timer = setTimeout(fechar, tempo);
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => { timer = setTimeout(fechar, 2500); });
  }
  return fechar;
}
