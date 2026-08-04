'use strict';
/* ══════════════════════════════════════════════════════════════════
   construtor.js — App do Construtor de Pautas (Fatia 0)

   Lê a AGENDA do sistema corporativo (fonte pobre e suja) e produz o
   JSON de pauta aderente ao schema, que segue para o CHECK-IN.

   Vue 3, global build VENDORIZADO. Script comum, sem build step,
   sem CDN, sem location.reload (o servidor local atende 1 req/vez).

   Depende de: cadastros.js (CAD, normNome, resolveDep, acharComissao,
   resolverComposicao) e resolucao.js (resolverNome, paraProponente,
   paraDeputadoPlano, bancadaImpedidaDe, aplicarEscolha, limparCamposUI).
   ══════════════════════════════════════════════════════════════════ */

/* getDep NÃO está em cadastros.js (pegadinha registrada no briefing):
   é definida em script.js e checkin.js. O construtor declara a sua. */
function getDep(id){
  return (typeof resolveDep === 'function') ? resolveDep(id) : {id, nome:'ID '+id, partido:'?'};
}

const { createApp, reactive, ref, computed, onMounted } = Vue;

/* ── PAUTA VAZIA ───────────────────────────────────────────────────
   Molde do schema. `execucao` nasce ZERADA: quem a preenche é a
   reunião ao vivo, não o construtor. */
function pautaVazia(){
  return {
    metadados:{
      comissao:null, sigla:null, tipo_reuniao:null, data:null,
      hora_inicio:null, hora_inicio_efetiva:null, hora_encerramento:null,
      local:null, local_efetivo:null, modalidade:'presencial', condutor_id:null,
      quorum:{
        abertura:{suficiente:null, titulares:[], suplentes:[], visitantes:[]},
        ordem_do_dia:{suficiente:null, titulares:[], suplentes:[], visitantes:[]}
      },
      timeline_presencas:[], timeline_conducao:[],
      presencas_gerais:{titulares:[], suplentes:[], visitantes:[]}
    },
    membros_comissao:{presidente:null, titulares:[], suplentes:[]},
    aprovacao_atas:{atas:[]},
    leitura_expediente:{
      correspondencias_recebidas:[], proposicoes_recebidas:[],
      proposicoes_distribuidas:[], materias_a_distribuir:[]
    },
    conhecimento_materias:{
      informativos:[], requerimentos_conhecimento:[],
      deliberativos_administrativos:[], audiencias_agendadas:[]
    },
    ordem_do_dia:[],
    assuntos_gerais:{proxima_reuniao:null, itens:[], manifestacoes_gerais:[]},
    rodape:{local:null, data_emissao:null, presidente:null}
  };
}

function execucaoZerada(){
  return {
    status:null, hora_inicio_apreciacao:null, hora_fim_apreciacao:null,
    relatorio_lido:false, redacao_final_aprovada:false, autor_vista:null,
    redistribuicao:null, voto_desempate:null,
    votos_favoraveis:[], votos_contrarios:[], eleito:null
  };
}

function itemVazio(){
  return {
    id:null, tipo:null, numero:null, ano:null, ementa:'', ordem:null,
    proponente_principal:null, coautores_adicionais:0,
    votacao_conclusiva:false, relator:null, parecer:null,
    relatorio_lido_em:null, pareceres_anteriores:[], pedidos_de_vista_anteriores:[],
    maioria_simples:false, bancada_impedida:null, eleicao:false, cargo_eleicao:null,
    permite_pedido_vista:true, emendas:[], manifestacoes:[],
    execucao:execucaoZerada(),
    // Específicos por tipo (podados na exportação conforme o tipo)
    local:null, modalidade:null, convidados:[],
    req_criacao:null, id_requerimento_origem:null,
    data_aprovacao_subcomissao:null, demais_integrantes:[], membros:null,
    sujeita_emendas:false, sugestao_relatoria:null,
    forma_escolha_relator:null, data_distribuicao:null
  };
}

/* ── PARSER DA AGENDA ──────────────────────────────────────────────
   A agenda é mais pobre que o roteiro. O parser tenta o que dá e, no
   que não der, deixa vazio e SINALIZA. Nunca inventa. */

/* Marcadores de seção. O algarismo romano é opcional e o restante do
   título pode variar ("CONHECIMENTO DE MATÉRIAS **DA ALÇADA DA
   COMISSÃO**"), por isso casamos só o núcleo do rótulo. */
const MARCADORES = [
  {chave:'atas',            rx:/^\s*(?:I\s*[-–—]\s*)?APROVA[ÇC][ÃA]O\s+DA/im},
  {chave:'expediente',      rx:/^\s*(?:II\s*[-–—]\s*)?LEITURA\s+DO\s+EXPEDIENTE/im},
  {chave:'conhecimento',    rx:/^\s*(?:III\s*[-–—]\s*)?CONHECIMENTO\s+DE\s+MAT[ÉE]RIA/im},
  {chave:'ordem_do_dia',    rx:/^\s*(?:IV\s*[-–—]\s*)?ORDEM\s+DO\s+DIA/im},
  {chave:'assuntos_gerais', rx:/^\s*(?:V\s*[-–—]\s*)?ASSUNTOS\s+GERAIS/im},
  {chave:'rodape',          rx:/^\s*Pal[áa]cio\s+Farroupilha/im},
];

const ROTULOS_FATIA = {
  atas:'Atas', expediente:'Expediente', conhecimento:'Conhecimento',
  ordem_do_dia:'Ordem do Dia', assuntos_gerais:'Assuntos Gerais',
  rodape:'Rodapé', cabecalho:'Cabeçalho'
};

function fatiar(texto){
  const pos = [];
  MARCADORES.forEach(m => {
    const mt = texto.match(m.rx);
    if(mt) pos.push({chave:m.chave, i:mt.index});
  });
  pos.sort((a,b) => a.i - b.i);

  const fatias = {};
  if(pos.length && pos[0].i > 0) fatias.cabecalho = texto.slice(0, pos[0].i);
  pos.forEach((p, k) => {
    const fim = (k+1 < pos.length) ? pos[k+1].i : texto.length;
    fatias[p.chave] = texto.slice(p.i, fim);
  });
  if(!pos.length) fatias.cabecalho = texto;   // nada reconhecido: tudo é cabeçalho
  return fatias;
}

/* Data em vários formatos → ISO. Devolve null se não reconhecer
   (não chuta). */
function dataISO(txt){
  if(!txt) return null;
  let m = txt.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = txt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  const MESES = {janeiro:'01',fevereiro:'02',março:'03',marco:'03',abril:'04',maio:'05',
    junho:'06',julho:'07',agosto:'08',setembro:'09',outubro:'10',novembro:'11',dezembro:'12'};
  // "15 de junho de 2026"
  m = txt.match(/(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/i);
  if(m){
    const mes = MESES[normNome(m[2])];
    if(mes) return `${m[3]}-${mes}-${String(m[1]).padStart(2,'0')}`;
  }
  // ★ Formato misto real das audiências: "11/maio/2026"
  m = txt.match(/(\d{1,2})\s*\/\s*([a-zçã]{3,})\s*\/\s*(\d{4})/i);
  if(m){
    const mes = MESES[normNome(m[2])];
    if(mes) return `${m[3]}-${mes}-${String(m[1]).padStart(2,'0')}`;
  }
  return null;
}

function horaHHMM(txt){
  if(!txt) return null;
  const m = txt.match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
  return m ? `${String(m[1]).padStart(2,'0')}:${m[2]}` : null;
}

/* Sentido do parecer. Só três valores conhecidos; qualquer outra
   coisa → null (o humano decide). */
function sentidoParecer(txt){
  if(!txt) return null;
  const t = normNome(txt);
  if(/com\s+emenda/.test(t))              return 'favoravel_com_emendas';
  if(/contrari/.test(t))                  return 'contrario';
  if(/favorav/.test(t))                   return 'favoravel';
  return null;
}

/* Menção a tramitação conclusiva na ementa (o linter do check-in
   cobra que o CAMPO seja marcado e a ementa limpa). */
/* ★ Menção a tramitação conclusiva. Na agenda real vem entre
   parênteses no fim da ementa: "(Tramitação Conclusiva CEDST)",
   com caixa variando ("conclusiva" minúsculo em alguns itens). */
const RX_CONCLUSIVA = /(?:tramita[çc][ãa]o|vota[çc][ãa]o)\s+conclusiva|conclusiv[ao]\s+(?:nesta|na)\s+comiss/i;

function limparConclusivaDaEmenta(ementa){
  if(!ementa) return ementa;
  return ementa
    // 1) a forma real: parênteses inteiros → "(Tramitação Conclusiva CEDST)"
    .replace(/\s*\((?:\s*em\s+)?(?:tramita[çc][ãa]o|vota[çc][ãa]o)\s+conclusiva[^)]*\)\s*/gi,' ')
    // 2) a forma solta, sem parênteses, presa por vírgula/travessão
    .replace(/\s*[,;–—-]?\s*(?:em\s+)?(?:tramita[çc][ãa]o|vota[çc][ãa]o)\s+conclusiva(?:\s+(?:nesta|na)\s+comiss[ãa]o)?\s*\.?/gi,' ')
    .replace(/\s+/g,' ')
    .replace(/\s+([.,;])/g,'$1')
    .replace(/[,;]\s*$/,'')          // pontuação órfã no fim
    .trim()
    .replace(/([^.)])$/,'$1.');      // devolve o ponto final
}

/* Um bloco de proposição da agenda → item do schema.
   Toda resolução de nome passa pelo resolucao.js: match exato ou
   nada. Nenhum campo é descartado por não ter resolvido. */
