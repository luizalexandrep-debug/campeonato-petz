// ============================================================
// PROTÓTIPO — classificação simulada por grupo (nível LOJA)
//
// Esquerda : classificação oficial até a rodada encerrada (Power BI)
// Direita  : a mesma classificação + os placares projetados da rodada atual
//
// Desempate (regra oficial, item 7 do regulamento): 1º vitórias, 2º saldo de
// gols, 3º confronto direto, 4º crescimento de share MP, 5º turn over.
// Confronto direto em diante depende de dados que o app não tem (histórico de
// cada confronto, share da campanha, RH). Usamos Pts > VIT > SG > GM, que
// reproduz EXATAMENTE os 14 grupos do export oficial da rodada 7, inclusive
// nos 29 empates que chegam até o saldo de gols — ordem alfabética, citada no
// regulamento para a parcial, reproduz apenas 4 dos 14.
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

        // loja -> regional, para o panorama entre as três regionais
        st.lojaRegional = {};
        Object.entries(st.estrutura).forEach(([reg, dists]) =>
            Object.values(dists).forEach(lojas =>
                lojas.forEach(l => { st.lojaRegional[l] = reg; })));

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

    // Só rodadas POSTERIORES à base: projetar uma rodada que a base já inclui
    // somaria os mesmos pontos duas vezes.
    const projetaveis = st.semanas.filter(n => n > st.rodadaBase).sort((a, b) => b - a);
    st.semana = projetaveis.includes(st.semanaVigente) ? st.semanaVigente : (projetaveis[0] ?? null);

    const sR = document.getElementById('fRodada');
    sR.innerHTML = projetaveis.length
        ? projetaveis.map(n => `<option value="${n}"${n === st.semana ? ' selected' : ''}>Rodada ${n}${n === st.semanaVigente ? ' (atual)' : ''}</option>`).join('')
        : '<option value="">nenhuma</option>';
    sR.disabled = !projetaveis.length;
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
    st.summary = st.semana ? await pegar(`/games-summary/${st.semana}`) : null;
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
                gm, gs,
                adv: time === g.team1 ? g.team2 : g.team1
            };
        });
    });
    return { proj, semDados };
}

// ============================================================
// PANORAMA — visão dos 14 grupos de uma vez
// ============================================================

const TOTAL_RODADAS = 19;

function classificarGrupo(linhas, proj) {
    const sim = ordenar(linhas.map(r => {
        const p = proj[r.time];
        if (!p) return { ...r, semJogo: true };
        return {
            ...r,
            pts: r.pts + p.pts, jogos: r.jogos + 1,
            vit: r.vit + p.vit, emp: r.emp + p.emp, der: r.der + p.der,
            gm: r.gm + p.gm, gs: r.gs + p.gs, sg: (r.gm + p.gm) - (r.gs + p.gs),
            ganhou: p.pts, adv: p.adv
        };
    }));
    return { base: ordenar(linhas), sim };
}

function calcularPanorama() {
    const { proj } = projecaoDaRodada();
    const regs = Object.keys(st.estrutura);
    const zero = () => ({ lider: 0, top4: 0, ultimos4: 0 });
    const tot = {};
    regs.forEach(r => { tot[r] = { base: zero(), sim: zero() }; });

    const movs = [];      // mudanças que envolvem lojas da minha regional
    const alvos = [];     // lojas minhas perto da liderança

    Object.entries(st.grupos).forEach(([grupo, linhas]) => {
        const { base, sim } = classificarGrupo(linhas, proj);
        const n = base.length;
        const posB = {}, posS = {};
        base.forEach((r, i) => posB[r.time] = i + 1);
        sim.forEach((r, i) => posS[r.time] = i + 1);

        base.forEach((r, i) => { const g = st.lojaRegional[r.time]; if (tot[g]) { if (i === 0) tot[g].base.lider++; if (i < 4) tot[g].base.top4++; if (i >= n - 4) tot[g].base.ultimos4++; } });
        sim.forEach((r, i) => { const g = st.lojaRegional[r.time]; if (tot[g]) { if (i === 0) tot[g].sim.lider++; if (i < 4) tot[g].sim.top4++; if (i >= n - 4) tot[g].sim.ultimos4++; } });

        // movimentações das MINHAS lojas nas duas pontas
        linhas.forEach(r => {
            if (!st.minhasLojas.has(r.time)) return;
            const b = posB[r.time], s2 = posS[r.time];
            const zonaB = b === 1 ? 'lider' : b <= 4 ? 'top4' : b > n - 4 ? 'queda' : 'meio';
            const zonaS = s2 === 1 ? 'lider' : s2 <= 4 ? 'top4' : s2 > n - 4 ? 'queda' : 'meio';
            if (zonaB === zonaS && b === s2) return;
            if (zonaB === zonaS && zonaB === 'meio') return;
            const linhaSim = sim.find(x => x.time === r.time) || {};
            movs.push({ grupo, time: r.time, de: b, para: s2, zonaB, zonaS, adv: linhaSim.adv, ganhou: linhaSim.ganhou });
        });

        // alvos: minhas lojas que não lideram, com a distância para o 1º
        sim.forEach((r, i) => {
            if (i === 0 || !st.minhasLojas.has(r.time)) return;
            const lider = sim[0];
            const gap = lider.pts - r.pts;
            const restam = TOTAL_RODADAS - r.jogos;
            if (gap <= 9 && restam > 0) {
                alvos.push({ grupo, time: r.time, pos: i + 1, gap, restam, lider: lider.time });
            }
        });
    });

    movs.sort((a, b) => (a.grupo).localeCompare(b.grupo, 'pt', { numeric: true }));
    alvos.sort((a, b) => a.gap - b.gap || a.pos - b.pos);
    return { tot, movs, alvos };
}

