// ============================================================
// EXPORTAR CLASSIFICAÇÃO DO GRUPO COMO IMAGEM
// ------------------------------------------------------------
// Desenha as duas tabelas (atual x simulada) direto num <canvas>, em alta
// definição, para compartilhar no WhatsApp. Mesma abordagem de
// exportar-imagem.js: nada de fotografar o DOM.
// ============================================================

const EXPG = {
    escala: 3,
    padding: 28,
    gapTabelas: 22,
    larguraTabela: 560,
    alturaLinha: 27,
    alturaCabTab: 34,
    alturaTitulo: 46,
    cor: {
        fundo: '#ffffff',
        azul: '#1e4483', azulEsc: '#1e2a5a',
        verde: '#0f7b6c', verdeEsc: '#0b5d52',
        texto: '#1f2937', texto2: '#6b7280', texto3: '#9ca3af',
        linha: '#e5e7eb', zebra: '#f9fafb',
        sobe: '#157347', desce: '#c0392b'
    }
};

function egFonte(t, p) {
    return `${p || 400} ${t}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

function egTexto(ctx, txt, x, y, fonte, cor, align) {
    ctx.font = fonte;
    ctx.fillStyle = cor;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(txt), x, y);
}

function egRet(ctx, x, y, w, h, r, cor) {
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

// Colunas: [rótulo, largura, chave, alinhamento]
function egColunas(ehSim) {
    const cols = [['#', 30, 'pos', 'center']];
    if (ehSim) cols.push(['Mov.', 46, 'mov', 'center']);
    cols.push(['Time', 96, 'time', 'left']);
    cols.push(['Pts', 40, 'pts', 'center']);
    if (ehSim) cols.push(['+Rod.', 46, 'ganhou', 'center']);
    cols.push(['J', 28, 'jogos', 'center'], ['V', 28, 'vit', 'center'],
        ['E', 28, 'emp', 'center'], ['D', 28, 'der', 'center'],
        ['GM', 36, 'gm', 'center'], ['GS', 36, 'gs', 'center'], ['SG', 36, 'sg', 'center']);
    return cols;
}

function egDesenharTabela(ctx, x, y, largura, titulo, subtitulo, linhas, ehSim) {
    const C = EXPG.cor;
    const corTopo = ehSim ? C.verde : C.azul;
    const corCab = ehSim ? C.verdeEsc : C.azulEsc;
    const cols = egColunas(ehSim);
    const totalCols = cols.reduce((a, c) => a + c[1], 0);
    const escalaCol = largura / totalCols;

    // faixa do título
    egRet(ctx, x, y, largura, EXPG.alturaTitulo, 10, corTopo);
    ctx.fillRect(x, y + EXPG.alturaTitulo - 10, largura, 10);
    egTexto(ctx, titulo, x + 14, y + EXPG.alturaTitulo / 2 - 6, egFonte(15, 800), '#fff');
    egTexto(ctx, subtitulo, x + 14, y + EXPG.alturaTitulo / 2 + 11, egFonte(11, 500), 'rgba(255,255,255,.85)');
    y += EXPG.alturaTitulo;

    // cabeçalho das colunas
    ctx.fillStyle = corCab;
    ctx.fillRect(x, y, largura, EXPG.alturaCabTab);
    let cx = x;
    cols.forEach(([rot, w, , al]) => {
        const lw = w * escalaCol;
        const px = al === 'left' ? cx + 8 : cx + lw / 2;
        egTexto(ctx, rot, px, y + EXPG.alturaCabTab / 2, egFonte(11.5, 700), '#fff', al === 'left' ? 'left' : 'center');
        cx += lw;
    });
    y += EXPG.alturaCabTab;

    // linhas
    linhas.forEach((r, i) => {
        if (i % 2 === 1) {
            ctx.fillStyle = EXPG.cor.zebra;
            ctx.fillRect(x, y, largura, EXPG.alturaLinha);
        }
        let lx = x;
        cols.forEach(([, w, chave, al]) => {
            const lw = w * escalaCol;
            const px = al === 'left' ? lx + 8 : lx + lw / 2;
            let txt = r[chave] ?? '';
            let cor = EXPG.cor.texto;
            let fonte = egFonte(12, 400);

            if (chave === 'time') { fonte = egFonte(12, 700); }
            else if (chave === 'pts') { fonte = egFonte(12.5, 800); cor = ehSim ? EXPG.cor.verde : EXPG.cor.azul; }
            else if (chave === 'mov') {
                const d = r.movNum;
                if (d > 0) { txt = `▲ ${d}`; cor = EXPG.cor.sobe; fonte = egFonte(11.5, 800); }
                else if (d < 0) { txt = `▼ ${-d}`; cor = EXPG.cor.desce; fonte = egFonte(11.5, 800); }
                else { txt = '–'; cor = EXPG.cor.texto3; }
            } else if (chave === 'ganhou') {
                txt = r.ganhou === undefined ? '—' : `+${r.ganhou}`;
                cor = EXPG.cor.texto2;
            }
            egTexto(ctx, txt, px, y + EXPG.alturaLinha / 2, fonte, cor, al === 'left' ? 'left' : 'center');
            lx += lw;
        });
        ctx.strokeStyle = EXPG.cor.linha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + EXPG.alturaLinha + 0.5);
        ctx.lineTo(x + largura, y + EXPG.alturaLinha + 0.5);
        ctx.stroke();
        y += EXPG.alturaLinha;
    });

    return y;
}

function egDesenhar(grupo, rodadaBase, rodadaProj, atual, simulado) {
    const larg = EXPG.larguraTabela;
    const largura = EXPG.padding * 2 + larg * 2 + EXPG.gapTabelas;
    const nLinhas = Math.max(atual.length, simulado.length);
    const altura = EXPG.padding * 2 + 54
        + EXPG.alturaTitulo + EXPG.alturaCabTab + nLinhas * EXPG.alturaLinha + 34;

    const cv = document.createElement('canvas');
    cv.width = largura * EXPG.escala;
    cv.height = altura * EXPG.escala;
    const ctx = cv.getContext('2d');
    ctx.scale(EXPG.escala, EXPG.escala);
    ctx.fillStyle = EXPG.cor.fundo;
    ctx.fillRect(0, 0, largura, altura);

    let y = EXPG.padding;
    egTexto(ctx, `Campeonato Petz 2026 · ${grupo}`, EXPG.padding, y + 12, egFonte(20, 800), EXPG.cor.azulEsc);
    egTexto(ctx, `Classificação até a rodada ${rodadaBase} e simulação com os placares projetados da rodada ${rodadaProj}`,
        EXPG.padding, y + 34, egFonte(12, 400), EXPG.cor.texto2);
    y += 54;

    const fim1 = egDesenharTabela(ctx, EXPG.padding, y, larg,
        '📋 Classificação atual', `até a rodada ${rodadaBase}`, atual, false);
    const fim2 = egDesenharTabela(ctx, EXPG.padding + larg + EXPG.gapTabelas, y, larg,
        '🔮 Simulada', `rodada ${rodadaBase} + projeção da ${rodadaProj}`, simulado, true);

    const yr = Math.max(fim1, fim2) + 18;
    egTexto(ctx, 'Desempate: Pts › VIT › SG › GM. Projeção calculada a partir das vendas parciais da rodada.',
        EXPG.padding, yr, egFonte(10.5, 400), EXPG.cor.texto3);

    return cv;
}

async function exportarGrupoImagem(btn) {
    const txt = btn ? btn.innerHTML : null;
    let avisou = false;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Copiando...'; }
    try {
        const d = window.__dadosExportGrupo;
        if (!d) throw new Error('nada para exportar');

        const cv = egDesenhar(d.grupo, d.rodadaBase, d.rodadaProj, d.atual, d.simulado);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const nome = `${d.grupo.replace(/[^\w]+/g, '-')}-rodada-${d.rodadaProj}.png`;
        const file = new File([blob], nome, { type: 'image/png' });

        // A ação principal é copiar. Só se o navegador recusar é que caímos
        // para o compartilhamento nativo ou para o download.
        if (await egCopiar(blob)) {
            aviso('📋 Imagem copiada — cole no WhatsApp com Cmd+V.');
        } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: d.grupo });
            aviso('✅ Compartilhado');
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = nome; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            aviso('⬇️ O navegador não permitiu copiar — a imagem foi baixada.');
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.error('Falha ao exportar o grupo:', e);
        alert('Não foi possível gerar a imagem.');
    } finally {
        if (btn) { btn.disabled = false; if (!avisou) btn.innerHTML = txt; }
    }

    function aviso(msg) {
        avisou = true;
        if (btn) {
            btn.innerHTML = '✅ Copiada';
            setTimeout(() => { btn.innerHTML = txt; }, 2500);
        }
        const bar = document.getElementById('infoBar');
        if (!bar) return;
        const antes = bar.innerHTML;
        bar.innerHTML = `<span>${msg}</span>`;
        setTimeout(() => { bar.innerHTML = antes; }, 5000);
    }
}

async function egCopiar(blob) {
    try {
        if (!navigator.clipboard || !window.ClipboardItem) return false;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch (e) {
        console.warn('Não foi possível copiar:', e);
        return false;
    }
}
