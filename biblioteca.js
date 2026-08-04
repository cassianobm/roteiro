'use strict';
/* ══════════════════════════════════════════════════════════════════
   biblioteca.js — Biblioteca de Reuniões (análise pós-reunião)

   Página de uso fora da reunião, foco desktop. Carrega 1+ JSONs
   consolidados (a saída do sistema ao vivo / checkout) e produz visões
   sobre o CONJUNTO — começando pelo relatório de presenças.

   Princípios herdados do projeto:
   - Scripts comuns (NÃO ES module), sem build, sem CDN, só memória.
   - NOME/PARTIDO vêm do cadastro (cadastros.js); o JSON traz o histórico.
   - Esqueleto extensível: novas visões entram como "relatórios" sobre
     BIB.reunioes, sem mexer na carga.

   Depende de: cadastros.js (carregarCadastros, getDep/resolveDep,
   normNome). Carrega em ordem: cadastros.js → biblioteca.js.
   ══════════════════════════════════════════════════════════════════ */

/* Estado global da página. Uma única fonte: as reuniões carregadas. */
const BIB = {
  reunioes: [],     // [{id, nome, arquivo, meeting, meta}] — ordem de carga
  _seq: 0,          // gerador de id interno (dedup de recarga)
};

/* getDep pode não existir aqui (é definido em script.js/checkin.js).
   A biblioteca declara a sua, no mesmo contrato. */
function getDep(id){
  return (typeof resolveDep==='function') ? resolveDep(id) : {id, nome:'ID '+id, partido:'?'};
}

/* ── CARGA ─────────────────────────────────────────────────────────
   Cada arquivo vira uma "reunião" no índice. Valida o mínimo para ser
   um consolidado do nosso schema; rejeita o resto sem derrubar a carga
   dos demais. Retorna {ok, erro} para a UI relatar arquivo a arquivo. */
function bibValidarMeeting(obj){
  if(!obj || typeof obj!=='object') return {ok:false, erro:'não é um objeto JSON'};
  if(!obj.metadados) return {ok:false, erro:'sem bloco metadados'};
  if(!obj.membros_comissao) return {ok:false, erro:'sem membros_comissao'};
  // Só RESULTADO entra na biblioteca, não agenda/pauta. O discriminador é
  // status_sessao — mesmo critério que o checkin.js usa (presente = pós-reunião;
  // ausente = pauta em edição). Uma agenda não tem execução/timelines: cruzá-la
  // produziria uma coluna de presenças toda vazia (o "0/12" enganoso).
  if(!obj.metadados.status_sessao){
    return {ok:false, erro:'é uma pauta/agenda (sem status_sessao), não um resultado de reunião'};
  }
  return {ok:true};
}

/* Extrai os campos de índice de um meeting — o que a lista mostra. */
function bibResumoReuniao(meeting){
  const md = meeting.metadados||{};
  const od = meeting.ordem_do_dia||[];
  return {
    comissao: md.comissao || '—',
    sigla: md.sigla || '—',
    data: md.data || null,
    tipo: md.tipo_reuniao || 'Reunião',
    quorumAbertura: !!(md.quorum?.abertura?.suficiente),
    quorumOD: md.quorum?.ordem_do_dia?.suficiente,   // pode ser false/true/undefined
    nItensOD: od.length,
    statusSessao: md.status_sessao || null,
  };
}

/* Adiciona uma reunião ao índice. `arquivo` é só o nome, para exibição.
   Dedup: se um mesmo arquivo (nome+data) for recarregado, substitui. */
function bibAdicionar(meeting, arquivo){
  const meta = bibResumoReuniao(meeting);
  const chave = `${arquivo}::${meta.data}`;
  const existente = BIB.reunioes.findIndex(r => r.chave===chave);
  const reg = {
    id: ++BIB._seq,
    chave,
    arquivo: arquivo||'(sem nome)',
    meeting,
    meta,
  };
  if(existente>=0) BIB.reunioes[existente]=reg;
  else BIB.reunioes.push(reg);
  bibOrdenar();
  return reg;
}

