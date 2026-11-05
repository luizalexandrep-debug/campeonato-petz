/* Super Campeões (regulamento, seções 6 e 8).
 *
 * LOJAS: o Super Campeão de cada série é o melhor time ENTRE OS CAMPEÕES DOS GRUPOS da
 * série (A: grupos 1-3, B: 4-6, C: 7-9, D: 10-14), por pontos, com o desempate dos grupos
 * (vitórias › saldo de gols › ...). Aqui acompanhamos a corrida pelos líderes de cada
 * grupo e dizemos quem ainda tem chance matemática.
 * DISTRITAIS: os 3 distritais com a maior média de pontos por loja (1º R$ 15 mil,
 * 2º e 3º R$ 10 mil); empate: média de vitórias das lojas do distrito.
 *
 * Depende de campeas.js (campCarregar, campMaximo, campRestam, campEsc, ...).
 */
const SUPER_PREMIO = { A: 90000, B: 75000, C: 67500, D: 60000 };
const SUPER_PREMIO_DIST = [15000, 10000, 10000];
const supR = (v) => 'R$ ' + v.toLocaleString('pt-BR');
const supF2 = (v) => v.toFixed(2).replace('.', ',');

const supOrd = (a, b) => b.pts - a.pts || b.vit - a.vit || b.sg - a.sg || (b.gm || 0) - (a.gm || 0)
    || a.time.localeCompare(b.time);

// {time: {pts, vit, emp, der, gm, gs}} a partir dos jogos do resumo da rodada (mesma regra de campProjetarGrupos).
function supProjPorLoja(jogos) {
    const por = {};
    (jogos || []).forEach(g => {
        if (g.semDados || !g.scoreProjected) return;
        const m = String(g.scoreProjected).match(/(\d+)\s*x\s*(\d+)/i);
        if (!m) return;
        [[g.team1, +m[1], +m[2]], [g.team2, +m[2], +m[1]]].forEach(([t, gm, gs]) => {
            por[t] = { pts: gm > gs ? 3 : gm === gs ? 1 : 0, vit: gm > gs ? 1 : 0, emp: gm === gs ? 1 : 0, der: gm < gs ? 1 : 0, gm, gs };
        });
    });
    return por;
}

function supAplicar(grupos, proj) {
    const novos = {};
    Object.entries(grupos || {}).forEach(([nome, linhas]) => {
        novos[nome] = linhas.map(r => {
            const p = proj && proj[r.time];
            if (!p) return r;
            return { ...r, pts: r.pts + p.pts, jogos: r.jogos + 1, vit: r.vit + p.vit, emp: r.emp + p.emp,
                der: r.der + p.der, gm: r.gm + p.gm, gs: r.gs + p.gs, sg: r.sg + p.gm - p.gs };
        });
    });
    return novos;
}

/* Corrida de cada série. grupos = classificação oficial; gruposProj = com a rodada projetada (ou a mesma). */
function supCalcular(grupos, gruposProj) {
    const series = {};
    Object.entries(grupos || {}).forEach(([nome, linhas]) => {
        const sm = nome.match(/S[ée]rie\s+([A-D])/i), nm = nome.match(/Grupo\s+(\d+)/i);
        if (!sm || !nm || !linhas.length) return;
        const serie = sm[1].toUpperCase(), n = +nm[1];
        const ord = linhas.slice().sort(supOrd);
        const lid = ord[0], seg = ord[1];
        const projRows = (gruposProj && gruposProj[nome]) || linhas;
        const projPor = {};
        projRows.forEach(r => { projPor[r.time] = r; });
        const lidP = projRows.slice().sort(supOrd)[0];
        const g = {
            nome, n, serie, rows: ord, projPor, lid, lidP,
            teto: Math.max(...linhas.map(campMaximo)),          // o máximo que alguma loja do grupo ainda alcança
            tetoSeg: seg ? campMaximo(seg) : 0,
            rest: campRestam(lid)
        };
        (series[serie] = series[serie] || { serie, grupos: [] }).grupos.push(g);
    });
    Object.values(series).forEach(S => {
        S.grupos.sort((a, b) => supOrd(a.lid, b.lid));
        S.lider = S.grupos[0];
        S.grupos.forEach(g => {
            const outros = S.grupos.filter(x => x !== g);
            const melhorOutro = outros.length ? Math.max(...outros.map(x => x.lid.pts)) : 0;
            const tetoOutros = outros.length ? Math.max(...outros.map(x => x.teto)) : 0;
            g.melhorOutro = melhorOutro;
            g.chance = g.teto >= melhorOutro;                       // ainda dá para alcançar o líder atual dos outros grupos
            g.garantido = g.lid.pts > g.tetoSeg && g.lid.pts > tetoOutros;   // campeão do grupo e à frente de tudo que os outros alcançam
        });
    });
    return series;
}

