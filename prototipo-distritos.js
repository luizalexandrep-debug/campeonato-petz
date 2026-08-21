// ============================================================
// PROTÓTIPO — jogos do distrito na rodada
// Pensa a regional como um time só: ao abrir um distrito concorrente, mostra
// todos os jogos dele na rodada e destaca os que são contra lojas da minha
// regional, que é onde dá para tirar pontos dele.
// ============================================================

const pd = { semana: null, estrutura: {}, summary: null, ordem: 'media' };
const REGIONAL_DESTAQUE = 'R2 - Luiz';

const pegar = (p) => fetch(`/api${p}`, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
});

function info(html) { document.getElementById('infoBar').innerHTML = `<span>${html}</span>`; }

function semResultado(j) {
    return !!(j && j.semDados) || !!(pd.summary && pd.summary.semDadosAtual);
}

async function iniciar() {
    try {
        const sem = await pegar('/semana');
        pd.semana = sem.semana;
        const [est, sum] = await Promise.all([
            pegar('/estrutura'), pegar(`/games-summary/${pd.semana}`)
        ]);
        pd.estrutura = est.estrutura || est;
        pd.summary = sum;
        render();
    } catch (e) {
        console.error(e);
        info(`❌ Erro ao iniciar: ${e.message}`);
    }
}

// Desempenho de cada distrito na rodada, a partir do resumo dos jogos.
function distritosDaRodada() {
    const jogos = pd.summary?.games || [];
    const linhas = [];
    Object.entries(pd.estrutura).forEach(([reg, dists]) => {
        Object.entries(dists).forEach(([dist, lojas]) => {
            let V = 0, E = 0, D = 0, conq = 0, disp = 0, contraMim = 0;
            jogos.forEach(g => {
                [[g.team1, 1], [g.team2, 2]].forEach(([loja, num]) => {
                    if (!lojas.includes(loja)) return;
                    const [a, b] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
                    const meu = num === 1 ? a : b, adv = num === 1 ? b : a;
                    const outra = num === 1 ? g.team2 : g.team1;
                    disp += 3;
                    if (semResultado(g)) return;
                    if (meu > adv) { V++; conq += 3; } else if (meu === adv) { E++; conq += 1; } else D++;
                    if (lojaRegional(outra) === REGIONAL_DESTAQUE) contraMim++;
                });
            });
            const jogosTotal = V + E + D;
            linhas.push({
                reg, dist, lojas: lojas.length, V, E, D, conq, disp, contraMim,
                media: jogosTotal ? conq / jogosTotal : 0,
                aprov: disp ? conq / disp * 100 : 0
            });
        });
    });
    return linhas.sort((a, b) => b.media - a.media || b.conq - a.conq);
}

let _lojaReg = null;
function lojaRegional(loja) {
    if (!_lojaReg) {
        _lojaReg = {};
        Object.entries(pd.estrutura).forEach(([reg, dists]) =>
            Object.values(dists).forEach(ls => ls.forEach(l => { _lojaReg[l] = reg; })));
    }
    return _lojaReg[loja];
}

