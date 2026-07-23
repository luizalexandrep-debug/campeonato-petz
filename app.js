// Campeonato Petz - Aplicação de Acompanhamento de Resultados

// ============================================================
// ESTRUTURA DE DADOS E CONFIGURAÇÃO
// ============================================================

const SHAREPOINT_URL = 'https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petz_com_br/IgBmj_M4lNJVT5A78h_MKThtAVyAnNmeo99cIjoCwwHOoR8?e=h2nuth';

const RODADAS = {
    1: { inicio: '29/jun', fim: '05/jul' },
    2: { inicio: '06/jul', fim: '12/jul' },
    3: { inicio: '13/jul', fim: '19/jul' },
    4: { inicio: '20/jul', fim: '26/jul' },
    5: { inicio: '27/jul', fim: '02/ago' },
    6: { inicio: '03/ago', fim: '09/ago' },
    7: { inicio: '10/ago', fim: '16/ago' },
    8: { inicio: '17/ago', fim: '23/ago' },
    9: { inicio: '24/ago', fim: '30/ago' },
    10: { inicio: '31/ago', fim: '06/set' },
    11: { inicio: '07/set', fim: '13/set' },
    12: { inicio: '14/set', fim: '20/set' },
    13: { inicio: '21/set', fim: '27/set' },
    14: { inicio: '28/set', fim: '04/out' },
    15: { inicio: '05/out', fim: '11/out' },
    16: { inicio: '12/out', fim: '18/out' },
    17: { inicio: '19/out', fim: '25/out' },
    18: { inicio: '26/out', fim: '01/nov' },
    19: { inicio: '02/nov', fim: '08/nov' }
};

// Estado da aplicação
const state = {
    resultados: [],
    classificacoes: {},
    currentTab: 'entrada',
    currentRodada: null,
    currentGrupo: null,
    currentJogo: null,
    indicadorData: {}
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Tab navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    // Form actions
    document.getElementById('loadGameBtn').addEventListener('click', loadGameDataFromSharePoint);
    document.getElementById('loadManualBtn').addEventListener('click', showManualInput);
    document.getElementById('calculateBtn').addEventListener('click', calculateResult);
    document.getElementById('cancelBtn').addEventListener('click', hideGameData);
    document.getElementById('saveResultBtn').addEventListener('click', saveResult);

    // Filters
    document.getElementById('filterRodada').addEventListener('change', filterResultados);
    document.getElementById('filterGrupo').addEventListener('change', filterResultados);
    document.getElementById('filterGrupoClass').addEventListener('change', showClassificacao);

    // Load data from localStorage
    loadFromLocalStorage();
}

// ============================================================
// TAB NAVIGATION
// ============================================================

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Remove active class from buttons
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    state.currentTab = tabName;

    if (tabName === 'resultados') {
        displayResultados();
    }
}

// ============================================================
// SHAREPOINT INTEGRATION
// ============================================================

async function loadGameDataFromSharePoint() {
    const rodada = document.getElementById('rodada').value;
    const grupo = document.getElementById('grupo').value;

    if (!rodada || !grupo) {
        alert('Por favor, selecione a rodada e o grupo');
        return;
    }

    try {
        showLoading();

        // Simular carregamento de dados do SharePoint
        // Na versão real, você precisaria fazer requisições reais aos arquivos
        await simulateSharePointLoad(rodada, grupo);

        showManualInput();
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        alert('Erro ao carregar dados do SharePoint. Tente novamente.');
    } finally {
        hideLoading();
    }
}

async function simulateSharePointLoad(rodada, grupo) {
    // Esta função simula o carregamento dos dados
    // Na versão real, você faria requisições HTTP para os arquivos do SharePoint

    state.currentRodada = parseInt(rodada);
    state.currentGrupo = parseInt(grupo);

    // Aqui você adicionaria a lógica para:
    // 1. Fazer download dos arquivos de semana anterior e semana atual
    // 2. Processar os dados
    // 3. Popular os indicadores
}

