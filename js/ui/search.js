// Busca rápida: troca a barra de captura pela de busca.

import { normalizar } from '../util.js';

let ctx;
let campoNova;
let campoBusca;
let input;

export function iniciarBusca(contexto) {
  ctx = contexto;
  campoNova = document.querySelector('.capture-field[data-mode="nova"]');
  campoBusca = document.querySelector('.capture-field[data-mode="busca"]');
  input = document.getElementById('search-input');

  document.getElementById('btn-busca').addEventListener('click', () => (ctx.ui.buscando ? fecharBusca() : abrirBusca()));
  document.getElementById('search-close').addEventListener('click', fecharBusca);
  input.addEventListener('input', () => {
    ctx.ui.termoBruto = input.value.trim();
    ctx.ui.termo = normalizar(input.value);
    ctx.render();
  });
}

export function abrirBusca() {
  ctx.ui.buscando = true;
  campoNova.hidden = true;
  campoBusca.hidden = false;
  document.getElementById('btn-busca').setAttribute('aria-pressed', 'true');
  input.focus();
  input.select();
  ctx.render();
}

export function fecharBusca() {
  if (!ctx.ui.buscando) return;
  ctx.ui.buscando = false;
  ctx.ui.termo = '';
  ctx.ui.termoBruto = '';
  input.value = '';
  campoBusca.hidden = true;
  campoNova.hidden = false;
  document.getElementById('btn-busca').setAttribute('aria-pressed', 'false');
  ctx.render();
}