/* Situação de cada loja de um grupo na corrida. */
function supSituacaoLoja(S, g, r) {
    const max = campMaximo(r);
    if (r === g.lid || r.time === g.lid.time) {
        return { camp: g.lid.pts > g.tetoSeg ? 'garantido' : 'lidera', super: g.garantido ? 'garantido' : (g.chance ? 'lidera' : 'fora'), max };
    }
    const camp = max > g.lid.pts ? 'pode' : max === g.lid.pts ? 'desempate' : 'fora';
    // para ser Super precisa ser campeã do grupo E alcançar o melhor líder dos outros grupos
    const sup = camp === 'fora' ? 'fora' : (max >= g.melhorOutro ? (max > g.melhorOutro ? 'pode' : 'desempate') : 'fora');
    return { camp, super: sup, max };
}

const supTag = {
    garantido: '<span class="tag-sup ok">⭐ garantido</span>',
    lidera: '<span class="tag-sup lid">líder</span>',
    pode: '<span class="tag-sup lid">pode</span>',
    desempate: '<span class="tag-sup des">só no desempate</span>',
    fora: '<span class="tag-sup fora">sem chance</span>'
};

function supEtiquetaGrupo(S, g) {
    if (g.garantido) return '<span class="tag-sup ok">⭐ Super garantido</span>';
    if (g === S.lider) return '<span class="tag-sup lid">lidera a série</span>';
    if (!g.chance) return '<span class="tag-sup fora">fora da briga</span>';
    const d = S.lider.lid.pts - g.lid.pts;
    return `<span class="tag-sup lid">a ${d} pt${d === 1 ? '' : 's'}</span>`;
}

/* ---------- estado da última montagem (o drill lê daqui) ---------- */
let _supEstado = null;