function parsearProposicao(bloco, ctx){
  const it = itemVazio();
  it.tipo   = bloco.tipo;
  it.numero = bloco.numero;
  it.ano    = bloco.ano;
  it.id     = `${String(bloco.tipo).toLowerCase()}-${String(bloco.numero).padStart(4,'0')}-${bloco.ano}`;

  const corpo = bloco.corpo || '';

  // ── Proponente ──
  // Formato real: "Proponente: Deputado(a) Beto Fantinel + 3 Deputado(s)"
  // ou, nas audiências: "Proponente: Deputado Guilherme Pasin."
  const mProp = corpo.match(/(?:Proponente|Autor(?:ia)?)\s*:\s*([^\n]+)/i);
  if(mProp){
    let cru = mProp[1].trim();
    const mCo = cru.match(/\+\s*(\d+)\s*(?:Deputad|outros?|coautor)/i);
    if(mCo){
      it.coautores_adicionais = parseInt(mCo[1], 10);
      cru = cru.split('+')[0].trim();
    }
    it.proponente_principal = paraProponente(resolverNome(cru));
  } else {
    it.proponente_principal = paraProponente(resolverNome(''));   // vazio, marcado confira
  }

  // ── Ementa (ou "Assunto:", nos requerimentos de audiência) ──
  // O bloco termina no próximo rótulo conhecido. "Publicado nesta
  // agenda." também encerra (aparece nos itens de Fase B).
  const mEm = corpo.match(/(?:Ementa|Assunto)\s*:\s*([\s\S]*?)(?=\n\s*(?:Relator|Parecer|Convidados?|Local|Publicad|Data\s+de\s+Distribui|Proponente|Pauta)\b|$)/i);
  if(mEm) it.ementa = mEm[1].replace(/\s*\n\s*/g,' ').trim();

  // ── Votação conclusiva ──
  // ★ Na agenda real a marca vem DENTRO da ementa, entre parênteses:
  //     "(Tramitação Conclusiva CEDST)"   /   "(Tramitação conclusiva CEDST)"
  // e NÃO como prefixo do item. Marcamos o CAMPO e LIMPAMOS o texto —
  // é o que o linter do check-in cobra ("conclusiva na ementa, campo
  // não marcado"). A Fase B propriamente vem do subcabeçalho
  // "- Votação Conclusiva:", tratado em extrairBlocos().
  const ehPL = (it.tipo === 'PL' || it.tipo === 'PLC');
  if(bloco.faseB && ehPL) it.votacao_conclusiva = true;
  if(RX_CONCLUSIVA.test(it.ementa)){
    // O campo só se marca em PL (regra do prompt de extração), mas a
    // ementa é limpa em qualquer tipo: o texto de tramitação não faz
    // parte da ementa, e o linter do check-in cobra isso.
    if(ehPL) it.votacao_conclusiva = true;
    it.ementa = limparConclusivaDaEmenta(it.ementa);
  }

  // ── Refino de subtipo do REQ genérico ──
  // (RAP, RDI, REQSUB e RELSUB já vêm identificados pelo tipo por
  // extenso em extrairBlocos; aqui só refinamos o "Requerimento" cru.)
  if(it.tipo === 'REQ'){
    const e = normNome(it.ementa);
    if(/cria[çc]?[ãa]?o?\s+de\s+(?:uma\s+)?subcomiss/.test(e))       it.tipo = 'REQSUB';
    else if(/relatorio\s+final\s+d[ae]\s+subcomiss/.test(e))          it.tipo = 'RELSUB';
    else if(/elei[çc][ãa]o\s+d[eo]/.test(e)){
      it.eleicao = true;
      it.maioria_simples = false;                 // eleição NUNCA é maioria simples
    }
    else if(/convit|convidar/.test(e)) it.maioria_simples = true;   // convite: maioria simples
    if(it.tipo !== 'REQ') it.id = `${it.tipo.toLowerCase()}-${String(it.numero).padStart(4,'0')}-${it.ano}`;
  }

  // ── Relator do item ──
  // ★ CORREÇÃO §4.2: nunca descartar. Se veio um nome e ele não
  // resolveu, grava com id_assembleia:null e marca confira. É o caso
  // legítimo do relator EXTERNO do RELSUB — o sistema ao vivo espera
  // e trata; o silêncio é que é fatal.
  //
  // CUIDADO: "Relator:" também aparece DENTRO de cada parecer anterior
  // (precedido por "Comissão de ..."). Só o relator do ITEM interessa
  // aqui — o histórico é lido adiante, como string. Sem esta guarda, o
  // PL 294 (Fase B, sem relator próprio) ganharia o relator do parecer
  // da CCJ.
  const relatoresPossiveis = [];
  const rxRel = /(?:^|\n)([ \t]*(?:Comiss[ãa]o[^\n]*\n)?)[ \t]*Relator(?:\s*\(a\))?\s*:\s*([^\n]+)/gi;
  let mR;
  while((mR = rxRel.exec(corpo)) !== null){
    const precedidoPorComissao = /Comiss[ãa]o/i.test(mR[1] || '');
    if(!precedidoPorComissao) relatoresPossiveis.push(mR[2].trim());
  }
  const mRel = relatoresPossiveis.length ? [null, relatoresPossiveis[0]] : null;
  if(mRel){
    const cru = mRel[1].trim();
    if(bloco.faseB){
      // Votação conclusiva (fase B): o item NÃO tem relatoria nova. Se a
      // agenda trouxer um nome, é SUGESTÃO — nunca o campo relator.
      it.sugestao_relatoria = paraDeputadoPlano(resolverNome(cru));
      it.relator = null;
      it.parecer = null;
    } else {
      it.relator = paraDeputadoPlano(resolverNome(cru));
    }
  }

  // ── Parecer do item (Fase A) ──
  // CUIDADO: "Parecer:" também abre cada PARECER ANTERIOR (que vem
  // seguido de uma linha "Comissão de ..."). O parecer PRÓPRIO é o que
  // NÃO é seguido por essa linha — a negativa abaixo evita que o
  // primeiro parecer histórico seja lido como parecer do item.
  const mPar = corpo.match(/Parecer\s*:\s*([^\n]+)(?!\n+[ \t]*Comiss[ãa]o)/i);
  const ehHistorico = mPar && /\n+[ \t]*Comiss[ãa]o/i.test(
    corpo.slice(corpo.indexOf(mPar[0]) + mPar[0].length, corpo.indexOf(mPar[0]) + mPar[0].length + 80)
  );
  if(mPar && !ehHistorico && !bloco.faseB) it.parecer = sentidoParecer(mPar[1]);

  // ── Data de distribuição (proposições já distribuídas) ──
  // ★ Formato real: "Data de Distribuição 17/06/2026" — SEM dois-pontos.
  // O regex anterior exigia ":" e o campo saía sempre null.
  const mDD = corpo.match(/Data\s+de\s+Distribui[çc][ãa]o\s*:?\s*([^\n]+)/i);
  if(mDD) it.data_distribuicao = dataISO(mDD[1]);

  // ── Pareceres anteriores (histórico de outras comissões) ──
  // ★ FORMATO REAL (conferido no PL 294 da agenda): vem de uma TABELA do
  // Word, em três linhas:
  //     Parecer: Favorável
  //     Comissão de Constituição e Justiça
  //     Relator: Deputado(a) Jeferson Fernandes
  // (O extrator .docx precisa ler document.tables além de paragraphs,
  // senão estas linhas simplesmente não existem no texto — foi o que me
  // levou a afirmar, erradamente, que a agenda não tinha pareceres.)
  //
  // O relator aqui é STRING histórica, conforme o schema. NÃO resolvemos
  // contra o cadastro atual: reescrever esse nome com o de outro deputado
  // destruiria a verdade histórica. Grava-se o texto como veio, apenas
  // limpo do tratamento.
  const rxParAnt = /^[ \t]*Parecer\s*:\s*([^\n]+)\n+[ \t]*(Comiss[ãa]o[^\n]+)\n+[ \t]*Relator(?:\s*\(a\))?\s*:\s*([^\n]+)/gim;
  let mPA;
  while((mPA = rxParAnt.exec(corpo)) !== null){
    it.pareceres_anteriores.push({
      comissao: siglaComissao(mPA[2].trim()),
      relator:  limparNome(mPA[3]),      // string, como veio (sem resolver)
      parecer:  sentidoParecer(mPA[1])
    });
  }

  // ── Campos específicos por tipo ──
  if(it.tipo === 'RAP'){
    // Formato real:
    //   Convidados: Representantes da Secretaria ...; do Tribunal de Contas ...
    //   Local: Assembleia Legislativa - formato presencial.
    const mConv = corpo.match(/Convidados?\s*:\s*([\s\S]*?)(?=\n\s*(?:Relator|Parecer|Local|Data|Proponente)\b|$)/i);
    if(mConv){
      it.convidados = mConv[1]
        .replace(/\s*\n\s*/g,' ')
        .split(';')
        .map(s => s.trim().replace(/\.$/,''))
        .filter(Boolean);
    }
    const mLocal = corpo.match(/Local\s*:\s*([^\n]+)/i);
    if(mLocal){
      let loc = mLocal[1].trim().replace(/\.$/,'');
      const mMod = loc.match(/[-–—]?\s*formato\s+(presencial|h[íi]brido|virtual|remoto)\s*$/i);
      if(mMod){
        const mod = normNome(mMod[1]);
        it.modalidade = mod.startsWith('hibrid') ? 'híbrida'
                      : mod.startsWith('virtual') || mod.startsWith('remot') ? 'virtual'
                      : 'presencial';
        loc = loc.slice(0, mMod.index).replace(/[-–—,\s]+$/,'').trim();
      }
      it.local = loc;
    }
  }
  if(it.tipo === 'REQSUB' || it.tipo === 'RELSUB'){
    const mReq = corpo.match(/(?:Req(?:uerimento)?\s+de\s+cria[çc][ãa]o|Criad[ao]\s+pelo)\s*:?\s*([^\n]+)/i);
    if(mReq) it.req_criacao = mReq[1].trim();
    const mAprov = corpo.match(/(?:Aprova[çc][ãa]o\s+d[ao]\s+subcomiss[ãa]o|Data\s+de\s+aprova[çc][ãa]o)\s*:?\s*([^\n]+)/i);
    if(mAprov) it.data_aprovacao_subcomissao = dataISO(mAprov[1]);
  }

  // ── Pedido de vista: não cabe nestes tipos ──
  if(bloco.faseB || ['RAP','REQ','REQSUB','RELSUB','RDI'].indexOf(it.tipo) >= 0){
    it.permite_pedido_vista = false;
  }

  // ── ★ bancada_impedida (Art. 61-A) ──
  // v2.8: emitida também na ORDEM DO DIA (vale na redistribuição),
  // não só no expediente. Órgão → null; proponente não resolvido →
  // null (NUNCA chutar: sigla errada é pior que ausente).
  it.bancada_impedida = bancadaImpedidaDe(it.proponente_principal);

  // Flag de UI (removida na exportação)
  it._fase_b = !!bloco.faseB;

  return it;
}

/* Sigla de comissão a partir do nome por extenso. Só mapeia o que
   reconhece com segurança; o resto fica como veio. */
function siglaComissao(txt){
  const t = normNome(txt);
  if(/constitui/.test(t))                  return 'CCJ';
  if(/economia|desenvolvimento/.test(t))   return 'CEDST';
  if(/finanç|financ|fiscaliz/.test(t))     return 'CFPFC';
  if(/educaç|educac|cultura/.test(t))      return 'CECDCT';
  if(/saude|saúde|meio\s+ambiente/.test(t))return 'CSMA';
  if(/seguranc|seguranç/.test(t))          return 'CSSP';
  if(/direitos\s+humanos|cidadania/.test(t)) return 'CCDH';
  if(/agricultura|pecuaria/.test(t))       return 'CAPMA';
  return txt.trim();
}

