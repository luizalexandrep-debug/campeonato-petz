/* ==========================================================================
   Resumo da rodada — o roteiro da "mesa redonda".

   Junta, numa tela só, o que o regional comenta no vídeo: como foi a regional
   contra as outras, como foram os distritos, quem lidera grupo, as goleadas,
   quem virou o jogo durante a semana (com destaque para o domingo) e as
   cornetas — piores resultados e quem está há mais tempo sem vencer.

   Fontes: /games-summary (placares da rodada), /evolucao (dia a dia) e
   /historico-lojas (resultado rodada a rodada, para as sequências).
   ========================================================================== */

const rsm = {
    dados: null,      // tudo já mastigado para a tela
    aba: 'regional',  // abre nos dados; o roteiro narrado é uma aba à parte
    semana: null
};

const RSM_DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function rsmDistritoDe(loja) {
    for (const [reg, dists] of Object.entries(st.estrutura || {})) {
        for (const [dist, lojas] of Object.entries(dists)) {
            if (lojas.includes(loja)) return { regional: reg, distrito: dist };
        }
    }
    return null;
}

function rsmPl(n, um, muitos) {
    return `${n} ${n === 1 ? um : muitos}`;
}

/* ---------- montagem ---------- */

async function rsmMontar() {
    const semana = st.semana;
    const { proj, semDados } = projecaoDaRodada();
    if (semDados) return { semDados: true, semana };

    // índices loja -> distrito/regional
    const de = {};
    Object.entries(st.estrutura).forEach(([reg, dists]) =>
        Object.entries(dists).forEach(([dist, lojas]) =>
            lojas.forEach(l => { de[l] = { regional: reg, distrito: dist }; })));

    /* ---- 1. regionais: V/E/D e o confronto direto entre elas ---- */
    const regs = Object.keys(st.estrutura);
    const zeroVED = () => ({ V: 0, E: 0, D: 0, pts: 0, jogos: 0, gm: 0, gs: 0 });
    const porRegional = {}, porDistrito = {}, contra = {};
    regs.forEach(r => {
        porRegional[r] = zeroVED();
        contra[r] = {};
        regs.forEach(o => { if (o !== r) contra[r][o] = { V: 0, E: 0, D: 0 }; });
        Object.keys(st.estrutura[r]).forEach(d => { porDistrito[d] = { ...zeroVED(), regional: r }; });
    });

    const jogos = st.summary?.games || [];
    const golead = { pro: [], contra: [] };
    jogos.forEach(g => {
        const [a, b] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        [[g.team1, a, b, g.team2], [g.team2, b, a, g.team1]].forEach(([loja, gm, gs, adv]) => {
            const i = de[loja];
            if (!i) return;
            const res = gm > gs ? 'V' : (gm === gs ? 'E' : 'D');
            const pts = gm > gs ? 3 : (gm === gs ? 1 : 0);
            [porRegional[i.regional], porDistrito[i.distrito]].forEach(o => {
                o[res]++; o.pts += pts; o.jogos++; o.gm += gm; o.gs += gs;
            });
            const ia = de[adv];
            if (ia && ia.regional !== i.regional) contra[i.regional][ia.regional][res]++;
            // goleadas só do meu lado da mesa
            if (i.regional === REGIONAL_DESTAQUE && (gm === 6 || gs === 6)) {
                (gm === 6 ? golead.pro : golead.contra).push({
                    loja, adv, placar: `${gm} x ${gs}`, distrito: i.distrito,
                    advReg: ia ? ia.regional : '—'
                });
            }
        });
    });

    const media = (o) => o.jogos ? o.pts / o.jogos : 0;
    const rankReg = Object.entries(porRegional)
        .map(([nome, o]) => ({ nome, ...o, media: media(o) }))
        .sort((x, y) => y.media - x.media || y.V - x.V);
    const rankDist = Object.entries(porDistrito)
        .map(([nome, o]) => ({ nome, ...o, media: media(o) }))
        .sort((x, y) => y.media - x.media || y.V - x.V);

    /* ---- 2. grupos: onde minhas lojas estão ---- */
    const grupos = [];
    Object.entries(st.grupos).forEach(([nome, linhas]) => {
        const { base, sim } = classificarGrupo(linhas, proj);
        const posBase = {}, posSim = {};
        base.forEach((r, i) => { posBase[r.time] = i + 1; });
        sim.forEach((r, i) => { posSim[r.time] = i + 1; });
        const minhas = sim.map((r, i) => ({ ...r, pos: i + 1, posAnt: posBase[r.time] }))
            .filter(r => st.minhasLojas.has(r.time));
        if (!minhas.length) return;
        grupos.push({
            nome, total: sim.length,
            lider: sim[0], liderAnt: base[0],
            vice: sim[1] ? sim[1].time : null,
            folga: sim[1] ? sim[0].pts - sim[1].pts : null,
            minhas: minhas.map(r => ({
                ...r,
                distrito: de[r.time]?.distrito || '',
                movimento: (r.posAnt || 0) - r.pos,
                zonaG4: r.pos <= 4, zonaZ4: r.pos > sim.length - 4
            }))
        });
    });
    grupos.sort((a, b) => {
        const n = (x) => parseInt((x.match(/Grupo\s+(\d+)/) || [])[1] || 0, 10);
        return n(a.nome) - n(b.nome);
    });

    const lideres = grupos.filter(g => st.minhasLojas.has(g.lider.time))
        .map(g => ({
            grupo: g.nome, loja: g.lider.time, distrito: de[g.lider.time]?.distrito || '',
            pts: g.lider.pts, folga: g.folga, vice: g.vice,
            novo: g.liderAnt.time !== g.lider.time, antigo: g.liderAnt.time
        }));

    /* ---- 3. viradas na semana (precisa do dia a dia) ---- */
    let viradas = [], diasLancados = [];
    try {
        const ev = await pegar(`/evolucao/${semana}`);
        diasLancados = ev.dias || [];
        const u = diasLancados.length - 1;
        if (u > 0) {
            const resDia = (e, i) => {
                let gp = 0, gc = 0;
                Object.values(e.gols).forEach(sq => { if (sq[i] === 'V') gp++; else if (sq[i] === 'D') gc++; });
                return { gp, gc, r: gp > gc ? 'V' : (gp === gc ? 'E' : 'D') };
            };
            Object.entries(ev.lojas).forEach(([loja, e]) => {
                const i = de[loja];
                if (!i || i.regional !== REGIONAL_DESTAQUE) return;
                const fim = resDia(e, u);
                // último dia em que o resultado era diferente do final
                let virouEm = null, antes = null;
                for (let k = u; k > 0; k--) {
                    const ant = resDia(e, k - 1);
                    if (ant.r !== fim.r) { virouEm = diasLancados[k]; antes = ant; break; }
                }
                if (!virouEm) return;
                const ganho = (fim.r === 'V' ? 3 : fim.r === 'E' ? 1 : 0)
                            - (antes.r === 'V' ? 3 : antes.r === 'E' ? 1 : 0);
                viradas.push({
                    loja, adv: e.adv, distrito: i.distrito,
                    de: antes.r, para: fim.r,
                    placarAntes: `${antes.gp}x${antes.gc}`, placarFim: `${fim.gp}x${fim.gc}`,
                    virouEm, ganho, noDomingo: virouEm === diasLancados[u]
                });
            });
            viradas.sort((a, b) => (b.noDomingo - a.noDomingo) || (b.ganho - a.ganho));
        }
    } catch (e) { console.warn('evolucao indisponível', e); }

    /* ---- 4. cornetas: piores da rodada e jejum de vitória ---- */
    let jejum = [];
    try {
        const h = await pegar('/historico-lojas');
        const ate = semana - 1;   // o histórico oficial vai até a rodada anterior
        Object.entries(h.lojas || {}).forEach(([loja, lista]) => {
            const i = de[loja];
            if (!i || i.regional !== REGIONAL_DESTAQUE) return;
            const passado = lista.filter(j => j.rodada <= ate);
            if (!passado.length) return;
            const ult = [...passado].reverse().find(j => j.res === 'V');
            let semVencer = 0;
            for (let k = passado.length - 1; k >= 0 && passado[k].res !== 'V'; k--) semVencer++;
            const p = proj[loja];
            const agora = p ? (p.gm > p.gs ? 'V' : p.gm === p.gs ? 'E' : 'D') : null;
            jejum.push({
                loja, distrito: i.distrito, semVencer,
                ultimaVitoria: ult ? ult.rodada : null,
                ultimaVitoriaPlacar: ult ? `${ult.gm}x${ult.gs}` : null,
                ultimaVitoriaAdv: ult ? ult.adv : null,
                vitorias: passado.filter(j => j.res === 'V').length,
                rodadas: passado.length,
                agora, agoraPlacar: p ? `${p.gm} x ${p.gs}` : null, agoraAdv: p ? p.adv : null
            });
        });
        // quem está há mais tempo sem vencer primeiro; e a rodada atual não conta
        // como alívio se ainda não venceu nela
        jejum.sort((a, b) => b.semVencer - a.semVencer || a.vitorias - b.vitorias);
    } catch (e) { console.warn('histórico indisponível', e); }

    const minhasDaRodada = Object.keys(proj)
        .filter(l => de[l] && de[l].regional === REGIONAL_DESTAQUE)
        .map(l => ({ loja: l, distrito: de[l].distrito, ...proj[l] }));
    const piores = minhasDaRodada.filter(x => x.der).sort((a, b) => (a.gm - a.gs) - (b.gm - b.gs));
    const melhores = minhasDaRodada.filter(x => x.vit).sort((a, b) => (b.gm - b.gs) - (a.gm - a.gs));

    return {
        semana, semDados: false, diasLancados,
        rankReg, rankDist, contra, grupos, lideres, golead,
        viradas, jejum, piores, melhores,
        minhaPos: rankReg.findIndex(r => r.nome === REGIONAL_DESTAQUE) + 1,
        minha: rankReg.find(r => r.nome === REGIONAL_DESTAQUE)
    };
}

