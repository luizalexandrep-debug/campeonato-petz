/**
 * Dashboard V3 - Visualização por Tabelas
 * Mostra confrontos de uma semana com dados dia a dia
 */

const state = {
    estrutura: {},
    confrontos: [],
    currentRegional: null,
    currentDistrito: null,
    semana: 4,
    jogosCalculados: {}, // Cache dos jogos já calculados
    todoCalculado: false, // Flag indicando se todos os jogos foram calculados
    jogosComDadosAtual: [], // Jogos do distrito/regional atual
    filtroResultado: null, // Filtro de resultado: 'vitoria', 'empate', 'derrota', null
    gamesSummary: null, // Resumo pré-calculado de todos os jogos
    resumoCarregado: false, // Flag indicando se o resumo foi carregado
    historico: null, // Histórico das rodadas anteriores (ranking simulado)
    modoSimulado: false // Flag: exibindo o ranking simulado
};

const REGIONAL_DESTAQUE = 'R2 - Luiz';

// ============================================================
// UTILIDADES
// ============================================================

function formatarMoedaBR(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor);
}

// ============================================================
// FUNÇÕES DE ESTATÍSTICAS
// ============================================================

function calcularEstatisticas(jogosComDados, lojas) {
    let vitórias = 0, empates = 0, derrotas = 0;
    const resultadosPorGol = {}; // Rastrear resultado por indicador

    jogosComDados.forEach(jogoData => {
        if (jogoData.erro) return;

        const [score1, score2] = jogoData.score && jogoData.score.includes('x')
            ? jogoData.score.split('x').map(s => parseInt(s.trim()))
            : [0, 0];

        const lojaDoDistrito = lojas.includes(jogoData.team1) ? jogoData.team1 : jogoData.team2;
        const isTeam1 = lojaDoDistrito === jogoData.team1;
        const scoreDistrito = isTeam1 ? score1 : score2;
        const scoreAdversário = isTeam1 ? score2 : score1;

        if (scoreDistrito > scoreAdversário) {
            vitórias++;
        } else if (scoreDistrito < scoreAdversário) {
            derrotas++;
        } else {
            empates++;
        }
    });

    const totalJogos = vitórias + empates + derrotas;
    const pontuacaoTotal = (vitórias * 3) + (empates * 1) + (derrotas * 0);
    const mediaJogos = totalJogos > 0 ? pontuacaoTotal / totalJogos : 0;
    const aproveitamento = totalJogos > 0 ? (pontuacaoTotal / (totalJogos * 3)) * 100 : 0;

    return {
        vitórias,
        empates,
        derrotas,
        totalJogos,
        pontuacaoTotal,
        mediaJogos,
        aproveitamento
    };
}

function calcularAnalisePorGol(jogosComDados, lojas) {
    const analise = {};

    jogosComDados.forEach(jogoData => {
        if (jogoData.erro) return;

        const lojaDoDistrito = lojas.includes(jogoData.team1) ? jogoData.team1 : jogoData.team2;
        const isTeam1 = lojaDoDistrito === jogoData.team1;

        // Iterar sobre cada indicador (gol)
        Object.keys(jogoData.dadosTeam1 || {}).forEach(indicador => {
            if (!analise[indicador]) {
                analise[indicador] = { vitórias: 0, derrotas: 0, empates: 0, total: 0 };
            }

            const dados1 = jogoData.dadosTeam1[indicador];
            const dados2 = jogoData.dadosTeam2[indicador];

            if (dados1 && dados2) {
                const total1Anterior = Object.values(dados1.anterior?.dias || {}).reduce((a, b) => a + b, 0);
                const total1Atual = Object.values(dados1.atual?.dias || {}).reduce((a, b) => a + b, 0);
                const total2Anterior = Object.values(dados2.anterior?.dias || {}).reduce((a, b) => a + b, 0);
                const total2Atual = Object.values(dados2.atual?.dias || {}).reduce((a, b) => a + b, 0);

                const evolucao1 = total1Anterior !== 0 ? ((total1Atual - total1Anterior) / total1Anterior * 100) : 0;
                const evolucao2 = total2Anterior !== 0 ? ((total2Atual - total2Anterior) / total2Anterior * 100) : 0;

                analise[indicador].total++;

                if (isTeam1) {
                    if (evolucao1 > evolucao2) analise[indicador].vitórias++;
                    else if (evolucao1 < evolucao2) analise[indicador].derrotas++;
                    else analise[indicador].empates++;
                } else {
                    if (evolucao2 > evolucao1) analise[indicador].vitórias++;
                    else if (evolucao2 < evolucao1) analise[indicador].derrotas++;
                    else analise[indicador].empates++;
                }
            }
        });
    });

    return analise;
}

function calcularAnaliseDoResumo(jogosFiltrados, lojas) {
    /**
     * Análise por gol a partir do resumo pré-calculado, usando o vencedor REAL
     * de cada indicador (golsProjetados: {arquivo: 1=team1, 2=team2, 0=empate}).
     * Conta cada loja do grupo (distrito ou regional) separadamente — inclusive
     * quando os dois times do jogo pertencem ao grupo.
     */
    const analise = {};
    jogosFiltrados.forEach(gameData => {
        const gols = gameData.golsProjetados || {};
        [[gameData.team1, 1], [gameData.team2, 2]].forEach(([team, teamNum]) => {
            if (!lojas.includes(team)) return;
            Object.entries(gols).forEach(([ind, vencedor]) => {
                if (!analise[ind]) {
                    analise[ind] = { vitórias: 0, derrotas: 0, empates: 0, total: 0 };
                }
                if (vencedor === teamNum) analise[ind].vitórias++;
                else if (vencedor === 0) analise[ind].empates++;
                else analise[ind].derrotas++;
                analise[ind].total++;
            });
        });
    });
    return analise;
}

// ============================================================
// CÁLCULO DO PLACAR (LOCAL, SEM HTTP)
// ============================================================

function calcularPlacarLocal(dadosTeam1, dadosTeam2, hojeIdx = null) {
    /**
     * Calcula o placar comparando a evolução percentual dos indicadores.
     * Para cada indicador, compara: (total_atual - total_anterior) / total_anterior * 100
     * Time com maior evolução percentual = 1 ponto.
     *
     * Se hojeIdx for fornecido, calcula placar acumulado (até hoje).
     * Caso contrário, calcula placar projetado (semana completa).
     */
    let score1 = 0, score2 = 0;

    const diasOrdenados = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const indicadores = Object.keys(dadosTeam1);

    indicadores.forEach(indicador => {
        const dados1 = dadosTeam1[indicador];
        const dados2 = dadosTeam2[indicador];

        if (!dados1 || !dados2) return;

        // Extrair valores dias
        const dias1Anterior = dados1.anterior?.dias || {};
        const dias1Atual = dados1.atual?.dias || {};
        const dias2Anterior = dados2.anterior?.dias || {};
        const dias2Atual = dados2.atual?.dias || {};

        // Se hojeIdx for definido, somar apenas até hoje
        const diasAcontar = hojeIdx !== null
            ? diasOrdenados.slice(0, hojeIdx + 1)
            : diasOrdenados;

        // Calcular evolução em valores absolutos
        let total1Anterior = 0, total1Atual = 0;
        diasAcontar.forEach(dia => {
            total1Anterior += dias1Anterior[dia] || 0;
            total1Atual += dias1Atual[dia] || 0;
        });

        let total2Anterior = 0, total2Atual = 0;
        diasAcontar.forEach(dia => {
            total2Anterior += dias2Anterior[dia] || 0;
            total2Atual += dias2Atual[dia] || 0;
        });

        // Calcular evolução percentual
        const evolucao1Pct = total1Anterior !== 0
            ? ((total1Atual - total1Anterior) / total1Anterior * 100)
            : 0;
        const evolucao2Pct = total2Anterior !== 0
            ? ((total2Atual - total2Anterior) / total2Anterior * 100)
            : 0;

        // Quem evoluiu mais percentualmente = 1 ponto
        if (evolucao1Pct > evolucao2Pct) {
            score1 += 1;
        } else if (evolucao2Pct > evolucao1Pct) {
            score2 += 1;
        }
    });

    return { score1, score2, score: `${score1} x ${score2}` };
}

// ============================================================
// AUTENTICAÇÃO
// ============================================================

