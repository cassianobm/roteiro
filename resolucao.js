'use strict';
/* ══════════════════════════════════════════════════════════════════
   resolucao.js — Resolução de nomes vindos da AGENDA (texto sujo)
   contra o cadastro de deputados.

   ★ ESTE MÓDULO É A CORREÇÃO DOS DOIS DEFEITOS CRÍTICOS DO PROTÓTIPO.

   PRINCÍPIO (do projeto, não negociável):
     "Em dados históricos, o NOME é a fonte da verdade — não o id."
     Um id ERRADO é pior que um id AUSENTE: o ausente se vê, o errado
     não. Portanto: NUNCA adivinhar. Na dúvida, id_assembleia = null
     e sinaliza para o humano conferir.

   O protótipo casava por PRIMEIRO NOME:
       nomeLimpo.includes(d.nome.split(' ')[0])
   ...o que faz "Delegado" resolver silenciosamente para Delegado Zucco
   (existindo também Delegada Nadine), e "Professor" para Professor
   Bonatto (existindo Prof. Claudio Branchieri). Escolha silenciosa,
   id errado, contamina reunião real.

   AQUI: só match EXATO normalizado resolve por id. Qualquer outra
   coisa devolve status que a UI traduz em "confira" + dropdown.

   Depende de: normNome() e CAD (de cadastros.js).
   Script comum (NÃO ES module), conforme padrão do projeto.
   ══════════════════════════════════════════════════════════════════ */

/* Rótulos de tratamento que a agenda cola no nome do parlamentar.
   Removê-los é limpeza de RUÍDO, não adivinhação: "Deputado Fulano"
   e "Fulano" são o mesmo sujeito. Cuidado deliberado: NÃO remover
   "Delegado", "Professor", "Capitão", "Prof." — esses fazem parte do
   NOME PARLAMENTAR de deputados reais (Delegado Zucco, Delegada
   Nadine, Professor Bonatto, Prof. Claudio Branchieri, Capitão
   Martim). Removê-los destruiria justamente o que identifica. */
/* CUIDADO com o sufixo "(a)" de "Deputado(a)": ele SÓ pode ser comido
   quando vier entre parênteses. Um "a?" solto aqui devorava a inicial
   do nome seguinte — "Deputado Adão Pretto" virava "dão Pretto", que
   então não resolvia. Nome corrompido em silêncio é exatamente o que
   este módulo existe para impedir. */
const RX_TRATAMENTO = /\b(?:exmo|exma|excelentissim[oa]|sr|sra|senhor|senhora|dep|deputad[oa])\b\.?(?:\s*\(\s*a?\s*\))?[\s.:]*/gi;

/* Órgãos: proponentes que NÃO são parlamentares (is_deputado:false).
   Reconhecê-los é o que permite emitir bancada_impedida: null com
   segurança (órgão não tem bancada) em vez de "não sei". */
const RX_ORGAO = /\b(?:poder\s+executivo|governador|governo\s+do\s+estado|tribunal\s+de\s+contas|tce|ministerio\s+publico|mp|defensoria|procuradoria|mesa\s+diretora|comissao|bancada|assembleia|tribunal|secretaria|prefeitura)\b/i;

/* Estados possíveis de uma resolução. A UI reage a cada um. */
const RES = {
  RESOLVIDO:   'resolvido',    // match exato único → id confiável
  AMBIGUO:     'ambiguo',      // vários candidatos → mostrar TODOS, não escolher
  NAO_ACHADO:  'nao_achado',   // nome preservado, id null → confira
  ORGAO:       'orgao',        // não é deputado → is_deputado:false
  VAZIO:       'vazio',        // não havia nome
};

/* Tira o ruído do texto da agenda, preservando o nome parlamentar.
   NÃO tenta interpretar: só limpa tratamento, partido entre
   parênteses, pontuação de borda e espaços. */
function limparNome(cru){
  if(cru==null) return '';
  let s = String(cru);
  s = s.replace(/\([^)]*\)/g, ' ');          // "(PT)", "(PT/RS)" → fora
  s = s.replace(/\s*[-–—]\s*[A-ZÇÃ]{2,}\s*$/,' '); // "- PT" no fim → fora
  s = s.replace(RX_TRATAMENTO, ' ');         // "Deputado", "Sr." → fora
  s = s.replace(/[.;,:]+\s*$/, ' ');         // pontuação final
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/* Detecta órgão (proponente institucional, não parlamentar). */
function ehOrgao(nomeLimpo){
  if(!nomeLimpo) return false;
  return RX_ORGAO.test(normNome(nomeLimpo));
}

/* Lista de deputados do cadastro como array (CAD.deputados é mapa). */
function _listaDeps(){
  return Object.values((typeof CAD!=='undefined' && CAD.deputados) ? CAD.deputados : {});
}

