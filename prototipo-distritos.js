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

    const souEu = regional === REGIONAL_DESTAQUE;
    const contra = linhas.filter(l => l.contraMim);
    const ptsDele = linhas.reduce((t, l) => t + l.pts, 0);
    const emRisco = contra.reduce((t, l) => t + l.pts, 0);
    const conta = (r) => linhas.filter(l => l.resultado === r).length;

    const rotulo = { v: 'VENCENDO', e: 'EMPATANDO', d: 'PERDENDO', sem: 'SEM DADOS' };

    // A cor mostra o SEU interesse. Se o distrito é adversário, a vitória dele
    // é ruim para você — então sai em vermelho, e a derrota dele em verde.
    const corDe = (res) => {
        if (res === 'sem' || res === 'e') return res;
        if (souEu) return res;
        return res === 'v' ? 'd' : 'v';        // inverte para a ótica da R2
    };

    const corpo = linhas.map((l, i) => `
        <tr class="${l.contraMim ? 'contra-minha' : ''} linha-jogo"
            onclick="abrirDetalhesJogo('${l.minha}','${l.adv}')" title="Ver os gols deste jogo">
            <td class="l"><b>${l.minha}</b></td>
            <td class="c placar ${corDe(l.resultado)}">${l.gm} × ${l.gs}</td>
            <td class="l"><b>${l.adv}</b>
                ${l.contraMim ? '<span class="tag-minha">sua regional</span>'
                    : `<small>${l.advRegional}</small>`}</td>
            <td class="c"><span class="res ${corDe(l.resultado)}">${rotulo[l.resultado]}</span></td>
            <td class="c b">${l.sem ? '—' : '+' + l.pts}</td>
            <td class="c lupa">🔍</td>
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
                    <div class="md-card ${souEu ? 'bom' : 'ruim'}"><span>${conta('v')}</span>vencendo</div>
                    <div class="md-card"><span>${conta('e')}</span>empatando</div>
                    <div class="md-card ${souEu ? 'ruim' : 'bom'}"><span>${conta('d')}</span>perdendo</div>
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
                <div class="md-legenda">
                    ${souEu ? 'Cores na ótica das suas lojas: verde é bom para você.'
                        : `Cores na <b>sua ótica</b>: como o ${distrito} é adversário,
                           o que é <span class="res d">bom para ele</span> aparece em vermelho e
                           o que é <span class="res v">ruim para ele</span> aparece em verde.`}
                    Clique em qualquer jogo para ver os gols.
                </div>
                <table class="md-tabela">
                    <thead><tr>
                        <th class="l">Loja do ${distrito}</th><th class="c">Placar</th>
                        <th class="l">Adversário</th><th class="c">Situação</th><th class="c">Pts</th>
                        <th class="c"></th>
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


// Cache das leituras de loja, para reabrir o mesmo jogo sem esperar de novo.
const _cacheDias = new Map();

function buscarDias(loja) {
    const chave = `${loja}/${pd.semana}`;
    if (!_cacheDias.has(chave)) {
        _cacheDias.set(chave, pegar(`/loja-dias/${loja}/${pd.semana}`)
            .catch(e => { _cacheDias.delete(chave); throw e; }));
    }
    return _cacheDias.get(chave);
}

const DIAS_JOGO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const CHAVE_TOTAL = '__total__';

function evolucaoPct(anterior, atual) {
    if (anterior === 0) return 0;
    if (atual === 0) return 0;
    return (atual - anterior) / anterior * 100;
}

function agregarPct(diasObj) {
    const o = diasObj || {};
    if (o[CHAVE_TOTAL]) return o[CHAVE_TOTAL];
    const vals = DIAS_JOGO.map(d => o[d] || 0).filter(v => v);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function fmtValor(v, tipo) {
    return tipo === '%'
        ? (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
        : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

async function abrirDetalhesJogo(loja, adv) {
    const jogo = (pd.summary?.games || []).find(g =>
        (g.team1 === loja && g.team2 === adv) || (g.team1 === adv && g.team2 === loja));
    const [a, b] = (jogo?.scoreProjected || '0 x 0').split('x').map(v => parseInt(v.trim()));
    const placar = jogo && jogo.team1 === loja ? `${a} × ${b}` : `${b} × ${a}`;

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-jogo">
            <div class="modal-head">
                <div class="times">
                    <span class="t">${loja}</span>
                    <span class="placar"><small>Placar Projetado</small><b>${placar}</b>
                        <small>rodada ${pd.semana}</small></span>
                    <span class="t">${adv}</span>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo"><div class="carregando">⏳ Carregando indicadores...</div></div>
        </div>`;

    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
        if (e.target === fundo || e.target.hasAttribute('data-fechar')) fechar();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);

    let d1, d2;
    try {
        [d1, d2] = await Promise.all([buscarDias(loja), buscarDias(adv)]);
    } catch (e) {
        const c = fundo.querySelector('.modal-corpo');
        if (c) c.innerHTML = '<div class="carregando">❌ Não foi possível carregar os indicadores.</div>';
        return;
    }

    const corpo = fundo.querySelector('.modal-corpo');
    if (!corpo) return;   // fechado antes de carregar
    corpo.innerHTML = Object.keys(d1.dados).map(ind => `
        <div class="tables-wrapper">
            ${tabelaIndicadorJogo(loja, d1.dados[ind], ind, d2.dados[ind])}
            ${tabelaIndicadorJogo(adv, d2.dados[ind], ind, d1.dados[ind])}
        </div>`).join('');
}

