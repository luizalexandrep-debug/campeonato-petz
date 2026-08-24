/* ==========================================================================
   Comando de voz — "quanto foi o último jogo da loja Tietê".

   Usa a API de voz do próprio navegador (SpeechRecognition). Funciona em
   Chrome e Edge; no Firefox não existe, e aí o botão abre só o campo de texto,
   que aceita exatamente os mesmos comandos digitados.

   O casamento entre o que se fala e a sigla da loja é o ponto delicado:
   ninguém fala "TIET-SP", fala "Tietê". Como as siglas são abreviações do
   nome, a busca aceita a sigla como SUBSEQUÊNCIA do que foi dito — "ANHM"
   dentro de "Anhembi", "MOOC" dentro de "Mooca".
   ========================================================================== */

// Regional do usuário, para o atalho "minha regional".
const REGIONAL_VOZ = (typeof REGIONAL_DESTAQUE !== 'undefined') ? REGIONAL_DESTAQUE : 'R2';

const voz = {
    rec: null,
    ouvindo: false,
    painel: null,
    ultimoTexto: '',
    nomes: null,        // {sigla: "Parada de Taipas"}
    indice: null        // lista pronta para busca
};

// Carrega os nomes das lojas uma vez. Sem eles o casamento cai na heurística
// sobre a sigla, que erra em nome composto ("Parada de Taipas" -> PDTP).
async function vozCarregarNomes() {
    if (voz.nomes) return voz.nomes;
    try {
        const r = await fetch('/api/lojas-nomes', { cache: 'no-store' });
        const d = await r.json();
        voz.nomes = d.nomes || {};
    } catch (e) {
        console.warn('nomes das lojas indisponíveis', e);
        voz.nomes = {};
    }
    voz.indice = null;
    return voz.nomes;
}

function vozSuportada() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/* ---------- normalização e busca da loja ---------- */

function vozNormalizar(t) {
    return String(t || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// A sigla cabe dentro da palavra falada, na ordem? Devolve onde começa o
// encaixe e o "aperto" dele (quanto menor, mais colado), ou null se não couber.
function vozSubsequencia(sigla, dito) {
    let i = 0, primeiro = -1, ultimo = -1;
    for (let k = 0; k < dito.length && i < sigla.length; k++) {
        if (dito[k] === sigla[i]) {
            if (primeiro < 0) primeiro = k;
            ultimo = k;
            i++;
        }
    }
    if (i !== sigla.length) return null;
    return { inicio: primeiro, aperto: (ultimo - primeiro + 1) - sigla.length };
}

// Quantas letras da sigla não aparecem no que foi dito (contando repetições).
function vozLetrasFaltando(sigla, dito) {
    const sobra = dito.split('');
    let faltam = 0;
    for (const c of sigla) {
        const i = sobra.indexOf(c);
        if (i < 0) faltam++; else sobra.splice(i, 1);
    }
    return faltam;
}

/* ---------- adaptador: a mesma voz nas duas telas ----------

   A classificação por grupos e o dashboard têm funções diferentes para abrir
   as mesmas coisas (e até assinaturas diferentes de abrirDetalhesJogo). Em vez
   de duplicar o interpretador, cada página descreve aqui o que sabe fazer.
*/
function vozCtx() {
    const ehGrupos = typeof st !== 'undefined' && st && st.grupos;
    if (ehGrupos) {
        return {
            pagina: 'grupos',
            estrutura: () => st.estrutura || {},
            semana: () => st.semana,
            souAdmin: () => !!st.souAdmin,
            seletorRodada: () => document.getElementById('fRodada'),
            temJogo: (l) => !!(st.projAtual || {})[l],
            advDe: (l) => (st.projAtual || {})[l]?.adv,
            distrito: (l) => (typeof distritoDaLoja === 'function' ? distritoDaLoja(l) : ''),
            abrirJogo: (l) => abrirDetalhesJogo(l),
            abrirCalendario: (l) => abrirCalendarioDaLoja(l),
            abrirGrupoDaLoja: (l) => {
                const g = grupoDaLoja(l);
                if (!g) return false;
                abrirGrupo(g, l); return true;
            },
            grupoPorNumero: (n) => (st.nomesGrupos || []).find(g =>
                parseInt((g.match(/Grupo\s+(\d+)/) || [])[1] || 0, 10) === n),
            selecionarGrupo: (g) => selecionarGrupo(g),
            abrirResumo: () => abrirResumoRodada()
        };
    }
    // dashboard
    return {
        pagina: 'dashboard',
        estrutura: () => state.estrutura || {},
        semana: () => state.semana,
        souAdmin: () => false,
        seletorRodada: () => document.getElementById('filterSemana'),
        temJogo: (l) => !!vozJogoDoDashboard(l),
        advDe: (l) => {
            const g = vozJogoDoDashboard(l);
            return g ? (g.team1 === l ? g.team2 : g.team1) : null;
        },
        distrito: (l) => (typeof distritoDaLoja === 'function' ? distritoDaLoja(l) : ''),
        abrirJogo: (l) => {
            const g = vozJogoDoDashboard(l);
            if (!g) return false;
            abrirDetalhesJogo(g.team1, g.team2); return true;
        },
        abrirCalendario: (l) => abrirCalendarioLoja(l),
        abrirGrupoDaLoja: null,
        grupoPorNumero: null,
        selecionarGrupo: null,
        abrirResumo: null,
        abrirEvolucao: () => abrirEvolucaoRodada(),
        abrirDistrito: (reg, dist) => abrirJogosDistrito(reg, dist),
        filtrarRegional: (reg) => filtrarHomePorRegional(reg)
    };
}

function vozJogoDoDashboard(loja) {
    return (state.gamesSummary?.games || []).find(g => g.team1 === loja || g.team2 === loja);
}

function vozTodasAsLojas() {
    const lojas = new Set();
    Object.values(vozCtx().estrutura()).forEach(dists =>
        Object.values(dists).forEach(ls => ls.forEach(l => lojas.add(l))));
    if (typeof st !== 'undefined' && st && st.grupos) {
        Object.values(st.grupos).forEach(linhas => linhas.forEach(r => lojas.add(r.time)));
    }
    return [...lojas];
}

// Palavras que não ajudam a identificar a loja no nome dela.
const VOZ_LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'no', 'na']);

