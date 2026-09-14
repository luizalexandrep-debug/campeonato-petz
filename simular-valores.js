// ============================================================
// SIMULAR VALORES — "e se a loja vendesse outra coisa?"
//
// Deixa editar a venda de qualquer dia, dos dois lados, e recalcula na hora a
// evolução do dia, o total da semana, a evolução da semana e o placar do jogo.
// Nada é gravado: é tudo em cima do que já está carregado na janela.
// ============================================================

const sim = {
    ativo: false,
    valores: {},          // "LOJA|indicador|dia" -> valor digitado
    jogo: null            // dados do confronto aberto, para recalcular o placar
};

const simChave = (loja, ind, dia) => `${loja}|${ind}|${dia}`;

// A tela de grupos não tem criterioDoNome; o critério vem do próprio dado e,
// na falta dele, do marcador no nome do arquivo.
const SIM_MARCADORES_NIVEL = ['(ATUAL)', '(NIVEL)', '(NÍVEL)', '(SEM EVOLUCAO)', '(SEM EVOLUÇÃO)'];
function simCriterio(ind, bloco) {
    const c = bloco?.atual?.criterio || bloco?.anterior?.criterio;
    if (c) return c;
    const alvo = String(ind || '').toUpperCase();
    return SIM_MARCADORES_NIVEL.some(m => alvo.includes(m)) ? 'nivel' : 'evolucao';
}

/* Valor de um dia. Só a SEMANA ATUAL é editável — a anterior é a base de
   comparação e não muda. Com `original`, ignora o que foi simulado. */
function simValor(loja, ind, dia, dias, slot, original) {
    if (slot === 'atual' && !original) {
        const k = simChave(loja, ind, dia);
        if (k in sim.valores) return sim.valores[k];
    }
    return (dias || {})[dia] || 0;
}

function simTemEdicao(loja, ind) {
    const pref = `${loja}|${ind}|`;
    return Object.keys(sim.valores).some(k => k.startsWith(pref));
}

function simLimpar() {
    sim.valores = {};
    if (sim.redesenhar) sim.redesenhar();
}

/* Total da semana de um lado. Em R$ é soma; em % é a média dos dias com dado.
   Enquanto não há edição, o % usa a coluna 'Total' da planilha, que é o número
   oficial (receita/receita). Editado um dia, essa coluna deixa de valer — o
   total passa a ser a média dos dias, e a tela avisa. */
