/* Campeãs matemáticas do campeonato.
 *
 * O campeonato tem 19 rodadas (20 lojas por grupo, todos contra todos). Uma
 * loja é campeã quando os pontos dela são maiores que o MÁXIMO que qualquer
 * rival ainda pode alcançar (pontos atuais + 3 por jogo que falta). Empate de
 * pontos não conta: o app não calcula os critérios finais de desempate.
 * Vale só a classificação OFICIAL (pasta "Classificação Lojas"), nunca a
 * projeção da rodada em andamento.
 */
const CAMP_TOTAL_RODADAS = 19;
const CAMP_CHAVE_VISTAS = 'campeas_vistas_v1';

const campRestam = (r) => Math.max(0, CAMP_TOTAL_RODADAS - (r.jogos || 0)) * 3;
const campMaximo = (r) => r.pts + campRestam(r);

// linhas: classificação de um grupo (qualquer ordem). Devolve a análise do grupo.
function campAnalisarGrupo(linhas) {
    if (!linhas || !linhas.length) return null;
    const ord = linhas.slice().sort((a, b) =>
        b.pts - a.pts || b.vit - a.vit || b.sg - a.sg || b.gm - a.gm || a.time.localeCompare(b.time));
    const lider = ord[0];
    const rivais = ord.slice(1);
    const teto = rivais.length ? Math.max(...rivais.map(campMaximo)) : 0;
    const rodadasFalta = Math.max(0, CAMP_TOTAL_RODADAS - (lider.jogos || 0));
    return {
        lider, teto, rodadasFalta,
        camp: lider.pts > teto,
        precisa: Math.max(0, teto + 1 - lider.pts)
    };
}

function campAnalisarTodos(grupos) {
    const r = {};
    Object.entries(grupos || {}).forEach(([nome, linhas]) => {
        const a = campAnalisarGrupo(linhas);
        if (a) r[nome] = a;
    });
    return r;
}

/* ---------- dados (uma busca só por página) ---------- */
let _campDados = null;
function campCarregar() {
    if (!_campDados) {
        const get = (p) => fetch(`/api${p}`, { cache: 'no-store' }).then(r => {
            if (!r.ok) throw new Error(r.status);
            return r.json();
        });
        _campDados = Promise.all([get('/classificacao'), get('/estrutura').catch(() => ({}))])
            .then(([cls, est]) => {
                const e = est.estrutura || est || {};
                const loja = {};
                Object.entries(e).forEach(([reg, ds]) =>
                    Object.entries(ds || {}).forEach(([dist, ls]) =>
                        (ls || []).forEach(l => { loja[l] = { regional: reg, distrito: dist }; })));
                return { rodada: cls.rodada, grupos: cls.grupos, analise: campAnalisarTodos(cls.grupos), loja };
            })
            .catch(e => { _campDados = null; throw e; });
    }
    return _campDados;
}

const campCurto = (g) => g.replace('Série ', '').replace(' - Grupo ', ' · G');
const campEsc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- projeção da rodada em andamento ---------- */
// Classificação oficial + o placar projetado de cada jogo da rodada atual.
// Jogos sem nenhuma venda lançada (semDados) não entram: projetariam empate 0x0.
function campProjetarGrupos(grupos, jogos) {
    const por = {};
    (jogos || []).forEach(g => {
        if (g.semDados || !g.scoreProjected) return;
        const m = String(g.scoreProjected).match(/(\d+)\s*x\s*(\d+)/i);
        if (!m) return;
        const a = +m[1], b = +m[2];
        por[g.team1] = { gm: a, gs: b };
        por[g.team2] = { gm: b, gs: a };
    });
    const novos = {};
    Object.entries(grupos || {}).forEach(([nome, linhas]) => {
        novos[nome] = linhas.map(r => {
            const p = por[r.time];
            if (!p) return r;
            const pts = p.gm > p.gs ? 3 : (p.gm === p.gs ? 1 : 0);
            return { ...r, pts: r.pts + pts, jogos: r.jogos + 1,
                vit: r.vit + (pts === 3 ? 1 : 0), emp: r.emp + (pts === 1 ? 1 : 0), der: r.der + (pts === 0 ? 1 : 0),
                gm: r.gm + p.gm, gs: r.gs + p.gs, sg: r.sg + p.gm - p.gs };
        });
    });
    return campAnalisarTodos(novos);
}

