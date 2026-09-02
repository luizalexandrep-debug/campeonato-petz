// ============================================================
// SIMULAR PLACARES
//
// A tela onde dá para mexer no placar de qualquer jogo da rodada e ver, na
// hora, o que muda: a classificação dos distritais, o total das regionais e a
// tabela de cada grupo. Nada é gravado — é tudo em cima dos dados já
// carregados, e o botão "voltar ao projetado" desfaz tudo.
//
// Base: /api/classificacao (acumulado oficial até a rodada anterior) e
// /api/games-summary (o placar que o app projeta para a rodada em curso).
// ============================================================

const GOLS = 6;                       // todo jogo distribui 6 gols
const MINHA = 'R2 - Luiz';            // regional em destaque, como no dashboard
const VISIVEIS = 6;                   // distritos à mostra com a tabela recolhida
const LOJAS_VISIVEIS = 14;            // lojas à mostra na tabela do grupo

const pegar = (p) => fetch(`/api${p}`, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
});

// Preenchidos por carregar(); o resto do arquivo lê daqui.
let REGIONAL = {};        // distrito -> regional
let DISTRITOS = {};       // loja -> distrito
let GRUPOS = {};          // grupo -> { tabela, jogos }
let BASE_DIST = {};       // distrito -> pontuação média acumulada
let NOMES_GRUPOS = [];
let SEMANA = null, RODADA_BASE = null;

// Os grupos entram na ordem do número, não na ordem em que vieram da base.
const numDoGrupo = (n) => parseInt((String(n).match(/(\d+)\s*$/) || [0, 0])[1], 10);

async function carregar() {
    const sem = await pegar('/semana');
    SEMANA = sem.semana;
    const seletor = document.getElementById('fRodada');
    seletor.innerHTML = (sem.disponiveis || [SEMANA]).slice().reverse()
        .map(n => `<option value="${n}" ${n === SEMANA ? 'selected' : ''}>Rodada ${n}${
            n === sem.semana ? ' (atual)' : ''}</option>`).join('');
    seletor.onchange = () => trocarRodada(parseInt(seletor.value, 10));

    await montar();
}

async function trocarRodada(n) {
    SEMANA = n;
    Object.keys(editados).forEach(k => delete editados[k]);
    document.getElementById('grupos').innerHTML =
        '<div class="info-bar"><span>Carregando os jogos...</span></div>';
    await montar();
}

async function montar() {
    // A base é o acumulado ATÉ a rodada anterior: é sobre ele que a rodada
    // em tela é somada. Sem base não dá para montar a tela.
    const [cls, est, resumo] = await Promise.all([
        pegar(`/classificacao?rodada=${SEMANA - 1}`).catch(() => pegar('/classificacao')),
        pegar('/estrutura'),
        pegar(`/games-summary/${SEMANA}`)
    ]);

    RODADA_BASE = cls.rodada;
    const estrutura = est.estrutura || est;
    REGIONAL = {}; DISTRITOS = {};
    Object.entries(estrutura).forEach(([reg, dists]) =>
        Object.entries(dists).forEach(([dist, lojas]) => {
            REGIONAL[dist] = reg;
            (lojas || []).forEach(l => { DISTRITOS[l] = dist; });
        }));

    GRUPOS = {};
    Object.entries(cls.grupos || {}).forEach(([nome, linhas]) => {
        GRUPOS[nome] = {
            tabela: linhas.map(l => ({
                time: l.time, pts: l.pts, vit: l.vit, emp: l.emp, der: l.der,
                gm: l.gm, gs: l.gs, j: l.jogos
            })),
            jogos: []
        };
    });

    // Cada jogo vai para o grupo das suas lojas. O cenário de eliminação, se
    // estiver ligado em outra tela, não vale aqui — esta tela simula placares.
    const grupoDe = {};
    Object.entries(GRUPOS).forEach(([nome, g]) =>
        g.tabela.forEach(r => grupoDe[r.time] = nome));
    (resumo.games || []).forEach(j => {
        const nome = grupoDe[j.team1];
        if (!nome) return;
        const [a] = String(j.scoreProjected || '0 x 0').split('x').map(v => parseInt(v.trim()) || 0);
        GRUPOS[nome].jogos.push({ casa: j.team1, fora: j.team2, gm: a });
    });

    // Base acumulada de cada distrito: a pontuação média das lojas dele.
    const acc = {};
    Object.values(GRUPOS).forEach(g => g.tabela.forEach(r => {
        const dist = DISTRITOS[r.time]; if (!dist) return;
        acc[dist] = acc[dist] || { soma: 0, n: 0 };
        acc[dist].soma += r.pts; acc[dist].n++;
    }));
    BASE_DIST = {};
    Object.entries(acc).forEach(([dist, x]) => BASE_DIST[dist] = x.soma / x.n);

    NOMES_GRUPOS = Object.keys(GRUPOS).sort((a, b) => numDoGrupo(a) - numDoGrupo(b));

    document.getElementById('subtitulo').textContent =
        `Rodada ${SEMANA} sobre o acumulado até a rodada ${RODADA_BASE} · `
        + `mexa nos placares e veja o efeito nos distritais, nas regionais e nos grupos`;

    desenhar();
}