/* ── TIPOS DE PROPOSIÇÃO ───────────────────────────────────────────
   A agenda escreve o tipo POR EXTENSO ("Projeto de Lei n.º 358/2024"),
   não em sigla. Traduzimos para a sigla do schema.
   Ordem importa: o mais específico primeiro ("Requerimento de Audiência
   Pública" antes de "Requerimento"). */
const TIPOS_EXTENSO = [
  {rx:/Projeto\s+de\s+Lei\s+Complementar/i,            sigla:'PLC'},
  {rx:/Proposta\s+de\s+Emenda\s+(?:à|a)\s+Constitui/i, sigla:'PEC'},
  {rx:/Projeto\s+de\s+Lei/i,                           sigla:'PL'},
  {rx:/Projeto\s+de\s+Resolu[çc][ãa]o/i,               sigla:'PRES'},
  {rx:/Projeto\s+de\s+Decreto\s+Legislativo/i,         sigla:'PDL'},
  {rx:/Requerimento\s+de\s+Audi[êe]ncia\s+P[úu]blica/i,sigla:'RAP'},
  {rx:/Requerimentos?\s+Diversos/i,                    sigla:'RDI'},
  {rx:/Requerimento\s+de\s+Cria[çc][ãa]o\s+de\s+Subcomiss/i, sigla:'REQSUB'},
  {rx:/Relat[óo]rio\s+(?:Final\s+)?d[ea]\s+Subcomiss/i,sigla:'RELSUB'},
  {rx:/Requerimento/i,                                 sigla:'REQ'},
  {rx:/Mo[çc][ãa]o/i,                                  sigla:'MOC'},
  {rx:/Indica[çc][ãa]o/i,                              sigla:'IND'},
];

function siglaDoTipo(extenso){
  const t = (extenso || '').trim();
  for(const e of TIPOS_EXTENSO){ if(e.rx.test(t)) return e.sigla; }
  return null;                       // desconhecido: NÃO chutar
}

/* Blocos de proposição dentro de uma fatia.
   ★ FORMATO REAL da agenda (conferido no documento do usuário):
       1) Projeto de Lei n.º 358/2024
       2) Requerimento de Audiência Pública n.º 52/2025
   O tipo vem POR EXTENSO, o número usa "n.º", e a numeração é "1)"
   (às vezes "1."). A versão anterior deste parser esperava sigla
   ("PL nº 123/2026") — formato que eu havia inventado numa agenda de
   teste sintética. Contra o documento real ele não casava NADA: a
   Ordem do Dia vinha vazia e o expediente não carregava. */
const RX_ITEM = /^[ \t]*(\d+)\s*[).]\s*(.+?)\s+n\.?\s*[º°]?\s*(\d+)\s*\/\s*(\d{4})/gim;

function extrairBlocos(txt, faseBGlobal){
  if(!txt) return [];
  const achados = [];
  let m;
  RX_ITEM.lastIndex = 0;
  while((m = RX_ITEM.exec(txt)) !== null){
    const sigla = siglaDoTipo(m[2]);
    if(!sigla) continue;                          // linha não é proposição
    achados.push({
      tipo: sigla,
      tipoExtenso: m[2].trim(),
      numero: parseInt(m[3], 10),
      ano: parseInt(m[4], 10),
      inicio: m.index,
    });
  }
  achados.forEach((a, i) => {
    a.corpo = txt.slice(a.inicio, i+1 < achados.length ? achados[i+1].inicio : txt.length);
    // ★ "- Votação Conclusiva:" é um SUBCABEÇALHO: os itens que vêm
    // DEPOIS dele estão em Fase B.
    // MAS a Fase B (e a votação conclusiva) só existe para PL — é o que
    // manda o prompt de extração ("votacao_conclusiva: true apenas para
    // PL"; na tabela de tipos, RAP/REQ/RDI têm conclusiva = false).
    // Sem esta restrição, o marcador vazava para os Requerimentos de
    // Audiência Pública listados abaixo dele, que saíam com
    // votacao_conclusiva: true — errado.
    const antes = txt.slice(0, a.inicio);
    const souPL = (a.tipo === 'PL' || a.tipo === 'PLC');
    a.faseB = souPL && (!!faseBGlobal ||
              /[-•]\s*Vota[çc][ãa]o\s+Conclusiva\s*:/i.test(antes));
  });
  return achados;
}

/* ══════════════════════════════════════════════════════════════════
   COMPONENTE: campos de uma proposição, com o padrão "CONFIRA".

   ★ É aqui que os defeitos §4.1/§4.2 viram interface: quando a
   máquina NÃO resolveu, o campo aparece com borda âmbar, selo
   "confira", o NOME CRU visível e um DROPDOWN do cadastro. O usuário
   confirma — a máquina não escolhe por ele.
   ══════════════════════════════════════════════════════════════════ */
