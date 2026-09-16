// ============================================================
// PLACAR AO LONGO DA SEMANA
//
// 📈 na janela do jogo: o placar projetado ao fim de cada dia da rodada.
// *  ao lado da sigla: loja da regional cujo resultado projetado mudou em
//    relação ao dia anterior (ontem vencia, hoje empata ou perde — ou o
//    contrário).
//
// Fonte: /api/evolucao/<semana>, que refaz o placar dia a dia com as vendas
// lançadas até cada dia (o mesmo número que o site mostrava naquele dia).
// ============================================================

const PS_DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const PS_REGIONAL = 'R2 - Luiz';
const placarSemana = { semana: null, dados: null, promessa: null };

function psCarregar(semana) {
    if (placarSemana.semana === semana && placarSemana.promessa) return placarSemana.promessa;
    placarSemana.semana = semana;
    placarSemana.dados = null;
    placarSemana.promessa = fetch(`/api/evolucao/${semana}`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (placarSemana.semana === semana) placarSemana.dados = d; return d; })
        .catch(() => null);
    return placarSemana.promessa;
}

/* [{dia, gm, gs, res}] da loja, um item por dia com venda lançada. */
function psSerie(loja, dados = placarSemana.dados) {
    const e = dados?.lojas?.[loja];
    if (!e) return [];
    const gols = Object.values(e.gols || {});
    return (dados.dias || []).map((dia, i) => {
        let gm = 0, gs = 0;
        gols.forEach(seq => { if (seq[i] === 'V') gm++; else if (seq[i] === 'D') gs++; });
        return { dia, gm, gs, res: gm > gs ? 'V' : gm < gs ? 'D' : 'E' };
    });
}

/* Mudança do resultado de ontem para hoje, ou null. */
function psMudou(loja) {
    const s = psSerie(loja);
    if (s.length < 2) return null;
    const ontem = s[s.length - 2], hoje = s[s.length - 1];
    return ontem.res === hoje.res ? null : { ontem, hoje };
}

const PS_NOME_RES = { V: 'vitória', E: 'empate', D: 'derrota' };

function psRegionalDe(loja, estrutura) {
    for (const [reg, dists] of Object.entries(estrutura || {})) {
        for (const lojas of Object.values(dists || {})) {
            if ((lojas || []).includes(loja)) return reg;
        }
    }
    return '';
}

/* Asterisco ao lado da sigla — só para lojas da regional com mudança. */
function asteriscoMudanca(loja, estrutura) {
    if (psRegionalDe(loja, estrutura) !== PS_REGIONAL) return '';
    const m = psMudou(loja);
    if (!m) return '';
    // Vermelho: ontem ganhava, hoje empata ou perde. Verde: ontem perdia, hoje
    // empata ou ganha. Mudança a partir de um empate não marca.
    const piorou = m.ontem.res === 'V';
    const melhorou = m.ontem.res === 'D';
    if (!piorou && !melhorou) return '';
    return `<span class="ps-ast ${piorou ? 'piorou' : 'melhorou'}"
        title="Mudou de ontem (${m.ontem.dia}) para hoje (${m.hoje.dia}): projetava ${m.ontem.gm} x ${m.ontem.gs} (${PS_NOME_RES[m.ontem.res]}), agora ${m.hoje.gm} x ${m.hoje.gs} (${PS_NOME_RES[m.hoje.res]})">*</span>`;
}

function psBotao(loja, adv, semana) {
    return `<button class="bt-cal ps-bt" title="Placar projetado ao longo da semana"
        onclick="event.stopPropagation(); abrirPlacarSemana('${loja}', '${adv}', ${semana}, this)">📈</button>`;
}

function psFechar() { document.querySelectorAll('.ps-pop').forEach(p => p.remove()); }

async function abrirPlacarSemana(loja, adv, semana, ancora) {
    psFechar();
    const pop = document.createElement('div');
    pop.className = 'ps-pop';
    pop.innerHTML = '<div class="ps-tit">📈 Carregando...</div>';
    document.body.appendChild(pop);
    const posicionar = () => {
        const r = ancora.getBoundingClientRect();
        pop.style.top = `${window.scrollY + r.bottom + 8}px`;
        pop.style.left = `${Math.max(8, window.scrollX + r.left + r.width / 2 - pop.offsetWidth / 2)}px`;
    };
    posicionar();

    const dados = await psCarregar(semana);
    if (!pop.isConnected) return;
    const serie = psSerie(loja, dados);
    const porDia = Object.fromEntries(serie.map(x => [x.dia, x]));
    let anterior = null;
    const linhas = PS_DIAS.map(dia => {
        const x = porDia[dia];
        if (!x) return `<tr class="vazio"><td>${dia}</td><td class="c">—</td><td></td></tr>`;
        const mudou = anterior && anterior.res !== x.res;
        anterior = x;
        return `<tr class="${mudou ? 'mudou' : ''}"><td>${dia}</td>
            <td class="c ps-placar">${x.gm} x ${x.gs}</td>
            <td><span class="ps-res ${x.res}">${PS_NOME_RES[x.res]}</span>${mudou ? ' <small>mudou</small>' : ''}</td></tr>`;
    }).join('');
    pop.innerHTML = `
        <div class="ps-tit">📈 ${loja} × ${adv}</div>
        <div class="ps-sub">Placar projetado ao fim de cada dia · rodada ${semana}</div>
        ${serie.length ? `<table class="ps-tab"><tbody>${linhas}</tbody></table>`
            : '<div class="ps-sub">Ainda não há dias com venda lançada nesta rodada.</div>'}
        ${dados?.aproximaPct ? `<div class="ps-nota">Nos indicadores percentuais, os dias
            intermediários usam a média dos dias lançados; o último dia usa o total oficial.</div>` : ''}`;
    posicionar();
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.ps-pop') && !e.target.closest('.ps-bt')) psFechar();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') psFechar(); });

/* Janelas abertas antes de os dados chegarem: marcam o lugar do asterisco com
   <span class="ps-ast-slot" data-loja> e preenchem quando carregar. */
function psPreencherAsteriscos(raiz, estrutura, semana) {
    psCarregar(semana).then(() => {
        raiz.querySelectorAll('.ps-ast-slot').forEach(el => {
            el.innerHTML = asteriscoMudanca(el.dataset.loja, estrutura);
        });
    });
}