const editados = {};       // "CASA×FORA" -> gols da casa
let filtro = null;
let distritoAberto = null;
const abertos = { somado: false, editada: false };
const gruposAbertos = new Set();   // grupos com a tabela inteira à mostra

const chave = (j) => `${j.casa}×${j.fora}`;
const golsCasa = (j) => chave(j) in editados ? editados[chave(j)] : j.gm;
const foiEditado = (j) => chave(j) in editados && editados[chave(j)] !== j.gm;
const grupoDaLoja = (loja) => Object.keys(GRUPOS)
    .find(n => GRUPOS[n].tabela.some(r => r.time === loja));

// Desempate oficial: pontuação, número de vitórias, saldo de gols.
const ordenar = (linhas) => linhas.slice().sort((a, b) =>
    b.pts - a.pts || b.vit - a.vit || b.sg - a.sg || a.time.localeCompare(b.time));

/* Resultado de cada loja na rodada. `simulado` usa os placares editados. */
function daRodada(simulado) {
    const r = {};
    Object.entries(GRUPOS).forEach(([nome, g]) => g.jogos.forEach(j => {
        const gm = simulado ? golsCasa(j) : j.gm, gs = GOLS - gm;
        r[j.casa] = { gm, gs, adv: j.fora, grupo: nome };
        r[j.fora] = { gm: gs, gs: gm, adv: j.casa, grupo: nome };
    }));
    return r;
}

function classificar(nome, simulado) {
    const rod = daRodada(simulado);
    return ordenar(GRUPOS[nome].tabela.map(r => {
        const p = rod[r.time];
        const gm = r.gm + p.gm, gs = r.gs + p.gs;
        return {
            ...r, gm, gs, sg: gm - gs, j: r.j + 1,
            pts: r.pts + (p.gm > p.gs ? 3 : p.gm === p.gs ? 1 : 0),
            vit: r.vit + (p.gm > p.gs ? 1 : 0),
            emp: r.emp + (p.gm === p.gs ? 1 : 0),
            der: r.der + (p.gm < p.gs ? 1 : 0),
            placar: `${p.gm} x ${p.gs}`, adv: p.adv
        };
    }));
}

/* Os distritos na rodada: V/E/D dos gols e a pontuação média das lojas. */
function distritosNaRodada(simulado) {
    const rod = daRodada(simulado);
    const d = {};
    Object.entries(rod).forEach(([loja, p]) => {
        const dist = DISTRITOS[loja]; if (!dist) return;
        d[dist] = d[dist] || { dist, reg: REGIONAL[dist], vit: 0, emp: 0, der: 0, pts: 0, lojas: 0 };
        // V/E/D das lojas do distrito na rodada (no app real, reaproveita a
        // mesma função do dashboard, para os números baterem casa com casa).
        d[dist].vit += p.gm > p.gs ? 1 : 0;
        d[dist].emp += p.gm === p.gs ? 1 : 0;
        d[dist].der += p.gm < p.gs ? 1 : 0;
        d[dist].pts += p.gm > p.gs ? 3 : p.gm === p.gs ? 1 : 0;
        d[dist].lojas++;
    });
    return Object.values(d).map(x => ({
        ...x, media: x.pts / x.lojas, aprov: (x.pts / (x.lojas * 3)) * 100
    })).sort((a, b) => b.media - a.media || b.vit - a.vit || a.dist.localeCompare(b.dist));
}