// ============================================================
// MANUAL INPUT
// ============================================================

function showManualInput() {
    const rodada = document.getElementById('rodada').value;
    const grupo = document.getElementById('grupo').value;

    if (!rodada || !grupo) {
        alert('Por favor, selecione a rodada e o grupo');
        return;
    }

    state.currentRodada = parseInt(rodada);
    state.currentGrupo = parseInt(grupo);

    // Show game data container
    document.getElementById('gameDataContainer').classList.remove('hidden');
    document.getElementById('resultContainer').classList.add('hidden');

    // Generate indicator cards
    generateIndicatorCards();

    // Update title
    const rodadaInfo = RODADAS[rodada];
    document.getElementById('gameTitle').textContent = `Rodada ${rodada} - Insira os dados dos indicadores`;
    document.getElementById('gameDate').textContent = `${rodadaInfo.inicio} a ${rodadaInfo.fim}`;
}

function generateIndicatorCards() {
    const grid = document.getElementById('indicatorsGrid');
    grid.innerHTML = '';

    // Indicadores padrão (você pode modificar conforme necessário)
    const indicators = [
        { name: 'Vendas', type: 'R$' },
        { name: 'Antipulgas', type: '%' },
        { name: 'Suplementos', type: '%' },
        { name: 'Úmidos Cães e Gatos', type: 'R$' },
        { name: 'Fornecedor Petix', type: '%' },
        { name: 'Share Marca Própria', type: '%' }
    ];

    indicators.forEach((ind, index) => {
        const card = document.createElement('div');
        card.className = 'indicator-card';
        card.innerHTML = `
            <div class="indicator-name">
                <span>${ind.name}</span>
                <span class="indicator-type">${ind.type}</span>
            </div>
            <div class="indicator-inputs">
                <label>Semana Anterior - Time A</label>
                <input type="number" step="0.01" placeholder="0" data-indicator="${ind.name}" data-team="A" data-period="anterior">
                <label>Semana Atual - Time A</label>
                <input type="number" step="0.01" placeholder="0" data-indicator="${ind.name}" data-team="A" data-period="atual">
                <label>Semana Anterior - Time B</label>
                <input type="number" step="0.01" placeholder="0" data-indicator="${ind.name}" data-team="B" data-period="anterior">
                <label>Semana Atual - Time B</label>
                <input type="number" step="0.01" placeholder="0" data-indicator="${ind.name}" data-team="B" data-period="atual">
            </div>
        `;
        grid.appendChild(card);
    });
}

function hideGameData() {
    document.getElementById('gameDataContainer').classList.add('hidden');
    document.getElementById('resultContainer').classList.add('hidden');
}

// ============================================================
// CÁLCULO DE RESULTADOS
// ============================================================

function calculateResult() {
    // Get all indicator inputs
    const inputs = document.querySelectorAll('.indicator-inputs input');
    const indicatorData = {};

    inputs.forEach(input => {
        const indicator = input.dataset.indicator;
        const team = input.dataset.team;
        const period = input.dataset.period;
        const value = parseFloat(input.value) || 0;

        if (!indicatorData[indicator]) {
            indicatorData[indicator] = {};
        }
        if (!indicatorData[indicator][team]) {
            indicatorData[indicator][team] = {};
        }

        indicatorData[indicator][team][period] = value;
    });

    // Calculate evolution for each indicator
    let teamAGoals = 0;
    let teamBGoals = 0;
    const goalDetails = [];

    Object.entries(indicatorData).forEach(([indicator, teams]) => {
        const teamAEvolution = teams.A.atual - teams.A.anterior;
        const teamBEvolution = teams.B.atual - teams.B.anterior;

        let winner = null;
        if (teamAEvolution > teamBEvolution) {
            teamAGoals++;
            winner = 'A';
        } else if (teamBEvolution > teamAEvolution) {
            teamBGoals++;
            winner = 'B';
        } else {
            winner = 'empate';
        }

        goalDetails.push({
            indicator,
            teamAEvolution: teamAEvolution.toFixed(2),
            teamBEvolution: teamBEvolution.toFixed(2),
            winner
        });
    });

    // Determine match result
    let result = 'EMPATE';
    let points = 1;

    if (teamAGoals > teamBGoals) {
        result = 'VITÓRIA TIME A';
        points = 3;
    } else if (teamBGoals > teamAGoals) {
        result = 'VITÓRIA TIME B';
        points = 3;
    }

    // Store the result
    state.indicadorData = {
        rodada: state.currentRodada,
        grupo: state.currentGrupo,
        teamAGoals,
        teamBGoals,
        result,
        points,
        goalDetails
    };

    // Display result
    displayResult(teamAGoals, teamBGoals, result);
}

