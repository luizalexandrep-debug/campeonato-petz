/* ==========================================================================
   Evolução da rodada — como o placar de cada distrito se moveu dia a dia.

   O endpoint /api/evolucao devolve, por loja, o resultado dela em cada gol ao
   final de cada dia lançado. Aqui a gente agrega isso por distrito, monta a
   curva do acumulado (histórico + rodada) e, ao clicar num distrito, explica
   o que mexeu: em que dia virou, qual gol pesou e quais lojas mudaram de
   resultado no meio do caminho.
   ========================================================================== */

const evo = {
    dados: null,      // resposta crua do /api/evolucao
    serie: null,      // [{distrito, regional, nLojas, pontos:[], acum:[], pos:[], ...}]
    selecionado: null,
    metrica: 'acum',  // 'acum' = posição no acumulado | 'rodada' = pontos da rodada
    semana: null
};

function evoNomeGol(arquivo) {
    return typeof nomeIndicador === 'function'
        ? nomeIndicador(arquivo) : String(arquivo).replace(/\.xlsx$/i, '');
}

function evoPontos(res) {
    return res === 'V' ? 3 : (res === 'E' ? 1 : 0);
}

// Placar da loja no dia i: quantos gols ela venceu e quantos sofreu.
function evoPlacarDia(entrada, i) {
    let gp = 0, gc = 0;
    Object.values(entrada.gols).forEach(s => {
        if (s[i] === 'V') gp++; else if (s[i] === 'D') gc++;
    });
    return [gp, gc];
}

function evoResultadoDia(entrada, i) {
    const [gp, gc] = evoPlacarDia(entrada, i);
    return gp > gc ? 'V' : (gp === gc ? 'E' : 'D');
}

/* ---------- agregação por distrito ---------- */

function evoMontarSerie() {
    const d = evo.dados;
    const nd = d.dias.length;
    const hist = state.historico;
    const rodadasAnt = hist ? hist.rodadasAnteriores : 0;
    const linhas = [];

    Object.keys(state.estrutura).forEach(reg => {
        Object.keys(state.estrutura[reg]).forEach(dist => {
            const lojas = state.estrutura[reg][dist];
            const n = lojas.length;
            const h = hist?.distritos?.[dist];
            const histPts = h ? h.pontuacaoMedia * n : 0;

            const pontos = [], acum = [], ved = [], porGol = {}, media = [];
            for (let i = 0; i < nd; i++) {
                let pts = 0, jogos = 0, V = 0, E = 0, D = 0;
                lojas.forEach(l => {
                    const e = d.lojas[l];
                    if (!e) return;
                    jogos++;
                    const r = evoResultadoDia(e, i);
                    pts += evoPontos(r);
                    if (r === 'V') V++; else if (r === 'E') E++; else D++;
                    Object.entries(e.gols).forEach(([arq, s]) => {
                        const g = porGol[arq] || (porGol[arq] = { pro: [], contra: [] });
                        g.pro[i] = (g.pro[i] || 0) + (s[i] === 'V' ? 1 : 0);
                        g.contra[i] = (g.contra[i] || 0) + (s[i] === 'D' ? 1 : 0);
                    });
                });
                pontos.push(pts);
                ved.push({ V, E, D, jogos });
                media.push(jogos ? pts / jogos : 0);
                // Mesma escala do ranking oficial: pontos acumulados ÷ nº de lojas
                acum.push(n > 0 ? (histPts + pts) / n : 0);
            }
            linhas.push({
                distrito: dist, regional: reg, nLojas: n, lojas,
                temHistorico: !!h, histAcum: h ? h.pontuacaoMedia : 0,
                rodadasAnt, pontos, acum, ved, media, porGol
            });
        });
    });

    // Posição no acumulado em cada dia (só entre distritos com histórico)
    const comHist = linhas.filter(l => l.temHistorico);
    for (let i = 0; i < nd; i++) {
        [...comHist].sort((a, b) => b.acum[i] - a.acum[i])
            .forEach((l, k) => { (l.pos = l.pos || [])[i] = k + 1; });
        [...linhas].sort((a, b) => b.media[i] - a.media[i])
            .forEach((l, k) => { (l.posRod = l.posRod || [])[i] = k + 1; });
    }
    return linhas;
}

