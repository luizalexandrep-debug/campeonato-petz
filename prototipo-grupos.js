// ============================================================
// PROTÓTIPO — classificação simulada por grupo (nível LOJA)
//
// Esquerda : classificação oficial até a rodada encerrada (Power BI)
// Direita  : a mesma classificação + os placares projetados da rodada atual
//
// Desempate (regra oficial, item 7 do regulamento): 1º vitórias, 2º saldo de
// gols, 3º confronto direto, 4º crescimento de share MP, 5º turn over.
// Confronto direto em diante depende de dados que o app não tem (histórico de
// cada confronto, share da campanha, RH). Usamos Pts > VIT > SG > GM, que
// reproduz EXATAMENTE os 14 grupos do export oficial da rodada 7, inclusive
// nos 29 empates que chegam até o saldo de gols — ordem alfabética, citada no
// regulamento para a parcial, reproduz apenas 4 dos 14.
// ============================================================

const st = {
    semana: null, semanaVigente: null, semanas: [],
    rodadaBase: null, grupos: {}, summary: null,
    estrutura: {}, minhasLojas: new Set(),
    grupo: '', destacar: true,     // destaque das minhas lojas ligado por padrão
    calendario: [], lojaFoco: null
};

// Foco dos insights: disputa da parte de cima da tabela.
const CORTE_TOPO = 8;

const REGIONAL_DESTAQUE = 'R2 - Luiz';

const pegar = (p) => fetch(`/api${p}`, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
});

function info(html) {
    document.getElementById('infoBar').innerHTML = `<span>${html}</span>`;
}

// ---- ordenação oficial ----
function ordenar(linhas) {
    return linhas.slice().sort((a, b) =>
        b.pts - a.pts || b.vit - a.vit || b.sg - a.sg || b.gm - a.gm ||
        a.time.localeCompare(b.time));
}

async function iniciar() {
    try {
        const [sem, cls, est, cal] = await Promise.all([
            pegar('/semana'), pegar('/classificacao'), pegar('/estrutura'),
            pegar('/jogos').catch(() => ({ jogos: [] }))
        ]);
        st.calendario = cal.jogos || [];

        st.semanaVigente = sem.semana;
        st.semana = sem.semana;
        st.semanas = sem.disponiveis || [sem.semana];
        st.rodadaBase = cls.rodada;
        st.grupos = cls.grupos || {};
        st.estrutura = est.estrutura || est;

        Object.values(st.estrutura[REGIONAL_DESTAQUE] || {}).forEach(lojas =>
            lojas.forEach(l => st.minhasLojas.add(l)));

        // loja -> regional, para o panorama entre as três regionais
        st.lojaRegional = {};
        Object.entries(st.estrutura).forEach(([reg, dists]) =>
            Object.values(dists).forEach(lojas =>
                lojas.forEach(l => { st.lojaRegional[l] = reg; })));

        if (!Object.keys(st.grupos).length) {
            info('❌ Nenhuma classificação encontrada na pasta "Classificação Lojas" do SharePoint.');
            return;
        }

        montarSelects();
        await carregarSummary();
        render();
    } catch (e) {
        console.error(e);
        info(`❌ Erro ao iniciar: ${e.message}`);
    }
}

function montarSelects() {
    const nomes = Object.keys(st.grupos).sort((a, b) => {
        const na = parseInt((a.match(/Grupo\s+(\d+)/) || [])[1] || 0, 10);
        const nb = parseInt((b.match(/Grupo\s+(\d+)/) || [])[1] || 0, 10);
        return na - nb;
    });
    st.nomesGrupos = nomes;
    st.grupo = '';                 // '' = todos os grupos
    montarChipsGrupo();

    // Só rodadas POSTERIORES à base: projetar uma rodada que a base já inclui
    // somaria os mesmos pontos duas vezes.
    const projetaveis = st.semanas.filter(n => n > st.rodadaBase).sort((a, b) => b - a);
    st.semana = projetaveis.includes(st.semanaVigente) ? st.semanaVigente : (projetaveis[0] ?? null);

    const sR = document.getElementById('fRodada');
    sR.innerHTML = projetaveis.length
        ? projetaveis.map(n => `<option value="${n}"${n === st.semana ? ' selected' : ''}>Rodada ${n}${n === st.semanaVigente ? ' (atual)' : ''}</option>`).join('')
        : '<option value="">nenhuma</option>';
    sR.disabled = !projetaveis.length;
    sR.onchange = async (e) => {
        st.semana = parseInt(e.target.value, 10);
        _cacheDias.clear();
        info('⏳ Carregando rodada...');
        await carregarSummary();
        render();
    };

    document.getElementById('soMinha').onchange = (e) => {
        st.destacar = e.target.checked;
        render();
    };
}

async function carregarSummary() {
    st.summary = st.semana ? await pegar(`/games-summary/${st.semana}`) : null;
}

// ---- projeção da rodada atual, por loja ----
function projecaoDaRodada() {
    const jogos = st.summary?.games || [];
    const semDados = !!st.summary?.semDadosAtual;
    const proj = {};
    if (semDados) return { proj, semDados };

    jogos.forEach(g => {
        const [a, b] = g.scoreProjected.split('x').map(v => parseInt(v.trim()));
        [[g.team1, a, b], [g.team2, b, a]].forEach(([time, gm, gs]) => {
            proj[time] = {
                pts: gm > gs ? 3 : gm === gs ? 1 : 0,
                vit: gm > gs ? 1 : 0, emp: gm === gs ? 1 : 0, der: gm < gs ? 1 : 0,
                gm, gs,
                adv: time === g.team1 ? g.team2 : g.team1
            };
        });
    });
    return { proj, semDados };
}

// ============================================================
// PANORAMA — visão dos 14 grupos de uma vez
// ============================================================

const TOTAL_RODADAS = 19;

function classificarGrupo(linhas, proj) {
    const sim = ordenar(linhas.map(r => {
        const p = proj[r.time];
        if (!p) return { ...r, semJogo: true };
        return {
            ...r,
            pts: r.pts + p.pts, jogos: r.jogos + 1,
            vit: r.vit + p.vit, emp: r.emp + p.emp, der: r.der + p.der,
            gm: r.gm + p.gm, gs: r.gs + p.gs, sg: (r.gm + p.gm) - (r.gs + p.gs),
            ganhou: p.pts, adv: p.adv
        };
    }));
    return { base: ordenar(linhas), sim };
}