async function checkAuthentication() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json();

        if (!data.user) {
            // Não autenticado, redirecionar para login
            window.location.href = '/login.html';
            return;
        }

        // Mostrar informações do usuário
        const userInfo = document.getElementById('userInfo');
        userInfo.textContent = `👤 ${data.user.nome_completo || data.user.username}`;

        // Mostrar link de admin se for admin
        if (data.user.é_admin) {
            document.getElementById('adminLink').style.display = 'inline-block';
        }

        // Armazenar usuário no localStorage
        localStorage.setItem('user', JSON.stringify(data.user));
    } catch (error) {
        console.error('Erro ao verificar autenticação:', error);
        window.location.href = '/login.html';
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        localStorage.removeItem('user');
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
    }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    try {
        // Verificar autenticação
        await checkAuthentication();

        // Carregar estrutura
        await loadEstrutura();

        // Carregar histórico (rodadas anteriores) para o ranking simulado
        await loadHistorico();

        // Carregar confrontos
        await loadConfrontos();

        // Carregar resumo de jogos pré-calculado (em background)
        carregarResumJogos();

        // Attach listeners
        document.getElementById('filterRegional').addEventListener('change', onRegionalChange);
        document.getElementById('filterDistrito').addEventListener('change', onDistritoChange);
        document.getElementById('reprocessarBtn').addEventListener('click', reprocessarDoSharePoint);
        document.getElementById('simuladoBtn').addEventListener('click', toggleRankingSimulado);
        document.getElementById('inicioBtn').addEventListener('click', voltarDashboard);
        document.getElementById('logoutBtn').addEventListener('click', logout);

        // Event listeners para filtro de estatísticas
        document.getElementById('statVitorias').addEventListener('click', () => onFiltroEstatísticas('vitoria'));
        document.getElementById('statEmpates').addEventListener('click', () => onFiltroEstatísticas('empate'));
        document.getElementById('statDerrotas').addEventListener('click', () => onFiltroEstatísticas('derrota'));

    } catch (error) {
        console.error('Erro ao inicializar:', error);
    }
}

