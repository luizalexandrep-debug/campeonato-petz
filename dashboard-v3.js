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
    filtroRegionalHome: null // Filtro de regional aplicado às tabelas da home
};

const REGIONAL_DESTAQUE = 'R2 - Luiz';

// ============================================================
// UTILIDADES
// ============================================================

function evolucaoPct(anterior, atual) {
    // Regras do campeonato (iguais às do backend, em calculo_rapido.evolucao_pct):
    //  - sem base (semana anterior = 0)   -> 0%
    //  - tinha valor e zerou nesta semana -> 0% (zero = sem dado, não -100%)
    //  - caso normal -> variação percentual
    if (anterior === 0) return 0;
    if (atual === 0) return 0;
    return (atual - anterior) / anterior * 100;
}

function formatarPercentual(valor) {
    // Valor vem como fração (0.0021 = 0,21%)
    return (valor * 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    }) + '%';
}

function formatarValor(valor, tipo) {
    return tipo === '%' ? formatarPercentual(valor) : formatarMoedaBR(valor);
}

function formatarMoedaBR(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor);
}

// ============================================================
// FUNÇÕES DE ESTATÍSTICAS
// ============================================================

// Jogo sem resultado: a rodada ainda não tem nenhum dia lançado na semana
// atual. Sem evolução para medir, não se atribui vitória, empate nem derrota.
function semResultado(j) {
    return !!(j && j.semDados) || !!(state.gamesSummary && state.gamesSummary.semDadosAtual);
}

function calcularEstatisticas(jogosComDados, lojas) {
    let vitórias = 0, empates = 0, derrotas = 0;
    const resultadosPorGol = {}; // Rastrear resultado por indicador

    jogosComDados.forEach(jogoData => {
        if (jogoData.erro || semResultado(jogoData)) return;

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
        if (jogoData.erro || semResultado(jogoData)) return;

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
        if (semResultado(gameData)) return;
        const gols = gameData.golsProjetados || {};
        [[gameData.team1, 1], [gameData.team2, 2]].forEach(([team, teamNum]) => {
            if (!lojas.includes(team)) return;
            Object.entries(gols).forEach(([ind, vencedor]) => {
                if (!analise[ind]) {
                    analise[ind] = { vitórias: 0, derrotas: 0, empates: 0, total: 0,
                                     lojasVitoria: [], lojasDerrota: [], lojasEmpate: [] };
                }
                if (vencedor === teamNum) { analise[ind].vitórias++; analise[ind].lojasVitoria.push(team); }
                else if (vencedor === 0) { analise[ind].empates++; analise[ind].lojasEmpate.push(team); }
                else { analise[ind].derrotas++; analise[ind].lojasDerrota.push(team); }
                analise[ind].total++;
            });
        });
    });
    return analise;
}

