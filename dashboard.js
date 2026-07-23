// Dashboard - Campeonato Petz
// Sistema de visualização regional/distrital com grid de jogos

const state = {
    estrutura: {},
    resultados: [],
    currentRegional: null,
    currentDistrito: null,
    currentGame: null,
    indicatorData: {}
};

const INDICATORS = [
    { name: 'Vendas', type: 'R$', id: 'vendas' },
    { name: 'Antipulgas', type: '%', id: 'antipulgas' },
    { name: 'Suplementos', type: '%', id: 'suplementos' },
    { name: 'Úmidos Cães e Gatos', type: 'R$', id: 'umidos' },
    { name: 'Fornecedor Petix', type: '%', id: 'fornecedor' },
    { name: 'Share Marca Própria', type: '%', id: 'share' }
];

// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    loadEstrutura();
    initializeEventListeners();
    loadFromLocalStorage();
});

function initializeEventListeners() {
    document.getElementById('filterRegional').addEventListener('change', onRegionalChange);
    document.getElementById('filterDistrito').addEventListener('change', onDistritoChange);
    document.getElementById('loadResultsBtn').addEventListener('click', loadGames);

    // Modal
    document.querySelector('.close-btn').addEventListener('click', closeModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('calculateResultBtn').addEventListener('click', calculateGameResult);

    // Fechar modal ao clicar fora
    document.getElementById('resultModal').addEventListener('click', (e) => {
        if (e.target.id === 'resultModal') closeModal();
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
        showErrorMessage('Erro ao carregar estrutura de regionais');
    }
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
}

function onDistritoChange(e) {
    state.currentDistrito = e.target.value;
}

// ============================================================
// CARREGAR E VISUALIZAR JOGOS
// ============================================================

function loadGames() {
    if (!state.currentRegional || !state.currentDistrito) {
        alert('Por favor, selecione uma Regional e um Distrito');
        return;
    }

    const lojas = state.estrutura[state.currentRegional][state.currentDistrito];
    const resultadosDistrito = state.resultados.filter(r =>
        lojas.includes(r.team1) || lojas.includes(r.team2)
    );

    displayGames(lojas, resultadosDistrito);
    showInfoBar(`${lojas.length} lojas | ${resultadosDistrito.length} jogos registrados`);
}

function displayGames(lojas, resultados) {
    const grid = document.getElementById('gamesGrid');
    grid.innerHTML = '';

    // Gerar matchups (cada loja vs proximas lojas)
    const matchups = generateMatchups(lojas);

    if (matchups.length === 0) {
        grid.innerHTML = '<p class="empty-state">Nenhum matchup para exibir</p>';
        return;
    }

    matchups.forEach((matchup, idx) => {
        const resultado = resultados.find(r =>
            (r.team1 === matchup.team1 && r.team2 === matchup.team2) ||
            (r.team1 === matchup.team2 && r.team2 === matchup.team1)
        );

        const card = createGameCard(matchup, resultado);
        grid.appendChild(card);
    });
}

function generateMatchups(lojas) {
    // Gerar pares de lojas para matchup
    // Simplificado: pega pares alternados
    const matchups = [];

    for (let i = 0; i < lojas.length - 1; i += 2) {
        matchups.push({
            team1: lojas[i],
            team2: lojas[i + 1]
        });
    }

    return matchups;
}

function createGameCard(matchup, resultado) {
    const card = document.createElement('div');
    card.className = 'game-card';

    const status = resultado ? resultado.status : 'Sem resultado';
    const score1 = resultado ? resultado.goals1 : '-';
    const score2 = resultado ? resultado.goals2 : '-';

    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${matchup.team1} vs ${matchup.team2}</div>
            <div class="score-display">
                <div class="team-score">
                    <div class="team-name">${matchup.team1}</div>
                    <div class="score-number">${score1}</div>
                </div>
                <div class="vs">vs</div>
                <div class="team-score">
                    <div class="team-name">${matchup.team2}</div>
                    <div class="score-number">${score2}</div>
                </div>
            </div>
            <div class="card-date">${resultado ? new Date(resultado.date).toLocaleDateString('pt-BR') : 'Sem data'}</div>
        </div>

        <div class="card-body">
            <div class="result-status">${status}</div>
            ${resultado ? createIndicatorsTable(resultado) : ''}
        </div>

        <div class="card-footer">
            ${resultado ? `<div class="goal-count">${score1 > score2 ? '🎯 ' + matchup.team1 + ' venceu' : score1 < score2 ? '🎯 ' + matchup.team2 + ' venceu' : '⚖️ Empate'}</div>` : ''}
            <button class="btn btn-small add-result-btn" onclick="openResultModal('${matchup.team1}', '${matchup.team2}', '${state.currentDistrito}')">
                ${resultado ? 'Editar' : 'Adicionar'}
            </button>
        </div>
    `;

    return card;
}

function createIndicatorsTable(resultado) {
    let html = '<table class="indicators-table"><thead><tr><th>Indicador</th><th>Time 1</th><th>Time 2</th></tr></thead><tbody>';

    INDICATORS.forEach(ind => {
        const key = ind.id;
        const team1Val = resultado.indicators[key]?.team1;
        const team2Val = resultado.indicators[key]?.team2;
        const winner = resultado.indicators[key]?.winner;

        if (team1Val !== undefined && team2Val !== undefined) {
            const diff1 = (team1Val.atual - team1Val.anterior).toFixed(2);
            const diff2 = (team2Val.atual - team2Val.anterior).toFixed(2);

            html += `<tr>
                <td class="indicator-name">${ind.name}</td>
                <td class="${diff1 > diff2 ? 'value-positive' : diff1 < diff2 ? 'value-negative' : 'value-neutral'}">
                    ${diff1}
                </td>
                <td class="${diff2 > diff1 ? 'value-positive' : diff2 < diff1 ? 'value-negative' : 'value-neutral'}">
                    ${diff2}
                </td>
            </tr>`;
        }
    });

    html += '</tbody></table>';
    return html;
}

// ============================================================
// MODAL E ENTRADA DE DADOS
// ============================================================

function openResultModal(team1, team2, distrito) {
    state.currentGame = { team1, team2, distrito };

    document.getElementById('gameTeams').textContent = `${team1} vs ${team2}`;
    document.getElementById('gameDistrict').textContent = `Distrito: ${distrito}`;

    // Limpar form
    document.getElementById('resultDisplay').classList.add('hidden');
    generateIndicatorInputs();

    document.getElementById('resultModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('resultModal').classList.add('hidden');
    state.currentGame = null;
}

function generateIndicatorInputs() {
    const form = document.getElementById('indicatorsForm');
    form.innerHTML = '';

    INDICATORS.forEach(ind => {
        const container = document.createElement('div');
        container.style.gridColumn = '1 / -1';
        container.innerHTML = `
            <h5 style="margin-bottom: 15px; margin-top: 15px; color: #667eea; font-weight: 600;">${ind.name} (${ind.type})</h5>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;">
                <div class="form-group">
                    <label>Sem. Ant. - ${state.currentGame.team1}</label>
                    <input type="number" step="0.01" placeholder="0" data-indicator="${ind.id}" data-team="1" data-period="anterior">
                </div>
                <div class="form-group">
                    <label>Sem. Atu. - ${state.currentGame.team1}</label>
                    <input type="number" step="0.01" placeholder="0" data-indicator="${ind.id}" data-team="1" data-period="atual">
                </div>
                <div class="form-group">
                    <label>Sem. Ant. - ${state.currentGame.team2}</label>
                    <input type="number" step="0.01" placeholder="0" data-indicator="${ind.id}" data-team="2" data-period="anterior">
                </div>
                <div class="form-group">
                    <label>Sem. Atu. - ${state.currentGame.team2}</label>
                    <input type="number" step="0.01" placeholder="0" data-indicator="${ind.id}" data-team="2" data-period="atual">
                </div>
            </div>
        `;
        form.appendChild(container);
    });
}

function calculateGameResult() {
    const inputs = document.querySelectorAll('#indicatorsForm input');
    const indicatorData = {};
    let goals1 = 0, goals2 = 0;

    // Agrupar dados por indicador
    INDICATORS.forEach(ind => {
        indicatorData[ind.id] = {
            team1: { anterior: 0, atual: 0 },
            team2: { anterior: 0, atual: 0 }
        };
    });

    inputs.forEach(input => {
        const ind = input.dataset.indicator;
        const team = input.dataset.team;
        const period = input.dataset.period;
        const value = parseFloat(input.value) || 0;

        indicatorData[ind][`team${team}`][period] = value;
    });

    // Calcular gols
    Object.entries(indicatorData).forEach(([ind, data]) => {
        const evolTeam1 = data.team1.atual - data.team1.anterior;
        const evolTeam2 = data.team2.atual - data.team2.anterior;

        if (evolTeam1 > evolTeam2) goals1++;
        else if (evolTeam2 > evolTeam1) goals2++;
    });

    // Determinar status
    let status = 'EMPATE';
    if (goals1 > goals2) status = `${state.currentGame.team1} VENCEU`;
    else if (goals2 > goals1) status = `${state.currentGame.team2} VENCEU`;

    // Exibir resultado
    document.getElementById('resultTeamA').textContent = goals1;
    document.getElementById('resultTeamB').textContent = goals2;
    document.getElementById('resultStatus').textContent = status;
    document.getElementById('resultDisplay').classList.remove('hidden');

    // Guardar dados
    state.indicatorData = {
        team1: state.currentGame.team1,
        team2: state.currentGame.team2,
        goals1,
        goals2,
        status,
        indicators: indicatorData,
        date: new Date().toISOString()
    };
}

// ============================================================
// SALVAR RESULTADOS
// ============================================================

function saveResult() {
    if (!state.indicatorData.team1) {
        alert('Por favor, calcule o resultado primeiro');
        return;
    }

    state.resultados.push(state.indicatorData);
    saveToLocalStorage();
    closeModal();
    loadGames(); // Recarregar view
    alert('Resultado salvo com sucesso!');
}

// Adicionar botão de salvar depois do cálculo
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const modal = document.getElementById('resultModal');
        if (modal && !document.getElementById('saveResultBtn')) {
            const btn = document.createElement('button');
            btn.id = 'saveResultBtn';
            btn.className = 'btn btn-primary';
            btn.textContent = 'Salvar Resultado';
            btn.style.marginLeft = '10px';
            btn.onclick = saveResult;

            const resultDisplay = document.getElementById('resultDisplay');
            if (resultDisplay) {
                resultDisplay.parentElement.appendChild(btn);
            }
        }
    }, 1000);
});

// ============================================================
// UTILIDADES
// ============================================================

function showInfoBar(text) {
    const bar = document.getElementById('infoBar');
    document.getElementById('infoText').textContent = text;
    bar.classList.remove('hidden');
}

function showErrorMessage(msg) {
    alert(`❌ ${msg}`);
}

function saveToLocalStorage() {
    localStorage.setItem('campeonato_resultados', JSON.stringify(state.resultados));
}

function loadFromLocalStorage() {
    const data = localStorage.getItem('campeonato_resultados');
    if (data) {
        state.resultados = JSON.parse(data);
    }
}
