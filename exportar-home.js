// ============================================================
// COPIAR AS TRÊS TABELAS DA HOME COMO UMA IMAGEM
// ------------------------------------------------------------
// Lê as tabelas já renderizadas na tela e redesenha num <canvas>. Ler o DOM
// (em vez de recalcular os dados) garante que a imagem mostre exatamente o
// que está visível, inclusive o filtro de regional aplicado.
// ============================================================

const EXPH = {
    escala: 2,
    padding: 26,
    gap: 20,
    alturaTitulo: 44,
    alturaCab: 30,
    alturaLinha: 24,
    cor: {
        fundo: '#ffffff',
        texto: '#1f2937',
        texto2: '#6b7280',
        texto3: '#9ca3af',
        linha: '#e5e7eb',
        zebra: '#f9fafb',
        destaque: '#eef4fc',
        totalBg: '#f1f5f9'
    },
    // uma paleta por seção, na ordem em que aparecem na tela
    temas: [
        { topo: '#4a3270', cab: '#4a3270', num: '#4a3270', dest: '#f0eaf9' },
        { topo: '#1e4483', cab: '#1e2a5a', num: '#1e4483', dest: '#eaf1fa' },
        { topo: '#0b5d52', cab: '#0b5d52', num: '#0f7b6c', dest: '#eaf6f3' }
    ]
};

