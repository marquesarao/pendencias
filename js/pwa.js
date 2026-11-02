// PWA: registro do service worker, aviso de nova versão e instalação (beforeinstallprompt).

import { toast } from './ui/toast.js';

export const estado = {
  versao: '',          // versão do cache do service worker em uso (ex.: "v1")
  atualizacao: false,  // há um service worker novo esperando
  podeInstalar: false, // o navegador ofereceu a instalação (Android/Chrome)
  instalado: false,    // aberto como app instalado
};

const ouvintes = new Set();
export const aoMudar = fn => ouvintes.add(fn);
const avisar = () => ouvintes.forEach(fn => fn(estado));

const CHAVE_AVISO_INSTALAR = 'pend.avisoInstalar';

let registro;
let esperando;           // service worker novo, instalado e esperando
let atualizando = false; // só recarrega quando o próprio usuário pediu a atualização
let pedidoInstalacao;    // evento beforeinstallprompt guardado
let fecharAvisoVersao;

const modoApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** @param {{ aoInstalar: Function }} op chamado depois que o app é instalado */
export async function iniciarPwa({ aoInstalar }) {
  estado.instalado = modoApp();
  iniciarInstalacao(aoInstalar);

  if (!('serviceWorker' in navigator)) return avisar();
  try {
    // Caminho relativo: o escopo é a pasta do app (/pendencias/ no GitHub Pages).
    // updateViaCache 'none': a checagem de versão do sw.js nunca usa o cache HTTP.
    registro = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch (err) {
    console.error('[Pendências] Service worker não registrado:', err);
    return avisar();
  }

  if (registro.waiting && navigator.serviceWorker.controller) novaVersao(registro.waiting);
  registro.addEventListener('updatefound', () => {
    const novo = registro.installing;
    novo?.addEventListener('statechange', () => {
      // "installed" com um controlador já ativo = atualização (não a primeira instalação).
      if (novo.state === 'installed' && navigator.serviceWorker.controller) novaVersao(novo);
    });
  });

  // Recarrega UMA vez, e só depois que o usuário tocou em "Atualizar" (evita laço e evita
  // recarregar na primeira visita, quando o SW assume a página pela primeira vez).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!atualizando) return;
    atualizando = false;
    location.reload();
  });

  // Procura versão nova ao voltar para o app.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) registro.update().catch(() => {}); });

  await lerVersao();
  navigator.serviceWorker.addEventListener('controllerchange', lerVersao);
}

async function lerVersao() {
  const sw = navigator.serviceWorker.controller || registro?.active;
  if (!sw) return avisar();
  estado.versao = await new Promise(ok => {
    const canal = new MessageChannel();
    const limite = setTimeout(() => ok(''), 2000);
    canal.port1.onmessage = e => { clearTimeout(limite); ok(e.data); };
    sw.postMessage({ tipo: 'versao' }, [canal.port2]);
  });
  avisar();
}

function novaVersao(sw) {
  esperando = sw;
  estado.atualizacao = true;
  avisar();
  fecharAvisoVersao?.();
  fecharAvisoVersao = toast('Nova versão disponível.', { tempo: 0, acao: { rotulo: 'Atualizar', fn: atualizar } });
}

/** Ativa a versão nova (skipWaiting no SW) e recarrega uma única vez. */
export function atualizar() {
  if (!esperando) return;
  atualizando = true;
  esperando.postMessage({ tipo: 'atualizar' });
}

// ---------------------------------------------------------------------------
// Instalação
// ---------------------------------------------------------------------------

function iniciarInstalacao(aoInstalar) {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // nada de mini-barra automática: o app oferece no momento certo
    pedidoInstalacao = e;
    estado.podeInstalar = !estado.instalado;
    avisar();
    if (!estado.podeInstalar) return;
    let jaAvisou = true;
    try { jaAvisou = !!localStorage.getItem(CHAVE_AVISO_INSTALAR); } catch (_) {}
    if (!jaAvisou) {
      try { localStorage.setItem(CHAVE_AVISO_INSTALAR, '1'); } catch (_) {}
      toast('Instale o Pendências para abrir pelo ícone, mesmo sem internet.', {
        tempo: 12000, acao: { rotulo: 'Instalar', fn: instalar },
      });
    }
  });

  window.addEventListener('appinstalled', () => {
    pedidoInstalacao = null;
    estado.podeInstalar = false;
    estado.instalado = true;
    avisar();
    aoInstalar(); // pede o armazenamento persistente de novo
  });
}

export async function instalar() {
  if (!pedidoInstalacao) return;
  const pedido = pedidoInstalacao;
  pedidoInstalacao = null; // o mesmo evento só pode ser usado uma vez
  estado.podeInstalar = false;
  avisar();
  await pedido.prompt();
  await pedido.userChoice; // "accepted" → appinstalled cuida do resto
}
