// ============================================================
// O NOME DO ARQUIVO DIZ COMO O GOL É DISPUTADO
//
//   "<indicador> evolução semanal"   semana atual contra a anterior (o padrão)
//   "<indicador> share da semana"    vence quem tiver o maior valor na semana
//
// Espelha calculo_rapido.py (marcador_explicito / nome_limpo): é uma regra só,
// escrita nos dois lados. Maiúsculas, acentos e parênteses não importam, e os
// marcadores antigos — (ATUAL), (NIVEL)/(NÍVEL), (SEM EVOLUCAO) e a palavra
// NÍVEL solta — continuam valendo.
//
// O critério que vale de verdade vem pronto do servidor (dados.atual.criterio),
// que também sabe se existe a semana anterior; isto aqui serve para o nome
// aparecer limpo e para o que ainda não trouxe o critério.
// ============================================================

const IND_RE_NIVEL = [
    /\(?\bSHARE\s+DA\s+SEMANA\b\)?/i,
    /\((?:ATUAL|N[IÍ]VEL|SEM\s+EVOLU[CÇ][AÃ]O)\)/i,
    /\bN[IÍ]VEL\b/i
];
const IND_RE_EVOLUCAO = /\(?\bEVOLU[CÇ][AÃ]O\s+SEMANAL\b\)?/i;

/* 'nivel' | 'evolucao' | null (sem marcador) */
function marcadorDoNome(nome) {
    const alvo = String(nome || '').normalize('NFC');
    if (IND_RE_NIVEL.some(r => r.test(alvo))) return 'nivel';
    if (IND_RE_EVOLUCAO.test(alvo)) return 'evolucao';
    return null;
}

function criterioDoNome(nome) {
    return marcadorDoNome(nome) === 'nivel' ? 'nivel' : 'evolucao';
}

/* Nome do indicador para exibição: sem a extensão e sem os marcadores. */
function nomeIndicador(arquivo) {
    let n = String(arquivo || '').normalize('NFC').replace(/\.xlsx$/i, '');
    [...IND_RE_NIVEL, IND_RE_EVOLUCAO].forEach(r => { n = n.replace(new RegExp(r.source, 'ig'), ' '); });
    return n.replace(/\s+/g, ' ').replace(/^[\s\-–_:]+|[\s\-–_:]+$/g, '');
}