/* Ordena o índice por data (crescente); sem data vai para o fim. */
function bibOrdenar(){
  BIB.reunioes.sort((a,b)=>{
    const da=a.meta.data||'9999', db=b.meta.data||'9999';
    return da.localeCompare(db);
  });
}

function bibRemover(id){
  const i=BIB.reunioes.findIndex(r=>r.id===id);
  if(i>=0) BIB.reunioes.splice(i,1);
}

function bibLimpar(){ BIB.reunioes=[]; BIB._seq=0; }

/* ── RELATÓRIO DE PRESENÇAS ────────────────────────────────────────
   Matriz única: linhas = deputados, colunas = reuniões (por data).
   Regra da composição variável (decidida com o usuário):
     - o deputado ganha LINHA se foi titular em ao menos UMA reunião;
     - em cada reunião, a célula é:
         'P' se registrou presença em qualquer momento (titular)
         'F' se era titular naquela reunião e não registrou presença
         '—' se NÃO era titular naquela reunião (sem dever de presença)
   P = presença em qualquer fase/momento, independentemente da duração
   (decisão do usuário). Só titulares entram (membros efetivos).

   Fonte de P: união de todos os registros de presença de um meeting —
   timeline (quem em algum momento ficou ativo/acompanhando) + snapshots
   de quórum (abertura e OD) + presencas_gerais. A timeline sozinha não
   basta: um titular presente desde a abertura que nunca "mudou de
   estado" pode não ter evento na timeline. */

/* Conjunto de ids TITULARES de uma reunião. */
function _titularesDe(meeting){
  return new Set((meeting.membros_comissao?.titulares||[]).map(Number));
}

/* Conjunto de ids que registraram PRESENÇA (qualquer momento) na reunião. */
function _presentesDe(meeting){
  const md = meeting.metadados||{};
  const pres = new Set();
  (md.timeline_presencas||[]).forEach(t=>{
    if(t.para==='ativo'||t.para==='acompanhando'){
      if(t.id_assembleia!=null) pres.add(Number(t.id_assembleia));
    }
  });
  ['abertura','ordem_do_dia'].forEach(fase=>{
    const q = md.quorum?.[fase];
    ['titulares','suplentes'].forEach(g=>
      (q?.[g]||[]).forEach(d=>{ if(d.id_assembleia!=null) pres.add(Number(d.id_assembleia)); }));
  });
  ['titulares','suplentes'].forEach(g=>
    (md.presencas_gerais?.[g]||[]).forEach(d=>{ if(d.id_assembleia!=null) pres.add(Number(d.id_assembleia)); }));
  return pres;
}

/* Monta a matriz de presenças sobre as reunioes carregadas (ou um
   subconjunto por ids). Retorna:
     {
       colunas: [{id, data, sigla, rotulo}],
       linhas:  [{id_dep, nome, partido, celulas:['P'|'F'|'—'], totalP, totalTitular}],
       comissoesDistintasSiglas: [...],   // aviso se misturou comissões
     }
   Ordena linhas por nome; colunas por data. */
function bibMatrizPresencas(idsSelecionados){
  const regs = (idsSelecionados && idsSelecionados.length)
    ? BIB.reunioes.filter(r=>idsSelecionados.includes(r.id))
    : BIB.reunioes.slice();

  const colunas = regs.map(r=>({
    id: r.id,
    data: r.meta.data,
    sigla: r.meta.sigla,
    rotulo: _fmtDataCurta(r.meta.data),
  }));

  // União dos titulares de TODAS as reuniões selecionadas → linhas.
  const titularEm = {};   // id_dep -> Set(coluna.id) em que era titular
  const presenteEm = {};  // id_dep -> Set(coluna.id) em que registrou presença
  regs.forEach(r=>{
    const tit=_titularesDe(r.meeting);
    const pres=_presentesDe(r.meeting);
    tit.forEach(id=>{
      (titularEm[id] = titularEm[id]||new Set()).add(r.id);
      if(pres.has(id)) (presenteEm[id]=presenteEm[id]||new Set()).add(r.id);
    });
  });

  const linhas = Object.keys(titularEm).map(idStr=>{
    const id=Number(idStr);
    const dep=getDep(id);
    let totalP=0, totalTitular=0;
    const celulas = colunas.map(c=>{
      const eraTitular = titularEm[id].has(c.id);
      if(!eraTitular) return '—';
      totalTitular++;
      const presente = presenteEm[id] && presenteEm[id].has(c.id);
      if(presente){ totalP++; return 'P'; }
      return 'F';
    });
    return { id_dep:id, nome:dep.nome, partido:dep.partido, celulas, totalP, totalTitular };
  });

  linhas.sort((a,b)=>String(a.nome).localeCompare(String(b.nome)));

  // Aviso de comissões misturadas: se houver mais de uma sigla distinta.
  const siglas = [...new Set(regs.map(r=>r.meta.sigla).filter(Boolean))];

  return { colunas, linhas, comissoesDistintasSiglas:siglas };
}

