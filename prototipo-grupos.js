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

    const g4 = [];        // minhas lojas no top 4 (antes ou depois da projeção)
    const z4 = [];        // minhas lojas na zona de queda
    const trocas = [];    // grupos onde o líder muda na projeção

    Object.entries(st.grupos).forEach(([grupo, linhas]) => {
        const { base, sim } = classificarGrupo(linhas, proj);
        const n = base.length;
        const posB = {}, posS = {};
        base.forEach((r, i) => posB[r.time] = i + 1);
        sim.forEach((r, i) => posS[r.time] = i + 1);

        base.forEach((r, i) => { const g = st.lojaRegional[r.time]; if (tot[g]) { if (i === 0) tot[g].base.lider++; if (i < 4) tot[g].base.top4++; if (i >= n - 4) tot[g].base.ultimos4++; } });
        sim.forEach((r, i) => { const g = st.lojaRegional[r.time]; if (tot[g]) { if (i === 0) tot[g].sim.lider++; if (i < 4) tot[g].sim.top4++; if (i >= n - 4) tot[g].sim.ultimos4++; } });

        // troca de liderança no grupo (qualquer regional)
        if (base.length && sim.length && base[0].time !== sim[0].time) {
            trocas.push({
                grupo,
                novo: sim[0].time, novoReg: st.lojaRegional[sim[0].time],
                antigo: base[0].time, antigoReg: st.lojaRegional[base[0].time],
                ptsNovo: sim[0].pts, ptsAntigo: (sim.find(x => x.time === base[0].time) || {}).pts,
                posAntigo: sim.findIndex(x => x.time === base[0].time) + 1
            });
        }

        // Minhas lojas nas duas pontas: G4 (4 primeiros) e Z4 (4 últimos).
        // Uma loja entra na lista se estiver na zona ANTES ou DEPOIS da projeção,
        // para que entradas e saídas apareçam junto de quem permaneceu.
        const primeiroForaZ4 = sim[n - 5];      // referência de quem escapa do Z4
        const quartoColocado = sim[3];          // referência de quem entra no G4
        linhas.forEach(r => {
            if (!st.minhasLojas.has(r.time)) return;
            const b = posB[r.time], s2 = posS[r.time];
            const noG4B = b <= 4, noG4S = s2 <= 4;
            const noZ4B = b > n - 4, noZ4S = s2 > n - 4;
            const linhaSim = sim.find(x => x.time === r.time) || {};
            const comum = {
                grupo, time: r.time, de: b, para: s2,
                adv: linhaSim.adv, ganhou: linhaSim.ganhou, pts: linhaSim.pts
            };

            if (noG4B || noG4S) {
                g4.push({
                    ...comum,
                    situacao: noG4S && !noG4B ? 'entrou' : !noG4S && noG4B ? 'saiu' : 'ficou',
                    lider: sim[0].time,
                    gapLider: sim[0].pts - linhaSim.pts,
                    // para quem está fora, quanto falta para alcançar o 4º
                    gapG4: noG4S ? 0 : (quartoColocado ? quartoColocado.pts - linhaSim.pts : 0)
                });
            }
            if (noZ4B || noZ4S) {
                z4.push({
                    ...comum,
                    situacao: !noZ4S && noZ4B ? 'saiu' : noZ4S && !noZ4B ? 'entrou' : 'ficou',
                    // quanto falta para sair do Z4 (alcançar o 1º fora da zona)
                    gapSalvacao: noZ4S && primeiroForaZ4 ? primeiroForaZ4.pts - linhaSim.pts : 0,
                    margem: !noZ4S && primeiroForaZ4 ? linhaSim.pts - (sim[n - 4] ? sim[n - 4].pts : 0) : 0
                });
            }
        });

    });

    // Entradas e saídas primeiro — é o que muda a decisão; depois por posição.
    const ordemSit = { entrou: 0, saiu: 1, ficou: 2 };
    g4.sort((a, b) => ordemSit[a.situacao] - ordemSit[b.situacao] || a.para - b.para);
    z4.sort((a, b) => ordemSit[a.situacao] - ordemSit[b.situacao] || b.para - a.para);
    trocas.sort((a, b) => (a.grupo).localeCompare(b.grupo, 'pt', { numeric: true }));
    return { tot, g4, z4, trocas };
}

