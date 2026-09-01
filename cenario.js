/* ==========================================================================
   Cenário de eliminação — "e se estas lojas forem eliminadas?"

   Reproduz o que aconteceu com o W3NT-DF: a loja eliminada perde 0 x 6 em
   TODAS as rodadas, inclusive as já disputadas, e cada adversário recebe de
   volta os pontos daqueles jogos. Por isso o cenário mexe em duas frentes:

     1. a rodada em curso  -> o jogo vira 6 x 0 para quem enfrenta a eliminada
     2. o acumulado        -> refaz os jogos passados contra ela

   Nada é gravado: é só uma simulação em cima dos dados já carregados. Desligar
   o botão devolve os números reais.
   ========================================================================== */

const CENARIO_PADRAO = ['BTIM-MG', 'SMBA-DF', 'ASTS-SP', 'SCBA-SP', 'ACLR-DF', 'JPES-PB'];

const cen = {
    ligado: false,
    ativas: new Set(CENARIO_PADRAO),
    busca: '',
    historico: null,     // /api/historico-lojas, para refazer o acumulado
    painel: null
};

function cenSet() {
    return cen.ligado ? cen.ativas : new Set();
}

/* ---------- adaptador por página ---------- */

function cenCtx() {
    const ehGrupos = typeof st !== 'undefined' && st && st.grupos;
    if (ehGrupos) {
        return {
            pagina: 'grupos',
            jogos: () => st.summary?.games || [],
            setJogos: (js) => { if (st.summary) st.summary.games = js; },
            estrutura: () => st.estrutura || {},
            redesenhar: () => { _cacheDias.clear(); render(); }
        };
    }
    return {
        pagina: 'dashboard',
        jogos: () => state.gamesSummary?.games || [],
        setJogos: (js) => { if (state.gamesSummary) state.gamesSummary.games = js; },
        estrutura: () => state.estrutura || {},
        redesenhar: () => loadRankingDashboard()
    };
}

/* ---------- 1. a rodada em curso ---------- */

function cenTransformarJogos(jogos) {
    const el = cenSet();
    if (!el.size) return jogos;
    return jogos.map(g => {
        const e1 = el.has(g.team1), e2 = el.has(g.team2);
        if (!e1 && !e2) return g;
        // Duas eliminadas jogando entre si: ninguém pontua.
        const [a, b] = (e1 && e2) ? [0, 0] : (e1 ? [0, 6] : [6, 0]);
        const dono = (e1 && e2) ? 0 : (e1 ? 2 : 1);
        const gols = {};
        Object.keys(g.golsProjetados || {}).forEach(k => { gols[k] = dono; });
        return {
            ...g,
            scoreProjected: `${a} x ${b}`,
            scoreAccumulated: `${a} x ${b}`,
            golsProjetados: gols,
            golsAcumulados: gols,
            cenario: true
        };
    });
}

/* ---------- 2. o acumulado (rodadas já disputadas) ---------- */

// Devolve {sigla: {pts, vit, emp, der, gm, gs}} com o que muda no acumulado.
function cenAjustesBase() {
    const el = cenSet();
    const hist = cen.historico?.lojas;
    if (!el.size || !hist) return {};
    const pontos = (gm, gs) => gm > gs ? 3 : (gm === gs ? 1 : 0);
    const aj = {};
    Object.entries(hist).forEach(([loja, jogos]) => {
        const a = { pts: 0, vit: 0, emp: 0, der: 0, gm: 0, gs: 0 };
        if (el.has(loja)) {
            // Eliminada: 0 x 6 em tudo, zerando pontos e gols marcados.
            jogos.forEach(j => {
                a.pts -= pontos(j.gm, j.gs);
                a.gm -= j.gm;
                a.gs += 6 - j.gs;
                a.vit -= j.gm > j.gs ? 1 : 0;
                a.emp -= j.gm === j.gs ? 1 : 0;
                a.der += 1 - (j.gm < j.gs ? 1 : 0);
            });
        } else {
            // Adversário: os jogos contra a eliminada viram 6 x 0.
            jogos.forEach(j => {
                if (!el.has(j.adv)) return;
                a.pts += 3 - pontos(j.gm, j.gs);
                a.gm += 6 - j.gm;
                a.gs += 0 - j.gs;
                a.vit += 1 - (j.gm > j.gs ? 1 : 0);
                a.emp -= j.gm === j.gs ? 1 : 0;
                a.der -= j.gm < j.gs ? 1 : 0;
            });
        }
        if (Object.values(a).some(v => v !== 0)) aj[loja] = a;
    });
    return aj;
}