/* ---------- box da página inicial: Super Campeões das séries + Distritais ---------- */
async function supPreencher(idBox, resumo, getRanking) {
    const el = document.getElementById(idBox);
    if (!el) return;
    let d;
    try { d = await campCarregar(); } catch (e) { return; }
    let proj = {};
    try {
        const rs = resumo && resumo.games ? resumo : await campResumoDaRodada();
        if (rs && rs.games && Number(rs.week) > Number(d.rodada)) proj = supProjPorLoja(rs.games);
    } catch (e) { proj = {}; }
    const gruposProj = supAplicar(d.grupos, proj);
    const series = supCalcular(d.grupos, gruposProj);
    if (!Object.keys(series).length) return;
    _supEstado = { series, d, projAtiva: Object.keys(proj).length > 0 };

    const cartoes = ['A', 'B', 'C', 'D'].filter(s => series[s]).map(s => {
        const S = series[s], L = S.lider;
        const e = d.loja[L.lid.time];
        return `<div class="sup-card">
            <div class="sup-top">Série ${s}<span>${supR(SUPER_PREMIO[s])}</span></div>
            <div class="sup-lider" onclick="supAbrirGrupo('${s}', ${L.n})" title="Ver as lojas do grupo ${L.n} que ainda têm chance">
                <span class="sup-est">⭐</span><b>${campEsc(L.lid.time)}</b>
                <small>Grupo ${L.n}${e ? ` · ${campEsc(e.distrito)} · ${campEsc(e.regional)}` : ''}</small>
                <small><b>${L.lid.pts} pts</b> oficial${_supEstado.projAtiva ? ` · <span class="tag-sup proj">${L.lidP.pts} projetado</span>` : ''}
                    ${L.garantido ? '<span class="tag-sup ok">⭐ Super garantido</span>' : ''}</small></div>
            <div class="sup-lista">${S.grupos.slice(1).map(g => `
                <div class="${g.chance ? '' : 'fora'} sup-linha" onclick="supAbrirGrupo('${s}', ${g.n})" title="Ver as lojas do grupo ${g.n} que ainda têm chance">
                    <span>G${g.n} · <b>${campEsc(g.lid.time)}</b></span><span>${g.lid.pts} pts ${supEtiquetaGrupo(S, g)} ▸</span></div>`).join('')}</div>
        </div>`;
    }).join('');

    let distHtml = '';
    try { distHtml = supDistritaisHTML(d, gruposProj, getRanking); } catch (e) { console.warn('super distrital', e); }

    el.innerHTML = `
    <section class="sup-box">
        <div class="sup-head">⭐ Super Campeões das séries
            <small>· o melhor entre os campeões de cada série (classificação oficial até a rodada ${d.rodada}${_supEstado.projAtiva ? ' + projeção da rodada em andamento' : ''})</small></div>
        <div class="sup-series">${cartoes}</div>
        <div class="sup-nota">Os líderes de cada grupo aparecem na ordem da corrida. Clique em um grupo para ver quais lojas dele ainda têm chance.
            “Fora da briga”: nenhuma loja do grupo alcança mais o líder atual dos outros grupos da série.</div>
    </section>${distHtml}`;
}

/* ---------- Super Campeão Distrital ---------- */
function supDistritaisHTML(d, gruposProj, getRanking) {
    if (typeof getRanking !== 'function') return '';
    const rk = getRanking();
    if (!rk || !rk.length) return '';
    // média de vitórias das lojas do distrito (desempate do regulamento): oficial e projetada
    const vit = {};
    const somar = (campo, grupos) => Object.values(grupos).forEach(ls => ls.forEach(r => {
        const dist = (d.loja[r.time] || {}).distrito;
        if (!dist) return;
        const x = (vit[dist] = vit[dist] || { v: 0, vp: 0, n: 0 });
        x[campo] += r.vit;
        if (campo === 'v') x.n++;
    }));
    somar('v', d.grupos); somar('vp', gruposProj);
    const linhas = rk.map(r => {
        const x = vit[r.distrito] || { v: 0, vp: 0, n: 1 };
        return { ...r, mediaVit: x.vp / (x.n || 1) };
    }).sort((a, b) => b.simAcum - a.simAcum || b.mediaVit - a.mediaVit || a.distrito.localeCompare(b.distrito));
    const pod = linhas.slice(0, 3);
    const medalha = ['🥇', '🥈', '🥉'];
    const mostrar = linhas.slice(0, 10);
    return `
    <section class="sup-box sup-dist">
        <div class="sup-head">🏅 Super Campeão Distrital <small>· maior média de pontos das lojas · 1º R$ 15.000 · 2º e 3º R$ 10.000</small></div>
        <div class="sup-pod">${pod.map((r, i) => `
            <div class="sup-pd p${i + 1}"><div class="m">${medalha[i]}</div><b>${campEsc(r.distrito)}</b>
                <small>${campEsc(r.regional)} · ${r.nLojas} lojas</small>
                <div class="v">${supF2(r.simAcum)}</div>
                <small>simulada · oficial: ${supF2(r.histAcum)}</small>
                <span class="pr">${supR(SUPER_PREMIO_DIST[i])}</span></div>`).join('')}</div>
        <div class="sup-tab"><table><thead><tr><th>#</th><th class="l">Distrito</th><th class="l">Regional</th>
            <th>Oficial</th><th>Simulada</th><th>Δ p/ 3º</th><th>Δ p/ 1º</th><th>Méd. vitórias</th></tr></thead><tbody>
            ${mostrar.map((r, i) => `<tr class="${i < 3 ? 'top' : ''}"><td>${i < 3 ? medalha[i] : (i + 1) + 'º'}</td>
                <td class="l">${campEsc(r.distrito)}</td><td class="l">${campEsc(r.regional)}</td>
                <td>${supF2(r.histAcum)}</td><td><b>${supF2(r.simAcum)}</b></td>
                <td>${i < 3 ? '—' : '-' + supF2(pod[2].simAcum - r.simAcum)}</td>
                <td>${i === 0 ? '—' : '-' + supF2(pod[0].simAcum - r.simAcum)}</td>
                <td>${supF2(r.mediaVit)}</td></tr>`).join('')}</tbody></table></div>
        <div class="sup-nota">Desempate (regulamento): média do número de vitórias das lojas do distrito. “Δ p/ 3º” é quanto falta para entrar no pódio.</div>
    </section>`;
}

