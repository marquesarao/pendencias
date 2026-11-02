# tools/

Ferramentas de apoio. **Não fazem parte do app** (o service worker não as coloca em cache).

## Gerar os ícones PNG

Fontes: `icons/icon.svg` (ícone normal, cantos arredondados) e `icons/icon-maskable.svg`
(fundo cheio, ✓ dentro da área segura — o Android recorta em círculo/squircle).

1. Na pasta do projeto: `npx serve -l 8137` (ou `python -m http.server 8137`).
2. Abra `http://localhost:8137/tools/gerar-icones.html`.
3. Clique em cada link para baixar e salve em `icons/`, substituindo:
   `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`.
4. Confira na página o recorte circular do maskable: o ✓ precisa caber inteiro.
5. Se os ícones mudaram, suba a versão em `sw.js` antes de publicar (veja README, seção 5).

Os PNGs finais ficam commitados no repositório.