function tabelaIndicadorJogo(loja, dados, indicador, adversario) {
    if (!dados) return '<div class="table-container"><div class="table-title">Sem dados</div></div>';

    const tipo = dados.atual?.type || dados.anterior?.type || 'R$';
    const ehPct = tipo === '%';
    const f = (v) => fmtValor(v, tipo);
    const ant = dados.anterior?.dias || {};
    const atu = dados.atual?.dias || {};
    const agregar = (o) => ehPct ? agregarPct(o) : DIAS_JOGO.reduce((t, d) => t + ((o || {})[d] || 0), 0);
    const usaTotal = ehPct && !!(atu[CHAVE_TOTAL] || ant[CHAVE_TOTAL]);

    const linhas = DIAS_JOGO.map(dia => {
        const a = ant[dia] || 0, b = atu[dia] || 0;
        const ev = evolucaoPct(a, b);
        const cls = ev > 0 ? 'positive' : ev < 0 ? 'negative' : 'neutral';
        return `<tr><td class="day-label">${dia}</td>
            <td class="value-anterior">${f(a)}</td>
            <td class="value-atual">${f(b)}</td>
            <td class="evolution ${cls}">${ev.toFixed(2)}%</td></tr>`;
    }).join('');

    const tA = agregar(ant), tB = agregar(atu);
    const evo = evolucaoPct(tA, tB);
    let classe = evo > 0 ? 'positive' : evo < 0 ? 'negative' : 'neutral';
    let falta = null;
    if (adversario) {
        const evoAdv = evolucaoPct(agregar(adversario.anterior?.dias), agregar(adversario.atual?.dias));
        if (evo > evoAdv) classe = 'evolution-melhor';
        else if (evo < evoAdv) {
            classe = 'evolution-pior';
            if (tA > 0) {
                const n = tA * (1 + evoAdv / 100) - tB;
                if (n > 0) falta = n;
            }
        }
    }

    return `<div class="table-container">
        <div class="table-title"><span class="tt-loja">${loja}</span><span class="tt-ind">${indicador.replace(/\.xlsx$/i, '')}</span></div>
        <table>
            <thead><tr><th>Dia</th><th>S. Anterior</th><th>S. Atual</th><th>Evolução</th></tr></thead>
            <tbody>
                ${linhas}
                <tr class="total-row">
                    <td class="day-label">${ehPct && !usaTotal ? 'MÉDIA' : 'TOTAL'}</td>
                    <td style="text-align:center">${f(tA)}</td>
                    <td style="text-align:center">${f(tB)}</td>
                    <td class="evolution ${classe}" style="text-align:center">${evo.toFixed(2)}%</td>
                </tr>
                ${falta !== null ? `<tr><td colspan="3" style="background:#fff3cd;color:#6b4d00;font-size:.85em">Falta p/ virar</td>
                    <td style="background:#fff3cd;color:#6b4d00;font-weight:800;text-align:center">+${f(falta)}</td></tr>` : ''}
            </tbody>
        </table></div>`;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}