function vozIndice() {
    if (voz.indice) return voz.indice;
    const nomes = voz.nomes || {};
    voz.indice = vozTodasAsLojas().map(sigla => {
        const nome = nomes[sigla] || '';
        const n = vozNormalizar(nome);
        return {
            sigla,
            nome,
            nomeJunto: n.replace(/ /g, ''),
            // "Parada de Taipas" também vira "paradataipas": as pessoas comem
            // as preposições ao falar rápido.
            nomeCurto: n.split(' ').filter(w => !VOZ_LIGACOES.has(w)).join(''),
            tokens: n.split(' ').filter(w => w && !VOZ_LIGACOES.has(w))
        };
    });
    return voz.indice;
}

// Devolve os melhores candidatos para o trecho falado.
function vozAcharLojas(trecho) {
    const ditoBruto = vozNormalizar(trecho);
    const dito = ditoBruto.replace(/ /g, '');
    if (dito.length < 3) return [];
    const ditoCurto = ditoBruto.split(' ').filter(w => !VOZ_LIGACOES.has(w)).join('');
    const cand = [];

    // 1) Pelo NOME da loja — é o caminho natural e o mais preciso.
    vozIndice().forEach(it => {
        if (!it.nomeJunto) return;
        let pontos = null;
        if (dito === it.nomeJunto || ditoCurto === it.nomeCurto) pontos = -10;      // nome exato
        else if (it.nomeJunto.startsWith(dito) || dito.startsWith(it.nomeJunto)) pontos = -8;
        else if (it.nomeCurto.startsWith(ditoCurto) || ditoCurto.startsWith(it.nomeCurto)) pontos = -7;
        else if (it.nomeJunto.includes(dito) && dito.length >= 4) pontos = -5;
        else {
            // Todas as palavras ditas aparecem no nome? ("taipas" em
            // "Parada de Taipas"; "vitória conquista" em "Vitória da Conquista")
            const palavras = ditoBruto.split(' ').filter(w => w.length > 2 && !VOZ_LIGACOES.has(w));
            if (palavras.length && palavras.every(w => it.tokens.some(t => t.startsWith(w) || w.startsWith(t)))) {
                pontos = -4 + (it.tokens.length - palavras.length);
            }
        }
        if (pontos !== null) cand.push({ sigla: it.sigla, nome: it.nome, pontos, via: 'nome' });
    });
    if (cand.length) {
        cand.sort((a, b) => a.pontos - b.pontos || a.sigla.localeCompare(b.sigla));
        const melhor = cand[0].pontos;
        const faixa = melhor <= -8 ? 0 : 2;
        return cand.filter(c => c.pontos <= melhor + faixa).slice(0, 5);
    }

    // 2) Sem acerto por nome, tenta a sigla (também dá para falar "T I E T").
    vozTodasAsLojas().forEach(sigla => {
        const cheia = vozNormalizar(sigla).replace(/ /g, '');       // tietsp
        const base = cheia.replace(/(sp|rj|mg|rs|sc|pr|ba|pe|ce|go|df|ms|mt|am|pa|pi|rn|al|se|to|es|ma|pb|ro|ac|ap|rr)$/, '');
        let pontos = null;
        if (dito === cheia || dito === base) pontos = 0;                       // exato
        else if (dito.startsWith(base) || base.startsWith(dito)) pontos = 1;   // começo igual
        else {
            const enc = vozSubsequencia(base, dito);
            // Começar no início do nome vale mais que encaixar apertado no meio:
            // "Guarujá" é GUJA (do começo), não ARUJ (escondido no meio).
            if (enc) pontos = 2 + enc.aperto + enc.inicio * 2;
            else {
                // Última tentativa: nem toda sigla é subsequência do nome
                // ("Taubaté" é TBAO, e o 'o' não está lá). Aceita se a
                // primeira letra bate e quase todas as outras aparecem.
                const faltando = vozLetrasFaltando(base, dito);
                if (base[0] === dito[0] && faltando <= 1 && base.length >= 3) {
                    pontos = 12 + faltando * 4;
                }
            }
        }
        if (pontos !== null) cand.push({ sigla, pontos, base, nome: (voz.nomes || {})[sigla] || '', via: 'sigla' });
    });
    cand.sort((a, b) => a.pontos - b.pontos || a.sigla.localeCompare(b.sigla));
    // Devolve o bloco dos melhores. A faixa é um pouco larga de propósito:
    // "Aracaju" casa com ARAC e com ACJU, e é melhor oferecer as duas do que
    // abrir a janela errada em silêncio. Um encaixe perfeito não abre a faixa.
    if (!cand.length) return [];
    const melhor = cand[0].pontos;
    const faixa = melhor === 0 ? 0 : 4;
    return cand.filter(c => c.pontos <= melhor + faixa).slice(0, 5);
}

