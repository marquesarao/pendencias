// Reordenação por arraste com Pointer Events (mouse, caneta e toque).
//  - Mouse/caneta: arrasta depois de mover 5 px (um clique simples continua sendo clique).
//  - Toque: segurar ~300 ms e arrastar (um deslizar rápido continua rolando a página).
//  - Alça (opcional): começa na hora, inclusive no toque.
// Cada item só se move dentro do próprio contêiner (zona).

const LIMIAR_MOUSE = 5;
const LIMIAR_TOQUE = 8;
const ESPERA_TOQUE = 300;
const BORDA_ROLAGEM = 72;

/**
 * @param {HTMLElement} raiz  elemento que recebe os eventos (delegação)
 * @param {object} op
 * @param {string} op.item    seletor do item arrastável
 * @param {string} [op.alca]  seletor da alça; se houver, arrasta só por ela
 * @param {string} [op.ignorar] seletor de áreas que não iniciam arraste
 * @param {(el: HTMLElement) => boolean} [op.pode]
 * @param {(zona: HTMLElement, el: HTMLElement, ids: string[], indice: number) => void} op.soltar
 */
export function arrastavel(raiz, op) {
  const pode = op.pode || (() => true);
  let p = null; // gesto em andamento

  raiz.addEventListener('pointerdown', e => {
    if (p || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.target.closest(op.item);
    if (!el || !raiz.contains(el) || !pode(el)) return;
    const naAlca = op.alca ? !!e.target.closest(op.alca) : false;
    if (op.alca && !naAlca) return;
    if (!naAlca && op.ignorar && e.target.closest(op.ignorar)) return;

    p = {
      el, id: e.pointerId, tipo: e.pointerType, x0: e.clientX, y0: e.clientY,
      ativo: false, timer: null,
    };
    if (naAlca) {
      e.preventDefault();
      iniciar(e);
    } else if (e.pointerType === 'touch') {
      p.timer = setTimeout(() => { if (p && !p.ativo) iniciar(e); }, ESPERA_TOQUE);
    }
  });

  window.addEventListener('pointermove', e => {
    if (!p || e.pointerId !== p.id) return;
    if (!p.ativo) {
      const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      if (p.tipo === 'touch') {
        if (dist > LIMIAR_TOQUE) cancelar(); // é rolagem
      } else if (dist > LIMIAR_MOUSE) {
        iniciar(e);
      }
      return;
    }
    p.yAtual = e.clientY;
    mover();
  });

  window.addEventListener('pointerup', e => { if (p && e.pointerId === p.id) terminar(); });
  window.addEventListener('pointercancel', e => { if (p && e.pointerId === p.id) terminar(true); });

  // Durante o arraste por toque, impede a rolagem nativa.
  window.addEventListener('touchmove', e => { if (p && p.ativo) e.preventDefault(); }, { passive: false });
  window.addEventListener('contextmenu', e => { if (p) e.preventDefault(); });

  // Engole o clique que o navegador dispara ao soltar o mouse depois de arrastar.
  raiz.addEventListener('click', e => {
    if (raiz.dataset.engolirClique) {
      delete raiz.dataset.engolirClique;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  function iniciar(e) {
    const zona = p.el.parentElement;
    const itens = [...zona.children].filter(c => c.matches(op.item) && pode(c));
    if (itens.length < 2) { cancelar(); return; }

    p.ativo = true;
    p.zona = zona;
    p.itens = itens;
    p.indice0 = itens.indexOf(p.el);
    p.medidas = itens.map(c => {
      const r = c.getBoundingClientRect();
      return { topo: r.top + scrollY, altura: r.height };
    });
    p.yInicio = e.clientY + scrollY;
    p.yAtual = e.clientY;
    p.destino = p.indice0;

    p.el.classList.add('arrastando');
    zona.classList.add('zona-arraste');
    document.body.classList.add('arrastando-algo');
    try { p.el.setPointerCapture(p.id); } catch (_) {}
    if (p.tipo === 'touch' && navigator.vibrate) navigator.vibrate(8);
    rolarNaBorda();
  }

  function mover() {
    const dy = p.yAtual + scrollY - p.yInicio;
    p.el.style.transform = `translateY(${dy}px)`;

    const m0 = p.medidas[p.indice0];
    const centro = m0.topo + m0.altura / 2 + dy;
    let destino = 0;
    p.medidas.forEach((m, i) => {
      if (i !== p.indice0 && m.topo + m.altura / 2 < centro) destino++;
    });
    p.destino = destino;

    p.itens.forEach((c, i) => {
      if (i === p.indice0) return;
      let desloc = 0;
      if (p.indice0 < destino && i > p.indice0 && i <= destino) desloc = -m0.altura;
      if (p.indice0 > destino && i < p.indice0 && i >= destino) desloc = m0.altura;
      c.style.transform = desloc ? `translateY(${desloc}px)` : '';
    });
  }

  function rolarNaBorda() {
    if (!p || !p.ativo) return;
    const y = p.yAtual;
    let v = 0;
    if (y < BORDA_ROLAGEM) v = -Math.ceil((BORDA_ROLAGEM - y) / 6);
    else if (y > innerHeight - BORDA_ROLAGEM) v = Math.ceil((y - innerHeight + BORDA_ROLAGEM) / 6);
    if (v) { scrollBy(0, v); mover(); }
    requestAnimationFrame(rolarNaBorda);
  }

  function limpar() {
    p.itens.forEach(c => { c.style.transform = ''; });
    p.el.classList.remove('arrastando');
    p.zona.classList.remove('zona-arraste');
    document.body.classList.remove('arrastando-algo');
  }

  function terminar(cancelado = false) {
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.ativo) { p = null; return; }
    const { zona, el, itens, indice0, destino } = p;
    limpar();
    if (p.tipo !== 'touch') raiz.dataset.engolirClique = '1';
    setTimeout(() => { delete raiz.dataset.engolirClique; }, 0);
    p = null;
    if (cancelado || destino === indice0) return;
    const ids = itens.filter(c => c !== el).map(c => c.dataset.id);
    ids.splice(destino, 0, el.dataset.id);
    op.soltar(zona, el, ids, destino);
  }

  function cancelar() {
    if (!p) return;
    clearTimeout(p.timer);
    if (p.ativo) limpar();
    p = null;
  }
}