function acumuladoMaisSimulado(simulado) {
    const rod = {}; distritosNaRodada(simulado).forEach(x => rod[x.dist] = x);
    return Object.keys(BASE_DIST).map(dist => {
        const r = rod[dist] || { media: 0 };
        const total = BASE_DIST[dist] + r.media;
        return {
            dist, reg: REGIONAL[dist], base: BASE_DIST[dist], rodada: r.media,
            total, aprov: (total / 30) * 100
        };
    }).sort((a, b) => b.total - a.total || a.dist.localeCompare(b.dist));
}

const medalha = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
const seta = (delta) => delta > 0 ? `<span class="sobe">▲${delta}</span>`
    : delta < 0 ? `<span class="desce">▼${-delta}</span>` : '<span class="igual">—</span>';
const num = (v, casas = 2) => v.toFixed(casas).replace('.', ',');
const btDist = (d) => `<button class="dist-bt" data-distrito="${d}"
    title="Ver e editar os jogos de ${d}">${d}</button>`;

function totaisRegionais(linhas, valor) {
    const r = {};
    linhas.forEach(l => {
        r[l.reg] = r[l.reg] || { reg: l.reg, soma: 0, n: 0 };
        r[l.reg].soma += valor(l); r[l.reg].n++;
    });
    return Object.values(r).map(x => ({ ...x, media: x.soma / x.n }))
        .sort((a, b) => b.media - a.media);
}

function desenharTopo() {
    const proj = acumuladoMaisSimulado(false), edi = acumuladoMaisSimulado(true);
    const posProj = {}; proj.forEach((r, i) => posProj[r.dist] = i + 1);

    const linha = (r, i, qual, delta) => `
        <tr class="${r.reg === MINHA ? 'minha' : ''} ${delta ? 'mudou' : ''}
                   ${!abertos[qual] && i >= VISIVEIS ? 'oculta' : ''}">
            <td class="pos">${medalha(i)}</td>
            ${delta === undefined ? '' : `<td class="c">${seta(delta)}</td>`}
            <td>${btDist(r.dist)}</td>
            <td class="reg">${r.reg}</td>
            <td class="n">${num(r.base)}</td>
            <td class="n">${num(r.rodada)}</td>
            <td class="n val">${num(r.total)}</td>
            <td class="n val">${num(r.aprov, 1)}%</td>
        </tr>`;

    const rodape = (linhas, colsAntes) => totaisRegionais(linhas, x => x.total).map(t => `
        <tr class="reg-tot">${'<td></td>'.repeat(colsAntes)}
            <td>Regional ${t.reg.split(' - ')[1]}</td><td></td>
            <td class="n"></td><td class="n"></td>
            <td class="n">${num(t.media)}</td><td class="n"></td></tr>`).join('');

    document.getElementById('tSomado').innerHTML =
        proj.map((r, i) => linha(r, i, 'somado')).join('') + rodape(proj, 1);

    document.getElementById('tEditada').innerHTML =
        edi.map((r, i) => linha(r, i, 'editada', posProj[r.dist] - (i + 1))).join('') + rodape(edi, 2);

    rotularExpandir('somado', proj.length);
    rotularExpandir('editada', edi.length);
}

// Botão de recolher/expandir: some quando a tabela já cabe inteira.
function rotularExpandir(qual, total) {
    const bt = document.querySelector(`[data-expandir="${qual}"]`);
    if (!bt) return;
    if (total <= VISIVEIS) { bt.hidden = true; return; }
    bt.hidden = false;
    bt.setAttribute('aria-expanded', abertos[qual] ? 'true' : 'false');
    bt.innerHTML = abertos[qual]
        ? `<span class="seta">▲</span>Mostrar só os ${VISIVEIS} primeiros`
        : `<span class="seta">▼</span>Ver os outros ${total - VISIVEIS} distritos`;
}

/* `inverter` troca os lados na tela — usado para a loja mais bem classificada
   aparecer sempre à esquerda. O placar continua ligado ao mesmo jogo. */
