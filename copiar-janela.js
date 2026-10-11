// ============================================================
// COPIAR UMA JANELA (MODAL) COMO IMAGEM
//
// Para a janela dos jogos do distrito, que tem cartões, avisos, barras e uma
// tabela — redesenhar tudo à mão num <canvas> duplicaria o layout. Aqui a
// própria janela é clonada fora da tela, sem a rolagem interna (sai inteira, não
// só o que cabe na tela), e fotografada com html2canvas.
//
// Qualquer botão com [data-copiar-janela] dentro de uma janela .modal-dist
// (dashboard) ou .painel (simulador) dispara a cópia.
// ============================================================

const CJ_HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
let _cjCarregando = null;

function cjCarregarLib() {
    if (window.html2canvas) return Promise.resolve();
    if (_cjCarregando) return _cjCarregando;
    _cjCarregando = new Promise((ok, erro) => {
        const s = document.createElement('script');
        s.src = CJ_HTML2CANVAS;
        s.onload = () => ok();
        s.onerror = () => { _cjCarregando = null; erro(new Error('não carregou o html2canvas')); };
        document.head.appendChild(s);
    });
    return _cjCarregando;
}

async function cjGerarCanvas(janela) {
    await cjCarregarLib();
    const fundo = janela.parentElement;
    const largura = janela.offsetWidth;

    // Clone fora da tela, dentro de um invólucro com a mesma classe do fundo
    // (para os seletores descendentes do CSS continuarem valendo).
    const invol = document.createElement('div');
    invol.className = fundo ? fundo.className : '';
    invol.style.cssText = `position:fixed;left:-30000px;top:0;inset:auto;right:auto;bottom:auto;`
        + `width:${largura}px;height:auto;max-height:none;overflow:visible;padding:0;margin:0;`
        + `background:transparent;display:block;backdrop-filter:none;`;
    const clone = janela.cloneNode(true);
    clone.style.cssText += `;width:${largura}px;max-width:none;max-height:none;height:auto;overflow:visible;`
        + `margin:0;box-shadow:none;`;
    clone.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            el.style.overflow = 'visible';
            el.style.maxHeight = 'none';
            el.style.height = 'auto';
        }
    });
    // valores digitados (simulador) não vêm no cloneNode
    const orig = janela.querySelectorAll('input, select, textarea');
    clone.querySelectorAll('input, select, textarea').forEach((el, i) => {
        if (orig[i]) el.setAttribute('value', orig[i].value);
    });
    // os botões não entram na imagem
    clone.querySelectorAll('button, [data-fechar], [data-copiar-janela]').forEach(b => b.remove());
    invol.appendChild(clone);
    document.body.appendChild(invol);
    try {
        return await window.html2canvas(clone, {
            scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
            windowWidth: largura + 40
        });
    } finally {
        invol.remove();
    }
}

async function cjCopiarBlob(blob) {
    try {
        if (!navigator.clipboard || !window.ClipboardItem) return false;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch (e) {
        console.warn('Não foi possível copiar a imagem:', e);
        return false;
    }
}

async function copiarJanelaComoImagem(btn) {
    if (typeof estadoDadosPodeCompartilhar === 'function' && !estadoDadosPodeCompartilhar()) return;
    const janela = btn.closest('.modal-dist, .painel');
    if (!janela) return;
    const rotulo = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Gerando…';
    let final = rotulo;
    try {
        const cv = await cjGerarCanvas(janela);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        if (!blob) throw new Error('imagem vazia');
        if (await cjCopiarBlob(blob)) {
            final = '✅ Copiado — cole com Cmd+V';
        } else {
            const titulo = (janela.querySelector('b')?.textContent || 'distrito').trim()
                .replace(/[^\w\-]+/g, '-').replace(/-+/g, '-');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${titulo}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            final = '⬇️ Baixada';
        }
    } catch (e) {
        console.error('Falha ao copiar a imagem da janela:', e);
        final = '⚠️ Não foi possível';
    } finally {
        btn.disabled = false;
        btn.innerHTML = final;
        setTimeout(() => { btn.innerHTML = rotulo; }, 2600);
    }
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copiar-janela]');
    if (btn) { e.preventDefault(); e.stopPropagation(); copiarJanelaComoImagem(btn); }
}, true);