function calcularPanorama() {
    const { proj } = projecaoDaRodada();
    const regs = Object.keys(st.estrutura);
    const zero = () => ({ lider: 0, top4: 0, ultimos4: 0 });
    const tot = {};
    regs.forEach(r => { tot[r] = { base: zero(), sim: zero() }; });

    const combos = [];    // jogos de uma loja minha que ajudam outra loja minha
    const g4 = [];        // minhas lojas no top 4 (antes ou depois da projeção)
    const z4 = [];        // minhas lojas na zona de queda
    const trocas = [];    // grupos onde o líder muda na projeção

    // O quadro das regionais e as trocas de liderança são a leitura do
    // campeonato inteiro — não mudam quando um grupo é escolhido nos chips.
    // O filtro vale só para as listas de lojas (G4, Z4 e combinações).
    Object.entries(st.grupos).forEach(([grupo, linhas]) => {
        const { base, sim } = classificarGrupo(linhas, proj);
        const n = base.length;

        base.forEach((r, i) => { const g = st.lojaRegional[r.time]; if (tot[g]) { if (i === 0) tot[g].base.lider++; if (i < 4) tot[g].base.top4++; if (i >= n - 4) tot[g].base.ultimos4++; } });
        sim.forEach((r, i) => { const g = st.lojaRegional[r.time]; if (tot[g]) { if (i === 0) tot[g].sim.lider++; if (i < 4) tot[g].sim.top4++; if (i >= n - 4) tot[g].sim.ultimos4++; } });

        if (base.length && sim.length && base[0].time !== sim[0].time) {
            trocas.push({
                grupo,
                novo: sim[0].time, novoReg: st.lojaRegional[sim[0].time],
                antigo: base[0].time, antigoReg: st.lojaRegional[base[0].time],
                ptsNovo: sim[0].pts, ptsAntigo: (sim.find(x => x.time === base[0].time) || {}).pts,
                posAntigo: sim.findIndex(x => x.time === base[0].time) + 1
            });
        }
    });

    // Daqui para baixo, só o grupo escolhido (ou todos, se nenhum estiver).
    const escopo = st.grupo
        ? Object.entries(st.grupos).filter(([g]) => g === st.grupo)
        : Object.entries(st.grupos);

    escopo.forEach(([grupo, linhas]) => {
        const { base, sim } = classificarGrupo(linhas, proj);
        const n = base.length;
        const posB = {}, posS = {};
        base.forEach((r, i) => posB[r.time] = i + 1);
        sim.forEach((r, i) => posS[r.time] = i + 1);

        // A regional como um só time: quando uma loja minha enfrenta um rival
        // que está À FRENTE de outra loja minha, a vitória dela abre caminho
        // para a companheira. Só vale se as duas vencerem.
        sim.forEach((rival, iRival) => {
            const pRival = proj[rival.time];
            if (!pRival) return;
            const carrasco = pRival.adv;                     // quem enfrenta o rival
            if (!st.minhasLojas.has(carrasco)) return;       // precisa ser loja minha
            if (st.minhasLojas.has(rival.time)) return;      // rival não pode ser minha

            sim.forEach((minha, iMinha) => {
                if (!st.minhasLojas.has(minha.time)) return;
                if (minha.time === carrasco) return;         // a beneficiada é outra
                if (iMinha <= iRival) return;                // só se estiver atrás
                if (iMinha + 1 > CORTE_TOPO) return;          // foco na parte de cima
                const gap = rival.pts - minha.pts;
                if (gap > 6) return;                         // longe demais para importar

                const pMinha = proj[minha.time];
                const venceCarrasco = pRival.gm < pRival.gs; // rival perde o jogo
                const venceMinha = pMinha && pMinha.gm > pMinha.gs;

                combos.push({
                    grupo,
                    rival: rival.time, posRival: iRival + 1, ptsRival: rival.pts,
                    carrasco, placarCarrasco: `${pRival.gs} x ${pRival.gm}`,
                    beneficiada: minha.time, posBeneficiada: iMinha + 1, ptsBeneficiada: minha.pts,
                    advBeneficiada: pMinha ? pMinha.adv : null,
                    placarBeneficiada: pMinha ? `${pMinha.gm} x ${pMinha.gs}` : null,
                    gap, venceCarrasco, venceMinha,
                    completo: venceCarrasco && venceMinha
                });
            });
        });

        // Minhas lojas nas duas pontas: G4 (4 primeiros) e Z4 (4 últimos).
        // Uma loja entra na lista se estiver na zona ANTES ou DEPOIS da projeção,
        // para que entradas e saídas apareçam junto de quem permaneceu.
        const primeiroForaZ4 = sim[n - 5];      // referência de quem escapa do Z4
        const quartoColocado = sim[3];          // referência de quem entra no G4
        linhas.forEach(r => {
            if (!st.minhasLojas.has(r.time)) return;
            const b = posB[r.time], s2 = posS[r.time];
            const noG4B = b <= 4, noG4S = s2 <= 4;
            const noZ4B = b > n - 4, noZ4S = s2 > n - 4;
            const linhaSim = sim.find(x => x.time === r.time) || {};
            const p = proj[r.time];
            const comum = {
                grupo, time: r.time, de: b, para: s2,
                adv: linhaSim.adv, ganhou: linhaSim.ganhou, pts: linhaSim.pts,
                gm: p ? p.gm : null, gs: p ? p.gs : null,
                resultado: p ? (p.gm > p.gs ? 'vencendo' : p.gm < p.gs ? 'perdendo' : 'empatando') : null
            };

            if (noG4B || noG4S) {
                g4.push({
                    ...comum,
                    situacao: noG4S && !noG4B ? 'entrou' : !noG4S && noG4B ? 'saiu' : 'ficou',
                    lider: sim[0].time,
                    gapLider: sim[0].pts - linhaSim.pts,
                    // liderando: a folga é sobre o 2º colocado
                    folga: s2 === 1 && sim[1] ? linhaSim.pts - sim[1].pts : null,
                    vice: s2 === 1 && sim[1] ? sim[1].time : null,
                    // confronto direto com a referência (líder, ou vice se eu lidero)
                    ref: s2 === 1 ? (sim[1] ? sim[1].time : null) : sim[0].time,
                    // para quem está fora, quanto falta para alcançar o 4º
                    gapG4: noG4S ? 0 : (quartoColocado ? quartoColocado.pts - linhaSim.pts : 0)
                });
            }
            if (noZ4B || noZ4S) {
                z4.push({
                    ...comum,
                    situacao: !noZ4S && noZ4B ? 'saiu' : noZ4S && !noZ4B ? 'entrou' : 'ficou',
                    // quanto falta para sair do Z4 (alcançar o 1º fora da zona)
                    gapSalvacao: noZ4S && primeiroForaZ4 ? primeiroForaZ4.pts - linhaSim.pts : 0,
                    margem: !noZ4S && primeiroForaZ4 ? linhaSim.pts - (sim[n - 4] ? sim[n - 4].pts : 0) : 0,
                    // referência do Z4: a loja logo fora da zona
                    ref: primeiroForaZ4 ? primeiroForaZ4.time : null
                });
            }
        });

    });

    // Confronto direto com a referência de cada item (líder, vice ou 1º fora
    // do Z4) — é o 3º critério de desempate e muda a leitura do que falta.
    [...g4, ...z4].forEach(m => {
        if (!m.ref) return;
        m.refPassados = encontrosPassados(m.time, m.ref);
        m.refSaldo = m.refPassados.length ? saldoDireto(m.refPassados) : null;
        m.refProximo = proximoEncontro(m.time, m.ref);
    });

    // Entradas e saídas primeiro — é o que muda a decisão; depois por posição.
    const ordemSit = { entrou: 0, saiu: 1, ficou: 2 };
    g4.sort((a, b) => ordemSit[a.situacao] - ordemSit[b.situacao] || a.para - b.para);
    z4.sort((a, b) => ordemSit[a.situacao] - ordemSit[b.situacao] || b.para - a.para);
    // A minha regional vem primeiro — ganhos e perdas —, e só depois as trocas
    // entre as outras regionais.
    const envolveMinha = (t) => t.novoReg === REGIONAL_DESTAQUE || t.antigoReg === REGIONAL_DESTAQUE;
    const ordemTroca = (t) => {
        if (!envolveMinha(t)) return 2;
        return t.novoReg === REGIONAL_DESTAQUE ? 0 : 1;   // ganhou antes de perdeu
    };
    trocas.sort((a, b) => ordemTroca(a) - ordemTroca(b)
        || (a.grupo).localeCompare(b.grupo, 'pt', { numeric: true }));
    // Combinações que já estão de pé primeiro, depois as que faltam pouco.
    combos.sort((a, b) => (b.completo - a.completo)
        || ((b.venceCarrasco + b.venceMinha) - (a.venceCarrasco + a.venceMinha))
        || a.gap - b.gap);
    return { tot, g4, z4, trocas, combos };
}