function linhaJogo(nome, i, inverter) {
    const j = GRUPOS[nome].jogos[i];
    const gm = golsCasa(j), gs = GOLS - gm, ed = foiEditado(j);
    const esq = inverter ? j.fora : j.casa, dir = inverter ? j.casa : j.fora;
    const golEsq = inverter ? gs : gm, golDir = inverter ? gm : gs;
    const ladoEsq = inverter ? 'fora' : 'casa', ladoDir = inverter ? 'casa' : 'fora';
    return `<div class="jogo">
        <span class="casa"><span class="sig">${esq}</span>
            <span class="sub">${DISTRITOS[esq] || ''}</span></span>
        <span class="placar ${ed ? 'editado' : ''}">
            <input class="gol" type="number" min="0" max="${GOLS}" value="${golEsq}"
                   aria-label="Gols de ${esq}" data-grupo="${nome}" data-jogo="${i}" data-lado="${ladoEsq}">
            <span class="x">×</span>
            <input class="gol" type="number" min="0" max="${GOLS}" value="${golDir}"
                   aria-label="Gols de ${dir}" data-grupo="${nome}" data-jogo="${i}" data-lado="${ladoDir}">
            ${ed ? `<button class="voltar" data-desfazer="${nome}|${i}" title="Voltar ao projetado">↺</button>` : ''}
        </span>
        <span class="fora"><span class="sig">${dir}</span>
            <span class="sub">${DISTRITOS[dir] || ''}</span></span>
    </div>`;
}

/* Jogos do grupo na ordem da classificação: o líder primeiro, com ele à
   esquerda; depois o 2º que ainda não apareceu, e assim por diante. */
function jogosPorClassificacao(nome, classificacao) {
    const jogos = GRUPOS[nome].jogos;
    const usados = new Set();
    const saida = [];
    classificacao.forEach(r => {
        const i = jogos.findIndex((j, k) => !usados.has(k) && (j.casa === r.time || j.fora === r.time));
        if (i < 0) return;
        usados.add(i);
        saida.push({ i, inverter: jogos[i].fora === r.time });
    });
    jogos.forEach((_, i) => { if (!usados.has(i)) saida.push({ i, inverter: false }); });
    return saida;
}

function blocoGrupo(nome) {
    const g = GRUPOS[nome];
    const base = classificar(nome, false), sim = classificar(nome, true);
    const posBase = {}; base.forEach((r, i) => posBase[r.time] = i + 1);

    // Colunas na ordem do desempate: Pts, V, SG.
    const aberto = gruposAbertos.has(nome);
    const tab = (linhas, simulada) => `<table>
        <thead><tr><th class="pos">#</th><th>${simulada ? 'Como ficaria' : 'Como está'}</th>
            <th class="c">Pts</th><th class="c">V</th><th class="c">SG</th></tr></thead>
        <tbody>${linhas.map((r, i) => {
            const delta = simulada ? posBase[r.time] - (i + 1) : 0;
            return `<tr class="${delta ? 'mudou' : ''} ${!aberto && i >= LOJAS_VISIVEIS ? 'oculta' : ''}">
                <td class="pos">${i + 1} ${simulada && delta ? seta(delta) : ''}</td>
                <td><b>${r.time}</b></td>
                <td class="c val">${r.pts}</td><td class="c">${r.vit}</td>
                <td class="c">${r.sg > 0 ? '+' : ''}${r.sg}</td></tr>`;
        }).join('')}</tbody></table>`;

    return `<div class="grupo">
        <div class="card">
            <div class="card-tit"><b>${nome}</b> <small>${g.jogos.length} jogos na rodada</small></div>
            <div class="jogos">${jogosPorClassificacao(nome, base)
                .map(x => linhaJogo(nome, x.i, x.inverter)).join('')}</div>
            <div class="nota">Clique num número para editar. O outro lado se ajusta sozinho — todo jogo distribui ${GOLS} gols.</div>
        </div>
        <div class="card">
            <div class="card-tit"><b>Tabela do grupo</b> <small>projetada × editada</small></div>
            <div style="display:grid; grid-template-columns:1fr 1fr;">
                <div style="border-right:1px solid var(--border)">${tab(base, false)}</div>
                <div>${tab(sim, true)}</div>
            </div>
            ${base.length > LOJAS_VISIVEIS ? `<button class="expandir" data-grupo-expandir="${nome}"
                aria-expanded="${aberto}"><span class="seta">${aberto ? '▲' : '▼'}</span>${aberto
                    ? `Mostrar só as ${LOJAS_VISIVEIS} primeiras`
                    : `Ver as outras ${base.length - LOJAS_VISIVEIS} lojas`}</button>` : ''}
        </div>
    </div>`;
}