/* ★ NÚCLEO: resolve um nome cru contra o cadastro.
   REGRA: só MATCH EXATO NORMALIZADO resolve por id.
   Sem match → NÃO resolve (id null, nome preservado, marca confira).
   Vários matches → devolve TODOS, não escolhe.

   Retorna sempre:
     { status, nome, id_assembleia, partido, is_deputado, candidatos[] }
   O `nome` é SEMPRE preservado (nunca vira null porque não resolveu) —
   é a correção do defeito §4.2, na raiz. */
function resolverNome(cru, opts){
  opts = opts || {};
  const nomeLimpo = limparNome(cru);

  if(!nomeLimpo){
    return { status:RES.VAZIO, nome:null, id_assembleia:null, partido:null,
             is_deputado:false, candidatos:[] };
  }

  // Órgão: decisão positiva, não "não achei".
  if(!opts.somenteDeputado && ehOrgao(nomeLimpo)){
    return { status:RES.ORGAO, nome:nomeLimpo, id_assembleia:null, partido:null,
             is_deputado:false, candidatos:[] };
  }

  const alvo = normNome(nomeLimpo);
  const deps = _listaDeps();

  // ── ÚNICO teste que resolve por id: igualdade exata normalizada. ──
  const exatos = deps.filter(d => normNome(d.nome) === alvo);

  if(exatos.length === 1){
    const d = exatos[0];
    return { status:RES.RESOLVIDO, nome:d.nome, id_assembleia:d.id,
             partido:d.partido, is_deputado:true, candidatos:[] };
  }

  if(exatos.length > 1){
    // Homônimos exatos no cadastro. Não escolher: mostrar todos.
    return { status:RES.AMBIGUO, nome:nomeLimpo, id_assembleia:null, partido:null,
             is_deputado:true, candidatos:exatos.slice() };
  }

  // ── Sem match exato: NÃO RESOLVE. ──
  // Aqui é onde o protótipo adivinhava. Nós não.
  // Levantamos candidatos APENAS para popular o dropdown que o humano
  // vai usar — eles NÃO entram no JSON e NÃO viram id sozinhos.
  const candidatos = sugerirCandidatos(nomeLimpo);

  return { status:RES.NAO_ACHADO, nome:nomeLimpo, id_assembleia:null, partido:null,
           is_deputado:true, candidatos };
}

/* Candidatos para o DROPDOWN (auxílio ao humano — jamais decisão da
   máquina). Ordena por plausibilidade, mas o valor gravado só muda
   quando o usuário escolhe. Estratégias, da mais forte para a mais
   fraca:
     1) o cadastro contém o alvo inteiro, ou vice-versa
     2) todos os tokens do alvo aparecem no nome cadastrado
     3) algum token significativo em comum
   Deliberadamente generoso: candidato demais custa um clique;
   candidato de menos esconde o deputado certo do usuário. */
/* Raiz aproximada de um token: corta a desinência de gênero/número.
   "delegado"/"delegada" → "delegad"; "professor"/"professora" → "professor".
   Usado SÓ para sugerir candidatos ao humano — jamais para resolver id. */
function _raiz(t){
  if(!t) return t;
  t = t.replace(/[.]/g,'');                  // "prof." → "prof"
  if(t.length < 4) return t;
  return t.replace(/(?:os|as|o|a|es|e)$/,'');
}

/* Tokens de um nome para fins de SUGESTÃO (não de resolução):
   sem pontuação, sem partículas curtas ("de", "da", "do"). */
function _toksSug(n){
  return n.replace(/[.]/g,' ').split(/\s+/).filter(t => t.length >= 3);
}

function sugerirCandidatos(nomeLimpo){
  const alvo = normNome(nomeLimpo);
  if(!alvo) return [];
  const toks = _toksSug(alvo);                               // ignora "de", "da", pontuação
  const deps = _listaDeps();
  const pontuados = [];

  deps.forEach(d => {
    const n = normNome(d.nome);
    let score = 0;

    if(n.includes(alvo) || alvo.includes(n)) score += 100;   // contenção total

    const ntoks = _toksSug(n);
    const casados = toks.filter(t => ntoks.some(nt => nt === t));
    score += casados.length * 20;                            // tokens exatos

    const parciais = toks.filter(t => ntoks.some(nt => nt.startsWith(t) || t.startsWith(nt)));
    score += parciais.length * 5;                            // prefixos ("prof" ~ "professor")

    // Raiz comum: tolera gênero e abreviação. Sem isto, "Delegado"
    // não sugeriria "Delegada Nadine" — e o dropdown ofereceria um
    // único candidato (Zucco), empurrando o usuário para ele. Trocar
    // um erro silencioso por um empurrão silencioso não resolve nada:
    // o par ambíguo TEM de aparecer inteiro na tela.
    // Raiz por prefixo MÚTUO: casa "prof" com "professor" e
    // "delegado" com "delegada".
    const raizes = toks.filter(t => ntoks.some(nt => {
      const a = _raiz(nt), b = _raiz(t);
      if(!a || !b) return false;
      const curto = a.length <= b.length ? a : b;
      const longo = a.length <= b.length ? b : a;
      return curto.length >= 3 && longo.startsWith(curto);
    }));
    score += raizes.length * 12;

    if(score > 0) pontuados.push({ dep:d, score });
  });

  pontuados.sort((a,b) => b.score - a.score);
  return pontuados.slice(0, 8).map(p => p.dep);
}