/* ---------- interpretação do comando ---------- */

function vozInterpretar(texto) {
    const t = vozNormalizar(texto);
    if (!t) return { tipo: 'vazio' };

    if (/\b(fechar|fecha|sair|cancelar)\b/.test(t)) return { tipo: 'fechar' };
    if (/\b(resumo|mesa redonda|roteiro)\b/.test(t)) return { tipo: 'resumo' };
    if (/\b(evolucao|grafico|evoluir)\b/.test(t)) return { tipo: 'evolucao' };

    // "regional 2", "minha regional", "regional do Thiago"
    if (/\bminha regional\b/.test(t)) return { tipo: 'regional', trecho: REGIONAL_VOZ };
    const reg = t.match(/\bregional\s+(?:do |da |de )?([a-z0-9]{1,20})/);
    if (reg && !/\bloja\b/.test(t)) return { tipo: 'regional', trecho: reg[1].trim() };

    // "distrito SP4", "jogos do distrito da Eliane", "distrito SP6 Patricia"
    const dist = t.match(/\bdistrito\s+(?:do |da |de )?([a-z0-9\- ]{2,24})/);
    if (dist) return { tipo: 'distrito', trecho: dist[1].trim() };

    const rod = t.match(/\brodada\s+(\d{1,2})\b/);
    if (rod && !/\bloja\b/.test(t)) return { tipo: 'rodada', n: parseInt(rod[1], 10) };

    // "grupo 7", "série c grupo 7"
    const gr = t.match(/\bgrupo\s+(\d{1,2})\b/);
    if (gr && !/\bloja\b/.test(t)) return { tipo: 'grupo', n: parseInt(gr[1], 10) };

    const querCalendario = /\b(calendario|proximos jogos|proximo jogo|agenda)\b/.test(t);
    const querGrupo = /\b(grupo|classificacao|tabela)\b/.test(t);

    // O nome da loja é o que sobra depois de tirar as palavras de comando.
    const trecho = t
        .replace(/\b(quanto|foi|qual|como|me|mostra|mostre|abrir|abre|ver|o|a|os|as|do|da|de|dos|das|no|na|em|ultimo|ultima|jogo|jogos|partida|resultado|placar|detalhe|detalhes|gols|gol|loja|unidade|calendario|proximos|proximo|agenda|grupo|classificacao|tabela|por favor|pra|para)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();

    const lojas = vozAcharLojas(trecho);
    if (!lojas.length) return { tipo: 'naoentendi', trecho, texto };
    const acao = querCalendario ? 'calendario' : (querGrupo ? 'grupo' : 'jogo');
    return { tipo: 'loja', acao, lojas, trecho };
}

/* ---------- execução ---------- */

// "SP4 - Eliane" pode ser chamado de "SP4" ou de "distrito da Eliane": casa
// com o nome inteiro ou com qualquer um dos lados do hífen.
function vozPartes(nome) {
    const inteiro = vozNormalizar(nome).replace(/ /g, '');
    const lados = String(nome).split(/[-–—\/]/).map(x => vozNormalizar(x).replace(/ /g, '')).filter(Boolean);
    return [inteiro, ...lados];
}

function vozCasaPartes(nome, alvo) {
    if (alvo.length < 2) return null;
    const partes = vozPartes(nome);
    for (let i = 0; i < partes.length; i++) {
        const p = partes[i];
        if (!p) continue;
        if (p === alvo) return i === 0 ? 0 : 1;              // igual
        if (p.startsWith(alvo) || alvo.startsWith(p)) return 2 + i;   // começo igual
        if (alvo.length >= 3 && p.includes(alvo)) return 5 + i;       // aparece dentro
    }
    return null;
}

function vozAcharDistrito(trecho) {
    const alvo = vozNormalizar(trecho).replace(/ /g, '');
    const achados = [];
    Object.entries(vozCtx().estrutura()).forEach(([reg, dists]) =>
        Object.keys(dists).forEach(d => {
            const p = vozCasaPartes(d, alvo);
            if (p !== null) achados.push({ regional: reg, distrito: d, pontos: p });
        }));
    achados.sort((a, b) => a.pontos - b.pontos);
    if (!achados.length) return [];
    const melhor = achados[0].pontos;
    return achados.filter(a => a.pontos <= melhor).slice(0, 5);
}

function vozAcharRegional(trecho) {
    const bruto = vozNormalizar(trecho).replace(/ /g, '');
    // "regional 2" quer dizer R2: o número sozinho vira a sigla.
    const alvos = /^\d$/.test(bruto) ? ['r' + bruto, bruto] : [bruto];
    const achados = [];
    Object.keys(vozCtx().estrutura()).forEach(r => {
        for (const alvo of alvos) {
            const p = vozCasaPartes(r, alvo);
            if (p !== null) { achados.push({ regional: r, pontos: p }); break; }
        }
    });
    return achados.sort((a, b) => a.pontos - b.pontos);
}

function vozExecutar(cmd) {
    const ctx = vozCtx();
    switch (cmd.tipo) {
        case 'fechar': {
            const abertos = document.querySelectorAll('.modal-fundo');
            if (abertos.length) abertos[abertos.length - 1].remove();
            vozFechar();
            return 'Fechei a janela.';
        }
        case 'resumo':
            if (!ctx.abrirResumo) return 'O resumo fica na tela de Classificação por grupos.';
            if (!ctx.souAdmin()) return 'O resumo está disponível só no usuário master.';
            vozFechar();
            ctx.abrirResumo();
            return 'Abrindo o resumo.';
        case 'evolucao':
            if (!ctx.abrirEvolucao) return 'O gráfico de evolução fica no Dashboard.';
            vozFechar();
            ctx.abrirEvolucao();
            return 'Abrindo a evolução da rodada.';
        case 'rodada': {
            const sel = ctx.seletorRodada();
            const op = sel && [...sel.options].find(o => parseInt(o.value, 10) === cmd.n);
            if (!op) return `A rodada ${cmd.n} não está disponível no seletor.`;
            sel.value = op.value;
            sel.dispatchEvent(new Event('change'));
            vozFechar();
            return `Abrindo a rodada ${cmd.n}.`;
        }
        case 'regional': {
            const achadas = vozAcharRegional(cmd.trecho);
            if (!achadas.length) return `Não achei a regional “${cmd.trecho}”.`;
            if (!ctx.filtrarRegional) return 'O filtro por regional fica no Dashboard.';
            ctx.filtrarRegional(achadas[0].regional);
            vozFechar();
            return `Filtrando por ${achadas[0].regional}.`;
        }
        case 'distrito': {
            const achados = vozAcharDistrito(cmd.trecho);
            if (!achados.length) return `Não achei o distrito “${cmd.trecho}”.`;
            if (!ctx.abrirDistrito) return 'Os jogos por distrito ficam no Dashboard.';
            if (achados.length > 1) return null;
            vozFechar();
            ctx.abrirDistrito(achados[0].regional, achados[0].distrito);
            return `Abrindo os jogos do ${achados[0].distrito}.`;
        }
        case 'grupo': {
            if (!ctx.grupoPorNumero) return 'Os grupos ficam na tela de Classificação por grupos.';
            const nome = ctx.grupoPorNumero(cmd.n);
            if (!nome) return `Não achei o grupo ${cmd.n}.`;
            ctx.selecionarGrupo(nome);
            vozFechar();
            return `Mostrando o ${nome}.`;
        }
        case 'loja':
            if (cmd.lojas.length === 1) return vozAbrirLoja(cmd.lojas[0].sigla, cmd.acao);
            return null;   // ambíguo: o painel mostra as opções
        default:
            return null;
    }
}

function vozAbrirLoja(sigla, acao) {
    const ctx = vozCtx();
    vozFechar();
    if (acao === 'calendario') { ctx.abrirCalendario(sigla); return `Calendário de ${sigla}.`; }
    if (acao === 'grupo') {
        if (!ctx.abrirGrupoDaLoja) return 'A tabela por grupo fica em “Classificação por grupos”.';
        return ctx.abrirGrupoDaLoja(sigla) ? `Grupo de ${sigla}.` : `Não achei o grupo de ${sigla}.`;
    }
    if (!ctx.temJogo(sigla)) return `${sigla} não tem jogo na rodada ${ctx.semana()}.`;
    ctx.abrirJogo(sigla);
    const adv = ctx.advDe(sigla);
    const nome = (voz.nomes || {})[sigla];
    return `Abrindo ${nome ? nome + ' (' + sigla + ')' : sigla}${adv ? ' x ' + adv : ''}.`;
}

/* ---------- painel ---------- */

function vozPainelHtml() {
    return `
        <div class="voz-cx">
            <div class="voz-topo">
                <span class="voz-bola"></span>
                <b id="vozEstado">Diga o comando...</b>
                <button class="voz-x" onclick="vozFechar()">✕</button>
            </div>
            <div class="voz-texto" id="vozTexto">—</div>
            <div class="voz-resposta" id="vozResposta"></div>
            <input id="vozInput" class="voz-input" placeholder="ou digite: jogo da Tietê" autocomplete="off">
            <div class="voz-dicas">${vozDicas()}</div>
        </div>`;
}

function vozDicas() {
    const ctx = vozCtx();
    const base = ['“quanto foi o último jogo da loja Tietê”', '“calendário da Mooca”', '“rodada 8”'];
    const extra = ctx.pagina === 'grupos'
        ? ['“grupo do Anhembi”', '“grupo 7”', '“resumo”']
        : ['“jogos do distrito SP4”', '“regional 2”', '“evolução”'];
    return 'Exemplos: ' + [...base, ...extra, '“fechar”'].map(x => `<b>${x}</b>`).join(' · ');
}

function vozAbrirPainel() {
    vozCarregarNomes();          // assíncrono: o primeiro comando já pega
    if (voz.painel) return;
    const el = document.createElement('div');
    el.className = 'voz-painel';
    el.innerHTML = vozPainelHtml();
    document.body.appendChild(el);
    voz.painel = el;

    const inp = el.querySelector('#vozInput');
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') vozProcessar(inp.value);
        if (e.key === 'Escape') vozFechar();
    });
    setTimeout(() => inp.focus(), 50);
}