function displayResult(teamAGoals, teamBGoals, result) {
    document.getElementById('gameDataContainer').classList.add('hidden');
    document.getElementById('resultContainer').classList.remove('hidden');

    document.getElementById('resultTeam1').textContent = 'Time A';
    document.getElementById('resultScore1').textContent = teamAGoals;
    document.getElementById('resultScore2').textContent = teamBGoals;
    document.getElementById('resultTeam2').textContent = 'Time B';
    document.getElementById('resultStatus').textContent = result;

    const points = result === 'EMPATE' ? 1 : 3;
    document.getElementById('resultPoints').textContent = `Pontos: ${points}`;
}

// ============================================================
// SALVAR RESULTADOS
// ============================================================

function saveResult() {
    const resultado = {
        id: Date.now(),
        rodada: state.currentRodada,
        grupo: state.currentGrupo,
        data: new Date().toLocaleString('pt-BR'),
        ...state.indicadorData
    };

    state.resultados.push(resultado);
    saveToLocalStorage();

    alert('Resultado salvo com sucesso!');

    // Reset form
    document.getElementById('rodada').value = '';
    document.getElementById('grupo').value = '';
    hideGameData();
    updateClassificacoes();
}

// ============================================================
// VISUALIZAR RESULTADOS
// ============================================================

function displayResultados() {
    const filterRodada = document.getElementById('filterRodada').value;
    const filterGrupo = document.getElementById('filterGrupo').value;

    let resultados = state.resultados;

    if (filterRodada) {
        resultados = resultados.filter(r => r.rodada === parseInt(filterRodada));
    }
    if (filterGrupo) {
        resultados = resultados.filter(r => r.grupo === parseInt(filterGrupo));
    }

    const list = document.getElementById('resultadosList');

    if (resultados.length === 0) {
        list.innerHTML = '<p class="empty-state">Nenhum resultado encontrado</p>';
        return;
    }

    list.innerHTML = resultados.map(r => `
        <div class="resultado-item">
            <div class="resultado-header">Rodada ${r.rodada} - Grupo ${r.grupo}</div>
            <div class="resultado-title">Time A vs Time B</div>
            <div class="resultado-score">${r.teamAGoals} x ${r.teamBGoals}</div>
            <div class="resultado-status">${r.result}</div>
            <div style="margin-top: 10px; font-size: 0.85em; color: #999;">
                ${r.data}
            </div>
        </div>
    `).join('');
}

function filterResultados() {
    displayResultados();
}

// ============================================================
// CLASSIFICAÇÃO
// ============================================================

