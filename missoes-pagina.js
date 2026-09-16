// ============================================================
// Página Missões da Semana
//
// Os jogos marcados com o sino, separados por distrital, com o placar projetado
// e se a missão está sendo cumprida. Todos os usuários veem todas as missões.
// ============================================================

const pg = { semana: null, estrutura: {}, jogos: [], semDados: false };

// missoes.js usa isto para remover e recarregar a partir desta página.
window.missoesCtx = {
    semana: () => pg.semana,
    jogos: () => pg.jogos,
    estrutura: () => pg.estrutura,
    redesenhar: () => misDesenhar()
};

async function misIniciar() {
    const sem = await misApi('/semana');
    pg.semana = sem.semana;
    const sel = document.getElementById('fRodada');
    sel.innerHTML = (sem.disponiveis || [sem.semana]).slice().reverse()
        .map(n => `<option value="${n}" ${n === sem.semana ? 'selected' : ''}>Rodada ${n}${
            n === sem.semana ? ' (atual)' : ''}</option>`).join('');
    sel.onchange = () => { pg.semana = parseInt(sel.value, 10); misCarregar(); };
    const est = await misApi('/estrutura');
    pg.estrutura = est.estrutura || est;
    await misCarregar();
}

async function misCarregar() {
    document.getElementById('lista').innerHTML =
        '<div class="info-bar"><span>Carregando as missões...</span></div>';
    const [resumo] = await Promise.all([
        misApi(`/games-summary/${pg.semana}`).catch(() => ({ games: [] })),
        missoesCarregar(pg.semana),
        psCarregar(pg.semana)
    ]);
    pg.resumo = resumo;
    pg.jogos = resumo.games || [];
    pg.semDados = !!resumo.semDadosAtual;
    misDesenhar();
}

/* Situação de uma missão pelo placar projetado da loja dona dela. */
function misSituacao(m) {
    const g = pg.jogos.find(j => j.team1 === m.loja || j.team2 === m.loja);
    if (!g) return { estado: 'sem', placar: '—', rotulo: 'Sem jogo nesta rodada' };
    const [a, b] = String(g.scoreProjected || '0 x 0').split('x').map(v => parseInt(v.trim(), 10) || 0);
    const [gm, gs] = g.team1 === m.loja ? [a, b] : [b, a];
    if (pg.semDados) return { estado: 'sem', placar: '– × –', rotulo: 'Aguardando vendas da semana', gm, gs };
    const ok = m.criterio === 'nao_perder' ? gm >= gs : gm > gs;
    const res = gm > gs ? 'vencendo' : gm === gs ? 'empatando' : 'perdendo';
    return { estado: ok ? 'ok' : 'nao', placar: `${gm} × ${gs}`, res, gm, gs,
             rotulo: ok ? 'Cumprindo a missão' : 'Não está cumprindo' };
}

function misDesenhar() {
    const lista = Object.values(missoes.porLoja);
    document.getElementById('subtitulo').textContent =
        `Rodada ${pg.semana} · jogos marcados com 🔔 na classificação por grupos`;

    if (!lista.length) {
        document.getElementById('placarGeral').innerHTML = '';
        document.getElementById('lista').innerHTML = `<div class="info-bar"><span>
            Nenhuma missão na rodada ${pg.semana}. Marque jogos importantes clicando no 🔔
            ao lado da sigla, na tabela simulada da <a href="/grupos.html">classificação por grupos</a>.
            </span></div>`;
        return;
    }

    const comSit = lista.map(m => ({ m, s: misSituacao(m) }));
    const n = (e) => comSit.filter(x => x.s.estado === e).length;
    document.getElementById('placarGeral').innerHTML = `
        <div class="mis-resumo">
            <div class="mis-card ok"><span>${n('ok')}</span>cumprindo</div>
            <div class="mis-card nao"><span>${n('nao')}</span>não cumprindo</div>
            ${n('sem') ? `<div class="mis-card sem"><span>${n('sem')}</span>aguardando</div>` : ''}
            <div class="mis-card total"><span>${lista.length}</span>missões</div>
        </div>`;

    // Agrupa por distrital; dentro, as que não estão cumprindo primeiro.
    const porDist = {};
    comSit.forEach(x => (porDist[x.m.distrito || 'Sem distrito'] ||= []).push(x));
    const ordem = { nao: 0, sem: 1, ok: 2 };
    const blocos = Object.entries(porDist)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dist, itens]) => {
            itens.sort((x, y) => ordem[x.s.estado] - ordem[y.s.estado] || x.m.loja.localeCompare(y.m.loja));
            const ok = itens.filter(x => x.s.estado === 'ok').length;
            return `<section class="mis-dist">
                <div class="mis-dist-head">
                    <b>${dist}</b>
                    <span class="mis-dist-cont">${ok} de ${itens.length} cumprindo</span>
                </div>
                ${itens.map(({ m, s }) => `
                <div class="mis-item ${s.estado}" role="button" tabindex="0"
                     title="Ver os gols deste jogo"
                     onclick="misVerGols('${m.loja}','${m.adversario || ''}')"
                     onkeydown="if(event.key==='Enter')misVerGols('${m.loja}','${m.adversario || ''}')">
                    <div class="mis-jogo">
                        <span class="mis-loja">${m.loja}${asteriscoMudanca(m.loja, pg.estrutura)}</span>
                        <span class="mis-placar">${s.placar}</span>
                        <span class="mis-adv">${m.adversario || ''}</span>
                    </div>
                    <div class="mis-meta">Meta: <b>${m.criterio === 'nao_perder' ? 'não perder' : 'vencer'}</b>
                        ${m.criadoPor ? `<small>· marcada por ${m.criadoPor}</small>` : ''}</div>
                    <div class="mis-status">${s.estado === 'ok' ? '✅' : s.estado === 'nao' ? '❌' : '⏳'}
                        ${s.rotulo}${s.res && s.estado !== 'sem' ? ` <small>(${s.res})</small>` : ''}</div>
                    <button class="mis-remover" title="Remover missão"
                        onclick="event.stopPropagation(); misRemover(${m.id})">✕</button>
                </div>`).join('')}
            </section>`;
        }).join('');
    document.getElementById('lista').innerHTML = `<div class="mis-grid">${blocos}</div>`;
}

/* Detalhe dos gols na própria página, com a mesma janela da classificação por
   grupos (grupos.js carregado em modo embutido). Ela lê tudo de `st`, então
   preenchemos com a rodada que está em tela. */
function misVerGols(loja, adv) {
    if (!adv) return;
    st.semana = pg.semana;
    st.summary = pg.resumo;
    st.estrutura = pg.estrutura;
    st._distDaLoja = null;
    st.projAtual = projecaoDaRodada().proj;
    abrirDetalhesJogo(loja);
}

async function misRemover(id) {
    if (!confirm('Remover esta missão?')) return;
    try {
        await misApi(`/missoes/${id}`, { method: 'DELETE' });
        await missoesCarregar(pg.semana);
        misDesenhar();
    } catch (e) { alert(e.message); }
}

misIniciar().catch(e => {
    document.getElementById('lista').innerHTML =
        `<div class="info-bar"><span>❌ Não foi possível misCarregar (${e.message}).</span></div>`;
});