function nomeCurto(reg) {
    const p = reg.split(' - ');
    return p.length > 1 ? `${p[0]} (${p[1]})` : reg;
}

function delta(a, b) {
    const d = b - a;
    if (d > 0) return `<span class="mov sobe">▲ ${d}</span>`;
    if (d < 0) return `<span class="mov desce">▼ ${-d}</span>`;
    return '<span class="mov igual">–</span>';
}

function panoramaHtml() {
    const { tot, movs, alvos } = calcularPanorama();
    const regs = Object.keys(tot).sort();

    const linhas = regs.map(r => {
        const t = tot[r];
        const eu = r === REGIONAL_DESTAQUE;
        return `<tr class="${eu ? 'dest' : ''}">
            <td class="l">${nomeCurto(r)}${eu ? ' ★' : ''}</td>
            <td>${t.base.lider}</td><td class="pts">${t.sim.lider}</td><td>${delta(t.base.lider, t.sim.lider)}</td>
            <td>${t.base.top4}</td><td class="pts">${t.sim.top4}</td><td>${delta(t.base.top4, t.sim.top4)}</td>
            <td>${t.base.ultimos4}</td><td class="pts">${t.sim.ultimos4}</td><td>${delta(t.base.ultimos4, t.sim.ultimos4)}</td>
        </tr>`;
    }).join('');

    const rotZona = { lider: 'liderança', top4: 'top 4', queda: 'zona de queda', meio: 'meio da tabela' };
    const movHtml = movs.length ? movs.map(m => {
        const subiu = m.para < m.de;
        const destaque = (m.zonaS === 'lider' && m.zonaB !== 'lider') ? 'ganho'
            : (m.zonaB === 'lider' && m.zonaS !== 'lider') ? 'perda'
                : (m.zonaS === 'queda' && m.zonaB !== 'queda') ? 'perda'
                    : (m.zonaB === 'queda' && m.zonaS !== 'queda') ? 'ganho' : '';
        return `<li class="${destaque}">
            <b>${m.time}</b> · ${m.grupo} — ${m.de}º → <b>${m.para}º</b>
            ${m.zonaB !== m.zonaS ? `<i>(${rotZona[m.zonaB]} → ${rotZona[m.zonaS]})</i>` : ''}
            ${m.adv ? `<small>· jogo da rodada contra ${m.adv}, +${m.ganhou} pt(s)</small>` : '<small>· sem jogo nesta rodada</small>'}
        </li>`;
    }).join('') : '<li>Nenhuma loja da sua regional muda de posição nas pontas nesta projeção.</li>';

    const alvosHtml = alvos.length ? alvos.slice(0, 12).map(a => `
        <li><b>${a.time}</b> · ${a.grupo} — ${a.pos}º, <b>${a.gap} pt${a.gap === 1 ? '' : 's'}</b>
        atrás de ${a.lider} · faltam ${a.restam} rodadas
        <small>· ${a.gap <= a.restam * 3 ? 'alcançável' : 'fora de alcance matemático'}</small></li>`).join('')
        : '<li>Nenhuma loja sua a menos de 9 pontos da liderança.</li>';

    return `
    <div class="painel-geral">
        <div class="pg-bloco">
            <h3>🌎 Panorama das 14 lideranças</h3>
            <div class="tab-wrap"><table class="tab-grupo tab-pan">
                <thead><tr>
                    <th class="l">Regional</th>
                    <th colspan="3">Lideranças</th>
                    <th colspan="3">Top 4</th>
                    <th colspan="3">Últimos 4</th>
                </tr><tr class="sub">
                    <th class="l"></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                </tr></thead>
                <tbody>${linhas}</tbody>
            </table></div>
        </div>

        <div class="pg-bloco">
            <h3>🔀 Movimentações nas pontas — ${nomeCurto(REGIONAL_DESTAQUE)}</h3>
            <ul class="pg-lista">${movHtml}</ul>
        </div>

        <div class="pg-bloco">
            <h3>🎯 Onde dá para atacar a liderança</h3>
            <ul class="pg-lista">${alvosHtml}</ul>
            <div class="pg-nota">Distância em pontos após a projeção da rodada ${st.semana}.
                “Alcançável” considera só a matemática (3 pontos por rodada restante).</div>
        </div>
    </div>`;
}

