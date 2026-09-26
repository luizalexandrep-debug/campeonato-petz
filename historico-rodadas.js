// ============================================================
// HISTÓRICO POR RODADA — como cada distrito fechou cada rodada
//
// Não é acumulado: cada rodada tem a pontuação dela, montada a partir do
// resultado oficial de cada loja (/api/historico-lojas) agrupado por distrito.
// As setas andam pelas rodadas encerradas.
// ============================================================

const hrEstado = { dados: null, rodadas: [], atual: null, fundo: null };

const HR_REGIONAL = 'R2 - Luiz';

async function abrirHistoricoRodadas() {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-dist hr-janela">
            <div class="modal-head">
                <div class="md-titulo">
                    <b>📜 Histórico por rodada</b>
                    <small>a pontuação de cada distrito na rodada, sem acumular</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo"><div class="carregando">⏳ Carregando o histórico...</div></div>
        </div>`;
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', teclas); };
    const teclas = (e) => {
        if (e.key === 'Escape') return fechar();
        if (e.key === 'ArrowLeft') hrAndar(-1);
        if (e.key === 'ArrowRight') hrAndar(1);
    };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', teclas);
    document.body.appendChild(fundo);
    hrEstado.fundo = fundo;

    try {
        if (!hrEstado.dados) {
            const r = await fetch('/api/historico-lojas', { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            hrEstado.dados = (await r.json()).lojas || {};
        }
        hrEstado.rodadas = [...new Set(Object.values(hrEstado.dados)
            .flat().map(j => j.rodada))].sort((a, b) => a - b);
        if (!hrEstado.rodadas.length) throw new Error('sem rodadas encerradas');
        hrEstado.atual = hrEstado.rodadas[hrEstado.rodadas.length - 1];
        hrDesenhar();
    } catch (e) {
        const c = fundo.querySelector('.modal-corpo');
        if (c) c.innerHTML = `<div class="carregando">❌ Não foi possível carregar (${e.message}).</div>`;
    }
}

function hrAndar(passo) {
    const i = hrEstado.rodadas.indexOf(hrEstado.atual);
    const novo = hrEstado.rodadas[i + passo];
    if (novo === undefined) return;
    hrEstado.atual = novo;
    hrDesenhar();
}

/* Pontuação dos distritos NAQUELA rodada. */
function hrDistritosDaRodada(rodada) {
    const porLoja = {};
    Object.entries(state.estrutura || {}).forEach(([reg, dists]) =>
        Object.entries(dists).forEach(([dist, lojas]) =>
            (lojas || []).forEach(l => { porLoja[l] = { reg, dist }; })));

    const d = {};
    Object.entries(hrEstado.dados).forEach(([loja, jogos]) => {
        const onde = porLoja[loja];
        const j = jogos.find(x => x.rodada === rodada);
        if (!onde || !j) return;
        const x = (d[onde.dist] ||= { dist: onde.dist, reg: onde.reg, v: 0, e: 0, der: 0, lojas: 0 });
        if (j.res === 'V') x.v++; else if (j.res === 'E') x.e++; else x.der++;
        x.lojas++;
    });
    return Object.values(d).map(x => {
        const pts = x.v * 3 + x.e;
        return { ...x, pts, media: pts / x.lojas, aprov: (pts / (x.lojas * 3)) * 100 };
    }).sort((a, b) => b.media - a.media || b.v - a.v || a.dist.localeCompare(b.dist));
}

function hrDesenhar() {
    const corpo = hrEstado.fundo?.querySelector('.modal-corpo');
    if (!corpo) return;
    const rodada = hrEstado.atual;
    const linhas = hrDistritosDaRodada(rodada);
    const i = hrEstado.rodadas.indexOf(rodada);
    const n2 = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const medalha = (k) => k === 0 ? '🥇' : k === 1 ? '🥈' : k === 2 ? '🥉' : `#${k + 1}`;

    // Totais por regional, como no dashboard.
    const regs = {};
    linhas.forEach(x => {
        const r = (regs[x.reg] ||= { reg: x.reg, v: 0, e: 0, der: 0, pts: 0, lojas: 0 });
        r.v += x.v; r.e += x.e; r.der += x.der; r.pts += x.pts; r.lojas += x.lojas;
    });
    const rodape = Object.values(regs)
        .map(r => ({ ...r, media: r.pts / r.lojas, aprov: (r.pts / (r.lojas * 3)) * 100 }))
        .sort((a, b) => b.media - a.media)
        .map(r => `<tr class="hr-reg">
            <td></td><td><b>${r.reg}</b></td><td></td>
            <td class="c">${r.v}</td><td class="c">${r.e}</td><td class="c">${r.der}</td>
            <td class="n"><b>${n2(r.media)}</b></td><td class="n">${n2(r.aprov)}%</td></tr>`).join('');

    corpo.innerHTML = `
        <div class="hr-nav">
            <button class="hr-seta" ${i === 0 ? 'disabled' : ''} onclick="hrAndar(-1)">←</button>
            <div class="hr-rodada">
                <b>Rodada ${rodada}</b>
                <small>${linhas.length} distritos · ${i + 1} de ${hrEstado.rodadas.length}</small>
            </div>
            <button class="hr-seta" ${i === hrEstado.rodadas.length - 1 ? 'disabled' : ''}
                onclick="hrAndar(1)">→</button>
            <select class="hr-select" onchange="hrEstado.atual = +this.value; hrDesenhar()">
                ${hrEstado.rodadas.slice().reverse().map(r =>
                    `<option value="${r}" ${r === rodada ? 'selected' : ''}>Rodada ${r}</option>`).join('')}
            </select>
        </div>
        <table class="md-tabela hr-tab">
            <thead><tr>
                <th class="c">#</th><th class="l">Distrito</th><th class="l">Regional</th>
                <th class="c">V</th><th class="c">E</th><th class="c">D</th>
                <th class="n">Pontuação Média</th><th class="n">% Aprov.</th>
            </tr></thead>
            <tbody>
                ${linhas.map((x, k) => `
                <tr class="${x.reg === HR_REGIONAL ? 'hr-minha' : ''} hr-clicavel"
                    title="Ver a posição de ${x.dist} rodada a rodada"
                    onclick="hrAbrirDistrito('${x.dist.replace(/'/g, "\\'")}')">
                    <td class="c">${medalha(k)}</td>
                    <td class="l"><b>${x.dist}</b></td>
                    <td class="l reg">${x.reg}</td>
                    <td class="c">${x.v}</td><td class="c">${x.e}</td><td class="c">${x.der}</td>
                    <td class="n"><b>${n2(x.media)}</b></td>
                    <td class="n">${n2(x.aprov)}%</td>
                </tr>`).join('')}
                ${rodape}
            </tbody>
        </table>
        <div class="hr-nota">Resultado oficial de cada loja na rodada, agrupado por distrito —
            sem somar as rodadas anteriores. Use ← e → do teclado para navegar.</div>`;
    corpo.scrollTop = 0;
}