function nomeCurto(reg) {
    const p = reg.split(' - ');
    return p.length > 1 ? `${p[0]} (${p[1]})` : reg;
}

// menorEhMelhor: na coluna "Últimos 4" (zona de queda) crescer é ruim, então
// a seta acompanha o NÚMERO e a cor acompanha o BENEFÍCIO.
function delta(a, b, menorEhMelhor) {
    const d = b - a;
    if (d === 0) return '<span class="mov igual">–</span>';
    const seta = d > 0 ? '▲' : '▼';
    const bom = menorEhMelhor ? d < 0 : d > 0;
    return `<span class="mov ${bom ? 'sobe' : 'desce'}">${seta} ${Math.abs(d)}</span>`;
}

function textoTrocas(trocas) {
    if (!trocas.length) {
        return `<div class="pg-texto">Nenhuma liderança muda de dono com a projeção da rodada ${st.semana}:
            os 14 líderes seguem os mesmos.</div>`;
    }

    const eu = (reg) => reg === REGIONAL_DESTAQUE;
    const tag = (reg) => reg ? `<span class="tag${eu(reg) ? ' minha' : ''}">${nomeCurto(reg)}</span>` : '';

    const itens = trocas.map(t => {
        const ganho = eu(t.novoReg), perda = eu(t.antigoReg);
        const classe = ganho && !perda ? 'ganho' : perda && !ganho ? 'perda' : '';
        return `<li class="${classe}">
            <b>${t.novo}</b> ${tag(t.novoReg)} assume a liderança do <b>${t.grupo}</b>
            com ${t.ptsNovo} pts, no lugar de <b>${t.antigo}</b> ${tag(t.antigoReg)}
            <small>· ${t.antigo} cai para ${t.posAntigo}º com ${t.ptsAntigo} pts</small>
        </li>`;
    }).join('');

    const ganhas = trocas.filter(t => t.novoReg === REGIONAL_DESTAQUE && t.antigoReg !== REGIONAL_DESTAQUE).length;
    const perdidas = trocas.filter(t => t.antigoReg === REGIONAL_DESTAQUE && t.novoReg !== REGIONAL_DESTAQUE).length;

    let resumo;
    if (ganhas && perdidas) resumo = `Sua regional <b>ganha ${ganhas}</b> e <b>perde ${perdidas}</b> liderança(s).`;
    else if (ganhas) resumo = `Sua regional <b>ganha ${ganhas}</b> liderança(s) e não perde nenhuma.`;
    else if (perdidas) resumo = `Sua regional <b>perde ${perdidas}</b> liderança(s) e não ganha nenhuma.`;
    else resumo = 'Nenhuma das trocas envolve lojas da sua regional.';

    return `<div class="pg-texto">
        <b>${trocas.length}</b> ${trocas.length === 1 ? 'grupo troca' : 'grupos trocam'} de líder
        com a projeção da rodada ${st.semana}. ${resumo}
        <ul class="pg-lista pg-lista-trocas">${itens}</ul>
    </div>`;
}