// ============================================================
// INSIGHTS DA PARTE DE CIMA DA TABELA (top 8)
// Combina a rodada em andamento com o calendário das 19 rodadas
// ("TODOS OS JOGOS.xlsx", via /api/jogos).
// ============================================================

function jogosFuturos() {
    return (st.calendario || []).filter(j => j.rodada > st.semana);
}

// Em que rodada duas lojas ainda se enfrentam (null se não se cruzam mais).
function proximoEncontro(a, b) {
    const j = jogosFuturos().find(x =>
        (x.mandante === a && x.visitante === b) || (x.mandante === b && x.visitante === a));
    return j ? j.rodada : null;
}

// Confrontos diretos JÁ realizados entre duas lojas, na ótica de `a`.
// Vale como critério de desempate (item 3 do regulamento) e, nos grupos 13 e
// 14, onde há jogo de volta, conta a soma dos dois resultados.
function encontrosPassados(a, b) {
    return (st.calendario || [])
        .filter(j => j.realizado &&
            ((j.mandante === a && j.visitante === b) || (j.mandante === b && j.visitante === a)))
        .map(j => {
            const souMandante = j.mandante === a;
            const meus = souMandante ? j.golsMandante : j.golsVisitante;
            const dele = souMandante ? j.golsVisitante : j.golsMandante;
            return { rodada: j.rodada, meus, dele, resultado: meus > dele ? 'V' : meus < dele ? 'D' : 'E' };
        })
        .sort((x, y) => x.rodada - y.rodada);
}

// Saldo do confronto direto: como fica a soma dos jogos entre as duas.
function saldoDireto(jogos) {
    const meus = jogos.reduce((t, j) => t + j.meus, 0);
    const dele = jogos.reduce((t, j) => t + j.dele, 0);
    return { meus, dele, vantagem: meus > dele ? 'a favor' : meus < dele ? 'contra' : 'igual' };
}

// Rodadas em que a loja ainda enfrenta alguém da minha regional.
function encontrosComMinhas(time) {
    return jogosFuturos()
        .filter(j => j.mandante === time || j.visitante === time)
        .map(j => ({ rodada: j.rodada, adv: j.mandante === time ? j.visitante : j.mandante }))
        .filter(x => st.minhasLojas.has(x.adv));
}

// Próximos adversários da loja, com a posição atual de cada um.
function proximosAdversarios(time, posDe, quantos) {
    return jogosFuturos()
        .filter(j => j.mandante === time || j.visitante === time)
        .sort((a, b) => a.rodada - b.rodada)
        .slice(0, quantos)
        .map(j => {
            const adv = j.mandante === time ? j.visitante : j.mandante;
            return { rodada: j.rodada, adv, pos: posDe[adv] || null };
        });
}

function calcularInsightsTopo() {
    const { proj } = projecaoDaRodada();
    const itens = [];

    Object.entries(st.grupos).forEach(([grupo, linhas]) => {
        const { sim } = classificarGrupo(linhas, proj);
        const posDe = {};
        sim.forEach((r, i) => posDe[r.time] = i + 1);

        sim.forEach((minha, i) => {
            const pos = i + 1;
            if (pos > CORTE_TOPO) return;
            if (!st.minhasLojas.has(minha.time)) return;

            const restam = TOTAL_RODADAS - minha.jogos;
            const emJogo = restam * 3;

            // rivais à frente, dentro da zona de interesse
            const rivais = sim.slice(0, i).map((r, j) => {
                const gap = r.pts - minha.pts;
                const passados = encontrosPassados(minha.time, r.time);
                return {
                    time: r.time, pos: j + 1, pts: r.pts, gap,
                    daRegional: st.minhasLojas.has(r.time),
                    confronto: proximoEncontro(minha.time, r.time),
                    passados, saldo: passados.length ? saldoDireto(passados) : null,
                    tropecos: encontrosComMinhas(r.time),
                    alcancavel: gap <= emJogo
                };
            });

            const p = proj[minha.time];
            itens.push({
                grupo, time: minha.time, pos, pts: minha.pts, restam, emJogo,
                jogoDaRodada: p ? { adv: p.adv, placar: `${p.gm} x ${p.gs}`, venceu: p.gm > p.gs, pts: p.pts } : null,
                lider: sim[0].time, gapLider: sim[0].pts - minha.pts,
                rivais,
                proximos: proximosAdversarios(minha.time, posDe, 3)
            });
        });
    });

    // primeiro quem está mais perto de subir
    itens.sort((a, b) => a.pos - b.pos || (a.rivais[0]?.gap ?? 99) - (b.rivais[0]?.gap ?? 99));
    return itens;
}