/* ---------- render ---------- */

function rsmCorRes(r) {
    return r === 'V' ? 'v' : r === 'E' ? 'e' : 'd';
}

function rsmBlocoRegional(d) {
    const m = d.minha;
    if (!m) return '<div class="rs-nota">Regional não encontrada na estrutura.</div>';
    const outras = Object.entries(d.contra[REGIONAL_DESTAQUE] || {}).map(([adv, c]) => `
        <tr><td class="l">${adv}</td>
            <td class="c v">${c.V}</td><td class="c e">${c.E}</td><td class="c d">${c.D}</td>
            <td class="c b">${c.V * 3 + c.E}</td>
            <td class="l pequeno">${c.V > c.D ? 'levamos a melhor' : (c.V < c.D ? 'levamos a pior' : 'equilibrado')}</td></tr>`).join('');

    const linhasReg = d.rankReg.map((r, i) => `
        <tr class="${r.nome === REGIONAL_DESTAQUE ? 'meu' : ''}">
            <td class="c b">${i + 1}º</td><td class="l">${r.nome}</td>
            <td class="c v">${r.V}</td><td class="c e">${r.E}</td><td class="c d">${r.D}</td>
            <td class="c b">${r.pts}</td><td class="c">${r.media.toFixed(2).replace('.', ',')}</td>
            <td class="c">${r.gm}–${r.gs}</td></tr>`).join('');

    return `
    <div class="rs-destaque">
        <div class="rs-num">${d.minhaPos}º</div>
        <div>
            <b>${REGIONAL_DESTAQUE}</b> na rodada ${d.semana}:
            <b class="v">${m.V}V</b> · <b class="e">${m.E}E</b> · <b class="d">${m.D}D</b>
            em ${rsmPl(m.jogos, 'jogo', 'jogos')} —
            <b>${rsmPl(m.pts, 'ponto', 'pontos')}</b>,
            média <b>${m.media.toFixed(2).replace('.', ',')}</b> por jogo
            e saldo de gols <b>${m.gm}–${m.gs}</b>.
        </div>
    </div>
    <div class="rs-dupla">
        <div class="rs-box">
            <h5>🏆 Ranking das regionais na rodada</h5>
            <table class="rs-tab">
                <thead><tr><th>#</th><th class="l">Regional</th><th>V</th><th>E</th><th>D</th>
                    <th>Pts</th><th>Méd.</th><th>Gols</th></tr></thead>
                <tbody>${linhasReg}</tbody>
            </table>
        </div>
        <div class="rs-box">
            <h5>⚔ Como fomos contra cada regional <small>jogos das minhas lojas contra elas</small></h5>
            <table class="rs-tab">
                <thead><tr><th class="l">Adversário</th><th>V</th><th>E</th><th>D</th><th>Pts</th><th class="l"></th></tr></thead>
                <tbody>${outras}</tbody>
            </table>
        </div>
    </div>`;
}

function rsmBlocoDistritos(d) {
    const linhas = d.rankDist.map((r, i) => `
        <tr class="${r.regional === REGIONAL_DESTAQUE ? 'meu' : ''}">
            <td class="c b">${i + 1}º</td><td class="l">${r.nome}</td>
            <td class="l pequeno">${r.regional}</td>
            <td class="c v">${r.V}</td><td class="c e">${r.E}</td><td class="c d">${r.D}</td>
            <td class="c b">${r.pts}</td><td class="c">${r.media.toFixed(2).replace('.', ',')}</td>
            <td class="c">${r.gm}–${r.gs}</td></tr>`).join('');
    const meus = d.rankDist.map((r, i) => ({ ...r, pos: i + 1 }))
        .filter(r => r.regional === REGIONAL_DESTAQUE);
    const melhor = meus[0], pior = meus[meus.length - 1];
    return `
    ${melhor ? `<div class="rs-nota">
        Melhor distrito da casa: <b>${melhor.nome}</b> (${melhor.pos}º geral, ${melhor.V}V-${melhor.E}E-${melhor.D}D,
        média ${melhor.media.toFixed(2).replace('.', ',')}).
        Lanterna da casa: <b>${pior.nome}</b> (${pior.pos}º geral, ${pior.V}V-${pior.E}E-${pior.D}D,
        média ${pior.media.toFixed(2).replace('.', ',')}).</div>` : ''}
    <div class="rs-box">
        <table class="rs-tab">
            <thead><tr><th>#</th><th class="l">Distrito</th><th class="l">Regional</th>
                <th>V</th><th>E</th><th>D</th><th>Pts</th><th>Méd.</th><th>Gols</th></tr></thead>
            <tbody>${linhas}</tbody>
        </table>
    </div>`;
}