/* ---------- gráfico (SVG puro) ---------- */

const EVO_CORES = ['#2b5aa8', '#c0392b', '#0f7b4f', '#b7791f', '#6b3fa0', '#0e7490',
                   '#be185d', '#4d7c0f', '#9a3412', '#1e40af', '#7c2d12', '#065f46'];

function evoDesenharGrafico() {
    const dias = evo.dados.dias;
    const nd = dias.length;
    const posMetrica = evo.metrica === 'acum';
    const linhas = evo.serie.filter(l => posMetrica ? l.temHistorico : true);

    // Quem aparece em destaque: o distrito clicado, ou a regional em foco
    const destaque = (l) => evo.selecionado
        ? l.distrito === evo.selecionado
        : l.regional === REGIONAL_DESTAQUE;

    const W = 980, H = 420, ml = 54, mr = 210, mt = 18, mb = 34;
    const pw = W - ml - mr, ph = H - mt - mb;
    const valor = (l, i) => posMetrica ? l.pos[i] : l.media[i];
    const todos = linhas.flatMap(l => l.acum.map((_, i) => valor(l, i)));
    let vmin = Math.min(...todos), vmax = Math.max(...todos);
    if (posMetrica) { vmin = 1; vmax = Math.max(...todos); }
    else { const m = (vmax - vmin) * .12 || .2; vmin -= m; vmax += m; }
    const x = (i) => ml + (nd === 1 ? pw / 2 : (pw * i) / (nd - 1));
    // Em posição, 1º fica em cima (eixo invertido)
    const y = (v) => mt + (posMetrica
        ? ((v - vmin) / (vmax - vmin || 1)) * ph
        : ph - ((v - vmin) / (vmax - vmin || 1)) * ph);

    // grade + rótulos do eixo Y
    const ticks = [];
    if (posMetrica) {
        for (let p = 1; p <= vmax; p++) if (p === 1 || p % 2 === 0 || p === vmax) ticks.push(p);
    } else {
        for (let k = 0; k <= 4; k++) ticks.push(vmin + (vmax - vmin) * k / 4);
    }
    const grade = ticks.map(t => `
        <line x1="${ml}" y1="${y(t).toFixed(1)}" x2="${ml + pw}" y2="${y(t).toFixed(1)}"
              stroke="#e6eaf0" stroke-width="1"/>
        <text x="${ml - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end"
              font-size="11" fill="#8a94a6">${posMetrica ? t + 'º' : t.toFixed(2).replace('.', ',')}</text>`).join('');

    const eixoX = dias.map((d, i) => `
        <text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="12"
              fill="#5a6474" font-weight="600">${d}</text>
        <line x1="${x(i)}" y1="${mt}" x2="${x(i)}" y2="${mt + ph}"
              stroke="#f0f3f7" stroke-width="1"/>`).join('');

    // ordem de pintura: apagados primeiro, destaques por cima
    const ordenadas = [...linhas].sort((a, b) => (destaque(a) ? 1 : 0) - (destaque(b) ? 1 : 0));
    let ci = 0;
    const cor = {};
    linhas.filter(l => l.regional === REGIONAL_DESTAQUE)
        .forEach(l => { cor[l.distrito] = EVO_CORES[ci++ % EVO_CORES.length]; });
    linhas.forEach(l => { if (!cor[l.distrito]) cor[l.distrito] = EVO_CORES[ci++ % EVO_CORES.length]; });

    const traços = ordenadas.map(l => {
        const on = destaque(l);
        const pts = l.acum.map((_, i) => `${x(i).toFixed(1)},${y(valor(l, i)).toFixed(1)}`).join(' ');
        const bolinhas = l.acum.map((_, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(valor(l, i)).toFixed(1)}"
            r="${on ? 4 : 2.5}" fill="${on ? cor[l.distrito] : '#c9d2de'}"/>`).join('');
        return `<g class="evo-linha${on ? ' on' : ''}" data-dist="${l.distrito}">
            <polyline points="${pts}" fill="none"
                stroke="${on ? cor[l.distrito] : '#d7dee8'}"
                stroke-width="${on ? 2.6 : 1.4}" stroke-linejoin="round" stroke-linecap="round"/>
            ${bolinhas}
            <polyline points="${pts}" fill="none" stroke="transparent" stroke-width="14"/>
        </g>`;
    }).join('');

    // legenda clicável, ordenada pela situação no último dia
    const u = nd - 1;
    const leg = [...linhas]
        .sort((a, b) => posMetrica ? valor(a, u) - valor(b, u) : valor(b, u) - valor(a, u))
        .map(l => {
        const on = destaque(l);
        const sel = evo.selecionado === l.distrito;
        const delta = posMetrica ? l.pos[0] - l.pos[u] : l.media[u] - l.media[0];
        const sinal = delta > 0.001 ? 'sobe' : (delta < -0.001 ? 'desce' : 'igual');
        const txt = posMetrica
            ? `${l.pos[u]}º`
            : l.media[u].toFixed(2).replace('.', ',');
        const mov = posMetrica
            ? (delta > 0 ? `▲${delta}` : (delta < 0 ? `▼${-delta}` : '—'))
            : (delta > 0.004 ? `▲${delta.toFixed(2).replace('.', ',')}`
               : (delta < -0.004 ? `▼${(-delta).toFixed(2).replace('.', ',')}` : '—'));
        return `<button class="evo-leg${sel ? ' sel' : ''}${on ? '' : ' off'}"
                    onclick="evoSelecionar('${l.distrito.replace(/'/g, "\\'")}')">
            <span class="bola" style="background:${on ? cor[l.distrito] : '#c9d2de'}"></span>
            <span class="nome">${l.distrito}</span>
            <span class="val">${txt}</span>
            <span class="mov ${sinal}">${mov}</span>
        </button>`;
    }).join('');

    return `
        <div class="evo-grafico">
            <svg viewBox="0 0 ${W} ${H}" class="evo-svg" preserveAspectRatio="xMidYMid meet">
                ${grade}${eixoX}${traços}
            </svg>
            <div class="evo-legenda">
                <div class="evo-leg-tit">${posMetrica ? 'Posição no fim da rodada' : 'Pontos por jogo'}
                    <small>· clique para analisar</small></div>
                ${leg}
            </div>
        </div>`;
}

/* ---------- resumo do distrito selecionado ---------- */

function evoResumo(dist) {
    const l = evo.serie.find(s => s.distrito === dist);
    if (!l) return '';
    const dias = evo.dados.dias;
    const nd = dias.length;
    const u = nd - 1;
    const f2 = v => v.toFixed(2).replace('.', ',');
    const pl = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

    if (nd < 2) {
        return `<div class="evo-nota">A rodada só tem <b>${dias[0] || 'nenhum dia'}</b> lançado —
                é preciso pelo menos dois dias para comparar a evolução.</div>`;
    }

    /* 1. o melhor momento da semana e a janela de análise

       Uma comparação só entre o primeiro e o último dia esconde o que
       interessa: o distrito que chegou à liderança na quinta e terminou em
       segundo "manteve a posição" nas pontas. Por isso a análise parte do
       PICO — o último dia em que ele esteve no seu melhor — e vai até o
       último dia. Se o pico foi o próprio fim da rodada, aí sim a leitura
       natural é a semana inteira.
    */
    const melhorEm = (arr, menorEhMelhor) => {
        let k = 0;
        for (let i = 1; i < arr.length; i++) {
            if (menorEhMelhor ? arr[i] <= arr[k] : arr[i] >= arr[k]) k = i;
        }
        return k;
    };
    const pico = l.pos ? melhorEm(l.pos, true) : melhorEm(l.pontos, false);
    const ref = pico < u ? pico : 0;      // dia base da comparação
    const janela = `${dias[ref]} → ${dias[u]}`;

    /* 2. linha do tempo dia a dia */
    const linhaTempo = dias.map((d, i) => {
        const v = l.ved[i];
        const dPts = i === 0 ? null : l.pontos[i] - l.pontos[i - 1];
        const dPos = (i === 0 || !l.pos) ? null : l.pos[i - 1] - l.pos[i];
        const clsPos = dPos === null ? '' : (dPos > 0 ? 'sobe' : (dPos < 0 ? 'desce' : 'igual'));
        return `<div class="evo-dia${i === u ? ' hoje' : ''}${i === pico && pico !== u ? ' pico' : ''}">
            <div class="d">${d}${i === u ? ' <small>(último)</small>'
                : (i === pico ? ' <small>🔺 melhor</small>' : '')}</div>
            <div class="ved"><b class="v">${v.V}</b>V <b class="e">${v.E}</b>E <b class="d">${v.D}</b>D</div>
            <div class="pt">${l.pontos[i]} pts${dPts === null ? '' :
                ` <span class="${dPts > 0 ? 'sobe' : (dPts < 0 ? 'desce' : 'igual')}">${
                    dPts > 0 ? '+' + dPts : (dPts < 0 ? dPts : '±0')}</span>`}</div>
            ${l.pos ? `<div class="pos">${l.pos[i]}º no acumulado${dPos === null ? '' :
                ` <span class="${clsPos}">${dPos > 0 ? '▲' + dPos : (dPos < 0 ? '▼' + (-dPos) : '—')}</span>`}</div>`
                : '<div class="pos">—</div>'}
            <div class="ac">${l.temHistorico ? f2(l.acum[i]) + ' pts' : '—'}</div>
        </div>`;
    }).join('');

    /* 3. veredito da semana */
    const varTotal = l.pontos[u] - l.pontos[0];
    const varPos = l.pos ? l.pos[0] - l.pos[u] : 0;
    const varRefPts = l.pontos[u] - l.pontos[ref];
    const varRefPos = l.pos ? l.pos[ref] - l.pos[u] : 0;

    const veredito = varTotal > 0
        ? `Terminou a rodada <b class="sobe">${pl(varTotal, 'ponto', 'pontos')} acima</b> do que marcava em ${dias[0]}.`
        : (varTotal < 0
            ? `Perdeu <b class="desce">${pl(-varTotal, 'ponto', 'pontos')}</b> do que já tinha em ${dias[0]}.`
            : `Fechou com os <b>mesmos ${l.pontos[u]} pontos</b> que marcava em ${dias[0]}.`);
    const vereditoPos = !l.pos ? '' : (varPos > 0
        ? ` Subiu <b class="sobe">${pl(varPos, 'posição', 'posições')}</b> no acumulado (${l.pos[0]}º → ${l.pos[u]}º).`
        : (varPos < 0
            ? ` Caiu <b class="desce">${pl(-varPos, 'posição', 'posições')}</b> no acumulado (${l.pos[0]}º → ${l.pos[u]}º).`
            : ` Começou e terminou em ${l.pos[u]}º no acumulado.`));

    // O momento que explica a virada — só aparece quando houve pico no meio.
    const vereditoPico = (pico >= u || (varRefPts === 0 && varRefPos === 0)) ? '' : `
        <div class="evo-pico">
            🔺 <b>Melhor momento: ${dias[pico]}</b>${l.pos ? ` — chegou ao <b>${l.pos[pico]}º</b>` : ''}
            com <b>${l.pontos[pico]} pontos</b> na rodada${l.temHistorico ? ` (${f2(l.acum[pico])} no acumulado)` : ''}.
            De ${janela} ${varRefPts < 0
                ? `<b class="desce">perdeu ${pl(-varRefPts, 'ponto', 'pontos')}</b>`
                : (varRefPts > 0 ? `<b class="sobe">ganhou ${pl(varRefPts, 'ponto', 'pontos')}</b>` : 'manteve os pontos')}${
                varRefPos < 0 ? ` e <b class="desce">caiu ${pl(-varRefPos, 'posição', 'posições')}</b>, fechando em ${l.pos[u]}º.`
                : (varRefPos > 0 ? ` e <b class="sobe">subiu ${pl(varRefPos, 'posição', 'posições')}</b>.` : '.')}
        </div>`;

    /* 4. balanço por gol — onde a rodada foi ganha ou perdida */
    const gols = Object.entries(l.porGol).map(([arq, g]) => {
        const saldo = (g.pro[u] || 0) - (g.contra[u] || 0);
        const saldoRef = (g.pro[ref] || 0) - (g.contra[ref] || 0);
        return { nome: evoNomeGol(arq), pro: g.pro, contra: g.contra, saldo, delta: saldo - saldoRef };
    }).sort((a, b) => a.delta - b.delta || a.saldo - b.saldo);

    const linhasGol = gols.map(g => `
        <tr>
            <td class="l">${g.nome}</td>
            ${dias.map((_, i) => {
                const p = g.pro[i] || 0, c = g.contra[i] || 0;
                const s = p - c;
                return `<td class="c ${s > 0 ? 'sobe' : (s < 0 ? 'desce' : 'igual')}${
                    i === ref ? ' ref' : ''}${i === u ? ' fim' : ''}"
                            title="${p} loja(s) vencendo, ${c} perdendo">${p}–${c}</td>`;
            }).join('')}
            <td class="c b ${g.delta > 0 ? 'sobe' : (g.delta < 0 ? 'desce' : 'igual')}">${
                g.delta > 0 ? '+' + g.delta : (g.delta < 0 ? g.delta : '±0')}</td>
        </tr>`).join('');

    const culpado = gols[0];
    const heroi = gols[gols.length - 1];

    /* 5. lojas que viraram no meio do caminho */
    const viradas = l.lojas.map(loja => {
        const e = evo.dados.lojas[loja];
        if (!e) return null;
        const r0 = evoResultadoDia(e, ref), ru = evoResultadoDia(e, u);
        if (r0 === ru) return null;
        const [a, b] = evoPlacarDia(e, ref);
        const [c, d] = evoPlacarDia(e, u);
        return {
            loja, adv: e.adv, de: r0, para: ru, p0: `${a}x${b}`, pu: `${c}x${d}`,
            dPts: evoPontos(ru) - evoPontos(r0),
            // dia em que virou pela última vez
            virouEm: (() => {
                for (let i = u; i > ref; i--) if (evoResultadoDia(e, i - 1) !== ru) return dias[i];
                return dias[u];
            })()
        };
    }).filter(Boolean).sort((a, b) => a.dPts - b.dPts);

    const rot = { V: 'vitória', E: 'empate', D: 'derrota' };
    const perdeu = viradas.filter(v => v.dPts < 0);
    const ganhou = viradas.filter(v => v.dPts > 0);
    const caixaViradas = (lista, titulo, cls) => !lista.length ? '' : `
        <div class="evo-virada ${cls}">
            <b>${titulo}</b>
            <ul>${lista.map(v => `<li>
                <span class="lj" onclick="abrirDetalhesJogo('${v.loja}','${v.adv}')">${v.loja}</span>
                <small>vs ${v.adv}</small> —
                ${rot[v.de]} ${v.p0} em ${dias[ref]} → <b>${rot[v.para]} ${v.pu}</b>
                (virou na ${v.virouEm}) <span class="${v.dPts > 0 ? 'sobe' : 'desce'}">${
                    v.dPts > 0 ? '+' + v.dPts : v.dPts} ${Math.abs(v.dPts) === 1 ? 'pt' : 'pts'}</span>
            </li>`).join('')}</ul>
        </div>`;

    const estaveis = l.lojas.length - viradas.length;

    return `
    <div class="evo-resumo">
        <div class="evo-res-head">
            <b>${dist}</b><small>${l.regional} · ${l.nLojas} lojas · rodada ${evo.semana}</small>
        </div>

        <div class="evo-veredito">${veredito}${vereditoPos}</div>
        ${vereditoPico}

        <div class="evo-timeline">${linhaTempo}</div>

        <div class="evo-dupla">
            <div class="evo-box">
                <h5>⚽ Balanço por gol <small>lojas vencendo–perdendo em cada dia · Δ de ${janela}</small></h5>
                <div class="evo-tab-wrap"><table class="evo-tab">
                    <thead><tr><th class="l">Gol</th>${dias.map((d, i) => `<th class="c${
                        i === ref ? ' ref' : ''}${i === u ? ' fim' : ''}">${d}</th>`).join('')}
                        <th class="c">Δ ${janela}</th></tr></thead>
                    <tbody>${linhasGol}</tbody>
                </table></div>
                <div class="evo-nota">
                    ${culpado && culpado.delta < 0
                        ? `O gol que mais custou foi <b>${culpado.nome}</b> (${culpado.delta} no saldo de lojas de ${janela}).`
                        : `Nenhum gol piorou de ${janela}.`}
                    ${heroi && heroi.delta > 0
                        ? ` O que mais rendeu foi <b>${heroi.nome}</b> (+${heroi.delta}).` : ''}
                </div>
            </div>
            <div class="evo-box">
                <h5>🔄 Lojas que mudaram de resultado <small>${janela}</small></h5>
                ${viradas.length
                    ? caixaViradas(perdeu, `↓ Perderam terreno (${perdeu.length})`, 'ruim') +
                      caixaViradas(ganhou, `↑ Ganharam terreno (${ganhou.length})`, 'bom')
                    : '<div class="evo-nota">Nenhuma loja mudou de resultado durante a semana.</div>'}
                <div class="evo-nota">${pl(estaveis, 'loja manteve', 'lojas mantiveram')} o mesmo resultado de ${janela}.
                    Clique na sigla para abrir os gols do jogo.</div>
            </div>
        </div>
    </div>`;
}

/* ---------- interação ---------- */

function evoSelecionar(dist) {
    evo.selecionado = evo.selecionado === dist ? null : dist;
    evoRenderCorpo();
}

function evoTrocarMetrica(m) {
    evo.metrica = m;
    evoRenderCorpo();
}

function evoRenderCorpo() {
    const corpo = document.querySelector('.modal-evo .modal-corpo');
    if (!corpo) return;
    const dias = evo.dados.dias;
    const aviso = evo.dados.aproximaPct ? `
        <div class="evo-nota atencao">
            Os gols de percentual (share) não guardam o total de cada dia na planilha — nos dias
            intermediários a curva usa a média dos dias lançados. O último ponto usa o total
            oficial, então bate exatamente com as tabelas do site.
        </div>` : '';
    corpo.innerHTML = `
        <div class="evo-barra">
            <div class="evo-metricas">
                <button class="evo-mb${evo.metrica === 'acum' ? ' on' : ''}"
                    onclick="evoTrocarMetrica('acum')">🏁 Posição no acumulado</button>
                <button class="evo-mb${evo.metrica === 'rodada' ? ' on' : ''}"
                    onclick="evoTrocarMetrica('rodada')">📈 Pontos por jogo da rodada</button>
            </div>
            <div class="evo-dias">${dias.length} dia(s) lançado(s): <b>${dias.join(' · ')}</b></div>
        </div>
        ${evoDesenharGrafico()}
        ${aviso}
        ${evo.selecionado ? evoResumo(evo.selecionado) : `
            <div class="evo-vazio">Clique em um distrito na legenda (ou na linha do gráfico)
                para ver o resumo da semana e o que provocou as oscilações.</div>`}`;

    corpo.querySelectorAll('.evo-linha').forEach(g => {
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => evoSelecionar(g.dataset.dist));
    });
}

async function abrirEvolucaoRodada() {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-evo">
            <div class="modal-head">
                <div class="md-titulo">
                    <b>📈 Evolução da rodada ${state.semana}</b>
                    <small>como o placar de cada distrito se moveu dia a dia</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo"><div class="carregando">⏳ Reconstruindo os placares dia a dia...</div></div>
        </div>`;
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);

    try {
        const r = await fetch(`/api/evolucao/${state.semana}`, { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        if (!d.dias.length) {
            fundo.querySelector('.modal-corpo').innerHTML =
                `<div class="evo-nota atencao">A rodada ${state.semana} ainda não tem nenhum dia lançado
                 na semana atual — não há evolução para mostrar.</div>`;
            return;
        }
        evo.dados = d;
        evo.semana = d.semana;
        evo.selecionado = null;
        evo.serie = evoMontarSerie();
        evoRenderCorpo();
    } catch (e) {
        fundo.querySelector('.modal-corpo').innerHTML =
            `<div class="evo-nota atencao">Não foi possível carregar a evolução: ${e.message}</div>`;
    }
}