let _campResumo = null;
async function campResumoDaRodada() {
    if (!_campResumo) {
        _campResumo = fetch('/api/semana', { cache: 'no-store' }).then(r => r.json())
            .then(s => fetch(`/api/games-summary/${s.semana}`, { cache: 'no-store' }))
            .then(r => r.json()).catch(() => null);
    }
    return _campResumo;
}

/* ---------- box da página inicial ---------- */
async function campPreencherBox(idBox, resumo) {
    const el = document.getElementById(idBox);
    if (!el) return;
    let d;
    try { d = await campCarregar(); } catch (e) { return; }
    const nomes = Object.keys(d.analise);
    if (!nomes.length) return;
    // Projeção: só faz sentido se a rodada do resumo ainda não está na classificação oficial.
    let proj = {};
    try {
        const rs = resumo && resumo.games ? resumo : await campResumoDaRodada();
        if (rs && rs.games && Number(rs.week) > Number(d.rodada)) proj = campProjetarGrupos(d.grupos, rs.games);
    } catch (e) { proj = {}; }
    const projeta = (n) => !d.analise[n].camp && proj[n] && proj[n].camp && proj[n].lider.time === d.analise[n].lider.time;
    const camps = nomes.filter(n => d.analise[n].camp);
    const projetadas = nomes.filter(projeta);
    const disp = nomes.filter(n => !d.analise[n].camp && !projeta(n))
        .sort((a, b) => d.analise[a].precisa - d.analise[b].precisa);
    const cartao = (n, a, proj) => {
        const l = a.lider, e = d.loja[l.time];
        return `<div class="camp-card${proj ? ' proj' : ''}"${proj
            ? ` title="Com os resultados projetados da rodada em andamento, ${campEsc(l.time)} garante o título. Ainda não é oficial."` : ''}>
            <span class="camp-tr">🏆</span>
            <b>${campEsc(l.time)}</b><small>${campEsc(n)}</small>
            ${e ? `<small>${campEsc(e.distrito)} · ${campEsc(e.regional)}</small>` : ''}
            <span class="camp-tag">${l.pts} pts · ${proj ? 'projetado, aguarda confirmação' : 'título garantido'}</span></div>`;
    };
    const cartoes = camps.map(n => cartao(n, d.analise[n], false)).join('')
        + projetadas.map(n => cartao(n, proj[n], true)).join('');
    const prox = disp[0] && d.analise[disp[0]];
    el.innerHTML = `
    <section class="camp-box">
        <div class="camp-head">🏆 Campeãs do campeonato
            <small>· ${camps.length} de ${nomes.length} grupos decididos${projetadas.length
                ? ` · ${projetadas.length} projetada${projetadas.length > 1 ? 's' : ''}` : ''} (classificação oficial até a rodada ${d.rodada})</small></div>
        ${cartoes ? `<div class="camp-cards">${cartoes}</div>`
            : `<div class="camp-vazio">Nenhuma loja campeã matemática ainda.${prox
                ? `<br>Mais perto: <b>${campEsc(prox.lider.time)}</b> (${campEsc(campCurto(disp[0]))}), precisa de +${prox.precisa} pts.` : ''}</div>`}
        ${projetadas.length ? `<div class="camp-leg camp-leg-proj">Cartões cinza com borda pontilhada: com os resultados projetados da rodada em andamento a loja se garante campeã. Só vale quando a classificação oficial confirmar.</div>` : ''}
        ${disp.length ? `<div class="camp-disputa"><h4>Em disputa (${disp.length} grupos) — pontos que o líder ainda precisa para garantir o título</h4>
            <div class="camp-lista">${disp.map(n => `<span><b>${campEsc(d.analise[n].lider.time)}</b> ${campEsc(campCurto(n))} · +${d.analise[n].precisa}</span>`).join('')}</div></div>` : ''}
    </section>`;
}