function rsmBlocoGrupos(d) {
    if (!d.grupos.length) return '<div class="rs-nota">Nenhuma loja sua nos grupos carregados.</div>';
    const cartoes = d.grupos.map(g => {
        const linhas = g.minhas.map(r => {
            const mov = r.movimento > 0 ? `<span class="sobe">▲${r.movimento}</span>`
                : (r.movimento < 0 ? `<span class="desce">▼${-r.movimento}</span>` : '<span class="igual">—</span>');
            const zona = r.zonaG4 ? '<span class="tag g4">G4</span>'
                : (r.zonaZ4 ? '<span class="tag z4">Z4</span>' : '');
            const res = r.semJogo ? '' :
                `<span class="res ${rsmCorRes(r.ganhou === 3 ? 'V' : r.ganhou === 1 ? 'E' : 'D')}">${
                    r.ganhou === 3 ? 'V' : r.ganhou === 1 ? 'E' : 'D'}</span>`;
            return `<tr>
                <td class="c b">${r.pos}º</td>
                <td class="l"><b>${r.time}</b> <small>${r.distrito}</small></td>
                <td class="c">${mov}</td><td class="c">${zona}</td>
                <td class="c">${res}</td>
                <td class="l pequeno">${r.adv ? 'vs ' + r.adv : ''}</td>
                <td class="c b">${r.pts}</td></tr>`;
        }).join('');
        const liderMeu = st.minhasLojas.has(g.lider.time);
        return `<div class="rs-grupo">
            <div class="rs-grupo-cab">
                <b>${g.nome}</b>
                <span class="pequeno">líder: <b class="${liderMeu ? 'meu-txt' : ''}">${g.lider.time}</b>
                    (${g.lider.pts} pts)${g.liderAnt.time !== g.lider.time
                        ? ` · tomou a ponta de ${g.liderAnt.time}` : ''}</span>
            </div>
            <table class="rs-tab compacta"><tbody>${linhas}</tbody></table>
        </div>`;
    }).join('');
    return `<div class="rs-grupos">${cartoes}</div>`;
}

function rsmBlocoDestaques(d) {
    const cx = (titulo, lista, vazio, fn, cls) => `
        <div class="rs-box ${cls || ''}">
            <h5>${titulo}</h5>
            ${lista.length ? `<ul class="rs-lista">${lista.map(fn).join('')}</ul>`
                : `<div class="rs-nota">${vazio}</div>`}
        </div>`;

    const gPro = cx('🎯 Goleadas a favor <small>6 x 0</small>', d.golead.pro,
        'Nenhuma goleada de 6x0 a favor nesta rodada.',
        x => `<li><b>${x.loja}</b> <small>${x.distrito}</small> ${x.placar} <b>${x.adv}</b>
              <small>${x.advReg}</small></li>`, 'bom');
    const gCon = cx('🧨 Goleadas contra <small>0 x 6</small>', d.golead.contra,
        'Nenhuma loja nossa levou 6x0. Bom sinal.',
        x => `<li><b>${x.loja}</b> <small>${x.distrito}</small> ${x.placar} <b>${x.adv}</b>
              <small>${x.advReg}</small></li>`, 'ruim');

    const rot = { V: 'vitória', E: 'empate', D: 'derrota' };
    const dom = d.viradas.filter(v => v.noDomingo);
    const outras = d.viradas.filter(v => !v.noDomingo);
    const virada = (v) => `<li class="${v.ganho > 0 ? 'bom' : 'ruim'}">
        <b>${v.loja}</b> <small>${v.distrito}</small> vs <b>${v.adv}</b> —
        estava em ${rot[v.de]} ${v.placarAntes} e terminou em
        <b>${rot[v.para]} ${v.placarFim}</b>
        <small>(virou na ${v.virouEm}${v.noDomingo ? ', no último dia' : ''})</small>
        <span class="${v.ganho > 0 ? 'sobe' : 'desce'}">${v.ganho > 0 ? '+' : ''}${v.ganho} pt</span></li>`;

    return `
    <div class="rs-dupla">${gPro}${gCon}</div>
    <div class="rs-dupla">
        ${cx('🔥 Viradas no domingo <small>mudou de resultado no último dia</small>', dom,
            'Nenhuma loja virou o resultado no último dia.', virada)}
        ${cx('🔄 Viradas no meio da semana', outras,
            'Nenhuma outra virada durante a semana.', virada)}
    </div>`;
}

function rsmBlocoCornetas(d) {
    const semVencer = d.jejum.filter(j => j.semVencer > 0).slice(0, 12);
    const linhas = semVencer.map(j => `
        <tr class="${j.agora === 'V' ? 'aliviou' : ''}">
            <td class="l"><b>${j.loja}</b> <small>${j.distrito}</small></td>
            <td class="c b desce">${j.semVencer}</td>
            <td class="l pequeno">${j.ultimaVitoria
                ? `rodada ${j.ultimaVitoria} — ${j.ultimaVitoriaPlacar} vs ${j.ultimaVitoriaAdv}`
                : 'ainda não venceu no campeonato'}</td>
            <td class="c">${j.vitorias}/${j.rodadas}</td>
            <td class="c">${j.agora
                ? `<span class="res ${rsmCorRes(j.agora)}">${j.agora}</span> <small>${j.agoraPlacar}</small>`
                : '—'}</td>
        </tr>`).join('');

    const piores = d.piores.slice(0, 8).map(x => `<li>
        <b>${x.loja}</b> <small>${x.distrito}</small> perdeu de <b>${x.gm} x ${x.gs}</b>
        para <b>${x.adv}</b></li>`).join('');
    const melhores = d.melhores.slice(0, 8).map(x => `<li>
        <b>${x.loja}</b> <small>${x.distrito}</small> venceu por <b>${x.gm} x ${x.gs}</b>
        <b>${x.adv}</b></li>`).join('');

    return `
    <div class="rs-box">
        <h5>😬 Quem está sem vencer <small>rodadas seguidas sem vitória até a rodada ${d.semana - 1}</small></h5>
        ${semVencer.length ? `<table class="rs-tab">
            <thead><tr><th class="l">Loja</th><th>Jejum</th><th class="l">Última vitória</th>
                <th>V/Rod.</th><th>Rodada ${d.semana}</th></tr></thead>
            <tbody>${linhas}</tbody></table>
            <div class="rs-nota">Linha esverdeada = está vencendo na rodada ${d.semana} e mata o jejum.</div>`
        : '<div class="rs-nota">Todas as lojas da regional venceram na última rodada.</div>'}
    </div>
    <div class="rs-dupla">
        <div class="rs-box ruim"><h5>👎 Piores resultados da rodada</h5>
            ${piores ? `<ul class="rs-lista">${piores}</ul>` : '<div class="rs-nota">Nenhuma derrota.</div>'}</div>
        <div class="rs-box bom"><h5>👏 Melhores resultados da rodada</h5>
            ${melhores ? `<ul class="rs-lista">${melhores}</ul>` : '<div class="rs-nota">Nenhuma vitória.</div>'}</div>
    </div>`;
}