// Prêmio do distrital por posição (1º R$ 15 mil, 2º e 3º R$ 10 mil), para a janela de simulação.
const supPremioDistrito = (pos) => SUPER_PREMIO_DIST[pos - 1] || 0;

/* ---------- drill: lojas do grupo que ainda têm chance ---------- */
function supAbrirGrupo(serie, n, todas) {
    if (!_supEstado) return;
    const S = _supEstado.series[serie];
    const g = S && S.grupos.find(x => x.n === n);
    if (!g) return;
    const d = _supEstado.d;
    const linhas = g.rows.map(r => ({ r, p: g.projPor[r.time] || r, st: supSituacaoLoja(S, g, r) }));
    const naBriga = linhas.filter(x => x.st.camp !== 'fora' || x.r.time === g.lid.time);
    const lista = todas ? linhas : naBriga;
    document.querySelectorAll('.sup-fundo').forEach(e => e.remove());
    const fundo = document.createElement('div');
    fundo.className = 'sup-fundo';
    fundo.innerHTML = `<div class="sup-modal" role="dialog" aria-modal="true">
        <div class="sup-m-topo"><b>⭐ Grupo ${n} · Série ${serie}</b>
            <small>Corrida do Super Campeão · prêmio ${supR(SUPER_PREMIO[serie])} · líder atual da série: ${campEsc(S.lider.lid.time)} (${S.lider.lid.pts} pts)</small>
            <button class="sup-x" title="Fechar">✕</button></div>
        <div class="sup-m-resumo">
            <span><b>${naBriga.length}</b> de ${linhas.length} lojas ainda podem ser campeãs do grupo</span>
            <span>Líder: <b>${campEsc(g.lid.time)}</b> · ${g.lid.pts} pts${_supEstado.projAtiva ? ` (projetado ${g.lidP.pts})` : ''}</span>
            <span>${supEtiquetaGrupo(S, g)}</span></div>
        <div class="sup-m-corpo"><table class="sup-m-tab"><thead><tr><th>#</th><th class="l">Loja</th><th class="l">Distrito</th>
            <th>Oficial</th><th>${_supEstado.projAtiva ? 'Projetada' : 'Jogos'}</th><th>Pts em jogo</th><th>Máx. possível</th><th>Campeã do grupo</th><th>Super Campeão</th></tr></thead><tbody>
            ${lista.map(({ r, p, st }, i) => {
                const e = d.loja[r.time];
                const eLider = r.time === g.lid.time;
                return `<tr class="${eLider ? 'lid' : ''}${st.camp === 'fora' ? ' fora' : ''}"><td>${g.rows.indexOf(r) + 1}</td>
                    <td class="l">${eLider ? '⭐ ' : ''}${campEsc(r.time)}</td><td class="l">${campEsc(e ? e.distrito : (typeof distritoDaLoja === 'function' ? (distritoDaLoja(r.time) || '') : ''))}</td>
                    <td>${r.pts}</td><td>${_supEstado.projAtiva ? `<b>${p.pts}</b>` : r.jogos}</td>
                    <td>${campRestam(r)}</td><td>${st.max}</td><td>${supTag[st.camp] || ''}</td><td>${supTag[st.super] || ''}</td></tr>`;
            }).join('')}</tbody></table></div>
        <div class="sup-m-rodape">
            ${linhas.length > naBriga.length ? `<button class="sup-ver" data-todas="${todas ? 0 : 1}">${todas ? 'Mostrar só quem tem chance' : `Mostrar todas as ${linhas.length} lojas`}</button>` : '<span></span>'}
            <small>“Pode” = o máximo que a loja ainda alcança supera o líder (do grupo ou o melhor líder dos outros grupos). “Só no desempate” = alcança a mesma pontuação.
                Máx. possível = pontos atuais + 3 por jogo que falta.</small></div></div>`;
    const sair = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') sair(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.classList.contains('sup-x')) sair();
        const v = e.target.closest('.sup-ver');
        if (v) { sair(); supAbrirGrupo(serie, n, v.dataset.todas === '1'); }
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);
}