// Aplica os ajustes a uma linha da classificação por loja.
function cenAjustarLinha(r) {
    const a = (cen._ajustes || {})[r.time];
    if (!a) return r;
    const gm = r.gm + a.gm, gs = r.gs + a.gs;
    return { ...r, pts: r.pts + a.pts, vit: r.vit + a.vit, emp: r.emp + a.emp,
             der: r.der + a.der, gm, gs, sg: gm - gs, cenario: true };
}

// Ajuste do acumulado por DISTRITO, na escala do ranking (pontos ÷ nº lojas).
function cenAjustePorDistrito() {
    const aj = cen._ajustes || {};
    const out = {};
    Object.values(cenCtx().estrutura()).forEach(dists =>
        Object.entries(dists).forEach(([dist, lojas]) => {
            const soma = lojas.reduce((t, l) => t + (aj[l]?.pts || 0), 0);
            const somaVit = lojas.reduce((t, l) => t + (aj[l]?.vit || 0), 0);
            if (soma || somaVit) out[dist] = { pts: soma / lojas.length, vit: somaVit / lojas.length };
        }));
    return out;
}

/* ---------- ligar/desligar ---------- */

async function cenAplicar() {
    const ctx = cenCtx();
    if (cen.ligado && !cen.historico) {
        try { cen.historico = await pegarHistoricoLojas(); }
        catch (e) { console.warn('histórico indisponível para o cenário', e); }
    }
    cen._ajustes = cenAjustesBase();

    if (!cen._jogosReais) cen._jogosReais = ctx.jogos();
    ctx.setJogos(cen.ligado ? cenTransformarJogos(cen._jogosReais) : cen._jogosReais);

    ctx.redesenhar();
    cenAtualizarBotao();
}