let _golTip = null;
function setupGolTooltip() {
    // Tooltip customizado instantâneo para as barras de Análise por Gol.
    if (_golTip) return;
    _golTip = document.createElement('div');
    _golTip.id = 'golTooltip';
    _golTip.style.cssText = 'position:fixed; z-index:99999; pointer-events:none; ' +
        'background:rgba(25,25,25,0.96); color:#fff; padding:6px 10px; border-radius:6px; ' +
        'font-size:12px; line-height:1.45; max-width:280px; display:none; ' +
        'box-shadow:0 3px 12px rgba(0,0,0,0.35);';
    document.body.appendChild(_golTip);

    document.addEventListener('mousemove', (e) => {
        const bar = e.target.closest && e.target.closest('.gol-item-bar-win, .gol-item-bar-loss');
        if (bar && bar.dataset.lojas) {
            const isWin = bar.classList.contains('gol-item-bar-win');
            _golTip.textContent = bar.dataset.lojas;
            _golTip.style.borderLeft = `3px solid ${isWin ? '#2ecc71' : '#e74c3c'}`;
            _golTip.style.display = 'block';
            let x = e.clientX + 14, y = e.clientY + 14;
            const r = _golTip.getBoundingClientRect();
            if (x + r.width > window.innerWidth) x = e.clientX - r.width - 14;
            if (y + r.height > window.innerHeight) y = e.clientY - r.height - 14;
            _golTip.style.left = x + 'px';
            _golTip.style.top = y + 'px';
        } else if (_golTip.style.display !== 'none') {
            _golTip.style.display = 'none';
        }
    });
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

        // Se hojeIdx for definido, considerar apenas até hoje
        const diasAcontar = hojeIdx !== null
            ? diasOrdenados.slice(0, hojeIdx + 1)
            : diasOrdenados;

        // Indicador percentual (share) agrega por MÉDIA dos dias com dado;
        // monetário agrega por SOMA. Tipo vem detectado do backend.
        const ehPct = (dados1.atual?.type || dados1.anterior?.type) === '%';
        const agregar = (diasObj) => {
            const vals = diasAcontar.map(d => diasObj[d] || 0);
            if (!ehPct) return vals.reduce((a, b) => a + b, 0);
            const comDado = vals.filter(v => v);
            return comDado.length ? comDado.reduce((a, b) => a + b, 0) / comDado.length : 0;
        };

        const total1Anterior = agregar(dias1Anterior);
        const total1Atual = agregar(dias1Atual);
        const total2Anterior = agregar(dias2Anterior);
        const total2Atual = agregar(dias2Atual);

        // Calcular evolução percentual (mesma regra do backend)
        const evolucao1Pct = evolucaoPct(total1Anterior, total1Atual);
        const evolucao2Pct = evolucaoPct(total2Anterior, total2Atual);

        // Quem evoluiu mais percentualmente = 1 ponto
        if (evolucao1Pct > evolucao2Pct) {
            score1 += 1;
        } else if (evolucao2Pct > evolucao1Pct) {
            score2 += 1;
        } else {
            // Evoluções iguais: desempate em cascata — 1º maior valor na semana
            // atual, 2º maior valor na anterior. Mesma regra do backend.
            if (total1Atual > total2Atual) score1 += 1;
            else if (total2Atual > total1Atual) score2 += 1;
            else if (total1Anterior > total2Anterior) score1 += 1;
            else if (total2Anterior > total1Anterior) score2 += 1;
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

        // Descobrir a semana vigente (detectada pelos confrontos disponíveis)
        await loadSemana();

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
        document.getElementById('inicioBtn').addEventListener('click', voltarDashboard);
        setupGolTooltip();
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
    // Prefere a estrutura do SharePoint (via backend); cai para o arquivo local
    try {
        const r = await fetch('/api/estrutura', { cache: 'no-store' });
        if (r.ok) {
            const d = await r.json();
            if (d && !d.error && Object.keys(d).length) {
                state.estrutura = d;
                populateRegionalFilter();
                return;
            }
        }
    } catch (e) { /* segue para o fallback */ }
    try {
        const response = await fetch('estrutura.json', { cache: 'no-store' });
        state.estrutura = await response.json();
        populateRegionalFilter();
    } catch (error) {
        console.error('Erro ao carregar estrutura:', error);
    }
}

async function loadSemana() {
    // A semana vem do backend (maior "Semana N.xlsx" na pasta Confrontos).
    // Assim, ao subir a semana seguinte no SharePoint, o site se atualiza sozinho.
    try {
        const r = await fetch('/api/semana', { cache: 'no-store' });
        const d = await r.json();
        if (d && d.semana) {
            state.semana = d.semana;
            const h1 = document.querySelector('.header h1');
            if (h1) h1.textContent = `Campeonato Petz 2026 - Semana ${d.semana}`;
            document.title = `Campeonato Petz - Semana ${d.semana}`;
            console.log(`📅 Semana vigente: ${d.semana} (disponíveis: ${d.disponiveis})`);
        }
    } catch (e) {
        console.error('Não foi possível detectar a semana; usando', state.semana, e);
    }
}

async function loadHistorico() {
    // Prefere o histórico do SharePoint (via backend); cai para o arquivo local
    try {
        const r = await fetch('/api/historico', { cache: 'no-store' });
        if (r.ok) {
            const d = await r.json();
            if (d && d.distritos) {
                state.historico = d;
                console.log(`📚 Histórico: ${d.rodadasAnteriores} rodadas (${d.origem || 'arquivo'})`);
                return;
            }
        }
    } catch (e) { /* segue para o fallback */ }
    try {
        const response = await fetch('historico.json', { cache: 'no-store' });
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
    (state.gamesSummary?.games || []).filter(g => !semResultado(g)).forEach(g => {
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
            const simAvg = totGm > 0 ? totPts / totGm : 0;   // pontos por jogo
            linhas.push({
                regional: reg,
                distrito: dist,
                nLojas: n,
                histAvg: histGm > 0 ? histPts / histGm : 0,
                curAvg: cGm > 0 ? cPts / cGm : 0,
                simAvg,
                // Escala do Power BI: pontos ACUMULADOS ÷ nº de lojas.
                // histAcum = o próprio número do ranking oficial (ex.: 12,42)
                // simAcum  = como fica somando a rodada atual (ex.: 13,42)
                histAcum: h ? h.pontuacaoMedia : 0,
                simAcum: n > 0 ? totPts / n : 0,
                acumConq: totPts,   // pontos acumulados (histórico + rodada atual)
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

    (state.gamesSummary?.games || []).filter(g => !semResultado(g)).forEach(g => {
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

function setaEvol(r) {
    const diff = r.curAvg - r.histAvg;
    if (Math.abs(diff) < 0.05) return '<span style="color:#888;">➡️ estável</span>';
    return diff > 0
        ? `<span style="color:#11998e;">▲ +${diff.toFixed(2)}</span>`
        : `<span style="color:#c0392b;">▼ ${diff.toFixed(2)}</span>`;
}

function voltarDashboard() {
    // Retorna à primeira tela (dashboard de rankings), limpando tudo
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

function insightsR2Html(simulado) {
    // Seção de destaque da regional (R2): cards por distrito com insights.
    const meus = simulado.filter(r => r.regional === REGIONAL_DESTAQUE);
    if (!meus.length) return '';

    const cards = meus.map(r => {
        const lojas = state.estrutura[r.regional][r.distrito];
        const ins = insightsDistrito(r.distrito, lojas);
        const up = ins.lojasUp.length ? ins.lojasUp.join(', ') : '—';
        const down = ins.lojasDown.length ? ins.lojasDown.join(', ') : '—';
        return `
        <div style="background:white; border-radius:12px; padding:18px; box-shadow:0 2px 10px rgba(0,0,0,0.08); border-left:5px solid #2b5aa8;">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
                <span style="font-weight:700; font-size:1.1em;">#${r.posicao} ${badgeVariacao(r.variacao)} · ${r.distrito}</span>
                <span style="color:#2b5aa8; font-weight:bold; font-size:1.25em;">${r.simAcum.toFixed(2)} pts</span>
            </div>
            <div style="font-size:0.88em; color:#666; margin:6px 0 10px;">
                Base ${r.histAcum.toFixed(2)} + rodada ${r.curAvg.toFixed(2)} · ritmo ${setaEvol(r)}
            </div>
            <div style="font-size:0.88em; line-height:1.6;">
                <div>💪 <b>Puxando pra cima:</b> ${up}</div>
                <div>📉 <b>Puxando pra baixo:</b> ${down}</div>
                <div>⚽ <b>Gol mais fraco:</b> ${ins.golFraco ? `${ins.golFraco.nome} (${ins.golFraco.v}/${ins.golFraco.total})` : '—'}</div>
                <div>🔥 <b>Gol mais forte:</b> ${ins.golForte ? `${ins.golForte.nome} (${ins.golForte.v}/${ins.golForte.total})` : '—'}</div>
            </div>
        </div>`;
    }).join('');

    const melhorMeu = meus.reduce((a, b) => (b.simAvg > a.simAvg ? b : a), meus[0]);
    const piorMeu = meus.reduce((a, b) => (b.simAvg < a.simAvg ? b : a), meus[0]);
    const subindo = meus.filter(r => r.curAvg > r.histAvg + 0.05);
    const caindo = meus.filter(r => r.curAvg < r.histAvg - 0.05);

    return `
    <div class="panel">
        <div style="background:linear-gradient(135deg,#2b5aa8,#1e2a5a); color:white; border-radius:12px; padding:16px 20px; margin-bottom:16px;">
            <h2 style="margin:0 0 6px;">🔥 Seus Distritos — ${REGIONAL_DESTAQUE}</h2>
            <div style="opacity:0.9; font-size:0.92em;">
                Melhor: <b>${melhorMeu.distrito}</b> (#${melhorMeu.posicao}, ${melhorMeu.simAcum.toFixed(2)}) ·
                Atenção: <b>${piorMeu.distrito}</b> (#${piorMeu.posicao}, ${piorMeu.simAcum.toFixed(2)})<br>
                ${subindo.length ? `📈 Subindo: ${subindo.map(r => r.distrito).join(', ')}. ` : ''}
                ${caindo.length ? `📉 Caindo: ${caindo.map(r => r.distrito).join(', ')}.` : ''}
            </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr)); gap:16px;">
            ${cards}
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
            infoBar.innerHTML = `<button onclick="document.getElementById('filterRegional').value=''; document.getElementById('filterDistrito').value=''; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true }));" style="background: #2b5aa8; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-right: 15px;">← Voltar ao Ranking</button>`;
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

function filtrarHomePorRegional(regional) {
    // Alterna o filtro das tabelas da home (vazio = todas)
    state.filtroRegionalHome = regional || null;
    loadRankingDashboard();
}

function loadRankingDashboard() {
    const container = document.getElementById('gamesContainer');
    const infoBar = document.getElementById('infoBar');
    const statsSection = document.getElementById('statsSection');

    statsSection.style.display = 'none';

    // Barra de filtro por regional (aplica às duas tabelas da home)
    const fSel = state.filtroRegionalHome;
    const btnsFiltro = ['Todas', ...Object.keys(state.estrutura)].map(nome => {
        const val = nome === 'Todas' ? '' : nome;
        const ativo = (fSel || '') === val;
        return `<button class="filtro-reg${ativo ? ' ativo' : ''}" onclick="filtrarHomePorRegional('${val.replace(/'/g, "\\'")}')">${nome}</button>`;
    }).join('');
    infoBar.innerHTML = `<div class="filtro-bar"><span class="filtro-label">Filtrar por regional:</span>${btnsFiltro}</div>`;

    // Calcular pontuação por regional
    const rankingRegional = {};
    Object.keys(state.estrutura).forEach(regional => {
        rankingRegional[regional] = { vitórias: 0, total: 0, pontuacao: 0 };
    });

    // Calcular pontuação por distrito (com V/E/D)
    const rankingDistrito = {};
    Object.keys(state.estrutura).forEach(regional => {
        Object.keys(state.estrutura[regional]).forEach(distrito => {
            rankingDistrito[`${regional} > ${distrito}`] = {
                V: 0, E: 0, D: 0, total: 0, pontuacao: 0,
                lojas: state.estrutura[regional][distrito]
            };
        });
    });
    const regV = {};
    Object.keys(state.estrutura).forEach(r => { regV[r] = { V: 0, E: 0, D: 0 }; });

    // Índice loja -> {regional, distrito} (evita varrer toda a estrutura por jogo)
    const loja2dist = {};
    Object.keys(state.estrutura).forEach(regional => {
        Object.keys(state.estrutura[regional]).forEach(distrito => {
            state.estrutura[regional][distrito].forEach(l => {
                loja2dist[l] = { regional, distrito };
            });
        });
    });

    // Processar cada jogo
    state.gamesSummary.games.filter(g => !semResultado(g)).forEach(game => {
        const [score1, score2] = game.scoreProjected.split('x').map(s => parseInt(s.trim()));
        [[game.team1, score1, score2], [game.team2, score2, score1]].forEach(([team, meu, adv]) => {
            const info = loja2dist[team];
            if (!info) return;
            const { regional, distrito } = info;
            const pontos = meu > adv ? 3 : (meu === adv ? 1 : 0);
            const chave = `${regional} > ${distrito}`;
            rankingRegional[regional].pontuacao += pontos;
            rankingRegional[regional].total++;
            rankingDistrito[chave].pontuacao += pontos;
            rankingDistrito[chave].total++;
            if (meu > adv) { rankingDistrito[chave].V++; regV[regional].V++; }
            else if (meu === adv) { rankingDistrito[chave].E++; regV[regional].E++; }
            else { rankingDistrito[chave].D++; regV[regional].D++; }
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

    // Ranking simulado (base + rodada atual) para a coluna da direita
    const simulado = (state.historico && state.gamesSummary) ? calcularRankingSimulado() : [];

    const medalhaFn = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
    const esc = (s) => s.replace(/'/g, "\\'");
    const clkDist = (reg, dist) => `document.getElementById('filterRegional').value='${esc(reg)}'; document.getElementById('filterRegional').dispatchEvent(new Event('change',{bubbles:true})); setTimeout(function(){ document.getElementById('filterDistrito').value='${esc(dist)}'; document.getElementById('filterDistrito').dispatchEvent(new Event('change',{bubbles:true})); }, 300);`;
    const clkReg = (reg) => `document.getElementById('filterRegional').value='${esc(reg)}'; document.getElementById('filterRegional').dispatchEvent(new Event('change',{bubbles:true}));`;
    const hover = `onmouseover="this.style.background='#f7f8ff'" onmouseout="this.style.background='transparent'"`;

    // COLUNA 1 — regionais com distritos aninhados
    const colRegionais = ranking1
        // guarda a posição no ranking GERAL antes de filtrar (medalha correta)
        .map((r, idx) => ({ ...r, posGeral: idx }))
        .filter(r => !state.filtroRegionalHome || r.nome === state.filtroRegionalHome)
        .map((r) => {
        const idx = r.posGeral;
        const dists = distritosPorRegional[r.nome] || [];
        return `
        <div style="background:white; border-radius:12px; margin-bottom:14px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:linear-gradient(135deg,#2b5aa8,#1e2a5a); color:white; cursor:pointer;"
                 title="Ver a regional ${r.nome}" onclick="${clkReg(r.nome)}">
                <span style="font-weight:700; font-size:1.05em;">${medalhaFn(idx)} ${r.nome}</span>
                <span style="font-weight:bold;">${r.media} pts</span>
            </div>
            <div style="padding:6px 12px 10px;">
                ${dists.map((d, di) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:7px 8px; border-bottom:1px solid #f2f2f2; cursor:pointer;"
                         ${hover} title="Ver ${d.distrito}" onclick="${clkDist(r.nome, d.distrito)}">
                        <span style="font-size:0.9em;"><span style="color:#999;">${di + 1}.</span> ${d.distrito}</span>
                        <span style="color:#2b5aa8; font-weight:600; font-size:0.9em;">${d.media.toFixed(2)}</span>
                    </div>`).join('')}
            </div>
        </div>`;
    }).join('');

    // ---------- Dados por distrito para as tabelas ----------
    const f2 = (x) => x.toFixed(2).replace('.', ',');
    const fp = (x) => x.toFixed(1).replace('.', ',') + '%';
    const simMap = {};
    simulado.forEach(s => { simMap[s.distrito] = s; });

    const dadosDist = Object.entries(rankingDistrito).map(([nome, d]) => {
        const sep = nome.indexOf(' > ');
        const reg = nome.slice(0, sep);
        const dist = nome.slice(sep + 3);
        const disp = d.total * 3;
        return {
            reg, dist, V: d.V, E: d.E, D: d.D,
            conq: d.pontuacao, disp,
            media: d.total > 0 ? d.pontuacao / d.total : 0,
            aprov: disp > 0 ? d.pontuacao / disp * 100 : 0,
            sim: simMap[dist] || null
        };
    });

    const porMediaAtual = [...dadosDist].sort((a, b) => b.media - a.media);
    porMediaAtual.forEach((r, i) => { r.rankAtual = i + 1; });

    // Totais por regional (rodada atual)
    const totReg = {};
    dadosDist.forEach(r => {
        const t = totReg[r.reg] || (totReg[r.reg] = { V: 0, E: 0, D: 0, conq: 0, disp: 0 });
        t.V += r.V; t.E += r.E; t.D += r.D; t.conq += r.conq; t.disp += r.disp;
    });
    Object.values(totReg).forEach(t => {
        const jogos = t.V + t.E + t.D;
        t.media = jogos > 0 ? t.conq / jogos : 0;
        t.aprov = t.disp > 0 ? t.conq / t.disp * 100 : 0;
    });
    const nomeReg = (reg) => {
        const p = reg.split(' - ');
        return p.length > 1 ? `Regional ${p[0].replace('R', '')} (${p[1]})` : reg;
    };

    // ---------- TABELA 1: rodada atual ----------
    // O filtro esconde linhas de outras regionais, mas a posição (#) continua
    // sendo a do ranking GERAL.
    const passaFiltro = (reg) => !state.filtroRegionalHome || reg === state.filtroRegionalHome;
    const linhasAtual = porMediaAtual.filter(r => passaFiltro(r.reg)).map(r => {
        const dest = r.reg === REGIONAL_DESTAQUE;
        return `<tr class="clk${dest ? ' dest' : ''}" onclick="${clkDist(r.reg, r.dist)}" title="Ver ${r.dist}">
            <td class="c b">${medalhaFn(r.rankAtual - 1)}</td>
            <td class="l">${r.dist}</td><td class="l reg">${r.reg}</td>
            <td class="c">${r.V}</td><td class="c">${r.E}</td><td class="c">${r.D}</td>
            <td class="c b">${f2(r.media)}</td><td class="c">${r.conq}/${r.disp}</td>
            <td class="c b">${fp(r.aprov)}</td></tr>`;
    }).join('') + Object.entries(totReg).filter(([reg]) => passaFiltro(reg))
        .sort((a, b) => b[1].media - a[1].media).map(([reg, t]) => `
        <tr class="tot"><td></td><td class="l" colspan="2">${nomeReg(reg)}</td>
            <td class="c">${t.V}</td><td class="c">${t.E}</td><td class="c">${t.D}</td>
            <td class="c b">${f2(t.media)}</td><td class="c">${t.conq}/${t.disp}</td>
            <td class="c b">${fp(t.aprov)}</td></tr>`).join('');

    // ---------- TABELA 2: acumulado simulado ----------
    let secaoAcumulado = '';
    if (simulado.length) {
        const rodadas = state.historico.rodadasAnteriores;
        const porSim = [...dadosDist].filter(r => r.sim).sort((a, b) => a.sim.posicao - b.sim.posicao);

        const totAcum = {};
        porSim.forEach(r => {
            const nLojas = state.estrutura[r.reg][r.dist].length;
            const hConq = Math.round(r.sim.histAcum * nLojas);   // pontos históricos
            const hDisp = rodadas * nLojas * 3;
            const t = totAcum[r.reg] || (totAcum[r.reg] = { conq: 0, disp: 0, lojas: 0 });
            t.conq += hConq + r.conq;
            t.disp += hDisp + r.disp;
            t.lojas += nLojas;
            r.aConq = hConq + r.conq;
            r.aDisp = hDisp + r.disp;
        });
        Object.values(totAcum).forEach(t => {
            // Mesma definição do ranking oficial: pontos acumulados ÷ nº de lojas
            t.media = t.lojas > 0 ? t.conq / t.lojas : 0;
            t.aprov = t.disp > 0 ? t.conq / t.disp * 100 : 0;
        });

        const linhasAcum = porSim.filter(r => passaFiltro(r.reg)).map(r => {
            const dest = r.reg === REGIONAL_DESTAQUE;
            // Variação em relação ao ranking das RODADAS ANTERIORES (base),
            // não ao ranking da rodada atual.
            const mov = r.sim.variacao;
            const movHtml = mov > 0 ? `<span style="color:#16a34a;font-weight:700;">▲${mov}</span>`
                : mov < 0 ? `<span style="color:#dc2626;font-weight:700;">▼${-mov}</span>`
                : '<span style="color:#cbd5e1;">—</span>';
            return `<tr class="clk${dest ? ' dest' : ''}" onclick="${clkDist(r.reg, r.dist)}" title="Ver ${r.dist}">
                <td class="c b">${medalhaFn(r.sim.posicao - 1)}</td><td class="c">${movHtml}</td>
                <td class="l">${r.dist}</td><td class="l reg">${r.reg}</td>
                <td class="c">${f2(r.sim.histAcum)}</td><td class="c">${f2(r.sim.curAvg)}</td>
                <td class="c b">${f2(r.sim.simAcum)}</td><td class="c">${r.aConq}/${r.aDisp}</td>
                <td class="c b">${fp(r.aConq / r.aDisp * 100)}</td></tr>`;
        }).join('') + Object.entries(totAcum).filter(([reg]) => passaFiltro(reg))
            .sort((a, b) => b[1].media - a[1].media).map(([reg, t]) => `
            <tr class="tot"><td></td><td></td><td class="l" colspan="2">${nomeReg(reg)}</td>
                <td class="c">—</td><td class="c">${f2(totReg[reg].media)}</td>
                <td class="c b">${f2(t.media)}</td><td class="c">${t.conq}/${t.disp}</td>
                <td class="c b">${fp(t.aprov)}</td></tr>`).join('');

        secaoAcumulado = `
        <section class="sec acum">
            <div class="sec-head">📊 ACUMULADO SIMULADO <small>· rodadas 1-${rodadas} + rodada ${state.semana} (atual)</small></div>
            ${rodadas < state.semana - 1 ? `<div class="alerta-hist">⚠️ O histórico está com <b>${rodadas} rodada(s)</b>, mas a rodada atual é a <b>${state.semana}</b> — as rodadas ${rodadas + 1} a ${state.semana - 1} não estão sendo somadas. Atualize o ranking na pasta <b>Histórico ranking distritais</b> do SharePoint.</div>` : ''}
            <div class="sec-body">
                <div class="tbl-wrap"><table class="rank-table">
                    <thead><tr><th>#</th><th title="Variação de posição em relação ao ranking das rodadas anteriores (base)">Mov.</th><th class="l">Distrito</th><th class="l">Regional</th>
                        <th title="Pontuação média acumulada até a rodada ${rodadas} (ranking oficial)">Base (R1-${rodadas})</th>
                        <th title="Pontos por jogo na rodada em andamento">Rodada ${state.semana}</th>
                        <th title="Base + rodada atual, na mesma escala do ranking oficial">Simulada (R1-${state.semana})</th>
                        <th>Pontos</th><th>% Aprov.</th></tr></thead>
                    <tbody>${linhasAcum}</tbody>
                </table></div>
                ${insightsR2Html(simulado)}
            </div>
        </section>`;
    }

    // ---------- Alerta de indicador sem dados ----------
    const avisos = state.gamesSummary?.avisos || [];
    const blocoAvisos = avisos.length ? `
        <div class="alerta-dados">
            <div class="alerta-titulo">⚠️ Atenção: indicador sem dados</div>
            <ul>${avisos.map(a => `<li><b>${a.indicador}</b> (${a.semana}) subiu zerado — esse gol não está sendo disputado, então os placares somam menos de 6.</li>`).join('')}</ul>
            <div class="alerta-dica">Dica: na planilha, use <b>Colar Especial → Somente Valores</b> antes de subir, para as fórmulas não zerarem ao fechar a origem.</div>
        </div>` : '';

    // ---------- Render ----------
    container.innerHTML = `
    ${blocoAvisos}
    <div class="home-sections">
        <section class="sec atual">
            <div class="sec-head">📅 RODADA ATUAL <small>· desempenho desta semana, ao vivo</small></div>
            <div class="sec-body">
                <div class="tbl-wrap"><table class="rank-table">
                    <thead><tr><th>#</th><th class="l">Distrito</th><th class="l">Regional</th>
                        <th>V</th><th>E</th><th>D</th><th>Pontuação Média</th><th>Pontos</th><th>% Aprov.</th></tr></thead>
                    <tbody>${linhasAtual}</tbody>
                </table></div>
                <div class="panel">
                    <h4>🏆 Regionais</h4>
                    <div class="hint">clique p/ abrir a regional ou um distrito</div>
                    <div class="reg-grid">${colRegionais}</div>
                </div>
            </div>
        </section>
        ${secaoAcumulado}
    </div>`;
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
        if (semResultado(gameData)) return;
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

    infoBar.innerHTML = `<button onclick="document.getElementById('filterRegional').value=''; document.getElementById('filterDistrito').value=''; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true }));" style="background: #2b5aa8; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-right: 15px;">← Voltar ao Ranking</button><span>📊 ${jogosFiltrados.length} jogos da regional (resumo rápido)</span>`;

    // Renderizar cards simplificados (sem dados detalhados)
    container.innerHTML = '';
    jogosFiltrados.forEach(gameData => {
        const [score1, score2] = gameData.scoreProjected.split('x').map(s => parseInt(s.trim()));
        const lojaDoRegional = lojas.includes(gameData.team1) ? gameData.team1 : gameData.team2;
        const isTeam1 = lojaDoRegional === gameData.team1;
        const scoreRegional = isTeam1 ? score1 : score2;
        const scoreAdversário = isTeam1 ? score2 : score1;

        let resultClass = 'empate';
        let resultText = semResultado(gameData) ? '⏳ AGUARDANDO DADOS DA RODADA' : '⚖️ EMPATANDO';
        if (!semResultado(gameData) && scoreRegional > scoreAdversário) {
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
        if (semResultado(gameData)) return;
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

    infoBar.innerHTML = `<button onclick="document.getElementById('filterRegional').value=''; document.getElementById('filterDistrito').value=''; document.getElementById('filterRegional').dispatchEvent(new Event('change', { bubbles: true }));" style="background: #2b5aa8; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-right: 15px;">← Voltar ao Ranking</button><span>📊 ${jogosFiltrados.length} jogos carregando detalhes...</span>`;

    // Renderizar cards do resumo
    container.innerHTML = '';
    jogosFiltrados.forEach(gameData => {
        const [score1, score2] = gameData.scoreProjected.split('x').map(s => parseInt(s.trim()));
        const lojaDoDistrito = lojas.includes(gameData.team1) ? gameData.team1 : gameData.team2;
        const isTeam1 = lojaDoDistrito === gameData.team1;
        const scoreDistrito = isTeam1 ? score1 : score2;
        const scoreAdversário = isTeam1 ? score2 : score1;

        let resultClass = 'empate';
        let resultText = semResultado(gameData) ? '⏳ AGUARDANDO DADOS DA RODADA' : '⚖️ EMPATANDO';
        if (!semResultado(gameData) && scoreDistrito > scoreAdversário) {
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

    // Header com placar. Sem nenhum dia lançado na semana atual o placar não
    // existe (0 x 0) — o cálculo local não deve inventar gols por desempate.
    const [score1, score2] = (!semResultado(jogoData) && score && score.includes('x'))
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
    let resultText = semResultado(jogoData) ? '⏳ AGUARDANDO DADOS DA RODADA' : '⚖️ EMPATANDO';
    if (semResultado(jogoData)) {
        // rodada sem nenhum dia lançado: nenhum resultado atribuído
    } else if (scoreDistrito > scoreAdversário) {
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
                        <span style="font-size: 0.85em; color: #999; font-weight: 600;">${semResultado(jogoData) ? '0 x 0' : scoreAcumulado}</span>
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

    // Tipo detectado automaticamente no backend ('%' ou 'R$')
    const tipo = dados.atual?.type || dados.anterior?.type || 'R$';
    const ehPct = tipo === '%';
    const fmt = (v) => formatarValor(v, tipo);
    // Percentual agrega por MÉDIA dos dias com dado; monetário por SOMA
    const agregar = (diasObj) => {
        const vals = diasOrdenados.map(d => (diasObj || {})[d] || 0);
        if (!ehPct) return vals.reduce((a, b) => a + b, 0);
        const comDado = vals.filter(v => v);
        return comDado.length ? comDado.reduce((a, b) => a + b, 0) / comDado.length : 0;
    };

    let totalAnterior = 0;
    let totalAtual = 0;

    // Se houver adversário, calcular totais dele também para comparação
    let totalAdversarioAnterior = 0;
    let totalAdversarioAtual = 0;
    if (dadosAdversario) {
        totalAdversarioAnterior = agregar(dadosAdversario.anterior?.dias);
        totalAdversarioAtual = agregar(dadosAdversario.atual?.dias);
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

        const evolucao = valorAnterior !== 0 ? ((valorAtual - valorAnterior) / valorAnterior * 100) : 0;
        const evoluClass = evolucao > 0 ? 'positive' : evolucao < 0 ? 'negative' : 'neutral';

        html += `
            <tr>
                <td class="day-label">${dia}</td>
                <td class="value-anterior">${fmt(valorAnterior)}</td>
                <td class="value-atual">${fmt(valorAtual)}</td>
                <td class="evolution ${evoluClass}">${evolucao.toFixed(2)}%</td>
            </tr>
        `;
    });

    // Totais (soma para R$, média dos dias com dado para %)
    totalAnterior = agregar(dados.anterior?.dias);
    totalAtual = agregar(dados.atual?.dias);

    // Mesma regra do placar (zerou nesta semana = 0%, não -100%)
    const evolucaoTotal = evolucaoPct(totalAnterior, totalAtual);
    const evoluClassTotal = evolucaoTotal > 0 ? 'positive' : evolucaoTotal < 0 ? 'negative' : 'neutral';

    // Comparativo com adversário: aplicar cores apenas na célula de evolução
    let classeEvolucao = evoluClassTotal;
    let faltaVirar = null; // R$ que ESTE time precisa vender a mais p/ virar o indicador
    if (dadosAdversario) {
        const evolucaoAdversario = evolucaoPct(totalAdversarioAnterior, totalAdversarioAtual);

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
                    <td class="day-label">${ehPct ? 'MÉDIA' : 'TOTAL'}</td>
                    <td style="text-align: center;">${fmt(totalAnterior)}</td>
                    <td style="text-align: center;">${fmt(totalAtual)}</td>
                    <td class="evolution ${classeEvolucao}" style="text-align: center;">${evolucaoTotal.toFixed(2)}%</td>
                </tr>
    `;

    if (faltaVirar !== null) {
        const rotulo = ehPct ? 'Falta p/ virar (média)' : 'Falta p/ virar';
        const dica = ehPct
            ? `${teamName} precisa subir +${fmt(faltaVirar)} na média para virar este gol`
            : `${teamName} precisa vender +${fmt(faltaVirar)} na S. Atual para virar este gol`;
        html += `
                <tr class="virar-row">
                    <td class="day-label" style="font-size: 0.78em; color: #999;">${rotulo}</td>
                    <td></td>
                    <td style="text-align: center; background: #fff3b0; font-weight: 700; color: #7a5c00;"
                        title="${dica}">
                        +${fmt(faltaVirar)}
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
            total: dados.total,
            lojasVitoria: dados.lojasVitoria || [],
            lojasDerrota: dados.lojasDerrota || []
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
                    <div class="gol-item-bar-win" style="width: ${percentualVitórias}%; cursor: help;" data-lojas="${gol.lojasVitoria.join(', ')}">
                        ${gol.vitórias > 0 ? gol.vitórias : ''}
                    </div>
                    <div class="gol-item-bar-loss" style="width: ${percentualDerrotas}%; cursor: help;" data-lojas="${gol.lojasDerrota.join(', ')}">
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