/* ── ADAPTADORES PARA O SCHEMA ─────────────────────────────────────
   Convertem uma resolução no objeto que o JSON exige. Todos seguem
   a mesma disciplina: nome SEMPRE preservado; id só quando confiável.
   O campo _confira (underscore) é ESTADO DE UI e é removido na
   exportação — mesmo padrão do _is_fase_b do protótipo. */

/* Objeto-deputado plano {id_assembleia, nome, partido}.
   Usado em: relator, sugestao_relatoria, autoria de emenda, etc.
   ★ CORREÇÃO §4.2: nunca devolve null por "não resolveu". Se veio um
   nome, ele é gravado — com id null, sinalizado. É exatamente o caso
   legítimo do RELATOR EXTERNO do RELSUB, que o sistema ao vivo
   espera e trata. O silêncio é que é fatal. */
function paraDeputadoPlano(res){
  if(!res || res.status === RES.VAZIO) return null;   // não havia nome: legítimo null
  return {
    id_assembleia: res.id_assembleia,                 // null quando não resolvido
    nome: res.nome,                                   // SEMPRE preservado
    partido: res.partido,                             // null quando não resolvido
    _confira: res.status !== RES.RESOLVIDO,           // UI: selo "confira"
    _status: res.status,
    _candidatos: res.candidatos.map(d => d.id),
  };
}

/* proponente_principal — tem is_deputado para distinguir órgão. */
function paraProponente(res){
  if(!res || res.status === RES.VAZIO){
    return { id_assembleia:null, nome:null, partido:null, is_deputado:false,
             _confira:true, _status:RES.VAZIO, _candidatos:[] };
  }
  if(res.status === RES.ORGAO){
    // Órgão: id e partido null POR DEFINIÇÃO, não por ignorância.
    // Não precisa de "confira" — é uma conclusão, não um chute.
    return { id_assembleia:null, nome:res.nome, partido:null, is_deputado:false,
             _confira:false, _status:RES.ORGAO, _candidatos:[] };
  }
  return {
    id_assembleia: res.id_assembleia,
    nome: res.nome,
    partido: res.partido,
    is_deputado: true,
    _confira: res.status !== RES.RESOLVIDO,
    _status: res.status,
    _candidatos: res.candidatos.map(d => d.id),
  };
}

/* ★ bancada_impedida (Art. 61-A) — v2.8: vale no Expediente E na
   Ordem do Dia (redistribuição).
   Regra de ouro: SIGLA ERRADA É PIOR QUE AUSENTE.
     - proponente é órgão            → null (não há bancada)
     - proponente resolvido          → sigla do partido dele
     - proponente NÃO resolvido      → null (NUNCA chutar)
   Quando dá null por não saber, o check-in avisa "impedimento não
   verificável" e o secretário confere. É o comportamento correto. */
function bancadaImpedidaDe(proponente){
  if(!proponente) return null;
  if(proponente.is_deputado === false) return null;      // órgão: sem bancada
  if(proponente.id_assembleia == null) return null;      // não resolvido: não chuta
  return proponente.partido || null;
}

/* Aplica uma escolha do usuário no dropdown: o id passa a ser
   confiável porque um HUMANO afirmou. Some o selo "confira". */
function aplicarEscolha(obj, idEscolhido){
  if(!obj) return obj;
  if(idEscolhido == null || idEscolhido === ''){
    // Usuário disse "nenhum destes": mantém o nome, id continua null.
    obj.id_assembleia = null;
    obj.partido = null;
    obj._confira = false;              // conferido: o humano decidiu manter assim
    obj._status = RES.NAO_ACHADO;
    return obj;
  }
  const d = (typeof CAD!=='undefined' && CAD.deputados) ? CAD.deputados[idEscolhido] : null;
  if(!d) return obj;
  obj.id_assembleia = d.id;
  obj.nome = d.nome;                   // NOME e PARTIDO vêm do CADASTRO, nunca do texto
  obj.partido = d.partido;
  obj._confira = false;
  obj._status = RES.RESOLVIDO;
  if(obj.is_deputado === false) obj.is_deputado = true;
  return obj;
}

/* Remove o estado de UI antes de exportar. O JSON entregue ao
   check-in não carrega campo com underscore. */
function limparCamposUI(obj){
  if(obj==null || typeof obj!=='object') return obj;
  if(Array.isArray(obj)) return obj.map(limparCamposUI);
  const out = {};
  Object.keys(obj).forEach(k => {
    if(k.charAt(0) === '_') return;    // _confira, _status, _candidatos, _is_fase_b...
    out[k] = limparCamposUI(obj[k]);
  });
  return out;
}
