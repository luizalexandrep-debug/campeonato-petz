// ============================================================
// PROTÓTIPO — jogos agrupados por resultado + janela de detalhes
// Usa os MESMOS endpoints e as MESMAS regras do dashboard atual.
// Página isolada: nada aqui é carregado pelo dashboard-v3.
// ============================================================

const state = {
    semana: null, semanaVigente: null, semanasDisponiveis: [],
    estrutura: {}, gamesSummary: null,
    regional: '', distrito: '',
    jogosCalculados: {}     // usado por exportar-imagem.js
};

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const CHAVE_TOTAL = '__total__';
const DIAS_SEMANA = DIAS;

// ---- regras compartilhadas (idênticas ao dashboard) ----
function semResultado(j) {
    return !!(j && j.semDados) || !!(state.gamesSummary && state.gamesSummary.semDadosAtual);
}

function evolucaoPct(anterior, atual) {
    if (anterior === 0) return 0;
    if (atual === 0) return 0;
    return (atual - anterior) / anterior * 100;
}

function agregarPct(diasObj, diasAcontar) {
    const o = diasObj || {};
    if (o[CHAVE_TOTAL]) return o[CHAVE_TOTAL];
    const vals = diasAcontar.map(d => o[d] || 0).filter(v => v);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function formatarPercentual(v) {
    return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function formatarValor(v, tipo) {
    return tipo === '%' ? formatarPercentual(v)
        : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

// Nome próprio: 'api' já é usado por api-config.js e a colisão de const
// quebrava o arquivo inteiro na hora de interpretar.
const apiGet = (p) => fetch(`/api${p}`, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
});

// ---- exportar-imagem.js espera esta função ----
async function carregarDadosJogo(jogo) {
    try {
        const [d1, d2] = await Promise.all([
            apiGet(`/loja-dias/${jogo.team1}/${state.semana}`),
            apiGet(`/loja-dias/${jogo.team2}/${state.semana}`)
        ]);
        const resumo = (state.gamesSummary?.games || [])
            .find(g => g.team1 === jogo.team1 && g.team2 === jogo.team2) || {};
        return {
            team1: jogo.team1, team2: jogo.team2,
            score: resumo.scoreProjected || '0 x 0',
            scoreAcumulado: resumo.scoreAccumulated || '0 x 0',
            semDados: !!resumo.semDados,
            hojeIdx: d1.hoje_idx,
            dadosTeam1: d1.dados, dadosTeam2: d2.dados
        };
    } catch (e) {
        console.error('Falha ao carregar jogo:', e);
        return { team1: jogo.team1, team2: jogo.team2, erro: true };
    }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', iniciar);

async function iniciar() {
    try {
        const me = await fetch('/api/me', { cache: 'no-store' });
        if (!me.ok) { location.href = '/login.html'; return; }

        const sem = await apiGet('/semana');
        state.semanaVigente = sem.semana;
        state.semana = sem.semana;
        state.semanasDisponiveis = sem.disponiveis || [sem.semana];

        const est = await apiGet('/estrutura');
        state.estrutura = est.estrutura || est;

        montarSelects();
        await carregarResumo();
        render();
    } catch (e) {
        console.error(e);
        info(`❌ Erro ao iniciar: ${e.message}`);
    }
}

function info(html) {
    document.getElementById('infoBar').innerHTML = `<span>${html}</span>`;
}

function montarSelects() {
    const sSem = document.getElementById('fSemana');
    sSem.innerHTML = state.semanasDisponiveis.slice().sort((a, b) => b - a)
        .map(n => `<option value="${n}"${n === state.semana ? ' selected' : ''}>Rodada ${n}${n === state.semanaVigente ? ' (atual)' : ''}</option>`).join('');
    sSem.onchange = async (e) => {
        state.semana = parseInt(e.target.value, 10);
        state.jogosCalculados = {};
        info('⏳ Carregando rodada...');
        await carregarResumo();
        render();
    };

    const sReg = document.getElementById('fRegional');
    sReg.innerHTML = '<option value="">Selecione uma Regional...</option>'
        + Object.keys(state.estrutura).map(r => `<option value="${r}">${r}</option>`).join('');
    sReg.onchange = (e) => {
        state.regional = e.target.value;
        state.distrito = '';
        const sDist = document.getElementById('fDistrito');
        sDist.disabled = !state.regional;
        sDist.innerHTML = '<option value="">Selecione um Distrito...</option>'
            + (state.regional ? Object.keys(state.estrutura[state.regional])
                .map(d => `<option value="${d}">${d}</option>`).join('') : '');
        render();
    };

    document.getElementById('fDistrito').onchange = (e) => {
        state.distrito = e.target.value;
        render();
    };
}

async function carregarResumo() {
    state.gamesSummary = await apiGet(`/games-summary/${state.semana}`);
}

// ============================================================
// RENDER — três colunas por resultado
// ============================================================
function lojasDoFiltro() {
    if (state.distrito) return state.estrutura[state.regional][state.distrito];
    if (state.regional) {
        return Object.values(state.estrutura[state.regional]).flat();
    }
    return null;
}

function render() {
    const painel = document.getElementById('painel');
    const lojas = lojasDoFiltro();

    if (!lojas) {
        painel.innerHTML = '';
        info('👆 Escolha uma regional e um distrito para ver os jogos agrupados por resultado.');
        return;
    }

    const todos = state.gamesSummary?.games || [];
    const jogos = todos.filter(g => lojas.includes(g.team1) || lojas.includes(g.team2));

    if (!jogos.length) {
        painel.innerHTML = '';
        info(`ℹ️ Nenhum jogo encontrado para ${state.distrito || state.regional}.`);
        return;
    }

    const grupos = { v: [], e: [], d: [] };
    jogos.forEach(g => {
        const [s1, s2] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        const minha = lojas.includes(g.team1) ? g.team1 : g.team2;
        const eu = minha === g.team1 ? s1 : s2;
        const adv = minha === g.team1 ? s2 : s1;
        const item = { ...g, minha, eu, adv };
        if (semResultado(g)) grupos.e.push(item);
        else if (eu > adv) grupos.v.push(item);
        else if (eu < adv) grupos.d.push(item);
        else grupos.e.push(item);
    });

    const aviso = (state.gamesSummary?.avisos || [])
        .map(a => `<div class="alerta-info" style="margin-bottom:14px"><b>${a.indicador}</b> — ${a.mensagem}</div>`).join('');

    const cols = [
        ['v', '✅ Vitórias'],
        ['e', semResultado({}) ? '⏳ Sem resultado' : '⚖️ Empates'],
        ['d', '❌ Derrotas']
    ].map(([k, titulo]) => `
        <div class="col-res ${k}">
            <div class="col-res-head"><span>${titulo}</span><span class="n">${grupos[k].length}</span></div>
            <div class="lista">
                ${grupos[k].length ? grupos[k].map(cardHtml).join('') : '<div class="vazio">nenhum jogo</div>'}
            </div>
        </div>`).join('');

    painel.innerHTML = aviso + `<div class="colunas-resultado">${cols}</div>`;
    info(`📊 ${jogos.length} jogos · ${state.distrito || state.regional} · rodada ${state.semana}`);
}

function cardHtml(g) {
    return `
    <div class="jogo-card" onclick="abrirDetalhes('${g.team1}','${g.team2}')">
        <div class="lados">
            <span class="sig">${g.team1}</span>
            <span class="meio">
                <span class="rot">Placar Projetado</span>
                <span class="placar">${g.scoreProjected.replace('x', '×')}</span>
                <span class="acum">Acumulado ${g.scoreAccumulated}</span>
            </span>
            <span class="sig">${g.team2}</span>
        </div>
        <button class="btn-exportar" title="Exportar imagem"
            onclick="event.stopPropagation(); exportarJogoImagem('${g.team1}','${g.team2}', this)">🖼️</button>
        <span style="color:var(--text-3)">🔍</span>
    </div>`;
}

// ============================================================
// JANELA DE DETALHES
// ============================================================
async function abrirDetalhes(team1, team2) {
    const resumo = (state.gamesSummary?.games || [])
        .find(g => g.team1 === team1 && g.team2 === team2) || {};

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-jogo">
            <div class="modal-head">
                <div class="times">
                    <span class="t">${team1}</span>
                    <span class="placar">
                        <small>Placar Projetado</small>
                        <b>${(resumo.scoreProjected || '0 x 0').replace('x', '×')}</b>
                        <small>Acumulado ${resumo.scoreAccumulated || '0 x 0'}</small>
                    </span>
                    <span class="t">${team2}</span>
                </div>
                <div class="modal-acoes">
                    <button class="modal-btn" id="btExp">🖼️ Exportar imagem</button>
                    <button class="modal-btn" data-fechar>✕ Fechar</button>
                </div>
            </div>
            <div class="modal-corpo"><div class="carregando">⏳ Carregando indicadores...</div></div>
        </div>`;

    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);

    const chave = `${team1}_${team2}`;
    let jogo = state.jogosCalculados[chave];
    if (!jogo || jogo.erro || !jogo.dadosTeam1) {
        jogo = await carregarDadosJogo({ team1, team2 });
        state.jogosCalculados[chave] = jogo;
    }

    const corpo = fundo.querySelector('.modal-corpo');
    if (jogo.erro) { corpo.innerHTML = '<div class="carregando">❌ Não foi possível carregar os indicadores.</div>'; return; }

    corpo.innerHTML = Object.keys(jogo.dadosTeam1).map(ind => `
        <div class="tables-wrapper">
            ${tabelaIndicador(team1, jogo.dadosTeam1[ind], ind, jogo.dadosTeam2[ind])}
            ${tabelaIndicador(team2, jogo.dadosTeam2[ind], ind, jogo.dadosTeam1[ind])}
        </div>`).join('');

    fundo.querySelector('#btExp').onclick = (e) => exportarJogoImagem(team1, team2, e.currentTarget);
}

function tabelaIndicador(loja, dados, indicador, adversario) {
    if (!dados) return '<div class="table-container"><div class="table-title">Sem dados</div></div>';

    const tipo = dados.atual?.type || dados.anterior?.type || 'R$';
    const ehPct = tipo === '%';
    const fmt = (v) => formatarValor(v, tipo);
    const diasAnt = dados.anterior?.dias || {};
    const diasAtu = dados.atual?.dias || {};
    const agregar = (o) => ehPct ? agregarPct(o, DIAS)
        : DIAS.reduce((a, d) => a + ((o || {})[d] || 0), 0);
    const usaTotal = ehPct && !!(diasAtu[CHAVE_TOTAL] || diasAnt[CHAVE_TOTAL]);

    const linhas = DIAS.map(dia => {
        const a = diasAnt[dia] || 0, b = diasAtu[dia] || 0;
        const ev = evolucaoPct(a, b);
        const cls = ev > 0 ? 'positive' : ev < 0 ? 'negative' : 'neutral';
        return `<tr><td class="day-label">${dia}</td>
            <td class="value-anterior">${fmt(a)}</td>
            <td class="value-atual">${fmt(b)}</td>
            <td class="evolution ${cls}">${ev.toFixed(2)}%</td></tr>`;
    }).join('');

    const totAnt = agregar(diasAnt), totAtu = agregar(diasAtu);
    const evoTot = evolucaoPct(totAnt, totAtu);

    let classe = evoTot > 0 ? 'positive' : evoTot < 0 ? 'negative' : 'neutral';
    let falta = null;
    if (adversario) {
        const evoAdv = evolucaoPct(agregar(adversario.anterior?.dias), agregar(adversario.atual?.dias));
        if (evoTot > evoAdv) classe = 'evolution-melhor';
        else if (evoTot < evoAdv) {
            classe = 'evolution-pior';
            if (totAnt > 0) {
                const f = totAnt * (1 + evoAdv / 100) - totAtu;
                if (f > 0) falta = f;
            }
        }
    }

    return `<div class="table-container">
        <div class="table-title"><span class="tt-loja">${loja}</span><span class="tt-ind">${indicador.replace(/\.xlsx$/i, '')}</span></div>
        <table>
            <thead><tr><th>Dia</th><th>S. Anterior</th><th>S. Atual</th><th>Evolução</th></tr></thead>
            <tbody>
                ${linhas}
                <tr class="total-row">
                    <td class="day-label">${ehPct && !usaTotal ? 'MÉDIA' : 'TOTAL'}</td>
                    <td style="text-align:center">${fmt(totAnt)}</td>
                    <td style="text-align:center">${fmt(totAtu)}</td>
                    <td class="evolution ${classe}" style="text-align:center">${evoTot.toFixed(2)}%</td>
                </tr>
                ${falta !== null ? `<tr><td colspan="3" style="background:#fff3cd;color:#6b4d00;font-size:.85em">
                    ${ehPct && !usaTotal ? 'Falta p/ virar (média)' : 'Falta p/ virar'}</td>
                    <td style="background:#fff3cd;color:#6b4d00;font-weight:800;text-align:center">+${fmt(falta)}</td></tr>` : ''}
            </tbody>
        </table></div>`;
}
