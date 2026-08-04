'use strict';
/* ══════════════════════════════════════════════════════════════════
   cadastros.js — Módulo de cadastros (deputados + comissões)
   Compartilhável entre o sistema de sessão (index.html) e futuros
   satélites (ex.: checkin.html). Script comum (NÃO ES module), para
   preservar o padrão de escopo global do projeto.

   Responsabilidades:
   - Fallback embutido dos deputados (funciona sem servidor/rede).
   - Loader assíncrono: fetch de deputados_rs_2026.json e
     comissoes_rs_2026.json, com degradação graciosa para o fallback.
   - Resolução de deputado em CAMADAS: cadastro externo → fallback
     embutido → placeholder. (Composição vem do roteiro; ver app.)
   - Matching de comissão por sigla/nome (para preencher composição
     quando o roteiro vier "magro").
   - Estado de fonte (CAD.fonte) para indicador visual honesto.

   PRECEDÊNCIA (decidida com o usuário):
   - COMPOSIÇÃO (quem é titular/suplente): ROTEIRO manda. Só se o
     roteiro não trouxer é que o arquivo de comissões preenche.
   - NOME e PARTIDO: sempre do CADASTRO (fonte curada), nunca do
     roteiro. Arquivo externo → fallback embutido → placeholder.
   ══════════════════════════════════════════════════════════════════ */

/* ── FALLBACK EMBUTIDO ────────────────────────────────────────────
   Cópia mínima {id, nome, partido} usada quando o fetch falha
   (sem servidor, arquivo ausente, ou offline sem os JSONs na pasta).
   Mantido como no DEPUTADOS_RS histórico. Atualização de rotina deve
   ocorrer no arquivo externo; este é só a rede de segurança. */
const DEPUTADOS_FALLBACK = [
  {id:13,nome:"Adolfo Brito",partido:"PP"},{id:2145,nome:"Adriana Lara",partido:"PL"},
  {id:2144,nome:"Adão Pretto Filho",partido:"PT"},{id:134,nome:"Aloísio Classmann",partido:"PSD"},
  {id:2139,nome:"Beto Fantinel",partido:"MDB"},{id:2146,nome:"Bruna Rodrigues",partido:"PSB"},
  {id:2159,nome:"Capitão Martim",partido:"REPUBLICANOS"},{id:2148,nome:"Cláudio Tatsch",partido:"PL"},
  {id:2162,nome:"Delegada Nadine",partido:"PSD"},{id:2164,nome:"Delegado Zucco",partido:"REPUBLICANOS"},
  {id:2110,nome:"Dirceu Franciscon",partido:"UNIÃO"},{id:2123,nome:"Dr. Thiago Duarte",partido:"PDT"},
  {id:2150,nome:"Edivilson Brum",partido:"MDB"},{id:2085,nome:"Eduardo Loureiro",partido:"PDT"},
  {id:2151,nome:"Eliana Bayer",partido:"REPUBLICANOS"},{id:2112,nome:"Elizandro Sabino",partido:"REPUBLICANOS"},
  {id:2086,nome:"Elton Weber",partido:"PSD"},{id:2045,nome:"Ernani Polo",partido:"PSD"},
  {id:2152,nome:"Felipe Camozzato",partido:"NOVO"},{id:65,nome:"Frederico Antunes",partido:"PSD"},
  {id:2128,nome:"Gaúcho da Geral",partido:"PP"},{id:28,nome:"Gerson Burmann",partido:"PDT"},
  {id:1505,nome:"Gilmar Sossella",partido:"PDT"},{id:2153,nome:"Guilherme Pasin",partido:"PP"},
  {id:2154,nome:"Gustavo Victorino",partido:"REPUBLICANOS"},{id:2168,nome:"Halley Lino",partido:"PT"},
  {id:2036,nome:"Jeferson Fernandes",partido:"PT"},{id:2155,nome:"Joel Wilhelm",partido:"PP"},
  {id:2103,nome:"Juvir Costella",partido:"MDB"},{id:2147,nome:"Kaká D'Ávila",partido:"PODE"},
  {id:1511,nome:"Kelly Moraes",partido:"PL"},{id:2156,nome:"Laura Sito",partido:"PT"},
  {id:2157,nome:"Leonel Radde",partido:"PT"},{id:93,nome:"Luciana Genro",partido:"PSOL"},
  {id:2158,nome:"Luciano Silveira",partido:"MDB"},{id:2130,nome:"Luiz Marenco",partido:"PDT"},
  {id:2142,nome:"Marcus Vinícius",partido:"PP"},{id:2160,nome:"Matheus Gomes",partido:"PSOL"},
  {id:2161,nome:"Miguel Rossetto",partido:"PT"},{id:2125,nome:"Neri, o Carteiro",partido:"PSD"},
  {id:2111,nome:"Paparico Bacchi",partido:"PL"},{id:2137,nome:"Patrícia Alba",partido:"MDB"},
  {id:1509,nome:"Pedro Pereira",partido:"PSD"},{id:194,nome:"Pepe Vargas",partido:"PT"},
  {id:2149,nome:"Prof. Claudio Branchieri",partido:"PL"},{id:2163,nome:"Professor Bonatto",partido:"PSD"},
  {id:2136,nome:"Rodrigo Lorenzoni",partido:"PP"},{id:2034,nome:"Ronaldo Santini",partido:"PODE"},
  {id:58,nome:"Sergio Peres",partido:"REPUBLICANOS"},{id:1504,nome:"Silvana Covatti",partido:"PP"},
  {id:2122,nome:"Sofia Cavedon",partido:"PT"},{id:1500,nome:"Stela Farias",partido:"PT"},
  {id:2032,nome:"Valdeci Oliveira",partido:"PT"},{id:2100,nome:"Vilmar Zanchin",partido:"MDB"},
  {id:2095,nome:"Zé Nunes",partido:"PT"}
];

