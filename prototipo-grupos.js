// ============================================================
// PROTÓTIPO — classificação simulada por grupo (nível LOJA)
//
// Esquerda : classificação oficial até a rodada encerrada (Power BI)
// Direita  : a mesma classificação + os placares projetados da rodada atual
//
// Critério de desempate: Pts > VIT > SG > GM — o mesmo do export oficial
// (conferido: reproduz exatamente os 14 grupos da rodada 7).
// ============================================================

const st = {
    semana: null, semanaVigente: null, semanas: [],
    rodadaBase: null, grupos: {}, summary: null,
    estrutura: {}, minhasLojas: new Set(),
    grupo: '', destacar: false
};

const REGIONAL_DESTAQUE = 'R2 - Luiz';

const pegar = (p) => fetch(`/api${p}`, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
});

function info(html) {
    document.getElementById('infoBar').innerHTML = `<span>${html}</span>`;
}

// ---- ordenação oficial ----
function ordenar(linhas) {
    return linhas.slice().sort((a, b) =>
        b.pts - a.pts || b.vit - a.vit || b.sg - a.sg || b.gm - a.gm ||
        a.time.localeCompare(b.time));
}

async function iniciar() {
    try {
        const [sem, cls, est] = await Promise.all([
            pegar('/semana'), pegar('/classificacao'), pegar('/estrutura')
        ]);

        st.semanaVigente = sem.semana;
        st.semana = sem.semana;
        st.semanas = sem.disponiveis || [sem.semana];
        st.rodadaBase = cls.rodada;
        st.grupos = cls.grupos || {};
        st.estrutura = est.estrutura || est;

        Object.values(st.estrutura[REGIONAL_DESTAQUE] || {}).forEach(lojas =>
            lojas.forEach(l => st.minhasLojas.add(l)));

        if (!Object.keys(st.grupos).length) {
            info('❌ Nenhuma classificação encontrada na pasta "Classificação Lojas" do SharePoint.');
            return;
        }

        montarSelects();
        await carregarSummary();
        render();
    } catch (e) {
        console.error(e);
        info(`❌ Erro ao iniciar: ${e.message}`);
    }
}

function montarSelects() {
    const nomes = Object.keys(st.grupos).sort((a, b) => {
        const na = parseInt((a.match(/Grupo\s+(\d+)/) || [])[1] || 0, 10);
        const nb = parseInt((b.match(/Grupo\s+(\d+)/) || [])[1] || 0, 10);
        return na - nb;
    });
    st.grupo = nomes[0];

    const sG = document.getElementById('fGrupo');
    sG.innerHTML = nomes.map(n => `<option value="${n}">${n}</option>`).join('');
    sG.onchange = (e) => { st.grupo = e.target.value; render(); };

    const sR = document.getElementById('fRodada');
    sR.innerHTML = st.semanas.slice().sort((a, b) => b - a)
        .map(n => `<option value="${n}"${n === st.semana ? ' selected' : ''}>Rodada ${n}${n === st.semanaVigente ? ' (atual)' : ''}</option>`).join('');
    sR.onchange = async (e) => {
        st.semana = parseInt(e.target.value, 10);
        info('⏳ Carregando rodada...');
        await carregarSummary();
        render();
    };

    document.getElementById('soMinha').onchange = (e) => {
        st.destacar = e.target.checked;
        render();
    };
}

async function carregarSummary() {
    st.summary = await pegar(`/games-summary/${st.semana}`);
}

// ---- projeção da rodada atual, por loja ----
function projecaoDaRodada() {
    const jogos = st.summary?.games || [];
    const semDados = !!st.summary?.semDadosAtual;
    const proj = {};
    if (semDados) return { proj, semDados };

    jogos.forEach(g => {
        const [a, b] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        [[g.team1, a, b], [g.team2, b, a]].forEach(([time, gm, gs]) => {
            proj[time] = {
                pts: gm > gs ? 3 : gm === gs ? 1 : 0,
                vit: gm > gs ? 1 : 0, emp: gm === gs ? 1 : 0, der: gm < gs ? 1 : 0,
                gm, gs
            };
        });
    });
    return { proj, semDados };
}