function render() {
    const linhas = distritosDaRodada();
    const f2 = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fp = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    const medalha = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
    const esc = (s) => s.replace(/'/g, "\\'");

    const corpo = linhas.map((r, i) => `
        <tr class="${r.reg === REGIONAL_DESTAQUE ? 'dest' : ''}">
            <td class="c b">${medalha(i)}</td>
            <td class="l"><span class="dist-link" title="Ver os jogos do distrito"
                onclick="abrirJogosDistrito('${esc(r.reg)}','${esc(r.dist)}')">${r.dist}</span></td>
            <td class="l reg">${r.reg}</td>
            <td class="c">${r.V}</td><td class="c">${r.E}</td><td class="c">${r.D}</td>
            <td class="c b">${f2(r.media)}</td>
            <td class="c">${r.conq}/${r.disp}</td>
            <td class="c b">${fp(r.aprov)}</td>
            <td class="c">${r.contraMim || '—'}</td>
        </tr>`).join('');

    document.getElementById('painel').innerHTML = `
    <div class="quadro-lista">
        <div class="quadro-head">📅 Distritos na rodada ${pd.semana} <small>· clique no nome para abrir os jogos</small></div>
        <div class="tbl-wrap"><table class="tab-dist">
            <thead><tr>
                <th class="c">#</th><th class="l">Distrito</th><th class="l">Regional</th>
                <th class="c">V</th><th class="c">E</th><th class="c">D</th>
                <th class="c">Média</th><th class="c">Pontos</th><th class="c">% Aprov.</th>
                <th class="c" title="Jogos contra lojas da sua regional nesta rodada">vs ${REGIONAL_DESTAQUE.split(' - ')[0]}</th>
            </tr></thead>
            <tbody>${corpo}</tbody>
        </table></div>
    </div>`;

    info(`📊 ${linhas.length} distritos · rodada ${pd.semana}`);
}

// ============================================================
// JANELA "JOGOS DO DISTRITO NA RODADA"
// Pensando a regional como um time só: mostra todos os jogos que um distrito
// disputa na rodada e destaca os que são contra lojas da minha regional —
// são neles que dá para tirar pontos de um concorrente direto.
// ============================================================

function abrirJogosDistrito(regional, distrito) {
    const lojas = (pd.estrutura?.[regional]?.[distrito]) || [];
    const jogos = (pd.summary?.games || [])
        .filter(g => lojas.includes(g.team1) || lojas.includes(g.team2));

    // loja -> regional, para saber quem é adversário da minha regional
    const lojaReg = {};
    Object.entries(pd.estrutura || {}).forEach(([reg, dists]) =>
        Object.values(dists).forEach(ls => ls.forEach(l => { lojaReg[l] = reg; })));

    const linhas = jogos.map(g => {
        const minha = lojas.includes(g.team1) ? g.team1 : g.team2;
        const adv = minha === g.team1 ? g.team2 : g.team1;
        const [a, b] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        const gm = minha === g.team1 ? a : b;
        const gs = minha === g.team1 ? b : a;
        const sem = semResultado(g);
        return {
            minha, adv, gm, gs, sem,
            advRegional: lojaReg[adv] || '—',
            contraMim: lojaReg[adv] === REGIONAL_DESTAQUE,
            pts: sem ? 0 : (gm > gs ? 3 : gm === gs ? 1 : 0),
            resultado: sem ? 'sem' : gm > gs ? 'v' : gm < gs ? 'd' : 'e'
        };
    });

    // primeiro os jogos contra a minha regional, e dentro deles os que ainda
    // dão para virar (onde o distrito adversário está ganhando)
    const ordem = { d: 0, e: 1, v: 2, sem: 3 };
    linhas.sort((x, y) => (y.contraMim - x.contraMim)
        || (ordem[y.resultado] - ordem[x.resultado])
        || x.minha.localeCompare(y.minha));

    const contra = linhas.filter(l => l.contraMim);
    const ptsDele = linhas.reduce((t, l) => t + l.pts, 0);
    const emRisco = contra.reduce((t, l) => t + l.pts, 0);
    const conta = (r) => linhas.filter(l => l.resultado === r).length;

    const rotulo = { v: 'VENCENDO', e: 'EMPATANDO', d: 'PERDENDO', sem: 'SEM DADOS' };

    const corpo = linhas.map(l => `
        <tr class="${l.contraMim ? 'contra-minha' : ''}">
            <td class="l"><b>${l.minha}</b></td>
            <td class="c placar ${l.resultado}">${l.gm} × ${l.gs}</td>
            <td class="l"><b>${l.adv}</b>
                ${l.contraMim ? '<span class="tag-minha">sua regional</span>'
                    : `<small>${l.advRegional}</small>`}</td>
            <td class="c"><span class="res ${l.resultado}">${rotulo[l.resultado]}</span></td>
            <td class="c b">${l.sem ? '—' : '+' + l.pts}</td>
        </tr>`).join('');

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-dist">
            <div class="modal-head">
                <div class="md-titulo">
                    <b>${distrito}</b>
                    <small>${regional} · ${lojas.length} lojas · rodada ${pd.semana}</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo">
                <div class="md-resumo">
                    <div class="md-card"><span>${conta('v')}</span>vencendo</div>
                    <div class="md-card"><span>${conta('e')}</span>empatando</div>
                    <div class="md-card"><span>${conta('d')}</span>perdendo</div>
                    <div class="md-card total"><span>${ptsDele}</span>pontos na rodada</div>
                </div>
                ${contra.length ? `
                <div class="md-alvo">
                    <b>⚔ ${contra.length} jogo(s) contra a ${REGIONAL_DESTAQUE}</b>
                    — hoje eles somam <b>${emRisco} ponto(s)</b> para o ${distrito}.
                    ${emRisco > 0
                        ? `Virar esses jogos tira até <b>${emRisco} ponto(s)</b> dele.`
                        : 'Sua regional já está segurando todos eles.'}
                </div>` : `<div class="md-alvo neutro">
                    Nenhum jogo contra a ${REGIONAL_DESTAQUE} nesta rodada — só dá para
                    ganhar terreno pontuando mais nos jogos das suas lojas.</div>`}
                <table class="md-tabela">
                    <thead><tr>
                        <th class="l">Loja do ${distrito}</th><th class="c">Placar</th>
                        <th class="l">Adversário</th><th class="c">Situação</th><th class="c">Pts</th>
                    </tr></thead>
                    <tbody>${corpo}</tbody>
                </table>
            </div>
        </div>`;

    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}
