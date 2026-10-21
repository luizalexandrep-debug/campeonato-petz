/* Botão "Perguntar": conversa com o assistente do campeonato (só administrador). */
(function () {
    const SUGESTOES = [
        'Quais lojas minhas jogam essa semana contra lojas do Rio de Janeiro?',
        'Como foram as vendas das lojas do RJ por dia nesta semana?',
        'Quais lojas minhas lideram o grupo?',
        'Quem está a menos de 3 pontos do G4 na minha regional?'
    ];
    const hist = [];
    let painel = null, ocupado = false;

    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

    // Markdown mínimo: parágrafos, listas, tabelas e **negrito**.
    function md(texto) {
        const linhas = String(texto).split('\n');
        let html = '', lista = false, i = 0;
        const fecha = () => { if (lista) { html += '</ul>'; lista = false; } };
        while (i < linhas.length) {
            const l = linhas[i].trim();
            if (/^\|.*\|$/.test(l)) {
                fecha();
                const bloco = [];
                while (i < linhas.length && /^\|.*\|$/.test(linhas[i].trim())) bloco.push(linhas[i++].trim());
                const cel = (r) => r.slice(1, -1).split('|').map(c => c.trim());
                const corpo = bloco.filter(r => !/^\|[\s:|-]+\|$/.test(r));
                if (corpo.length) {
                    html += '<div class="pg-tab"><table><thead><tr>' + cel(corpo[0]).map(c => `<th>${inline(c)}</th>`).join('')
                        + '</tr></thead><tbody>' + corpo.slice(1).map(r => '<tr>' + cel(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
                        + '</tbody></table></div>';
                }
                continue;
            }
            const m = l.match(/^[-*•]\s+(.*)$/);
            if (m) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${inline(m[1])}</li>`; }
            else if (l) { fecha(); html += `<p>${inline(l)}</p>`; }
            else fecha();
            i++;
        }
        fecha();
        return html;
    }

    function addMsg(papel, html) {
        const c = painel.querySelector('.pg-conversa');
        const d = document.createElement('div');
        d.className = 'pg-msg ' + papel;
        d.innerHTML = html;
        c.appendChild(d);
        c.scrollTop = c.scrollHeight;
        return d;
    }

    async function enviar(texto) {
        texto = (texto || '').trim();
        if (!texto || ocupado) return;
        ocupado = true;
        painel.querySelector('.pg-sugestoes')?.remove();
        addMsg('eu', esc(texto));
        const espera = addMsg('bot', '<span class="pg-pensando">consultando os dados…</span>');
        const campo = painel.querySelector('textarea');
        campo.value = '';
        try {
            const r = await fetch('/api/perguntar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pergunta: texto, historico: hist.slice(-8) })
            });
            const ct = r.headers.get('content-type') || '';
            const d = ct.includes('json') ? await r.json() : null;
            if (!d) throw new Error(r.status === 401 || r.redirected ? 'Sessão expirada: entre de novo.' : `Resposta inesperada (${r.status}).`);
            if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
            espera.innerHTML = md(d.resposta);
            hist.push({ papel: 'usuario', texto }, { papel: 'assistente', texto: d.resposta });
        } catch (e) {
            espera.className = 'pg-msg bot erro';
            espera.textContent = '⚠️ ' + e.message;
        }
        ocupado = false;
        painel.querySelector('.pg-conversa').scrollTop = 1e9;
    }

    function abrir() {
        if (painel) { painel.classList.toggle('on'); if (painel.classList.contains('on')) painel.querySelector('textarea').focus(); return; }
        painel = document.createElement('aside');
        painel.className = 'pg-painel on';
        painel.innerHTML = `
            <div class="pg-topo"><b>💬 Pergunte sobre o campeonato</b>
                <button class="pg-x" title="Fechar">✕</button></div>
            <div class="pg-conversa">
                <div class="pg-msg bot">Oi! Pergunto aos dados do app (jogos, classificação, vendas por dia). Por exemplo:</div>
                <div class="pg-sugestoes">${SUGESTOES.map(s => `<button>${esc(s)}</button>`).join('')}</div>
            </div>
            <form class="pg-form"><textarea rows="2" placeholder="Escreva sua pergunta…"></textarea>
                <button type="submit">Enviar</button></form>`;
        document.body.appendChild(painel);
        painel.querySelector('.pg-x').onclick = () => painel.classList.remove('on');
        painel.querySelector('.pg-sugestoes').onclick = (e) => { if (e.target.tagName === 'BUTTON') enviar(e.target.textContent); };
        const form = painel.querySelector('form'), campo = painel.querySelector('textarea');
        form.onsubmit = (e) => { e.preventDefault(); enviar(campo.value); };
        campo.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(campo.value); } };
        campo.focus();
    }

    async function iniciar() {
        try {
            const r = await fetch('/api/me', { cache: 'no-store' });
            const u = (await r.json()).user;
            if (!u || !u['é_admin']) return;
        } catch (e) { return; }
        const b = document.createElement('button');
        b.className = 'pg-fab';
        b.innerHTML = '💬 Perguntar';
        b.onclick = abrir;
        document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
