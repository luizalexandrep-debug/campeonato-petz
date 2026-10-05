// ============================================================
// COPIAR AS MISSÕES DA SEMANA COMO UMA IMAGEM
//
// Os quadros por distrital numa grade de 3 colunas (6 quadros = 3 em cima e 3
// embaixo), prontos para colar no WhatsApp. Lê o mesmo agrupamento da página
// (misGrupos), então a imagem mostra exatamente o que está na tela.
//
// Reaproveita as peças de desenho de exportar-home.js (fonte, texto, retângulo
// arredondado e cópia para a área de transferência).
// ============================================================

const EXPM = {
    escala: 2,
    padding: 26,
    colunas: 3,
    larguraCard: 336,
    gap: 16,
    alturaTitulo: 62,     // título + linha de totais
    alturaCabCard: 36,
    alturaItem: 68,
    cor: {
        navy: '#1e2a5a', borda: '#e5e7eb', texto: '#1f2937', texto2: '#6b7280', texto3: '#9ca3af',
        ok: '#16a34a', okFundo: '#f0fbf4', nao: '#dc2626', naoFundo: '#fdf2f2',
        sem: '#b45309', semFundo: '#fffaf0'
    }
};

/* Retângulo só com os cantos de cima arredondados (cabeçalho do quadro). */
function expmTopoRedondo(ctx, x, y, w, h, r, cor) {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = cor;
    ctx.fill();
}