function insightsTopoHtml(itens) {
    if (!itens.length) {
        return `<li>Nenhuma loja sua entre os ${CORTE_TOPO} primeiros ${st.grupo ? 'deste grupo' : 'dos grupos'}.</li>`;
    }

    const posTxt = (p) => p ? `${p}º` : '—';

    return itens.map(it => {
        const alvo = it.rivais[it.rivais.length - 1];   // o rival logo acima
        const linhas = [];

        if (it.jogoDaRodada) {
            linhas.push(`<div class="ins-linha">${it.jogoDaRodada.venceu ? '<span class="ck sim">✔</span>' : '<span class="ck nao">✖</span>'}
                Rodada ${st.semana}: <b>${it.jogoDaRodada.adv}</b> · projetado ${it.jogoDaRodada.placar}
                <small>(${it.jogoDaRodada.pts} pt)</small></div>`);
        }

        // Tudo que fala de rodada abre a janela do calendário.
        const cal = (rival) => `onclick="event.stopPropagation(); abrirCalendario('${it.time}','${rival || ''}','${it.grupo.replace(/'/g, "\\'")}')"`;

        if (alvo) {
            const sub = [];
            if (alvo.confronto) {
                sub.push(`<span class="tatica dir cal" ${cal(alvo.time)}
                    title="Ver o calendário">⚔ Confronto direto na rodada ${alvo.confronto}</span>`);
            } else if (alvo.passados.length) {
                // Já jogaram: o resultado vale como 3º critério de desempate.
                const s2 = alvo.saldo;
                const cls = s2.vantagem === 'a favor' ? 'ajuda' : s2.vantagem === 'contra' ? 'contra' : 'sem';
                const rot = s2.vantagem === 'a favor' ? 'desempate a seu favor'
                    : s2.vantagem === 'contra' ? 'desempate contra você' : 'desempate empatado';
                const detalhe = alvo.passados.map(j => `R${j.rodada}: ${j.meus} x ${j.dele}`).join(' · ');
                sub.push(`<span class="tatica ${cls} cal" ${cal(alvo.time)} title="Ver o calendário">
                    ⚔ Já se enfrentaram — ${detalhe}${alvo.passados.length > 1 ? ` (soma ${s2.meus} x ${s2.dele})` : ''}
                    · ${rot}</span>`);
            } else {
                sub.push(`<span class="tatica sem cal" ${cal(alvo.time)}
                    title="Ver o calendário">Não se enfrentam mais — depende de terceiros</span>`);
            }
            if (alvo.tropecos.length) {
                sub.push(`<span class="tatica ajuda cal" ${cal(alvo.time)} title="Ver o calendário">🛡 ${alvo.time} ainda pega
                    ${alvo.tropecos.length} loja(s) sua(s): ${alvo.tropecos.map(t => `${t.adv} (R${t.rodada})`).join(', ')}</span>`);
            }
            linhas.push(`<div class="ins-linha">🎯 Alvo <b>${alvo.time}</b> (${posTxt(alvo.pos)}) —
                ${alvo.gap === 0 ? 'empatados em pontos' : `${alvo.gap} pt(s) à frente`}
                ${alvo.daRegional ? '<span class="tag minha">loja sua</span>' : ''}
                <div class="ins-sub">${sub.join('')}</div></div>`);
        }

        if (it.pos > 1) {
            const l = it.rivais[0];
            if (l && l.time !== (alvo && alvo.time)) {
                linhas.push(`<div class="ins-linha">👑 Líder <b>${it.lider}</b> — ${it.gapLider} pt(s)
                    <small>· ${it.gapLider <= it.emJogo ? 'alcançável' : 'fora de alcance'} com ${it.emJogo} pts em jogo</small>
                    ${l.confronto ? `<span class="tatica dir cal" ${cal(l.time)}
                        title="Ver o calendário">⚔ vocês se enfrentam na rodada ${l.confronto}</span>` : ''}</div>`);
            }
        }

        if (it.proximos.length) {
            linhas.push(`<div class="ins-linha cal-linha" ${cal(alvo ? alvo.time : '')} title="Ver o calendário completo">
                📅 Próximos:
                ${it.proximos.map(x => `<b>${x.adv}</b> <small>(${posTxt(x.pos)}, R${x.rodada})</small>`).join(' · ')}
                <span class="cal-abrir">ver calendário →</span></div>`);
        }

        return `<li class="clicavel ${it.pos === 1 ? 'ganho' : ''}"
            onclick="abrirGrupo('${it.grupo.replace(/'/g, "\\'")}','${it.time}')" title="Ver a tabela do ${it.grupo}">
            <div class="ins-topo"><b>${it.time}</b> · ${it.grupo} —
                <b>${it.pos}º</b> com ${it.pts} pts <small>· faltam ${it.restam} rodadas (${it.emJogo} pts em jogo)</small></div>
            ${linhas.join('')}
        </li>`;
    }).join('');
}

// Chips de grupo, no mesmo espírito do filtro de regionais do dashboard.
function montarChipsGrupo() {
    const bar = document.getElementById('grupoBar');
    if (!bar) return;
    const curto = (g) => g.replace(/S[ée]rie\s+([A-D])\s+-\s+Grupo\s+(\d+)/i, '$1$2');
    const chip = (valor, rotulo, titulo) =>
        `<button class="chip-grupo${st.grupo === valor ? ' ativo' : ''}" title="${titulo}"
            onclick="selecionarGrupo('${valor.replace(/'/g, "\\'")}')">${rotulo}</button>`;
    bar.innerHTML = `<span class="chip-label">Grupo:</span>`
        + chip('', 'Todos', 'Insights de todos os grupos')
        + (st.nomesGrupos || []).map(g => chip(g, curto(g), g)).join('');
}

function selecionarGrupo(g) {
    st.grupo = g;
    st.lojaFoco = null;
    montarChipsGrupo();
    render();
}

// ============================================================
// JANELA DO CALENDÁRIO
// Abre as rodadas que ainda faltam, lado a lado, destacando os
// confrontos citados no insight (jogo direto e os tropeços possíveis).
// ============================================================

function jogoDaRodada(time, rodada) {
    const j = (st.calendario || []).find(x => x.rodada === rodada &&
        (x.mandante === time || x.visitante === time));
    if (!j) return null;
    return {
        adv: j.mandante === time ? j.visitante : j.mandante,
        realizado: j.realizado,
        placar: j.realizado ? `${j.golsMandante} x ${j.golsVisitante}` : null
    };
}

