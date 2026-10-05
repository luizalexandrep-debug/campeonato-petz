// ============================================================
// RODADA ESCOLHIDA, ENTRE AS PÁGINAS
//
// Dashboard, classificação por grupos, simular placares e missões têm cada uma
// o seu seletor de rodada. Sem isto, trocar de página voltava sempre para a
// rodada atual e era preciso escolher de novo a que estava em análise.
//
// Guardado em sessionStorage: acompanha a navegação da aba, mas não vira uma
// preferência permanente — fechar a aba zera.
//
// A escolha só vale enquanto a rodada vigente é a mesma de quando foi feita.
// Quando a rodada seguinte começa, a escolha antiga é descartada; senão a
// pessoa abriria o app "presa" numa rodada que já ficou para trás.
// ============================================================

const RODADA_CHAVE = 'petz:rodada-escolhida';

function rodadaGuardar(semana, vigente) {
    try {
        sessionStorage.setItem(RODADA_CHAVE, JSON.stringify({ semana, vigente }));
    } catch (e) { /* sem storage: a escolha só vale nesta página */ }
    // Quem mostra algo da rodada (o selo do estado dos dados) refaz a leitura.
    window.dispatchEvent(new CustomEvent('petz:rodada', { detail: { semana } }));
}

/* A rodada que o usuário já escolheu, se ainda valer para esta página:
   precisa ter sido feita com a mesma rodada vigente e existir entre as opções. */
function rodadaEscolhida(vigente, opcoes) {
    try {
        const s = JSON.parse(sessionStorage.getItem(RODADA_CHAVE) || 'null');
        if (s && s.vigente === vigente && (opcoes || []).includes(s.semana)) return s.semana;
    } catch (e) { /* storage indisponível ou valor corrompido */ }
    return null;
}