function expmDesenhar() {
    const { grupos, resumo } = misGrupos();
    if (!grupos.length) throw new Error('sem missões nesta rodada');
    const C = EXPM.cor;

    const linhasDeCards = [];
    for (let i = 0; i < grupos.length; i += EXPM.colunas) linhasDeCards.push(grupos.slice(i, i + EXPM.colunas));

    const largura = EXPM.padding * 2 + EXPM.colunas * EXPM.larguraCard + (EXPM.colunas - 1) * EXPM.gap;
    const alturaLinhas = linhasDeCards.map(l =>
        EXPM.alturaCabCard + Math.max(...l.map(g => g.itens.length)) * EXPM.alturaItem + 10);
    const altura = EXPM.padding * 2 + EXPM.alturaTitulo
        + alturaLinhas.reduce((a, b) => a + b, 0) + (linhasDeCards.length - 1) * EXPM.gap + 14;

    const cv = document.createElement('canvas');
    cv.width = largura * EXPM.escala;
    cv.height = altura * EXPM.escala;
    const ctx = cv.getContext('2d');
    ctx.scale(EXPM.escala, EXPM.escala);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largura, altura);

    // ---- título e totais ----
    let y = EXPM.padding;
    ehTexto(ctx, `Campeonato Petz 2026 · Missões da Semana · Rodada ${pg.semana}`,
        EXPM.padding, y + 10, ehFonte(17, 800), C.navy);
    let x = EXPM.padding;
    const totais = [
        [`${resumo.ok} cumprindo`, C.ok],
        [`${resumo.nao} não cumprindo`, C.nao],
        ...(resumo.sem ? [[`${resumo.sem} aguardando`, C.sem]] : []),
        [`${resumo.total} missões`, C.texto2]
    ];
    totais.forEach(([txt, cor]) => {
        ehTexto(ctx, txt, x, y + 38, ehFonte(13, 700), cor);
        x += ctx.measureText(txt).width + 22;
    });
    y += EXPM.alturaTitulo;

    // ---- grade de quadros ----
    linhasDeCards.forEach((linha, li) => {
        const altCard = alturaLinhas[li];
        linha.forEach((g, ci) => {
            const cx = EXPM.padding + ci * (EXPM.larguraCard + EXPM.gap);
            const w = EXPM.larguraCard;
            // moldura
            ehRet(ctx, cx, y, w, altCard, 10, C.borda);
            ehRet(ctx, cx + 1, y + 1, w - 2, altCard - 2, 9, '#ffffff');
            // cabeçalho
            expmTopoRedondo(ctx, cx, y, w, EXPM.alturaCabCard, 10, C.navy);
            ehTexto(ctx, g.dist, cx + 14, y + EXPM.alturaCabCard / 2, ehFonte(14, 800), '#ffffff');
            ehTexto(ctx, `${g.ok} de ${g.itens.length} cumprindo`, cx + w - 14,
                y + EXPM.alturaCabCard / 2, ehFonte(11, 400), 'rgba(255,255,255,.85)', 'right');

            g.itens.forEach(({ m, s }, k) => {
                const iy = y + EXPM.alturaCabCard + k * EXPM.alturaItem;
                const cor = s.estado === 'ok' ? C.ok : s.estado === 'nao' ? C.nao : C.sem;
                const fundo = s.estado === 'ok' ? C.okFundo : s.estado === 'nao' ? C.naoFundo : C.semFundo;
                ctx.fillStyle = fundo;
                ctx.fillRect(cx + 1, iy, w - 2, EXPM.alturaItem);
                ctx.fillStyle = cor;
                ctx.fillRect(cx + 1, iy, 4, EXPM.alturaItem);
                if (k > 0) { ctx.fillStyle = C.borda; ctx.fillRect(cx + 5, iy, w - 6, 1); }

                const meio = cx + w / 2;
                // linha 1: LOJA*  3 x 3  ADVERSÁRIO (placar no centro, como na tela)
                const placar = String(s.placar).replace('×', 'x');
                ctx.font = ehFonte(18, 800);
                const pw = ctx.measureText(placar).width;
                ehTexto(ctx, placar, meio, iy + 19, ehFonte(18, 800), C.texto, 'center');
                const ast = asteriscoEstado(m.loja, pg.estrutura);
                let fimLoja = meio - pw / 2 - 12;
                if (ast) {
                    ehTexto(ctx, '*', fimLoja, iy + 21, ehFonte(18, 900),
                        ast === 'piorou' ? C.nao : C.ok, 'right');
                    ctx.font = ehFonte(18, 900);
                    fimLoja -= ctx.measureText('*').width + 1;
                }
                ehTexto(ctx, m.loja, fimLoja, iy + 19, ehFonte(14, 800), C.texto, 'right');
                ehTexto(ctx, m.adversario || '', meio + pw / 2 + 12, iy + 19, ehFonte(14, 600), C.texto2, 'left');

                // linha 2: meta
                const meta = `Meta: ${m.criterio === 'nao_perder' ? 'não perder' : 'vencer'}`
                    + (m.criadoPor ? ` · marcada por ${m.criadoPor}` : '');
                ehTexto(ctx, meta, meio, iy + 40, ehFonte(11, 400), C.texto2, 'center');

                // linha 3: situação
                const icone = s.estado === 'ok' ? '✓' : s.estado === 'nao' ? '✕' : '…';
                const rotulo = `${icone} ${s.rotulo}`;
                const detalhe = s.res && s.estado !== 'sem' ? ` (${s.res})` : '';
                ctx.font = ehFonte(12, 700);
                const wr = ctx.measureText(rotulo).width;
                ctx.font = ehFonte(11, 400);
                const wd = ctx.measureText(detalhe).width;
                const ini = meio - (wr + wd) / 2;
                ehTexto(ctx, rotulo, ini, iy + 56, ehFonte(12, 700), cor, 'left');
                ehTexto(ctx, detalhe, ini + wr, iy + 56, ehFonte(11, 400), C.texto3, 'left');
            });
        });
        y += altCard + EXPM.gap;
    });

    const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const dadosAte = typeof estadoDadosRotulo === 'function' ? estadoDadosRotulo() : '';
    ehTexto(ctx, `Gerado em ${agora}${dadosAte ? ' · ' + dadosAte : ''}`, EXPM.padding, altura - EXPM.padding + 4,
        ehFonte(10, 400), C.texto3);
    return cv;
}

async function copiarMissoesImagem(btn) {
    if (typeof estadoDadosPodeCompartilhar === 'function' && !estadoDadosPodeCompartilhar()) return;
    const txt = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Copiando...'; }
    try {
        const cv = expmDesenhar();
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const nome = `missoes-rodada-${pg.semana}.png`;
        const file = new File([blob], nome, { type: 'image/png' });
        if (await ehCopiar(blob)) {
            if (btn) btn.innerHTML = '✅ Copiada';
        } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Missões da Semana' });
            if (btn) btn.innerHTML = '✅ Pronto';
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = nome; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            if (btn) btn.innerHTML = '⬇️ Baixada';
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.error('Falha ao copiar as missões:', e);
        alert(e && e.message === 'sem missões nesta rodada'
            ? 'Não há missões nesta rodada para copiar.' : 'Não foi possível gerar a imagem.');
    } finally {
        if (btn) { btn.disabled = false; setTimeout(() => { btn.innerHTML = txt; }, 2500); }
    }
}
