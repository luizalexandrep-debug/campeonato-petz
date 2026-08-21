// ============================================================
// EXPORTAR JOGO COMO IMAGEM
// ------------------------------------------------------------
// Desenha o card do jogo (placar + todas as tabelas de indicador) direto num
// <canvas>, em vez de fotografar o DOM. Sai nítido em qualquer escala, não
// depende de biblioteca externa e não é afetado por CSS/scroll da página.
// ============================================================

const EXP = {
    escala: 3,              // 3x = alta definição para WhatsApp
    largura: 1000,          // largura lógica (px CSS)
    pad: 32,
    gap: 24,
    dias: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
    cor: {
        fundo: '#ffffff',
        navy: '#1e2a5a',
        brand: '#2b5aa8',
        brandInk: '#1e4483',
        texto: '#1f2937',
        texto2: '#6b7280',
        texto3: '#9ca3af',
        linha: '#e5e7eb',
        zebra: '#f9fafb',
        cabecalho: '#f3f4f6',
        pos: '#157347',
        posBg: '#e8f6ef',
        neg: '#c0392b',
        negBg: '#fdecea',
        alerta: '#6b4d00',
        alertaBg: '#fff3cd'
    }
};

function expFonte(tam, peso) {
    return `${peso || 400} ${tam}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

function expRet(ctx, x, y, w, h, r, cor) {
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

function expTexto(ctx, txt, x, y, { fonte, cor, align }) {
    ctx.font = fonte;
    ctx.fillStyle = cor;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, x, y);
}

// Reúne o que precisa ser desenhado para um indicador, aplicando as MESMAS
// regras de agregação e evolução do dashboard.
function expLinhasIndicador(dados, dadosAdv) {
    const tipo = dados.atual?.type || dados.anterior?.type || 'R$';
    const ehPct = tipo === '%';
    const diasAnt = dados.anterior?.dias || {};
    const diasAtu = dados.atual?.dias || {};
    const agregar = (o) => ehPct
        ? agregarPct(o, EXP.dias)
        : EXP.dias.reduce((a, d) => a + ((o || {})[d] || 0), 0);

    const linhas = EXP.dias.map(dia => {
        const a = diasAnt[dia] || 0;
        const b = diasAtu[dia] || 0;
        return { dia, ant: a, atu: b, evo: evolucaoPct(a, b) };
    });

    const totAnt = agregar(diasAnt);
    const totAtu = agregar(diasAtu);
    const usaTotalPlanilha = ehPct && !!(diasAtu[CHAVE_TOTAL] || diasAnt[CHAVE_TOTAL]);

    let evoAdv = null, faltaVirar = null;
    if (dadosAdv) {
        evoAdv = evolucaoPct(agregar(dadosAdv.anterior?.dias), agregar(dadosAdv.atual?.dias));
    }
    const evoTot = evolucaoPct(totAnt, totAtu);
    if (evoAdv !== null && evoTot < evoAdv && totAnt > 0) {
        const falta = totAnt * (1 + evoAdv / 100) - totAtu;
        if (falta > 0) faltaVirar = falta;
    }

    return {
        tipo, ehPct, linhas, totAnt, totAtu, evoTot, evoAdv, faltaVirar,
        rotuloTotal: (ehPct && !usaTotalPlanilha) ? 'MÉDIA' : 'TOTAL'
    };
}

function expAlturaTabela(info) {
    return 52 + 30 + (7 * 30) + 34 + (info.faltaVirar !== null ? 30 : 0);
}

function expDesenhaTabela(ctx, x, y, w, loja, indicador, info, marcou) {
    const c = EXP.cor;
    const alt = expAlturaTabela(info);
    const fmt = (v) => formatarValor(v, info.tipo);

    // moldura
    expRet(ctx, x, y, w, alt, 10, '#ffffff');
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, alt);
    ctx.clip();

    // título: loja + indicador
    ctx.fillStyle = c.navy;
    ctx.fillRect(x, y, w, 52);
    expTexto(ctx, loja, x + w / 2, y + 19, { fonte: expFonte(17, 800), cor: '#fff', align: 'center' });
    expTexto(ctx, indicador.replace(/\.xlsx$/i, ''), x + w / 2, y + 38,
        { fonte: expFonte(12, 600), cor: 'rgba(255,255,255,.82)', align: 'center' });
    if (marcou) {
        // Bola no canto direito, marcando quem está fazendo o gol.
        expTexto(ctx, '⚽', x + w - 16, y + 27,
            { fonte: expFonte(21, 400), cor: '#fff', align: 'right' });
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillRect(x, y + 49, w, 3);
    }

    // colunas
    const cols = [x + 14, x + w * 0.42, x + w * 0.68, x + w - 14];
    let cy = y + 52;

    ctx.fillStyle = c.cabecalho;
    ctx.fillRect(x, cy, w, 30);
    const th = { fonte: expFonte(11.5, 700), cor: c.texto2 };
    expTexto(ctx, 'Dia', cols[0], cy + 15, th);
    expTexto(ctx, 'S. Anterior', cols[1], cy + 15, { ...th, align: 'right' });
    expTexto(ctx, 'S. Atual', cols[2], cy + 15, { ...th, align: 'right' });
    expTexto(ctx, 'Evolução', cols[3], cy + 15, { ...th, align: 'right' });
    cy += 30;

    info.linhas.forEach((l, i) => {
        if (i % 2) { ctx.fillStyle = c.zebra; ctx.fillRect(x, cy, w, 30); }
        if (l.evo > 0) { ctx.fillStyle = c.posBg; ctx.fillRect(cols[2] + 8, cy, x + w - cols[2] - 8, 30); }
        else if (l.evo < 0) { ctx.fillStyle = c.negBg; ctx.fillRect(cols[2] + 8, cy, x + w - cols[2] - 8, 30); }

        expTexto(ctx, l.dia, cols[0], cy + 15, { fonte: expFonte(12.5, 600), cor: c.texto });
        expTexto(ctx, fmt(l.ant), cols[1], cy + 15, { fonte: expFonte(12.5, 400), cor: c.texto3, align: 'right' });
        expTexto(ctx, fmt(l.atu), cols[2], cy + 15, { fonte: expFonte(12.5, 700), cor: c.texto, align: 'right' });
        expTexto(ctx, `${l.evo.toFixed(2)}%`, cols[3], cy + 15, {
            fonte: expFonte(12.5, 700),
            cor: l.evo > 0 ? c.pos : l.evo < 0 ? c.neg : c.texto3, align: 'right'
        });
        ctx.strokeStyle = c.linha; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, cy + 30.5); ctx.lineTo(x + w, cy + 30.5); ctx.stroke();
        cy += 30;
    });

    // linha de total / média
    const venceu = info.evoAdv !== null && info.evoTot > info.evoAdv;
    const perdeu = info.evoAdv !== null && info.evoTot < info.evoAdv;
    ctx.fillStyle = c.cabecalho; ctx.fillRect(x, cy, w, 34);
    if (venceu) { ctx.fillStyle = c.posBg; ctx.fillRect(cols[2] + 8, cy, x + w - cols[2] - 8, 34); }
    if (perdeu) { ctx.fillStyle = c.negBg; ctx.fillRect(cols[2] + 8, cy, x + w - cols[2] - 8, 34); }
    expTexto(ctx, info.rotuloTotal, cols[0], cy + 17, { fonte: expFonte(12.5, 800), cor: c.texto });
    expTexto(ctx, fmt(info.totAnt), cols[1], cy + 17, { fonte: expFonte(12.5, 700), cor: c.texto, align: 'right' });
    expTexto(ctx, fmt(info.totAtu), cols[2], cy + 17, { fonte: expFonte(12.5, 800), cor: c.texto, align: 'right' });
    expTexto(ctx, `${info.evoTot.toFixed(2)}%`, cols[3], cy + 17, {
        fonte: expFonte(13, 800),
        cor: venceu ? c.pos : perdeu ? c.neg : c.texto2, align: 'right'
    });
    cy += 34;

    if (info.faltaVirar !== null) {
        ctx.fillStyle = c.alertaBg; ctx.fillRect(x, cy, w, 30);
        expTexto(ctx, info.ehPct && info.rotuloTotal === 'MÉDIA' ? 'Falta p/ virar (média)' : 'Falta p/ virar',
            cols[0], cy + 15, { fonte: expFonte(11.5, 600), cor: c.alerta });
        expTexto(ctx, `+${fmt(info.faltaVirar)}`, cols[3], cy + 15,
            { fonte: expFonte(12.5, 800), cor: c.alerta, align: 'right' });
    }

    ctx.restore();
    ctx.strokeStyle = c.linha; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x + .5, y + .5, w - 1, alt - 1, 10) : ctx.rect(x + .5, y + .5, w - 1, alt - 1);
    ctx.stroke();
    return alt;
}

function expDesenharJogo(jogoData) {
    const { team1, team2, score, scoreAcumulado, dadosTeam1, dadosTeam2 } = jogoData;
    const semRes = semResultado(jogoData);
    const [s1, s2] = (!semRes && score && score.includes('x'))
        ? score.split('x').map(v => parseInt(v.trim())) : [0, 0];

    const indicadores = ordenarIndicadores(Object.keys(dadosTeam1 || {}));

    // Quem fez cada gol vem do resumo — é ele que aplica os desempates quando
    // a evolução das duas lojas empata.
    // O jogo pode chegar na ordem invertida (o card lidera com a loja do
    // distrito selecionado), então achamos nos dois sentidos e traduzimos o
    // lado de quem marcou.
    const resumo = (state.gamesSummary?.games || []).find(g =>
        (g.team1 === team1 && g.team2 === team2) || (g.team1 === team2 && g.team2 === team1)) || {};
    const invertido = resumo.team1 === team2;
    const golsResumo = semRes ? {} : (resumo.golsProjetados || {});
    const golEsq = invertido ? 2 : 1, golDir = invertido ? 1 : 2;
    const gols = {};
    Object.entries(golsResumo).forEach(([ind, v]) => {
        gols[ind] = v === golEsq ? 1 : v === golDir ? 2 : 0;
    });
    const larguraTab = (EXP.largura - EXP.pad * 2 - EXP.gap) / 2;

    // 1ª passada: medir
    const infos = indicadores.map(ind => ({
        ind,
        a: expLinhasIndicador(dadosTeam1[ind], dadosTeam2[ind]),
        b: expLinhasIndicador(dadosTeam2[ind], dadosTeam1[ind])
    }));
    const alturaCabecalho = 132;
    let altura = alturaCabecalho + EXP.pad;
    infos.forEach(i => {
        altura += Math.max(expAlturaTabela(i.a), expAlturaTabela(i.b)) + EXP.gap;
    });
    altura += 34;   // rodapé

    const cv = document.createElement('canvas');
    cv.width = EXP.largura * EXP.escala;
    cv.height = altura * EXP.escala;
    const ctx = cv.getContext('2d');
    ctx.scale(EXP.escala, EXP.escala);
    const c = EXP.cor;

    ctx.fillStyle = c.fundo;
    ctx.fillRect(0, 0, EXP.largura, altura);

    // ---- cabeçalho ----
    const grad = ctx.createLinearGradient(0, 0, EXP.largura, alturaCabecalho);
    grad.addColorStop(0, c.brand);
    grad.addColorStop(1, c.navy);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, EXP.largura, alturaCabecalho);

    expTexto(ctx, `CAMPEONATO PETZ 2026 · RODADA ${state.semana}`, EXP.largura / 2, 26,
        { fonte: expFonte(12, 700), cor: 'rgba(255,255,255,.75)', align: 'center' });
    expTexto(ctx, team1, EXP.largura * 0.22, 68, { fonte: expFonte(30, 800), cor: '#fff', align: 'center' });
    expTexto(ctx, team2, EXP.largura * 0.78, 68, { fonte: expFonte(30, 800), cor: '#fff', align: 'center' });
    expTexto(ctx, `${s1} × ${s2}`, EXP.largura / 2, 64, { fonte: expFonte(40, 800), cor: '#fff', align: 'center' });
    expTexto(ctx, semRes ? 'aguardando dados da rodada' : `acumulado ${semRes ? '0 x 0' : scoreAcumulado}`,
        EXP.largura / 2, 96, { fonte: expFonte(12.5, 600), cor: 'rgba(255,255,255,.7)', align: 'center' });

    let vencedor = '';
    if (!semRes && s1 !== s2) vencedor = `${s1 > s2 ? team1 : team2} está vencendo`;
    else if (!semRes) vencedor = 'empatando';
    if (vencedor) {
        expTexto(ctx, vencedor.toUpperCase(), EXP.largura / 2, 116,
            { fonte: expFonte(12, 700), cor: 'rgba(255,255,255,.85)', align: 'center' });
    }

    // ---- tabelas ----
    let y = alturaCabecalho + EXP.pad;
    infos.forEach(i => {
        expDesenhaTabela(ctx, EXP.pad, y, larguraTab, team1, i.ind, i.a, gols[i.ind] === 1);
        expDesenhaTabela(ctx, EXP.pad + larguraTab + EXP.gap, y, larguraTab, team2, i.ind, i.b, gols[i.ind] === 2);
        y += Math.max(expAlturaTabela(i.a), expAlturaTabela(i.b)) + EXP.gap;
    });

    const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    expTexto(ctx, `Gerado em ${agora}`, EXP.largura / 2, y + 4,
        { fonte: expFonte(11, 400), cor: c.texto3, align: 'center' });

    return cv;
}

async function exportarJogoImagem(team1, team2, btn) {
    const chave = `${team1}_${team2}`;
    const txt = btn ? btn.innerHTML : null;
    let avisou = false;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; btn.title = 'Copiando...'; }
    try {
        // O card do resumo não traz as tabelas; busca sob demanda.
        let jogoData = state.jogosCalculados[chave];
        if (!jogoData || jogoData.erro || !jogoData.dadosTeam1) {
            jogoData = await carregarDadosJogo({ team1, team2 });
            if (!jogoData || jogoData.erro) throw new Error('dados indisponíveis');
            state.jogosCalculados[chave] = jogoData;
        }
        const cv = expDesenharJogo(jogoData);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const nome = `${team1}-x-${team2}-rodada-${state.semana}.png`;
        const file = new File([blob], nome, { type: 'image/png' });

        // Copiar é a ação principal. Só se o navegador recusar é que caímos
        // para o compartilhamento nativo ou para o download.
        if (await expCopiarBlob(blob)) {
            expAviso(btn, '📋', 'Imagem copiada — cole no WhatsApp com Cmd+V.');
        } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: `${team1} x ${team2}` });
            expAviso(btn, '✅', 'Imagem compartilhada.');
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nome;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            expAviso(btn, '⬇️', 'O navegador não permitiu copiar — a imagem foi baixada.');
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;   // usuário cancelou
        console.error('Falha ao copiar a imagem:', e);
        alert('Não foi possível gerar a imagem.');
    } finally {
        // Não sobrescrever o ícone de confirmação que expAviso acabou de pôr.
        if (btn) { btn.disabled = false; if (!avisou) btn.innerHTML = txt; }
    }

    function expAviso(b, icone, mensagem) {
        avisou = true;
        if (b) {
            b.innerHTML = icone;
            setTimeout(() => { b.innerHTML = txt; }, 2200);
        }
        if (!mensagem) return;
        const infoBar = document.getElementById('infoBar');
        if (!infoBar) return;
        const antes = infoBar.innerHTML;
        infoBar.innerHTML = `<span>${icone} ${mensagem}</span>`;
        setTimeout(() => { if (infoBar.textContent.includes(mensagem)) infoBar.innerHTML = antes; }, 5000);
    }
}

async function expCopiarBlob(blob) {
    // Só PNG é aceito na área de transferência dos navegadores.
    try {
        if (!navigator.clipboard || !window.ClipboardItem) return false;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch (e) {
        console.warn('Não foi possível copiar a imagem:', e);
        return false;
    }
}

