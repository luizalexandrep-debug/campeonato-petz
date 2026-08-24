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

const voz = {
    rec: null,
    ouvindo: false,
    painel: null,
    ultimoTexto: ''
};

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

function vozTodasAsLojas() {
    const lojas = new Set();
    Object.values(st.estrutura || {}).forEach(dists =>
        Object.values(dists).forEach(ls => ls.forEach(l => lojas.add(l))));
    Object.values(st.grupos || {}).forEach(linhas => linhas.forEach(r => lojas.add(r.time)));
    return [...lojas];
}

// Devolve os melhores candidatos para o trecho falado.
function vozAcharLojas(trecho) {
    const dito = vozNormalizar(trecho).replace(/ /g, '');
    if (dito.length < 3) return [];
    const cand = [];
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
        if (pontos !== null) cand.push({ sigla, pontos, base });
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

function vozExecutar(cmd) {
    switch (cmd.tipo) {
        case 'fechar': {
            const abertos = document.querySelectorAll('.modal-fundo');
            if (abertos.length) abertos[abertos.length - 1].remove();
            vozFechar();
            return 'Fechei a janela.';
        }
        case 'resumo':
            if (!st.souAdmin) return 'O resumo está disponível só no usuário master.';
            vozFechar();
            abrirResumoRodada();
            return 'Abrindo o resumo.';
        case 'rodada': {
            const sel = document.getElementById('fRodada');
            const op = [...sel.options].find(o => parseInt(o.value, 10) === cmd.n);
            if (!op) return `A rodada ${cmd.n} não está disponível no seletor.`;
            sel.value = op.value;
            sel.dispatchEvent(new Event('change'));
            vozFechar();
            return `Abrindo a rodada ${cmd.n}.`;
        }
        case 'grupo': {
            const nome = (st.nomesGrupos || []).find(g =>
                parseInt((g.match(/Grupo\s+(\d+)/) || [])[1] || 0, 10) === cmd.n);
            if (!nome) return `Não achei o grupo ${cmd.n}.`;
            selecionarGrupo(nome);
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
    vozFechar();
    if (acao === 'calendario') { abrirCalendarioDaLoja(sigla); return `Calendário de ${sigla}.`; }
    if (acao === 'grupo') {
        const g = grupoDaLoja(sigla);
        if (g) { abrirGrupo(g, sigla); return `Grupo de ${sigla}.`; }
        return `Não achei o grupo de ${sigla}.`;
    }
    if (!(st.projAtual || {})[sigla]) {
        return `${sigla} não tem jogo na rodada ${st.semana}.`;
    }
    abrirDetalhesJogo(sigla);
    return `Abrindo o jogo de ${sigla}.`;
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
            <div class="voz-dicas">
                Exemplos: <b>“quanto foi o último jogo da loja Tietê”</b> ·
                <b>“calendário da Mooca”</b> · <b>“grupo do Anhembi”</b> ·
                <b>“rodada 8”</b> · <b>“resumo”</b> · <b>“fechar”</b>
            </div>
        </div>`;
}

function vozAbrirPainel() {
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

function vozProcessar(texto) {
    if (!texto || !texto.trim()) return;
    voz.ultimoTexto = texto;
    const el = document.getElementById('vozTexto');
    if (el) el.textContent = `“${texto}”`;

    const cmd = vozInterpretar(texto);
    if (cmd.tipo === 'naoentendi') {
        vozEstado('Não achei a loja', 'erro');
        vozResponder(`Não reconheci <b>“${cmd.trecho || texto}”</b> como uma loja.
            Tente falar a sigla (por exemplo, <b>T I E T</b>) ou digite abaixo.`);
        return;
    }
    if (cmd.tipo === 'loja' && cmd.lojas.length > 1) {
        vozEstado('Qual delas?', '');
        vozResponder(`Achei mais de uma: ` + cmd.lojas.map(l =>
            `<button class="voz-op" onclick="vozResponder(vozAbrirLoja('${l.sigla}','${cmd.acao}'))">${l.sigla}
                <small>${distritoDaLoja(l.sigla) || ''}</small></button>`).join(''));
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