/* ---------- tela de grupos: ⭐ no chip e faixa da corrida da série ---------- */
function supLideresDeSerie(grupos) {
    const series = supCalcular(grupos, grupos);
    const lid = {};
    Object.values(series).forEach(S => { lid[S.lider.nome] = S.serie; });
    return lid;     // { 'Série C - Grupo 8': 'C' }
}

function supFaixaGrupo(nomeGrupo, grupos, gruposProj) {
    const series = supCalcular(grupos, gruposProj || grupos);
    const sm = String(nomeGrupo).match(/S[ée]rie\s+([A-D])/i);
    if (!sm) return '';
    const S = series[sm[1].toUpperCase()];
    if (!S) return '';
    _supEstado = { series, d: _supEstado ? _supEstado.d : { loja: {} }, projAtiva: !!gruposProj && gruposProj !== grupos };
    const proj = _supEstado.projAtiva;
    return `<div class="sup-faixa">
        <div class="sup-f-tit">⭐ Corrida do Super Campeão · Série ${S.serie} <span class="sup-f-premio">${supR(SUPER_PREMIO[S.serie])}</span></div>
        <div class="sup-tab"><table><thead><tr><th>#</th><th class="l">Grupo</th><th class="l">Líder</th><th>Oficial</th>${proj ? '<th>Projetada</th>' : ''}
            <th>Δ p/ 1º</th><th>Pts em jogo</th><th>Situação</th><th></th></tr></thead><tbody>
            ${S.grupos.map((g, i) => `<tr class="${g.nome === nomeGrupo ? 'sel' : ''}${i === 0 ? ' top' : ''}">
                <td>${i + 1}º</td><td class="l">G${g.n}</td><td class="l">${i === 0 ? '⭐ ' : ''}${campEsc(g.lid.time)}</td><td>${g.lid.pts}</td>${proj ? `<td><b>${g.lidP.pts}</b></td>` : ''}
                <td>${i === 0 ? '—' : '-' + (S.lider.lid.pts - g.lid.pts)}</td><td>${g.rest}</td><td>${supEtiquetaGrupo(S, g)}</td>
                <td><button class="sup-ver" onclick="supAbrirGrupo('${S.serie}', ${g.n})">lojas na briga ▸</button></td></tr>`).join('')}</tbody></table></div></div>`;
}