async function carregarResumJogos() {
    try {
        console.log('📦 Carregando resumo de jogos...');
        const response = await fetch(`/api/games-summary/${state.semana}`, { cache: 'no-store' });
        const data = await response.json();
        state.gamesSummary = data;
        state.resumoCarregado = true;
        console.log(`✅ ${data.total} jogos carregados em cache!`);

        // Se nenhuma regional foi selecionada, mostrar dashboard de rankings
        if (!state.currentRegional) {
            console.log('📊 Mostrando dashboard de rankings');
            loadRankingDashboard();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar resumo de jogos:', error);
        state.resumoCarregado = false;
    }
}

async function reprocessarDoSharePoint() {
    const btn = document.getElementById('reprocessarBtn');
    const infoBar = document.getElementById('infoBar');
    const textoOriginal = btn.innerHTML;

    // Confirmar
    if (!confirm('Isso vai baixar os dados mais recentes do SharePoint e recalcular todos os jogos. Pode levar até 30 segundos. Continuar?')) {
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '⏳ Reprocessando...';
    const infoOriginal = infoBar.innerHTML;
    infoBar.innerHTML = '<span>⏳ Baixando dados do SharePoint e recalculando... (até 30s)</span>';

    try {
        const response = await fetch(`/api/reprocessar/${state.semana}`, { method: 'POST' });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        // Recarregar o resumo recalculado
        state.resumoCarregado = false;
        state.gamesSummary = null;
        state.todoCalculado = false;
        state.jogosCalculados = {};
        await carregarResumJogos();

        const dias = (data.dias_semana_atual || []).join(', ');
        infoBar.innerHTML = `<span>✅ Dados atualizados! ${data.total} jogos recalculados. Dias na semana atual: ${dias || '—'}</span>`;

        // Reexibir a visão atual (regional/distrito) com os dados novos
        loadGames();
    } catch (error) {
        console.error('Erro ao reprocessar:', error);
        infoBar.innerHTML = `<span style="color:#c0392b;">❌ Erro ao reprocessar: ${error.message}</span>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

function onFiltroEstatísticas(resultado) {
    const container = document.getElementById('gamesContainer');
    const lojas = state.estrutura[state.currentRegional][state.currentDistrito];

    // Toggle filtro (se clicar novamente, remove o filtro)
    if (state.filtroResultado === resultado) {
        state.filtroResultado = null;
        // Remover classe active de todos os items
        document.querySelectorAll('.stat-item.clickable').forEach(el => el.classList.remove('active'));
    } else {
        state.filtroResultado = resultado;
        // Adicionar classe active apenas ao selecionado
        document.querySelectorAll('.stat-item.clickable').forEach(el => el.classList.remove('active'));
        if (resultado === 'vitoria') {
            document.getElementById('statVitorias').classList.add('active');
        } else if (resultado === 'empate') {
            document.getElementById('statEmpates').classList.add('active');
        } else if (resultado === 'derrota') {
            document.getElementById('statDerrotas').classList.add('active');
        }
    }

    // Aplicar ou remover filtro sem recarregar dados
    const jogosFinal = state.filtroResultado
        ? filtrarJogosPorResultado(state.jogosComDadosAtual, lojas, state.filtroResultado)
        : state.jogosComDadosAtual;

    container.innerHTML = '';
    jogosFinal.forEach(jogoData => {
        try {
            if (jogoData.erro) {
                console.log(`Pulando jogo ${jogoData.team1} vs ${jogoData.team2} (erro ao carregar dados)`);
                return;
            }
            const card = criarCardJogo(jogoData, lojas);
            container.appendChild(card);
        } catch (error) {
            console.error(`Erro ao renderizar jogo ${jogoData.team1} vs ${jogoData.team2}:`, error);
        }
    });
}

// ============================================================
// CARREGAR ESTRUTURA
// ============================================================

async function loadEstrutura() {
    try {
        const response = await fetch('estrutura.json');
        state.estrutura = await response.json();
        populateRegionalFilter();
    } catch (error) {
        console.error('Erro ao carregar estrutura:', error);
    }
}

async function loadHistorico() {
    try {
        const response = await fetch('historico.json');
        state.historico = await response.json();
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        state.historico = null;
    }
}

// ============================================================
// RANKING SIMULADO (histórico rodadas anteriores + rodada atual)
// ============================================================

function calcularRankingSimulado() {
    // Retorna array por distrito com pontos históricos + atuais combinados.
    const hist = state.historico;
    const rodadasAnt = hist ? hist.rodadasAnteriores : 0;

    // Mapa loja -> {regional, distrito}
    const loja2dist = {};
    const N = {}; // nº de lojas por distrito
    Object.keys(state.estrutura).forEach(reg => {
        Object.keys(state.estrutura[reg]).forEach(dist => {
            const lojas = state.estrutura[reg][dist];
            N[dist] = lojas.length;
            lojas.forEach(l => { loja2dist[l] = { regional: reg, distrito: dist }; });
        });
    });

    // Pontos/jogos da rodada atual por distrito (a partir do resumo)
    const curPts = {}, curGm = {};
    Object.keys(N).forEach(d => { curPts[d] = 0; curGm[d] = 0; });
    (state.gamesSummary?.games || []).forEach(g => {
        const [s1, s2] = g.scoreProjected.split('x').map(s => parseInt(s.trim()));
        [[g.team1, s1, s2], [g.team2, s2, s1]].forEach(([team, me, other]) => {
            const info = loja2dist[team];
            if (!info) return;
            curPts[info.distrito] += me > other ? 3 : (me === other ? 1 : 0);
            curGm[info.distrito] += 1;
        });
    });

    // Combinar
    const linhas = [];
    Object.keys(state.estrutura).forEach(reg => {
        Object.keys(state.estrutura[reg]).forEach(dist => {
            const n = N[dist];
            const h = hist?.distritos?.[dist];
            const histPts = h ? h.pontuacaoMedia * n : 0;
            const histGm = h ? rodadasAnt * n : 0;
            const cPts = curPts[dist] || 0;
            const cGm = curGm[dist] || 0;
            const totPts = histPts + cPts;
            const totGm = histGm + cGm;
            linhas.push({
                regional: reg,
                distrito: dist,
                nLojas: n,
                histAvg: histGm > 0 ? histPts / histGm : 0,
                curAvg: cGm > 0 ? cPts / cGm : 0,
                simAvg: totGm > 0 ? totPts / totGm : 0,
                temHistorico: !!h
            });
        });
    });

    // Posição no ranking HISTÓRICO (por média histórica), para calcular a variação
    const histRankMap = {};
    [...linhas].sort((a, b) => b.histAvg - a.histAvg).forEach((l, i) => {
        histRankMap[l.distrito] = i + 1;
    });

    // Posição no ranking SIMULADO
    linhas.sort((a, b) => b.simAvg - a.simAvg);
    linhas.forEach((l, i) => {
        l.posicao = i + 1;
        l.posicaoHist = histRankMap[l.distrito];
        l.variacao = l.posicaoHist - l.posicao; // positivo = subiu no ranking
    });
    return linhas;
}

function badgeVariacao(v) {
    // Seta de variação de posição: ▲ subiu, ▼ desceu, — manteve
    if (v > 0) return `<span style="color:#11998e; font-weight:700;" title="Subiu ${v} posição(ões)">▲ ${v}</span>`;
    if (v < 0) return `<span style="color:#c0392b; font-weight:700;" title="Desceu ${Math.abs(v)} posição(ões)">▼ ${Math.abs(v)}</span>`;
    return `<span style="color:#999;" title="Manteve a posição">— 0</span>`;
}

function insightsDistrito(distrito, lojas) {
    // Analisa a rodada atual do distrito: lojas puxando pra cima/baixo e gol mais fraco.
    const lojasSet = new Set(lojas);
    const porLoja = {}; // loja -> {pts, resultado}
    const analiseGol = {}; // indicador -> {v, d, e}

    (state.gamesSummary?.games || []).forEach(g => {
        const [s1, s2] = g.scoreProjected.split('x').map(s => parseInt(s.trim()));
        [[g.team1, 1, s1, s2], [g.team2, 2, s2, s1]].forEach(([team, num, me, other]) => {
            if (!lojasSet.has(team)) return;
            porLoja[team] = {
                resultado: me > other ? 'V' : (me === other ? 'E' : 'D'),
                placar: `${me}x${other}`
            };
            const gols = g.golsProjetados || {};
            Object.entries(gols).forEach(([ind, venc]) => {
                if (!analiseGol[ind]) analiseGol[ind] = { v: 0, d: 0, e: 0 };
                if (venc === num) analiseGol[ind].v++;
                else if (venc === 0) analiseGol[ind].e++;
                else analiseGol[ind].d++;
            });
        });
    });

    const lojasUp = Object.entries(porLoja).filter(([, r]) => r.resultado === 'V').map(([l]) => l);
    const lojasDown = Object.entries(porLoja).filter(([, r]) => r.resultado === 'D').map(([l]) => l);

    // Gol mais fraco (mais derrotas) e mais forte (mais vitórias)
    const gols = Object.entries(analiseGol).map(([ind, a]) => ({
        nome: ind.replace(/\.xlsx$/i, ''), v: a.v, d: a.d, e: a.e, total: a.v + a.d + a.e
    }));
    gols.sort((a, b) => a.v - b.v);
    const golFraco = gols[0];
    const golForte = gols[gols.length - 1];

    return { lojasUp, lojasDown, golFraco, golForte, totalLojas: Object.keys(porLoja).length };
}

async function toggleRankingSimulado() {
    state.modoSimulado = !state.modoSimulado;
    const btn = document.getElementById('simuladoBtn');
    if (state.modoSimulado) {
        btn.classList.add('ativo');
        // Limpar filtros e mostrar simulado
        document.getElementById('filterRegional').value = '';
        document.getElementById('filterDistrito').value = '';
        state.currentRegional = null;
        state.currentDistrito = null;
        // Garantir que o resumo dos jogos está carregado
        if (!state.gamesSummary) {
            document.getElementById('infoBar').innerHTML = '<span>⏳ Carregando dados...</span>';
            await carregarResumJogos();
        }
        loadRankingSimulado();
    } else {
        btn.classList.remove('ativo');
        loadGames(); // volta ao ranking normal
    }
}

function voltarDashboard() {
    // Retorna à primeira tela (dashboard de rankings), limpando tudo
    state.modoSimulado = false;
    document.getElementById('simuladoBtn').classList.remove('ativo');
    state.currentRegional = null;
    state.currentDistrito = null;
    state.filtroResultado = null;
    const regSel = document.getElementById('filterRegional');
    const distSel = document.getElementById('filterDistrito');
    regSel.value = '';
    distSel.value = '';
    distSel.innerHTML = '<option value="">Selecione um Distrito...</option>';
    distSel.disabled = true;
    document.getElementById('statsSection').style.display = 'none';
    loadGames(); // sem regional -> mostra o dashboard de rankings
}

function loadRankingSimulado() {
    const container = document.getElementById('gamesContainer');
    const infoBar = document.getElementById('infoBar');
    const statsSection = document.getElementById('statsSection');
    statsSection.style.display = 'none';

    if (!state.historico || !state.gamesSummary) {
        infoBar.innerHTML = '<span>⏳ Carregando dados do simulado...</span>';
        return;
    }

    const ranking = calcularRankingSimulado();
    const rodadasAnt = state.historico.rodadasAnteriores;

    infoBar.innerHTML = `<span>🎯 Ranking Simulado — histórico (${rodadasAnt} rodadas) + rodada atual, ao vivo. Foco: ${REGIONAL_DESTAQUE}</span>`;

    // Distritos da regional em destaque
    const meus = ranking.filter(r => r.regional === REGIONAL_DESTAQUE);

    const setaEvol = (r) => {
        const diff = r.curAvg - r.histAvg;
        if (Math.abs(diff) < 0.05) return '<span style="color:#888;">➡️ estável</span>';
        return diff > 0
            ? `<span style="color:#11998e;">▲ subindo (+${diff.toFixed(2)})</span>`
            : `<span style="color:#c0392b;">▼ caindo (${diff.toFixed(2)})</span>`;
    };

    // Cards da R2 (destaque)
    const cardsMeus = meus.map(r => {
        const lojas = state.estrutura[r.regional][r.distrito];
        const ins = insightsDistrito(r.distrito, lojas);
        const up = ins.lojasUp.length ? ins.lojasUp.join(', ') : '—';
        const down = ins.lojasDown.length ? ins.lojasDown.join(', ') : '—';
        return `
        <div style="background:white; border-radius:12px; padding:18px; box-shadow:0 2px 10px rgba(0,0,0,0.08); border-left:5px solid #667eea;">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
                <span style="font-weight:700; font-size:1.15em;">#${r.posicao} ${badgeVariacao(r.variacao)} · ${r.distrito}</span>
                <span style="color:#667eea; font-weight:bold; font-size:1.3em;">${r.simAvg.toFixed(2)} pts</span>
            </div>
            <div style="font-size:0.9em; color:#666; margin:6px 0 10px;">
                Histórico ${r.histAvg.toFixed(2)} → Atual ${r.curAvg.toFixed(2)} · ${setaEvol(r)}
            </div>
            <div style="font-size:0.9em; line-height:1.6;">
                <div>💪 <b>Puxando pra cima:</b> ${up}</div>
                <div>📉 <b>Puxando pra baixo:</b> ${down}</div>
                <div>⚽ <b>Gol mais fraco:</b> ${ins.golFraco ? `${ins.golFraco.nome} (${ins.golFraco.v}/${ins.golFraco.total})` : '—'}</div>
                <div>🔥 <b>Gol mais forte:</b> ${ins.golForte ? `${ins.golForte.nome} (${ins.golForte.v}/${ins.golForte.total})` : '—'}</div>
            </div>
        </div>`;
    }).join('');

    // Insight geral da regional
    const melhorMeu = meus.reduce((a, b) => (b.simAvg > a.simAvg ? b : a), meus[0]);
    const piorMeu = meus.reduce((a, b) => (b.simAvg < a.simAvg ? b : a), meus[0]);
    const subindo = meus.filter(r => r.curAvg > r.histAvg + 0.05);
    const caindo = meus.filter(r => r.curAvg < r.histAvg - 0.05);

    // Tabela completa (todos os distritos), R2 destacada
    const linhasTabela = ranking.map(r => {
        const destaque = r.regional === REGIONAL_DESTAQUE;
        const medalha = r.posicao === 1 ? '🥇' : r.posicao === 2 ? '🥈' : r.posicao === 3 ? '🥉' : `#${r.posicao}`;
        return `
        <tr style="${destaque ? 'background:#eef1ff; font-weight:600;' : ''}">
            <td style="padding:8px 10px; text-align:center;">${medalha}</td>
            <td style="padding:8px 10px; text-align:center;">${badgeVariacao(r.variacao)}</td>
            <td style="padding:8px 10px;">${destaque ? '⭐ ' : ''}${r.distrito}<span style="color:#999; font-size:0.85em;"> · ${r.regional}</span></td>
            <td style="padding:8px 10px; text-align:center; color:#666;">${r.histAvg.toFixed(2)}</td>
            <td style="padding:8px 10px; text-align:center; color:#666;">${r.curAvg.toFixed(2)}</td>
            <td style="padding:8px 10px; text-align:center; color:#667eea; font-weight:bold;">${r.simAvg.toFixed(2)}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <div style="padding:20px; max-width:1100px; margin:0 auto;">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2); color:white; border-radius:12px; padding:18px 22px; margin-bottom:20px;">
            <h2 style="margin:0 0 6px;">🔥 Seus Distritos — ${REGIONAL_DESTAQUE}</h2>
            <div style="opacity:0.9; font-size:0.95em;">
                Melhor posicionado: <b>${melhorMeu.distrito}</b> (#${melhorMeu.posicao}, ${melhorMeu.simAvg.toFixed(2)}) ·
                Atenção: <b>${piorMeu.distrito}</b> (#${piorMeu.posicao}, ${piorMeu.simAvg.toFixed(2)})<br>
                ${subindo.length ? `📈 Subindo na rodada: ${subindo.map(r => r.distrito).join(', ')}. ` : ''}
                ${caindo.length ? `📉 Caindo na rodada: ${caindo.map(r => r.distrito).join(', ')}.` : ''}
            </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; margin-bottom:28px;">
            ${cardsMeus}
        </div>

        <h3 style="color:#667eea; border-bottom:2px solid #667eea; padding-bottom:8px;">📊 Ranking Simulado Completo</h3>
        <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; margin-top:10px;">
            <thead>
                <tr style="border-bottom:2px solid #ddd; text-align:left;">
                    <th style="padding:8px 10px; text-align:center;">#</th>
                    <th style="padding:8px 10px; text-align:center;" title="Variação vs ranking histórico">Mov.</th>
                    <th style="padding:8px 10px;">Distrito</th>
                    <th style="padding:8px 10px; text-align:center;">Histórico</th>
                    <th style="padding:8px 10px; text-align:center;">Atual</th>
                    <th style="padding:8px 10px; text-align:center;">Simulado</th>
                </tr>
            </thead>
            <tbody>${linhasTabela}</tbody>
        </table>
        </div>
        <div style="font-size:0.8em; color:#999; margin-top:12px;">
            Simulado = (pontos do histórico + pontos da rodada atual) ÷ (jogos do histórico + jogos da rodada atual).
            <b>Mov.</b> = variação de posição em relação ao ranking só do histórico (▲ subiu / ▼ desceu / — manteve).
            Histórico das rodadas 1-${rodadasAnt}; rodada atual ao vivo. ⭐ = seus distritos (${REGIONAL_DESTAQUE}).
        </div>
    </div>`;
}

function populateRegionalFilter() {
    const select = document.getElementById('filterRegional');

    Object.keys(state.estrutura).forEach(regional => {
        const option = document.createElement('option');
        option.value = regional;
        option.textContent = regional;
        select.appendChild(option);
    });
}

function onRegionalChange(e) {
    const regional = e.target.value;
    state.currentRegional = regional;
    state.currentDistrito = null;

    const distritoSelect = document.getElementById('filterDistrito');
    distritoSelect.innerHTML = '<option value="">Selecione um Distrito...</option>';

    if (regional) {
        distritoSelect.disabled = false;
        Object.keys(state.estrutura[regional]).forEach(distrito => {
            const option = document.createElement('option');
            option.value = distrito;
            option.textContent = distrito;
            distritoSelect.appendChild(option);
        });
    } else {
        distritoSelect.disabled = true;
    }

    loadGames();
}

function onDistritoChange(e) {
    state.currentDistrito = e.target.value;
    loadGames();
}

// ============================================================
// CARREGAR CONFRONTOS
// ============================================================

async function loadConfrontos() {
    try {
        const data = await api.get(`/confrontos/${state.semana}`);
        state.confrontos = data.confrontos;
        console.log(`✅ ${data.total} confrontos carregados para a semana ${state.semana}`);
    } catch (error) {
        console.error('Erro ao carregar confrontos:', error);
    }
}

// ============================================================
// CARREGAR E EXIBIR JOGOS
// ============================================================

async function loadGames() {
    // Se todos os jogos foram calculados, usar cache
    if (state.todoCalculado) {
        loadGamesFromCache();
        return;
    }

    const container = document.getElementById('gamesContainer');
    const infoBar = document.getElementById('infoBar');
    const statsSection = document.getElementById('statsSection');

    if (!state.currentRegional) {
        // Mostrar dashboard de rankings
        if (state.resumoCarregado && state.gamesSummary) {
            console.log('📊 Mostrando dashboard de rankings');
            loadRankingDashboard();
            return;
        } else {
            infoBar.textContent = '👇 Carregando rankings...';
            container.innerHTML = '';
            statsSection.style.display = 'none';
            return;
        }
    }

    // Se apenas regional foi selecionada (sem distrito), usar resumo rápido
    if (!state.currentDistrito) {
        if (state.resumoCarregado && state.gamesSummary) {
            console.log('⚡ Usando resumo pré-calculado para regional');
            // Adicionar botão de voltar
            infoBar.innerHTML = `<button onclick="document.getElementById('filterRegional').value=''; document.getElementById('filterDistrito').value=''; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true }));" style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-right: 15px;">← Voltar ao Ranking</button>`;
            loadGamesFromSummary(state.currentRegional);
            return;
        } else {
            infoBar.innerHTML = '<span>⏳ Carregando resumo de jogos da regional...</span>';
            // Tentar carregar o resumo se ainda não foi carregado
            if (!state.resumoCarregado) {
                carregarResumJogos().then(() => {
                    if (state.gamesSummary) {
                        console.log('⚡ Usando resumo pré-calculado para regional (após carregar)');
                        loadGamesFromSummary(state.currentRegional);
                    }
                });
            }
            return;
        }
    }

    // Se há distrito selecionado, usar resumo rápido + detalhes em background
    let lojas = state.estrutura[state.currentRegional][state.currentDistrito];
    let titulo = state.currentDistrito;

    const jogosFiltrados = state.confrontos.filter(j =>
        lojas.includes(j.team1) || lojas.includes(j.team2)
    );

    if (jogosFiltrados.length === 0) {
        infoBar.innerHTML = `<span>ℹ️ Nenhum jogo encontrado para ${titulo}</span>`;
        container.innerHTML = '';
        statsSection.style.display = 'none';
        return;
    }

    // Mostrar resumo rápido do resumo pré-calculado
    if (state.resumoCarregado && state.gamesSummary) {
        console.log('⚡ Mostrando resumo rápido do distrito antes de carregar detalhes');
        loadGamesFromSummaryForDistrito(state.currentRegional, state.currentDistrito, lojas);

        // Carregar detalhes em background
        carregarDetalhesDistrito(jogosFiltrados, lojas);
        return;
    }

    container.innerHTML = '<div class="loading">⏳ Carregando dados dos jogos...</div>';

    try {
        const jogosComDados = await Promise.all(
            jogosFiltrados.map(jogo => carregarDadosJogo(jogo))
        );

        // Salvar no state para usar em filtros
        state.jogosComDadosAtual = jogosComDados;

        // Calcular estatísticas
        const stats = calcularEstatisticas(jogosComDados, lojas);

        // Calcular análise por gol
        const analise = calcularAnalisePorGol(jogosComDados, lojas);

        // Atualizar seção de estatísticas
        atualizarSeçãoEstatísticas(stats, analise);
        statsSection.style.display = 'block';

        infoBar.innerHTML = `<span>📊 ${jogosFiltrados.length} jogos carregados com sucesso</span>`;

        // Aplicar filtro se houver
        const jogosFinal = state.filtroResultado
            ? filtrarJogosPorResultado(jogosComDados, lojas, state.filtroResultado)
            : jogosComDados;

        container.innerHTML = '';
        jogosFinal.forEach(jogoData => {
            try {
                // Pular jogos com erro de carregamento
                if (jogoData.erro) {
                    console.log(`Pulando jogo ${jogoData.team1} vs ${jogoData.team2} (erro ao carregar dados)`);
                    return;
                }
                const card = criarCardJogo(jogoData, lojas);
                container.appendChild(card);
            } catch (error) {
                console.error(`Erro ao renderizar jogo ${jogoData.team1} vs ${jogoData.team2}:`, error);
                // Continuar com próximo jogo se houver erro
            }
        });

    } catch (error) {
        infoBar.innerHTML = '<span style="color: red;">⚠️ Alguns jogos não puderam ser carregados (dados indisponíveis)</span>';
        console.error('Erro ao carregar jogos:', error);
    }
}

// ============================================================
// CARREGAR DADOS DE UM JOGO
// ============================================================

function loadRankingDashboard() {
    const container = document.getElementById('gamesContainer');
    const infoBar = document.getElementById('infoBar');
    const statsSection = document.getElementById('statsSection');

    statsSection.style.display = 'none';
    infoBar.innerHTML = '<span>🏆 Ranking de Pontuação Média</span>';

    // Calcular pontuação por regional
    const rankingRegional = {};
    Object.keys(state.estrutura).forEach(regional => {
        rankingRegional[regional] = { vitórias: 0, total: 0, pontuacao: 0 };
    });

    // Calcular pontuação por distrito
    const rankingDistrito = {};
    Object.keys(state.estrutura).forEach(regional => {
        Object.keys(state.estrutura[regional]).forEach(distrito => {
            rankingDistrito[`${regional} > ${distrito}`] = { vitórias: 0, total: 0, pontuacao: 0, lojas: state.estrutura[regional][distrito] };
        });
    });

    // Processar cada jogo
    state.gamesSummary.games.forEach(game => {
        const [score1, score2] = game.scoreProjected.split('x').map(s => parseInt(s.trim()));

        // Encontrar regional e distrito de cada time
        Object.keys(state.estrutura).forEach(regional => {
            Object.keys(state.estrutura[regional]).forEach(distrito => {
                const lojas = state.estrutura[regional][distrito];

                // Team1 neste distrito?
                if (lojas.includes(game.team1)) {
                    const pontos1 = score1 > score2 ? 3 : score1 === score2 ? 1 : 0;
                    rankingRegional[regional].pontuacao += pontos1;
                    rankingRegional[regional].total++;
                    rankingDistrito[`${regional} > ${distrito}`].pontuacao += pontos1;
                    rankingDistrito[`${regional} > ${distrito}`].total++;
                }

                // Team2 neste distrito?
                if (lojas.includes(game.team2)) {
                    const pontos2 = score2 > score1 ? 3 : score2 === score1 ? 1 : 0;
                    rankingRegional[regional].pontuacao += pontos2;
                    rankingRegional[regional].total++;
                    rankingDistrito[`${regional} > ${distrito}`].pontuacao += pontos2;
                    rankingDistrito[`${regional} > ${distrito}`].total++;
                }
            });
        });
    });

    // Calcular média e ordenar
    const ranking1 = Object.entries(rankingRegional)
        .map(([nome, dados]) => ({
            nome,
            media: dados.total > 0 ? (dados.pontuacao / dados.total).toFixed(2) : 0,
            pontuacao: dados.pontuacao,
            total: dados.total
        }))
        .sort((a, b) => b.media - a.media);

    const ranking2 = Object.entries(rankingDistrito)
        .map(([nome, dados]) => ({
            nome,
            media: dados.total > 0 ? (dados.pontuacao / dados.total).toFixed(2) : 0,
            pontuacao: dados.pontuacao,
            total: dados.total
        }))
        .sort((a, b) => b.media - a.media);

    // Agrupar distritos por regional (cada um com sua média), ordenados
    const distritosPorRegional = {};
    Object.entries(rankingDistrito).forEach(([nome, dados]) => {
        const sep = nome.indexOf(' > ');
        const regional = nome.slice(0, sep);
        const distrito = nome.slice(sep + 3);
        if (!distritosPorRegional[regional]) distritosPorRegional[regional] = [];
        distritosPorRegional[regional].push({
            distrito,
            media: dados.total > 0 ? dados.pontuacao / dados.total : 0,
            pontuacao: dados.pontuacao,
            total: dados.total
        });
    });
    Object.values(distritosPorRegional).forEach(arr => arr.sort((a, b) => b.media - a.media));

    // Renderizar: cada regional (com sua média) e, abaixo, seus distritos
    container.innerHTML = `
        <div style="padding: 20px; max-width: 1000px; margin: 0 auto;">
            ${ranking1.map((r, idx) => {
                const medalha = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                const dists = distritosPorRegional[r.nome] || [];
                const regJs = r.nome.replace(/'/g, "\\'");
                return `
                <div style="background: white; border-radius: 12px; margin-bottom: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; cursor: pointer;"
                         title="Ver a regional ${r.nome}"
                         onclick="document.getElementById('filterRegional').value='${regJs}'; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true }));">
                        <span style="font-weight: 700; font-size: 1.25em;">${medalha} ${r.nome}</span>
                        <span style="font-weight: bold; font-size: 1.3em;">${r.media} pts
                            <span style="font-size: 0.65em; opacity: 0.85; font-weight: 400;">(${r.pontuacao}/${r.total} jogos)</span>
                        </span>
                    </div>
                    <div style="padding: 8px 14px 12px;">
                        ${dists.map((d, di) => {
                            const distJs = d.distrito.replace(/'/g, "\\'");
                            return `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 10px; border-bottom: 1px solid #f2f2f2; cursor: pointer;"
                                 onmouseover="this.style.background='#f7f8ff'" onmouseout="this.style.background='transparent'"
                                 title="Ver o distrito ${d.distrito}"
                                 onclick="document.getElementById('filterRegional').value='${regJs}'; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true })); setTimeout(function(){ document.getElementById('filterDistrito').value='${distJs}'; document.getElementById('filterDistrito').dispatchEvent(new Event('change', { bubbles: true })); }, 300);">
                                <span style="font-size: 0.98em;"><span style="color:#999;">${di + 1}.</span> ${d.distrito}</span>
                                <span style="color: #667eea; font-weight: 600;">${d.media.toFixed(2)} pts
                                    <span style="color: #999; font-size: 0.82em; font-weight: 400;">${d.pontuacao}/${d.total}</span>
                                </span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
            }).join('')}
        </div>
    `;
}

function loadGamesFromSummary(regional) {
    const container = document.getElementById('gamesContainer');
    const infoBar = document.getElementById('infoBar');
    const statsSection = document.getElementById('statsSection');

    let lojas = [];
    Object.values(state.estrutura[regional]).forEach(distLojas => {
        lojas = lojas.concat(distLojas);
    });

    // Validar se gamesSummary está disponível
    if (!state.gamesSummary || !state.gamesSummary.games) {
        console.error('❌ gamesSummary não está disponível!', state.gamesSummary);
        infoBar.innerHTML = '<span>❌ Erro ao carregar dados. Recarregue a página.</span>';
        return;
    }

    // Filtrar jogos do resumo que pertencem a esta regional
    const jogosFiltrados = state.gamesSummary.games.filter(g =>
        lojas.includes(g.team1) || lojas.includes(g.team2)
    );
    console.log(`📊 ${jogosFiltrados.length} jogos encontrados para ${regional}`);

    if (jogosFiltrados.length === 0) {
        infoBar.innerHTML = `<span>ℹ️ Nenhum jogo encontrado para ${regional}</span>`;
        container.innerHTML = '';
        statsSection.style.display = 'none';
        return;
    }

    // Calcular estatísticas a partir do resumo
    let vitórias = 0, empates = 0, derrotas = 0, totalLojas = 0;

    jogosFiltrados.forEach(gameData => {
        const [score1, score2] = gameData.scoreProjected.split('x').map(s => parseInt(s.trim()));

        // Contar para team1 se está em lojas
        if (lojas.includes(gameData.team1)) {
            totalLojas++;
            if (score1 > score2) {
                vitórias++;
            } else if (score1 < score2) {
                derrotas++;
            } else {
                empates++;
            }
        }

        // Contar para team2 se está em lojas
        if (lojas.includes(gameData.team2)) {
            totalLojas++;
            if (score2 > score1) {
                vitórias++;
            } else if (score2 < score1) {
                derrotas++;
            } else {
                empates++;
            }
        }
    });

    console.log(`📊 loadGamesFromSummary: V=${vitórias} E=${empates} D=${derrotas} Total=${totalLojas} Jogos=${jogosFiltrados.length}`);

    // Stats mínimas (sem análise por gol)
    const stats = {
        vitórias,
        empates,
        derrotas,
        totalJogos: totalLojas,
        pontuacaoTotal: vitórias * 3 + empates * 1,
        mediaJogos: totalLojas > 0 ? (vitórias * 3 + empates * 1) / totalLojas : 0,
        aproveitamento: totalLojas > 0 ? ((vitórias * 3 + empates * 1) / (totalLojas * 3)) * 100 : 0
    };

    const analise = calcularAnaliseDoResumo(jogosFiltrados, lojas);
    atualizarSeçãoEstatísticas(stats, analise);
    statsSection.style.display = 'block';

    infoBar.innerHTML = `<button onclick="document.getElementById('filterRegional').value=''; document.getElementById('filterDistrito').value=''; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true }));" style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-right: 15px;">← Voltar ao Ranking</button><span>📊 ${jogosFiltrados.length} jogos da regional (resumo rápido)</span>`;

    // Renderizar cards simplificados (sem dados detalhados)
    container.innerHTML = '';
    jogosFiltrados.forEach(gameData => {
        const [score1, score2] = gameData.scoreProjected.split('x').map(s => parseInt(s.trim()));
        const lojaDoRegional = lojas.includes(gameData.team1) ? gameData.team1 : gameData.team2;
        const isTeam1 = lojaDoRegional === gameData.team1;
        const scoreRegional = isTeam1 ? score1 : score2;
        const scoreAdversário = isTeam1 ? score2 : score1;

        let resultClass = 'empate';
        let resultText = '⚖️ EMPATANDO';
        if (scoreRegional > scoreAdversário) {
            resultClass = 'venceu';
            resultText = `✅ ${lojaDoRegional} ESTÁ VENCENDO`;
        } else if (scoreRegional < scoreAdversário) {
            resultClass = 'perdeu';
            resultText = `❌ ${lojaDoRegional} ESTÁ PERDENDO`;
        }

        const card = document.createElement('div');
        card.className = 'game-section';
        card.innerHTML = `
            <div class="game-header">
                <div class="game-title-compact">
                    <span class="team-compact">${gameData.team1}</span>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                            <span style="font-size: 0.7em; color: #666; font-weight: 500;">Placar Projetado</span>
                            <span class="score-compact">${score1} × ${score2}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                            <span style="font-size: 0.7em; color: #999; font-weight: 500;">Acumulado</span>
                            <span style="font-size: 0.85em; color: #999; font-weight: 600;">${gameData.scoreAccumulated}</span>
                        </div>
                    </div>
                    <span class="team-compact">${gameData.team2}</span>
                </div>
                <div class="result-compact ${resultClass}">${resultText}</div>
                <div class="expand-icon">ℹ️</div>
            </div>
            <div style="padding: 15px; color: #999; text-align: center; font-size: 0.9em;">
                💡 Selecione um distrito para ver os detalhes dos indicadores
            </div>
        `;
        container.appendChild(card);
    });
}

function loadGamesFromSummaryForDistrito(regional, distrito, lojas) {
    const container = document.getElementById('gamesContainer');
    const infoBar = document.getElementById('infoBar');
    const statsSection = document.getElementById('statsSection');

    // Filtrar jogos do resumo que pertencem a este distrito
    const jogosFiltrados = state.gamesSummary.games.filter(g =>
        lojas.includes(g.team1) || lojas.includes(g.team2)
    );

    if (jogosFiltrados.length === 0) {
        infoBar.innerHTML = `<span>ℹ️ Nenhum jogo encontrado para ${distrito}</span>`;
        return;
    }

    // Calcular estatísticas rápidas do resumo
    let vitórias = 0, empates = 0, derrotas = 0, totalLojas = 0;
    jogosFiltrados.forEach(gameData => {
        const [score1, score2] = gameData.scoreProjected.split('x').map(s => parseInt(s.trim()));

        // Contar para team1 se está em lojas
        if (lojas.includes(gameData.team1)) {
            totalLojas++;
            if (score1 > score2) vitórias++;
            else if (score1 < score2) derrotas++;
            else empates++;
        }

        // Contar para team2 se está em lojas
        if (lojas.includes(gameData.team2)) {
            totalLojas++;
            if (score2 > score1) vitórias++;
            else if (score2 < score1) derrotas++;
            else empates++;
        }
    });

    const stats = {
        vitórias,
        empates,
        derrotas,
        totalJogos: totalLojas,
        pontuacaoTotal: vitórias * 3 + empates * 1,
        mediaJogos: totalLojas > 0 ? (vitórias * 3 + empates * 1) / totalLojas : 0,
        aproveitamento: totalLojas > 0 ? ((vitórias * 3 + empates * 1) / (totalLojas * 3)) * 100 : 0
    };

    // Análise por gol usando o vencedor real de cada indicador (mesma lógica
    // da regional).
    const analise = calcularAnaliseDoResumo(jogosFiltrados, lojas);

    atualizarSeçãoEstatísticas(stats, analise);
    statsSection.style.display = 'block';

    infoBar.innerHTML = `<button onclick="document.getElementById('filterRegional').value=''; document.getElementById('filterDistrito').value=''; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true }));" style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-right: 15px;">← Voltar ao Ranking</button><span>📊 ${jogosFiltrados.length} jogos carregando detalhes...</span>`;

    // Renderizar cards do resumo
    container.innerHTML = '';
    jogosFiltrados.forEach(gameData => {
        const [score1, score2] = gameData.scoreProjected.split('x').map(s => parseInt(s.trim()));
        const lojaDoDistrito = lojas.includes(gameData.team1) ? gameData.team1 : gameData.team2;
        const isTeam1 = lojaDoDistrito === gameData.team1;
        const scoreDistrito = isTeam1 ? score1 : score2;
        const scoreAdversário = isTeam1 ? score2 : score1;

        let resultClass = 'empate';
        let resultText = '⚖️ EMPATANDO';
        if (scoreDistrito > scoreAdversário) {
            resultClass = 'venceu';
            resultText = `✅ ${lojaDoDistrito} ESTÁ VENCENDO`;
        } else if (scoreDistrito < scoreAdversário) {
            resultClass = 'perdeu';
            resultText = `❌ ${lojaDoDistrito} ESTÁ PERDENDO`;
        }

        const card = document.createElement('div');
        card.className = 'game-section';
        card.id = `game-${gameData.team1}-${gameData.team2}`;
        card.innerHTML = `
            <div class="game-header">
                <div class="game-title-compact">
                    <span class="team-compact">${gameData.team1}</span>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                            <span style="font-size: 0.7em; color: #666; font-weight: 500;">Placar Projetado</span>
                            <span class="score-compact">${score1} × ${score2}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                            <span style="font-size: 0.7em; color: #999; font-weight: 500;">Acumulado</span>
                            <span style="font-size: 0.85em; color: #999; font-weight: 600;">${gameData.scoreAccumulated}</span>
                        </div>
                    </div>
                    <span class="team-compact">${gameData.team2}</span>
                </div>
                <div class="result-compact ${resultClass}">${resultText}</div>
                <div class="expand-icon">📋</div>
            </div>
            <div style="padding: 15px; color: #999; text-align: center; font-size: 0.9em;">
                ⏳ Carregando detalhes dos indicadores...
            </div>
        `;
        container.appendChild(card);
    });
}

async function carregarDetalhesDistrito(jogosFiltrados, lojas) {
    const infoBar = document.getElementById('infoBar');
    try {
        const jogosComDados = await Promise.all(
            jogosFiltrados.map(jogo => carregarDadosJogo(jogo))
        );

        state.jogosComDadosAtual = jogosComDados;
        infoBar.innerHTML = `<span>📊 ${jogosFiltrados.length} jogos carregados com sucesso</span>`;

        const jogosFinal = state.filtroResultado
            ? filtrarJogosPorResultado(jogosComDados, lojas, state.filtroResultado)
            : jogosComDados;

        const container = document.getElementById('gamesContainer');
        container.innerHTML = '';
        jogosFinal.forEach(jogoData => {
            if (jogoData.erro) return;
            const card = criarCardJogo(jogoData, lojas);
            container.appendChild(card);
        });
    } catch (error) {
        infoBar.innerHTML = '<span style="color: red;">⚠️ Erro ao carregar detalhes</span>';
        console.error('Erro ao carregar detalhes:', error);
    }
}

async function carregarDadosJogo(jogo) {
    try {
        const [dadosTeam1, dadosTeam2] = await Promise.all([
            api.get(`/loja-dias/${jogo.team1}/${state.semana}`),
            api.get(`/loja-dias/${jogo.team2}/${state.semana}`)
        ]);

        // Calcular placar projetado e acumulado localmente
        const placarProjetado = calcularPlacarLocal(dadosTeam1.dados, dadosTeam2.dados);
        const placarAcumulado = calcularPlacarLocal(
            dadosTeam1.dados,
            dadosTeam2.dados,
            dadosTeam1.hoje_idx  // Calcular até hoje
        );

        return {
            team1: jogo.team1,
            team2: jogo.team2,
            score: placarProjetado.score,  // Placar projetado (ex: "3 x 2")
            scoreAcumulado: placarAcumulado.score,  // Placar acumulado (ex: "1 x 0")
            hojeIdx: dadosTeam1.hoje_idx,
            dadosTeam1: dadosTeam1.dados,
            dadosTeam2: dadosTeam2.dados
        };

    } catch (error) {
        console.error(`Erro ao carregar dados de ${jogo.team1} vs ${jogo.team2}:`, error);
        return {
            team1: jogo.team1,
            team2: jogo.team2,
            score: "? x ?",
            erro: true
        };
    }
}

// ============================================================
// CRIAR CARD DO JOGO
// ============================================================

function criarCardJogo(jogoData, lojas) {
    const card = document.createElement('div');
    card.className = 'game-section';

    const { team1, team2, score, scoreAcumulado, dadosTeam1, dadosTeam2, erro, hojeIdx } = jogoData;

    if (erro) {
        card.innerHTML = `
            <div class="game-header">
                <div class="game-title">${team1} vs ${team2}</div>
                <p style="color: red;">❌ Erro ao carregar dados</p>
            </div>
        `;
        return card;
    }

    // Header com placar
    const [score1, score2] = score && score.includes('x')
        ? score.split('x').map(s => parseInt(s.trim()))
        : [0, 0];

    // Determinar qual time é do distrito selecionado
    const lojaDoDistrito = lojas.includes(team1) ? team1 : team2;
    const isTeam1 = lojaDoDistrito === team1;
    const scoreDistrito = isTeam1 ? score1 : score2;
    const scoreAdversário = isTeam1 ? score2 : score1;

    // Determinar se a rodada acabou (hojeIdx = 6 significa domingo, último dia)
    const rodadaAcabou = hojeIdx === 6;

    let resultClass = 'empate';
    let resultText = '⚖️ EMPATANDO';
    if (scoreDistrito > scoreAdversário) {
        resultClass = 'venceu';
        resultText = rodadaAcabou ? `✅ ${lojaDoDistrito} VENCEU` : `✅ ${lojaDoDistrito} ESTÁ VENCENDO`;
    } else if (scoreDistrito < scoreAdversário) {
        resultClass = 'perdeu';
        resultText = rodadaAcabou ? `❌ ${lojaDoDistrito} PERDEU` : `❌ ${lojaDoDistrito} ESTÁ PERDENDO`;
    } else {
        resultText = rodadaAcabou ? '⚖️ EMPATOU' : '⚖️ EMPATANDO';
    }

    let header = `
        <div class="game-header" onclick="this.closest('.game-section').classList.toggle('expanded')">
            <div class="game-title-compact">
                <span class="team-compact">${team1}</span>
                <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <span style="font-size: 0.7em; color: #666; font-weight: 500;">Placar Projetado</span>
                        <span class="score-compact">${score1} × ${score2}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <span style="font-size: 0.7em; color: #999; font-weight: 500;">Acumulado</span>
                        <span style="font-size: 0.85em; color: #999; font-weight: 600;">${scoreAcumulado}</span>
                    </div>
                </div>
                <span class="team-compact">${team2}</span>
            </div>
            <div class="result-compact ${resultClass}">${resultText}</div>
            <div class="expand-icon">▼</div>
        </div>
    `;

    card.innerHTML = header;

    // Container das tabelas (inicialmente escondido)
    const tablesContainer = document.createElement('div');
    tablesContainer.className = 'tables-container-hidden';

    // Tabelas de indicadores
    const indicadores = Object.keys(dadosTeam1);

    indicadores.forEach(indicador => {
        try {
            const infoTeam1 = dadosTeam1[indicador];
            const infoTeam2 = dadosTeam2[indicador];

            const tablesWrapper = document.createElement('div');
            tablesWrapper.className = 'tables-wrapper';

            tablesWrapper.innerHTML = `
                ${criarTabelaIndicador(team1, infoTeam1, indicador, infoTeam2)}
                ${criarTabelaIndicador(team2, infoTeam2, indicador, infoTeam1)}
            `;

            tablesContainer.appendChild(tablesWrapper);
        } catch (error) {
            console.error(`Erro ao renderizar indicador ${indicador}:`, error);
        }
    });

    card.appendChild(tablesContainer);

    return card;
}

// ============================================================
// CRIAR TABELA DE INDICADOR
// ============================================================

function criarTabelaIndicador(teamName, dados, indicador, dadosAdversario = null) {
    // Proteção: verificar se dados existe e tem estrutura correta
    if (!dados) {
        return '<div class="table-container"><div class="table-title">Dados indisponíveis</div></div>';
    }

    // Mostrar o nome do arquivo do indicador (sem a extensão .xlsx)
    const displayName = (indicador || 'Indicador').replace(/\.xlsx$/i, '');
    const diasOrdenados = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

    let totalAnterior = 0;
    let totalAtual = 0;

    // Se houver adversário, calcular totais dele também para comparação
    let totalAdversarioAnterior = 0;
    let totalAdversarioAtual = 0;
    if (dadosAdversario) {
        const diasAdvAnterior = dadosAdversario.anterior?.dias || {};
        const diasAdvAtual = dadosAdversario.atual?.dias || {};
        diasOrdenados.forEach(dia => {
            totalAdversarioAnterior += diasAdvAnterior[dia] || 0;
            totalAdversarioAtual += diasAdvAtual[dia] || 0;
        });
    }

    let html = `
        <div class="table-container">
            <div class="table-title">${displayName}</div>
            <table>
                <thead>
                    <tr>
                        <th>Dia</th>
                        <th>S. Anterior</th>
                        <th>S. Atual</th>
                        <th>Evolução</th>
                    </tr>
                </thead>
                <tbody>
    `;

    diasOrdenados.forEach(dia => {
        const valorAnterior = (dados && dados.anterior && dados.anterior.dias) ? (dados.anterior.dias[dia] || 0) : 0;
        const valorAtual = (dados && dados.atual && dados.atual.dias) ? (dados.atual.dias[dia] || 0) : 0;

        totalAnterior += valorAnterior;
        totalAtual += valorAtual;

        const evolucao = valorAnterior !== 0 ? ((valorAtual - valorAnterior) / valorAnterior * 100) : 0;
        const evoluClass = evolucao > 0 ? 'positive' : evolucao < 0 ? 'negative' : 'neutral';

        html += `
            <tr>
                <td class="day-label">${dia}</td>
                <td class="value-anterior">${formatarMoedaBR(valorAnterior)}</td>
                <td class="value-atual">${formatarMoedaBR(valorAtual)}</td>
                <td class="evolution ${evoluClass}">${evolucao.toFixed(2)}%</td>
            </tr>
        `;
    });

    const evolucaoTotal = totalAnterior !== 0 ? ((totalAtual - totalAnterior) / totalAnterior * 100) : 0;
    const evoluClassTotal = evolucaoTotal > 0 ? 'positive' : evolucaoTotal < 0 ? 'negative' : 'neutral';

    // Comparativo com adversário: aplicar cores apenas na célula de evolução
    let classeEvolucao = evoluClassTotal;
    let faltaVirar = null; // R$ que ESTE time precisa vender a mais p/ virar o indicador
    if (dadosAdversario) {
        const evolucaoAdversario = totalAdversarioAnterior !== 0
            ? ((totalAdversarioAtual - totalAdversarioAnterior) / totalAdversarioAnterior * 100)
            : 0;

        // Quem tiver evolução melhor (maior) fica verde, pior fica vermelho
        if (evolucaoTotal > evolucaoAdversario) {
            classeEvolucao = 'evolution-melhor';
        } else if (evolucaoTotal < evolucaoAdversario) {
            classeEvolucao = 'evolution-pior';
            // Está perdendo: quanto precisa vender a mais na S. Atual para virar o gol.
            // Precisa que a evolução dele iguale/supere a do adversário:
            //   S.Atual necessária = S.Anterior_dele × (1 + evoluçãoAdv/100)
            if (totalAnterior > 0) {
                const necessario = totalAnterior * (1 + evolucaoAdversario / 100);
                const falta = necessario - totalAtual;
                if (falta > 0) faltaVirar = falta;
            }
        }
    }

    html += `
                <tr class="total-row">
                    <td class="day-label">TOTAL</td>
                    <td style="text-align: center;">${formatarMoedaBR(totalAnterior)}</td>
                    <td style="text-align: center;">${formatarMoedaBR(totalAtual)}</td>
                    <td class="evolution ${classeEvolucao}" style="text-align: center;">${evolucaoTotal.toFixed(2)}%</td>
                </tr>
    `;

    if (faltaVirar !== null) {
        html += `
                <tr class="virar-row">
                    <td class="day-label" style="font-size: 0.78em; color: #999;">Falta p/ virar</td>
                    <td></td>
                    <td style="text-align: center; background: #fff3b0; font-weight: 700; color: #7a5c00;"
                        title="${teamName} precisa vender +${formatarMoedaBR(faltaVirar)} na S. Atual para virar este gol">
                        +${formatarMoedaBR(faltaVirar)}
                    </td>
                    <td></td>
                </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    </div>
    `;

    return html;
}

// ============================================================
// PRÉ-CÁLCULO DE TODOS OS JOGOS
// ============================================================

async function calcularTodosOsJogos() {
    const btn = document.getElementById('calcularTodosBtn');
    const infoBar = document.getElementById('infoBar');

    btn.disabled = true;
    btn.textContent = '⏳ Calculando (0%)...';
    state.jogosCalculados = {};

    const CHUNK_SIZE = 15; // Processar 15 confrontos por vez
    const totalChunks = Math.ceil(state.confrontos.length / CHUNK_SIZE);
    let processados = 0;

    try {
        for (let i = 0; i < state.confrontos.length; i += CHUNK_SIZE) {
            const chunk = state.confrontos.slice(i, i + CHUNK_SIZE);

            // Processar chunk em paralelo
            const jogosComDados = await Promise.all(
                chunk.map(jogo => carregarDadosJogo(jogo))
            );

            // Armazenar resultados do chunk
            jogosComDados.forEach(jogoData => {
                const key = `${jogoData.team1}_${jogoData.team2}`;
                state.jogosCalculados[key] = jogoData;
            });

            processados += chunk.length;
            const percentual = Math.round((processados / state.confrontos.length) * 100);
            btn.textContent = `⏳ Calculando (${percentual}%)...`;
        }

        state.todoCalculado = true;
        btn.textContent = '✅ Todos os placares calculados!';
        infoBar.innerHTML = `<span>✨ ${Object.keys(state.jogosCalculados).length} jogos em cache - agora é instantâneo!</span>`;
        btn.disabled = false;

        // Se houver distrito selecionado, recarregar para mostrar dados
        if (state.currentDistrito) {
            loadGames();
        }

        setTimeout(() => {
            btn.textContent = '⚡ Recalcular Todos os Placares';
        }, 3000);

    } catch (error) {
        console.error('Erro ao calcular todos os jogos:', error);
        btn.textContent = '❌ Erro ao calcular';
        btn.disabled = false;
    }
}

async function loadGamesFromCache() {
    const container = document.getElementById('gamesContainer');
    const infoBar = document.getElementById('infoBar');
    const statsSection = document.getElementById('statsSection');

    if (!state.currentRegional) {
        infoBar.textContent = '👇 Selecione uma Regional e um Distrito para visualizar os jogos';
        container.innerHTML = '';
        statsSection.style.display = 'none';
        return;
    }

    // Se há distrito selecionado, usar dados do distrito
    // Caso contrário, usar todos os distritos da regional
    let lojas = [];
    let titulo = '';

    if (state.currentDistrito) {
        lojas = state.estrutura[state.currentRegional][state.currentDistrito];
        titulo = state.currentDistrito;
    } else {
        // Agregar lojas de todos os distritos da regional
        Object.values(state.estrutura[state.currentRegional]).forEach(distLojas => {
            lojas = lojas.concat(distLojas);
        });
        titulo = state.currentRegional;
    }

    const jogosFiltrados = state.confrontos.filter(j =>
        lojas.includes(j.team1) || lojas.includes(j.team2)
    );

    if (jogosFiltrados.length === 0) {
        infoBar.innerHTML = `<span>ℹ️ Nenhum jogo encontrado para ${titulo}</span>`;
        container.innerHTML = '';
        statsSection.style.display = 'none';
        return;
    }

    // Obter dados do cache
    const jogosComDados = jogosFiltrados.map(jogo => {
        const key = `${jogo.team1}_${jogo.team2}`;
        return state.jogosCalculados[key] || { ...jogo, erro: true };
    });

    // Salvar no state para usar em filtros
    state.jogosComDadosAtual = jogosComDados;

    // Calcular estatísticas
    const stats = calcularEstatisticas(jogosComDados, lojas);

    // Calcular análise por gol
    const analise = calcularAnalisePorGol(jogosComDados, lojas);

    // Atualizar seção de estatísticas
    atualizarSeçãoEstatísticas(stats, analise);
    statsSection.style.display = 'block';

    infoBar.innerHTML = `<span>📊 ${jogosFiltrados.length} jogos carregados com sucesso</span>`;

    // Aplicar filtro se houver
    const jogosFinal = state.filtroResultado
        ? filtrarJogosPorResultado(jogosComDados, lojas, state.filtroResultado)
        : jogosComDados;

    container.innerHTML = '';
    jogosFinal.forEach(jogoData => {
        try {
            if (jogoData.erro) {
                console.log(`Pulando jogo ${jogoData.team1} vs ${jogoData.team2} (erro ao carregar dados)`);
                return;
            }
            const card = criarCardJogo(jogoData, lojas);
            container.appendChild(card);
        } catch (error) {
            console.error(`Erro ao renderizar jogo ${jogoData.team1} vs ${jogoData.team2}:`, error);
        }
    });
}

function atualizarSeçãoEstatísticas(stats, analise) {
    document.getElementById('vitoriasCount').textContent = stats.vitórias;
    document.getElementById('empatesCount').textContent = stats.empates;
    document.getElementById('derrotasCount').textContent = stats.derrotas;
    document.getElementById('totalJogos').textContent = stats.totalJogos;
    document.getElementById('pontuacaoTotal').textContent = stats.pontuacaoTotal;
    document.getElementById('mediaJogos').textContent = stats.mediaJogos.toFixed(2);
    document.getElementById('aproveitamento').textContent = stats.aproveitamento.toFixed(2) + '%';

    // Atualizar análise por gol
    const golAnalysisDiv = document.getElementById('golAnalysis');
    golAnalysisDiv.innerHTML = '';

    const golsOrdenados = Object.entries(analise)
        .map(([nome, dados]) => ({
            nome: nome.replace(/\.xlsx$/i, ''),
            vitórias: dados.vitórias,
            derrotas: dados.derrotas,
            empates: dados.empates,
            total: dados.total
        }))
        .sort((a, b) => b.vitórias - a.vitórias); // Ordenar por vitórias descendentes

    if (golsOrdenados.length > 0) {
        golsOrdenados.forEach(gol => {
            const percentualVitórias = gol.total > 0 ? (gol.vitórias / gol.total * 100) : 0;
            const percentualDerrotas = gol.total > 0 ? (gol.derrotas / gol.total * 100) : 0;

            const golElement = document.createElement('div');
            golElement.className = 'gol-item';
            golElement.innerHTML = `
                <div class="gol-item-name">${gol.nome}</div>
                <div class="gol-item-bar">
                    <div class="gol-item-bar-win" style="width: ${percentualVitórias}%">
                        ${gol.vitórias > 0 ? gol.vitórias : ''}
                    </div>
                    <div class="gol-item-bar-loss" style="width: ${percentualDerrotas}%">
                        ${gol.derrotas > 0 ? gol.derrotas : ''}
                    </div>
                </div>
            `;
            golAnalysisDiv.appendChild(golElement);
        });

        // Adicionar resumo de fortes e fracos
        const forte = golsOrdenados[0];
        const fraco = golsOrdenados[golsOrdenados.length - 1];

        const summary = document.createElement('div');
        summary.className = 'gol-summary';
        summary.innerHTML = `
            <div class="gol-forte">💪 Ponto forte: ${forte.nome} (${forte.vitórias}/${forte.total})</div>
            <div class="gol-fraco">📉 Ponto fraco: ${fraco.nome} (${fraco.vitórias}/${fraco.total})</div>
        `;
        golAnalysisDiv.appendChild(summary);
    }
}

function filtrarJogosPorResultado(jogosComDados, lojas, resultado) {
    return jogosComDados.filter(jogoData => {
        if (jogoData.erro) return false;

        const [score1, score2] = jogoData.score && jogoData.score.includes('x')
            ? jogoData.score.split('x').map(s => parseInt(s.trim()))
            : [0, 0];

        const lojaDoDistrito = lojas.includes(jogoData.team1) ? jogoData.team1 : jogoData.team2;
        const isTeam1 = lojaDoDistrito === jogoData.team1;
        const scoreDistrito = isTeam1 ? score1 : score2;
        const scoreAdversário = isTeam1 ? score2 : score1;

        if (resultado === 'vitoria') return scoreDistrito > scoreAdversário;
        if (resultado === 'empate') return scoreDistrito === scoreAdversário;
        if (resultado === 'derrota') return scoreDistrito < scoreAdversário;
        return true;
    });
}
