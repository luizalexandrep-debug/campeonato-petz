/**
 * Dashboard v2 - Integração com API Real
 * Consome dados do backend que lê arquivos do SharePoint
 */

const state = {
    lojas: [],
    currentComparison: null
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    try {
        // Carregar lista de lojas
        await loadLojas();

        // Attach event listeners
        document.getElementById('compararBtn').addEventListener('click', compararLojas);
    } catch (error) {
        showError('Erro ao inicializar aplicação: ' + error.message);
    }
}

// ============================================================
// CARREGAR LOJAS
// ============================================================

async function loadLojas() {
    try {
        showLoading('Carregando lista de lojas...');

        const data = await api.getLojas();
        state.lojas = data.lojas;

        // Popular selects
        populateSelects();

        hideLoading();
        showSuccess(`✅ ${state.lojas.length} lojas carregadas`);
    } catch (error) {
        showError('Erro ao carregar lojas: ' + error.message);
    }
}

function populateSelects() {
    const select1 = document.getElementById('team1Select');
    const select2 = document.getElementById('team2Select');

    // Limpar opções anteriores
    select1.innerHTML = '<option value="">Selecione o Time A...</option>';
    select2.innerHTML = '<option value="">Selecione o Time B...</option>';

    // Adicionar lojas
    state.lojas.forEach(loja => {
        const opt1 = document.createElement('option');
        opt1.value = loja;
        opt1.textContent = loja;
        select1.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = loja;
        opt2.textContent = loja;
        select2.appendChild(opt2);
    });
}

// ============================================================
// COMPARAÇÃO
// ============================================================

async function compararLojas() {
    const team1 = document.getElementById('team1Select').value;
    const team2 = document.getElementById('team2Select').value;

    if (!team1 || !team2) {
        showError('Selecione dois times para comparar');
        return;
    }

    if (team1 === team2) {
        showError('Selecione times diferentes');
        return;
    }

    try {
        showLoading(`Comparando ${team1} vs ${team2}...`);
        document.getElementById('resultContainer').classList.add('hidden');
        document.getElementById('emptyState').classList.add('hidden');

        const resultado = await api.compararLojas(team1, team2);
        state.currentComparison = resultado;

        hideLoading();
        displayResult(resultado);

    } catch (error) {
        showError('Erro na comparação: ' + error.message);
    }
}

function displayResult(resultado) {
    const { team1, team2, gols, indicadores, resultado: resultadoTexto, pontos } = resultado;

    // Header com nomes
    document.getElementById('team1Name').textContent = team1;
    document.getElementById('team2Name').textContent = team2;

    // Placar
    document.getElementById('team1Score').textContent = gols.team1;
    document.getElementById('team2Score').textContent = gols.team2;

    // Resultado
    document.getElementById('resultStatus').innerHTML = `
        <h2 style="color: #667eea; margin: 0;">${resultadoTexto}</h2>
        <p style="font-size: 1.1em; margin: 10px 0;">
            ${pontos.team1} pts para ${team1} | ${pontos.team2} pts para ${team2}
        </p>
    `;

    // Indicadores
    displayIndicadores(indicadores, team1, team2);

    // Resumo
    document.getElementById('resultSummary').textContent = `
        ${team1} marcou ${gols.team1} gols | ${team2} marcou ${gols.team2} gols
        ${gols.team1 > gols.team2 ? `👑 ${team1} venceu!` : gols.team2 > gols.team1 ? `👑 ${team2} venceu!` : '⚖️ Empataram!'}
    `;

    // Mostrar resultado
    document.getElementById('resultContainer').classList.remove('hidden');
    document.getElementById('emptyState').classList.add('hidden');
}

function displayIndicadores(indicadores, team1, team2) {
    const container = document.getElementById('indicatorsCards');
    container.innerHTML = '';

    Object.entries(indicadores).forEach(([arquivo, data]) => {
        const card = document.createElement('div');
        card.className = 'indicator-card-result';

        const evolTeam1 = data.team1.evolucao;
        const evolTeam2 = data.team2.evolucao;
        const vencedor = data.vencedor;

        let vencedorHTML = '';
        if (vencedor === 'team1') {
            vencedorHTML = `<div class="winner-badge winner-team1">🎯 ${team1}</div>`;
        } else if (vencedor === 'team2') {
            vencedorHTML = `<div class="winner-badge winner-team2">🎯 ${team2}</div>`;
        } else {
            vencedorHTML = `<div class="winner-badge winner-tie">⚖️ Empate</div>`;
        }

        card.innerHTML = `
            <div class="indicator-header">
                <h4>${data.name}</h4>
                <span class="indicator-type">${data.type}</span>
            </div>

            <div class="indicator-comparison">
                <div class="team-comparison">
                    <span class="team-label">${team1}</span>
                    <div class="values">
                        <div class="value-row">
                            <span class="label">Semana Anterior:</span>
                            <span class="value">${data.team1.anterior.toFixed(2)}</span>
                        </div>
                        <div class="value-row">
                            <span class="label">Semana Atual:</span>
                            <span class="value">${data.team1.atual.toFixed(2)}</span>
                        </div>
                        <div class="value-row evolution">
                            <span class="label">Evolução:</span>
                            <span class="value ${evolTeam1 > 0 ? 'positive' : evolTeam1 < 0 ? 'negative' : 'neutral'}">
                                ${evolTeam1 > 0 ? '+' : ''}${evolTeam1.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="divider"></div>

                <div class="team-comparison">
                    <span class="team-label">${team2}</span>
                    <div class="values">
                        <div class="value-row">
                            <span class="label">Semana Anterior:</span>
                            <span class="value">${data.team2.anterior.toFixed(2)}</span>
                        </div>
                        <div class="value-row">
                            <span class="label">Semana Atual:</span>
                            <span class="value">${data.team2.atual.toFixed(2)}</span>
                        </div>
                        <div class="value-row evolution">
                            <span class="label">Evolução:</span>
                            <span class="value ${evolTeam2 > 0 ? 'positive' : evolTeam2 < 0 ? 'negative' : 'neutral'}">
                                ${evolTeam2 > 0 ? '+' : ''}${evolTeam2.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="indicator-footer">
                ${vencedorHTML}
            </div>
        `;

        container.appendChild(card);
    });
}

// ============================================================
// UI Helpers
// ============================================================

function showLoading(message = 'Carregando...') {
    const bar = document.getElementById('loadingBar');
    bar.querySelector('span').textContent = '⏳ ' + message;
    bar.classList.remove('hidden');
    document.getElementById('errorBar').classList.add('hidden');
    document.getElementById('successBar').classList.add('hidden');
}

function hideLoading() {
    document.getElementById('loadingBar').classList.add('hidden');
}

function showError(message) {
    const bar = document.getElementById('errorBar');
    document.getElementById('errorText').textContent = '❌ ' + message;
    bar.classList.remove('hidden');
    document.getElementById('loadingBar').classList.add('hidden');
    document.getElementById('successBar').classList.add('hidden');
    console.error(message);
}

function showSuccess(message) {
    const bar = document.getElementById('successBar');
    document.getElementById('successText').textContent = message;
    bar.classList.remove('hidden');
    document.getElementById('loadingBar').classList.add('hidden');
    document.getElementById('errorBar').classList.add('hidden');
}