/* ---------- painel de um distrito ----------
   Mesmo desenho da janela "jogos do distrito" do dashboard: os quatro cartões
   de resumo, o aviso dos jogos contra a minha regional, a nota da ótica das
   cores e a tabela com os confrontos. A diferença é que aqui o placar é
   editável, e por isso a tela toda se recalcula a cada tecla.               */

const ROTULO = { v: 'VENCENDO', e: 'EMPATANDO', d: 'PERDENDO' };

function desenharPainel() {
    const alvo = document.getElementById('painel');
    // Cada tecla redesenha o painel inteiro; guardar a rolagem evita que ele
    // salte para o topo no meio de uma edição.
    const rolagem = alvo.querySelector('.fundo')?.scrollTop || 0;
    if (!distritoAberto) {
        alvo.innerHTML = '';
        document.body.style.overflow = '';
        return;
    }
    document.body.style.overflow = 'hidden';

    const dist = distritoAberto;
    const souEu = REGIONAL[dist] === MINHA;
    const lojas = Object.keys(DISTRITOS).filter(l => DISTRITOS[l] === dist);

    // Todos os jogos do distrito, em qualquer grupo, já do ponto de vista dele.
    const linhas = [];
    Object.entries(GRUPOS).forEach(([nome, g]) => g.jogos.forEach((j, i) => {
        const casaEhDele = lojas.includes(j.casa);
        if (!casaEhDele && !lojas.includes(j.fora)) return;
        const minha = casaEhDele ? j.casa : j.fora;
        const adv = casaEhDele ? j.fora : j.casa;
        const gmCasa = golsCasa(j);
        const gm = casaEhDele ? gmCasa : GOLS - gmCasa;
        const gs = GOLS - gm;
        linhas.push({
            nome, i, minha, adv, gm, gs, inverter: !casaEhDele,
            advRegional: REGIONAL[DISTRITOS[adv]] || '—',
            advDistrito: DISTRITOS[adv] || '',
            contraMim: REGIONAL[DISTRITOS[adv]] === MINHA,
            pts: gm > gs ? 3 : gm === gs ? 1 : 0,
            resultado: gm > gs ? 'v' : gm < gs ? 'd' : 'e',
            editado: foiEditado(g.jogos[i]),
            // onde a loja fica no grupo, antes e depois das edições
            posAntes: classificar(nome, false).findIndex(r => r.time === minha) + 1,
            posDepois: classificar(nome, true).findIndex(r => r.time === minha) + 1
        });
    }));

    // Primeiro os jogos contra a minha regional e, dentro deles, os que ainda
    // dá para virar — é a mesma ordem da janela do dashboard.
    const ordem = { d: 0, e: 1, v: 2 };
    linhas.sort((x, y) => (y.contraMim - x.contraMim)
        || (ordem[y.resultado] - ordem[x.resultado])
        || x.minha.localeCompare(y.minha));

    const contra = linhas.filter(l => l.contraMim);
    const ptsDele = linhas.reduce((t, l) => t + l.pts, 0);
    const emRisco = contra.reduce((t, l) => t + l.pts, 0);
    const conta = (r) => linhas.filter(l => l.resultado === r).length;

    // A cor mostra o SEU interesse: se o distrito é adversário, a vitória dele
    // sai em vermelho e a derrota em verde.
    const corDe = (res) => (souEu || res === 'e') ? res : (res === 'v' ? 'd' : 'v');

    // posição do distrito, antes e depois das edições
    const proj = acumuladoMaisSimulado(false), edi = acumuladoMaisSimulado(true);
    const pProj = proj.findIndex(x => x.dist === dist) + 1;
    const pEdi = edi.findIndex(x => x.dist === dist) + 1;
    const rProj = proj.find(x => x.dist === dist), rEdi = edi.find(x => x.dist === dist);

    const corpo = linhas.map(l => `
        <tr class="${l.contraMim ? 'contra-minha' : ''} linha-jogo">
            <td><b>${l.minha}</b></td>
            <td class="c placar-cel">
                <span class="placar ${l.editado ? 'editado' : ''}">
                    <input class="gol" type="number" min="0" max="${GOLS}" value="${l.gm}"
                           aria-label="Gols de ${l.minha}" data-grupo="${l.nome}" data-jogo="${l.i}"
                           data-lado="${l.inverter ? 'fora' : 'casa'}">
                    <span class="x">×</span>
                    <input class="gol" type="number" min="0" max="${GOLS}" value="${l.gs}"
                           aria-label="Gols de ${l.adv}" data-grupo="${l.nome}" data-jogo="${l.i}"
                           data-lado="${l.inverter ? 'casa' : 'fora'}">
                    ${l.editado ? `<button class="voltar" data-desfazer="${l.nome}|${l.i}"
                        title="Voltar ao placar projetado">↺</button>` : ''}
                </span>
            </td>
            <td><b>${l.adv}</b>
                ${l.contraMim ? '<span class="tag-minha">sua regional</span>' : ''}
                <span class="reg"><br>${l.advRegional}${l.advDistrito ? ` · ${l.advDistrito}` : ''}</span></td>
            <td class="c"><span class="res ${corDe(l.resultado)}">${ROTULO[l.resultado]}</span></td>
            <td class="c pequeno">${l.nome.replace(/^S.rie \w+ . /, '')}:
                ${l.posAntes === l.posDepois ? `${l.posDepois}º`
                    : `${l.posAntes}º → <b>${l.posDepois}º</b> ${seta(l.posAntes - l.posDepois)}`}</td>
            <td class="c val">+${l.pts}</td>
            <td class="c lupa" data-gols="${l.minha}|${l.adv}" title="Ver os gols deste jogo">🔍</td>
        </tr>`).join('');

    alvo.innerHTML = `<div class="fundo" data-fechar>
        <div class="painel" role="dialog" aria-label="Jogos de ${dist}">
            <div class="painel-head">
                <div><b>${dist}</b><br><small>${REGIONAL[dist]} · ${lojas.length} lojas · rodada ${SEMANA}</small></div>
                <button class="bt" data-fechar>✕ Fechar</button>
            </div>
            <div class="painel-corpo">
                <div class="md-resumo">
                    <div class="md-card ${souEu ? 'bom' : 'ruim'}"><span>${conta('v')}</span>vencendo</div>
                    <div class="md-card"><span>${conta('e')}</span>empatando</div>
                    <div class="md-card ${souEu ? 'ruim' : 'bom'}"><span>${conta('d')}</span>perdendo</div>
                    <div class="md-card total"><span>${ptsDele}</span>pontos na rodada</div>
                </div>

                ${contra.length ? `
                <div class="md-alvo">
                    <b>⚔ ${contra.length} jogo(s) contra a ${MINHA}</b>
                    — hoje eles somam <b>${emRisco} ponto(s)</b> para o ${dist}.
                    ${emRisco > 0
                        ? `Virar esses jogos tira até <b>${emRisco} ponto(s)</b> dele.`
                        : 'Sua regional já está segurando todos eles.'}
                </div>` : `<div class="md-alvo neutro">
                    Nenhum jogo contra a ${MINHA} nesta rodada — só dá para ganhar terreno
                    pontuando mais nos jogos das suas lojas.</div>`}

                <div class="md-legenda">
                    ${souEu ? 'Cores na ótica das suas lojas: verde é bom para você.'
                        : `Cores na <b>sua ótica</b>: como o ${dist} é adversário,
                           o que é <span class="res d">bom para ele</span> aparece em vermelho e
                           o que é <span class="res v">ruim para ele</span> aparece em verde.`}
                    Edite qualquer placar para ver o efeito; clique na lupa para ver os gols.
                </div>

                <div>
                    <div class="mini-tit">Onde o distrito fica <small>· projetado → editado</small></div>
                    <div class="resumo-dist">
                        <div><span class="rotulo">Acumulado + editado</span>
                            <b>${num(rEdi.total)}</b>
                            <span class="delta">${pProj}º → ${pEdi}º ${seta(pProj - pEdi)}</span></div>
                        <div><span class="rotulo">Só a rodada</span>
                            <b>${num(rEdi.rodada)}</b>
                            <span class="delta">projetado ${num(rProj.rodada)}</span></div>
                        <div><span class="rotulo">% aprov.</span>
                            <b>${num(rEdi.aprov, 1)}%</b>
                            <span class="delta">projetado ${num(rProj.aprov, 1)}%</span></div>
                    </div>
                </div>

                <div class="card"><table class="md-tabela">
                    <thead><tr>
                        <th>Loja do ${dist}</th><th class="c">Placar</th>
                        <th>Adversário</th><th class="c">Situação</th>
                        <th class="c">No grupo</th><th class="c">Pts</th><th></th>
                    </tr></thead>
                    <tbody>${corpo}</tbody>
                </table></div>
            </div>
        </div>
    </div>`;
    if (rolagem) alvo.querySelector('.fundo').scrollTop = rolagem;
}