function abrirCalendario(loja, rival, grupo) {
    const linhas = st.grupos[grupo] || [];
    const { proj } = projecaoDaRodada();
    const { sim } = classificarGrupo(linhas, proj);
    const posDe = {};
    sim.forEach((r, i) => posDe[r.time] = i + 1);

    const rodadas = [];
    for (let r = st.semana + 1; r <= TOTAL_RODADAS; r++) rodadas.push(r);

    const corpo = rodadas.map(r => {
        const a = jogoDaRodada(loja, r);
        const b = rival ? jogoDaRodada(rival, r) : null;
        const direto = a && rival && a.adv === rival;
        const tropeco = b && st.minhasLojas.has(b.adv) && !direto;
        const cls = direto ? 'linha-direto' : tropeco ? 'linha-tropeco' : '';
        // Mandante/visitante não muda nada no campeonato (o placar vem da
        // evolução de vendas de cada loja), então não vale espaço na tela.
        const cel = (j) => j
            ? `<b>${j.adv}</b>${posDe[j.adv] ? ` <small>${posDe[j.adv]}º</small>` : ''}`
            : '<span class="vazio-cel">—</span>';
        return `<tr class="${cls}">
            <td class="c">R${r}</td>
            <td>${cel(a)}</td>
            ${rival ? `<td>${cel(b)}${tropeco ? ' <span class="tatica ajuda">🛡 loja sua</span>' : ''}</td>` : ''}
            <td class="c motivo">${direto ? '⚔ confronto direto' : tropeco ? '🛡 chance de tropeço' : ''}</td>
        </tr>`;
    }).join('');

    const nDireto = rodadas.filter(r => { const a = jogoDaRodada(loja, r); return a && rival && a.adv === rival; }).length;
    const nTropeco = rodadas.filter(r => { const b = rival && jogoDaRodada(rival, r); return b && st.minhasLojas.has(b.adv) && !(jogoDaRodada(loja, r) || {}).adv === rival; }).length;

    // Confronto direto já realizado — é critério de desempate, então aparece
    // no topo da janela mesmo não sendo mais um jogo futuro.
    const passados = rival ? encontrosPassados(loja, rival) : [];
    const sd = passados.length ? saldoDireto(passados) : null;
    const blocoPassado = passados.length ? `
        <div class="cal-passado ${sd.vantagem === 'a favor' ? 'bom' : sd.vantagem === 'contra' ? 'ruim' : ''}">
            <b>⚔ Confronto direto já realizado</b>
            <div>${passados.map(j => `Rodada ${j.rodada}: <b>${loja} ${j.meus} x ${j.dele} ${rival}</b>`).join(' · ')}
            ${passados.length > 1 ? ` · soma <b>${sd.meus} x ${sd.dele}</b>` : ''}</div>
            <small>Em caso de empate em pontos e vitórias e saldo, este resultado é o 3º critério de
            desempate — hoje ele está ${sd.vantagem === 'a favor' ? 'a seu favor' : sd.vantagem === 'contra' ? 'contra você' : 'empatado'}.</small>
        </div>` : '';

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-cal">
            <div class="modal-head">
                <div class="cal-titulo">
                    <b>Calendário até a rodada ${TOTAL_RODADAS}</b>
                    <small>${grupo} · ${loja}${rival ? ` vs ${rival}` : ''}</small>
                </div>
                <button class="modal-btn" data-fechar>✕ Fechar</button>
            </div>
            <div class="modal-corpo">
                ${blocoPassado}
                <div class="cal-legenda">
                    <span class="tatica dir">⚔ confronto direto</span>
                    <span class="tatica ajuda">🛡 o rival enfrenta uma loja sua</span>
                    <span class="cal-nota">Rodadas ${st.semana + 1} a ${TOTAL_RODADAS} · o número é a posição atual do adversário</span>
                </div>
                <table class="tab-grupo tab-cal">
                    <thead><tr>
                        <th class="c">Rodada</th>
                        <th>${loja} <small>(sua loja)</small></th>
                        ${rival ? `<th>${rival} <small>(alvo)</small></th>` : ''}
                        <th class="c">Leitura</th>
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

// ============================================================
// JANELA DE DETALHES DO JOGO
// Clicar na sigla dentro das tabelas abre os indicadores da rodada,
// com as mesmas regras de agregação e evolução do dashboard.
// ============================================================

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

// Cache das leituras de loja e pré-carga ao passar o mouse: quando o clique
// acontece, a resposta normalmente já chegou.
const _cacheDias = new Map();

function buscarDias(loja) {
    const chave = `${loja}/${st.semana}`;
    if (!_cacheDias.has(chave)) {
        _cacheDias.set(chave, pegar(`/loja-dias/${loja}/${st.semana}`)
            .catch(e => { _cacheDias.delete(chave); throw e; }));
    }
    return _cacheDias.get(chave);
}

function prefetchJogo(loja) {
    const p = (st.projAtual || {})[loja];
    if (!p) return;
    buscarDias(loja);
    if (p.adv) buscarDias(p.adv);
}

async function abrirDetalhesJogo(loja) {
    const p = (st.projAtual || {})[loja];
    if (!p) return;
    const adv = p.adv;
    const placar = `${p.gm} × ${p.gs}`;

    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
        <div class="modal-jogo">
            <div class="modal-head">
                <div class="times">
                    <span class="t">${loja}</span>
                    <span class="placar"><small>Placar Projetado</small><b>${placar}</b>
                        <small>rodada ${st.semana}</small></span>
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

function nomeCurto(reg) {
    const p = reg.split(' - ');
    return p.length > 1 ? `${p[0]} (${p[1]})` : reg;
}

// menorEhMelhor: na coluna "Últimos 4" (zona de queda) crescer é ruim, então
// a seta acompanha o NÚMERO e a cor acompanha o BENEFÍCIO.
function delta(a, b, menorEhMelhor) {
    const d = b - a;
    if (d === 0) return '<span class="mov igual">–</span>';
    const seta = d > 0 ? '▲' : '▼';
    const bom = menorEhMelhor ? d < 0 : d > 0;
    return `<span class="mov ${bom ? 'sobe' : 'desce'}">${seta} ${Math.abs(d)}</span>`;
}

// Clique num item do panorama: troca o grupo selecionado, rola até as tabelas
// e destaca a loja por alguns segundos.
function abrirGrupo(grupo, loja) {
    if (!st.grupos[grupo]) return;
    st.grupo = grupo;
    st.lojaFoco = loja || null;
    montarChipsGrupo();
    render();

    const alvo = document.querySelector('.comparacao');
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function textoTrocas(trocas) {
    if (!trocas.length) {
        return `<div class="pg-texto">Nenhuma liderança muda de dono com a projeção da rodada ${st.semana}:
            os 14 líderes seguem os mesmos.</div>`;
    }

    const eu = (reg) => reg === REGIONAL_DESTAQUE;
    const tag = (reg) => reg ? `<span class="tag${eu(reg) ? ' minha' : ''}">${nomeCurto(reg)}</span>` : '';

    const itens = trocas.map(t => {
        const ganho = eu(t.novoReg), perda = eu(t.antigoReg);
        const classe = ganho && !perda ? 'ganho' : perda && !ganho ? 'perda' : '';
        const selo = ganho && !perda ? '<span class="selo">GANHOU</span> '
            : perda && !ganho ? '<span class="selo">PERDEU</span> ' : '';
        return `<li class="${classe} clicavel" onclick="abrirGrupo('${t.grupo.replace(/'/g, "\\'")}','${t.novo}')"
            title="Ver a tabela do ${t.grupo}">
            ${selo}<b>${t.novo}</b> ${tag(t.novoReg)} assume a liderança do <b>${t.grupo}</b>
            com ${t.ptsNovo} pts, no lugar de <b>${t.antigo}</b> ${tag(t.antigoReg)}
            <small>· ${t.antigo} cai para ${t.posAntigo}º com ${t.ptsAntigo} pts</small>
        </li>`;
    }).join('');

    const ganhas = trocas.filter(t => t.novoReg === REGIONAL_DESTAQUE && t.antigoReg !== REGIONAL_DESTAQUE).length;
    const perdidas = trocas.filter(t => t.antigoReg === REGIONAL_DESTAQUE && t.novoReg !== REGIONAL_DESTAQUE).length;

    let resumo;
    if (ganhas && perdidas) resumo = `Sua regional <b>ganha ${ganhas}</b> e <b>perde ${perdidas}</b> liderança(s).`;
    else if (ganhas) resumo = `Sua regional <b>ganha ${ganhas}</b> liderança(s) e não perde nenhuma.`;
    else if (perdidas) resumo = `Sua regional <b>perde ${perdidas}</b> liderança(s) e não ganha nenhuma.`;
    else resumo = 'Nenhuma das trocas envolve lojas da sua regional.';

    return `<div class="pg-texto">
        <b>${trocas.length}</b> ${trocas.length === 1 ? 'grupo troca' : 'grupos trocam'} de líder
        com a projeção da rodada ${st.semana}. ${resumo}
        <ul class="pg-lista pg-lista-trocas">${itens}</ul>
    </div>`;
}

function panoramaHtml() {
    const { tot, g4, z4, trocas, combos } = calcularPanorama();
    const regs = Object.keys(tot).sort();

    const linhas = regs.map(r => {
        const t = tot[r];
        const eu = r === REGIONAL_DESTAQUE;
        return `<tr class="${eu ? 'dest' : ''}">
            <td class="l">${nomeCurto(r)}${eu ? ' ★' : ''}</td>
            <td>${t.base.lider}</td><td class="pts">${t.sim.lider}</td><td>${delta(t.base.lider, t.sim.lider)}</td>
            <td>${t.base.top4}</td><td class="pts">${t.sim.top4}</td><td>${delta(t.base.top4, t.sim.top4)}</td>
            <td>${t.base.ultimos4}</td><td class="pts">${t.sim.ultimos4}</td><td>${delta(t.base.ultimos4, t.sim.ultimos4, true)}</td>
        </tr>`;
    }).join('');

    const linhaJogo = (m) => m.adv
        ? `<small>· ${m.adv} na rodada ${st.semana}, +${m.ganhou} pt(s)</small>`
        : '<small>· sem jogo nesta rodada</small>';

    const selo = { entrou: 'ENTROU', saiu: 'SAIU', ficou: '' };

    // Diferença 0 significa empate em pontos decidido no desempate — dizer
    // "0 pts para sair do Z4" daria a impressão de que já está fora.
    const gapTxt = (g, sufixo) => g === 0
        ? `empatada em pontos ${sufixo}, atrás no desempate`
        : `${g} pt(s) ${sufixo}`;

    // A cor segue o GANHO: entrar/sair da zona é o sinal mais forte, mas quem
    // fica e melhora de posição também é ganho.
    const corMov = (m, entrarEhBom) => {
        if (m.para === 1 && m.de !== 1) return 'ganho';
        if (m.de === 1 && m.para !== 1) return 'perda';
        if (m.situacao === 'entrou') return entrarEhBom ? 'ganho' : 'perda';
        if (m.situacao === 'saiu') return entrarEhBom ? 'perda' : 'ganho';
        const d = m.de - m.para;
        return d > 0 ? 'ganho' : d < 0 ? 'perda' : '';
    };

    const setaMov = (m) => {
        const d = m.de - m.para;
        if (d > 0) return `<span class="mov sobe">▲ ${d}</span>`;
        if (d < 0) return `<span class="mov desce">▼ ${-d}</span>`;
        return '<span class="mov igual">–</span>';
    };

    // Selo próprio para a liderança — cor sozinha não basta para distinguir
    // "assumiu o grupo" de "subiu uma posição qualquer".
    const seloLideranca = (m) => {
        if (m.para === 1 && m.de !== 1) return '<span class="selo-lider ganhou">🥇 ASSUMIU A LIDERANÇA</span>';
        if (m.de === 1 && m.para !== 1) return '<span class="selo-lider perdeu">🥈 PERDEU A LIDERANÇA</span>';
        if (m.para === 1) return '<span class="selo-lider segue">🥇 SEGUE LÍDER</span>';
        return '';
    };

    // Agrupa os movimentos em blocos com título, para os itens coloridos não
    // ficarem espalhados no meio dos neutros.
    const secoes = (lista, entrarEhBom) => {
        const usado = new Set();
        const pega = (fn) => lista.filter(m => !usado.has(m) && fn(m)).map(m => (usado.add(m), m));
        const defs = entrarEhBom ? [
            ['🥇 Assumiram a liderança', m => m.para === 1 && m.de !== 1],
            ['🥈 Perderam a liderança', m => m.de === 1 && m.para !== 1],
            ['🟢 Entraram no G4', m => m.situacao === 'entrou'],
            ['🔻 Saíram do G4', m => m.situacao === 'saiu'],
            ['▲ Subiram dentro do G4', m => m.para < m.de],
            ['▼ Caíram dentro do G4', m => m.para > m.de],
            ['— Sem mudança de posição', () => true]
        ] : [
            ['🟢 Saíram do Z4', m => m.situacao === 'saiu'],
            ['🔻 Entraram no Z4', m => m.situacao === 'entrou'],
            ['▲ Subiram dentro do Z4', m => m.para < m.de],
            ['▼ Caíram dentro do Z4', m => m.para > m.de],
            ['— Sem mudança de posição', () => true]
        ];
        return defs.map(([titulo, fn]) => ({ titulo, itens: pega(fn) })).filter(x => x.itens.length);
    };

    // Frase do confronto direto com a referência — critério de desempate.
    const fraseDireto = (m) => {
        if (!m.ref) return '';
        if (m.refPassados && m.refPassados.length) {
            const sd = m.refSaldo;
            const placares = m.refPassados.map(j => `rodada ${j.rodada} (${j.meus} x ${j.dele})`).join(' e ');
            const lado = sd.vantagem === 'a favor' ? 'o desempate está <b>a seu favor</b>'
                : sd.vantagem === 'contra' ? 'o desempate está <b>contra você</b>'
                    : 'o desempate segue <b>empatado</b>';
            return ` No confronto direto já se enfrentaram na ${placares} — ${lado}.`;
        }
        if (m.refProximo) {
            return ` Ainda se enfrentam na <b>rodada ${m.refProximo}</b> — confronto direto valendo o desempate.`;
        }
        return ' Não se enfrentam mais no campeonato.';
    };

    const fraseJogo = (m) => {
        if (!m.adv) return `Não joga na rodada ${st.semana}.`;
        return `Está jogando a rodada ${st.semana} contra <b>${m.adv}</b> e
            <b>${m.resultado}</b> por ${m.gm} x ${m.gs} (${m.ganhou} pt).`;
    };

    const fraseG4 = (m) => {
        if (m.para === 1) {
            const f = m.folga === null ? ''
                : m.folga > 0 ? ` Com esse resultado <b>lidera o grupo</b> com ${m.folga} pt(s) de folga sobre ${m.vice}.`
                    : ` Com esse resultado <b>lidera o grupo</b>, empatado em pontos com ${m.vice} e à frente no desempate.`;
            return fraseJogo(m) + f + fraseDireto(m);
        }
        if (m.situacao === 'saiu') {
            return fraseJogo(m) + ` Com esse resultado <b>cai para ${m.para}º</b> e fica
                ${m.gapG4 === 0 ? 'empatado em pontos com o 4º, atrás no desempate' : `a ${m.gapG4} pt(s) do 4º lugar`}.`
                + fraseDireto(m);
        }
        return fraseJogo(m) + ` Com esse resultado fica em <b>${m.para}º</b>,
            ${m.gapLider === 0 ? 'empatado em pontos com o líder ' + m.lider + ' e atrás no desempate'
                : `a ${m.gapLider} pt(s) do líder <b>${m.lider}</b>`}.`
            + fraseDireto(m);
    };

    const fraseZ4 = (m) => {
        if (m.situacao === 'saiu') {
            return fraseJogo(m) + ` Com esse resultado <b>sai da zona de queda</b> para ${m.para}º,
                ${m.margem === 0 ? 'empatado em pontos com o Z4 e à frente só no desempate'
                    : `com ${m.margem} pt(s) de folga`}.` + fraseDireto(m);
        }
        return fraseJogo(m) + ` Com esse resultado fica em <b>${m.para}º</b>, dentro do Z4, e precisa
            ${m.gapSalvacao === 0 ? 'apenas do desempate' : `de ${m.gapSalvacao} pt(s)`}
            para alcançar ${m.ref ? `<b>${m.ref}</b>, o 1º fora da zona` : 'a saída da zona'}.`
            + fraseDireto(m);
    };

    const itemMov = (m, entrarEhBom) => {
        const classe = corMov(m, entrarEhBom);
        return `<li class="${classe} clicavel" onclick="abrirGrupo('${m.grupo.replace(/'/g, "\\'")}','${m.time}')"
            title="Ver a tabela do ${m.grupo}">
            <div class="mov-topo">${seloLideranca(m)}
                <b>${m.time}</b> · ${m.grupo} — ${m.de}º → <b>${m.para}º</b> ${setaMov(m)}</div>
            <div class="mov-frase">${entrarEhBom ? fraseG4(m) : fraseZ4(m)}</div>
        </li>`;
    };

    const listaAgrupada = (lista, entrarEhBom, vazio) => {
        if (!lista.length) return `<li>${vazio}</li>`;
        return secoes(lista, entrarEhBom).map(sec =>
            `<li class="sec-titulo">${sec.titulo} <span class="sec-n">${sec.itens.length}</span></li>`
            + sec.itens.map(m => itemMov(m, entrarEhBom)).join('')
        ).join('');
    };

    const g4Html = listaAgrupada(g4, true, `Nenhuma loja sua no G4 ${st.grupo ? 'deste grupo' : 'destes grupos'}.`);
    const z4Html = listaAgrupada(z4, false, 'Nenhuma loja sua na zona de queda. 🎉');

    const cont = (lista, sit) => lista.filter(x => x.situacao === sit).length;

    const check = (ok) => ok ? '<span class="ck sim">✔</span>' : '<span class="ck nao">✖</span>';
    const combosHtml = combos.length ? combos.slice(0, 14).map(c => `
        <li class="${c.completo ? 'ganho' : ''} clicavel" onclick="abrirGrupo('${c.grupo.replace(/'/g, "\\'")}','${c.beneficiada}')"
            title="Ver a tabela do ${c.grupo}">
            <div class="combo-topo">
                <b>${c.beneficiada}</b> (${c.posBeneficiada}º) pode encostar em
                <b>${c.rival}</b> (${c.posRival}º) — ${c.gap === 0 ? 'empatados em pontos' : `${c.gap} pt(s) de diferença`}
            </div>
            <div class="combo-passo">${check(c.venceCarrasco)}
                <b>${c.carrasco}</b> vence ${c.rival} <small>· projetado ${c.placarCarrasco}</small></div>
            <div class="combo-passo">${check(c.venceMinha)}
                <b>${c.beneficiada}</b> vence ${c.advBeneficiada || '—'}
                <small>· projetado ${c.placarBeneficiada || 's/ jogo'}</small></div>
            <div class="combo-status">${c.completo
                ? 'A combinação está de pé na projeção de agora.'
                : 'Falta virar ' + [!c.venceCarrasco ? c.carrasco : null, !c.venceMinha ? c.beneficiada : null].filter(Boolean).join(' e ') + '.'}</div>
        </li>`).join('') : '<li>Nenhuma loja sua enfrenta um rival que atrapalha outra loja sua nesta rodada.</li>';

    return `
    <div class="painel-geral">
        <div class="pg-bloco">
            <h3>🌎 Panorama das 14 lideranças <small>· campeonato inteiro, não muda com o filtro</small></h3>
            <div class="tab-wrap"><table class="tab-grupo tab-pan">
                <thead><tr>
                    <th class="l">Regional</th>
                    <th colspan="3">Lideranças</th>
                    <th colspan="3">Top 4</th>
                    <th colspan="3" title="Zona de queda — quanto menos lojas, melhor">Últimos 4 ↓</th>
                </tr><tr class="sub">
                    <th class="l"></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                    <th>R${st.rodadaBase}</th><th>Sim.</th><th></th>
                </tr></thead>
                <tbody>${linhas}</tbody>
            </table></div>
            ${textoTrocas(trocas)}
        </div>

        <div class="pg-bloco">
            <h3>🟢 Movimentações no G4 <small>· 4 primeiros ${st.grupo ? 'do grupo' : 'de cada grupo'}</small></h3>
            <div class="pg-resumo">
                ${g4.filter(m => m.para === 1).length} liderança(s) ·
                ${cont(g4, 'entrou')} entrada(s) · ${cont(g4, 'saiu')} saída(s) · ${g4.length} loja(s)
            </div>
            <ul class="pg-lista">${g4Html}</ul>
        </div>

        <div class="pg-bloco">
            <h3>🔴 Movimentações no Z4 <small>· 4 últimos ${st.grupo ? 'do grupo' : 'de cada grupo'}</small></h3>
            <div class="pg-resumo">
                ${cont(z4, 'saiu')} saída(s) · ${cont(z4, 'entrou')} entrada(s) · ${z4.length} loja(s)
            </div>
            <ul class="pg-lista">${z4Html}</ul>
            <div class="pg-nota">Lojas da ${nomeCurto(REGIONAL_DESTAQUE)}. Posições após a projeção da rodada ${st.semana}.</div>
        </div>

        <div class="pg-bloco pg-largo">
            <h3>🤝 A regional jogando junto <small>· quando uma loja sua ajuda a outra</small></h3>
            <div class="pg-resumo">
                ${combos.filter(c => c.completo).length} combinação(ões) já de pé · ${combos.length} no total
            </div>
            <ul class="pg-lista pg-lista-combo">${combosHtml}</ul>
            <div class="pg-nota">Uma loja sua enfrentando o rival de outra loja sua. As duas precisam vencer
                para a companheira ganhar terreno.</div>
        </div>
    </div>`;
}

function render() {
    const painel = document.getElementById('painel');
    const base = st.grupos[st.grupo] || [];
    const { proj, semDados } = projecaoDaRodada();
    st.projAtual = proj;   // usado pelo tooltip da sigla

    const atual = ordenar(base);
    const posBase = {};
    atual.forEach((r, i) => posBase[r.time] = i + 1);

    const simulado = ordenar(base.map(r => {
        const p = proj[r.time];
        if (!p) return { ...r, semJogo: true };
        return {
            ...r,
            pts: r.pts + p.pts, jogos: r.jogos + 1,
            vit: r.vit + p.vit, emp: r.emp + p.emp, der: r.der + p.der,
            gm: r.gm + p.gm, gs: r.gs + p.gs, sg: (r.gm + p.gm) - (r.gs + p.gs),
            ganhou: p.pts
        };
    }));

    const semJogo = simulado.filter(r => r.semJogo).length;

    // Insights: todos os grupos, ou só o escolhido nos chips.
    const todosItens = calcularInsightsTopo();
    const itens = st.grupo ? todosItens.filter(x => x.grupo === st.grupo) : todosItens;
    const blocoInsights = `
    <div class="pg-bloco pg-largo bloco-insights">
        <h3>🎯 Oportunidades na parte de cima da tabela <small>· lojas suas do ${CORTE_TOPO}º para cima${st.grupo ? ' · ' + st.grupo : ' · todos os grupos'}</small></h3>
        <div class="pg-resumo">${itens.length} loja(s) sua(s) na disputa da parte de cima</div>
        <ul class="pg-lista pg-lista-ins">${insightsTopoHtml(itens)}</ul>
        <div class="pg-nota">Confrontos futuros vindos de “TODOS OS JOGOS.xlsx”.
            ⚔ marca jogo direto contra o alvo; 🛡 marca rodadas em que o rival ainda enfrenta lojas suas.</div>
    </div>`;

    const semTabela = !st.grupo;

    // Números que aparecem fechados, no cabeçalho do box
    const pan = calcularPanorama();
    const g4Resumo = `${pan.g4.filter(m => m.para === 1).length} liderança(s) no G4`;
    const combosResumo = `${pan.combos.filter(c => c.completo).length} combinação(ões) de pé`;

    // Aberto por padrão; se o usuário recolher, a escolha dele é mantida
    // ao trocar de grupo ou de rodada.
    const aberto = st.insightsAberto !== false;

    painel.innerHTML = `
    ${!st.semana ? `<div class="alerta-info" style="margin-bottom:14px">
        A classificação da pasta já vai até a rodada ${st.rodadaBase} e não há rodada
        posterior publicada para projetar. Assim que a rodada ${st.rodadaBase + 1} tiver
        confrontos, a simulação aparece aqui.</div>`
    : semDados ? `<div class="alerta-info" style="margin-bottom:14px">
        A rodada ${st.semana} ainda não tem vendas lançadas — nenhum resultado é atribuído,
        então a coluna simulada repete a classificação atual. Ela passa a se mover
        assim que o primeiro dia da rodada for lançado.</div>` : ''}
    ${semTabela ? `<div class="alerta-info">Escolha um grupo acima para ver as duas tabelas lado a lado.</div>` : `
    <div class="comparacao">
        <div class="quadro atual">
            <div class="quadro-head">📋 Classificação atual <small>até a rodada ${st.rodadaBase}</small></div>
            <div class="tab-wrap">${tabela(atual, null, false)}</div>
            <div class="legenda">Fonte: pasta “Classificação Lojas” do SharePoint.</div>
        </div>
        <div class="quadro sim">
            <div class="quadro-head">🔮 Simulada <small>rodada ${st.rodadaBase}${st.semana ? ` + projeção da ${st.semana}` : ''}</small></div>
            <div class="tab-wrap">${tabela(simulado, posBase, true)}</div>
            <div class="legenda">Desempate: Pts › VIT › SG › GM — mesma ordem do
                painel oficial. Pelo regulamento, empates que persistem no saldo vão a
                confronto direto, share MP e turn over, que o app não calcula.${semJogo ? ` ${semJogo} loja(s) sem jogo nesta rodada.` : ''}</div>
        </div>
    </div>`}

    <details class="box-insights" id="boxInsights" ${aberto ? 'open' : ''}>
        <summary>
            <span class="bi-titulo">💡 Insights</span>
            <span class="bi-resumo">${itens.length} loja(s) na parte de cima ·
                ${g4Resumo} · ${combosResumo}</span>
            <span class="bi-seta">▾</span>
        </summary>
        <div class="bi-corpo">
            ${panoramaHtml()}
            ${blocoInsights}
        </div>
    </details>`;

    const box = document.getElementById('boxInsights');
    if (box) box.addEventListener('toggle', () => { st.insightsAberto = box.open; });

    // dados prontos para o exportador de imagem
    window.__dadosExportGrupo = {
        grupo: st.grupo, rodadaBase: st.rodadaBase, rodadaProj: st.semana,
        atual: atual.map((r, i) => ({ ...r, pos: i + 1 })),
        simulado: simulado.map((r, i) => ({ ...r, pos: i + 1, movNum: posBase[r.time] - (i + 1) }))
    };

    info(st.grupo
        ? `📊 ${st.grupo} · ${base.length} lojas · base até a rodada ${st.rodadaBase}`
          + (st.semana ? ` + projeção da rodada ${st.semana}` : ' · sem rodada a projetar')
        : `📊 Todos os 14 grupos · base até a rodada ${st.rodadaBase}`
          + (st.semana ? ` + projeção da rodada ${st.semana}` : ''));
}

function tabela(linhas, posBase, ehSim) {
    const corpo = linhas.map((r, i) => {
        const pos = i + 1;
        let mov = '';
        if (posBase) {
            const d = posBase[r.time] - pos;
            mov = d > 0 ? `<span class="mov sobe">▲ ${d}</span>`
                : d < 0 ? `<span class="mov desce">▼ ${-d}</span>`
                    : '<span class="mov igual">–</span>';
        }
        const dest = st.destacar && st.minhasLojas.has(r.time) ? ' dest' : '';
        const foco = st.lojaFoco === r.time ? ' foco' : '';
        const ganho = ehSim && r.ganhou !== undefined
            ? `<td class="c" title="Pontos ganhos na rodada ${st.semana}">+${r.ganhou}</td>` : (ehSim ? '<td class="c">—</td>' : '');
        return `<tr class="${(dest + foco).trim()}">
            <td>${pos}</td>
            ${posBase ? `<td>${mov}</td>` : ''}
            <td class="l"><span class="sigla" data-jogo="${confrontoTexto(r.time)}"
                onclick="event.stopPropagation(); abrirDetalhesJogo('${r.time}')">${r.time}</span></td>
            <td class="pts">${r.pts}</td>
            ${ganho}
            <td>${r.jogos}</td><td>${r.vit}</td><td>${r.emp}</td><td>${r.der}</td>
            <td>${r.gm}</td><td>${r.gs}</td><td>${r.sg}</td></tr>`;
    }).join('');

    return `<table class="tab-grupo">
        <thead><tr>
            <th>#</th>${posBase ? '<th>Mov.</th>' : ''}<th class="l">Time</th><th>Pts</th>
            ${ehSim ? '<th>+Rod.</th>' : ''}
            <th>J</th><th>V</th><th>E</th><th>D</th><th>GM</th><th>GS</th><th>SG</th>
        </tr></thead><tbody>${corpo}</tbody></table>`;
}

function confrontoTexto(time) {
    const p = (st.projAtual || {})[time];
    if (!p) return `${time} · sem jogo na rodada ${st.semana || '-'}`;
    return `${time} ${p.gm} × ${p.gs} ${p.adv}`;
}

// Tooltip próprio: o title nativo demora ~1s para aparecer.
let _tip = null;
function setupTooltipSigla() {
    document.addEventListener('mouseover', (e) => {
        const alvo = e.target.closest('.sigla[data-jogo]');
        if (!alvo) return;
        prefetchJogo(alvo.textContent.trim());
        if (!_tip) {
            _tip = document.createElement('div');
            _tip.className = 'tip-jogo';
            document.body.appendChild(_tip);
        }
        _tip.textContent = alvo.dataset.jogo;
        _tip.style.display = 'block';
    });
    document.addEventListener('mousemove', (e) => {
        if (!_tip || _tip.style.display !== 'block') return;
        _tip.style.left = (e.clientX + 14) + 'px';
        _tip.style.top = (e.clientY + 16) + 'px';
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('.sigla[data-jogo]') && _tip) _tip.style.display = 'none';
    });
}

setupTooltipSigla();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}