/* ── ESTADO GLOBAL DO CADASTRO ──────────────────────────────────── */
const CAD = {
  deputados: {},        // mapa id -> {id,nome,partido,...campos ricos}
  comissoes: [],        // array de comissões do arquivo (para preencher composição magra)
  fonte: {              // origem efetiva de cada base (para indicador)
    deputados: 'fallback',   // 'arquivo' | 'fallback'
    comissoes: 'ausente',    // 'arquivo' | 'ausente'
    deputados_versao: null,
    comissoes_versao: null,
  },
  carregado: false,
};

/* Normaliza nomes para matching tolerante: minúsculas, sem acentos,
   apóstrofos tipográficos unificados, espaços colapsados. */
function normNome(s){
  return (s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')  // remove acentos
    .replace(/[\u2018\u2019\u02bc\u0060\u00b4']/g,'')  // apóstrofos variados → nada
    .toLowerCase().replace(/\s+/g,' ').trim();
}

/* Constrói o mapa de deputados a partir do fallback embutido.
   Usado como base; sobrescrito pelo arquivo quando o fetch funciona. */
function _mapaFallback(){
  const m={};
  DEPUTADOS_FALLBACK.forEach(d=>{ m[d.id]={id:d.id,nome:d.nome,partido:d.partido}; });
  return m;
}

/* Faz fetch de um JSON local; retorna null em qualquer falha (sem lançar). */
async function _fetchJSON(url){
  try{
    const r=await fetch(url,{cache:'no-cache'});
    if(!r.ok)return null;
    return await r.json();
  }catch(e){ return null; }
}

/* Carrega os cadastros. Sempre resolve (nunca rejeita): na pior
   hipótese, opera 100% com o fallback embutido.
   Deve ser chamado (e aguardado) antes de usar getDep para dados ricos,
   mas getDep já funciona com o fallback mesmo antes disso. */
async function carregarCadastros(opts){
  opts=opts||{};
  const baseDep = opts.deputadosUrl || 'deputados_rs_2026.json';
  const baseCom = opts.comissoesUrl || 'comissoes_rs_2026.json';

  // Base sempre disponível: fallback embutido
  CAD.deputados=_mapaFallback();
  CAD.fonte.deputados='fallback';
  CAD.fonte.comissoes='ausente';

  // Tenta o arquivo de deputados (fonte curada)
  const depJson=await _fetchJSON(baseDep);
  if(depJson && Array.isArray(depJson.deputados)){
    const m={};
    depJson.deputados.forEach(d=>{
      const id=d.id_assembleia;
      if(id==null)return;
      m[id]={
        id, nome:d.nome, partido:d.partido,
        partido_nome:d.partido_nome||null,
        email:d.email||null, telefone:d.telefone||null,
        foto:d.foto||null, ativo:d.ativo!==false,
      };
    });
    if(Object.keys(m).length){
      CAD.deputados=m;
      CAD.fonte.deputados='arquivo';
      CAD.fonte.deputados_versao=depJson.versao||null;
    }
  }

  // Tenta o arquivo de comissões (para preencher composição magra)
  const comJson=await _fetchJSON(baseCom);
  if(comJson && Array.isArray(comJson.comissoes)){
    CAD.comissoes=comJson.comissoes;
    CAD.fonte.comissoes='arquivo';
    CAD.fonte.comissoes_versao=comJson.versao||null;
  }

  CAD.carregado=true;
  return CAD;
}

/* Resolução em camadas de um deputado por id.
   1) cadastro (arquivo se carregou, senão fallback) → 2) placeholder.
   NOME e PARTIDO nunca vêm do roteiro — sempre daqui. */
function resolveDep(id){
  const d=CAD.deputados[id];
  if(d)return d;
  return {id, nome:`ID ${id}`, partido:'?'};
}

/* Acha uma comissão do arquivo por sigla ou nome (matching tolerante).
   Usado para preencher composição quando o roteiro vier magro. */
function acharComissao(chave){
  if(!chave || !CAD.comissoes.length)return null;
  const alvo=normNome(chave);
  // 1) sigla exata
  let c=CAD.comissoes.find(x=>normNome(x.sigla)===alvo);
  if(c)return c;
  // 2) nome exato
  c=CAD.comissoes.find(x=>normNome(x.nome)===alvo);
  if(c)return c;
  // 3) sigla contida no alvo ou vice-versa (ex.: "CEDST" dentro de texto)
  c=CAD.comissoes.find(x=>{
    const s=normNome(x.sigla);
    return s && (alvo.includes(s)||s.includes(alvo));
  });
  if(c)return c;
  // 4) nome parcialmente contido
  c=CAD.comissoes.find(x=>{
    const n=normNome(x.nome);
    return n && (alvo.includes(n)||n.includes(alvo));
  });
  return c||null;
}

/* Dado um membros_comissao do ROTEIRO e a chave da comissão, devolve
   a composição efetiva. Regra: o roteiro tem precedência. Só quando
   o roteiro NÃO traz titulares/suplentes é que o arquivo preenche.
   Retorna {titulares:[ids], suplentes:[ids], origem:{...}} ou null. */
function resolverComposicao(membrosRoteiro, chaveComissao){
  const mr=membrosRoteiro||{};
  const temTit=Array.isArray(mr.titulares)&&mr.titulares.length>0;
  const temSup=Array.isArray(mr.suplentes)&&mr.suplentes.length>0;
  const origem={titulares:'roteiro', suplentes:'roteiro'};

  // Normaliza para arrays de IDs inteiros (roteiro usa IDs puros)
  const idsDe=arr=>(arr||[]).map(x=>typeof x==='object'?x.id_assembleia:x)
                              .filter(v=>v!=null).map(Number);

  let titulares = temTit ? idsDe(mr.titulares) : [];
  let suplentes = temSup ? idsDe(mr.suplentes) : [];

  // Preenche do arquivo o que o roteiro não trouxe
  if((!temTit || !temSup)){
    const c=acharComissao(chaveComissao);
    if(c){
      if(!temTit){ titulares=(c.titulares||[]).map(m=>m.id_assembleia).filter(v=>v!=null); origem.titulares='arquivo'; }
      if(!temSup){ suplentes=(c.suplentes||[]).map(m=>m.id_assembleia).filter(v=>v!=null); origem.suplentes='arquivo'; }
    } else {
      if(!temTit)origem.titulares='ausente';
      if(!temSup)origem.suplentes='ausente';
    }
  }
  return {titulares, suplentes, origem};
}

/* Texto curto de status para indicador honesto na tela de importação. */
function descrFonteCadastros(){
  const dv=CAD.fonte.deputados_versao?` (${CAD.fonte.deputados_versao})`:'';
  const cv=CAD.fonte.comissoes_versao?` (${CAD.fonte.comissoes_versao})`:'';
  const dep = CAD.fonte.deputados==='arquivo' ? `arquivo${dv}` : 'fallback embutido';
  const com = CAD.fonte.comissoes==='arquivo' ? `arquivo${cv}` : 'não carregado';
  return {dep, com, depOk:CAD.fonte.deputados==='arquivo', comOk:CAD.fonte.comissoes==='arquivo'};
}