/* A lupa abre o detalhe dos gols na janela que já existe no dashboard. Em vez
   de duplicar aquela tela aqui, mandamos o confronto por parâmetro. */
function verGols(casa, fora) {
    window.open(`/?jogo=${encodeURIComponent(casa)},${encodeURIComponent(fora)}`, '_blank');
}

function desenhar() {
    document.getElementById('chips').innerHTML =
        `<span class="rotulo" style="margin-right:4px">Grupo</span>` +
        `<button class="chip" aria-pressed="${!filtro}" data-grupo="">Todos</button>` +
        NOMES_GRUPOS.map(n =>
            `<button class="chip" aria-pressed="${filtro === n}" data-grupo="${n}">${n}</button>`).join('');
    document.getElementById('grupos').innerHTML = NOMES_GRUPOS
        .filter(n => !filtro || n === filtro).map(blocoGrupo).join('');
    desenharTopo();
    desenharPainel();
}

document.addEventListener('input', (e) => {
    const el = e.target.closest('.gol');
    if (!el) return;
    const j = GRUPOS[el.dataset.grupo].jogos[+el.dataset.jogo];
    let v = parseInt(el.value, 10);
    if (isNaN(v)) return;
    v = Math.max(0, Math.min(GOLS, v));
    editados[chave(j)] = el.dataset.lado === 'casa' ? v : GOLS - v;

    const f = document.activeElement;
    const marca = f && f.dataset && f.dataset.grupo
        ? [f.dataset.grupo, f.dataset.jogo, f.dataset.lado, f.closest('.painel') ? '1' : '0'] : null;
    desenhar();
    if (marca) {
        const escopo = marca[3] === '1' ? '.painel ' : '';
        const volta = document.querySelector(
            `${escopo}.gol[data-grupo="${marca[0]}"][data-jogo="${marca[1]}"][data-lado="${marca[2]}"]`);
        if (volta) { volta.focus(); volta.select(); }
    }
});