function ehFonte(t, p) {
    return `${p || 400} ${t}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

function ehTexto(ctx, txt, x, y, fonte, cor, align) {
    ctx.font = fonte;
    ctx.fillStyle = cor;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(txt), x, y);
}

function ehRet(ctx, x, y, w, h, r, cor) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = cor;
    ctx.fill();
}

// Extrai o conteúdo visível de uma <table class="rank-table">.
function ehLerTabela(sec) {
    const tab = sec.querySelector('table.rank-table');
    if (!tab) return null;

    const visivel = (el) => getComputedStyle(el).display !== 'none';
    const ths = [...tab.querySelectorAll('thead th')].filter(visivel);
    const colunas = ths.map(th => ({
        titulo: th.innerText.trim(),
        esquerda: th.classList.contains('l')
    }));

    const linhas = [...tab.querySelectorAll('tbody tr')].map(tr => ({
        total: tr.classList.contains('tot'),
        destaque: tr.classList.contains('dest'),
        celulas: [...tr.children].filter(visivel).map(td => ({
            txt: td.innerText.replace(/\s+/g, ' ').trim(),
            forte: td.classList.contains('b'),
            esquerda: td.classList.contains('l')
        }))
    }));

    const cab = sec.querySelector('.sec-head');
    return {
        titulo: (cab?.childNodes[0]?.textContent || '').trim() || 'Tabela',
        subtitulo: (cab?.querySelector('small')?.innerText || '').replace(/^·\s*/, '').trim(),
        colunas, linhas
    };
}

// Larguras proporcionais ao conteúdo mais largo de cada coluna.
function ehLarguras(ctx, dados, largura) {
    const n = dados.colunas.length;
    const medir = (txt, fonte) => { ctx.font = fonte; return ctx.measureText(txt).width; };
    const min = dados.colunas.map((c, i) => {
        let w = medir(c.titulo, ehFonte(10.5, 700));
        dados.linhas.forEach(l => {
            const cel = l.celulas[i];
            if (cel) w = Math.max(w, medir(cel.txt, ehFonte(11, cel.forte ? 800 : 400)));
        });
        return w + 14;
    });
    const soma = min.reduce((a, b) => a + b, 0);
    const sobra = Math.max(0, largura - soma);
    // a sobra vai para a coluna de texto mais larga (o nome do distrito)
    const iTexto = dados.colunas.findIndex(c => c.esquerda);
    if (iTexto >= 0) min[iTexto] += sobra;
    else min[n - 1] += sobra;
    return min;
}

function ehDesenharTabela(ctx, x, y, largura, dados, tema) {
    const C = EXPH.cor;

    ehRet(ctx, x, y, largura, EXPH.alturaTitulo, 10, tema.topo);
    ctx.fillRect(x, y + EXPH.alturaTitulo - 10, largura, 10);
    ehTexto(ctx, dados.titulo, x + 12, y + (dados.subtitulo ? 17 : EXPH.alturaTitulo / 2),
        ehFonte(13, 800), '#fff');
    if (dados.subtitulo) {
        ehTexto(ctx, dados.subtitulo, x + 12, y + 32, ehFonte(10, 500), 'rgba(255,255,255,.85)');
    }
    y += EXPH.alturaTitulo;

    const larguras = ehLarguras(ctx, dados, largura);

    ctx.fillStyle = tema.cab;
    ctx.fillRect(x, y, largura, EXPH.alturaCab);
    let cx = x;
    dados.colunas.forEach((c, i) => {
        const px = c.esquerda ? cx + 7 : cx + larguras[i] / 2;
        ehTexto(ctx, c.titulo, px, y + EXPH.alturaCab / 2, ehFonte(10.5, 700), '#fff',
            c.esquerda ? 'left' : 'center');
        cx += larguras[i];
    });
    y += EXPH.alturaCab;

    dados.linhas.forEach((l, idx) => {
        const alt = EXPH.alturaLinha;
        const fundo = l.total ? C.totalBg : l.destaque ? tema.dest : (idx % 2 ? C.zebra : null);
        if (fundo) { ctx.fillStyle = fundo; ctx.fillRect(x, y, largura, alt); }

        let lx = x;
        l.celulas.forEach((cel, i) => {
            const w = larguras[i] || 0;
            const px = cel.esquerda ? lx + 7 : lx + w / 2;
            const cor = cel.forte ? tema.num : C.texto;
            const peso = cel.forte || l.total ? 800 : 400;
            ehTexto(ctx, cel.txt, px, y + alt / 2, ehFonte(11, peso), cor,
                cel.esquerda ? 'left' : 'center');
            lx += w;
        });

        ctx.strokeStyle = C.linha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + alt + 0.5);
        ctx.lineTo(x + largura, y + alt + 0.5);
        ctx.stroke();
        y += alt;
    });

    return y;
}

function ehDesenharHome() {
    const secs = [...document.querySelectorAll('.home-sections > .sec')];
    const tabelas = secs.map(ehLerTabela).filter(Boolean);
    if (!tabelas.length) throw new Error('nenhuma tabela na tela');

    const cvMedida = document.createElement('canvas').getContext('2d');
    // largura de cada tabela proporcional ao seu conteúdo
    const pesos = tabelas.map(t => {
        cvMedida.font = ehFonte(11, 400);
        return t.colunas.reduce((soma, c, i) => {
            let w = cvMedida.measureText(c.titulo).width;
            t.linhas.forEach(l => {
                const cel = l.celulas[i];
                if (cel) w = Math.max(w, cvMedida.measureText(cel.txt).width);
            });
            return soma + w + 14;
        }, 0);
    });

    const largTotal = pesos.reduce((a, b) => a + b, 0);
    const largura = EXPH.padding * 2 + largTotal + EXPH.gap * (tabelas.length - 1);
    const maxLinhas = Math.max(...tabelas.map(t => t.linhas.length));
    const altura = EXPH.padding * 2 + 40 + EXPH.alturaTitulo + EXPH.alturaCab
        + maxLinhas * EXPH.alturaLinha + 26;

    const cv = document.createElement('canvas');
    cv.width = largura * EXPH.escala;
    cv.height = altura * EXPH.escala;
    const ctx = cv.getContext('2d');
    ctx.scale(EXPH.escala, EXPH.escala);
    ctx.fillStyle = EXPH.cor.fundo;
    ctx.fillRect(0, 0, largura, altura);

    let y = EXPH.padding;
    const filtro = state.filtroRegionalHome ? ` · ${state.filtroRegionalHome}` : '';
    ehTexto(ctx, `Campeonato Petz 2026 · Rodada ${state.semana}${filtro}`,
        EXPH.padding, y + 10, ehFonte(17, 800), '#1e2a5a');
    y += 40;

    let x = EXPH.padding;
    tabelas.forEach((t, i) => {
        ehDesenharTabela(ctx, x, y, pesos[i], t, EXPH.temas[i % EXPH.temas.length]);
        x += pesos[i] + EXPH.gap;
    });

    const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    ehTexto(ctx, `Gerado em ${agora}`, EXPH.padding, altura - EXPH.padding + 4,
        ehFonte(10, 400), EXPH.cor.texto3);

    return cv;
}

async function copiarHomeImagem(btn) {
    const txt = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Copiando...'; }
    try {
        const cv = ehDesenharHome();
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const nome = `campeonato-petz-rodada-${state.semana}.png`;
        const file = new File([blob], nome, { type: 'image/png' });

        if (await ehCopiar(blob)) {
            ehAviso(btn, '✅ Copiada', 'Imagem copiada — cole no WhatsApp com Cmd+V.');
        } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Campeonato Petz' });
            ehAviso(btn, '✅ Pronto', 'Imagem compartilhada.');
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = nome; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            ehAviso(btn, '⬇️ Baixada', 'O navegador não permitiu copiar — a imagem foi baixada.');
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.error('Falha ao copiar as tabelas:', e);
        alert('Não foi possível gerar a imagem.');
    } finally {
        if (btn) { btn.disabled = false; setTimeout(() => { btn.innerHTML = txt; }, 2500); }
    }

    function ehAviso(b, rotulo, msg) {
        if (b) b.innerHTML = rotulo;
        const bar = document.getElementById('infoBar');
        if (!bar) return;
        const antes = bar.innerHTML;
        bar.innerHTML = `<span>${msg}</span>`;
        setTimeout(() => { bar.innerHTML = antes; }, 5000);
    }
}

async function ehCopiar(blob) {
    try {
        if (!navigator.clipboard || !window.ClipboardItem) return false;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch (e) {
        console.warn('Não foi possível copiar:', e);
        return false;
    }
}