function panoramaHtml() {
    const { tot, g4, z4, trocas } = calcularPanorama();
    const regs = Object.keys(tot).sort();

    const linhas = regs.map(r => {
        const t = tot[r];
        const eu = r === REGIONAL_DESTAQUE;
        return `<tr class="${eu ? 'dest' : ''}">
            <td class="l">${nomeCurto(r)}${eu ? ' ★' : ''}</td>
            <td>${t.base.lider}</td><td class="pts">${t.sim.lider}</td><td>${delta(t.base.lider, t.sim.lider)}</td>
            <td>${t.base.top4}</td><td class="pts">${t.sim.top4}</td><td>${delta(t.base.top4, t.sim.top4)}</td>
            <td>${t.base.ultimos4}</td><td class="pts">${t.sim.ultimos4}</td><td>${delta(t.base.ultimos4, t.sim.ultimos4, true)}</td>
        </tr>`;
    }).join('');

    const linhaJogo = (m) => m.adv
        ? `<small>· ${m.adv} na rodada ${st.semana}, +${m.ganhou} pt(s)</small>`
        : '<small>· sem jogo nesta rodada</small>';

    const selo = { entrou: 'ENTROU', saiu: 'SAIU', ficou: '' };

    // Diferença 0 significa empate em pontos decidido no desempate — dizer
    // "0 pts para sair do Z4" daria a impressão de que já está fora.
    const gapTxt = (g, sufixo) => g === 0
        ? `empatada em pontos ${sufixo}, atrás no desempate`
        : `${g} pt(s) ${sufixo}`;

    const g4Html = g4.length ? g4.map(m => {
        const classe = m.situacao === 'entrou' ? 'ganho' : m.situacao === 'saiu' ? 'perda' : '';
        const ctx = m.situacao === 'saiu'
            ? `<small>· ${gapTxt(m.gapG4, 'do 4º lugar')}</small>`
            : m.para === 1
                ? '<small>· liderando o grupo</small>'
                : `<small>· ${gapTxt(m.gapLider, `do líder ${m.lider}`)}</small>`;
        return `<li class="${classe}">
            ${selo[m.situacao] ? `<span class="selo">${selo[m.situacao]}</span> ` : ''}
            <b>${m.time}</b> · ${m.grupo} — ${m.de}º → <b>${m.para}º</b>
            ${ctx} ${linhaJogo(m)}
        </li>`;
    }).join('') : '<li>Nenhuma loja sua no G4 destes grupos.</li>';

    const z4Html = z4.length ? z4.map(m => {
        const classe = m.situacao === 'saiu' ? 'ganho' : m.situacao === 'entrou' ? 'perda' : '';
        const ctx = m.situacao === 'saiu'
            ? `<small>· ${m.margem === 0 ? 'empatada com o Z4, à frente só no desempate'
                : `${m.margem} pt(s) de folga sobre o Z4`}</small>`
            : `<small>· ${gapTxt(m.gapSalvacao, 'para sair do Z4')}</small>`;
        return `<li class="${classe}">
            ${selo[m.situacao] ? `<span class="selo">${selo[m.situacao]}</span> ` : ''}
            <b>${m.time}</b> · ${m.grupo} — ${m.de}º → <b>${m.para}º</b>
            ${ctx} ${linhaJogo(m)}
        </li>`;
    }).join('') : '<li>Nenhuma loja sua na zona de queda. 🎉</li>';

    const cont = (lista, sit) => lista.filter(x => x.situacao === sit).length;

    return `
    <div class="painel-geral">
        <div class="pg-bloco">
            <h3>🌎 Panorama das 14 lideranças</h3>
            <div class="tab-wrap"><table class="tab-grupo tab-pan">
                <thead><tr>
                    <th class="l">Regional</th>
                    <th colspan="3">Lideranças</th>
                    <th colspan="3">Top 4</th>
                    <th colspan="3" title="Zona de queda — quanto menos lojas, melhor">Últimos 4 ↓</th>
                </tr><tr class="sub">
                    <th class="l"></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                </tr></thead>
                <tbody>${linhas}</tbody>
            </table></div>
            ${textoTrocas(trocas)}
        </div>

        <div class="pg-bloco">
            <h3>🟢 Movimentações no G4 <small>· 4 primeiros de cada grupo</small></h3>
            <div class="pg-resumo">
                ${cont(g4, 'entrou')} entrada(s) · ${cont(g4, 'saiu')} saída(s) · ${cont(g4, 'ficou')} mantida(s)
            </div>
            <ul class="pg-lista">${g4Html}</ul>
        </div>

        <div class="pg-bloco">
            <h3>🔴 Movimentações no Z4 <small>· 4 últimos de cada grupo</small></h3>
            <div class="pg-resumo">
                ${cont(z4, 'entrou')} entrada(s) · ${cont(z4, 'saiu')} saída(s) · ${cont(z4, 'ficou')} mantida(s)
            </div>
            <ul class="pg-lista">${z4Html}</ul>
            <div class="pg-nota">Lojas da ${nomeCurto(REGIONAL_DESTAQUE)}. Posições após a projeção da rodada ${st.semana}.</div>
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