document.addEventListener('click', (e) => {
    const lupa = e.target.closest('[data-gols]');
    if (lupa) { const [c, f] = lupa.dataset.gols.split('|'); verGols(c, f); return; }

    const d = e.target.closest('[data-distrito]');
    if (d) { distritoAberto = d.dataset.distrito; desenharPainel(); return; }

    if (e.target.matches('[data-fechar]')) { distritoAberto = null; desenharPainel(); return; }

    const gx = e.target.closest('[data-grupo-expandir]');
    if (gx) {
        const n = gx.dataset.grupoExpandir;
        gruposAbertos.has(n) ? gruposAbertos.delete(n) : gruposAbertos.add(n);
        desenhar();
        return;
    }

    const ex = e.target.closest('[data-expandir]');
    if (ex) { abertos[ex.dataset.expandir] = !abertos[ex.dataset.expandir]; desenharTopo(); return; }

    const chip = e.target.closest('.chip');
    if (chip) { filtro = chip.dataset.grupo || null; desenhar(); return; }

    const df = e.target.closest('[data-desfazer]');
    if (df) {
        const [nome, i] = df.dataset.desfazer.split('|');
        delete editados[chave(GRUPOS[nome].jogos[+i])];
        desenhar();
        return;
    }

    if (e.target.closest('#btZerar')) {
        Object.keys(editados).forEach(k => delete editados[k]);
        desenhar();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && distritoAberto) { distritoAberto = null; desenharPainel(); }
});


carregar().catch(e => {
    console.error(e);
    document.getElementById('grupos').innerHTML =
        `<div class="info-bar"><span>❌ Não foi possível carregar os dados (${e.message}).</span></div>`;
});