/* ---------- faixa do grupo (tela de classificação) ---------- */
function campFaixaGrupo(a, titulo, proj) {
    if (!a) return '';
    return `<div class="camp-faixa${proj ? ' proj' : ''}">
        ${titulo ? `<div class="camp-faixa-tit">${titulo}</div>` : ''}
        <div class="camp-kpi"><span>Rodadas restantes</span><b>${a.rodadasFalta} de ${CAMP_TOTAL_RODADAS}</b></div>
        <div class="camp-kpi"><span>Pts em disputa por loja</span><b>${a.rodadasFalta * 3}</b></div>
        ${a.camp
            ? `<div class="camp-kpi ouro"><span>${proj ? 'Campeã na projeção' : 'Campeã'}</span><b>🏆 ${campEsc(a.lider.time)}</b></div>`
            : `<div class="camp-kpi"><span>Líder ${campEsc(a.lider.time)} precisa de</span><b>+${a.precisa} pts</b></div>`}
        <div class="camp-kpi"><span>Maior máximo dos rivais</span><b>${a.teto} pts</b></div>
    </div>`;
}

function campSituacao(a, r, pos) {
    if (!a) return '';
    if (a.camp && pos === 1) return '<span class="camp-sit ok">🏆 Campeã</span>';
    if (pos === 1) return `<span class="camp-sit">Líder · +${a.precisa} p/ garantir</span>`;
    return campMaximo(r) <= a.lider.pts
        ? '<span class="camp-sit zero">Sem chance do título</span>'
        : '<span class="camp-sit">Ainda pode</span>';
}

/* ---------- janela de comemoração ---------- */
function campLerVistas() {
    try { return new Set(JSON.parse(localStorage.getItem(CAMP_CHAVE_VISTAS) || '[]')); }
    catch (e) { return new Set(); }
}
function campGravarVista(chave) {
    try {
        const s = campLerVistas(); s.add(chave);
        localStorage.setItem(CAMP_CHAVE_VISTAS, JSON.stringify([...s]));
    } catch (e) { /* navegador sem storage: a janela só vai reaparecer */ }
}

function campAbrirJanela(nome, a, loja, fim) {
    const confete = Array.from({ length: 40 }, (_, i) =>
        `<i class="camp-conf" style="left:${(Math.random() * 100).toFixed(1)}%;background:${
            ['#d4a017', '#f6d365', '#2b5aa8', '#e53935', '#43a047'][i % 5]};animation-duration:${
            (2 + Math.random() * 2.5).toFixed(2)}s;animation-delay:${(Math.random() * 2).toFixed(2)}s"></i>`).join('');
    const fundo = document.createElement('div');
    fundo.className = 'camp-fundo';
    fundo.innerHTML = `<div class="camp-modal" role="dialog" aria-modal="true">
        ${confete}
        <div class="camp-trofeu">🏆</div>
        <h3>Temos uma campeã!</h3>
        <p class="camp-sub">Título garantido matematicamente</p>
        <div class="camp-loja">${campEsc(a.lider.time)}</div>
        <div>${campEsc(nome)}</div>
        <div class="camp-info"><b>${a.lider.pts} pontos</b> — nenhum rival consegue mais alcançar.${
            loja ? `<br>${campEsc(loja.distrito)} · ${campEsc(loja.regional)}` : ''}</div>
        <button class="camp-fechar">Parabéns! Fechar</button></div>`;
    const sair = () => { fundo.remove(); document.removeEventListener('keydown', esc); fim && fim(); };
    const esc = (e) => { if (e.key === 'Escape') sair(); };
    fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.classList.contains('camp-fechar')) sair(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(fundo);
}

// Mostra, uma de cada vez, as campeãs que esta pessoa ainda não viu.
async function campMostrarNovas() {
    let d;
    try { d = await campCarregar(); } catch (e) { return; }
    const vistas = campLerVistas();
    const fila = Object.entries(d.analise)
        .filter(([n, a]) => a.camp && !vistas.has(`${n}|${a.lider.time}`));
    const proxima = () => {
        const it = fila.shift();
        if (!it) return;
        const [n, a] = it;
        campGravarVista(`${n}|${a.lider.time}`);
        campAbrirJanela(n, a, d.loja[a.lider.time], proxima);
    };
    proxima();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(campMostrarNovas, 1500));
else setTimeout(campMostrarNovas, 1500);