function rsmBlocoLideres(d) {
    if (!d.lideres.length) return '<div class="rs-nota">Nenhuma loja da regional lidera o seu grupo nesta projeção.</div>';
    return `<div class="rs-box bom">
        <h5>👑 Nossas lojas na liderança do grupo <small>${d.lideres.length} de 14</small></h5>
        <ul class="rs-lista">${d.lideres.map(l => `<li>
            <b>${l.loja}</b> <small>${l.distrito}</small> — ${l.grupo}, ${l.pts} pts
            ${l.folga != null ? `<small>${l.folga > 0
                ? `${rsmPl(l.folga, 'ponto', 'pontos')} de folga sobre ${l.vice}`
                : `empatado com ${l.vice}, na frente pelo desempate`}</small>` : ''}
            ${l.novo ? `<span class="sobe">assumiu a ponta (era ${l.antigo})</span>` : '<small>· segue líder</small>'}
        </li>`).join('')}</ul>
    </div>`;
}

const RSM_ABAS = [
    { id: 'sugerido', rot: '🎬 Roteiro sugerido', fn: () => rsmBlocoSugerido(), narrado: true },
    { id: 'regional', rot: '1 · Regional', fn: rsmBlocoRegional },
    { id: 'distritos', rot: '2 · Distritos', fn: rsmBlocoDistritos },
    { id: 'lideres', rot: '3 · Líderes', fn: rsmBlocoLideres },
    { id: 'grupos', rot: '4 · Grupo a grupo', fn: rsmBlocoGrupos },
    { id: 'destaques', rot: '5 · Goleadas e viradas', fn: rsmBlocoDestaques },
    { id: 'cornetas', rot: '6 · Cornetas', fn: rsmBlocoCornetas }
];

function rsmRender() {
    const corpo = document.querySelector('.modal-resumo .modal-corpo');
    if (!corpo || !rsm.dados) return;
    const d = rsm.dados;
    if (d.semDados) {
        corpo.innerHTML = `<div class="rs-nota atencao">A rodada ${d.semana} ainda não tem vendas lançadas —
            não há resultados para resumir. Escolha uma rodada já disputada no seletor.</div>`;
        return;
    }
    const abas = RSM_ABAS.map(a =>
        `<button class="rs-aba${a.narrado ? ' narrado' : ''}${rsm.aba === a.id ? ' on' : ''}"
            onclick="rsmTrocarAba('${a.id}')">${a.rot}</button>`).join('');
    const atual = RSM_ABAS.find(a => a.id === rsm.aba) || RSM_ABAS[0];
    corpo.innerHTML = `
        <div class="rs-abas">${abas}
            <button class="rs-aba tudo${rsm.aba === 'tudo' ? ' on' : ''}" onclick="rsmTrocarAba('tudo')">📜 Dados completos</button>
            ${rsm.aba === 'sugerido'
                ? '<button class="rs-aba dado" onclick="rsmOutraVersao()">🎲 Outra versão</button>' : ''}
        </div>
        <div class="rs-conteudo">
            ${rsm.aba === 'tudo'
                ? RSM_ABAS.filter(a => !a.narrado)
                    .map(a => `<h4 class="rs-sec">${a.rot.replace(/^\d+ · /, '')}</h4>${a.fn(d)}`).join('')
                : atual.fn(d)}
        </div>`;
}

function rsmTrocarAba(id) {
    rsm.aba = id;
    rsmRender();
}