// ------------------------------------------------------------
// Onda da colocação de um distrito, rodada a rodada
// ------------------------------------------------------------

/* [{rodada, pos, total, media, v, e, der}] do distrito em cada rodada. */
function hrSerieDoDistrito(dist) {
    return hrEstado.rodadas.map(rod => {
        const linhas = hrDistritosDaRodada(rod);
        const i = linhas.findIndex(x => x.dist === dist);
        if (i < 0) return null;
        const x = linhas[i];
        return { rodada: rod, pos: i + 1, total: linhas.length, media: x.media,
                 v: x.v, e: x.e, der: x.der };
    }).filter(Boolean);
}

function hrAbrirDistrito(dist) {
    const serie = hrSerieDoDistrito(dist);
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo hr-fundo-grafico';
    const reg = (hrDistritosDaRodada(hrEstado.atual).find(x => x.dist === dist) || {}).reg || '';
    const melhor = serie.reduce((a, b) => (b.pos < a.pos ? b : a), serie[0]);
    const pior = serie.reduce((a, b) => (b.pos > a.pos ? b : a), serie[0]);
    const medias = serie.map(s => s.media);
    const mediaGeral = medias.reduce((a, b) => a + b, 0) / (medias.length || 1);

    fundo.innerHTML = `
        <div class="modal-dist hr-janela">
            <div class="modal-head">
                <div class="md-titulo">
                    <b>📈 ${dist}</b>
                    <small>${reg} · colocação em cada rodada (posição 1 no topo)</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo">
                ${serie.length ? `
                <div class="hr-cards">
                    <div class="hr-card"><span>${melhor.pos}º</span>melhor (rodada ${melhor.rodada})</div>
                    <div class="hr-card"><span>${pior.pos}º</span>pior (rodada ${pior.rodada})</div>
                    <div class="hr-card"><span>${mediaGeral.toLocaleString('pt-BR',
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>pontuação média no período</div>
                </div>
                ${hrGrafico(serie)}
                <div class="hr-nota">Cada ponto é a colocação do distrito naquela rodada, só com a
                    pontuação da própria rodada. Passe o mouse para ver V/E/D e a média.</div>`
                : '<div class="carregando">Sem rodadas para este distrito.</div>'}
            </div>
        </div>`;
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);
}

/* Onda em SVG: eixo Y invertido (1º no alto), um ponto por rodada. */
function hrGrafico(serie) {
    const L = 46, R = 16, T = 18, B = 34;      // margens
    const W = 900, H = 320;
    const totalPos = Math.max(...serie.map(s => s.total), 20);
    const x = (i) => L + (serie.length === 1 ? (W - L - R) / 2
        : i * (W - L - R) / (serie.length - 1));
    const y = (pos) => T + (pos - 1) * (H - T - B) / Math.max(totalPos - 1, 1);

    const linha = serie.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.pos).toFixed(1)}`).join(' ');
    const area = `${linha} L${x(serie.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;

    const guias = [1, 5, 10, 15, totalPos].filter((v, i, a) => a.indexOf(v) === i && v <= totalPos)
        .map(p => `<line class="hr-guia" x1="${L}" y1="${y(p)}" x2="${W - R}" y2="${y(p)}"></line>
                   <text class="hr-eixo" x="${L - 8}" y="${y(p) + 4}" text-anchor="end">${p}º</text>`).join('');

    const pontos = serie.map((s, i) => `
        <g class="hr-ponto">
            <circle cx="${x(i).toFixed(1)}" cy="${y(s.pos).toFixed(1)}" r="5"></circle>
            <text class="hr-rotulo" x="${x(i).toFixed(1)}" y="${(y(s.pos) - 11).toFixed(1)}"
                  text-anchor="middle">${s.pos}º</text>
            <text class="hr-eixo" x="${x(i).toFixed(1)}" y="${H - B + 18}" text-anchor="middle">R${s.rodada}</text>
            <title>Rodada ${s.rodada}: ${s.pos}º de ${s.total} · ${s.v}V ${s.e}E ${s.der}D · média ${
                s.media.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</title>
        </g>`).join('');

    return `<div class="hr-grafico-wrap">
        <svg class="hr-grafico" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
             aria-label="Colocação do distrito por rodada">
            ${guias}
            <path class="hr-area" d="${area}"></path>
            <path class="hr-linha" d="${linha}"></path>
            ${pontos}
        </svg>
    </div>`;
}
