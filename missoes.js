// ============================================================
// MISSÕES DA SEMANA — o sino ao lado da sigla
//
// Marca um jogo como importante para a regional. A missão é sempre da loja da
// regional em destaque que está no confronto e vai para o distrital dela: sino
// no EPIA-DF, que joga com o ACST-SP, vira missão do ACST-SP para a Patricia.
// Quando o jogo tem duas lojas da regional (ou nenhuma), pergunta de quem é.
//
// A página precisa fornecer `missoesCtx`:
//   semana(), jogos(), estrutura(), redesenhar()
// ============================================================

const MIS_REGIONAL = 'R2 - Luiz';
const missoes = { semana: null, porLoja: {} };

const misApi = (url, opt) => fetch(`/api${url}`, { cache: 'no-store', ...opt })
    .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
    });

async function missoesCarregar(semana) {
    try {
        const d = await misApi(`/missoes/${semana}`);
        missoes.semana = semana;
        missoes.porLoja = {};
        (d.missoes || []).forEach(m => { missoes.porLoja[m.loja] = m; });
    } catch (e) {
        console.warn('missões indisponíveis', e);
        missoes.porLoja = {};
    }
}

function misOndeEsta(loja) {
    const est = missoesCtx.estrutura() || {};
    for (const [reg, dists] of Object.entries(est)) {
        for (const [dist, lojas] of Object.entries(dists)) {
            if ((lojas || []).includes(loja)) return { regional: reg, distrito: dist };
        }
    }
    return { regional: '', distrito: '' };
}

function misJogoDa(loja) {
    return (missoesCtx.jogos() || []).find(g => g.team1 === loja || g.team2 === loja);
}

/* A missão ligada ao jogo desta loja, se houver (de qualquer um dos lados). */
function misDoJogo(loja) {
    const g = misJogoDa(loja);
    if (!g) return missoes.porLoja[loja] || null;
    return missoes.porLoja[g.team1] || missoes.porLoja[g.team2] || null;
}

function sinoHTML(loja) {
    const m = misDoJogo(loja);
    return `<button class="mis-sino${m ? ' ativo' : ''}" data-mis-loja="${loja}"
        title="${m ? `Missão de ${m.loja} (${m.distrito || 'sem distrito'}) — clique para editar`
                  : 'Marcar este jogo como missão da semana'}"
        onclick="event.stopPropagation(); missaoAbrir('${loja}', this)">🔔</button>`;
}

function misFecharPop() {
    document.querySelectorAll('.mis-pop').forEach(p => p.remove());
}

/* Abre a caixinha de missão junto ao sino clicado. */
function missaoAbrir(loja, ancora) {
    misFecharPop();
    const g = misJogoDa(loja);
    if (!g) { alert(`${loja} não tem jogo nesta rodada.`); return; }
    const existente = misDoJogo(loja);

    const daRegional = [g.team1, g.team2].filter(l => misOndeEsta(l).regional === MIS_REGIONAL);
    // Com uma só loja da regional, a missão é dela. Com duas ou nenhuma, a
    // pessoa escolhe de quem é.
    const opcoes = daRegional.length === 1 ? daRegional : [g.team1, g.team2];
    const lojaMissao = existente ? existente.loja : opcoes[0];

    const pop = document.createElement('div');
    pop.className = 'mis-pop';
    pop.innerHTML = `
        <div class="mis-pop-tit">🔔 Missão da semana</div>
        <div class="mis-pop-jogo">${g.team1} × ${g.team2}</div>
        ${opcoes.length > 1 ? `
        <label class="mis-pop-rot">A missão é de qual loja?</label>
        <div class="mis-pop-opts">${opcoes.map(l => {
            const o = misOndeEsta(l);
            return `<label><input type="radio" name="misLoja" value="${l}"
                ${l === lojaMissao ? 'checked' : ''}> <b>${l}</b>
                <small>${o.distrito || 'sem distrito'}</small></label>`;
        }).join('')}</div>` : `
        <div class="mis-pop-dono">Loja: <b>${lojaMissao}</b> ·
            <small>${misOndeEsta(lojaMissao).distrito || 'sem distrito'}</small></div>`}
        <label class="mis-pop-rot">O que precisa acontecer?</label>
        <div class="mis-pop-opts">
            <label><input type="radio" name="misCrit" value="vencer"
                ${(existente?.criterio || 'vencer') === 'vencer' ? 'checked' : ''}> Vencer</label>
            <label><input type="radio" name="misCrit" value="nao_perder"
                ${existente?.criterio === 'nao_perder' ? 'checked' : ''}> Não perder (vitória ou empate)</label>
        </div>
        <div class="mis-pop-acoes">
            ${existente ? '<button class="mis-bt remover">Remover missão</button>' : ''}
            <button class="mis-bt cancelar">Cancelar</button>
            <button class="mis-bt salvar">${existente ? 'Salvar' : 'Criar missão'}</button>
        </div>
        <div class="mis-pop-erro" hidden></div>`;
    document.body.appendChild(pop);

    const r = ancora.getBoundingClientRect();
    pop.style.top = `${window.scrollY + r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left - 20,
        window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8))}px`;

    const erro = (msg) => { const e = pop.querySelector('.mis-pop-erro'); e.textContent = msg; e.hidden = false; };
    pop.querySelector('.cancelar').onclick = misFecharPop;

    pop.querySelector('.salvar').onclick = async () => {
        const escolhida = pop.querySelector('input[name=misLoja]:checked')?.value || lojaMissao;
        const criterio = pop.querySelector('input[name=misCrit]:checked')?.value || 'vencer';
        const onde = misOndeEsta(escolhida);
        try {
            // Trocou a loja dona de uma missão existente: remove a antiga.
            if (existente && existente.loja !== escolhida) {
                await misApi(`/missoes/${existente.id}`, { method: 'DELETE' });
            }
            await misApi('/missoes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    semana: missoesCtx.semana(), loja: escolhida,
                    adversario: escolhida === g.team1 ? g.team2 : g.team1,
                    distrito: onde.distrito, regional: onde.regional, criterio
                })
            });
            await missoesCarregar(missoesCtx.semana());
            misFecharPop();
            missoesCtx.redesenhar();
        } catch (e) { erro(e.message); }
    };

    const rem = pop.querySelector('.remover');
    if (rem) rem.onclick = async () => {
        try {
            await misApi(`/missoes/${existente.id}`, { method: 'DELETE' });
            await missoesCarregar(missoesCtx.semana());
            misFecharPop();
            missoesCtx.redesenhar();
        } catch (e) { erro(e.message); }
    };
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.mis-pop') && !e.target.closest('.mis-sino')) misFecharPop();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') misFecharPop(); });