async function abrirResumoRodada() {
    if (!st.souAdmin) return;          // guarda: o botão só existe para o master
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-resumo">
            <div class="modal-head">
                <div class="md-titulo">
                    <b>📋 Resumo da rodada ${st.semana}</b>
                    <small>roteiro da mesa redonda · ${REGIONAL_DESTAQUE}</small>
                </div>
                <button class="modal-btn" id="rsmCopiar">📋 Copiar roteiro</button>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo"><div class="carregando">⏳ Montando o resumo...</div></div>
        </div>`;
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);
    fundo.querySelector('#rsmCopiar').onclick = (ev) => rsmCopiarRoteiro(ev.currentTarget);

    try {
        if (!rsm.dados || rsm.semana !== st.semana) {
            rsm.dados = await rsmMontar();
            rsm.semana = st.semana;
        }
        rsmRender();
    } catch (e) {
        console.error(e);
        fundo.querySelector('.modal-corpo').innerHTML =
            `<div class="rs-nota atencao">Não foi possível montar o resumo: ${e.message}</div>`;
    }
}

/* ---------- roteiro em texto, para levar para a gravação ---------- */

function rsmRoteiroTexto() {
    const d = rsm.dados;
    if (!d || d.semDados) return '';
    const L = [];
    const f2 = v => v.toFixed(2).replace('.', ',');
    const rot = { V: 'vitória', E: 'empate', D: 'derrota' };

    L.push(`MESA REDONDA — RODADA ${d.semana} — ${REGIONAL_DESTAQUE}`, '');

    const m = d.minha;
    L.push('1) A REGIONAL');
    L.push(`   ${d.minhaPos}º entre as regionais na rodada: ${m.V}V ${m.E}E ${m.D}D em ${m.jogos} jogos,`);
    L.push(`   ${m.pts} pontos, média ${f2(m.media)} por jogo, gols ${m.gm}-${m.gs}.`);
    Object.entries(d.contra[REGIONAL_DESTAQUE] || {}).forEach(([adv, c]) => {
        L.push(`   Contra ${adv}: ${c.V}V ${c.E}E ${c.D}D (${c.V * 3 + c.E} pts).`);
    });
    L.push('');

    L.push('2) OS DISTRITOS');
    d.rankDist.map((r, i) => ({ ...r, pos: i + 1 }))
        .filter(r => r.regional === REGIONAL_DESTAQUE)
        .forEach(r => L.push(`   ${r.pos}º geral — ${r.nome}: ${r.V}V ${r.E}E ${r.D}D, ${r.pts} pts, média ${f2(r.media)}.`));
    L.push('');

    L.push('3) LOJAS LÍDERES DE GRUPO');
    if (!d.lideres.length) L.push('   Nenhuma loja nossa lidera grupo nesta rodada.');
    d.lideres.forEach(l => L.push(`   ${l.loja} (${l.distrito}) — ${l.grupo}, ${l.pts} pts` +
        (l.folga != null ? `, ${l.folga > 0 ? l.folga + ' de folga sobre ' + l.vice : 'empatado com ' + l.vice}` : '') +
        (l.novo ? ` — ASSUMIU A PONTA (era ${l.antigo})` : '')));
    L.push('');

    L.push('4) GRUPO A GRUPO');
    d.grupos.forEach(g => {
        L.push(`   ${g.nome} — líder ${g.lider.time} (${g.lider.pts} pts)` +
            (g.liderAnt.time !== g.lider.time ? ` [tomou a ponta de ${g.liderAnt.time}]` : ''));
        g.minhas.forEach(r => {
            const mov = r.movimento > 0 ? `subiu ${r.movimento}` : (r.movimento < 0 ? `caiu ${-r.movimento}` : 'manteve');
            const res = r.ganhou === 3 ? 'V' : r.ganhou === 1 ? 'E' : 'D';
            L.push(`      ${r.pos}º ${r.time} (${r.distrito}) — ${r.pts} pts, ${mov}` +
                (r.adv ? `, ${res} contra ${r.adv}` : '') +
                (r.zonaG4 ? ' [G4]' : r.zonaZ4 ? ' [Z4]' : ''));
        });
    });
    L.push('');

    L.push('5) GOLEADAS E VIRADAS');
    L.push(`   6x0 a favor: ${d.golead.pro.length ? d.golead.pro.map(x => `${x.loja} ${x.placar} ${x.adv}`).join('; ') : 'nenhuma'}`);
    L.push(`   6x0 contra: ${d.golead.contra.length ? d.golead.contra.map(x => `${x.loja} ${x.placar} ${x.adv}`).join('; ') : 'nenhuma'}`);
    const dom = d.viradas.filter(v => v.noDomingo);
    L.push(`   Viradas no último dia (${dom.length}):`);
    dom.forEach(v => L.push(`      ${v.loja} (${v.distrito}) vs ${v.adv}: ${rot[v.de]} ${v.placarAntes} -> ${rot[v.para]} ${v.placarFim} (${v.ganho > 0 ? '+' : ''}${v.ganho} pt)`));
    const out = d.viradas.filter(v => !v.noDomingo);
    if (out.length) {
        L.push(`   Viradas no meio da semana (${out.length}):`);
        out.forEach(v => L.push(`      ${v.loja} (${v.distrito}) vs ${v.adv}: ${rot[v.de]} ${v.placarAntes} -> ${rot[v.para]} ${v.placarFim}, virou na ${v.virouEm}`));
    }
    L.push('');

    L.push('6) CORNETAS');
    d.piores.slice(0, 8).forEach(x => L.push(`   ${x.loja} (${x.distrito}) perdeu de ${x.gm} x ${x.gs} para ${x.adv}.`));
    const jj = d.jejum.filter(j => j.semVencer > 0).slice(0, 12);
    if (jj.length) {
        L.push('   Sem vencer:');
        jj.forEach(j => L.push(`      ${j.loja} (${j.distrito}) — ${rsmPl(j.semVencer, 'rodada', 'rodadas')} sem vencer; ` +
            (j.ultimaVitoria ? `última vitória na rodada ${j.ultimaVitoria} (${j.ultimaVitoriaPlacar} vs ${j.ultimaVitoriaAdv})` : 'ainda não venceu') +
            (j.agora === 'V' ? ' — ESTÁ VENCENDO NESTA RODADA' : '')));
    }
    return L.join('\n');
}

async function rsmCopiarRoteiro(btn) {
    // Na aba do roteiro narrado copia o texto de leitura; nas demais, o
    // resumo em tópicos com os números.
    const txt = rsm.aba === 'sugerido' ? rsmSugeridoTexto() : rsmRoteiroTexto();
    if (!txt) return;
    const original = btn.innerHTML;
    try {
        await navigator.clipboard.writeText(txt);
        btn.innerHTML = '✅ Copiado!';
    } catch (e) {
        // Clipboard bloqueado: cai para a seleção manual, sem perder o texto.
        const ta = document.createElement('textarea');
        ta.value = txt; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); btn.innerHTML = '✅ Copiado!'; }
        catch (_) { btn.innerHTML = '⚠️ Copie manualmente'; }
        ta.remove();
    }
    setTimeout(() => { btn.innerHTML = original; }, 2200);
}

/* ==========================================================================
   Roteiro sugerido — o mesmo conteúdo, mas escrito em voz de programa de mesa
   redonda: texto corrido, tom leve, pronto para ler na câmera.

   O sorteio das variações é só de FORMA (as aberturas, os bordões); os números
   vêm todos de rsm.dados. Clicar em "outra versão" reescreve o texto sem mexer
   em nenhum dado.
   ========================================================================== */

let rsmSemente = 0;

function rsmEscolher(lista) {
    // Sorteio simples com semente, para "outra versão" mudar tudo de uma vez.
    rsmSemente = (rsmSemente * 1103515245 + 12345) & 0x7fffffff;
    return lista[rsmSemente % lista.length];
}

// Para listas: escolhe pelo índice do item, então dois itens seguidos nunca
// caem na mesma frase. É o que evita o "Garantiu mais 2 pontos no grito" onze
// vezes seguidas.
function rsmVariar(lista, i) {
    return lista[(i + (rsmSemente % lista.length)) % lista.length];
}

function rsmPlural(n, um, muitos) {
    return `${n} ${n === 1 ? um : muitos}`;
}

function rsmNome(loja, distrito) {
    return distrito ? `${loja} (${distrito})` : loja;
}

function rsmLista(itens, ligacao = 'e') {
    if (!itens.length) return '';
    if (itens.length === 1) return itens[0];
    return itens.slice(0, -1).join(', ') + ` ${ligacao} ` + itens[itens.length - 1];
}

function rsmRoteiroNarrado() {
    const d = rsm.dados;
    if (!d || d.semDados) return [];
    const f2 = v => v.toFixed(2).replace('.', ',');
    const S = [];
    const m = d.minha;
    const eu = REGIONAL_DESTAQUE;
    const rot = { V: 'ganhando', E: 'empatando', D: 'perdendo' };

    /* ---------- abertura ---------- */
    const aberturas = [
        `Boa noite, senhoras e senhores! Bem-vindos a mais uma mesa redonda do Campeonato Petz. Rodada ${d.semana} encerrada, planilha fechada, e é hora de olhar no olho e falar de resultado.`,
        `Sejam bem-vindos à mesa redonda do Campeonato Petz! A rodada ${d.semana} acabou, os números estão na mesa e hoje ninguém sai daqui sem ouvir a real.`,
        `Fala, torcida da ${eu}! Rodada ${d.semana} no retrovisor, apito final, e a mesa está posta: tem elogio, tem cobrança e tem corneta.`,
        `Chegamos ao fim da rodada ${d.semana} e a mesa está quente. Cadeira arrumada, café na mão, e vamos ao que interessa: quem produziu e quem passeou.`
    ];
    S.push({ titulo: '🎬 Abertura', paras: [rsmEscolher(aberturas)] });

    /* ---------- a regional ---------- */
    const pos = d.minhaPos;
    const totalReg = d.rankReg.length;
    const p = [];
    if (pos === 1) {
        p.push(rsmEscolher([
            `E começo com a notícia boa: a ${eu} **fechou a rodada em primeiro lugar** entre as regionais. Foram ${rsmPlural(m.V, 'vitória', 'vitórias')}, ${rsmPlural(m.E, 'empate', 'empates')} e ${rsmPlural(m.D, 'derrota', 'derrotas')} em ${m.jogos} jogos — ${m.pts} pontos e média de ${f2(m.media)} por jogo.`,
            `Vou começar pelo troféu: a ${eu} **liderou a rodada** entre as três regionais. ${m.V} vitórias, ${m.E} empates, ${m.D} derrotas, ${m.pts} pontos e ${f2(m.media)} de média por jogo. Pode bater palma.`
        ]));
        const seg = d.rankReg[1];
        if (seg) p.push(`A ${seg.nome} veio logo atrás com ${f2(seg.media)} de média. Ou seja: dá para comemorar, mas com o retrovisor ligado.`);
    } else {
        const lider = d.rankReg[0];
        p.push(rsmEscolher([
            `Vamos à real: a ${eu} terminou a rodada em **${pos}º entre as ${totalReg} regionais**. ${m.V} vitórias, ${m.E} empates e ${m.D} derrotas, ${m.pts} pontos, média ${f2(m.media)}. A ${lider.nome} passou na frente com ${f2(lider.media)}.`,
            `Começando pela cobrança: ficamos em **${pos}º lugar** nesta rodada. ${m.V}V, ${m.E}E e ${m.D}D, com ${f2(m.media)} de média por jogo — enquanto a ${lider.nome} fez ${f2(lider.media)}. Tem trabalho pela frente.`
        ]));
    }
    p.push(`No saldo de gols a regional fez ${m.gm} e levou ${m.gs}. ${m.gm > m.gs
        ? 'Ataque funcionando, defesa segurando.'
        : (m.gm === m.gs ? 'Equilíbrio total — o que a gente faz de um lado, devolve do outro.' : 'Fizemos menos do que levamos, e isso precisa mudar.')}`);

    Object.entries(d.contra[eu] || {}).forEach(([adv, c], iAdv) => {
        const saldo = c.V - c.D;
        p.push(rsmVariar([
            `No confronto direto contra a ${adv}: ${c.V} vitórias, ${c.E} empates e ${c.D} derrotas. ${saldo > 0
                ? `Levamos a melhor, e isso a gente faz questão de lembrar na próxima reunião.`
                : (saldo === 0 ? `Empate técnico. Ninguém pode encher o peito.` : `Levamos a pior, e não adianta procurar desculpa.`)}`,
            `Contra a ${adv} o placar da guerra foi ${c.V}V, ${c.E}E e ${c.D}D. ${saldo > 0
                ? `Ponto para a gente.`
                : (saldo === 0 ? `Ficou tudo igual — fica para a próxima rodada.` : `Dessa vez eles levaram.`)}`,
            `Olhando o duelo com a ${adv}: ${c.V} ${c.V === 1 ? 'vitória' : 'vitórias'}, ${c.E} ${c.E === 1 ? 'empate' : 'empates'} e ${c.D} ${c.D === 1 ? 'derrota' : 'derrotas'} das nossas lojas. ${saldo > 0
                ? `Saldo positivo de ${saldo} — e eu vou lembrar disso.`
                : (saldo === 0 ? `Ficou tudo igual, ninguém sai daqui sorrindo.` : `Saldo negativo de ${-saldo}. Aqui a gente precisa melhorar.`)}`
        ], iAdv));
    });
    S.push({ titulo: '🏆 A regional', paras: p });

    /* ---------- distritos ---------- */
    const meus = d.rankDist.map((r, i) => ({ ...r, pos: i + 1 })).filter(r => r.regional === eu);
    const pd = [];
    if (meus.length) {
        const melhor = meus[0], pior = meus[meus.length - 1];
        pd.push(rsmEscolher([
            `Passando pelos distritos: o destaque da casa é o **${melhor.nome}**, ${melhor.pos}º no geral, com ${rsmPlural(melhor.V, 'vitória', 'vitórias')}, ${rsmPlural(melhor.E, 'empate', 'empates')} e ${rsmPlural(melhor.D, 'derrota', 'derrotas')} — média de ${f2(melhor.media)}. Esse aí veio para jogar.`,
            `Nos distritos, quem puxou a fila foi o **${melhor.nome}**: ${melhor.pos}º colocado geral, ${melhor.V}V-${melhor.E}E-${melhor.D}D e ${f2(melhor.media)} de média. Trabalho bem feito.`
        ]));
        if (pior !== melhor) {
            pd.push(rsmEscolher([
                `Do outro lado da mesa, o **${pior.nome}** fechou como ${pior.pos}º geral, com ${pior.V}V-${pior.E}E-${pior.D}D e média ${f2(pior.media)}. Semana difícil — e a gente sabe que dá para mais.`,
                `E agora a parte que ninguém gosta: o **${pior.nome}** ficou em ${pior.pos}º no geral, ${rsmPlural(pior.V, 'vitória', 'vitórias')} contra ${rsmPlural(pior.D, 'derrota', 'derrotas')}, média de ${f2(pior.media)}. Fica o recado, com carinho e com cobrança.`
            ]));
        }
        pd.push('A régua completa da casa, do primeiro ao último: ' +
            meus.map(r => `${r.nome} em ${r.pos}º (${f2(r.media)})`).join(', ') + '.');
    }
    S.push({ titulo: '🗺️ Os distritos', paras: pd });

    /* ---------- líderes ---------- */
    const pl = [];
    if (d.lideres.length) {
        pl.push(rsmEscolher([
            `Agora o que enche os olhos: temos **${d.lideres.length} ${d.lideres.length === 1 ? 'loja liderando o seu grupo' : 'lojas liderando os seus grupos'}** dos 14 em disputa.`,
            `Vamos às nossas lojas na ponta: são **${d.lideres.length} ${d.lideres.length === 1 ? 'líder de grupo' : 'líderes de grupo'}** carimbados nesta rodada.`
        ]));
        d.lideres.forEach(l => {
            const folga = l.folga == null ? '' : (l.folga > 0
                ? ` com ${l.folga} ${l.folga === 1 ? 'ponto' : 'pontos'} de folga sobre o ${l.vice}`
                : `, empatada com o ${l.vice} e na frente só pelo desempate — ou seja, dormindo de coturno`);
            pl.push(`**${rsmNome(l.loja, l.distrito)}** na ponta do ${l.grupo}, ${l.pts} pontos${folga}. ${l.novo
                ? `E é novidade: tomou a liderança do ${l.antigo} nesta rodada.`
                : `Segue firme na liderança.`}`);
        });
    } else {
        pl.push(`Nesta rodada não temos nenhuma loja na liderança de grupo. É duro falar isso na abertura do programa, mas é o que os números dizem — e é exatamente por isso que a gente está aqui.`);
    }
    S.push({ titulo: '👑 Nossos líderes', paras: pl });

    /* ---------- grupo a grupo ---------- */
    const pg = [];
    pg.push(`Vamos descer ao detalhe, grupo por grupo, para ninguém dizer que ficou de fora.`);
    d.grupos.forEach(g => {
        const subiram = g.minhas.filter(r => r.movimento > 0);
        const cairam = g.minhas.filter(r => r.movimento < 0);
        const g4 = g.minhas.filter(r => r.zonaG4);
        const z4 = g.minhas.filter(r => r.zonaZ4);
        const partes = [];
        partes.push(`**${g.nome}** — líder ${g.lider.time} com ${g.lider.pts} pontos${
            g.liderAnt.time !== g.lider.time ? `, que tomou a ponta do ${g.liderAnt.time}` : ''}.`);
        if (g4.length) partes.push(`No G4 temos ${rsmLista(g4.map(r => `${r.time} em ${r.pos}º`))}.`);
        if (subiram.length) partes.push(`Subiu na tabela: ${rsmLista(subiram.map(r => `${r.time} (${r.movimento} ${r.movimento === 1 ? 'posição' : 'posições'})`))}.`);
        if (cairam.length) partes.push(`Caiu: ${rsmLista(cairam.map(r => `${r.time} (${-r.movimento} ${r.movimento === -1 ? 'posição' : 'posições'})`))}.`);
        if (z4.length) partes.push(rsmEscolher([
            `Sinal amarelo no Z4: ${rsmLista(z4.map(r => `${r.time} em ${r.pos}º`))}. Precisa reagir.`,
            `E o alerta vermelho: ${rsmLista(z4.map(r => `${r.time} em ${r.pos}º`))} na zona de baixo. Não dá para deixar acomodar.`
        ]));
        pg.push(partes.join(' '));
    });
    S.push({ titulo: '📊 Grupo a grupo', paras: pg });

    /* ---------- goleadas ---------- */
    const pgo = [];
    if (d.golead.pro.length) {
        pgo.push(rsmEscolher([
            `E teve goleada! ${d.golead.pro.length === 1 ? 'Uma loja nossa aplicou' : `${d.golead.pro.length} lojas nossas aplicaram`} o 6 a 0, o famoso "passeio":`,
            `Agora o momento aplauso: ${d.golead.pro.length === 1 ? 'tivemos um' : `tivemos ${d.golead.pro.length}`} 6 a 0 a favor. Placar de futebol de várzea, e a gente adora:`
        ]));
        d.golead.pro.forEach((x, i) => pgo.push(rsmVariar([
            `**${rsmNome(x.loja, x.distrito)}** passou o rodo no ${x.adv}, da ${x.advReg}. Seis a zero, sem dó.`,
            `**${rsmNome(x.loja, x.distrito)}** não deu chance ao ${x.adv}, da ${x.advReg}: 6 a 0 e ponto final.`,
            `Teve ${rsmNome(x.loja, x.distrito)} fazendo bonito contra o ${x.adv}, da ${x.advReg} — **seis gols a zero**, jogo de um time só.`,
            `E **${rsmNome(x.loja, x.distrito)}** aplicou o 6 a 0 no ${x.adv}, da ${x.advReg}. Aula do começo ao fim.`
        ], i)));
    } else {
        pgo.push(`Goleada a favor nesta rodada, nenhuma. Ninguém aplicou o 6 a 0 — fica o desafio para a próxima.`);
    }
    if (d.golead.contra.length) {
        pgo.push(rsmEscolher([
            `Mas nem tudo é festa. ${d.golead.contra.length === 1
                ? 'Uma loja nossa levou o 6 a 0 e vai ter que ouvir:'
                : `${d.golead.contra.length} lojas nossas levaram o 6 a 0 e vão ter que ouvir:`}`,
            `E agora a parte que dói. Levamos ${d.golead.contra.length === 1 ? 'um' : d.golead.contra.length} 6 a 0 na cara:`
        ]));
        d.golead.contra.forEach((x, i) => pgo.push(rsmVariar([
            `**${rsmNome(x.loja, x.distrito)}** levou seis do ${x.adv}, da ${x.advReg}. Zerinho na conta e muita conversa para ter na segunda-feira.`,
            `**${rsmNome(x.loja, x.distrito)}** foi atropelada pelo ${x.adv}, da ${x.advReg}: 0 a 6. Semana que vem eu quero ver reação.`,
            `Deu ${x.adv}, da ${x.advReg}, por 6 a 0 em cima ${rsmNome(x.loja, x.distrito) ? 'da **' + rsmNome(x.loja, x.distrito) + '**' : ''}. Não teve jogo.`
        ], i)));
    } else {
        pgo.push(`E o melhor: **nenhuma loja nossa levou 6 a 0**. Ninguém foi atropelado, e isso também é resultado.`);
    }
    S.push({ titulo: '🎯 As goleadas', paras: pgo });

    /* ---------- viradas ---------- */
    const pv = [];
    const dom = d.viradas.filter(v => v.noDomingo);
    const meio = d.viradas.filter(v => !v.noDomingo);
    const ultimo = d.diasLancados[d.diasLancados.length - 1] || 'domingo';
    if (dom.length) {
        pv.push(rsmEscolher([
            `E chegamos ao meu quadro favorito: **quem decidiu no último dia**. ${dom.length === 1 ? 'Uma loja virou' : `${dom.length} lojas viraram`} o resultado ${ultimo === 'Dom' ? 'no domingo' : `na ${ultimo}`}, no sufoco, no apagar das luzes:`,
            `Agora o quadro "gol no último minuto": ${dom.length === 1 ? 'teve uma loja' : `foram ${dom.length} lojas`} que mudaram o resultado ${ultimo === 'Dom' ? 'só no domingo' : `só na ${ultimo}`}. Coração de quem acompanha não aguenta:`
        ]));
        // Lista longa demais vira leitura de lista telefônica: destaco as
        // principais e resumo o resto numa frase só.
        const DESTAQUES = 6;
        const perdeuNoFim = dom.filter(v => v.ganho < 0);
        const ganhouNoFim = dom.filter(v => v.ganho > 0);
        const foco = [...perdeuNoFim, ...ganhouNoFim].slice(0, DESTAQUES);
        foco.forEach((v, i) => pv.push(v.ganho > 0
            ? rsmVariar([
                `**${rsmNome(v.loja, v.distrito)}** estava ${rot[v.de]} por ${v.placarAntes} do ${v.adv} e terminou ${rot[v.para]} por **${v.placarFim}**. ${rsmPlural(v.ganho, 'ponto', 'pontos')} no grito.`,
                `Teve ${rsmNome(v.loja, v.distrito)} contra o ${v.adv}: era ${v.placarAntes} e virou **${v.placarFim}** no último dia. Mais ${rsmPlural(v.ganho, 'ponto', 'pontos')} no bolso.`,
                `${rsmNome(v.loja, v.distrito)} não desistiu: estava ${v.placarAntes} com o ${v.adv} e fechou **${v.placarFim}**. ${rsmPlural(v.ganho, 'ponto', 'pontos')} conquistado${v.ganho === 1 ? '' : 's'} na raça.`,
                `**${rsmNome(v.loja, v.distrito)}** deixou para o fim: ${v.placarAntes} contra o ${v.adv} virou **${v.placarFim}**. Ganhou ${rsmPlural(v.ganho, 'ponto', 'pontos')} no apagar das luzes.`
            ], i)
            : rsmVariar([
                `E o outro lado da moeda: **${rsmNome(v.loja, v.distrito)}** estava ${rot[v.de]} por ${v.placarAntes} do ${v.adv} e escorregou no fim, terminando ${rot[v.para]} por **${v.placarFim}**. ${rsmPlural(-v.ganho, 'ponto perdido', 'pontos perdidos')} no último dia.`,
                `**${rsmNome(v.loja, v.distrito)}** entregou no fim: tinha ${v.placarAntes} contra o ${v.adv} e fechou em **${v.placarFim}**. ${-v.ganho === 1 ? 'Foi um ponto' : `Foram ${-v.ganho} pontos`} pelo ralo.`,
                `Já **${rsmNome(v.loja, v.distrito)}** viu o jogo fugir: ${v.placarAntes} contra o ${v.adv} terminou em **${v.placarFim}**. ${-v.ganho === 1 ? 'Um ponto que ficou' : `${-v.ganho} pontos que ficaram`} no caminho.`
            ], i)));
        const resto = dom.length - foco.length;
        if (resto > 0) {
            const outras = dom.filter(v => !foco.includes(v));
            const mostrar = outras.slice(0, 10);
            pv.push(`E ainda ${resto === 1 ? 'teve mais uma loja que mexeu' : `tiveram outras ${resto} lojas que mexeram`} no placar no último dia: ` +
                rsmLista(mostrar.map(v => `${v.loja} (${v.placarFim})`)) +
                (outras.length > mostrar.length ? `, entre outras.` : '.'));
        }
    } else {
        pv.push(`Neste quadro, silêncio: nenhuma loja mudou de resultado no último dia. Ou todo mundo resolveu cedo, ou ninguém reagiu no fim.`);
    }
    if (meio.length) {
        const m6 = meio.slice(0, 6);
        pv.push(`Durante a semana ainda ${meio.length === 1 ? 'teve uma virada' : `tiveram ${meio.length} viradas`}: ` +
            rsmLista(m6.map(v => `${v.loja} contra ${v.adv} (${v.placarAntes} virou ${v.placarFim} na ${v.virouEm})`)) +
            (meio.length > m6.length ? `, entre outras.` : '.'));
    }
    S.push({ titulo: '🔥 As viradas', paras: pv });

    /* ---------- cornetas ---------- */
    const pc = [];
    pc.push(rsmEscolher([
        `E agora, senhoras e senhores, o quadro que todo mundo espera e ninguém quer estar: **a corneta**.`,
        `Chegou a hora da corneta. Aviso desde já: é com carinho, mas é com o número na mão.`,
        `E fechamos com o quadro da corneta. Quem estiver assistindo com a loja junto, aumenta o volume.`
    ]));
    if (d.piores.length) {
        const pior = d.piores[0];
        pc.push(`Quem levou o maior tombo da rodada foi a **${rsmNome(pior.loja, pior.distrito)}**, que perdeu de ${pior.gm} a ${pior.gs} para o ${pior.adv}. ${pior.gs - pior.gm >= 4 ? 'Foi passeio do adversário.' : 'Passou longe do que a gente espera.'}`);
        if (d.piores.length > 1) {
            pc.push(`Na lista dos que também ficaram devendo: ` +
                rsmLista(d.piores.slice(1, 5).map(x => `${x.loja} (${x.gm} a ${x.gs} para o ${x.adv})`)) + '.');
        }
    } else {
        pc.push(`E olha que coisa rara: **nenhuma loja nossa perdeu nesta rodada**. A corneta hoje fica guardada no armário.`);
    }
    const jj = d.jejum.filter(j => j.semVencer > 0);
    const semNunca = jj.filter(j => !j.ultimaVitoria);
    const aliviaram = jj.filter(j => j.agora === 'V');
    if (jj.length) {
        const top = jj[0];
        pc.push(rsmEscolher([
            `E tem o quadro do jejum. O troféu abacaxi vai para **${rsmNome(top.loja, top.distrito)}**: ${top.semVencer} ${top.semVencer === 1 ? 'rodada' : 'rodadas'} sem vencer. ${top.ultimaVitoria
                ? `A última vitória foi lá na rodada ${top.ultimaVitoria}, ${top.ultimaVitoriaPlacar} contra o ${top.ultimaVitoriaAdv}.`
                : `E o mais grave: **ainda não venceu nenhuma vez no campeonato**.`}`,
            `Falando de jejum: quem está há mais tempo sem sorrir é a **${rsmNome(top.loja, top.distrito)}**, com ${top.semVencer} ${top.semVencer === 1 ? 'rodada' : 'rodadas'} sem vitória. ${top.ultimaVitoria
                ? `Precisa voltar na rodada ${top.ultimaVitoria} para achar a última — foi ${top.ultimaVitoriaPlacar} no ${top.ultimaVitoriaAdv}.`
                : `E ainda não ganhou um jogo sequer nesta competição.`}`
        ]));
        const outrasNunca = semNunca.filter(j => j.loja !== top.loja);
        if (outrasNunca.length) {
            pc.push(`E não está sozinha nessa: ${rsmLista(outrasNunca.map(j => j.loja))} ` +
                `${outrasNunca.length === 1 ? 'também ainda não venceu' : 'também ainda não venceram'} nenhuma vez no campeonato.`);
        }
        const outros = jj.slice(1, 6).filter(j => j.ultimaVitoria);
        if (outros.length) {
            pc.push(`Também estão em jejum: ` +
                rsmLista(outros.map(j => `${j.loja} com ${j.semVencer} ${j.semVencer === 1 ? 'rodada' : 'rodadas'} (última vitória na rodada ${j.ultimaVitoria})`)) + '.');
        }
        if (aliviaram.length) {
            const mostra = aliviaram.slice(0, 6);
            const nomes = rsmLista(mostra.map(j => j.loja)) +
                (aliviaram.length > mostra.length ? ` e mais ${aliviaram.length - mostra.length}` : '');
            pc.push(rsmEscolher([
                `Mas tem boa notícia no meio da bronca: ${nomes} ${aliviaram.length === 1 ? 'voltou a vencer' : 'voltaram a vencer'} nesta rodada e ${aliviaram.length === 1 ? 'matou' : 'mataram'} o jejum. Nome fora da lista — por enquanto.`,
                `E o alívio da rodada: ${nomes} ${aliviaram.length === 1 ? 'quebrou' : 'quebraram'} o jejum. Aplauso curto e de volta ao trabalho.`
            ]));
        }
    } else {
        pc.push(`E fecho com uma boa: **ninguém está em jejum de vitória**. Toda a regional venceu na última rodada. Não vou nem cornetar hoje.`);
    }
    S.push({ titulo: '😬 A corneta', paras: pc });

    /* ---------- encerramento ---------- */
    const melhorAgora = d.melhores[0];
    const fecho = [];
    if (melhorAgora) {
        fecho.push(`Para fechar no alto: **${rsmNome(melhorAgora.loja, melhorAgora.distrito)}** foi o melhor resultado da rodada, ${melhorAgora.gm} a ${melhorAgora.gs} no ${melhorAgora.adv}. É esse o padrão.`);
    }
    fecho.push(rsmEscolher([
        `É isso, pessoal. Rodada ${d.semana} encerrada, ${d.semana + 1} já começou e a planilha não espera ninguém. Quem ficou bem, mantém; quem ficou devendo, vira o jogo. Até a próxima mesa redonda!`,
        `Fechamos por aqui a rodada ${d.semana}. Agora é levantar a cabeça, olhar para a rodada ${d.semana + 1} e transformar corneta em vitória. Um abraço a todas as lojas e até a próxima!`,
        `E é o que temos para hoje. Rodada ${d.semana} nos livros, rodada ${d.semana + 1} na mesa. Trabalho bem feito aparece no placar. Até a próxima!`
    ]));
    S.push({ titulo: '🎤 Encerramento', paras: fecho });

    return S;
}

// **negrito** -> <b> (o roteiro é escrito com marcação simples)
function rsmMarcar(txt) {
    return txt.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function rsmBlocoSugerido() {
    const secoes = rsmRoteiroNarrado();
    if (!secoes.length) return '<div class="rs-nota">Sem dados para montar o roteiro.</div>';
    return `
    <div class="rs-nota">Texto sugerido para a gravação — os números são reais, só a forma muda.
        Clique em <b>🎲 Outra versão</b> para reescrever com outras palavras.</div>
    <div class="rs-roteiro">
        ${secoes.map(s => `
            <div class="rs-cena">
                <h5>${s.titulo}</h5>
                ${s.paras.map(t => `<p>${rsmMarcar(t)}</p>`).join('')}
            </div>`).join('')}
    </div>`;
}

function rsmSugeridoTexto() {
    return rsmRoteiroNarrado()
        .map(s => `${s.titulo}\n${s.paras.map(t => t.replace(/\*\*/g, '')).join('\n\n')}`)
        .join('\n\n' + '—'.repeat(40) + '\n\n');
}

function rsmOutraVersao() {
    rsmSemente = (rsmSemente + 7919) & 0x7fffffff;
    rsmRender();
}