function updateClassificacoes() {
    const classificacoes = {};

    // Organize by group
    state.resultados.forEach(resultado => {
        const grupo = resultado.grupo;
        if (!classificacoes[grupo]) {
            classificacoes[grupo] = {};
        }

        // Update scores for both teams
        ['A', 'B'].forEach(team => {
            if (!classificacoes[grupo][team]) {
                classificacoes[grupo][team] = {
                    name: `Time ${team}`,
                    pontos: 0,
                    jogos: 0,
                    vitórias: 0,
                    empates: 0,
                    derrotas: 0,
                    golsPró: 0,
                    golsContra: 0
                };
            }

            classificacoes[grupo][team].jogos++;

            if (team === 'A') {
                classificacoes[grupo][team].golsPró += resultado.teamAGoals;
                classificacoes[grupo][team].golsContra += resultado.teamBGoals;

                if (resultado.teamAGoals > resultado.teamBGoals) {
                    classificacoes[grupo][team].pontos += 3;
                    classificacoes[grupo][team].vitórias++;
                } else if (resultado.teamAGoals === resultado.teamBGoals) {
                    classificacoes[grupo][team].pontos += 1;
                    classificacoes[grupo][team].empates++;
                } else {
                    classificacoes[grupo][team].derrotas++;
                }
            } else {
                classificacoes[grupo][team].golsPró += resultado.teamBGoals;
                classificacoes[grupo][team].golsContra += resultado.teamAGoals;

                if (resultado.teamBGoals > resultado.teamAGoals) {
                    classificacoes[grupo][team].pontos += 3;
                    classificacoes[grupo][team].vitórias++;
                } else if (resultado.teamBGoals === resultado.teamAGoals) {
                    classificacoes[grupo][team].pontos += 1;
                    classificacoes[grupo][team].empates++;
                } else {
                    classificacoes[grupo][team].derrotas++;
                }
            }
        });
    });

    state.classificacoes = classificacoes;
}

function showClassificacao() {
    const grupo = document.getElementById('filterGrupoClass').value;

    if (!grupo) {
        document.getElementById('classificacaoContainer').innerHTML =
            '<p class="empty-state">Selecione um grupo para ver a classificação</p>';
        return;
    }

    const classificacao = state.classificacoes[parseInt(grupo)];

    if (!classificacao) {
        document.getElementById('classificacaoContainer').innerHTML =
            '<p class="empty-state">Nenhum resultado registrado para este grupo</p>';
        return;
    }

    // Sort by points
    const times = Object.values(classificacao).sort((a, b) => b.pontos - a.pontos);

    const table = document.createElement('table');
    table.className = 'classificacao-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Pos</th>
                <th>Time</th>
                <th>P</th>
                <th>J</th>
                <th>V</th>
                <th>E</th>
                <th>D</th>
                <th>GP</th>
                <th>GC</th>
                <th>SG</th>
            </tr>
        </thead>
        <tbody>
            ${times.map((time, index) => {
                const saldo = time.golsPró - time.golsContra;
                return `
                    <tr>
                        <td class="posicao">${index + 1}º</td>
                        <td class="time-name">${time.name}</td>
                        <td class="stats"><strong>${time.pontos}</strong></td>
                        <td class="stats">${time.jogos}</td>
                        <td class="stats">${time.vitórias}</td>
                        <td class="stats">${time.empates}</td>
                        <td class="stats">${time.derrotas}</td>
                        <td class="stats">${time.golsPró}</td>
                        <td class="stats">${time.golsContra}</td>
                        <td class="stats" style="color: ${saldo > 0 ? '#4caf50' : saldo < 0 ? '#f44336' : '#999'}">${saldo}</td>
                    </tr>
                `;
            }).join('')}
        </tbody>
    `;

    document.getElementById('classificacaoContainer').innerHTML = '';
    document.getElementById('classificacaoContainer').appendChild(table);
}

// ============================================================
// STORAGE
// ============================================================

function saveToLocalStorage() {
    localStorage.setItem('campeonatoPetz', JSON.stringify(state.resultados));
}

function loadFromLocalStorage() {
    const data = localStorage.getItem('campeonatoPetz');
    if (data) {
        state.resultados = JSON.parse(data);
        updateClassificacoes();
    }
}

// ============================================================
// UTILS
// ============================================================

function showLoading() {
    // Aqui você pode mostrar um loading spinner
    console.log('Carregando...');
}

function hideLoading() {
    console.log('Carregamento concluído');
}
