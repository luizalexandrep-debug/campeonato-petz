// ============================================================
// ESTADO DOS DADOS
//
// Responde, em qualquer página, à pergunta "já posso compartilhar?":
//   🟢 dados completos e em dia · 🟡 atualizando / indicadores em dias
//   diferentes · 🔴 atrasado em relação ao calendário.
//
// E dá ao botão Reprocessar a confirmação de que TODOS os servidores já têm os
// dados novos (cada instância guarda a sua cópia, ver /api/estado-dados).
// ============================================================

const estadoDados = { atual: null, semanaFn: null, timer: null, el: null, buscando: false };

const edDormir = (ms) => new Promise(r => setTimeout(r, ms));

function edData(iso) {
    if (!iso) return '';
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
}

function edHora(epoch) {
    return new Date(epoch * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function edBuscar(semana, limiteMs = 70000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), limiteMs);
    try {
        const r = await fetch(`/api/estado-dados/${semana}`, { cache: 'no-store', signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    } finally { clearTimeout(t); }
}

/* ---------- o selo ---------- */

function edTexto(e) {
    const ate = e.dadosAte ? `${e.dadosAteDia || ''} ${edData(e.dadosAte)}`.trim() : '';
    switch (e.estado) {
        case 'ok':
            return { cls: 'ed-ok', ponto: '🟢',
                txt: `Dados até ${ate} · ${e.atualizados} de ${e.indicadores} indicadores · pronto para compartilhar` };
        case 'atualizando':
            return { cls: 'ed-amarelo', ponto: '🟡',
                txt: 'Atualizando os dados neste servidor… aguarde antes de compartilhar' };
        case 'divergente':
            return { cls: 'ed-amarelo', ponto: '🟡',
                txt: `Indicadores em dias diferentes (${e.atualizados} de ${e.indicadores} até ${ate}) — aguarde` };
        case 'atrasado':
            return { cls: 'ed-vermelho', ponto: '🔴',
                txt: `Dados atrasados: até ${ate}, esperado até ${edData(e.esperadaData)}` };
        default:
            return { cls: 'ed-neutro', ponto: '⚪', txt: 'Sem vendas lançadas nesta rodada ainda' };
    }
}

function edDetalhe(e) {
    const linhas = [];
    if (e.pendentes && e.pendentes.length && e.estado !== 'ok')
        linhas.push(`Pendentes: ${e.pendentes.join(', ')}`);
    if (e.localEm) linhas.push(`Este servidor baixou os dados às ${edHora(e.localEm)}`);
    if (e.versao) linhas.push(`Último reprocessamento pedido às ${edHora(e.versao)}`);
    linhas.push(`Versão dos dados: ${e.assinatura}`);
    return linhas.join('\n');
}

function edRender() {
    const e = estadoDados.atual, el = estadoDados.el;
    if (!el || !e) return;
    const t = edTexto(e);
    el.className = `ed-chip ${t.cls}`;
    el.textContent = `${t.ponto} ${t.txt}`;
    el.title = edDetalhe(e);
}

async function estadoDadosAtualizar() {
    if (!estadoDados.semanaFn || estadoDados.buscando) return;
    const semana = estadoDados.semanaFn();
    if (!semana) return;
    estadoDados.buscando = true;
    try {
        estadoDados.atual = await edBuscar(semana);
        estadoDados.lidoEm = Date.now();
        edRender();
    } catch (e) {
        console.warn('estado dos dados indisponível', e);
    } finally {
        estadoDados.buscando = false;
    }
    clearTimeout(estadoDados.timer);
    // Enquanto não está pronto, olha de novo logo; pronto, só de vez em quando.
    const pronto = estadoDados.atual && ['ok', 'sem_dados'].includes(estadoDados.atual.estado);
    estadoDados.timer = setTimeout(() => { if (!document.hidden) estadoDadosAtualizar(); else estadoDados.timer = setTimeout(estadoDadosAtualizar, 30000); },
        pronto ? 300000 : 30000);
}

/* `semanaFn` devolve a rodada que a página tem em tela. */
function estadoDadosIniciar(semanaFn) {
    estadoDados.semanaFn = semanaFn;
    if (!estadoDados.el) {
        const el = document.createElement('div');
        el.id = 'estadoDados';
        el.className = 'ed-chip ed-neutro';
        el.textContent = '⚪ Conferindo os dados…';
        (document.querySelector('.header-content') || document.querySelector('.header') || document.body)
            .appendChild(el);
        estadoDados.el = el;
        window.addEventListener('petz:rodada', () => estadoDadosAtualizar());
        // Aba que ficou em segundo plano não relê; ao voltar, confere na hora
        // em vez de mostrar um estado que pode ter ficado velho.
        document.addEventListener('visibilitychange', () => {
            const velho = !estadoDados.atual || (Date.now() - (estadoDados.lidoEm || 0)) > 60000;
            if (!document.hidden && velho) estadoDadosAtualizar();
        });
    }
    estadoDadosAtualizar();
}

/* Texto curto para imagens e resumos compartilhados. */
function estadoDadosRotulo() {
    const e = estadoDados.atual;
    if (!e || !e.dadosAte) return '';
    const ate = `${e.dadosAteDia || ''} ${edData(e.dadosAte)}`.trim();
    return e.estado === 'ok' ? `Dados até ${ate}` : `⚠ Dados ainda atualizando (até ${ate})`;
}

/* Antes de copiar/compartilhar: avisa se os dados não estão prontos. */
function estadoDadosPodeCompartilhar() {
    const e = estadoDados.atual;
    if (!e || e.estado === 'ok' || e.estado === 'sem_dados') return true;
    const t = edTexto(e);
    return confirm(`${t.txt}.\n\nCopiar mesmo assim?`);
}

/* ---------- confirmação depois do Reprocessar ---------- */

/* Consulta o estado várias vezes seguidas — cada consulta pode cair numa
   instância diferente — e só considera pronto quando N respostas seguidas
   trazem o mesmo conteúdo de dados e já incluem a versão pedida.
   `onProgresso({ seguidas, necessarias })` alimenta a barra. */
async function estadoDadosConfirmar(semana, versaoEsperada, onProgresso) {
    const NECESSARIAS = 4, LIMITE_MS = 180000;
    let seguidas = 0, assinatura = null, ultimo = null;
    const t0 = Date.now();
    while (Date.now() - t0 < LIMITE_MS) {
        onProgresso && onProgresso({ seguidas, necessarias: NECESSARIAS });
        let e;
        try {
            e = await edBuscar(semana);
        } catch (err) {
            seguidas = 0; assinatura = null;
            await edDormir(2000);
            continue;
        }
        ultimo = e;
        const emDia = e.localAtualizada && (versaoEsperada == null || (e.versao != null && e.versao >= versaoEsperada));
        if (emDia && (assinatura === null || e.assinatura === assinatura)) {
            assinatura = e.assinatura;
            seguidas++;
        } else {
            seguidas = emDia ? 1 : 0;
            assinatura = emDia ? e.assinatura : null;
        }
        if (seguidas >= NECESSARIAS) {
            estadoDados.atual = e; edRender();
            onProgresso && onProgresso({ seguidas, necessarias: NECESSARIAS });
            return { convergiu: true, estado: e };
        }
        await edDormir(1200);
    }
    if (ultimo) { estadoDados.atual = ultimo; edRender(); }
    return { convergiu: false, estado: ultimo };
}