function simTotal(loja, ind, bloco, ehPct, slot, original) {
    const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const dias = bloco?.dias;
    if (!ehPct) {
        return DIAS.reduce((t, d) => t + simValor(loja, ind, d, dias, slot, original), 0);
    }
    const mexido = slot === 'atual' && !original && simTemEdicao(loja, ind);
    if (!mexido) return agregarPct(dias, DIAS);
    const vals = DIAS.map(d => simValor(loja, ind, d, dias, slot, original)).filter(v => v);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

/* Quem faz o gol de um indicador, com os valores em vigor.
   Mesma cascata do backend: evolução, depois valor da semana, depois o da
   anterior. No critério 'nível' vence o maior valor da semana. */
function simVencedor(ind, d1, d2, t1, t2) {
    if (!d1 || !d2) return 0;
    const ehPct = (d1.atual?.type || d1.anterior?.type || 'R$') === '%';
    const nivel = simCriterio(ind, d1) === 'nivel';
    const at1 = simTotal(t1, ind, d1.atual, ehPct, 'atual');
    const at2 = simTotal(t2, ind, d2.atual, ehPct, 'atual');
    if (nivel) return at1 > at2 ? 1 : at2 > at1 ? 2 : 0;
    const an1 = simTotal(t1, ind, d1.anterior, ehPct, 'anterior');
    const an2 = simTotal(t2, ind, d2.anterior, ehPct, 'anterior');
    const e1 = evolucaoPct(an1, at1), e2 = evolucaoPct(an2, at2);
    if (e1 !== e2) return e1 > e2 ? 1 : 2;
    if (at1 !== at2) return at1 > at2 ? 1 : 2;
    if (an1 !== an2) return an1 > an2 ? 1 : 2;
    return 0;
}

/* Placar do jogo com os valores em vigor: {gols, g1, g2}. */
function simPlacar() {
    const j = sim.jogo;
    const gols = {}; let g1 = 0, g2 = 0;
    if (!j) return { gols, g1, g2 };
    Object.keys(j.dadosTeam1 || {}).forEach(ind => {
        const v = simVencedor(ind, j.dadosTeam1[ind], j.dadosTeam2[ind], j.team1, j.team2);
        gols[ind] = v;
        if (v === 1) g1++; else if (v === 2) g2++;
    });
    return { gols, g1, g2 };
}


/* ---------- peças de tela, compartilhadas pelas duas páginas ---------- */

/* Campo editável de um dia, com o ↺ ao lado quando o valor foi mexido. */
function simCampo(loja, ind, dia, valor, fmt) {
    if (!sim.ativo) return fmt(valor);
    const editado = simChave(loja, ind, dia) in sim.valores;
    return `<span class="sim-cel">
        <input class="sim-campo${editado ? ' editado' : ''}" type="number" step="0.01"
               value="${valor}" data-loja="${loja}" data-ind="${ind}" data-dia="${dia}"
               aria-label="${loja} · ${dia}">
        ${editado ? `<button class="sim-desfazer" data-desfazer="${loja}|${ind}|${dia}"
            title="Voltar ao valor original">↺</button>` : ''}
    </span>`;
}

/* Barra explicativa no topo do corpo do modal. `placarOficial` só é passado
   quando a rodada já está encerrada e o placar da tela é o oficial. */
function simBarra(placarOficial) {
    if (!sim.ativo) return '';
    const n = Object.keys(sim.valores).length;
    return `<div class="sim-barra">
        <b>🧪 Simulação de valores.</b> Edite a venda de qualquer dia, dos dois lados,
        e o placar lá em cima se refaz sozinho.
        ${n ? `<button class="sim-limpar" onclick="simLimpar()">↺ Voltar aos valores reais (${n})</button>` : ''}
        ${placarOficial ? `<div class="sim-nota">Atenção: o placar oficial desta rodada é
            <b>${placarOficial}</b>. A simulação trabalha sobre o cálculo das planilhas de
            venda, que pode dar outro resultado — serve para entender o efeito dos números,
            não para reescrever o placar oficial.</div>` : ''}
        <div class="sim-nota">Nada é gravado. Em indicadores percentuais, a linha final passa
            a ser a média dos dias assim que você edita — a coluna “Total” da planilha é
            receita sobre receita e não sai dos dias.</div>
    </div>`;
}

/* Liga o simulador a uma janela de detalhe do jogo.
   `ctx`: { fundo, corpo, jogo:{team1,team2,dadosTeam1,dadosTeam2}, desenhar } */
function simInstalar(ctx) {
    sim.ativo = false;
    sim.valores = {};
    sim.jogo = ctx.jogo;
    sim.redesenhar = ctx.desenhar;

    const nums = () => ctx.fundo.querySelectorAll('.placar-nums .pl-num');
    const placarOriginal = [...nums()].map(n => n.textContent);
    const rotulo = ctx.fundo.querySelector('.placar small');
    const rotuloOriginal = rotulo ? rotulo.textContent : '';

    // simPlacar() conta na ordem da janela (team1 é o time da esquerda).
    sim.pintarPlacar = (p) => {
        const ns = nums();
        if (ns.length === 2) { ns[0].textContent = p.g1; ns[1].textContent = p.g2; }
        if (rotulo) rotulo.textContent = 'Placar simulado';
    };
    const restaurar = () => {
        const ns = nums();
        placarOriginal.forEach((v, i) => { if (ns[i]) ns[i].textContent = v; });
        if (rotulo) rotulo.textContent = rotuloOriginal;
    };

    // O cabeçalho centraliza o placar e põe os botões por cima, à direita. A
    // reserva de espaço precisa ser a largura real deles — fixa no CSS, ela
    // ficava curta a cada botão novo e o nome do time passava por baixo.
    const ajustarReserva = () => {
        const t = ctx.fundo.querySelector('.modal-jogo .times');
        const a = ctx.fundo.querySelector('.modal-acoes');
        if (t && a && a.offsetWidth) {
            // Direto no elemento: as duas páginas têm folhas de estilo com
            // reservas diferentes para esta mesma regra, e o inline não depende
            // de qual delas vence.
            const px = (a.offsetWidth + 30) + 'px';
            t.style.paddingLeft = px;
            t.style.paddingRight = px;
        }
    };
    ajustarReserva();
    window.addEventListener('resize', ajustarReserva);

    const bt = ctx.fundo.querySelector('#btSimular');
    if (bt) bt.onclick = () => {
        sim.ativo = !sim.ativo;
        bt.textContent = sim.ativo ? '✕ Fechar simulação' : '🧪 Simular valores';
        bt.classList.toggle('ativo', sim.ativo);
        if (!sim.ativo) sim.valores = {};
        ajustarReserva();          // o texto do botão muda de tamanho
        ctx.desenhar();
        if (!sim.ativo) restaurar();
    };

    const aplicar = (campo) => {
        const v = parseFloat(campo.value);
        if (isNaN(v)) return;              // campo vazio no meio da digitação
        const { loja, ind, dia } = campo.dataset;
        const j = sim.jogo;
        const bloco = (loja === j.team1 ? j.dadosTeam1 : j.dadosTeam2)[ind];
        const original = (bloco?.atual?.dias || {})[dia] || 0;
        const k = simChave(loja, ind, dia);
        if (v === original) delete sim.valores[k]; else sim.valores[k] = v;
        const pos = campo.selectionStart;
        ctx.desenhar();
        const novo = ctx.corpo.querySelector(
            `.sim-campo[data-loja="${loja}"][data-ind="${ind}"][data-dia="${dia}"]`);
        if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (_) {} }
    };

    ctx.corpo.addEventListener('input', (e) => {
        const c = e.target.closest('.sim-campo');
        if (c) aplicar(c);
    });
    ctx.corpo.addEventListener('click', (e) => {
        const d = e.target.closest('.sim-desfazer');
        if (!d) return;
        delete sim.valores[d.dataset.desfazer];
        ctx.desenhar();
    });
}