function render() {
    const painel = document.getElementById('painel');
    const base = st.grupos[st.grupo] || [];
    const { proj, semDados } = projecaoDaRodada();

    const atual = ordenar(base);
    const posBase = {};
    atual.forEach((r, i) => posBase[r.time] = i + 1);

    const simulado = ordenar(base.map(r => {
        const p = proj[r.time];
        if (!p) return { ...r, semJogo: true };
        return {
            ...r,
            pts: r.pts + p.pts, jogos: r.jogos + 1,
            vit: r.vit + p.vit, emp: r.emp + p.emp, der: r.der + p.der,
            gm: r.gm + p.gm, gs: r.gs + p.gs, sg: (r.gm + p.gm) - (r.gs + p.gs),
            ganhou: p.pts
        };
    }));

    const semJogo = simulado.filter(r => r.semJogo).length;

    painel.innerHTML = `
    ${semDados ? `<div class="alerta-info" style="margin-bottom:14px">
        A rodada ${st.semana} ainda não tem vendas lançadas, então a projeção é igual à classificação atual.
        Escolha a <b>rodada 7</b> para ver a simulação com placares reais.</div>` : ''}
    <div class="comparacao">
        <div class="quadro atual">
            <div class="quadro-head">📋 Classificação atual <small>até a rodada ${st.rodadaBase}</small></div>
            <div class="tab-wrap">${tabela(atual, null, false)}</div>
            <div class="legenda">Fonte: pasta “Classificação Lojas” do SharePoint.</div>
        </div>
        <div class="quadro sim">
            <div class="quadro-head">🔮 Simulada <small>rodada ${st.rodadaBase} + projeção da ${st.semana}</small></div>
            <div class="tab-wrap">${tabela(simulado, posBase, true)}</div>
            <div class="legenda">Desempate: Pts › VIT › SG › GM.${semJogo ? ` ${semJogo} loja(s) sem jogo nesta rodada.` : ''}</div>
        </div>
    </div>`;

    info(`📊 ${st.grupo} · ${base.length} lojas · base rodada ${st.rodadaBase} + projeção da rodada ${st.semana}`);
}

function tabela(linhas, posBase, ehSim) {
    const corpo = linhas.map((r, i) => {
        const pos = i + 1;
        let mov = '';
        if (posBase) {
            const d = posBase[r.time] - pos;
            mov = d > 0 ? `<span class="mov sobe">▲ ${d}</span>`
                : d < 0 ? `<span class="mov desce">▼ ${-d}</span>`
                    : '<span class="mov igual">–</span>';
        }
        const dest = st.destacar && st.minhasLojas.has(r.time) ? ' dest' : '';
        const ganho = ehSim && r.ganhou !== undefined
            ? `<td class="c" title="Pontos ganhos na rodada ${st.semana}">+${r.ganhou}</td>` : (ehSim ? '<td class="c">—</td>' : '');
        return `<tr class="${dest.trim()}">
            <td>${pos}</td>
            ${posBase ? `<td>${mov}</td>` : ''}
            <td class="l">${r.time}</td>
            <td class="pts">${r.pts}</td>
            ${ganho}
            <td>${r.jogos}</td><td>${r.vit}</td><td>${r.emp}</td><td>${r.der}</td>
            <td>${r.gm}</td><td>${r.gs}</td><td>${r.sg}</td></tr>`;
    }).join('');

    return `<table class="tab-grupo">
        <thead><tr>
            <th>#</th>${posBase ? '<th>Mov.</th>' : ''}<th class="l">Time</th><th>Pts</th>
            ${ehSim ? '<th>+Rod.</th>' : ''}
            <th>J</th><th>V</th><th>E</th><th>D</th><th>GM</th><th>GS</th><th>SG</th>
        </tr></thead><tbody>${corpo}</tbody></table>`;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}