const PropCampos = {
  props:['item','cadastro','contexto'],
  emits:['escolher'],
  template:`
  <div>

    <!-- ★ IDENTIFICAÇÃO DA MATÉRIA.
         Estava só na Ordem do Dia; no expediente os blocos começavam
         direto em "Proponente", sem dizer de qual proposição se tratava.
         Fica no componente para valer em TODA seção que o use. -->
    <div class="cx-item-top" v-if="contexto !== 'od'">
      <span class="cx-item-tipo" v-text="item.tipo + ' ' + item.numero + '/' + item.ano"></span>
      <span class="badge badge-red" v-if="item._fase_b"
            title="Votação definitiva do projeto, sem relatoria nova">Votação Conclusiva</span>
      <span class="badge badge-amber" v-else-if="item.votacao_conclusiva"
            title="Tramita conclusivamente nesta comissão — não vai a Plenário">Tramitação Conclusiva</span>
      <span class="badge badge-gray" v-if="item.coautores_adicionais > 0"
            v-text="'+' + item.coautores_adicionais + ' coautor(es)'"></span>
    </div>

    <div class="cx-grid">

    <!-- PROPONENTE -->
    <div class="cx-fld wide" :class="{'cx-confira': prec(item.proponente_principal)}">
      <label class="fld-lbl">
        Proponente
        <span class="cx-selo" v-if="prec(item.proponente_principal)">⚠ confira</span>
      </label>
      <div v-if="item.proponente_principal">
        <div class="cx-nome-cru" v-if="prec(item.proponente_principal)">
          A agenda trazia: <b v-text="item.proponente_principal.nome || '(vazio)'"></b> — não foi possível
          identificar com segurança. Escolha abaixo ou deixe sem id.
        </div>
        <select :value="item.proponente_principal.id_assembleia == null ? '' : item.proponente_principal.id_assembleia"
                @change="$emit('escolher', {alvo:item.proponente_principal, id:$event.target.value})">
          <option value="">— sem id (nome preservado) —</option>
          <optgroup label="Sugestões" v-if="cands(item.proponente_principal).length">
            <option v-for="d in cands(item.proponente_principal)" :key="'s'+d.id" :value="d.id"
                    v-text="d.nome + ' (' + d.partido + ')'"></option>
          </optgroup>
          <optgroup label="Todos os deputados">
            <option v-for="d in cadastro" :key="d.id" :value="d.id" v-text="d.nome + ' (' + d.partido + ')'"></option>
          </optgroup>
        </select>
        <label class="cx-switch" style="margin-top:6px">
          <input type="checkbox" :checked="item.proponente_principal.is_deputado === false"
                 @change="marcarOrgao(item.proponente_principal, $event.target.checked)">
          é órgão (Poder Executivo, TCE...) — sem bancada impedida
        </label>
      </div>
    </div>

    <!-- COAUTORES — "Deputado(a) Beto Fantinel + 3 Deputado(s)".
         Estava no JSON mas NÃO na tela: o secretário não conseguia
         conferir nem corrigir. Dado invisível é dado não verificável. -->
    <div class="cx-fld">
      <label class="fld-lbl">Coautores adicionais</label>
      <input type="number" min="0" :value="item.coautores_adicionais || 0"
             @input="item.coautores_adicionais = parseInt($event.target.value) || 0">
      <div class="cx-nome-cru" v-if="item.coautores_adicionais > 0">
        Além do proponente principal, mais <b v-text="item.coautores_adicionais"></b> deputado(s).
      </div>
    </div>

    <!-- DATA DE DISTRIBUIÇÃO (proposições já distribuídas) -->
    <div class="cx-fld" v-if="contexto === 'distribuida'">
      <label class="fld-lbl">Data de distribuição</label>
      <input type="text" :value="item.data_distribuicao || ''"
             @input="item.data_distribuicao = $event.target.value.trim() || null"
             placeholder="AAAA-MM-DD">
    </div>

    <!-- EMENTA -->
    <div class="cx-fld wide">
      <label class="fld-lbl" v-text="item.tipo === 'RAP' ? 'Assunto' : 'Ementa'"></label>
      <textarea :value="item.ementa" @input="item.ementa = $event.target.value"></textarea>
    </div>

    <!-- RELATOR (não aparece na Fase B: lá é sugestão) -->
    <div class="cx-fld wide" v-if="!item._fase_b" :class="{'cx-confira': prec(item.relator)}">
      <label class="fld-lbl">
        Relator
        <span class="cx-selo" v-if="prec(item.relator)">⚠ confira</span>
      </label>
      <div class="cx-nome-cru" v-if="prec(item.relator)">
        A agenda trazia: <b v-text="item.relator.nome"></b> — não identificado no cadastro.
        <span v-if="item.tipo === 'RELSUB'">Em RELSUB o relator pode ser <b>externo</b> à comissão: nesse caso, deixe sem id.</span>
      </div>
      <select :value="item.relator == null ? '' : (item.relator.id_assembleia == null ? '__semid__' : item.relator.id_assembleia)"
              @change="trocarRelator($event.target.value)">
        <option value="">— sem relator —</option>
        <option value="__semid__" v-if="item.relator" v-text="'(manter \\'' + item.relator.nome + '\\' sem id — relator externo)'"></option>
        <optgroup label="Sugestões" v-if="cands(item.relator).length">
          <option v-for="d in cands(item.relator)" :key="'r'+d.id" :value="d.id"
                  v-text="d.nome + ' (' + d.partido + ')'"></option>
        </optgroup>
        <optgroup label="Todos os deputados">
          <option v-for="d in cadastro" :key="d.id" :value="d.id" v-text="d.nome + ' (' + d.partido + ')'"></option>
        </optgroup>
      </select>
    </div>

    <!-- SUGESTÃO DE RELATORIA (Fase B e matérias a distribuir) -->
    <div class="cx-fld wide" v-if="item._fase_b || contexto === 'a_distribuir'"
         :class="{'cx-confira': prec(item.sugestao_relatoria)}">
      <label class="fld-lbl">
        Sugestão de relatoria
        <span class="cx-selo" v-if="prec(item.sugestao_relatoria)">⚠ confira</span>
      </label>
      <div class="cx-nome-cru" v-if="item._fase_b">
        Item em <b>votação conclusiva</b>: vota-se o projeto, sem relatoria nova (o parecer
        veio da reunião anterior). O nome sugerido pela agenda fica aqui — <b>não</b> no campo
        relator, que precisa permanecer vazio.
      </div>
      <select :value="item.sugestao_relatoria == null ? '' : (item.sugestao_relatoria.id_assembleia == null ? '__semid__' : item.sugestao_relatoria.id_assembleia)"
              @change="trocarSugestao($event.target.value)">
        <option value="">— sem sugestão —</option>
        <option value="__semid__" v-if="item.sugestao_relatoria"
			v-text="'(manter \\'' + item.sugestao_relatoria.nome + '\\' sem id)'"></option>
        <optgroup label="Todos os deputados">
          <option v-for="d in cadastro" :key="d.id" :value="d.id" v-text="d.nome + ' (' + d.partido + ')'"></option>
        </optgroup>
      </select>
    </div>

    <!-- PARECER -->
    <div class="cx-fld" v-if="!item._fase_b">
      <label class="fld-lbl">Parecer</label>
      <select :value="item.parecer || ''" @change="item.parecer = $event.target.value || null">
        <option value="">— sem parecer —</option>
        <option value="favoravel">favorável</option>
        <option value="favoravel_com_emendas">favorável com emendas</option>
        <option value="contrario">contrário</option>
      </select>
    </div>

    <!-- BANCADA IMPEDIDA (Art. 61-A) -->
    <div class="cx-fld">
      <label class="fld-lbl">Bancada impedida (Art. 61-A)</label>
      <input type="text" :value="item.bancada_impedida || ''"
             @input="item.bancada_impedida = $event.target.value.trim().toUpperCase() || null"
             placeholder="— indeterminada —">
      <div class="cx-nome-cru" v-if="!item.bancada_impedida && item.proponente_principal && item.proponente_principal.is_deputado !== false">
        Sem partido do proponente, a vedação não é verificável. <b>Sigla errada é pior que ausente</b> — só preencha se tiver certeza.
      </div>
    </div>

    <!-- ★ CAMPOS DO RAP (Requerimento de Audiência Pública).
         O parser já os extraía, mas a tela não os mostrava. -->
    <template v-if="item.tipo === 'RAP'">
      <div class="cx-fld">
        <label class="fld-lbl">Local da audiência</label>
        <input type="text" :value="item.local || ''"
               @input="item.local = $event.target.value.trim() || null">
      </div>
      <div class="cx-fld">
        <label class="fld-lbl">Modalidade</label>
        <select :value="item.modalidade || ''" @change="item.modalidade = $event.target.value || null">
          <option value="">— não informada —</option>
          <option value="presencial">presencial</option>
          <option value="híbrida">híbrida</option>
          <option value="virtual">virtual</option>
        </select>
      </div>
      <div class="cx-fld wide">
        <label class="fld-lbl">
          Convidados
          <span style="font-weight:400;text-transform:none;letter-spacing:0"
                v-text="'(' + (item.convidados ? item.convidados.length : 0) + ')'"></span>
        </label>
        <div v-for="(cv, ci) in item.convidados" :key="'cv'+ci"
             style="display:flex;gap:6px;margin-bottom:4px">
          <input type="text" :value="cv" @input="item.convidados[ci] = $event.target.value" style="flex:1">
          <button class="btn btn-ghost btn-xs" @click="item.convidados.splice(ci,1)" title="Remover">×</button>
        </div>
        <button class="btn btn-ghost btn-xs" style="align-self:flex-start"
                @click="item.convidados.push('')">+ convidado</button>
      </div>
    </template>

    <!-- ★ PARECERES ANTERIORES (histórico de outras comissões).
         A tela de referência mostrava e permitia editar; eu havia
         suprimido. Aparece SEMPRE que houver parecer registrado, e nos
         itens em votação conclusiva (onde é o histórico que fundamenta
         a votação — a agenda nem sempre o traz, e o secretário completa).
         ATENÇÃO: 'relator' aqui é TEXTO histórico, não id do cadastro:
         reescrevê-lo com o nome de outro deputado destruiria o registro. -->
    <div class="cx-fld wide" v-if="item.votacao_conclusiva || (item.pareceres_anteriores && item.pareceres_anteriores.length)">
      <label class="fld-lbl">
        Pareceres anteriores
        <span style="font-weight:400;text-transform:none;letter-spacing:0"
              v-text="'(' + (item.pareceres_anteriores ? item.pareceres_anteriores.length : 0) + ')'"></span>
      </label>
      <div class="cx-nome-cru" style="margin-bottom:6px">
        Histórico de outras comissões. O nome do relator é registro <b>histórico</b> —
        gravado como veio, sem casar com o cadastro atual.
      </div>
      <div v-for="(pa, pi) in item.pareceres_anteriores" :key="'pa'+pi"
           style="display:flex;gap:6px;margin-bottom:4px;align-items:center">
        <input type="text" :value="pa.comissao" @input="pa.comissao = $event.target.value"
               placeholder="Comissão" style="width:90px">
        <input type="text" :value="pa.relator" @input="pa.relator = $event.target.value"
               placeholder="Relator (texto histórico)" style="flex:1">
        <select :value="pa.parecer || ''" @change="pa.parecer = $event.target.value || null" style="width:150px">
          <option value="">— sentido —</option>
          <option value="favoravel">favorável</option>
          <option value="favoravel_com_emendas">favorável com emendas</option>
          <option value="contrario">contrário</option>
        </select>
        <button class="btn btn-ghost btn-xs" @click="item.pareceres_anteriores.splice(pi,1)" title="Remover">×</button>
      </div>
      <button class="btn btn-ghost btn-xs" style="align-self:flex-start"
              @click="item.pareceres_anteriores.push({comissao:'', relator:'', parecer:null})">
        + parecer anterior
      </button>
    </div>

    <!-- FLAGS -->
    <div class="cx-fld wide" style="flex-direction:row;gap:16px;flex-wrap:wrap;align-items:center">
      <!-- Rótulo explícito: "tramitação conclusiva" em vez de só "conclusiva" -->
      <label class="cx-switch" v-if="item.tipo === 'PL' || item.tipo === 'PLC'">
        <input type="checkbox" :checked="item.votacao_conclusiva"
               @change="item.votacao_conclusiva = $event.target.checked"> tramitação conclusiva
      </label>
      <label class="cx-switch">
        <input type="checkbox" :checked="item.maioria_simples"
               @change="item.maioria_simples = $event.target.checked"> maioria simples
      </label>
      <label class="cx-switch">
        <input type="checkbox" :checked="item.eleicao"
               @change="item.eleicao = $event.target.checked"> eleição
      </label>
      <label class="cx-switch">
        <input type="checkbox" :checked="item.permite_pedido_vista"
               @change="item.permite_pedido_vista = $event.target.checked"> permite pedido de vista
      </label>
      <label class="cx-switch" v-if="contexto === 'recebida'">
        <input type="checkbox" :checked="item.sujeita_emendas"
               @change="item.sujeita_emendas = $event.target.checked"> sujeita a emendas
      </label>
    </div>

    <!-- ═══ CAMPOS EXCLUSIVOS DA ORDEM DO DIA ═══
         Nenhum destes vem na agenda — são histórico de reuniões
         passadas ou deliberação da própria reunião, preenchidos à mão
         pelo secretário. Existiam na tela de referência e faltavam aqui. -->
    <template v-if="contexto === 'od'">

      <!-- Cargo em disputa — só faz sentido quando é eleição -->
      <div class="cx-fld" v-if="item.eleicao">
        <label class="fld-lbl">Cargo em eleição</label>
        <input type="text" :value="item.cargo_eleicao || ''"
               @input="item.cargo_eleicao = $event.target.value.trim() || null"
               placeholder="ex.: Vice-presidente da comissão">
      </div>

      <!-- Relatório lido em sessão anterior — item que retornou (vista,
           quórum perdido) e cujo relatório não será relido. NÃO confundir
           com o relatorio_lido (boolean) da execução ao vivo. -->
      <div class="cx-fld">
        <label class="fld-lbl">Relatório já lido em (sessão anterior)</label>
        <input type="text" :value="item.relatorio_lido_em || ''"
               @input="item.relatorio_lido_em = $event.target.value.trim() || null"
               placeholder="AAAA-MM-DD — vazio se não foi lido antes">
        <div class="cx-nome-cru" v-if="item.relatorio_lido_em">
          O relatório foi lido em <b v-text="item.relatorio_lido_em"></b>; não precisa ser relido nesta reunião.
        </div>
      </div>

      <!-- Pedidos de vista anteriores — {bancada, deputado}. A BANCADA é
           o que importa regimentalmente (gera consequência no Art. 61-A);
           o deputado é registrado para citação. -->
      <div class="cx-fld wide">
        <label class="fld-lbl">
          Pedidos de vista anteriores
          <span style="font-weight:400;text-transform:none;letter-spacing:0"
                v-text="'(' + (item.pedidos_de_vista_anteriores ? item.pedidos_de_vista_anteriores.length : 0) + ')'"></span>
        </label>
        <div class="cx-nome-cru" style="margin-bottom:6px" v-if="item.pedidos_de_vista_anteriores && item.pedidos_de_vista_anteriores.length">
          A <b>bancada</b> é o que conta para o Art. 61-A; o deputado é para citação.
        </div>
        <div v-for="(pv, vi) in item.pedidos_de_vista_anteriores" :key="'pv'+vi"
             style="display:flex;gap:6px;margin-bottom:4px;align-items:center">
          <input type="text" :value="pv.bancada" @input="pv.bancada = $event.target.value.trim().toUpperCase()"
                 placeholder="Bancada (ex.: PT)" style="width:130px">
          <select :value="pv._deputado_id == null ? '' : pv._deputado_id"
                  @change="escolherDeputadoVista(pv, $event.target.value)" style="flex:1">
            <option value="">— deputado (opcional) —</option>
            <option v-for="d in cadastro" :key="'pvd'+vi+'-'+d.id" :value="d.id"
                    v-text="d.nome + ' (' + d.partido + ')'"></option>
          </select>
          <button class="btn btn-ghost btn-xs" @click="item.pedidos_de_vista_anteriores.splice(vi,1)" title="Remover">×</button>
        </div>
        <button class="btn btn-ghost btn-xs" style="align-self:flex-start"
                @click="item.pedidos_de_vista_anteriores.push({bancada:'', deputado:null, _deputado_id:null})">
          + pedido de vista
        </button>
      </div>

      <!-- Emendas ao item — número, autoria e descrição são do construtor;
           votos e resultado ficam para a reunião ao vivo. -->
      <div class="cx-fld wide">
        <label class="fld-lbl">
          Emendas
          <span style="font-weight:400;text-transform:none;letter-spacing:0"
                v-text="'(' + (item.emendas ? item.emendas.length : 0) + ')'"></span>
        </label>
        <div v-for="(em, ei) in item.emendas" :key="'em'+ei" class="cx-item" style="margin-bottom:6px">
          <div class="cx-grid">
            <div class="cx-fld">
              <label class="fld-lbl">Número</label>
              <input type="number" min="1" :value="em.numero"
                     @input="em.numero = parseInt($event.target.value) || null" style="width:80px">
            </div>
            <div class="cx-fld" :class="{'cx-confira': em.autoria && em.autoria._confira}">
              <label class="fld-lbl">Autoria</label>
              <select :value="em.autoria == null ? '' : (em.autoria.id_assembleia == null ? '__semid__' : em.autoria.id_assembleia)"
                      @change="escolherAutoriaEmenda(em, $event.target.value)">
                <option value="">— sem autoria —</option>
                <option value="__semid__" v-if="em.autoria"
						v-text="'(manter \\'' + em.autoria.nome + '\\' sem id)'"></option>>
                <option v-for="d in cadastro" :key="'ema'+ei+'-'+d.id" :value="d.id"
                        v-text="d.nome + ' (' + d.partido + ')'"></option>
              </select>
            </div>
            <div class="cx-fld wide">
              <label class="fld-lbl">Descrição</label>
              <textarea :value="em.descricao || ''" @input="em.descricao = $event.target.value || null"></textarea>
            </div>
          </div>
          <div style="text-align:right;margin-top:4px">
            <button class="btn btn-ghost btn-xs" @click="item.emendas.splice(ei,1)">Remover emenda</button>
          </div>
        </div>
        <button class="btn btn-ghost btn-xs" style="align-self:flex-start"
                @click="item.emendas.push({numero:item.emendas.length+1, autoria:null, descricao:null, resultado:null, votos_favoraveis:[], votos_contrarios:[]})">
          + emenda
        </button>
      </div>

    </template>

    </div>
  </div>`,
  methods:{
    /* precisa conferir? */
    prec(o){ return !!(o && o._confira); },
    /* candidatos sugeridos, resolvidos para objetos do cadastro */
    cands(o){
      if(!o || !o._candidatos) return [];
      return o._candidatos.map(id => CAD.deputados[id]).filter(Boolean);
    },
    marcarOrgao(prop, ehOrgao){
      if(ehOrgao){
        prop.is_deputado = false;
        prop.id_assembleia = null;
        prop.partido = null;
        prop._confira = false;          // decisão do humano
      } else {
        prop.is_deputado = true;
        prop._confira = prop.id_assembleia == null;
      }
      this.$emit('escolher', {alvo:null, id:null});   // dispara relint
    },
    trocarRelator(val){
      if(val === ''){ this.item.relator = null; }
      else if(val === '__semid__'){
        // Relator EXTERNO: mantém nome, id null, conferido pelo humano.
        if(this.item.relator){
          this.item.relator.id_assembleia = null;
          this.item.relator.partido = null;
          this.item.relator._confira = false;
        }
      } else {
        const d = CAD.deputados[val];
        if(d){
          this.item.relator = {id_assembleia:d.id, nome:d.nome, partido:d.partido,
                               _confira:false, _status:'resolvido', _candidatos:[]};
        }
      }
      this.$emit('escolher', {alvo:null, id:null});
    },
    trocarSugestao(val){
      if(val === ''){ this.item.sugestao_relatoria = null; }
      else if(val === '__semid__'){
        if(this.item.sugestao_relatoria){
          this.item.sugestao_relatoria.id_assembleia = null;
          this.item.sugestao_relatoria.partido = null;
          this.item.sugestao_relatoria._confira = false;
        }
      } else {
        const d = CAD.deputados[val];
        if(d){
          this.item.sugestao_relatoria = {id_assembleia:d.id, nome:d.nome, partido:d.partido,
                                          _confira:false, _status:'resolvido', _candidatos:[]};
        }
      }
      this.$emit('escolher', {alvo:null, id:null});
    },
    /* Pedido de vista: guarda id + nome do deputado (para citação). A
       bancada é campo à parte e é o que importa regimentalmente. */
    escolherDeputadoVista(pv, val){
      if(val === ''){ pv.deputado = null; pv._deputado_id = null; }
      else {
        const d = CAD.deputados[val];
        if(d){
          pv._deputado_id = d.id;
          pv.deputado = d.nome;
          if(!pv.bancada) pv.bancada = d.partido;   // sugere a bancada, editável
        }
      }
      this.$emit('escolher', {alvo:null, id:null});
    },
    /* Autoria de emenda: mesmo padrão dos demais nomes (dropdown, com
       opção de manter sem id). */
    escolherAutoriaEmenda(em, val){
      if(val === ''){ em.autoria = null; }
      else if(val === '__semid__'){
        if(em.autoria){ em.autoria.id_assembleia = null; em.autoria.partido = null; em.autoria._confira = false; }
      } else {
        const d = CAD.deputados[val];
        if(d) em.autoria = {id_assembleia:d.id, nome:d.nome, partido:d.partido,
                            _confira:false, _status:'resolvido', _candidatos:[]};
      }
      this.$emit('escolher', {alvo:null, id:null});
    }
  }
};

