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
    filtroRegionalHome: null, // Filtro de regional aplicado às tabelas da home
    semanaVigente: null,      // Rodada mais recente com confrontos publicados
    semanasDisponiveis: [],   // Rodadas que podem ser abertas no seletor
    semanaEscolhida: false    // O usuário escolheu manualmente uma rodada?
};

const REGIONAL_DESTAQUE = 'R2 - Luiz';

// ============================================================
// UTILIDADES
// ============================================================

// Chave da coluna 'Total' da planilha (vem do backend junto com os dias).
const CHAVE_TOTAL = '__total__';
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// Agregação de indicador percentual: sempre o 'Total' da planilha quando ele
// existe (em share é receita/receita, o número oficial), inclusive com a semana
// incompleta. Média dos dias só como plano B, sem coluna de total.
function agregarPct(diasObj, diasAcontar) {
    const o = diasObj || {};
    if (o[CHAVE_TOTAL]) return o[CHAVE_TOTAL];
    const vals = diasAcontar.map(d => o[d] || 0).filter(v => v);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function evolucaoPct(anterior, atual) {
    // Regras do campeonato (iguais às do backend, em calculo_rapido.evolucao_pct):
    //  - sem base (semana anterior = 0)   -> 0%
    //  - tinha base e nada nesta semana   -> -100% (não vendeu nada)
    //  - caso normal -> variação percentual
    // O -100% importa no meio da semana: com um dia contra sete, todo mundo
    // está perto de -85%, e um 0% de quem não tem dado passaria na frente de
    // quem vendeu.
    if (anterior === 0) return 0;
    if (atual === 0) return -100;
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
// VENDAS é o gol fixo do campeonato, então encabeça qualquer lista de
// indicadores; os demais seguem em ordem alfabética.
// Gols marcados no nome do arquivo como disputados por NÍVEL — vale o valor da
// própria semana, não a evolução sobre a anterior. Precisa casar com
// MARCADORES_NIVEL em calculo_rapido.py.
const MARCADORES_NIVEL = ['(ATUAL)', '(NIVEL)', '(NÍVEL)', '(SEM EVOLUCAO)', '(SEM EVOLUÇÃO)'];

function criterioDoNome(nome) {
    const alvo = String(nome || '').toUpperCase();
    return MARCADORES_NIVEL.some(m => alvo.includes(m)) ? 'nivel' : 'evolucao';
}

function nomeIndicador(arquivo) {
    let n = String(arquivo || '').replace(/\.xlsx$/i, '');
    MARCADORES_NIVEL.forEach(m => {
        n = n.replace(new RegExp(m.replace(/[()]/g, '\\$&'), 'ig'), '');
    });
    return n.replace(/\s+/g, ' ').trim();
}

function ordenarIndicadores(nomes) {
    const ehVendas = (n) => /^vendas\b/i.test(String(n).replace(/\.xlsx$/i, '').trim());
    return [...nomes].sort((a, b) => {
        const va = ehVendas(a), vb = ehVendas(b);
        if (va !== vb) return va ? -1 : 1;
        return String(a).localeCompare(String(b), 'pt');
    });
}

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
                // Somar só os dias — a chave de Total da planilha não entra.
                const somaDias = (d) => DIAS_SEMANA.reduce((a, k) => a + ((d || {})[k] || 0), 0);
                const total1Anterior = somaDias(dados1.anterior?.dias);
                const total1Atual = somaDias(dados1.atual?.dias);
                const total2Anterior = somaDias(dados2.anterior?.dias);
                const total2Atual = somaDias(dados2.atual?.dias);

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
        // Célula com texto de apoio (ex.: distância para o colocado à frente)
        const tip = e.target.closest && e.target.closest('.tem-tip[data-tip]');   // td ou span
        if (tip && tip.dataset.tip) {
            _golTip.innerHTML = tip.dataset.tip.split('\n').join('<br>');
            _golTip.style.borderLeft = '3px solid #2b5aa8';
            _golTip.style.display = 'block';
            let x = e.clientX + 14, y = e.clientY + 14;
            const r = _golTip.getBoundingClientRect();
            if (x + r.width > window.innerWidth) x = e.clientX - r.width - 14;
            if (y + r.height > window.innerHeight) y = e.clientY - r.height - 14;
            _golTip.style.left = x + 'px';
            _golTip.style.top = y + 'px';
            return;
        }

        // Números de V/E/D dos cards de distrito: lista os placares projetados
        const ved = e.target.closest && e.target.closest('.ved-n[data-jogos]');
        if (ved) {
            _golTip.innerHTML = `<b>${ved.dataset.titulo}</b><br>`
                + ved.dataset.jogos.split('\n').join('<br>');
            _golTip.style.borderLeft = `3px solid ${ved.classList.contains('v') ? '#2ecc71'
                : ved.classList.contains('d') ? '#e74c3c' : '#e0a800'}`;
            _golTip.style.display = 'block';
            let x = e.clientX + 14, y = e.clientY + 14;
            const r = _golTip.getBoundingClientRect();
            if (x + r.width > window.innerWidth) x = e.clientX - r.width - 14;
            if (y + r.height > window.innerHeight) y = e.clientY - r.height - 14;
            _golTip.style.left = x + 'px';
            _golTip.style.top = y + 'px';
            return;
        }

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

// Lojas eliminadas: o resultado é administrativo (0 x 6), não sai da planilha.
// A lista vem do backend no resumo dos jogos.
function lojaEliminada(sigla) {
    return (state.gamesSummary?.eliminadas || []).includes(String(sigla).toUpperCase());
}

function calcularPlacarLocal(dadosTeam1, dadosTeam2, hojeIdx = null, team1 = null, team2 = null) {
    // Jogo de loja eliminada não se calcula: perde todos os gols.
    if (team1 && team2 && (lojaEliminada(team1) || lojaEliminada(team2))) {
        const n = ordenarIndicadores(Object.keys(dadosTeam1 || {})).length || 6;
        const e1 = lojaEliminada(team1), e2 = lojaEliminada(team2);
        const s1 = e1 ? 0 : (e2 ? n : 0), s2 = e2 ? 0 : (e1 ? n : 0);
        return { score1: s1, score2: s2, score: `${s1} x ${s2}` };
    }
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
    const indicadores = ordenarIndicadores(Object.keys(dadosTeam1));

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
            if (ehPct) return agregarPct(diasObj, diasAcontar);
            return diasAcontar.map(d => (diasObj || {})[d] || 0).reduce((a, b) => a + b, 0);
        };

        const total1Anterior = agregar(dias1Anterior);
        const total1Atual = agregar(dias1Atual);
        const total2Anterior = agregar(dias2Anterior);
        const total2Atual = agregar(dias2Atual);

        // Gol por NÍVEL: vale o valor desta semana, sem olhar a anterior.
        const criterio = dados1.atual?.criterio || dados1.anterior?.criterio
            || criterioDoNome(indicador);
        if (criterio === 'nivel') {
            if (total1Atual > total2Atual) score1 += 1;
            else if (total2Atual > total1Atual) score2 += 1;
            return;
        }

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

// ============================================================
// PRESENÇA — quantos usuários online (visível só para o admin)
// ============================================================

let _presencaTimer = null;

async function atualizarPresenca() {
    const badge = document.getElementById('onlineBadge');
    if (!badge) return;
    try {
        const r = await fetch('/api/acessos', { cache: 'no-store' });
        if (!r.ok) { badge.style.display = 'none'; return; }
        const d = await r.json();
        badge.style.display = 'inline-flex';
        badge.innerHTML = `<span class="ponto"></span>${d.online} online`;
        badge.dataset.detalhe = JSON.stringify(d);
    } catch (e) {
        badge.style.display = 'none';
    }
}

function iniciarPresenca() {
    const badge = document.getElementById('onlineBadge');
    if (!badge) return;
    badge.onclick = abrirPainelAcessos;
    atualizarPresenca();
    if (_presencaTimer) clearInterval(_presencaTimer);
    // 5 min: cada atualização são consultas no banco, e a cota é limitada.
    _presencaTimer = setInterval(atualizarPresenca, 300000);
}

function _quando(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    const rel = min < 1 ? 'agora' : min < 60 ? `há ${min} min`
        : min < 1440 ? `há ${Math.floor(min / 60)} h` : `há ${Math.floor(min / 1440)} d`;
    return `${d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} <small>(${rel})</small>`;
}

async function abrirPainelAcessos() {
    await atualizarPresenca();
    const badge = document.getElementById('onlineBadge');
    const d = JSON.parse(badge.dataset.detalhe || '{}');

    const linha = (a, online) => `<tr>
        <td class="l"><b>${a.username}</b>${online ? ' <span class="ponto-min"></span>' : ''}</td>
        <td class="l">${a.local}</td>
        <td class="l"><small>${a.ip}</small></td>
        <td class="l"><small>${a.dispositivo}</small></td>
        <td class="l">${_quando(a.entrouEm)}</td>
        <td class="l">${_quando(a.vistoEm)}</td>
    </tr>`;

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-acessos">
            <div class="modal-head">
                <div class="cal-titulo">
                    <b>👥 Acessos</b>
                    <small>${d.online} usuário(s) online · ${d.sessoesOnline} sessão(ões) ativas
                        · considera atividade nos últimos ${d.janelaMinutos} min</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo">
                <h4 class="ac-titulo">Online agora</h4>
                <div class="tbl-wrap"><table class="md-tabela ac-tabela">
                    <thead><tr><th class="l">Usuário</th><th class="l">Local</th><th class="l">IP</th>
                        <th class="l">Dispositivo</th><th class="l">Entrou</th><th class="l">Visto</th></tr></thead>
                    <tbody>${d.sessoes?.length ? d.sessoes.map(a => linha(a, true)).join('')
                        : '<tr><td colspan="6">Ninguém online no momento.</td></tr>'}</tbody>
                </table></div>

                <h4 class="ac-titulo">Histórico de entradas <small>· últimas 60</small></h4>
                <div class="tbl-wrap"><table class="md-tabela ac-tabela">
                    <thead><tr><th class="l">Usuário</th><th class="l">Local</th><th class="l">IP</th>
                        <th class="l">Dispositivo</th><th class="l">Entrou</th><th class="l">Visto</th></tr></thead>
                    <tbody>${d.historico?.length ? d.historico.map(a => linha(a, false)).join('')
                        : '<tr><td colspan="6">Sem registros ainda.</td></tr>'}</tbody>
                </table></div>
                <div class="ac-nota">O local vem do IP, com precisão de cidade — serve para
                    reconhecer de onde partiu o acesso, não para localizar a pessoa.</div>
            </div>
        </div>`;

    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);
}

// ============================================================
// FAROL DOS GOLS — até que dia cada indicador foi lançado
// Verde: está no dia mais recente lançado. Vermelho: ficou para trás.
// ============================================================

async function carregarFarol() {
    const el = document.getElementById('farol');
    if (!el || !state.semana) return;
    try {
        const r = await fetch(`/api/farol/${state.semana}`, { cache: 'no-store' });
        if (!r.ok) { el.innerHTML = ''; return; }
        const d = await r.json();
        if (!d.indicadores?.length) { el.innerHTML = ''; return; }

        const atrasados = d.indicadores.filter(i => !i.atualizado).length;
        el.innerHTML = `
            <span class="farol-rot">Gols atualizados até <b>${d.referencia || '—'}</b>${
                atrasados ? ` · <span class="farol-pend">${atrasados} pendente(s)</span>` : ''}:</span>
            ${d.indicadores.map(i => `
                <span class="farol-item ${i.atualizado ? 'ok' : 'atrasado'}"
                    title="${i.indicador}: ${i.ultimoDia ? 'lançado até ' + i.ultimoDia : 'sem lançamento'}">
                    <span class="farol-ponto"></span>${i.indicador}
                </span>`).join('')}`;
    } catch (e) {
        el.innerHTML = '';
    }
}

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

        // Sem banco, o app roda com o acesso de emergência: avisamos para não
        // parecer que a gestão de usuários e o histórico sumiram.
        if (data.user.emergencia) {
            const bar = document.getElementById('infoBar');
            if (bar) bar.innerHTML = '<span>🔑 Modo emergência: o banco de dados está '
                + 'indisponível. Placares e classificações funcionam normalmente; '
                + 'gestão de usuários e histórico de acessos ficam fora do ar.</span>';
        }

        // Mostrar link de admin se for admin
        if (data.user.é_admin) {
            document.getElementById('adminLink').style.display = 'inline-block';
            iniciarPresenca();   // contador de online é só para o master
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
        document.getElementById('filterSemana').addEventListener('change', onSemanaChange);
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
        carregarFarol();
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

    renderJogosPorResultado(container, lojas);
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
            state.semanaVigente = d.semana;
            state.semanasDisponiveis = d.disponiveis || [d.semana];
            // Só define a semana na primeira carga; se o usuário já escolheu
            // uma rodada, respeitamos a escolha dele.
            if (!state.semanaEscolhida) state.semana = d.semana;
            preencherSeletorSemana();
            atualizarTituloSemana();
            console.log(`📅 Semana vigente: ${d.semana} (disponíveis: ${d.disponiveis})`);
        }
    } catch (e) {
        console.error('Não foi possível detectar a semana; usando', state.semana, e);
    }
}

function atualizarTituloSemana() {
    const vigente = state.semana === state.semanaVigente;
    const sufixo = vigente ? '' : ' (rodada anterior)';
    const h1 = document.querySelector('.header h1');
    if (h1) h1.textContent = `Campeonato Petz 2026 - Semana ${state.semana}${sufixo}`;
    document.title = `Campeonato Petz - Semana ${state.semana}`;
}

function preencherSeletorSemana() {
    const sel = document.getElementById('filterSemana');
    if (!sel) return;
    const lista = (state.semanasDisponiveis || []).slice().sort((a, b) => b - a);
    sel.innerHTML = lista.map(n =>
        `<option value="${n}"${n === state.semana ? ' selected' : ''}>Rodada ${n}${n === state.semanaVigente ? ' (atual)' : ''}</option>`
    ).join('');
}

async function onSemanaChange(e) {
    const nova = parseInt(e.target.value, 10);
    if (!nova || nova === state.semana) return;

    const sel = e.target;
    const infoBar = document.getElementById('infoBar');
    sel.disabled = true;
    if (infoBar) infoBar.innerHTML = `<span>⏳ Carregando a rodada ${nova}...</span>`;

    state.semana = nova;
    state.semanaEscolhida = true;
    // Tudo que é derivado da rodada precisa ser descartado
    state.gamesSummary = null;
    state.resumoCarregado = false;
    state.todoCalculado = false;
    state.jogosCalculados = {};
    atualizarTituloSemana();

    try {
        await loadConfrontos();
        await carregarResumJogos();
        // loadGames() já decide entre ranking, regional ou distrito conforme
        // o que estiver selecionado nos filtros.
        loadGames();
    } catch (err) {
        console.error('Erro ao trocar de rodada:', err);
        if (infoBar) infoBar.innerHTML = `<span>❌ Não foi possível carregar a rodada ${nova}</span>`;
    } finally {
        sel.disabled = false;
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
            // No cenário de eliminação, o acumulado do distrito muda junto.
            const ajD = (typeof cenAjustePorDistrito === 'function' && cen.ligado)
                ? (cenAjustePorDistrito()[dist] || { pts: 0 }) : { pts: 0 };
            const histPts = h ? (h.pontuacaoMedia + ajD.pts) * n : 0;
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
                histAcum: h ? h.pontuacaoMedia + ajD.pts : 0,
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
        nome: nomeIndicador(ind), v: a.v, d: a.d, e: a.e, total: a.v + a.d + a.e
    }));
    gols.sort((a, b) => a.v - b.v);
    const golFraco = gols[0];
    const golForte = gols[gols.length - 1];

    return { lojasUp, lojasDown, golFraco, golForte, totalLojas: Object.keys(porLoja).length };
}

function setaEvol(r) {
    // Ritmo = pontos por jogo nesta rodada menos a média por jogo das rodadas
    // anteriores. Mostramos os dois números porque o card exibe a base na
    // escala do Power BI (acumulado por loja), que não é a da comparação.
    const diff = r.curAvg - r.histAvg;
    const ref = `<span class="ritmo-ref">(${r.curAvg.toFixed(2)} nesta rodada vs
        ${r.histAvg.toFixed(2)} de média nas anteriores, em pontos por jogo)</span>`;
    if (Math.abs(diff) < 0.05) return `<span style="color:#888;">➡️ estável</span> ${ref}`;
    return diff > 0
        ? `<span style="color:#11998e;">▲ +${diff.toFixed(2)}</span> ${ref}`
        : `<span style="color:#c0392b;">▼ ${diff.toFixed(2)}</span> ${ref}`;
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

// V/E/D de um distrito na rodada: no total e só nos jogos contra lojas de
// OUTRAS regionais ("fora de casa"). Jogos entre lojas da mesma regional não
// mexem no saldo da regional como time, por isso a separação.
function vedDistrito(regional, distrito) {
    const lojas = (state.estrutura?.[regional]?.[distrito]) || [];
    const lojaReg = {};
    Object.entries(state.estrutura || {}).forEach(([reg, dists]) =>
        Object.values(dists).forEach(ls => ls.forEach(l => { lojaReg[l] = reg; })));

    const tot = { V: [], E: [], D: [] }, fora = { V: [], E: [], D: [] };
    (state.gamesSummary?.games || []).forEach(g => {
        if (semResultado(g)) return;
        const [a1, b1] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        [[g.team1, a1, b1, g.team2], [g.team2, b1, a1, g.team1]].forEach(([loja, meu, adv, outra]) => {
            if (!lojas.includes(loja)) return;
            const r = meu > adv ? 'V' : meu === adv ? 'E' : 'D';
            const placar = `${loja} ${meu} × ${adv} ${outra}`;
            tot[r].push(placar);
            if (lojaReg[outra] !== regional) fora[r].push(placar);
        });
    });
    return { tot, fora };
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
                Acumulado ${r.histAcum.toFixed(2)} pts/loja + ${r.curAvg.toFixed(2)} desta rodada<br>
                Ritmo ${setaEvol(r)}
            </div>
            ${(() => {
                const v = vedDistrito(r.regional, r.distrito);
                const num = (cls, lista, rot, escopo) => lista.length
                    ? `<span class="ved-n ${cls} tem-jogos" data-jogos="${lista.join('\n')}"
                        data-titulo="${rot} · ${escopo}">${lista.length}</span>`
                    : `<span class="ved-n ${cls}">0</span>`;
                const bloco = (t, o) => `<div class="ved-bloco">
                    <span class="ved-rot">${t}</span>
                    ${num('v', o.V, 'Vitórias', t)}<span class="ved-l">V</span>
                    ${num('e', o.E, 'Empates', t)}<span class="ved-l">E</span>
                    ${num('d', o.D, 'Derrotas', t)}<span class="ved-l">D</span>
                </div>`;
                return `<div class="ved">
                    ${bloco('Total', v.tot)}
                    ${bloco('Fora de casa', v.fora)}
                    <div class="ved-nota">“Fora de casa” = jogos contra lojas de outras regionais.</div>
                </div>`;
            })()}
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
        <div class="dist-grid">${cards}</div>
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

        renderJogosPorResultado(container, lojas);

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

// ============================================================
// CALENDÁRIO DE UMA LOJA
// Próximos confrontos, lidos de "TODOS OS JOGOS.xlsx" via /api/jogos.
// O ícone que abre esta janela é só da tela — não entra na imagem copiada.
// ============================================================

let _calendario = null;

async function carregarCalendario() {
    if (_calendario) return _calendario;
    try {
        const r = await fetch('/api/jogos', { cache: 'no-store' });
        const d = await r.json();
        _calendario = d.jogos || [];
    } catch (e) {
        console.error('Não foi possível carregar o calendário:', e);
        _calendario = [];
    }
    return _calendario;
}

async function abrirCalendarioLoja(loja) {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-cal">
            <div class="modal-head">
                <div class="cal-titulo">
                    <b>📅 Próximos jogos · ${loja}</b>
                    <small>${regionalDaLoja(loja) || ''}</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo"><div class="carregando">⏳ Carregando calendário...</div></div>
        </div>`;

    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);

    const jogos = await carregarCalendario();
    const corpo = fundo.querySelector('.modal-corpo');
    if (!corpo) return;   // fechado antes de carregar

    const meus = jogos
        .filter(j => j.mandante === loja || j.visitante === loja)
        .sort((a, b) => a.rodada - b.rodada);
    const futuros = meus.filter(j => j.rodada > state.semana);
    const passados = meus.filter(j => j.rodada <= state.semana);

    if (!meus.length) {
        corpo.innerHTML = `<div class="carregando">Calendário indisponível.
            Confira se o arquivo <b>TODOS OS JOGOS.xlsx</b> está na pasta Confrontos.</div>`;
        return;
    }

    const linha = (j) => {
        const adv = j.mandante === loja ? j.visitante : j.mandante;
        const reg = regionalDaLoja(adv);
        const minha = reg === REGIONAL_DESTAQUE;
        const placar = j.realizado
            ? (j.mandante === loja ? `${j.golsMandante} x ${j.golsVisitante}`
                                   : `${j.golsVisitante} x ${j.golsMandante}`)
            : '—';
        const res = j.realizado
            ? (placar.split(' x ').map(Number)[0] > placar.split(' x ').map(Number)[1] ? 'v'
                : placar.split(' x ').map(Number)[0] < placar.split(' x ').map(Number)[1] ? 'd' : 'e')
            : '';
        return `<tr class="${minha ? 'contra-minha' : ''}">
            <td class="c">R${j.rodada}</td>
            <td class="l"><b>${adv}</b> <small>${reg || '—'}</small>
                ${minha ? '<span class="tag-minha">sua regional</span>' : ''}</td>
            <td class="c placar ${res}">${placar}</td>
        </tr>`;
    };

    corpo.innerHTML = `
        <div class="cal-legenda">
            ${futuros.length} jogo(s) pela frente · ${passados.length} já realizado(s)
            <span class="cal-nota">Confrontos contra a ${REGIONAL_DESTAQUE} vêm destacados.</span>
        </div>
        <table class="md-tabela cal-tabela">
            <thead><tr><th class="c">Rodada</th><th class="l">Adversário</th><th class="c">Placar</th></tr></thead>
            <tbody>
                ${futuros.length ? `<tr class="sep"><td colspan="3">A disputar</td></tr>` + futuros.map(linha).join('') : ''}
                ${passados.length ? `<tr class="sep"><td colspan="3">Já realizados</td></tr>` + passados.map(linha).join('') : ''}
            </tbody>
        </table>`;
}

// ============================================================
// JANELA "JOGOS DO DISTRITO NA RODADA"
// Pensando a regional como um time só: mostra todos os jogos que um distrito
// disputa na rodada e destaca os que são contra lojas da minha regional —
// são neles que dá para tirar pontos de um concorrente direto.
// ============================================================

function abrirJogosDistrito(regional, distrito) {
    const lojas = (state.estrutura?.[regional]?.[distrito]) || [];
    const jogos = (state.gamesSummary?.games || [])
        .filter(g => lojas.includes(g.team1) || lojas.includes(g.team2));

    // loja -> regional + distrito, para identificar o adversário por completo
    const lojaReg = {}, lojaDist = {};
    Object.entries(state.estrutura || {}).forEach(([reg, dists]) =>
        Object.entries(dists).forEach(([dist, ls]) => ls.forEach(l => {
            lojaReg[l] = reg;
            lojaDist[l] = dist;
        })));

    const linhas = jogos.map(g => {
        const minha = lojas.includes(g.team1) ? g.team1 : g.team2;
        const adv = minha === g.team1 ? g.team2 : g.team1;
        const [a, b] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        const gm = minha === g.team1 ? a : b;
        const gs = minha === g.team1 ? b : a;
        const sem = semResultado(g);
        return {
            minha, adv, gm, gs, sem,
            advRegional: lojaReg[adv] || '—',
            advDistrito: lojaDist[adv] || '',
            contraMim: lojaReg[adv] === REGIONAL_DESTAQUE,
            pts: sem ? 0 : (gm > gs ? 3 : gm === gs ? 1 : 0),
            resultado: sem ? 'sem' : gm > gs ? 'v' : gm < gs ? 'd' : 'e'
        };
    });

    // primeiro os jogos contra a minha regional, e dentro deles os que ainda
    // dão para virar (onde o distrito adversário está ganhando)
    const ordem = { d: 0, e: 1, v: 2, sem: 3 };
    linhas.sort((x, y) => (y.contraMim - x.contraMim)
        || (ordem[y.resultado] - ordem[x.resultado])
        || x.minha.localeCompare(y.minha));

    const souEu = regional === REGIONAL_DESTAQUE;
    const contra = linhas.filter(l => l.contraMim);
    const ptsDele = linhas.reduce((t, l) => t + l.pts, 0);
    const emRisco = contra.reduce((t, l) => t + l.pts, 0);
    const conta = (r) => linhas.filter(l => l.resultado === r).length;

    const rotulo = { v: 'VENCENDO', e: 'EMPATANDO', d: 'PERDENDO', sem: 'SEM DADOS' };

    // A cor mostra o SEU interesse. Se o distrito é adversário, a vitória dele
    // é ruim para você — então sai em vermelho, e a derrota dele em verde.
    const corDe = (res) => {
        if (res === 'sem' || res === 'e') return res;
        if (souEu) return res;
        return res === 'v' ? 'd' : 'v';        // inverte para a ótica da R2
    };

    const corpo = linhas.map((l, i) => `
        <tr class="${l.contraMim ? 'contra-minha' : ''} linha-jogo"
            onclick="abrirDetalhesJogo('${l.minha}','${l.adv}')" title="Ver os gols deste jogo">
            <td class="l"><b>${l.minha}</b></td>
            <td class="c placar ${corDe(l.resultado)}">${l.gm} × ${l.gs}</td>
            <td class="l"><b>${l.adv}</b>
                ${l.contraMim ? '<span class="tag-minha">sua regional</span>' : ''}
                <small>${l.advRegional}${l.advDistrito ? ` · ${l.advDistrito}` : ''}</small></td>
            <td class="c"><span class="res ${corDe(l.resultado)}">${rotulo[l.resultado]}</span></td>
            <td class="c b">${l.sem ? '—' : '+' + l.pts}</td>
            <td class="c lupa">🔍</td>
        </tr>`).join('');

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-dist">
            <div class="modal-head">
                <div class="md-titulo">
                    <b>${distrito}</b>
                    <small>${regional} · ${lojas.length} lojas · rodada ${state.semana}</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo">
                <div class="md-resumo">
                    <div class="md-card ${souEu ? 'bom' : 'ruim'}"><span>${conta('v')}</span>vencendo</div>
                    <div class="md-card"><span>${conta('e')}</span>empatando</div>
                    <div class="md-card ${souEu ? 'ruim' : 'bom'}"><span>${conta('d')}</span>perdendo</div>
                    <div class="md-card total"><span>${ptsDele}</span>pontos na rodada</div>
                </div>
                ${contra.length ? `
                <div class="md-alvo">
                    <b>⚔ ${contra.length} jogo(s) contra a ${REGIONAL_DESTAQUE}</b>
                    — hoje eles somam <b>${emRisco} ponto(s)</b> para o ${distrito}.
                    ${emRisco > 0
                        ? `Virar esses jogos tira até <b>${emRisco} ponto(s)</b> dele.`
                        : 'Sua regional já está segurando todos eles.'}
                </div>` : `<div class="md-alvo neutro">
                    Nenhum jogo contra a ${REGIONAL_DESTAQUE} nesta rodada — só dá para
                    ganhar terreno pontuando mais nos jogos das suas lojas.</div>`}
                <div class="md-legenda">
                    ${souEu ? 'Cores na ótica das suas lojas: verde é bom para você.'
                        : `Cores na <b>sua ótica</b>: como o ${distrito} é adversário,
                           o que é <span class="res d">bom para ele</span> aparece em vermelho e
                           o que é <span class="res v">ruim para ele</span> aparece em verde.`}
                    Clique em qualquer jogo para ver os gols.
                </div>
                <table class="md-tabela">
                    <thead><tr>
                        <th class="l">Loja do ${distrito}</th><th class="c">Placar</th>
                        <th class="l">Adversário</th><th class="c">Situação</th><th class="c">Pts</th>
                        <th class="c"></th>
                    </tr></thead>
                    <tbody>${corpo}</tbody>
                </table>
            </div>
        </div>`;

    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);
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
    // Na coluna Regional mostramos só o código quando o espaço aperta; o nome
    // completo volta em telas largas (span .lg).
    const regCurto = (reg) => {
        const p = reg.split(' - ');
        return p.length > 1
            ? `${p[0]}<span class="lg"> - ${p[1]}</span>`
            : reg;
    };

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
        return `<tr class="clk${dest ? ' dest' : ''}" onclick="${clkDist(r.reg, r.dist)}">
            <td class="c b">${medalhaFn(r.rankAtual - 1)}</td>
            <td class="l"><span class="dist-link" title="Jogos do distrito nesta rodada"
                onclick="event.stopPropagation(); abrirJogosDistrito('${esc(r.reg)}','${esc(r.dist)}')">${r.dist}</span></td><td class="l reg">${regCurto(r.reg)}</td>
            <td class="c">${r.V}</td><td class="c">${r.E}</td><td class="c">${r.D}</td>
            <td class="c b">${f2(r.media)}</td>
            <td class="c b">${fp(r.aprov)}</td></tr>`;
    }).join('') + Object.entries(totReg).filter(([reg]) => passaFiltro(reg))
        .sort((a, b) => b[1].media - a[1].media).map(([reg, t]) => `
        <tr class="tot"><td></td><td class="l">${nomeReg(reg)}</td><td class="l reg"></td>
            <td class="c">${t.V}</td><td class="c">${t.E}</td><td class="c">${t.D}</td>
            <td class="c b">${f2(t.media)}</td>
            <td class="c b">${fp(t.aprov)}</td></tr>`).join('');

    // ---------- TABELA 2: classificação acumulada (oficial, sem a rodada) ----------
    let secaoBase = '';
    if (simulado.length) {
        const rodadas = state.historico.rodadasAnteriores;
        // Ordenada pela pontuação acumulada do ranking oficial, sem somar a
        // rodada em andamento — é a foto de onde o campeonato parou.
        const porBase = [...dadosDist].filter(r => r.sim && r.sim.temHistorico)
            .sort((a, b) => b.sim.histAcum - a.sim.histAcum);

        // Distância para os vizinhos de tabela, como na tabela do acumulado
        // simulado. O líder só tem o de baixo; o lanterna, o de cima.
        const distanciaBase = (r) => {
            const i = porBase.indexOf(r);
            const linha = (ref, posRef, sentido) => {
                if (!ref) return '';
                const d = Math.abs(ref.sim.histAcum - r.sim.histAcum);
                const alvo = `${posRef}º ${ref.dist}`;
                if (d < 0.005) return `${sentido === 'cima' ? '▲' : '▼'} empatado com o ${alvo}`;
                return `${sentido === 'cima' ? '▲' : '▼'} ${f2(d)} pts ${
                    sentido === 'cima' ? 'atrás do' : 'à frente do'} ${alvo}`;
            };
            return [
                linha(porBase[i - 1], i, 'cima'),
                linha(porBase[i + 1], i + 2, 'baixo')
            ].filter(Boolean).join('\n');
        };

        // Vitórias médias também mudam no cenário de eliminação.
        const ajVit = (d) => (typeof cenAjustePorDistrito === 'function' && cen.ligado)
            ? (cenAjustePorDistrito()[d]?.vit || 0) : 0;

        const linhasBase = porBase.filter(r => passaFiltro(r.reg)).map((r, i) => {
            const dest = r.reg === REGIONAL_DESTAQUE;
            const h = state.historico.distritos?.[r.dist] || {};
            return `<tr class="clk${dest ? ' dest' : ''}" onclick="${clkDist(r.reg, r.dist)}">
                <td class="c b">${medalhaFn(porBase.indexOf(r))}</td>
                <td class="l"><span class="dist-link" title="Jogos do distrito nesta rodada"
                    onclick="event.stopPropagation(); abrirJogosDistrito('${esc(r.reg)}','${esc(r.dist)}')">${r.dist}</span></td><td class="l reg">${regCurto(r.reg)}</td>
                <td class="c b tem-tip" data-tip="${distanciaBase(r)}">${f2(r.sim.histAcum)}</td>
                <td class="c">${h.vitoriaMedia !== undefined ? f2(h.vitoriaMedia + ajVit(r.dist)) : '—'}</td></tr>`;
        }).join('') + Object.entries(state.historico.regionais || {})
            .filter(([reg]) => passaFiltro(reg))
            .sort((a, b) => b[1].pontuacaoMedia - a[1].pontuacaoMedia)
            .map(([reg, h]) => `
            <tr class="tot"><td></td><td class="l">${nomeReg(reg)}</td><td class="l reg"></td>
                <td class="c b">${f2(h.pontuacaoMedia)}</td>
                <td class="c">${h.vitoriaMedia !== undefined ? f2(h.vitoriaMedia) : '—'}</td></tr>`).join('');

        secaoBase = `
        <section class="sec base">
            <div class="sec-head">🏁 CLASSIFICAÇÃO ACUMULADA <small>· oficial, até a rodada ${rodadas}</small></div>
            <div class="sec-body">
                <div class="tbl-wrap"><table class="rank-table">
                    <thead><tr><th>#</th><th class="l">Distrito</th><th class="l reg">Regional</th>
                        <th title="Pontuação média acumulada (ranking oficial)">Pontuação<span class="lg"> Média</span></th>
                        <th title="Média de vitórias por loja">Vit.<span class="lg"> Média</span></th></tr></thead>
                    <tbody>${linhasBase}</tbody>
                </table></div>
            </div>
        </section>`;
    }

    // ---------- TABELA 3: acumulado + simulado ----------
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

        // Distância em pontos para os vizinhos de tabela: quem está logo acima
        // e quem está logo abaixo. O líder só tem o de baixo; o lanterna, o de
        // cima.
        const distancia = (r) => {
            const i = porSim.indexOf(r);
            const linha = (ref, posRef, sentido) => {
                if (!ref) return '';
                const d = Math.abs(ref.sim.simAcum - r.sim.simAcum);
                const alvo = `${posRef}º ${ref.dist}`;
                if (d < 0.005) return `${sentido === 'cima' ? '▲' : '▼'} empatado com o ${alvo}`;
                return `${sentido === 'cima' ? '▲' : '▼'} ${f2(d)} pts ${
                    sentido === 'cima' ? 'atrás do' : 'à frente do'} ${alvo}`;
            };
            return [
                linha(porSim[i - 1], i, 'cima'),
                linha(porSim[i + 1], i + 2, 'baixo')
            ].filter(Boolean).join('\n');
        };

        // Alerta de vizinhança apertada, só para os distritos da minha regional.
        // 0,30 na escala acumulada é a ordem de grandeza de UM jogo (3 pontos
        // divididos pelo nº de lojas do distrito), ou seja: a posição pode
        // trocar já na próxima rodada.
        const LIMITE_ALERTA = 0.30;
        const alerta = (r) => {
            if (r.reg !== REGIONAL_DESTAQUE) return '';
            const i = porSim.indexOf(r);
            const acima = porSim[i - 1], abaixo = porSim[i + 1];
            const dAcima = acima ? acima.sim.simAcum - r.sim.simAcum : Infinity;
            const dAbaixo = abaixo ? r.sim.simAcum - abaixo.sim.simAcum : Infinity;
            const risco = dAbaixo <= LIMITE_ALERTA;
            const chance = dAcima <= LIMITE_ALERTA;
            if (!risco && !chance) return '';

            const linhas = [];
            if (risco) {
                linhas.push(dAbaixo < 0.005
                    ? `Empatado em pontos com o ${i + 2}º ${abaixo.dist} — a posição depende do desempate.`
                    : `Só ${f2(dAbaixo)} pts de vantagem sobre o ${i + 2}º ${abaixo.dist} — pode perder a posição.`);
            }
            if (chance) {
                linhas.push(dAcima < 0.005
                    ? `Empatado em pontos com o ${i}º ${acima.dist} — dá para assumir a posição.`
                    : `A ${f2(dAcima)} pts do ${i}º ${acima.dist} — dá para passar.`);
            }
            const icone = risco ? '⚠️' : '🎯';
            return ` <span class="alerta-pos ${risco ? 'risco' : 'chance'} tem-tip"
                data-tip="${linhas.join('\n')}">${icone}</span>`;
        };

        const linhasAcum = porSim.filter(r => passaFiltro(r.reg)).map(r => {
            const dest = r.reg === REGIONAL_DESTAQUE;
            // Variação em relação ao ranking das RODADAS ANTERIORES (base),
            // não ao ranking da rodada atual.
            const mov = r.sim.variacao;
            const movHtml = mov > 0 ? `<span style="color:#16a34a;font-weight:700;">▲${mov}</span>`
                : mov < 0 ? `<span style="color:#dc2626;font-weight:700;">▼${-mov}</span>`
                : '<span style="color:#cbd5e1;">—</span>';
            return `<tr class="clk${dest ? ' dest' : ''}" onclick="${clkDist(r.reg, r.dist)}">
                <td class="c b">${medalhaFn(r.sim.posicao - 1)}</td><td class="c">${movHtml}</td>
                <td class="l"><span class="dist-link" title="Jogos do distrito nesta rodada"
                    onclick="event.stopPropagation(); abrirJogosDistrito('${esc(r.reg)}','${esc(r.dist)}')">${r.dist}</span>${alerta(r)}</td><td class="l reg">${regCurto(r.reg)}</td>
                <td class="c">${f2(r.sim.histAcum)}</td><td class="c">${f2(r.sim.curAvg)}</td>
                <td class="c b tem-tip" data-tip="${distancia(r)}">${f2(r.sim.simAcum)}</td>
                <td class="c b">${fp(r.aConq / r.aDisp * 100)}</td></tr>`;
        }).join('') + Object.entries(totAcum).filter(([reg]) => passaFiltro(reg))
            .map(([reg, t]) => {
                // A base da regional vem do ranking oficial da pasta
                // "Histórico ranking regionais" — não da soma dos distritos.
                const hReg = state.historico.regionais?.[reg];
                const base = hReg ? hReg.pontuacaoMedia : null;
                const ptsRodada = totReg[reg] ? totReg[reg].conq : 0;
                const simulada = base !== null
                    ? base + (t.lojas > 0 ? ptsRodada / t.lojas : 0)
                    : t.media;
                return { reg, t, base, simulada };
            })
            .sort((a, b) => b.simulada - a.simulada).map(({ reg, t, base, simulada }) => `
            <tr class="tot"><td></td><td></td><td class="l">${nomeReg(reg)}</td><td class="l reg"></td>
                <td class="c">${base !== null ? f2(base) : '—'}</td>
                <td class="c">${f2(totReg[reg] ? totReg[reg].media : 0)}</td>
                <td class="c b">${f2(simulada)}</td>
                <td class="c b">${fp(t.aprov)}</td></tr>`).join('');

        secaoAcumulado = `
        <section class="sec acum">
            <div class="sec-head">📊 ACUMULADO + SIMULADO <small>· rodadas 1-${rodadas} + rodada ${state.semana}</small></div>
            ${rodadas < state.semana - 1 ? `<div class="alerta-hist">⚠️ O histórico está com <b>${rodadas} rodada(s)</b>, mas a rodada atual é a <b>${state.semana}</b> — as rodadas ${rodadas + 1} a ${state.semana - 1} não estão sendo somadas. Atualize o ranking na pasta <b>Histórico ranking distritais</b> do SharePoint.</div>` : ''}
            <div class="sec-body">
                <div class="tbl-wrap"><table class="rank-table">
                    <thead><tr><th>#</th><th title="Variação de posição em relação ao ranking das rodadas anteriores (base)">Mov.</th><th class="l">Distrito</th><th class="l reg">Regional</th>
                        <th title="Pontuação média acumulada até a rodada ${rodadas} (ranking oficial)">Base<span class="lg"> R1-${rodadas}</span></th>
                        <th title="Pontos por jogo na rodada ${state.semana}, em andamento">Rod.<span class="lg"> ${state.semana}</span></th>
                        <th title="Base + rodada atual, na mesma escala do ranking oficial">Sim.<span class="lg">ulada</span></th>
                        <th><span class="lg">% </span>Aprov.</th></tr></thead>
                    <tbody>${linhasAcum}</tbody>
                </table></div>
            </div>
        </section>`;
    }

    // ---------- Alerta de indicador sem dados ----------
    const avisos = state.gamesSummary?.avisos || [];
    // Dois tipos: 'rodada' (informativo, a rodada ainda não começou) e
    // 'zerado' (planilha subiu sem valores — aí sim é erro de upload).
    const avisosRodada = avisos.filter(a => a.tipo === 'rodada');
    const avisosCriterio = avisos.filter(a => a.tipo === 'criterio');
    const avisosElim = avisos.filter(a => a.tipo === 'eliminada');
    const avisosZerado = avisos.filter(a => !['rodada', 'criterio', 'eliminada'].includes(a.tipo));
    const blocoRodada = avisosRodada.length ? `
        <div class="alerta-info">
            <div class="alerta-titulo">⏳ Rodada em preparação</div>
            <ul>${avisosRodada.map(a => `<li>${a.mensagem}</li>`).join('')}</ul>
        </div>` : '';
    const blocoZerado = avisosZerado.length ? `
        <div class="alerta-dados">
            <div class="alerta-titulo">⚠️ Atenção: indicador sem dados</div>
            <ul>${avisosZerado.map(a => `<li><b>${a.indicador}</b> (${a.semana}) subiu zerado — esse gol não está sendo disputado, então os placares somam menos de 6.</li>`).join('')}</ul>
            <div class="alerta-dica">Dica: na planilha, use <b>Colar Especial → Somente Valores</b> antes de subir, para as fórmulas não zerarem ao fechar a origem.</div>
        </div>` : '';
    const blocoCriterio = avisosCriterio.length ? `
        <div class="alerta-criterio">
            <div class="alerta-titulo">🎯 Regra especial nesta rodada</div>
            <ul>${avisosCriterio.map(a => `<li>${a.mensagem}</li>`).join('')}</ul>
        </div>` : '';
    const blocoElim = avisosElim.length ? `
        <div class="alerta-eliminada">
            <div class="alerta-titulo">⛔ Loja eliminada do campeonato</div>
            <ul>${avisosElim.map(a => `<li>${a.mensagem}</li>`).join('')}</ul>
        </div>` : '';
    const blocoAvisos = blocoRodada + blocoCriterio + blocoElim + blocoZerado;

    // ---------- Render ----------
    container.innerHTML = `
    ${blocoAvisos}
    <div class="home-sections">
        ${secaoBase}
        <section class="sec atual">
            <div class="sec-head">📅 RODADA SIMULADA <small>· desempenho da rodada ${state.semana}, ao vivo</small></div>
            <div class="sec-body">
                <div class="tbl-wrap"><table class="rank-table">
                    <thead><tr><th>#</th><th class="l">Distrito</th><th class="l reg">Regional</th>
                        <th>V</th><th>E</th><th>D</th><th><span class="lg">Pontuação </span>Média</th><th><span class="lg">% </span>Aprov.</th></tr></thead>
                    <tbody>${linhasAtual}</tbody>
                </table></div>
            </div>
        </section>
        ${secaoAcumulado}
    </div>

    <div class="linha-cheia">
        <div class="panel">
            <h4>🏆 Regionais</h4>
            <div class="hint">clique p/ abrir a regional ou um distrito</div>
            <div class="reg-grid">${colRegionais}</div>
        </div>
    </div>

    <div class="linha-cheia">${insightsR2Html(simulado)}</div>`;
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

    // Cards agrupados por resultado; detalhes abrem em janela.
    renderJogosPorResultado(container, lojas);
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

    // Cards agrupados por resultado; detalhes abrem em janela.
    renderJogosPorResultado(container, lojas);
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

        // Os detalhes ficam em cache (a janela e a exportação usam); a lista
        // continua sendo a de cards agrupados por resultado.
        renderJogosPorResultado(document.getElementById('gamesContainer'), lojas);
    } catch (error) {
        infoBar.innerHTML = '<span style="color: red;">⚠️ Erro ao carregar detalhes</span>';
        console.error('Erro ao carregar detalhes:', error);
    }
}

// ============================================================
// JOGOS AGRUPADOS POR RESULTADO (vitórias / empates / derrotas)
// Os cards são compactos e os detalhes abrem em uma janela, o que evita
// espremer as tabelas dentro de uma coluna estreita.
// ============================================================

function renderJogosPorResultado(container, lojas) {
    const todos = state.gamesSummary?.games || [];
    let jogos = todos.filter(g => lojas.includes(g.team1) || lojas.includes(g.team2));

    const resultadoDe = (g) => {
        if (semResultado(g)) return 'e';
        const [s1, s2] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        const minha = lojas.includes(g.team1) ? g.team1 : g.team2;
        const eu = minha === g.team1 ? s1 : s2;
        const adv = minha === g.team1 ? s2 : s1;
        return eu > adv ? 'v' : eu < adv ? 'd' : 'e';
    };

    // Filtro vindo dos cartões de estatística (Vitórias / Empates / Derrotas)
    const mapa = { vitoria: 'v', empate: 'e', derrota: 'd' };
    if (state.filtroResultado) {
        const alvo = mapa[state.filtroResultado];
        jogos = jogos.filter(g => resultadoDe(g) === alvo);
    }

    const grupos = { v: [], e: [], d: [] };
    jogos.forEach(g => grupos[resultadoDe(g)].push(g));

    const semDados = todos.length && semResultado(todos[0]);
    const titulos = [
        ['v', '✅ Vitórias'],
        ['e', semDados ? '⏳ Sem resultado' : '⚖️ Empates'],
        ['d', '❌ Derrotas']
    ];

    container.innerHTML = `<div class="colunas-resultado">${titulos.map(([k, titulo]) => `
        <div class="col-res ${k}">
            <div class="col-res-head"><span>${titulo}</span><span class="n">${grupos[k].length}</span></div>
            <div class="lista">
                ${grupos[k].length ? grupos[k].map(g => cardJogoCompacto(g, lojas)).join('') : '<div class="vazio">nenhum jogo</div>'}
            </div>
        </div>`).join('')}</div>`;
}

// Loja -> regional, com cache (a estrutura não muda durante a sessão).
let _lojaRegMap = null, _lojaDistMap = null;
function regionalDaLoja(loja) {
    if (!_lojaRegMap) {
        _lojaRegMap = {};
        Object.entries(state.estrutura || {}).forEach(([reg, dists]) =>
            Object.values(dists).forEach(ls => ls.forEach(l => { _lojaRegMap[l] = reg; })));
    }
    return _lojaRegMap[loja];
}

// Lojas de outras regionais saem em vermelho: num card de jogo é sempre a
// adversária, e a cor deixa isso óbvio sem precisar decorar as siglas.
function distritoDaLoja(loja) {
    if (!_lojaDistMap) {
        _lojaDistMap = {};
        Object.entries(state.estrutura || {}).forEach(([, dists]) =>
            Object.entries(dists).forEach(([dist, ls]) =>
                ls.forEach(l => { _lojaDistMap[l] = dist; })));
    }
    return _lojaDistMap[loja];
}

function classeSigla(loja) {
    const reg = regionalDaLoja(loja);
    return reg && reg !== REGIONAL_DESTAQUE ? 'sig outra-reg' : 'sig';
}

// Inverte um placar "a x b" quando a leitura é pela ótica do outro lado.
function inverterPlacar(p) {
    const m = String(p || '').match(/(\d+)\s*x\s*(\d+)/i);
    return m ? `${m[2]} x ${m[1]}` : (p || '0 x 0');
}

function cardJogoCompacto(g, lojas) {
    // A loja do distrito/regional selecionado vem sempre à esquerda; se ela
    // estiver como team2 no confronto, o placar inverte junto.
    const inverte = Array.isArray(lojas) && !lojas.includes(g.team1) && lojas.includes(g.team2);
    const esq = inverte ? g.team2 : g.team1;
    const dir = inverte ? g.team1 : g.team2;
    const proj = inverte ? inverterPlacar(g.scoreProjected) : g.scoreProjected;
    const acum = inverte ? inverterPlacar(g.scoreAccumulated) : g.scoreAccumulated;

    return `
    <div class="jogo-card" onclick="abrirDetalhesJogo('${esq}','${dir}')">
        <div class="lados">
            <span class="${classeSigla(esq)}" title="${regionalDaLoja(esq) || ''}">${esq}</span>
            <span class="meio">
                <span class="rot">Placar Projetado</span>
                <span class="placar">${proj.replace('x', '×')}</span>
                <span class="acum">Acumulado ${acum}</span>
            </span>
            <span class="${classeSigla(dir)}" title="${regionalDaLoja(dir) || ''}">${dir}</span>
        </div>
        <button class="btn-exportar" title="Copiar imagem para compartilhar"
            onclick="event.stopPropagation(); exportarJogoImagem('${esq}','${dir}', this)">📋</button>
        <span class="lupa" title="Ver detalhes">🔍</span>
    </div>`;
}

async function abrirDetalhesJogo(team1, team2) {
    // O confronto pode ser pedido em qualquer ordem (o card lidera com a loja
    // do distrito selecionado), então procuramos nos dois sentidos e viramos
    // o placar quando necessário.
    const resumo = (state.gamesSummary?.games || []).find(g =>
        (g.team1 === team1 && g.team2 === team2) || (g.team1 === team2 && g.team2 === team1)) || {};
    const invertido = resumo.team1 === team2;
    const placarProj = invertido ? inverterPlacar(resumo.scoreProjected) : (resumo.scoreProjected || '0 x 0');
    const placarAcum = invertido ? inverterPlacar(resumo.scoreAccumulated) : (resumo.scoreAccumulated || '0 x 0');

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-jogo">
            <div class="modal-head">
                <div class="times">
                    <span class="t"><span class="t-nome"><button class="bt-cal" title="Próximos jogos de ${team1}"
                        onclick="abrirCalendarioLoja('${team1}')">📅</button>${team1}</span>
                        <small class="t-dist">${distritoDaLoja(team1) || ''}</small></span>
                    <span class="placar">
                        <small>Placar Projetado</small>
                        <b class="placar-nums">${(() => {
                            const [pa, pb] = placarProj.split('x').map(v => v.trim());
                            return `<span class="pl-num" data-lado="esq" title="Ver só os gols de ${team1}">${pa}</span>`
                                + ` × <span class="pl-num" data-lado="dir" title="Ver só os gols de ${team2}">${pb}</span>`;
                        })()}</b>
                        <small>Acumulado ${placarAcum}</small>
                    </span>
                    <span class="t"><span class="t-nome">${team2}<button class="bt-cal" title="Próximos jogos de ${team2}"
                        onclick="abrirCalendarioLoja('${team2}')">📅</button></span>
                        <small class="t-dist">${distritoDaLoja(team2) || ''}</small></span>
                </div>
                <div class="modal-acoes">
                    <button class="modal-btn" id="btExpModal">📋 Copiar imagem</button>
                    <button class="modal-btn" data-fechar>✕ Fechar</button>
                </div>
            </div>
            <div class="modal-corpo"><div class="carregando">⏳ Carregando indicadores...</div></div>
        </div>`;
    const eliminada = [team1, team2].find(t => lojaEliminada(t));

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
    if (!corpo) return;   // fechado antes de carregar
    if (jogo.erro) {
        corpo.innerHTML = '<div class="carregando">❌ Não foi possível carregar os indicadores.</div>';
        return;
    }

    // Quem marcou cada gol vem do resumo — é ele que aplica os critérios de
    // desempate quando a evolução das duas lojas empata.
    const gols = resumo.golsProjetados || {};
    // 1 = quem é team1 no resumo. Como podemos ter invertido a exibição,
    // traduzimos para "o time da esquerda".
    const golEsq = invertido ? 2 : 1, golDir = invertido ? 1 : 2;
    const todos = ordenarIndicadores(Object.keys(jogo.dadosTeam1));

    // Clicar num número do placar filtra os indicadores para os gols daquele
    // lado; clicar de novo (ou em "ver todos") volta à lista completa.
    const desenhar = (lado) => {
        const inds = lado === 'esq' ? todos.filter(i => gols[i] === golEsq)
            : lado === 'dir' ? todos.filter(i => gols[i] === golDir)
                : todos;
        const dono = lado === 'esq' ? team1 : team2;
        // Rodada encerrada: o placar é o oficial do campeonato. Quando os gols
        // calculados não somam esse placar, a lista abaixo é só explicativa —
        // dizer isso é melhor do que mostrar uma conta que não fecha.
        const avisoOficial = resumo.calculado ? `
            <div class="alerta-eliminada">
                <b>📋 Placar oficial do campeonato: ${invertido ? inverterPlacar(resumo.scoreProjected) : resumo.scoreProjected}.</b>
                O cálculo sobre as planilhas de venda daria
                ${invertido ? inverterPlacar(resumo.calculado) : resumo.calculado} — a diferença
                vem do <b>SHARE CLUBZ</b>, que na apuração oficial considera só o canal físico e
                só os Clubz novos, recorte que a planilha exportada não tem. Vale o oficial.
            </div>` : '';
        const aviso = avisoOficial + (eliminada ? `
            <div class="alerta-eliminada">
                <b>⛔ ${eliminada} está eliminada do campeonato.</b>
                O placar deste jogo é <b>administrativo</b> — ela perde por 0 x 6 em todas as
                rodadas, independentemente das vendas. As tabelas abaixo mostram os números
                das planilhas, que não valem para o resultado.
            </div>` : '') + (lado ? `
            <div class="filtro-gols">
                Mostrando os <b>${inds.length}</b> gol(s) de <b>${dono}</b>
                <button class="filtro-limpar" data-lado="">ver todos os ${todos.length}</button>
            </div>` : '');

        corpo.innerHTML = aviso + (inds.length ? inds.map(ind => `
            <div class="tables-wrapper">
                ${criarTabelaIndicador(team1, jogo.dadosTeam1[ind], ind, jogo.dadosTeam2[ind], gols[ind] === golEsq)}
                ${criarTabelaIndicador(team2, jogo.dadosTeam2[ind], ind, jogo.dadosTeam1[ind], gols[ind] === golDir)}
            </div>`).join('')
            : '<div class="carregando">Nenhum gol deste lado nesta rodada.</div>');

        fundo.querySelectorAll('.pl-num').forEach(n =>
            n.classList.toggle('ativo', n.dataset.lado === lado));
        const limpar = corpo.querySelector('.filtro-limpar');
        if (limpar) limpar.onclick = () => desenhar(null);
        corpo.scrollTop = 0;
    };

    fundo.querySelectorAll('.pl-num').forEach(n => {
        n.onclick = () => desenhar(n.classList.contains('ativo') ? null : n.dataset.lado);
    });

    desenhar(null);

    const bt = fundo.querySelector('#btExpModal');
    if (bt) bt.onclick = (e) => exportarJogoImagem(team1, team2, e.currentTarget);
}

async function carregarDadosJogo(jogo) {
    try {
        const [dadosTeam1, dadosTeam2] = await Promise.all([
            api.get(`/loja-dias/${jogo.team1}/${state.semana}`),
            api.get(`/loja-dias/${jogo.team2}/${state.semana}`)
        ]);

        // Calcular placar projetado e acumulado localmente
        const placarProjetado = calcularPlacarLocal(dadosTeam1.dados, dadosTeam2.dados,
            null, jogo.team1, jogo.team2);
        const placarAcumulado = calcularPlacarLocal(
            dadosTeam1.dados,
            dadosTeam2.dados,
            dadosTeam1.hoje_idx,  // Calcular até hoje
            jogo.team1, jogo.team2
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
// CRIAR TABELA DE INDICADOR
// ============================================================

function criarTabelaIndicador(teamName, dados, indicador, dadosAdversario = null, marcou = null) {
    // Proteção: verificar se dados existe e tem estrutura correta
    if (!dados) {
        return '<div class="table-container"><div class="table-title">Dados indisponíveis</div></div>';
    }

    // Nome do indicador para exibição (sem extensão e sem o marcador de critério)
    const displayName = nomeIndicador(indicador || 'Indicador');
    const diasOrdenados = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

    // Tipo detectado automaticamente no backend ('%' ou 'R$')
    const tipo = dados.atual?.type || dados.anterior?.type || 'R$';
    const ehPct = tipo === '%';
    const fmt = (v) => formatarValor(v, tipo);
    // Percentual agrega por MÉDIA dos dias com dado; monetário por SOMA
    const agregar = (diasObj) => {
        if (ehPct) return agregarPct(diasObj, diasOrdenados);
        return diasOrdenados.map(d => (diasObj || {})[d] || 0).reduce((a, b) => a + b, 0);
    };
    // A linha final é MÉDIA só quando não há coluna 'Total' na planilha.
    const usaTotalPlanilha = ehPct && !!(dados.atual?.dias?.[CHAVE_TOTAL]
                                         || dados.anterior?.dias?.[CHAVE_TOTAL]);
    // Gol por NÍVEL: vale o valor da própria semana. A semana anterior não
    // entra na conta, então as colunas passam a comparar direto com o
    // adversário — mostrar "Evolução 0%" para os dois só confundiria.
    const ehNivel = (dados.atual?.criterio || dados.anterior?.criterio
                     || criterioDoNome(indicador)) === 'nivel';

    let totalAnterior = 0;
    let totalAtual = 0;

    // Se houver adversário, calcular totais dele também para comparação
    let totalAdversarioAnterior = 0;
    let totalAdversarioAtual = 0;
    if (dadosAdversario) {
        totalAdversarioAnterior = agregar(dadosAdversario.anterior?.dias);
        totalAdversarioAtual = agregar(dadosAdversario.atual?.dias);
    }

    // Preferimos o vencedor vindo do resumo; sem ele, cai na comparação direta
    // de evolução (que não resolve empates).
    const fezGol = marcou === null ? classeEvolucao === 'evolution-melhor' : marcou;

    let html = `
        <div class="table-container">
            <div class="table-title${fezGol ? ' marcou' : ''}">
                <span class="tt-loja">${teamName}</span><span class="tt-ind">${displayName}</span>
                ${ehNivel ? '<span class="tt-nivel" title="Este gol vale pelo valor da semana atual, não pela evolução">nível</span>' : ''}
                ${fezGol ? '<span class="tt-gol" title="Está fazendo este gol">⚽</span>' : ''}</div>
            <table>
                <thead>
                    <tr>
                        <th>Dia</th>
                        <th>${ehNivel ? 'Adversário' : 'S. Anterior'}</th>
                        <th>${ehNivel ? 'Esta loja' : 'S. Atual'}</th>
                        <th>${ehNivel ? 'Diferença' : 'Evolução'}</th>
                    </tr>
                </thead>
                <tbody>
    `;

    diasOrdenados.forEach(dia => {
        const valorAtual = (dados && dados.atual && dados.atual.dias) ? (dados.atual.dias[dia] || 0) : 0;
        // No gol por nível a coluna de comparação é o adversário no mesmo dia.
        const valorAnterior = ehNivel
            ? (dadosAdversario?.atual?.dias?.[dia] || 0)
            : ((dados && dados.anterior && dados.anterior.dias) ? (dados.anterior.dias[dia] || 0) : 0);

        // Mesma regra do placar e da linha de TOTAL: sem lançamento na semana
        // atual a evolução é 0%, não -100%.
        const evolucao = ehNivel ? (valorAtual - valorAnterior)
                                 : evolucaoPct(valorAnterior, valorAtual);
        const evoluClass = evolucao > 0 ? 'positive' : evolucao < 0 ? 'negative' : 'neutral';
        // Dia sem valor na semana atual: pode ser dia que ainda não chegou.
        // Mostrar -100% ali assusta sem informar — o que vale é a linha TOTAL.
        const semLancamento = !ehNivel && valorAtual === 0;
        const celulaComp = semLancamento ? '—' : (ehNivel
            ? `${evolucao > 0 ? '+' : ''}${fmt(evolucao)}`
            : `${evolucao.toFixed(2)}%`);

        html += `
            <tr>
                <td class="day-label">${dia}</td>
                <td class="value-anterior">${dadosAdversario || !ehNivel ? fmt(valorAnterior) : '—'}</td>
                <td class="value-atual">${fmt(valorAtual)}</td>
                <td class="evolution ${semLancamento ? 'neutral' : evoluClass}">${dadosAdversario || !ehNivel ? celulaComp : '—'}</td>
            </tr>
        `;
    });

    // Totais (soma para R$, média dos dias com dado para %)
    totalAnterior = ehNivel ? totalAdversarioAtual : agregar(dados.anterior?.dias);
    totalAtual = agregar(dados.atual?.dias);

    // Mesma regra do placar (zerou nesta semana = 0%, não -100%)
    const evolucaoTotal = ehNivel ? (totalAtual - totalAdversarioAtual)
                                  : evolucaoPct(agregar(dados.anterior?.dias), totalAtual);
    const evoluClassTotal = evolucaoTotal > 0 ? 'positive' : evolucaoTotal < 0 ? 'negative' : 'neutral';

    // Comparativo com adversário: aplicar cores apenas na célula de evolução
    let classeEvolucao = evoluClassTotal;
    let faltaVirar = null; // R$ que ESTE time precisa vender a mais p/ virar o indicador
    if (dadosAdversario && ehNivel) {
        // Gol por nível: vence quem tiver o maior valor na semana.
        if (totalAtual > totalAdversarioAtual) classeEvolucao = 'evolution-melhor';
        else if (totalAtual < totalAdversarioAtual) {
            classeEvolucao = 'evolution-pior';
            faltaVirar = totalAdversarioAtual - totalAtual;
        }
    } else if (dadosAdversario) {
        const evolucaoAdversario = evolucaoPct(totalAdversarioAnterior, totalAdversarioAtual);

        // Quem tiver evolução melhor (maior) fica verde, pior fica vermelho
        if (evolucaoTotal > evolucaoAdversario) {
            classeEvolucao = 'evolution-melhor';
        } else if (evolucaoTotal < evolucaoAdversario) {
            classeEvolucao = 'evolution-pior';
            // Está perdendo: quanto precisa vender a mais na S. Atual para virar o gol.
            // Precisa que a evolução dele iguale/supere a do adversário:
            //   S.Atual necessária = S.Anterior_dele × (1 + evoluçãoAdv/100)
            const baseAnterior = agregar(dados.anterior?.dias);
            if (baseAnterior > 0) {
                const necessario = baseAnterior * (1 + evolucaoAdversario / 100);
                const falta = necessario - totalAtual;
                if (falta > 0) faltaVirar = falta;
            }
        }
    }

    html += `
                <tr class="total-row">
                    <td class="day-label">${ehPct && !usaTotalPlanilha ? 'MÉDIA' : 'TOTAL'}</td>
                    <td style="text-align: center;">${dadosAdversario || !ehNivel ? fmt(totalAnterior) : '—'}</td>
                    <td style="text-align: center;">${fmt(totalAtual)}</td>
                    <td class="evolution ${classeEvolucao}" style="text-align: center;">${
                        ehNivel ? (dadosAdversario ? `${evolucaoTotal > 0 ? '+' : ''}${fmt(evolucaoTotal)}` : '—')
                                : `${evolucaoTotal.toFixed(2)}%`}</td>
                </tr>
    `;

    if (faltaVirar !== null) {
        const rotulo = (ehPct && !usaTotalPlanilha) ? 'Falta p/ virar (média)' : 'Falta p/ virar';
        const dica = ehNivel
            ? `${teamName} precisa passar o adversário em +${fmt(faltaVirar)} nesta semana para virar este gol`
            : (ehPct
                ? `${teamName} precisa subir +${fmt(faltaVirar)} na média para virar este gol`
                : `${teamName} precisa vender +${fmt(faltaVirar)} na S. Atual para virar este gol`);
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

    renderJogosPorResultado(container, lojas);
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
            nome: nomeIndicador(nome),
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