/* ── HELPERS ───────────────────────────────────────────────────────*/
function _fmtDataCurta(iso){
  if(!iso) return '—';
  const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function bibFmtDataLonga(iso){
  if(!iso) return '—';
  const meses=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return iso;
  return `${+m[3]} de ${meses[+m[2]-1]} de ${m[1]}`;
}

/* ── KPIs (faixa de gestão) ────────────────────────────────────────
   Números-síntese do período carregado. Só o que os dados sustentam
   HOJE — nada de métrica que dependa de deliberações que ainda não
   ocorreram (essas ficam 0 e ganham vida quando houver OD real).
   Retorna [{rotulo, valor, sub}] na ordem de exibição. */
function bibKPIs(){
  const regs=BIB.reunioes;
  const n=regs.length;
  if(!n) return [];

  // Presença média de titulares por reunião (nº e %)
  let somaPres=0, somaTit=0, semQuorumOD=0, apreciadas=0;
  regs.forEach(r=>{
    const tit=_titularesDe(r.meeting);
    const pres=_presentesDe(r.meeting);
    let p=0; tit.forEach(id=>{ if(pres.has(id))p++; });
    somaPres+=p; somaTit+=tit.size;
    if(r.meta.quorumOD===false) semQuorumOD++;
    // Matérias efetivamente apreciadas = itens OD com desfecho deliberativo
    (r.meeting.ordem_do_dia||[]).forEach(it=>{
      const st=it.execucao?.status;
      if(st && st!=='falta_quorum' && st!=='nao_apreciado' && st!=='pendente') apreciadas++;
    });
  });
  const mediaPres = somaTit? (somaPres/n) : 0;
  const pctPres   = somaTit? Math.round((somaPres/somaTit)*100) : 0;

  return [
    { rotulo:'Reuniões no período', valor:String(n), sub:_periodoLabel(regs) },
    { rotulo:'Presença média (titulares)', valor:`${mediaPres.toFixed(1)}`, sub:`${pctPres}% do quadro` },
    { rotulo:'Sessões sem quórum de OD', valor:String(semQuorumOD), sub:n?`de ${n} reuniõe${n>1?'s':''}`:'' },
    { rotulo:'Matérias apreciadas', valor:String(apreciadas), sub:apreciadas?'com desfecho deliberativo':'nenhuma no período' },
  ];
}

function _periodoLabel(regs){
  const datas=regs.map(r=>r.meta.data).filter(Boolean).sort();
  if(!datas.length) return '';
  if(datas.length===1) return _fmtDataCurta(datas[0]);
  return `${_fmtDataCurta(datas[0])} – ${_fmtDataCurta(datas[datas.length-1])}`;
}

/* ── ASSIDUIDADE AGREGADA ──────────────────────────────────────────
   Resumo da matriz: por deputado, presenças / reuniões-como-titular e
   %. Ordena por % desc (ranking). Só conta reuniões em que a pessoa
   ERA titular (denominador honesto, coerente com a regra "—"). */
function bibAssiduidade(idsSelecionados){
  const mx=bibMatrizPresencas(idsSelecionados);
  const linhas=mx.linhas.map(l=>({
    nome:l.nome, partido:l.partido,
    presentes:l.totalP, elegiveis:l.totalTitular,
    pct: l.totalTitular? Math.round((l.totalP/l.totalTitular)*100) : null,
  }));
  linhas.sort((a,b)=>{
    if(a.pct===b.pct) return String(a.nome).localeCompare(String(b.nome));
    return (b.pct??-1)-(a.pct??-1);
  });

  // Por bancada (partido): soma presenças e elegibilidades
  const banc={};
  linhas.forEach(l=>{
    const p=l.partido||'—';
    (banc[p]=banc[p]||{partido:p, presentes:0, elegiveis:0});
    banc[p].presentes+=l.presentes; banc[p].elegiveis+=l.elegiveis;
  });
  const bancadas=Object.values(banc).map(b=>({
    ...b, pct: b.elegiveis? Math.round((b.presentes/b.elegiveis)*100):null
  })).sort((a,b)=>(b.pct??-1)-(a.pct??-1));

  return { deputados:linhas, bancadas, nReunioes:mx.colunas.length };
}

/* ── FLUXO / GARGALO DE MATÉRIAS ───────────────────────────────────
   Rastreia cada matéria pelo seu `id` estável entre as reuniões
   carregadas: quando foi distribuída a relator, quando (e se) foi
   apreciada na Ordem do Dia, e com que desfecho. Produz os dois
   números de gestão (distribuídas / pareceres aprovados), o balanço
   por tipo, e as duas filas de espera (o "quadro manual" automatizado).

   LIMITE HONESTO (exibido na tela): só enxerga matérias distribuídas
   DENTRO das reuniões carregadas. Distribuições anteriores ao período
   (ou ao sistema) são invisíveis — o estoque amadurece conforme o
   antigo escoa. É por isso que a fila carrega o aviso.

   Tipos que geram "parecer" (decisão do usuário):
     PL, PLC, PEC, VP, RDI. REQ/RAP/REQSUB não são parecer.
     RELSUB (subcomissão) é categoria à parte. */
const BIB_TIPOS_PARECER = ['PL','PLC','PEC','VP','RDI'];
const BIB_TIPOS_REQUERIMENTO = ['REQ','RAP','REQSUB'];

function _ehParecer(tipo){ return BIB_TIPOS_PARECER.includes(String(tipo||'').toUpperCase()); }
function _grupoTipo(tipo){
  const t=String(tipo||'').toUpperCase();
  if(_ehParecer(t)) return 'proposicao';
  if(BIB_TIPOS_REQUERIMENTO.includes(t)) return 'requerimento';
  if(t==='RELSUB') return 'subcomissao';
  return 'outro';
}

/* Título curto e estável de uma matéria, para as listas. */
function _tituloMateria(it){
  const t=it.tipo||''; const n=it.numero!=null?` ${it.numero}`:''; const a=it.ano?`/${it.ano}`:'';
  return `${t}${n}${a}`.trim();
}

/* Desfecho de um item de OD (já apreciado). Normaliza os status em
   baldes de gestão. Requerimentos usam os mesmos status. */
function _desfechoDe(ex){
  const st=ex?.status;
  if(st==='aprovado') return 'aprovado';
  if(st==='rejeitado') return 'rejeitado';
  if(st==='inconclusivo') return 'inconclusivo';
  if(st==='vista') return 'vista';
  if(st==='retirado') return 'retirado';
  if(st==='falta_quorum') return 'falta_quorum';
  return 'outro';
}

function bibFluxo(idsSelecionados){
  const regs = (idsSelecionados && idsSelecionados.length)
    ? BIB.reunioes.filter(r=>idsSelecionados.includes(r.id))
    : BIB.reunioes.slice();
  // Ordena por data para que "posterior" faça sentido no rastreio.
  regs.sort((a,b)=>String(a.meta.data||'9999').localeCompare(String(b.meta.data||'9999')));

  // ── Rastreio por id ──────────────────────────────────────────────
  // Para cada matéria vista, guarda: 1ª distribuição (data, relator) e a
  // apreciação mais recente na OD (status). id → registro.
  const mat = {};   // id -> {id, titulo, tipo, grupo, proponente, relator, dataDistrib, apreciada, desfecho, dataAprec}

  const registra = (id, base) => {
    if(!mat[id]) mat[id] = { id, ...base };
    else Object.assign(mat[id], base, {
      // não sobrescreve a 1ª distribuição já capturada
      dataDistrib: mat[id].dataDistrib || base.dataDistrib,
    });
    return mat[id];
  };

  regs.forEach(r=>{
    const m=r.meeting;
    const le=m.leitura_expediente||{};

    // Distribuições: materias_a_distribuir (feita nesta reunião) +
    // proposicoes_distribuidas (anunciada, feita antes). Ambas contam
    // como "distribuída" (1 por matéria — o registra() não duplica).
    [...(le.materias_a_distribuir||[]), ...(le.proposicoes_distribuidas||[])].forEach(p=>{
      const rel = (p.relator && typeof p.relator==='object') ? p.relator : null;
      if(!p.id) return;
      registra(p.id, {
        titulo:_tituloMateria(p), tipo:p.tipo, grupo:_grupoTipo(p.tipo),
        proponente: p.proponente_principal?.nome || '—',
        relator: rel?.nome || (typeof p.relator==='string'?p.relator:null),
        relatorPartido: rel?.partido || null,
        dataDistrib: p.data_distribuicao || null,
        distribuidaEm: r.meta.data,
      });
    });

    // Apreciações na OD: a mais recente vence (um item pode voltar).
    (m.ordem_do_dia||[]).forEach(it=>{
      if(!it.id) return;
      const rel=(it.relator&&typeof it.relator==='object')?it.relator:null;
      const desf=_desfechoDe(it.execucao);
      registra(it.id, {
        titulo:_tituloMateria(it), tipo:it.tipo, grupo:_grupoTipo(it.tipo),
        proponente: it.proponente_principal?.nome || '—',
        relator: rel?.nome || null,
        relatorPartido: rel?.partido || null,
        parecer: it.parecer || null,
        apreciada: desf!=='falta_quorum',   // falta de quórum não é apreciação
        naPautaSemQuorum: desf==='falta_quorum',
        desfecho: desf,
        dataAprec: r.meta.data,
      });
    });
  });

  const todas = Object.values(mat);

  // ── Dois números do semestre ─────────────────────────────────────
  const distribuidas = todas.filter(x=>x.dataDistrib || x.distribuidaEm).length;
  const pareceresAprovados = todas.filter(x=>_ehParecer(x.tipo) && x.desfecho==='aprovado').length;

  // ── Balanço por tipo ─────────────────────────────────────────────
  const porTipo = {};
  todas.forEach(x=>{
    const t=String(x.tipo||'—').toUpperCase();
    const b=(porTipo[t]=porTipo[t]||{tipo:t, grupo:x.grupo, distribuidas:0, apreciadas:0, aprovados:0, postergadas:0});
    if(x.dataDistrib || x.distribuidaEm) b.distribuidas++;
    if(x.apreciada) b.apreciadas++;
    if(x.desfecho==='aprovado') b.aprovados++;
    if(x.desfecho==='inconclusivo' || x.desfecho==='vista') b.postergadas++;
  });
  const gruposOrdem={proposicao:0, subcomissao:1, requerimento:2, outro:3};
  const linhasTipo=Object.values(porTipo).sort((a,b)=>
    (gruposOrdem[a.grupo]-gruposOrdem[b.grupo]) || String(a.tipo).localeCompare(String(b.tipo)));

  // ── Filas de espera (o quadro manual, automatizado) ──────────────
  // (1) Aguardando ENVIO do parecer: distribuída, nunca apreciada e não
  //     está parada na OD por falta de quórum.
  const aguardandoParecer = todas.filter(x=>
    (x.dataDistrib||x.distribuidaEm) && !x.apreciada && !x.naPautaSemQuorum
    && _grupoTipo(x.tipo)!=='requerimento'
  ).map(x=>({
    titulo:x.titulo, proponente:x.proponente, relator:x.relator||'—',
    relatorPartido:x.relatorPartido, dataDistrib:x.dataDistrib||x.distribuidaEm,
  })).sort((a,b)=>String(a.dataDistrib||'9999').localeCompare(String(b.dataDistrib||'9999')));

  // (2) Parecer entregue, aguardando APRECIAÇÃO: foi à OD mas caiu por
  //     falta de quórum (o caso do PL 358 / PLC 311 do print).
  const aguardandoApreciacao = todas.filter(x=>x.naPautaSemQuorum)
    .map(x=>({
      titulo:x.titulo, proponente:x.proponente, relator:x.relator||'—',
      relatorPartido:x.relatorPartido, parecer:x.parecer||null,
    })).sort((a,b)=>String(a.titulo).localeCompare(String(b.titulo)));

  return {
    nReunioes:regs.length,
    distribuidas, pareceresAprovados,
    linhasTipo,
    aguardandoParecer, aguardandoApreciacao,
  };
}

/* ── RELATORIA POR DEPUTADO (visão de pessoas) ─────────────────────
   Quantas matérias cada deputado relatou no período, e o andamento
   delas: aguardando parecer (distribuída, não apreciada), apreciadas,
   e aprovadas. Reaproveita o rastreamento por id do fluxo.
   Só conta matérias que geram parecer (PL, PLC, PEC, VP, RDI) —
   requerimentos não têm relator no sentido de parecer.
   Relator externo (RELSUB, id null) entra por NOME, à parte. */
function bibRelatoria(idsSelecionados){
  const regs = (idsSelecionados && idsSelecionados.length)
    ? BIB.reunioes.filter(r=>idsSelecionados.includes(r.id))
    : BIB.reunioes.slice();
  regs.sort((a,b)=>String(a.meta.data||'9999').localeCompare(String(b.meta.data||'9999')));

  // id da matéria -> {tipo, relatorId, relatorNome, relatorPartido, apreciada, aprovada}
  const mat={};
  const reg=(id,base)=>{ mat[id]=Object.assign(mat[id]||{}, base); };

  regs.forEach(r=>{
    const m=r.meeting;
    const le=m.leitura_expediente||{};
    // Distribuições registram o relator designado.
    [...(le.materias_a_distribuir||[]), ...(le.proposicoes_distribuidas||[])].forEach(p=>{
      if(!p.id || !_ehParecer(p.tipo)) return;
      const rel=(p.relator&&typeof p.relator==='object')?p.relator:null;
      if(rel) reg(p.id, {tipo:p.tipo, relatorId:rel.id_assembleia??null, relatorNome:rel.nome, relatorPartido:rel.partido});
    });
    // OD: relator + desfecho.
    (m.ordem_do_dia||[]).forEach(it=>{
      if(!it.id || !_ehParecer(it.tipo)) return;
      const rel=(it.relator&&typeof it.relator==='object')?it.relator:null;
      const desf=_desfechoDe(it.execucao);
      reg(it.id, {
        tipo:it.tipo,
        relatorId: rel?(rel.id_assembleia??null):mat[it.id]?.relatorId,
        relatorNome: rel?rel.nome:mat[it.id]?.relatorNome,
        relatorPartido: rel?rel.partido:mat[it.id]?.relatorPartido,
        apreciada: desf!=='falta_quorum' ? true : (mat[it.id]?.apreciada||false),
        aprovada: desf==='aprovado' ? true : (mat[it.id]?.aprovada||false),
      });
    });
  });

  // Agrupa por relator. Chave: id quando houver; senão nome (relator externo).
  const porRel={};
  Object.values(mat).forEach(x=>{
    if(!x.relatorNome) return;
    const chave = x.relatorId!=null ? `#${x.relatorId}` : `nome:${x.relatorNome}`;
    const r=(porRel[chave]=porRel[chave]||{
      id:x.relatorId, nome:x.relatorNome, partido:x.relatorPartido,
      externo:x.relatorId==null, total:0, apreciadas:0, aprovadas:0, aguardando:0,
    });
    r.total++;
    if(x.apreciada){ r.apreciadas++; if(x.aprovada)r.aprovadas++; }
    else r.aguardando++;
  });

  const relatores=Object.values(porRel).sort((a,b)=>
    (b.total-a.total) || String(a.nome).localeCompare(String(b.nome)));

  return { relatores, nReunioes:regs.length };
}