function vozFechar() {
    if (voz.rec) { try { voz.rec.stop(); } catch (e) { /* já parou */ } }
    voz.ouvindo = false;
    if (voz.painel) { voz.painel.remove(); voz.painel = null; }
    const b = document.getElementById('btVoz');
    if (b) b.classList.remove('ouvindo');
}

function vozEstado(txt, cls) {
    const e = document.getElementById('vozEstado');
    if (e) { e.textContent = txt; e.className = cls || ''; }
}

function vozResponder(html) {
    const r = document.getElementById('vozResposta');
    if (r) r.innerHTML = html;
}

async function vozProcessar(texto) {
    if (!texto || !texto.trim()) return;
    await vozCarregarNomes();
    voz.ultimoTexto = texto;
    const el = document.getElementById('vozTexto');
    if (el) el.textContent = `“${texto}”`;

    const cmd = vozInterpretar(texto);
    if (cmd.tipo === 'naoentendi') {
        vozEstado('Não achei a loja', 'erro');
        vozResponder(`Não reconheci <b>“${cmd.trecho || texto}”</b> como uma loja.
            Tente o nome completo, a sigla soletrada (<b>T I E T</b>) ou digite abaixo.`);
        return;
    }
    if (cmd.tipo === 'distrito') {
        const achados = vozAcharDistrito(cmd.trecho);
        if (achados.length > 1) {
            vozEstado('Qual distrito?', '');
            vozResponder(achados.map(a2 =>
                `<button class="voz-op" onclick="vozFechar(); vozCtx().abrirDistrito('${a2.regional}','${a2.distrito}')">${a2.distrito}
                    <small>${a2.regional}</small></button>`).join(''));
            return;
        }
    }
    if (cmd.tipo === 'loja' && cmd.lojas.length > 1) {
        vozEstado('Qual delas?', '');
        vozResponder(`Achei mais de uma: ` + cmd.lojas.map(l =>
            `<button class="voz-op" onclick="vozResponder(vozAbrirLoja('${l.sigla}','${cmd.acao}'))">${l.nome || l.sigla}
                <small>${l.sigla} · ${vozCtx().distrito(l.sigla) || ''}</small></button>`).join(''));
        return;
    }
    const msg = vozExecutar(cmd);
    if (msg) vozResponder(`✅ ${msg}`);
    else { vozEstado('Não entendi', 'erro'); vozResponder('Tente de novo, ou use um dos exemplos abaixo.'); }
}