/* ══════════════════════════════════════════════════════════════════
   APP
   ══════════════════════════════════════════════════════════════════ */
createApp({
  components:{ 'prop-campos': PropCampos },

  setup(){
    const textoBruto = ref('');
    const fatias     = ref({});
    const fatiaAberta= ref(null);
    const processado = ref(false);
    const verJson    = ref(false);
    const alvo       = ref(null);
    const relint     = ref(0);          // força recomputo dos avisos após edição
    const pauta      = reactive(pautaVazia());
    const abertas    = reactive({meta:true, atas:true, exp:true, conh:true, od:true, ag:false});
    const cadOk      = ref(false);

    const listaDeps = computed(() =>
      Object.values(CAD.deputados).sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR')));

    const fonteCadastros = computed(() => {
      if(!cadOk.value) return '';
      const f = descrFonteCadastros();
      return `cadastros: ${f.dep}${f.comOk ? ' · comissões: arquivo' : ' · comissões: não carregado'}`;
    });

    /* ── PROCESSAR ─────────────────────────────────────────────── */
    function processar(){
      const txt = textoBruto.value;
      if(!txt.trim()) return;

      // Reset EM MEMÓRIA. Nunca location.reload: o servidor local
      // atende 1 requisição por vez e o reload causa timeout.
      Object.assign(pauta, pautaVazia());

      fatias.value = fatiar(txt);

      parsearCabecalho(fatias.value.cabecalho || '');
      parsearAtas(fatias.value.atas || '');
      parsearExpediente(fatias.value.expediente || '');
      parsearConhecimento(fatias.value.conhecimento || '');
      parsearOrdemDoDia(fatias.value.ordem_do_dia || '');
      parsearFinais(fatias.value.assuntos_gerais || '', fatias.value.rodape || '');

      aplicarComissao();
      processado.value = true;
      relint.value++;
    }

    /* Cabeçalho real:
         COMISSÃO DE ECONOMIA, TRABALHO, DESENVOLVIMENTO SUSTENTÁVEL E TURISMO
         AGENDA
         Reunião Ordinária
         Data e Hora: 24/06/2026 09:00
         Local: Sala Dr. Alberto Pasqualini, 4º andar - Híbrida
       A sigla NÃO aparece: é derivada do nome da comissão pelo cadastro. */
    function parsearCabecalho(txt){
      const md = pauta.metadados;

      const mCom = txt.match(/^\s*COMISS[ÃA]O\s+DE\s+([^\n]+)/im);
      if(mCom) md.comissao = ('Comissão de ' + mCom[1].trim()).replace(/\s+/g,' ');

      // Sigla: explícita, ou casada contra o cadastro de comissões pelo nome.
      const mSig = txt.match(/\b(CEDST|CCJ|CFPFC|CECDCT|CSMA|CSSP|CCDH|CAPMA)\b/);
      if(mSig) md.sigla = mSig[1];
      else if(md.comissao){
        const c = acharComissao(md.comissao);
        if(c && c.sigla) md.sigla = c.sigla;
      }

      const mTipo = txt.match(/Reuni[ãa]o\s+(Ordin[áa]ria|Extraordin[áa]ria)/i);
      if(mTipo) md.tipo_reuniao = 'Reunião ' + (normNome(mTipo[1]).startsWith('ordin') ? 'Ordinária' : 'Extraordinária');

      // "Data e Hora: 24/06/2026 09:00"
      const mDH = txt.match(/Data\s+e\s+Hora\s*:\s*([^\n]+)/i);
      md.data       = dataISO(mDH ? mDH[1] : txt);
      md.hora_inicio= horaHHMM(mDH ? mDH[1] : txt);

      // "Local: Sala ... - Híbrida"  → local + modalidade no mesmo campo
      const mLocal = txt.match(/^\s*Local\s*:\s*([^\n]+)/im);
      if(mLocal){
        let loc = mLocal[1].trim();
        const mMod = loc.match(/[-–—]\s*(H[íi]brida|Presencial|Virtual|Remota)\s*$/i);
        if(mMod){
          const mod = normNome(mMod[1]);
          md.modalidade = mod.startsWith('hibrid') ? 'híbrida'
                        : mod.startsWith('virtual') || mod.startsWith('remot') ? 'virtual'
                        : 'presencial';
          loc = loc.slice(0, mMod.index).replace(/[-–—,\s]+$/,'').trim();
        }
        md.local = loc;
      }
    }

    /* Atas reais:
         1. Ata n.° 22/2026, da audiência pública de 15 de junho de 2026;
         2. Ata n.° 23/2026, da reunião ordinária de 17 de junho de 2026.
       Note "n.°" (com grau), data por extenso, e o TIPO da reunião no texto. */
    function parsearAtas(txt){
      if(!txt) return;
      txt.split('\n').forEach(linha => {
        const m = linha.match(/Ata\s*n\.?\s*[º°]?\s*(\d+)\s*\/\s*(\d{4})\s*,?\s*(?:d[ao]\s+)?([^\n]*)/i);
        if(!m) return;
        const resto = m[3] || '';
        let tipo = null;
        if(/audi[êe]ncia\s+p[úu]blica/i.test(resto))      tipo = 'Audiência Pública';
        else if(/reuni[ãa]o\s+ordin[áa]ria/i.test(resto)) tipo = 'Reunião Ordinária';
        else if(/reuni[ãa]o\s+extraordin/i.test(resto))   tipo = 'Reunião Extraordinária';
        pauta.aprovacao_atas.atas.push({
          numero: `${m[1]}/${m[2]}`,
          reuniao_referencia: dataISO(resto),
          tipo_reuniao: tipo,
          hora_inicio: null, status: null, ressalvas: []
        });
      });
    }

    function parsearExpediente(txt){
      if(!txt) return;
      const exp = pauta.leitura_expediente;

      // ★ SUBSEÇÕES: na agenda real são alíneas MINÚSCULAS —
      //     a) Correspondências recebidas
      //     b) Proposições Recebidas
      //     c) Proposições Distribuídas
      //     d) Matérias a serem distribuídas (art.61)
      // (a versão anterior procurava cabeçalhos em CAIXA ALTA, que não
      // existem no documento — nada casava e o expediente vinha vazio.)
      // O corte de cada alínea é a PRÓXIMA alínea: delimitador
      // determinístico, sem heurística de formatação.
      const alinea = (rx) => {
        const m = txt.match(rx);
        if(!m) return '';
        const resto = txt.slice(m.index + m[0].length);
        const prox = resto.search(/^[ \t]*[a-z]\)\s/m);      // próxima alínea
        return resto.slice(0, prox >= 0 ? prox : resto.length);
      };

      const tCorresp  = alinea(/^[ \t]*a\)\s*Correspond[êe]ncias?[^\n]*/im);
      const tRecebidas= alinea(/^[ \t]*b\)\s*Proposi[çc][õo]es\s+Recebidas[^\n]*/im);
      const tDistrib  = alinea(/^[ \t]*c\)\s*Proposi[çc][õo]es\s+Distribu[íi]das[^\n]*/im);
      const tADistrib = alinea(/^[ \t]*d\)\s*Mat[ée]rias?[^\n]*/im);

      // ★ CORRESPONDÊNCIAS (formato real):
      //   "1. Câmara de Vereadores de Agudo: Moção de Apoio ao ..."
      // O remetente vem antes do PRIMEIRO dois-pontos; o resto é a
      // mensagem. Itens numerados com "1." (ponto), não "1)".
      tCorresp.split('\n').forEach(linha => {
        const l = linha.trim();
        if(!l || !/^\d+\s*[.)]/.test(l)) return;
        const corpo = l.replace(/^\d+\s*[.)]\s*/,'').trim();
        const i = corpo.indexOf(':');
        exp.correspondencias_recebidas.push({
          remetente: i > 0 ? corpo.slice(0, i).trim() : corpo,
          mensagem:  i > 0 ? corpo.slice(i+1).trim() : null
        });
      });

      // b) Proposições Recebidas. A subseção "- Sujeitas a emendas
      // (art.60):" marca o prazo aberto — flag por posição no texto.
      const posEmendas = tRecebidas.search(/[-•]\s*Sujeitas?\s+a\s+emendas/i);
      extrairBlocos(tRecebidas).forEach(b => {
        const it = parsearProposicao(b, 'recebida');
        if(posEmendas >= 0 && b.inicio > posEmendas) it.sujeita_emendas = true;
        exp.proposicoes_recebidas.push(it);
      });

      // c) Proposições Distribuídas (já têm relator)
      extrairBlocos(tDistrib).forEach(b => {
        exp.proposicoes_distribuidas.push(parsearProposicao(b, 'distribuida'));
      });

      // d) Matérias a serem distribuídas (art.61) — recebem relator NESTA
      // reunião. Se a agenda trouxer um nome aqui, é SUGESTÃO, não relator.
      extrairBlocos(tADistrib).forEach(b => {
        const it = parsearProposicao(b, 'a_distribuir');
        if(it.relator && !it.sugestao_relatoria){
          it.sugestao_relatoria = it.relator;
          it.relator = null;
        }
        exp.materias_a_distribuir.push(it);
      });
    }

    /* ★ CONHECIMENTO DE MATÉRIAS — estrutura real:
         1. <texto informativo>
         2. <texto informativo>
         3. <texto que pede autorização → deliberativo administrativo>
         4. Audiências Públicas agendadas
            Data: ... / Local: ... / Proponente: ... / Pauta: ...   (repete)
         - Requerimento para conhecimento:
            1) Requerimentos Diversos n.º 56/2025 - <texto> (Tribunal de Contas)

       A versão anterior varria linha a linha e jogava quase tudo em
       "informativos" — as subseções se perdiam. Agora cada uma é
       recortada pelo seu próprio cabeçalho. */
    function parsearConhecimento(txt){
      if(!txt) return;
      const c = pauta.conhecimento_materias;

      const iAud = txt.search(/^\s*\d+\.\s*Audi[êe]ncias?\s+P[úu]blicas?\s+agendadas/im);
      const iReq = txt.search(/^[ \t]*[-•]\s*Requerimentos?\s+para\s+conhecimento/im);

      const fimNumerados = Math.min(
        iAud >= 0 ? iAud : Infinity,
        iReq >= 0 ? iReq : Infinity,
        txt.length
      );

      // ── Itens numerados: informativo ou deliberativo administrativo ──
      // Cortar a LINHA DO CABEÇALHO da seção ("III - CONHECIMENTO DE
      // MATÉRIAS...") — senão ela entra como se fosse um informativo.
      // A fatia pode começar com quebras de linha, então localizamos o
      // fim da linha do título em vez de assumir que é a primeira.
      const mTitulo = txt.match(/^[\s\S]*?CONHECIMENTO\s+DE\s+MAT[ÉE]RIA[^\n]*\n/im);
      const corpoNum = txt.slice(mTitulo ? mTitulo[0].length : 0, fimNumerados);
      // Um item = "N." até o próximo "N." (o texto é longo e quebra linha)
      const partes = corpoNum.split(/\n(?=[ \t]*\d+\.\s)/);
      partes.forEach(p => {
        if(!/^\s*\d+\.\s/.test(p)) return;                // não é item numerado
        const t = p.replace(/^\s*\d+\.\s*/,'').replace(/\s*\n\s*/g,' ').trim();
        if(t.length < 8) return;
        // Pede autorização/aprovação → precisa de deliberação da comissão.
        if(/^autoriza[çc][ãa]o|autoriza[çc][ãa]o\s+para|solicita\s+autoriza|aprova[çc][ãa]o\s+d[eo]/i.test(t)){
          c.deliberativos_administrativos.push({texto:t, requer_deliberacao:true});
        } else {
          c.informativos.push({texto:t});
        }
      });

      // ── Audiências públicas agendadas (blocos Data/Local/Proponente/Pauta) ──
      if(iAud >= 0){
        const fimAud = (iReq >= 0 && iReq > iAud) ? iReq : txt.length;
        const bloco = txt.slice(iAud, fimAud);
        // Cada audiência começa numa linha "Data:". O split produz
        // fragmentos vazios entre os blocos (a agenda tem linhas em
        // branco de sobra) — só aceitamos o que de fato tem "Data:".
        bloco.split(/\n(?=[ \t]*Data\s*:)/i).forEach(b => {
          if(!/^\s*Data\s*:/i.test(b)) return;          // fragmento sem audiência
          const g = (rx) => { const m = b.match(rx); return m ? m[1].trim().replace(/\.$/,'') : null; };
          const dataCrua = g(/Data\s*:\s*([^\n]+)/i);
          const propCru  = g(/Proponente\s*:\s*([^\n]+)/i);
          const res = propCru ? resolverNome(propCru) : null;
          c.audiencias_agendadas.push({
            data: dataISO(dataCrua || ''),
            hora: horaHHMM(dataCrua || ''),
            local: g(/Local\s*:\s*([^\n]+)/i),
            modalidade: null,
            pauta: g(/Pauta\s*:\s*([^\n]+)/i),
            // Proponente da audiência: mesmo tratamento dos demais nomes —
            // resolve só com match exato, senão preserva e sinaliza.
            proponente: res ? paraDeputadoPlano(res) : null,
            id_requerimento: null,
            comissoes_parceiras: []
          });
        });
      }

      // ── Requerimentos para conhecimento (RDI etc.) ──
      if(iReq >= 0){
        const bloco = txt.slice(iReq);
        extrairBlocos(bloco).forEach(b => {
          // Formato: "1) Requerimentos Diversos n.º 56/2025 - <texto> (Origem)"
          const resto = b.corpo.replace(/^[ \t]*\d+\s*[).]\s*.+?n\.?\s*[º°]?\s*\d+\s*\/\s*\d{4}\s*[-–—]?\s*/i,'');
          const texto = resto.replace(/\s*\n\s*/g,' ').trim();
          const mOrigem = texto.match(/\(([^)]+)\)\s*$/);
          c.requerimentos_conhecimento.push({
            tipo: b.tipo,
            numero: b.numero,
            ano: b.ano,
            id: `${b.tipo.toLowerCase()}-${String(b.numero).padStart(4,'0')}-${b.ano}`,
            texto: texto,
            origem: mOrigem ? mOrigem[1].trim() : null
          });
        });
      }
    }

    function parsearOrdemDoDia(txt){
      if(!txt) return;
      let ordem = 1;
      extrairBlocos(txt).forEach(b => {
        const it = parsearProposicao(b, 'od');
        it.ordem = ordem++;
        pauta.ordem_do_dia.push(it);
      });
    }

    /* Assuntos gerais reais: itens numerados, cada um terminando em
       "por solicitação do Deputado Fulano." */
    function parsearFinais(txtAG, txtRod){
      if(txtAG){
        // Corta a linha do título ("V - ASSUNTOS GERAIS") e fica só com
        // os itens numerados. Aceitamos apenas fragmentos que COMEÇAM com
        // "N." — o split solto produzia um item fantasma com o cabeçalho.
        const mT = txtAG.match(/^[\s\S]*?ASSUNTOS\s+GERAIS[^\n]*\n/im);
        const corpo = txtAG.slice(mT ? mT[0].length : 0);
        corpo.split(/\n(?=[ \t]*\d+\.\s)/).forEach(p => {
          if(!/^\s*\d+\.\s/.test(p)) return;              // não é item
          const t = p.replace(/^\s*\d+\.\s*/,'').replace(/\s*\n\s*/g,' ').trim();
          if(t.length < 8) return;
          // "por solicitação da Deputada Sofia Cavedon." / "do Dep. Leonel Radde."
          // O tratamento é removido depois, por limparNome() — aqui só
          // capturamos o trecho. (Tentar comê-lo aqui com um grupo opcional
          // fazia o "\s*" seguinte devorar letras do nome: "Deputada Sofia"
          // virava "utada Sofia". Mesmo defeito do "Deputado Adão" → "dão".)
          // O tratamento ABREVIADO traz um ponto ("Dep."), que não pode
          // encerrar a captura — só o ponto FINAL da frase encerra.
          const mSol = t.match(/por\s+solicita[çc][ãa]o\s+d[oae]s?\s+((?:Dep\.\s*)?[^.,;]+)/i);
          const res = mSol ? resolverNome(mSol[1]) : null;
          pauta.assuntos_gerais.itens.push({
            texto: t,
            solicitante: res ? paraDeputadoPlano(res) : null
          });
        });
        const mProx = txtAG.match(/pr[óo]xima\s+reuni[ãa]o[^\n]*/i);
        if(mProx) pauta.assuntos_gerais.proxima_reuniao = dataISO(mProx[0]);
      }
      if(txtRod){
        // Rodapé real (vem de TABELA do Word):
        //   Palácio Farroupilha, 19 de junho de 2026.
        //   Deputado(a) Gustavo Victorino,
        //   Presidente da Comissão.
        const mLoc = txtRod.match(/^([^,\n]+)/);
        if(mLoc) pauta.rodape.local = mLoc[1].trim();
        pauta.rodape.data_emissao = dataISO(txtRod);
        // Presidente assinante: resolvido pelo cadastro; se não casar,
        // mantém o que veio do cadastro de comissões (aplicarComissao).
        const mPres = txtRod.match(/\n\s*(?:Deputad[oa]\s*\(?a?\)?\s*)?([^\n,]+),?\s*\n\s*Presidente/i);
        if(mPres){
          const res = resolverNome(mPres[1]);
          if(res.id_assembleia != null) pauta.rodape.presidente = res.id_assembleia;
        }
      }
    }

    /* Composição da comissão: vem do CADASTRO (o roteiro/agenda não a
       traz). Precedência do projeto: roteiro → arquivo → aviso. Como a
       agenda não traz composição, o arquivo preenche. */
    function aplicarComissao(){
      const chave = pauta.metadados.sigla || pauta.metadados.comissao;
      if(!chave) return;
      const comp = resolverComposicao(null, chave);
      if(comp){
        pauta.membros_comissao.titulares = comp.titulares;
        pauta.membros_comissao.suplentes = comp.suplentes;
      }
      const c = acharComissao(chave);
      if(c){
        pauta.membros_comissao.presidente = c.presidente_id || null;
        pauta.rodape.presidente = c.presidente_id || null;
        pauta.metadados.condutor_id = c.presidente_id || null;
        if(!pauta.metadados.comissao && c.nome) pauta.metadados.comissao = c.nome;
        if(!pauta.metadados.sigla && c.sigla)   pauta.metadados.sigla = c.sigla;
      }
      relint.value++;
    }

    /* ── LINTER (espelha o do check-in; o juiz final é ele) ─────── */
    const avisos = computed(() => {
      relint.value;                       // dependência explícita
      if(!processado.value) return [];
      const out = [];
      const add = (nivel, titulo, texto, ancora) => out.push({nivel, titulo, texto, ancora});

      const membros = new Set([
        ...pauta.membros_comissao.titulares,
        ...pauta.membros_comissao.suplentes
      ]);

      const checarConfira = (obj, rotulo, titulo, ancora) => {
        if(obj && obj._confira){
          add('warn', titulo,
              `${rotulo} "${obj.nome || '(vazio)'}" não foi identificado no cadastro. ` +
              `O nome está preservado e o id ficou vazio — escolha no dropdown ou confirme que é externo.`,
              ancora);
        }
      };

      // Ordem do Dia
      pauta.ordem_do_dia.forEach((it, i) => {
        const anc = 'od-' + i;
        const rot = `${it.tipo} ${it.numero}/${it.ano}`;

        checarConfira(it.proponente_principal, 'O proponente de ' + rot,
                      `Item ${i+1}: proponente não identificado`, anc);
        checarConfira(it.relator, 'O relator de ' + rot,
                      `Item ${i+1}: relator não identificado`, anc);

        // Fase B canônica: conclusiva + relator null + parecer null
        if(it.votacao_conclusiva && it.relator && !it.parecer){
          add('err', `Item ${i+1}: relator em conclusiva sem parecer`,
              `${rot} é votação conclusiva com relator preenchido e sem parecer. ` +
              `Isso costuma ser a SUGESTÃO de relatoria gravada no campo errado — mova para "sugestão".`, anc);
        }
        // Eleição × maioria simples
        if(it.eleicao && it.maioria_simples){
          add('err', `Item ${i+1}: eleição com maioria simples`,
              `${rot} está como eleição E maioria simples — incompatível. Eleição exige maioria qualificada.`, anc);
        }
        // Conclusiva ainda mencionada na ementa
        if(RX_CONCLUSIVA.test(it.ementa)){
          add('warn', `Item ${i+1}: conclusiva ainda na ementa`,
              `A ementa de ${rot} ainda menciona tramitação conclusiva. O campo já está marcado; limpe o texto.`, anc);
        }
        // Art. 61-A — relator do partido do proponente
        if(it.relator && it.relator.partido && it.bancada_impedida &&
           String(it.relator.partido).toUpperCase() === String(it.bancada_impedida).toUpperCase()){
          add('err', `Item ${i+1}: relator do partido do proponente`,
              `O relator de ${rot} é do ${it.relator.partido}, mesmo partido do proponente — vedado pelo Art. 61-A.`, anc);
        }
        // Impedimento não verificável
        if(!it.bancada_impedida && it.proponente_principal &&
           it.proponente_principal.is_deputado !== false && it.proponente_principal.id_assembleia == null){
          add('warn', `Item ${i+1}: impedimento não verificável`,
              `Sem o partido do proponente de ${rot}, a vedação do Art. 61-A não pode ser conferida. ` +
              `Identifique o proponente (ou marque como órgão).`, anc);
        }
        // Relator fora do quadro (informativo em RELSUB: é legítimo)
        if(it.relator && it.relator.id_assembleia != null && membros.size && !membros.has(it.relator.id_assembleia)){
          if(it.tipo === 'RELSUB'){
            add('info', `Item ${i+1}: relator externo (RELSUB)`,
                `O relator de ${rot} não é membro da comissão — legítimo em relatório final de subcomissão.`, anc);
          } else {
            add('warn', `Item ${i+1}: relator fora do quadro`,
                `O relator de ${rot} não consta entre os membros da comissão. Confira.`, anc);
          }
        }
        // Ementa vazia
        if(!it.ementa || !it.ementa.trim()){
          add('warn', `Item ${i+1}: sem ementa`,
              `${rot} ficou sem ementa — a agenda não trazia ou o parser não achou. Preencha.`, anc);
        }
      });

      // Matérias a distribuir
      pauta.leitura_expediente.materias_a_distribuir.forEach((it, i) => {
        const anc = 'mad-' + i;
        const rot = `${it.tipo} ${it.numero}/${it.ano}`;
        checarConfira(it.proponente_principal, 'O proponente de ' + rot,
                      `Matéria a distribuir ${i+1}: proponente não identificado`, anc);
        checarConfira(it.sugestao_relatoria, 'A sugestão de relatoria de ' + rot,
                      `Matéria a distribuir ${i+1}: sugestão não identificada`, anc);
        if(it.sugestao_relatoria && it.sugestao_relatoria.id_assembleia != null &&
           membros.size && !membros.has(it.sugestao_relatoria.id_assembleia)){
          add('warn', `Matéria a distribuir ${i+1}: sugestão fora do quadro`,
              `A sugestão de relatoria de ${rot} não consta entre os membros da comissão.`, anc);
        }
        if(it.sugestao_relatoria && it.sugestao_relatoria.partido && it.bancada_impedida &&
           String(it.sugestao_relatoria.partido).toUpperCase() === String(it.bancada_impedida).toUpperCase()){
          add('err', `Matéria a distribuir ${i+1}: sugestão da bancada impedida`,
              `A sugestão de relatoria de ${rot} é do ${it.sugestao_relatoria.partido}, ` +
              `mesmo partido do proponente — vedado pelo Art. 61-A.`, anc);
        }
      });

      // Expediente: proposições recebidas/distribuídas
      pauta.leitura_expediente.proposicoes_recebidas.forEach((it, i) => {
        checarConfira(it.proponente_principal, `O proponente de ${it.tipo} ${it.numero}/${it.ano}`,
                      `Proposição recebida ${i+1}: proponente não identificado`, 'exp-pr-' + i);
      });
      pauta.leitura_expediente.proposicoes_distribuidas.forEach((it, i) => {
        checarConfira(it.relator, `O relator de ${it.tipo} ${it.numero}/${it.ano}`,
                      `Proposição distribuída ${i+1}: relator não identificado`, 'exp-pd-' + i);
      });

      // Metadados essenciais
      if(!pauta.metadados.data)   add('warn','Sem data da reunião','A agenda não trouxe a data (ou o parser não achou). Preencha nos metadados.', null);
      if(!pauta.metadados.sigla)  add('warn','Sem sigla da comissão','Sem a sigla, a composição não é carregada do cadastro.', null);
      if(!pauta.membros_comissao.titulares.length){
        add('warn','Composição não carregada','Não foi possível carregar titulares/suplentes do cadastro de comissões. Confira a sigla.', null);
      }
      if(!pauta.ordem_do_dia.length){
        add('info','Ordem do Dia vazia','Nenhum item foi reconhecido na Ordem do Dia. Confira o texto colado.', null);
      }

      const ordem = {err:0, warn:1, info:2};
      out.sort((a,b) => ordem[a.nivel] - ordem[b.nivel]);
      return out;
    });

    const temErro = computed(() => avisos.value.some(a => a.nivel === 'err'));

    const rodapeInfo = computed(() => {
      if(!processado.value) return 'Nenhuma agenda processada.';
      const n = avisos.value.length;
      const e = avisos.value.filter(a => a.nivel === 'err').length;
      const od = pauta.ordem_do_dia.length;
      const base = `${od} item(ns) na Ordem do Dia`;
      if(!n) return base + ' · sem avisos ✓';
      return `${base} · ${n} aviso(s)${e ? `, ${e} erro(s)` : ''} — o check-in é o juiz final`;
    });

    /* ── EXPORTAÇÃO ────────────────────────────────────────────── */
    function montarJson(){
      const clone = JSON.parse(JSON.stringify(pauta));

      // Poda campos específicos de tipo que não se aplicam, e remove
      // TODO campo de UI (underscore) — inclusive dentro dos objetos
      // de deputado (_confira, _status, _candidatos).
      const podar = (it) => {
        if(it.tipo !== 'RAP'){ delete it.local; delete it.modalidade; delete it.convidados; }
        if(it.tipo !== 'REQSUB' && it.tipo !== 'RELSUB'){
          delete it.req_criacao; delete it.id_requerimento_origem;
          delete it.data_aprovacao_subcomissao; delete it.demais_integrantes; delete it.membros;
        }
        if(!it.eleicao) delete it.cargo_eleicao;
        return it;
      };
      clone.ordem_do_dia = clone.ordem_do_dia.map(podar);

      // Campos que só fazem sentido no expediente
      clone.leitura_expediente.proposicoes_recebidas.forEach(p => {
        delete p.sugestao_relatoria; delete p.forma_escolha_relator; delete p.data_distribuicao;
      });
      // proposicoes_distribuidas MANTÊM data_distribuicao (é o registro de
      // quando a matéria foi distribuída — informação da própria seção).
      clone.leitura_expediente.proposicoes_distribuidas.forEach(p => {
        delete p.sugestao_relatoria; delete p.sujeita_emendas;
      });
      clone.ordem_do_dia.forEach(p => {
        delete p.sujeita_emendas; delete p.forma_escolha_relator; delete p.data_distribuicao;
      });

      return limparCamposUI(clone);       // tira _confira, _status, _candidatos, _fase_b
    }

    const jsonPreview = computed(() => {
      relint.value;
      if(!processado.value) return '';
      return JSON.stringify(montarJson(), null, 2);
    });

    function nomeArquivo(){
      const s = pauta.metadados.sigla || 'ALRS';
      const d = pauta.metadados.data || 'sem-data';
      return `pauta_${s}_${d}.json`;
    }

    function baixarJson(){
      const blob = new Blob([JSON.stringify(montarJson(), null, 2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nomeArquivo();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }

    function copiarJson(){
      const txt = JSON.stringify(montarJson(), null, 2);
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(txt).catch(() => fallbackCopia(txt));
      } else {
        fallbackCopia(txt);
      }
    }
    function fallbackCopia(txt){
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand('copy'); }catch(e){}
      document.body.removeChild(ta);
    }

    /* ── AÇÕES DE UI ───────────────────────────────────────────── */
    function onEscolher(ev){
      if(ev && ev.alvo) aplicarEscolha(ev.alvo, ev.id === '' ? null : ev.id);
      // Re-deriva a bancada impedida: se o proponente mudou, a vedação muda.
      const rederiva = (it) => { it.bancada_impedida = bancadaImpedidaDe(it.proponente_principal); };
      pauta.ordem_do_dia.forEach(rederiva);
      pauta.leitura_expediente.materias_a_distribuir.forEach(rederiva);
      relint.value++;
    }

    function limparTudo(){
      // Reset EM MEMÓRIA (nunca reload — servidor local, 1 req/vez).
      textoBruto.value = '';
      fatias.value = {};
      fatiaAberta.value = null;
      processado.value = false;
      verJson.value = false;
      alvo.value = null;
      Object.assign(pauta, pautaVazia());
      relint.value++;
    }

    function trocarPropAudiencia(aud, val){
      if(val === ''){ aud.proponente = null; }
      else if(val === '__semid__'){
        if(aud.proponente){
          aud.proponente.id_assembleia = null;
          aud.proponente.partido = null;
          aud.proponente._confira = false;
        }
      } else {
        const d = CAD.deputados[val];
        if(d) aud.proponente = {id_assembleia:d.id, nome:d.nome, partido:d.partido,
                                _confira:false, _status:'resolvido', _candidatos:[]};
      }
      relint.value++;
    }

    function trocarSolicitante(item, val){
      if(val === ''){ item.solicitante = null; }
      else if(val === '__semid__'){
        if(item.solicitante){
          item.solicitante.id_assembleia = null;
          item.solicitante.partido = null;
          item.solicitante._confira = false;
        }
      } else {
        const d = CAD.deputados[val];
        if(d) item.solicitante = {id_assembleia:d.id, nome:d.nome, partido:d.partido,
                                  _confira:false, _status:'resolvido', _candidatos:[]};
      }
      relint.value++;
    }

    function toggle(k){ abertas[k] = !abertas[k]; }

    /* ── ADICIONAR ITENS EM BRANCO ──────────────────────────────────
       O construtor não pode só editar o que o parser leu: às vezes um
       item precisa existir na pauta sem ter vindo na agenda. O caso
       concreto que motivou isto — o secretário registra SEMPRE um item
       de assuntos gerais (mesmo sem nada agendado) para as manifestações
       espontâneas dos deputados em reunião; isso nunca aparece na agenda.
       A tela de referência tinha "adicionar" em todas as seções; eu havia
       deixado de portar. Todo push abre a seção e marca para conferência
       quando cabe. */
    function novoDeputadoPlano(){
      return {id_assembleia:null, nome:null, partido:null, _confira:false,
              _status:'vazio', _candidatos:[]};
    }

    function novaProposicaoNaSecao(lista, contexto){
      const it = itemVazio();
      it.proponente_principal = paraProponente(resolverNome(''));
      if(contexto === 'od') it.ordem = pauta.ordem_do_dia.length + 1;
      lista.push(it);
      relint.value++;
    }

    function adicionarAta(){
      pauta.aprovacao_atas.atas.push({
        numero:null, reuniao_referencia:null, tipo_reuniao:null,
        hora_inicio:null, status:null, ressalvas:[]
      });
      abertas.atas = true; relint.value++;
    }
    function adicionarCorrespondencia(){
      pauta.leitura_expediente.correspondencias_recebidas.push({remetente:null, mensagem:null});
      abertas.exp = true; relint.value++;
    }
    function adicionarInformativo(){
      pauta.conhecimento_materias.informativos.push({texto:''});
      abertas.conh = true; relint.value++;
    }
    function adicionarDeliberativo(){
      pauta.conhecimento_materias.deliberativos_administrativos.push({texto:'', requer_deliberacao:true});
      abertas.conh = true; relint.value++;
    }
    function adicionarRequerimentoConhecimento(){
      pauta.conhecimento_materias.requerimentos_conhecimento.push({
        tipo:'RDI', numero:null, ano:null, id:null, texto:'', origem:null
      });
      abertas.conh = true; relint.value++;
    }
    function adicionarAudiencia(){
      pauta.conhecimento_materias.audiencias_agendadas.push({
        data:null, hora:null, local:null, modalidade:null, pauta:'',
        proponente:null, id_requerimento:null, comissoes_parceiras:[]
      });
      abertas.conh = true; relint.value++;
    }
    function adicionarItemOD(){
      novaProposicaoNaSecao(pauta.ordem_do_dia, 'od');
      abertas.od = true;
    }
    function adicionarAssuntoGeral(){
      pauta.assuntos_gerais.itens.push({texto:'', solicitante:null});
      abertas.ag = true; relint.value++;
    }

    /* Item PADRÃO de assuntos gerais — o de manifestações espontâneas,
       que o secretário sempre inclui. Um clique, texto já preenchido. */
    function adicionarAssuntoPadrao(){
      pauta.assuntos_gerais.itens.push({
        texto:'Manifestações gerais dos senhores deputados.',
        solicitante:null
      });
      abertas.ag = true; relint.value++;
    }

    function removerDe(lista, i){
      lista.splice(i, 1);
      // Reordena a Ordem do Dia se for o caso
      if(lista === pauta.ordem_do_dia){
        pauta.ordem_do_dia.forEach((it, k) => { it.ordem = k + 1; });
      }
      relint.value++;
    }

    function irPara(ancora){
      if(!ancora) return;
      verJson.value = false;
      alvo.value = ancora;
      // Abre a seção que contém a âncora
      if(ancora.startsWith('od-'))   abertas.od = true;
      if(ancora.startsWith('mad-') || ancora.startsWith('exp-')) abertas.exp = true;
      setTimeout(() => {
        const el = document.getElementById(ancora);
        if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
      }, 60);
    }

    function alternarTema(){
      const atual = document.documentElement.getAttribute('data-theme') || 'light';
      const novo = atual === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', novo);
      try{ localStorage.setItem('ui_theme', novo); }catch(e){}
    }

    function nomeDe(id){
      if(id == null) return '—';
      const d = getDep(id);
      return d ? `${d.nome} (${d.partido})` : `ID ${id}`;
    }

    function rotuloFatia(k){ return ROTULOS_FATIA[k] || k; }
    function ehFaseB(it){ return !!it._fase_b || (it.votacao_conclusiva && !it.relator && !it.parecer); }

    function reclassificar(de, para, i){
      const c = pauta.conhecimento_materias;
      const item = c[de].splice(i, 1)[0];
      if(!item) return;
      if(para === 'deliberativos_administrativos'){
        c[para].push({texto:item.texto, requer_deliberacao:true});
      } else {
        c[para].push({texto:item.texto});
      }
      relint.value++;
    }

    const totalExpediente = computed(() => {
      const e = pauta.leitura_expediente;
      return e.correspondencias_recebidas.length + e.proposicoes_recebidas.length +
             e.proposicoes_distribuidas.length + e.materias_a_distribuir.length;
    });
    const totalConhecimento = computed(() => {
      const c = pauta.conhecimento_materias;
      return c.informativos.length + c.requerimentos_conhecimento.length +
             c.deliberativos_administrativos.length + c.audiencias_agendadas.length;
    });

    /* ── BOOT ──────────────────────────────────────────────────── */
    onMounted(async () => {
      // carregarCadastros SEMPRE resolve: se o fetch falhar, opera com o
      // fallback embutido de cadastros.js. Degradação graciosa de graça.
      await carregarCadastros();
      cadOk.value = true;
    });

    return {
      textoBruto, fatias, fatiaAberta, processado, verJson, alvo, pauta, abertas,
      listaDeps, fonteCadastros, avisos, temErro, rodapeInfo, jsonPreview,
      totalExpediente, totalConhecimento,
      processar, limparTudo, toggle, irPara, alternarTema, nomeDe, rotuloFatia,
      ehFaseB, reclassificar, onEscolher, baixarJson, copiarJson, aplicarComissao,
      trocarPropAudiencia, trocarSolicitante,
      adicionarAta, adicionarCorrespondencia, adicionarInformativo, adicionarDeliberativo,
      adicionarRequerimentoConhecimento, adicionarAudiencia, adicionarItemOD,
      adicionarAssuntoGeral, adicionarAssuntoPadrao, removerDe, novaProposicaoNaSecao
    };
  }
}).mount('#construtor');