async function pegarHistoricoLojas() {
    const r = await fetch('/api/historico-lojas', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

function cenAtualizarBotao() {
    const b = document.getElementById('btCenario');
    if (!b) return;
    b.classList.toggle('on', cen.ligado);
    const n = cen.ativas.size;
    b.innerHTML = cen.ligado
        ? `🧪 Cenário ativo · ${n} loja${n === 1 ? '' : 's'}`
        : '🧪 Simular eliminação';
    let faixa = document.getElementById('cenFaixa');
    if (cen.ligado) {
        if (!faixa) {
            faixa = document.createElement('div');
            faixa.id = 'cenFaixa';
            faixa.className = 'cen-faixa';
            document.querySelector('.container')?.prepend(faixa);
        }
        faixa.innerHTML = `<b>🧪 SIMULAÇÃO</b> — os números abaixo consideram
            ${[...cen.ativas].sort().join(', ')} eliminada${cen.ativas.size === 1 ? '' : 's'}
            (0 x 6 em todas as rodadas, inclusive as já disputadas).
            <button onclick="cenDesligar()">desligar</button>`;
    } else if (faixa) {
        faixa.remove();
    }
}

function cenDesligar() {
    cen.ligado = false;
    cenAplicar();
    cenFecharPainel();
}

/* ---------- painel de seleção ---------- */

function cenAbrirPainel() {
    if (cen.painel) { cenFecharPainel(); return; }
    const el = document.createElement('div');
    el.className = 'cen-painel';
    el.innerHTML = `
        <div class="cen-cx">
            <div class="cen-topo">
                <b>🧪 Simular eliminação</b>
                <button class="cen-x" onclick="cenFecharPainel()">✕</button>
            </div>
            <div class="cen-nota">Marque as lojas a eliminar. Todos os jogos contra elas
                viram <b>6 x 0</b>, nas rodadas passadas e na atual — como aconteceu com o W3NT-DF.</div>
            <input class="cen-busca" type="search" placeholder="Buscar loja, distrito ou regional…"
                   oninput="cenBuscar(this)" value="${cen.busca}">
            <div class="cen-lista">${cenItensHTML()}</div>
            <div class="cen-rodape">
                <span class="cen-conta"></span>
                <button class="cen-limpar" onclick="cenLimpar()">Desmarcar todas</button>
            </div>
            <div class="cen-acoes">
                <button class="cen-bt aplicar" onclick="cenLigar()">Aplicar cenário</button>
                <button class="cen-bt" onclick="cenDesligar()">Voltar ao real</button>
            </div>
        </div>`;
    document.body.appendChild(el);
    cen.painel = el;
    cenContador();
    const busca = el.querySelector('.cen-busca');
    if (busca) busca.focus();
}

/* Todas as lojas do campeonato, tiradas da estrutura já carregada na página.
   As marcadas sobem para o topo para não sumirem no meio das 266. */
function cenTodasLojas() {
    const ctx = cenCtx();
    const todas = new Set(cen.ativas);
    // Os confrontos da rodada são a lista exata de quem disputa o campeonato.
    // A estrutura tem algumas unidades a mais (e às vezes uma a menos), então
    // ela só entra como reserva, quando os jogos ainda não carregaram.
    const jogos = ctx.jogos() || [];
    if (jogos.length) {
        jogos.forEach(j => { todas.add(j.team1); todas.add(j.team2); });
    } else {
        for (const dists of Object.values(ctx.estrutura() || {})) {
            for (const lojas of Object.values(dists || {})) {
                (lojas || []).forEach(l => todas.add(l));
            }
        }
    }
    return [...todas].sort((a, b) => {
        const ma = cen.ativas.has(a), mb = cen.ativas.has(b);
        if (ma !== mb) return ma ? -1 : 1;
        return a.localeCompare(b);
    });
}

function cenItensHTML() {
    const termo = cen.busca.trim().toUpperCase();
    const lista = cenTodasLojas().filter(l =>
        !termo || l.toUpperCase().includes(termo) || cenOnde(l).toUpperCase().includes(termo));
    if (!lista.length) return '<div class="cen-vazio">Nenhuma loja encontrada.</div>';
    return lista.map(l => `
        <label class="cen-item">
            <input type="checkbox" value="${l}" ${cen.ativas.has(l) ? 'checked' : ''}
                   onchange="cenMarcar(this)">
            <b>${l}</b><small>${cenOnde(l)}</small>
        </label>`).join('');
}

function cenBuscar(input) {
    cen.busca = input.value;
    const lista = cen.painel && cen.painel.querySelector('.cen-lista');
    if (lista) lista.innerHTML = cenItensHTML();
}

function cenContador() {
    const el = cen.painel && cen.painel.querySelector('.cen-conta');
    if (el) el.textContent = cen.ativas.size
        ? `${cen.ativas.size} loja(s) marcada(s)` : 'nenhuma loja marcada';
}

function cenLimpar() {
    cen.ativas.clear();
    const lista = cen.painel && cen.painel.querySelector('.cen-lista');
    if (lista) lista.innerHTML = cenItensHTML();
    cenContador();
}

function cenOnde(loja) {
    for (const [reg, dists] of Object.entries(cenCtx().estrutura())) {
        for (const [dist, lojas] of Object.entries(dists)) {
            if (lojas.includes(loja)) return `${dist} · ${reg}`;
        }
    }
    return '';
}

function cenFecharPainel() {
    if (cen.painel) { cen.painel.remove(); cen.painel = null; }
}

function cenMarcar(input) {
    if (input.checked) cen.ativas.add(input.value);
    else cen.ativas.delete(input.value);
    cenContador();
}

function cenLigar() {
    if (!cen.ativas.size) { cenDesligar(); return; }
    cen.ligado = true;
    cenFecharPainel();
    cenAplicar();
}