/* ---------- microfone ---------- */

function vozClicar() {
    vozAbrirPainel();
    if (!vozSuportada()) {
        vozEstado('Microfone indisponível neste navegador', 'erro');
        vozResponder('Seu navegador não tem reconhecimento de voz (funciona no Chrome e no Edge). Digite o comando abaixo.');
        return;
    }
    if (voz.ouvindo) { vozFechar(); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    voz.rec = rec;
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 3;

    rec.onstart = () => {
        voz.ouvindo = true;
        document.getElementById('btVoz')?.classList.add('ouvindo');
        vozEstado('Ouvindo...', 'ativo');
    };
    rec.onresult = (ev) => {
        let parcial = '', final = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) final += r[0].transcript; else parcial += r[0].transcript;
        }
        const el = document.getElementById('vozTexto');
        if (el) el.textContent = `“${(final || parcial).trim()}”`;
        if (final) {
            vozEstado('Entendi', '');
            // Tenta as alternativas até uma virar comando reconhecido.
            const alts = [final, ...[...(ev.results[ev.results.length - 1] || [])].map(a => a.transcript)];
            const boa = alts.find(a => vozInterpretar(a).tipo !== 'naoentendi') || final;
            vozProcessar(boa.trim());
        }
    };
    rec.onerror = (ev) => {
        voz.ouvindo = false;
        document.getElementById('btVoz')?.classList.remove('ouvindo');
        const msgs = {
            'not-allowed': 'Permissão de microfone negada. Libere o microfone para este site na barra de endereço.',
            'no-speech': 'Não ouvi nada. Clique no microfone e fale de novo.',
            'audio-capture': 'Não achei um microfone conectado.',
            'network': 'O reconhecimento de voz do navegador não conseguiu conexão.'
        };
        vozEstado('Erro no microfone', 'erro');
        vozResponder(msgs[ev.error] || `Erro: ${ev.error}. Digite o comando abaixo.`);
    };
    rec.onend = () => {
        voz.ouvindo = false;
        document.getElementById('btVoz')?.classList.remove('ouvindo');
        if (voz.painel) vozEstado('Clique no microfone para falar de novo', '');
    };

    try { rec.start(); } catch (e) {
        vozEstado('Não consegui iniciar o microfone', 'erro');
        vozResponder(`${e.message}. Digite o comando abaixo.`);
    }
}