function render() {
    const painel = document.getElementById('painel');
    const base = st.grupos[st.grupo] || [];
    const { proj, semDados } = projecaoDaRodada();
    st.projAtual = proj;   // usado pelo tooltip da sigla

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
    ${panoramaHtml()}
    ${!st.semana ? `<div class="alerta-info" style="margin-bottom:14px">
        A classificação da pasta já vai até a rodada ${st.rodadaBase} e não há rodada
        posterior publicada para projetar. Assim que a rodada ${st.rodadaBase + 1} tiver
        confrontos, a simulação aparece aqui.</div>`
    : semDados ? `<div class="alerta-info" style="margin-bottom:14px">
        A rodada ${st.semana} ainda não tem vendas lançadas — nenhum resultado é atribuído,
        então a coluna simulada repete a classificação atual. Ela passa a se mover
        assim que o primeiro dia da rodada for lançado.</div>` : ''}
    <div class="comparacao">
        <div class="quadro atual">
            <div class="quadro-head">📋 Classificação atual <small>até a rodada ${st.rodadaBase}</small></div>
            <div class="tab-wrap">${tabela(atual, null, false)}</div>
            <div class="legenda">Fonte: pasta “Classificação Lojas” do SharePoint.</div>
        </div>
        <div class="quadro sim">
            <div class="quadro-head">🔮 Simulada <small>rodada ${st.rodadaBase}${st.semana ? ` + projeção da ${st.semana}` : ''}</small></div>
            <div class="tab-wrap">${tabela(simulado, posBase, true)}</div>
            <div class="legenda">Desempate: Pts › VIT › SG › GM — mesma ordem do
                painel oficial. Pelo regulamento, empates que persistem no saldo vão a
                confronto direto, share MP e turn over, que o app não calcula.${semJogo ? ` ${semJogo} loja(s) sem jogo nesta rodada.` : ''}</div>
        </div>
    </div>`;

    // dados prontos para o exportador de imagem
    window.__dadosExportGrupo = {
        grupo: st.grupo, rodadaBase: st.rodadaBase, rodadaProj: st.semana,
        atual: atual.map((r, i) => ({ ...r, pos: i + 1 })),
        simulado: simulado.map((r, i) => ({ ...r, pos: i + 1, movNum: posBase[r.time] - (i + 1) }))
    };

    info(`📊 ${st.grupo} · ${base.length} lojas · base até a rodada ${st.rodadaBase}`
        + (st.semana ? ` + projeção da rodada ${st.semana}` : ' · sem rodada a projetar'));
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
            <td class="l"><span class="sigla" data-jogo="${confrontoTexto(r.time)}">${r.time}</span></td>
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

function confrontoTexto(time) {
    const p = (st.projAtual || {})[time];
    if (!p) return `${time} · sem jogo na rodada ${st.semana || '-'}`;
    return `${time} ${p.gm} × ${p.gs} ${p.adv}`;
}

// Tooltip próprio: o title nativo demora ~1s para aparecer.
let _tip = null;
function setupTooltipSigla() {
    document.addEventListener('mouseover', (e) => {
        const alvo = e.target.closest('.sigla[data-jogo]');
        if (!alvo) return;
        if (!_tip) {
            _tip = document.createElement('div');
            _tip.className = 'tip-jogo';
            document.body.appendChild(_tip);
        }
        _tip.textContent = alvo.dataset.jogo;
        _tip.style.display = 'block';
    });
    document.addEventListener('mousemove', (e) => {
        if (!_tip || _tip.style.display !== 'block') return;
        _tip.style.left = (e.clientX + 14) + 'px';
        _tip.style.top = (e.clientY + 16) + 'px';
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('.sigla[data-jogo]') && _tip) _tip.style.display = 'none';
    });
}

setupTooltipSigla();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}
