'use strict';
/* ══════════════════════════════════════════════════════════════════
   documentos.js — Geração de documentos (ata textual e resumo)
   Módulo COMPARTILHADO entre o sistema ao vivo (index.html/script.js)
   e o checkout (checkin.html/checkin.js).

   Princípio: cada função de MONTAGEM recebe `meeting` como PARÂMETRO e
   RETORNA HTML (string ou {html,nome}). A ENTREGA (download .doc /
   imprimir .pdf) fica em funções separadas. Assim o mesmo HTML pode ser
   baixado como .doc OU impresso como .pdf conforme o contexto.

   O `meeting` DEVE vir consolidado (consolidarMeeting() no sistema ao
   vivo; o JSON do checkout já é consolidado por construção).

   LUGAR ÚNICO para ajustes de texto das atas — pedidos de mudança de
   redação passam a ser editados aqui, valendo para ambos os sistemas.

   Depende de getDep() (fornecido por cadastros.js/script.js/checkin.js).
   ══════════════════════════════════════════════════════════════════ */

/* Constantes e helpers próprios (para o módulo ser autossuficiente e
   funcionar tanto no sistema ao vivo quanto no checkout). */
const DOC_Q_DELIB = 7;   // quórum de deliberação (Ordem do Dia)
function docFmtData(s){
  if(!s)return'—';
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const[y,m,d]=s.split('-');return`${d}/${m}/${y}`;}
  return s;
}

/* ── Helpers de formatação (recebem meeting) ── */
function _expHelpers(meeting){
  function numWord(n){
    if(n<0||n>59)return String(n);
    const u=['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
    const e=['dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
    const d=['','','vinte','trinta','quarenta','cinquenta'];
    if(n<10)return u[n];
    if(n<20)return e[n-10];
    return d[Math.floor(n/10)]+(n%10>0?' e '+u[n%10]:'');
  }
  function anoPorExtenso(ano){
    const n=parseInt(ano,10);
    if(isNaN(n)||n<0)return String(ano);
    const u=['','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
    const dez=['dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
    const dz=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
    const cem=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
    function duasCasas(v){
      if(v===0)return'';
      if(v<10)return u[v];
      if(v<20)return dez[v-10];
      return dz[Math.floor(v/10)]+(v%10>0?' e '+u[v%10]:'');
    }
    function tresCasas(v){
      if(v===0)return'';
      const c=Math.floor(v/100),resto=v%100;
      if(c===0)return duasCasas(resto);
      const centena=(c===1&&resto===0)?'cem':cem[c];
      return centena+(resto>0?' e '+duasCasas(resto):'');
    }
    const milhar=Math.floor(n/1000),resto=n%1000;
    let partes=[];
    if(milhar>0)partes.push((milhar===1?'mil':duasCasas(milhar)+' mil'));
    if(resto>0)partes.push(tresCasas(resto));
    return partes.join(' e ')||'zero';
  }
  function dataPorExtenso(s){
    let dia,mesIdx,ano;
    const iso=(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const br=(s||'').match(/^(\d{1,2})\/(\d{2})\/(\d{4})$/);
    if(iso){ano=iso[1];mesIdx=parseInt(iso[2]);dia=parseInt(iso[3]);}
    else if(br){dia=parseInt(br[1]);mesIdx=parseInt(br[2]);ano=br[3];}
    else return s||'';
    const mes=['','janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][mesIdx];
    return `${dia===1?'primeiro dia':numWord(dia)+' dias'} do mês de ${mes} do ano de ${anoPorExtenso(ano)}`;
  }
  function horaPorExtenso(s){
    if(!s)return'horário regimental';
    // Tolera formatos variados: "09:50", "9h50", "09.50", "09 50",
    // "09:50:00" (ignora segundos). Se nada casar, devolve a string original
    // limpa — nunca concatena com "minutos" gerando "09.50minutos".
    const m=String(s).match(/(\d{1,2})\s*[:h.\s]\s*(\d{1,2})/i);
    if(!m)return String(s).trim();
    const h=parseInt(m[1],10), min=parseInt(m[2],10);
    if(isNaN(h)||isNaN(min)||h>23||min>59)return String(s).trim();
    const hE=h===1?'uma hora':h===2?'duas horas':numWord(h)+' horas';
    return hE+(min>0?(min===30?' e meia':` e ${numWord(min)} minutos`):'');
  }
  function formatOrador(nome){
    const primeiro=nome.split(' ')[0];
    const fem=/^(Stela|Delegada|Patrícia|Patric|Kelly|Sofia|Laura|Luciana|Janinha|Ana|Maria|Fernanda|Juliana|Alice|Claudia|Cláudia|Silvana|Franciane|Nadine|Bruna|Adriana|Eliana)/i.test(primeiro);
    return (fem?'a Deputada ':'o Deputado ')+nome;
  }
  // Proponente pode ser deputado OU órgão externo (Poder Executivo, Tribunal, MP...).
  // Respeita is_deputado: false → nome do órgão sem tratamento "Deputado".
  function formatProponente(prop){
    if(!prop)return '—';
    const nome=prop.nome||'—';
    if(nome==='—')return nome;
    // is_deputado ausente é tratado como true (retrocompat: schema antigo sem o campo)
    const ehDep=prop.is_deputado!==false;
    if(!ehDep)return nome; // órgão: só o nome
    const part=prop.partido?` (${prop.partido})`:'';
    return formatOrador(nome)+part;
  }
  // Versão curta (sem "o Deputado"), para listas compactas do PDF
  function nomeProponente(prop){
    if(!prop)return '—';
    return prop.nome||'—';
  }
  function tipoPorExtenso(t){
    const m={PL:'Projeto de Lei',PLC:'Projeto de Lei Complementar',PEC:'Proposta de Emenda à Constituição',
      RAP:'Requerimento de Audiência Pública',REQ:'Requerimento',VP:'Veto Parcial',VT:'Veto Total',
      RELSUB:'Relatório de Subcomissão',REQSUB:'Requerimento de Subcomissão',RDI:'Requerimento Diverso'};
    return m[t]||t;
  }
  function juntaNomes(arr){
    if(!arr.length)return'';
    if(arr.length===1)return arr[0];
    return arr.slice(0,-1).join(', ')+' e '+arr[arr.length-1];
  }
  /* Nomes dos votantes de um bloco, SEM repetição.
     O voto de desempate (Art. 63 §4) faz o condutor votar duas vezes: ele já
     consta do bloco pela votação ordinária e é somado de novo ao desempatar.
     O PLACAR deve contar as duas entradas (é o que faz 6x6 virar 7x6), mas a
     LISTA NOMINAL deve citar cada Deputado uma única vez. Deduplica por id
     (nome como reserva, para registros antigos sem id). */
  function nomesVotantes(arr){
    const vistos=new Set(), out=[];
    (arr||[]).forEach(v=>{
      const k=(v.id_assembleia!=null)?`#${v.id_assembleia}`:`n:${v.nome}`;
      if(vistos.has(k))return;
      vistos.add(k); out.push(v.nome);
    });
    return out.sort((a,b)=>a.localeCompare(b));
  }
  /* Frase do voto de desempate. O voto é de quem CONDUZIA a reunião naquele
     momento — não necessariamente o Presidente titular (pode haver troca de
     condução). Usa o nome gravado no ato; nunca presume o cargo. */
  function fraseDesempate(vd){
    if(!vd)return '';
    const sentido=vd.sentido==='favoravel'?'favorável':'contrário';
    const quem=vd.nome?`${formatOrador(vd.nome)}${vd.partido?` (${vd.partido})`:''}`:'o condutor dos trabalhos';
    return `, tendo ${quem}, na condução dos trabalhos, proferido voto de desempate ${sentido}`;
  }
  function parecerExt(p){
    const m={favoravel:'favorável',favoravel_com_emendas:'favorável com emendas',contrario:'contrário'};
    return m[p]||p||'favorável';
  }
  function fmtDataBR(s){
    if(!s)return '—';
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(iso)return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return s;
  }
  function siglaDoc(){
    const m=meeting?.metadados||{};
    return m.sigla||(m.comissao||'').split(' ').filter(w=>w.length>3).map(w=>w[0]).join('')||'ALRS';
  }
  function dataFile(){
    return (meeting?.metadados?.data||'').replace(/-/g,'').replace(/\//g,'');
  }
  return {numWord,dataPorExtenso,horaPorExtenso,formatOrador,formatProponente,nomeProponente,tipoPorExtenso,juntaNomes,nomesVotantes,fraseDesempate,parecerExt,fmtDataBR,siglaDoc,dataFile};
}

// Lista de presentes processada (lê do meeting consolidado)
/* ══════════════════════════════════════════════════════════════════
   reconstruirPresencas(meeting) — CENTRAL (usada por tela e documentos).
   Conta a HISTÓRIA da presença, não o resíduo final. Deriva de:
   quorum.abertura, quorum.ordem_do_dia e timeline_presencas.
   Retorna:
     abertura: [{nome,partido}]       — presentes quando a reunião abriu
     verificacaoOD: [{nome,partido}]  — presentes na verificação da OD (ou null)
     saidas: [{nome,partido,fase}]    — quem terminou AUSENTE, com a fase da saída
     visitantes: [{nome,partido}]
   ══════════════════════════════════════════════════════════════════ */
function reconstruirPresencas(meeting){
  const md=meeting?.metadados||{};
  const snap=o=>(o||[]).map(d=>({nome:d.nome,partido:d.partido||''}));
  const abertura=snap(md.quorum?.abertura?.titulares).concat(snap(md.quorum?.abertura?.suplentes));
  const odSnap=md.quorum?.ordem_do_dia;
  const verificacaoOD = odSnap ? snap(odSnap.titulares).concat(snap(odSnap.suplentes)) : null;

  // Ids já contados nas verificações regimentais (abertura + OD) — não repetir.
  const jaContado=new Set();
  [md.quorum?.abertura?.titulares, md.quorum?.abertura?.suplentes,
   odSnap?.titulares, odSnap?.suplentes].forEach(arr=>
    (arr||[]).forEach(d=>{ if(d.id_assembleia!=null)jaContado.add(d.id_assembleia); }));

  // Estado final de cada deputado pela timeline: último evento vence.
  const tl=(md.timeline_presencas||[]);
  const ultimo={};   // id -> último evento
  tl.forEach(t=>{ ultimo[t.id_assembleia]={para:t.para,contexto:t.contexto,timestamp:t.timestamp,nome:t.nome,partido:t.partido}; });
  const saidas=[];
  Object.values(ultimo).forEach(u=>{
    if(u.para==='ausente'){
      saidas.push({nome:u.nome, partido:u.partido||'', fase:_faseDeContexto(u.contexto), timestamp:u.timestamp});
    }
  });

  // Chegadas: primeira vez que cada deputado fica presente na timeline, se NÃO
  // estava na abertura nem na verificação da OD. É a "terceira lista" que o
  // resumo usava faltar — antes só a ata textual as narrava (por fase).
  const chegadas=[]; const vistoChegada=new Set();
  tl.forEach(t=>{
    if((t.para==='ativo'||t.para==='acompanhando')
       && !jaContado.has(t.id_assembleia)
       && !vistoChegada.has(t.id_assembleia)){
      vistoChegada.add(t.id_assembleia);
      chegadas.push({nome:t.nome, partido:t.partido||''});
    }
  });

  return { abertura, verificacaoOD, saidas, chegadas, visitantes:snap(md.presencas_gerais?.visitantes) };
}

/* Converte o contexto cru de um evento na FASE legível da reunião. */
function _faseDeContexto(ctx){
  if(!ctx||ctx==='Geral')return null;
  const base=String(ctx).split('—')[0].trim();
  if(!base||base==='Geral')return null;
  const map={'Abertura':'a Abertura','Expediente':'o Expediente','Ordem do Dia':'a Ordem do Dia',
    'Assuntos Gerais':'os Assuntos Gerais','Conhecimento de Matérias':'o Conhecimento de Matérias',
    'Aprovação de Atas':'a Aprovação de Atas'};
  return 'durante '+(map[base]||('a fase '+base));
}

function _listarPresentes(meeting, modo){
  const m=meeting?.membros_comissao||{};
  // Snapshot histórico (ex: quorum.abertura) — objeto {titulares,suplentes,visitantes}
  if(modo&&typeof modo==='object'){
    return {
      tits:(modo.titulares||[]).map(d=>({id:d.id_assembleia,nome:d.nome,partido:d.partido})),
      sups:(modo.suplentes||[]).map(d=>({id:d.id_assembleia,nome:d.nome,partido:d.partido})),
      outros:(modo.visitantes||[]).map(v=>({nome:v.nome,partido:v.instituicao||v.partido||''}))
    };
  }
  // União: qualquer um que tenha passado por ativo/acompanhando em algum momento da sessão
  // União: qualquer um que tenha passado por ativo/acompanhando em algum momento da sessão.
  // Lê do meeting consolidado (fonte única) — requer consolidarMeeting() prévio nos exports.
  if(modo==='uniao'){
    const mdU=meeting?.metadados||{};
    const ids=new Set();
    (mdU.timeline_presencas||[]).forEach(t=>{ if(t.para==='ativo'||t.para==='acompanhando') ids.add(t.id_assembleia); });
    return {
      tits:[...ids].filter(id=>(m.titulares||[]).includes(id)).map(id=>getDep(id)),
      sups:[...ids].filter(id=>(m.suplentes||[]).includes(id)).map(id=>getDep(id)),
      outros:(mdU.presencas_gerais?.visitantes||[]).slice()
    };
  }
  // Estado vivo legado: nenhum export usa; no contexto de documentos lê do consolidado.
  return { tits:[], sups:[], outros:[] };
}

/* ── Renderização base do DOC (parágrafos → HTML Word) ── */
function _renderDocHTML(parags){
  const escHTML=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const renderRuns=runs=>{
    if(typeof runs==='string')return escHTML(runs);
    return runs.map(r=>{
      let t=escHTML(r.text);
      if(r.bold)t=`<b>${t}</b>`;
      if(r.italic)t=`<i>${t}</i>`;
      return t;
    }).join('');
  };

  const body=parags.map(p=>{
    const align=p.align==='center'?'center':'justify';
    const styleBits=[`text-align:${align}`,'margin:0 0 10pt 0','line-height:1.5','font-family:\'Times New Roman\',Times,serif','font-size:12pt'];
    if(p.spaceBefore)styleBits.push(`margin-top:${p.spaceBefore}pt`);
    let content;
    if(p.runs){content=renderRuns(p.runs);}
    else {
      content=escHTML(p.text||'');
      if(p.bold)content=`<b>${content}</b>`;
      if(p.italic)content=`<i>${content}</i>`;
    }
    return `<p style="${styleBits.join(';')}">${content}</p>`;
  }).join('\n');

  return _docEnvelope(body);
}

/* Envelope Word compartilhado (mesmo <head> que a ata sempre usou).
   `extraCSS` acrescenta regras — usado pela planilha, que tem tabela.
   Sem extraCSS, o output é idêntico ao que _renderDocHTML gerava antes. */
function _docEnvelope(body, extraCSS){
  const css = `
@page { size: A4; margin: 2.5cm 2cm 2.5cm 3cm; }
body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.5; }
p { margin: 0 0 10pt 0; text-align: justify; }${extraCSS?'\n'+extraCSS:''}`;
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Rascunho da Ata</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
</xml>
<![endif]-->
<style>${css}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// EXPORT — PDF (via window.print, baseado no sistema de produção)
// ═══════════════════════════════════════════════════════════

/* ══════════════════════════════════════════════════════════════════
   ATA TEXTUAL — retorna {html, nome}. (era gerarAtaDOC)
   ══════════════════════════════════════════════════════════════════ */
function docAtaTextualHTML(meeting){
    const H=_expHelpers(meeting);
    const meta=meeting?.metadados||{};
    const condId=meta.condutor_id||0;
    const cond=getDep(condId);

    // ── CAMINHO ESPECIAL: ATA DECLARATÓRIA ──────────────────
    if(meta.status_sessao==='sem_quorum_abertura'){
      const pres=_listarPresentes(meeting, meeting?.metadados?.quorum?.abertura);
      // Todos os presentes exceto o condutor (incluído separadamente)
      const demais=[
        ...pres.tits.filter(d=>d.id!==condId),
        ...pres.sups.filter(d=>d.id!==condId)
      ].map(d=>`${d.nome} (${d.partido})`).sort((a,b)=>a.localeCompare(b));
      const outros=pres.outros.map(o=>o.nome+(o.partido?` (${o.partido})`:''));
      const listaDemais=[...demais,...outros];

      let txtDemais='';
      if(listaDemais.length===1) txtDemais=` e do Deputado ${listaDemais[0]}`;
      else if(listaDemais.length>1) txtDemais=` e dos Deputados ${H.juntaNomes(listaDemais)}`;

      const horaReg=meta.hora_encerramento||meta.hora_inicio_efetiva||meta.hora_inicio||'09:15';
      const textoAta=
        `Aos ${H.dataPorExtenso(meta.data)}, às ${H.horaPorExtenso(meta.hora_inicio_efetiva||meta.hora_inicio)}, horário da ${meta.tipo_reuniao?.toLowerCase()||'reunião ordinária'} da ${meta.comissao||''}, a partir da ${meta.local_efetivo||meta.local||''}, foram registradas apenas as presenças do presidente, Deputado ${cond.nome} (${cond.partido})${txtDemais}. O presidente, conforme previsto no artigo 59, parágrafo primeiro, do Regimento Interno, verificando a inexistência de quórum, declarou o encerramento da reunião e ordenou a lavratura da presente Ata Declaratória. Esta ata, após lida e aprovada, será assinada pelo Presidente da ${meta.comissao||''}, e por mim, Secretário da Comissão.`;

      const parags=[
        {align:'center',bold:true,text:'ATA DECLARATÓRIA'},
        {align:'center',bold:true,text:`${meta.tipo_reuniao||'Ordinária'} — ${H.fmtDataBR(meta.data)}`},
        {align:'center',text:meta.comissao||''},
        {text:textoAta},
        {align:'center',spaceBefore:80,text:'_________________________________________________'},
        {align:'center',bold:true,text:`Deputado ${cond.nome}`},
        {align:'center',text:'Presidente da Comissão'},
        {align:'center',spaceBefore:60,text:'_________________________________________________'},
        {align:'center',text:'Secretário da Comissão'},
      ];
      return {html:_renderDocHTML(parags), nome:`Ata_Declaratoria_${H.siglaDoc()}_${H.dataFile()}.doc`};
    }
    // ────────────────────────────────────────────────────────

    const pres=_listarPresentes(meeting, meeting?.metadados?.quorum?.abertura);

    // Listas alfabéticas, excluindo o condutor
    const titsStr=pres.tits.filter(d=>d.id!==condId).map(d=>`${d.nome} (${d.partido})`).sort((a,b)=>a.localeCompare(b));
    const supsStr=pres.sups.filter(d=>d.id!==condId).map(d=>`${d.nome} (${d.partido})`).sort((a,b)=>a.localeCompare(b));
    const visStr=pres.outros.map(o=>o.nome+(o.partido?` (${o.partido})`:'')).sort((a,b)=>a.localeCompare(b));

    let txtPres='';
    if(titsStr.length)txtPres+=H.juntaNomes(titsStr)+', membros titulares';
    if(supsStr.length)txtPres+=(txtPres?', e dos Deputados ':'')+H.juntaNomes(supsStr)+', membros suplentes';
    if(visStr.length)txtPres+=(txtPres?', além das presenças de ':'')+H.juntaNomes(visStr);
    if(txtPres)txtPres=' Registradas as presenças dos Deputados '+txtPres+'.';

    const parags=[];

    // 1. Cabeçalho
    parags.push({align:'center',bold:true,text:'ATA'});
    parags.push({align:'center',bold:true,text:`${meta.tipo_reuniao||'Ordinária'} — ${H.fmtDataBR(meta.data)}`});
    parags.push({align:'center',text:meta.comissao||''});

    // 2. Abertura
    const local=meta.local_efetivo||meta.local||'';
    const modal=meta.modalidade?` em formato ${meta.modalidade}`:'';
    parags.push({text:
      `Aos ${H.dataPorExtenso(meta.data)}, às ${H.horaPorExtenso(meta.hora_inicio_efetiva)}, na ${local}, reuniu-se ordinariamente${modal} a ${meta.comissao||''}, conduzida pelo presidente, Deputado ${cond.nome} (${cond.partido}).${txtPres}`});

    // Helper: trocas de condutor filtradas por contexto
    const tlCond=meta.timeline_conducao||[];
    const condCtx=(ctx)=>tlCond.filter(t=>t.contexto===ctx);
    const condPred=(pred)=>tlCond.filter(t=>pred(t.contexto||''));
    const condGeral=tlCond.filter(t=>!t.contexto||t.contexto==='Geral');

    // Helper: chegadas tardias — primeira vez que cada deputado fica ativo/acompanhando,
    // excluindo quem já constava no snapshot de abertura (esses já foram citados acima)
    const abertSnap=meeting?.metadados?.quorum?.abertura||{};
    const abertSnapIds=new Set([
      ...(abertSnap.titulares||[]).map(d=>d.id_assembleia),
      ...(abertSnap.suplentes||[]).map(d=>d.id_assembleia)
    ]);
    const primeirasChegadas={};
    (meta.timeline_presencas||[]).forEach(t=>{
      if((t.para==='ativo'||t.para==='acompanhando')&&!primeirasChegadas[t.id_assembleia]&&!abertSnapIds.has(t.id_assembleia)){
        primeirasChegadas[t.id_assembleia]={nome:t.nome,partido:t.partido,contexto:t.contexto};
      }
    });
    const _fraseGrupo=(lista,itens,singular,plural)=>{
      if(!lista.length)return;
      const nomes=lista.map(itens).sort((a,b)=>a.localeCompare(b));
      parags.push({text:lista.length>1
        ? `Neste momento, ${plural} ${H.juntaNomes(nomes)}.`
        : `Neste momento, ${singular} ${nomes[0]}.`});
    };
    const chegadasCtx=(ctx)=>Object.values(primeirasChegadas).filter(c=>c.contexto===ctx);
    const chegadasPred=(pred)=>Object.values(primeirasChegadas).filter(c=>pred(c.contexto||''));
    const _chegItem=c=>`${c.nome} (${c.partido})`;
    const narraChegadas=(lista)=>_fraseGrupo(lista,_chegItem,'registrou-se a presença do Deputado','registraram-se as presenças dos Deputados');

    // Helper: visitantes — adicionados uma única vez, narrados no contexto em que entraram
    const visitList=meta.presencas_gerais?.visitantes||[];
    const visCtx=(ctx)=>visitList.filter(o=>o.contexto===ctx);
    const visPred=(pred)=>visitList.filter(o=>pred(o.contexto||''));
    const _visItem=o=>o.nome+(o.partido?` (${o.partido})`:'');
    const narraVisitantes=(lista)=>_fraseGrupo(lista,_visItem,'registrou-se a presença, na qualidade de visitante, de','registraram-se as presenças, na qualidade de visitantes, de');

    const geralPred=c=>!c||c==='Geral';
    narraChegadas(chegadasPred(geralPred));
    narraVisitantes(visPred(geralPred));
    condGeral.forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));

    // 4. Atas
    const atas=(meeting?.aprovacao_atas?.atas||[]).filter(a=>a.status);
    const atasOk=atas.filter(a=>a.status==='aprovada'||a.status==='aprovada_com_ressalvas');
    if(atasOk.length){
      const soAprovadas=atasOk.filter(a=>a.status==='aprovada');
      const comRessalvas=atasOk.filter(a=>a.status==='aprovada_com_ressalvas');
      const fmtAta=a=>`nº ${a.numero}${a.reuniao_referencia?`, da reunião ordinária de ${H.fmtDataBR(a.reuniao_referencia)}`:''}`;
      if(soAprovadas.length){
        const pl=soAprovadas.length>1;
        parags.push({text:`O presidente declarou ${pl?'aprovadas as atas':'aprovada a ata'} ${H.juntaNomes(soAprovadas.map(fmtAta))}, ressalvado aos parlamentares o direito de retificá-la${pl?'s':''}, por escrito.`});
      }
      if(comRessalvas.length){
        const pl=comRessalvas.length>1;
        parags.push({text:`O presidente declarou aprovada${pl?'s':''} a${pl?'s':''} ata${pl?'s':''} ${H.juntaNomes(comRessalvas.map(fmtAta))}, ressalvado aos parlamentares o direito de retificá-la${pl?'s':''}, por escrito.`});
        comRessalvas.forEach(a=>{
          const ressalvas=a.ressalvas||[];
          if(ressalvas.length){
            const nomes=ressalvas.map(r=>r.deputado||r.nome).filter(Boolean);
            const textos=ressalvas.filter(r=>r.texto).map(r=>r.texto);
            const quem=nomes.length?`do Deputado ${H.juntaNomes(nomes)}`:'dos parlamentares';
            const complemento=textos.length?`: ${textos.join('; ')}.`:'.';
            parags.push({text:`A aprovação foi registrada com ressalva formal ${quem}${complemento}`});
          } else {
            parags.push({text:'A aprovação foi registrada com ressalvas formais.'});
          }
        });
      }
    }
    narraChegadas(chegadasCtx('Aprovação de Atas'));
    narraVisitantes(visCtx('Aprovação de Atas'));
    condCtx('Aprovação de Atas').forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));

    // 5. Expediente — Correspondências
    const corr=(meeting?.leitura_expediente?.correspondencias_recebidas||[]).filter(c=>c._lida);
    if(corr.length){
      parags.push({runs:[{text:'Do Expediente. ',bold:true},{text:'O presidente comunicou o recebimento das seguintes correspondências:'}]});
      corr.forEach(c=>{
        parags.push({text:`Correspondência de ${c.remetente}.`});
        (c.manifestacoes||[]).forEach(m=>{
          const nm=m.deputado||m.nome;
          if(!nm)return;
          const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
          if(m.texto)r.push({text:m.texto+' '});
          parags.push({runs:r});
        });
      });
    }
    const corrPred=c=>c.startsWith('Correspondência');
    narraChegadas(chegadasPred(corrPred));
    narraVisitantes(visPred(corrPred));
    condPred(corrPred).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));

    // 6. Proposições recebidas
    const propRec=(meeting?.leitura_expediente?.proposicoes_recebidas||[]).filter(p=>p._anunciada);
    if(propRec.length){
      propRec.forEach(p=>{
        const concl=p.votacao_conclusiva?' (tramitação conclusiva, com prazo de 7 dias para emendas)':'';
        parags.push({text:`Foi recebida a proposição ${H.tipoPorExtenso(p.tipo)} n.º ${p.numero}/${p.ano}, de autoria de ${H.formatProponente(p.proponente_principal)}${concl}.`});
        (p.manifestacoes||[]).forEach(m=>{
          const nm=m.deputado||m.nome; if(!nm)return;
          const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
          if(m.texto)r.push({text:m.texto+' '});
          parags.push({runs:r});
        });
      });
    }
    const propRecPred=c=>c.startsWith('Proposição —')||c==='Proposição Recebida';
    narraChegadas(chegadasPred(propRecPred));
    narraVisitantes(visPred(propRecPred));
    condPred(propRecPred).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));

    // 6b. Proposições distribuídas (comunicadas nesta sessão, relatoria designada em reunião anterior)
    const propDist=(meeting?.leitura_expediente?.proposicoes_distribuidas||[]).filter(p=>p._anunciada);
    if(propDist.length){
      propDist.forEach(p=>{
        const rel=p.relator?`, com relatoria do Deputado ${p.relator.nome} (${p.relator.partido||''})` : '';
        parags.push({text:`Foi comunicada a proposição distribuída em reunião anterior, ${H.tipoPorExtenso(p.tipo)} n.º ${p.numero}/${p.ano}, de autoria de ${H.formatProponente(p.proponente_principal)}${rel}.`});
        (p.manifestacoes||[]).forEach(m=>{
          const nm=m.deputado||m.nome; if(!nm)return;
          const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
          if(m.texto)r.push({text:m.texto+' '});
          parags.push({runs:r});
        });
      });
    }
    const propDistPred=c=>c.startsWith('Proposição Distribuída');
    narraChegadas(chegadasPred(propDistPred));
    narraVisitantes(visPred(propDistPred));
    condPred(propDistPred).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));

    // 7. Matérias distribuídas
    const md=(meeting?.leitura_expediente?.materias_a_distribuir||[]).filter(m=>m.relator||m.relator_designado);
    if(md.length){
      md.forEach(m=>{
        const rel=m.relator||m.relator_designado;
        const forma=(m.forma_escolha_relator||m.forma_designacao)==='preferencia'?'por preferência':'pela grade';
        parags.push({text:`A relatoria do ${H.tipoPorExtenso(m.tipo)} n.º ${m.numero}/${m.ano} foi distribuída ao Deputado ${rel.nome} (${rel.partido||''}), ${forma}.`});
      });
    }
    const mdPred=c=>c.startsWith('Expediente —');
    narraChegadas(chegadasPred(mdPred));
    narraVisitantes(visPred(mdPred));
    condPred(mdPred).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));

    // 8. Conhecimento de Matérias — narrado item a item (informativos, deliberativos, audiências)
    const km=meeting?.conhecimento_materias||{};
    const info=(km.informativos||[]).filter(i=>i._anunciado);
    const delib=(km.deliberativos_administrativos||[]).filter(d=>d.resultado);
    const aud=(km.audiencias_agendadas||[]).filter(a=>a._anunciada);
    const rdis=(km.requerimentos_conhecimento||[]).filter(r=>r._anunciado);
    if(info.length||delib.length||aud.length||rdis.length){
      parags.push({runs:[{text:'No Conhecimento de Matérias da Alçada da Comissão, ',bold:true},{text:'o presidente prestou os seguintes comunicados.'}]});
      narraChegadas(chegadasCtx('Conhecimento de Matérias'));
      narraVisitantes(visCtx('Conhecimento de Matérias'));
      condCtx('Conhecimento de Matérias').forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));

      rdis.forEach(r=>{
        const itemCtxRdi=`Conhecimento de Matérias — ${r.tipo||'RDI'} ${r.numero}/${r.ano}`;
        const propTxt=r.proponente?`, de ${r.proponente}`:'';
        parags.push({text:`A Comissão tomou conhecimento do ${H.tipoPorExtenso(r.tipo||'RDI')} n.º ${r.numero}/${r.ano}${propTxt}: ${r.ementa||''}`});
        (r.manifestacoes||[]).forEach(m=>{
          const nm=m.deputado||m.nome; if(!nm)return;
          const rr=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
          if(m.texto)rr.push({text:m.texto+' '});
          parags.push({runs:rr});
        });
        narraChegadas(chegadasCtx(itemCtxRdi));
        narraVisitantes(visCtx(itemCtxRdi));
        condCtx(itemCtxRdi).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
      });

      info.forEach(inf=>{
        const itemCtxInfo=`Conhecimento de Matérias — Informativo: ${(inf.texto||'').substring(0,40)}`;
        const aprov=inf._aprovado_sem_objecao?' Aprovado sem objeção dos presentes.':'';
        parags.push({text:`${inf.texto}${aprov}`});
        (inf.manifestacoes||[]).forEach(m=>{
          const nm=m.deputado||m.nome; if(!nm)return;
          const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
          if(m.texto)r.push({text:m.texto+' '});
          parags.push({runs:r});
        });
        narraChegadas(chegadasCtx(itemCtxInfo));
        narraVisitantes(visCtx(itemCtxInfo));
        condCtx(itemCtxInfo).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
      });

      delib.forEach(d=>{
        const itemCtxDelib=`Conhecimento de Matérias — Deliberativo: ${(d.texto||'').substring(0,40)}`;
        const res=d.resultado==='aprovado'?'aprovada':'rejeitada';
        parags.push({text:`Submetida a deliberação, a matéria administrativa "${d.texto}" foi ${res}.`});
        (d.manifestacoes||[]).forEach(m=>{
          const nm=m.deputado||m.nome; if(!nm)return;
          const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
          if(m.texto)r.push({text:m.texto+' '});
          parags.push({runs:r});
        });
        narraChegadas(chegadasCtx(itemCtxDelib));
        narraVisitantes(visCtx(itemCtxDelib));
        condCtx(itemCtxDelib).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
      });

      aud.forEach(a=>{
        const itemCtxAud=`Conhecimento de Matérias — Audiência ${a.data} ${a.hora}`;
        const prop=a.proponente?`, proposta pelo Deputado ${a.proponente}`:'';
        parags.push({text:`Foi anunciada a realização de audiência pública em ${H.fmtDataBR(a.data)}, às ${a.hora}${prop}, com a seguinte pauta: "${a.pauta}".`});
        (a.manifestacoes||[]).forEach(m=>{
          const nm=m.deputado||m.nome; if(!nm)return;
          const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
          if(m.texto)r.push({text:m.texto+' '});
          parags.push({runs:r});
        });
        narraChegadas(chegadasCtx(itemCtxAud));
        narraVisitantes(visCtx(itemCtxAud));
        condCtx(itemCtxAud).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
      });
    }

    // 9. Ordem do Dia
    const od=meeting?.ordem_do_dia||[];
    const quorumOD=meeting?.metadados?.quorum?.ordem_do_dia?.suficiente;
    const odExec=(meta.ordem_apreciacao_od||[]).map(i=>od[i]).filter(item=>item?.execucao?.status&&item.execucao.status!=='em_deliberacao');
    if(odExec.length||quorumOD===false){
      const odSnap=meeting?.metadados?.quorum?.ordem_do_dia||{};
      const ativosOD=[...(odSnap.titulares||[]),...(odSnap.suplentes||[])];
      const nmAtivos=ativosOD.map(d=>d.nome).sort((a,b)=>a.localeCompare(b));
      if(quorumOD===false){
        // OD não ocorreu por falta de quórum
        parags.push({text:`Constatada a presença de apenas ${ativosOD.length} membro${ativosOD.length!==1?'s':''} — ${H.juntaNomes(nmAtivos)} — insuficiente para o quórum de deliberação (mínimo ${DOC_Q_DELIB}). O presidente declarou que a Ordem do Dia não se realizaria nesta reunião, passando diretamente aos Assuntos Gerais.`});
      } else if(odExec.length){
        parags.push({text:`Com o quórum regimental, presentes os Deputados ${H.juntaNomes(nmAtivos)}, o presidente iniciou a Ordem do Dia.`});

        odExec.forEach((item,idx)=>{
        const transicao=idx===0?'Primeiro item da pauta, o ':(idx===odExec.length-1?'Último item da pauta, o ':'Próximo item da pauta, o ');
        const ex=item.execucao;

        // ── FASE B: votação conclusiva definitiva ──────────────────────
        if(item.votacao_conclusiva&&!item.relator){
          const statFB=ex.status;
          // Helper local para narrar manifestações dentro de runs[]
          const narraManifs=(lista,runs)=>{
            lista.forEach(m=>{
              const nm=m.deputado||m.nome; if(!nm)return;
              runs.push({text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true});
              if(m.texto)runs.push({text:m.texto+' '});
            });
          };
          // Particiona manifestações por sub-fase (via campo contexto gravado no obj)
          const manifs=item.manifestacoes||[];
          const manifEncPL=manifs.filter(m=>(m.contexto||'').includes('Encaminhamentos do PL'));
          const manifEncEm=(item.emendas||[]).map((_,ei)=>
            manifs.filter(m=>(m.contexto||'').includes(`Encaminhamentos — Emenda ${ei+1}`)));
          const encKnown=new Set([...manifEncPL,...manifEncEm.flat()]);
          const manifDisc=manifs.filter(m=>!encKnown.has(m));

          // Parágrafo de abertura + discussão
          const fbRuns=[
            {text:transicao},
            {text:`${H.tipoPorExtenso(item.tipo)} n.º ${item.numero}/${item.ano}`,bold:true},
            {text:`, em votação conclusiva, proponente ${H.nomeProponente(item.proponente_principal)}, com ementa "`},
            {text:item.ementa,italic:true},
            {text:'". '}
          ];
          const pars=item.pareceres_anteriores||[];
          if(pars.length){
            const parsTexto=pars.map(p=>{
              const com=(p.comissao||'').replace(/\s*\(Fase [AB]\)/i,'').trim();
              return `parecer ${H.parecerExt(p.parecer)} na ${com}, relator Deputado ${p.relator}`;
            }).join(', e ');
            fbRuns.push({text:`O projeto recebeu ${parsTexto}. `});
          }
          if(manifDisc.length){
            fbRuns.push({text:'O presidente abriu a palavra para discussão. '});
            narraManifs(manifDisc,fbRuns);
            fbRuns.push({text:'Encerrada a discussão, o presidente passou aos encaminhamentos. '});
          } else {
            fbRuns.push({text:'Sem inscritos para discussão, o presidente passou aos encaminhamentos. '});
          }
          parags.push({runs:fbRuns});

          // Emendas — com encaminhamentos separados se houver
          (item.emendas||[]).forEach((em,ei)=>{
            const nFem=(em.votos_favoraveis||[]).length, nCem=(em.votos_contrarios||[]).length;
            const favsEm=(em.votos_favoraveis||[]).map(v=>v.nome).sort((a,b)=>a.localeCompare(b));
            const consEm=(em.votos_contrarios||[]).map(v=>v.nome).sort((a,b)=>a.localeCompare(b));
            const res=em.resultado==='aprovada'?'aprovada':'rejeitada';
            let voto=`Emenda n.º ${ei+1}${em.descricao?` — ${em.descricao}`:''}: ${res} com ${nFem} voto${nFem!==1?'s':''} favoráve${nFem!==1?'is':'l'}`;
            if(nFem>0)voto+=`, dos Deputados ${H.juntaNomes(favsEm)}`;
            voto+=nCem>0?`, e ${nCem} voto${nCem!==1?'s':''} contrário${nCem!==1?'s':''}, dos Deputados ${H.juntaNomes(consEm)}`:', e nenhum voto contrário';
            voto+='.';
            const encEm=manifEncEm[ei]||[];
            if(encEm.length){
              const emRuns=[{text:`Em encaminhamentos da Emenda n.º ${ei+1}. `}];
              narraManifs(encEm,emRuns);
              emRuns.push({text:voto});
              parags.push({runs:emRuns});
            } else {
              parags.push({text:voto});
            }
          });

          // PL — com encaminhamentos separados se houver
          const favsPL=(ex.votos_favoraveis||[]).map(v=>v.nome).sort((a,b)=>a.localeCompare(b));
          const consPL=(ex.votos_contrarios||[]).map(v=>v.nome).sort((a,b)=>a.localeCompare(b));
          const nFPL=favsPL.length, nCPL=consPL.length;
          const plRuns=manifEncPL.length?[{text:'Em encaminhamentos do Projeto de Lei. '}]:null;
          if(plRuns)narraManifs(manifEncPL,plRuns);
          if(statFB==='aprovado'){
            let t=`Colocado em votação o ${H.tipoPorExtenso(item.tipo)}, foi aprovado com ${nFPL} voto${nFPL!==1?'s':''} favoráve${nFPL!==1?'is':'l'}`;
            if(nFPL>0)t+=`, dos Deputados ${H.juntaNomes(favsPL)}`;
            t+=nCPL>0?`, e ${nCPL} voto${nCPL!==1?'s':''} contrário${nCPL!==1?'s':''}, dos Deputados ${H.juntaNomes(consPL)}`:', e nenhum voto contrário';
            t+='.';
            if(plRuns){plRuns.push({text:t});parags.push({runs:plRuns});}else parags.push({text:t});
            if(ex.redacao_final_aprovada)parags.push({text:'Com a anuência dos presentes, foi aprovada a redação final do projeto.'});
          } else if(statFB==='rejeitado'){
            let t=`Colocado em votação o ${H.tipoPorExtenso(item.tipo)}, foi rejeitado com ${nFPL} voto${nFPL!==1?'s':''} favoráve${nFPL!==1?'is':'l'}`;
            if(nFPL>0)t+=`, dos Deputados ${H.juntaNomes(favsPL)}`;
            t+=nCPL>0?`, e ${nCPL} voto${nCPL!==1?'s':''} contrário${nCPL!==1?'s':''}, dos Deputados ${H.juntaNomes(consPL)}`:', e nenhum voto contrário';
            t+='. Conforme o § 4.º do art. 72-A do Regimento Interno, da deliberação cabe recurso, desde que assinado por um décimo dos membros da Assembleia e apresentado até 5 dias úteis após a decisão conclusiva da comissão.';
            if(plRuns){plRuns.push({text:t});parags.push({runs:plRuns});}else parags.push({text:t});
          } else if(statFB==='retirada_de_pauta'){
            parags.push({text:'A matéria foi retirada de pauta.'});
          } else if(statFB==='falta_quorum'){
            parags.push({text:'A matéria não foi apreciada por falta de quórum regimental.'});
          }
          // Condutor / chegadas / visitantes
          const itemCtxFB=`Ordem do Dia — ${item.tipo} ${item.numero}/${item.ano}`;
          narraChegadas(chegadasPred(c=>c.startsWith(itemCtxFB)));
          narraVisitantes(visPred(c=>c.startsWith(itemCtxFB)));
          condPred(c=>c.startsWith(itemCtxFB)).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
          return; // pula o restante do forEach para este item
        }
        // ───────────────────────────────────────────────────────────────

        const runs=[
          {text:transicao},
          {text:`${H.tipoPorExtenso(item.tipo)} n.º ${item.numero}/${item.ano}`,bold:true},
          {text:`, proponente ${H.nomeProponente(item.proponente_principal)}, com ementa "`},
          {text:item.ementa,italic:true},
          {text:'". '}
        ];

        // RELSUB: contexto adicional de origem da subcomissão, se informado
        if(item.tipo==='RELSUB'){
          if(item.data_aprovacao_subcomissao){
            runs.push({text:`A instalação desta Subcomissão foi aprovada em ${H.fmtDataBR(item.data_aprovacao_subcomissao)}${item.req_criacao?`, através do ${item.req_criacao}`:''}. `});
          }
          const integr=(item.demais_integrantes||[]).map(m=>m.nome||m);
          if(integr.length){
            runs.push({text:`Além do relator, integram a subcomissão: ${H.juntaNomes(integr)}. `});
          }
        }

        const isReq=['REQ','RAP','REQSUB'].includes(item.tipo)||!item.relator;
        const stat=ex.status;

        if(stat==='retirada_de_pauta'){
          runs.push({text:'A matéria foi retirada de pauta por solicitação do proponente.'});
        } else if(stat==='relator_ausente'){
          runs.push({text:`Ausente o relator, Deputado ${item.relator?.nome||''}, a apreciação da matéria foi postergada para próxima reunião.`});
        } else if(stat==='reexame'){
          runs.push({text:`Com a palavra, o Deputado ${item.relator?.nome||''}, relator, solicitou o reexame da matéria.`});
        } else if(stat==='falta_quorum'){
          runs.push({text:'A matéria não foi apreciada por falta de quórum regimental.'});
        } else {
          // Fluxo normal de deliberação
          // Particiona manifestações por sub-fase
          const manifOD=item.manifestacoes||[];
          const manifEncOD=manifOD.filter(m=>(m.contexto||'').includes(' — Encaminhamentos'));
          const encODSet=new Set(manifEncOD);
          const manifDiscOD=manifOD.filter(m=>!encODSet.has(m));

          if(isReq){
            runs.push({text:'O presidente anunciou a matéria e abriu a palavra para discussão. '});
          } else if(item.relatorio_lido_em){
            runs.push({text:`O relatório, com parecer ${H.parecerExt(item.parecer)} do relator, Deputado ${item.relator?.nome||''}, foi lido em reunião anterior. O presidente abriu a palavra para discussão. `});
          } else {
            runs.push({text:`O presidente passou a palavra para o relator, Deputado ${item.relator?.nome||''}, para leitura do relatório, com parecer ${H.parecerExt(item.parecer)}. Lido o relatório, o presidente abriu a palavra para discussão. `});
          }
          // Falas da discussão
          manifDiscOD.forEach(m=>{
            const nm=m.deputado||m.nome; if(!nm)return;
            runs.push({text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true});
            if(m.texto)runs.push({text:m.texto+' '});
          });
          // Encaminhamentos (se houver)
          if(manifEncOD.length){
            runs.push({text:'Encerrada a discussão, o presidente abriu a palavra para encaminhamentos. '});
            manifEncOD.forEach(m=>{
              const nm=m.deputado||m.nome; if(!nm)return;
              runs.push({text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true});
              if(m.texto)runs.push({text:m.texto+' '});
            });
          }

          if(stat==='vista'){
            const av=ex.autor_vista;
            if(av)runs.push({text:`Com a palavra, o Deputado ${av.nome} (${av.partido}) solicitou vista do processo.`,bold:true});
            else runs.push({text:'Foi concedida vista do processo a um dos parlamentares.',bold:true});
          } else {
            /* Contagem (placar) usa o array cru — o desempate soma um voto.
               Lista nominal usa nomesVotantes() — cada Deputado citado uma vez. */
            const nFav=(ex.votos_favoraveis||[]).length;
            const nCon=(ex.votos_contrarios||[]).length;
            const favs=H.nomesVotantes(ex.votos_favoraveis);
            const cons=H.nomesVotantes(ex.votos_contrarios);
            const minerva=H.fraseDesempate(ex.voto_desempate);

            if(stat==='aprovado'||stat==='aprovado_parecer_conclusivo'){
              runs.push({text:`Sem outras manifestações, o presidente colocou em votação a matéria, a qual foi aprovada com ${nFav} voto${nFav!==1?'s':''} favoráve${nFav!==1?'is':'l'}, do${nFav!==1?'s':''} Deputado${nFav!==1?'s':''} ${H.juntaNomes(favs)||'—'}${nCon?`, e ${nCon} voto${nCon!==1?'s':''} contrário${nCon!==1?'s':''} do${nCon!==1?'s':''} Deputado${nCon!==1?'s':''} ${H.juntaNomes(cons)}`:', e nenhum voto contrário'}${minerva}.`});
              if(item.eleicao&&ex.eleito)runs.push({text:` Foi eleito ${item.cargo_eleicao||'para o cargo'} o ${H.formatOrador(ex.eleito.nome)} (${ex.eleito.partido}).`});
              if(item.tipo==='REQSUB'&&item.membros?.length)runs.push({text:` Foram designados membros da subcomissão: ${H.juntaNomes(item.membros.map(m=>m.nome))}.`});
              if(stat==='aprovado_parecer_conclusivo'){
                runs.push({text:' Determinou o presidente, com a aprovação deste parecer, que o referido projeto seja publicado em Ordem do Dia nesta Comissão para apreciação conclusiva na próxima reunião, conforme dispõe o § 2.º do art. 72-A do Regimento Interno.'});
              }
            } else if(stat==='rejeitado'){
              runs.push({text:`Sem outras manifestações, o presidente colocou em votação a matéria, a qual foi rejeitada com ${nCon} voto${nCon!==1?'s':''} contrário${nCon!==1?'s':''} do${nCon!==1?'s':''} Deputado${nCon!==1?'s':''} ${H.juntaNomes(cons)||'—'}${nFav?`, e ${nFav} voto${nFav!==1?'s':''} favoráve${nFav!==1?'is':'l'} do${nFav!==1?'s':''} Deputado${nFav!==1?'s':''} ${H.juntaNomes(favs)}`:', e nenhum voto favorável'}${minerva}.`});
              const nr=ex.redistribuicao?.novo_relator;
              if(nr){
                const forma=ex.redistribuicao.forma_escolha==='preferencia'?'por preferência':'pela grade';
                runs.push({text:` A relatoria foi redistribuída ao Deputado ${nr.nome} (${nr.partido||''}), ${forma}.`});
              }
            } else if(stat==='inconclusivo'){
              let t=`Colocada em votação, a matéria não obteve deliberação conclusiva nesta sessão, com ${nFav} voto${nFav!==1?'s':''} favoráve${nFav!==1?'is':'l'}`;
              if(nFav)t+=`, do${nFav!==1?'s':''} Deputado${nFav!==1?'s':''} ${H.juntaNomes(favs)}`;
              t+=nCon?`, e ${nCon} voto${nCon!==1?'s':''} contrário${nCon!==1?'s':''}, do${nCon!==1?'s':''} Deputado${nCon!==1?'s':''} ${H.juntaNomes(cons)}`:', e nenhum voto contrário';
              t+=`${minerva}.`;
              runs.push({text:t});
              const nr=ex.redistribuicao?.novo_relator;
              if(nr){
                const forma=ex.redistribuicao.forma_escolha==='preferencia'?'por preferência':'pela grade';
                runs.push({text:` A relatoria foi redistribuída ao Deputado ${nr.nome} (${nr.partido||''}), ${forma}.`});
              }
            }
          }
        }
        parags.push({runs});
        // Trocas de condutor durante este item
        const itemCtx=`Ordem do Dia — ${item.tipo} ${item.numero}/${item.ano}`;
        narraChegadas(chegadasPred(c=>c.startsWith(itemCtx)));
        narraVisitantes(visPred(c=>c.startsWith(itemCtx)));
        condPred(c=>c.startsWith(itemCtx)).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
        });
      } // fecha else if odExec.length
    } // fecha if odExec||quorumOD===false

    // 10. Assuntos Gerais
    narraChegadas(chegadasCtx('Assuntos Gerais'));
    narraVisitantes(visCtx('Assuntos Gerais'));
    condCtx('Assuntos Gerais').forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
    // Transição aos Assuntos Gerais. Quando a OD não ocorreu por falta de
    // quórum, a passagem já foi narrada na seção da OD ("...passando diretamente
    // aos Assuntos Gerais") — não repetir aqui. Só emitimos a transição quando a
    // OD efetivamente aconteceu (com itens) ou quando não havia pauta alguma.
    if(quorumOD!==false){
      const textoTransicaoAG=od.length
        ?'Não havendo mais matérias na Ordem do Dia, o presidente passou aos Assuntos Gerais.'
        :'Não havendo matérias na Ordem do Dia, o presidente passou diretamente aos Assuntos Gerais.';
      parags.push({text:textoTransicaoAG});
    }
    const ag=meeting?.assuntos_gerais||{};
    const itensAG=(ag.itens||[]).filter(it=>it._anunciado);
    itensAG.forEach((it,idx)=>{
      const itemCtxAG=`Assuntos Gerais — ${(it.assunto||'').substring(0,40)}`;
      parags.push({text:it.assunto});
      (it.manifestacoes||[]).forEach(m=>{
        const nm=m.deputado||m.nome; if(!nm)return;
        const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
        if(m.texto)r.push({text:m.texto+' '});
        parags.push({runs:r});
      });
      narraChegadas(chegadasCtx(itemCtxAG));
      narraVisitantes(visCtx(itemCtxAG));
      condCtx(itemCtxAG).forEach(t=>parags.push({text:`Neste momento, assumiu a condução dos trabalhos o Deputado ${t.nome} (${t.partido}).`}));
    });
    // Manifestações gerais remanescentes (contexto livre, não atribuído a item específico)
    (ag.manifestacoes_gerais||[]).forEach(m=>{
      const nm=m.deputado||m.nome; if(!nm)return;
      const r=[{text:`Com a palavra, ${H.formatOrador(nm)}. `,bold:true}];
      if(m.texto)r.push({text:m.texto+' '});
      parags.push({runs:r});
    });
    // Encerramento — sempre por último, após todas as manifestações
    const proxReunDOC=meeting?.assuntos_gerais?.proxima_reuniao;
    const proxTexto=proxReunDOC?`, a realizar-se em ${H.dataPorExtenso(proxReunDOC)},`:'';
    parags.push({text:`Não havendo mais nada a tratar, o presidente convocou os parlamentares para a próxima reunião ordinária da Comissão${proxTexto} e encerrou os trabalhos às ${H.horaPorExtenso(meta.hora_encerramento)}. O inteiro teor foi gravado, passando o arquivo de mídia a integrar o acervo documental desta reunião. E, para constar, eu lavrei a presente ata que, após lida e aprovada, será assinada pelo Presidente da Comissão, e por mim, Secretário da Comissão.`});

    // 11. Assinaturas
    parags.push({align:'center',spaceBefore:60,text:'_________________________________________________'});
    parags.push({align:'center',bold:true,text:`Deputado ${cond.nome}`});
    parags.push({align:'center',text:'Presidente da Comissão'});
    parags.push({align:'center',spaceBefore:60,text:'_________________________________________________'});
    parags.push({align:'center',text:'Secretário da Comissão'});

    // Renderizar HTML
    return {html:_renderDocHTML(parags), nome:`Rascunho_Ata_${H.siglaDoc()}_${H.dataFile()}.doc`};
}


/* ══════════════════════════════════════════════════════════════════
   RESUMO — retorna HTML. (era printPDF)
   ══════════════════════════════════════════════════════════════════ */
function docResumoHTML(meeting){
    const H=_expHelpers(meeting);
    const meta=meeting?.metadados||{};
    const condId=meta.condutor_id||0;
    const cond=getDep(condId);
    const pres=_listarPresentes(meeting, 'uniao');
    let secN=1;

    let html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Resumo — ${H.fmtDataBR(meta.data)}</title>
<style>
@page{size:A4;margin:1.5cm 2cm}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#000;max-width:18cm;margin:0 auto;line-height:1.4}
h1{font-size:14pt;text-align:center;border-bottom:2px solid #000;padding-bottom:6px;margin:0 0 10pt 0;text-transform:uppercase}
h2{font-size:12pt;text-transform:uppercase;border-bottom:1px solid #666;padding-bottom:3px;margin:14pt 0 6pt 0}
h3{font-size:10pt;text-transform:uppercase;color:#444;margin:8pt 0 4pt 0}
p{margin:4pt 0;text-align:justify}
ul{margin:4pt 0 4pt 18pt;padding:0}
li{margin-bottom:6pt;text-align:justify}
.muted{color:#666;font-size:10pt}
.it{font-style:italic;color:#555}
.lbl{font-weight:bold}
.ok{color:#15803d;font-weight:bold}
.bad{color:#b91c1c;font-weight:bold}
.warn{color:#a16207;font-weight:bold}
.subt{font-size:10pt;color:#555;margin-top:-4pt}
.cab-info{text-align:center;font-size:10pt;margin:4pt 0}
.bordered-item{border-left:2px solid #94a3b8;padding-left:8pt;margin-bottom:8pt}
@media print{body{margin:0}}
</style></head><body>`;

    // Cabeçalho
    html+=`<h1>${meta.comissao||''}</h1>`;
    html+=`<p class="cab-info"><span class="lbl">Ata Resumida</span> — ${meta.tipo_reuniao||'Ordinária'} — ${H.fmtDataBR(meta.data)}</p>`;
    html+=`<p class="cab-info">Horário: ${meta.hora_inicio_efetiva||'—'} às ${meta.hora_encerramento||'—'} · Local: ${meta.local_efetivo||meta.local||'—'}</p>`;
    if(cond.nome)html+=`<p class="cab-info"><span class="lbl">Presidência dos Trabalhos:</span> Dep. ${cond.nome} (${cond.partido}).</p>`;

    // 1. Presenças — conta a história (abertura, verificação OD, saídas), não o resíduo
    html+=`<h2>${secN++}. Presenças Registradas na Reunião</h2>`;
    const PR=reconstruirPresencas(meeting);
    const fmtP=arr=>arr.map(d=>`${d.nome}${d.partido?` (${d.partido})`:''}`).sort((a,b)=>a.localeCompare(b)).join(', ');
    if(PR.abertura.length)
      html+=`<p><span class="lbl">Presentes à abertura:</span> ${fmtP(PR.abertura)}.</p>`;
    if(PR.verificacaoOD && PR.verificacaoOD.length)
      html+=`<p><span class="lbl">Na verificação da Ordem do Dia:</span> ${fmtP(PR.verificacaoOD)}.</p>`;
    // Chegadas: quem se registrou depois, fora das duas verificações regimentais.
    // (Saídas ficam só na ata textual — decisão de projeto: o resumo mostra quem
    //  participou, para os assessores; o "saiu quando" é registro da ata.)
    if(PR.chegadas.length)
      html+=`<p><span class="lbl">Chegaram durante a sessão:</span> ${fmtP(PR.chegadas)}.</p>`;
    if(PR.visitantes.length)
      html+=`<p><span class="lbl">Outros / Visitantes:</span> ${fmtP(PR.visitantes)}.</p>`;

    // Trocas de condução — pela FASE da reunião (não o horário cru)
    if((meta.timeline_conducao||[]).length){
      html+=`<p class="muted">Trocas de condução: `;
      html+=meta.timeline_conducao.map(t=>{
        const fase=_faseDeContexto(t.contexto);
        return `${fase?fase+' → ':''}${t.nome} (${t.partido})`;
      }).join('; ');
      html+=`.</p>`;
    }

    // 2. Atas
    const atas=meeting?.aprovacao_atas?.atas||[];
    html+=`<h2>${secN++}. Aprovação de Atas</h2>`;
    if(atas.length){
      html+=`<ul>`;
      atas.forEach(a=>{
        const stMap={aprovada:'<span class="ok">Aprovada</span>',aprovada_com_ressalvas:'<span class="ok">Aprovada com ressalvas</span>',
          rejeitada:'<span class="bad">Rejeitada</span>',nao_apreciada:'<span class="warn">Não apreciada</span>',
          retirada:'<span class="warn">Retirada</span>'};
        html+=`<li><span class="lbl">Ata nº ${a.numero}</span> (${a.tipo_reuniao||''}${a.reuniao_referencia?' · '+docFmtData(a.reuniao_referencia):''}): ${stMap[a.status]||'<span class="muted it">Aguardando</span>'}</li>`;
      });
      html+=`</ul>`;
    } else {
      html+=`<p class="muted it">Não houve atas em apreciação.</p>`;
    }

    // 3. Expediente
    const le=meeting?.leitura_expediente||{};
    const corr=(le.correspondencias_recebidas||[]).filter(c=>c._lida);
    const propRec=(le.proposicoes_recebidas||[]).filter(p=>p._anunciada);
    const propDistPdf=(le.proposicoes_distribuidas||[]).filter(p=>p._anunciada);
    const md=(le.materias_a_distribuir||[]);
    html+=`<h2>${secN++}. Expediente</h2>`;
    if(corr.length||propRec.length||propDistPdf.length||md.length){
      if(corr.length){
        html+=`<h3>Correspondências Recebidas</h3><ul>`;
        corr.forEach(c=>{
          html+=`<li><span class="lbl">${c.remetente}:</span> ${c.mensagem}`;
          const manif=c.manifestacoes||[];
          if(manif.length){
            const nomes=[...new Set(manif.map(m=>m.deputado||m.nome).filter(Boolean))];
            html+=`<br><span class="subt"><span class="lbl">Manifestações:</span> ${nomes.join(', ')}.</span>`;
          }
          html+=`</li>`;
        });
        html+=`</ul>`;
      }
      if(propRec.length){
        html+=`<h3>Proposições Recebidas</h3><ul>`;
        propRec.forEach(p=>{
          const concl=p.votacao_conclusiva?' <span class="muted">(tramitação conclusiva)</span>':'';
          html+=`<li><span class="lbl">${p.tipo} ${p.numero}/${p.ano}</span>${concl} · ${p.proponente_principal?.nome||'—'}: ${p.ementa}`;
          const manif=p.manifestacoes||[];
          if(manif.length){
            const nomes=[...new Set(manif.map(m=>m.deputado||m.nome).filter(Boolean))];
            html+=`<br><span class="subt"><span class="lbl">Manifestações:</span> ${nomes.join(', ')}.</span>`;
          }
          html+=`</li>`;
        });
        html+=`</ul>`;
      }
      if(propDistPdf.length){
        html+=`<h3>Proposições Distribuídas (em reunião anterior)</h3><ul>`;
        propDistPdf.forEach(p=>{
          const rel=p.relator?` · Rel: ${p.relator.nome} (${p.relator.partido||''})` : '';
          html+=`<li><span class="lbl">${p.tipo} ${p.numero}/${p.ano}</span> · ${p.proponente_principal?.nome||'—'}${rel}`;
          const manif=p.manifestacoes||[];
          if(manif.length){
            const nomes=[...new Set(manif.map(m=>m.deputado||m.nome).filter(Boolean))];
            html+=`<br><span class="subt"><span class="lbl">Manifestações:</span> ${nomes.join(', ')}.</span>`;
          }
          html+=`</li>`;
        });
        html+=`</ul>`;
      }
      const mdFeitas=md.filter(m=>m.relator||m.relator_designado);
      if(mdFeitas.length){
        html+=`<h3>Matérias a Distribuir</h3><ul>`;
        mdFeitas.forEach(m=>{
          const rel=m.relator||m.relator_designado;
          const forma=(m.forma_escolha_relator||m.forma_designacao)==='preferencia'?'por preferência':'pela grade';
          html+=`<li><span class="lbl">${m.tipo} ${m.numero}/${m.ano}:</span> Relatoria distribuída ao Dep. ${rel.nome} (${rel.partido||''}), ${forma}.</li>`;
        });
        html+=`</ul>`;
      }
      const mdPend=md.filter(m=>!m.relator&&!m.relator_designado);
      if(mdPend.length){
        html+=`<h3>Matérias a Distribuir (não distribuídas)</h3><ul>`;
        mdPend.forEach(m=>{html+=`<li class="muted it">${m.tipo} ${m.numero}/${m.ano}: sem relator designado.</li>`;});
        html+=`</ul>`;
      }
    } else {
      html+=`<p class="muted it">Não houve matérias em expediente.</p>`;
    }

    // 4. Conhecimento de Matérias
    const km=meeting?.conhecimento_materias||{};
    const info=(km.informativos||[]).filter(i=>i._anunciado);
    const delib=(km.deliberativos_administrativos||[]);
    const aud=(km.audiencias_agendadas||[]).filter(a=>a._anunciada);
    const rdis=(km.requerimentos_conhecimento||[]).filter(r=>r._anunciado);
    const _manifLi=(manif)=>{
      if(!manif||!manif.length)return '';
      const nomes=[...new Set(manif.map(m=>m.deputado||m.nome).filter(Boolean))];
      return nomes.length?`<br><span class="subt"><span class="lbl">Manifestações:</span> ${nomes.join(', ')}.</span>`:'';
    };
    html+=`<h2>${secN++}. Conhecimento de Matérias</h2>`;
    if(info.length||delib.length||aud.length||rdis.length){
      if(info.length){
        html+=`<h3>Informativos</h3><ul>`;
        info.forEach(i=>{
          const aprov=i._aprovado_sem_objecao?' <span class="ok">— Aprovado sem objeção</span>':'';
          html+=`<li>${i.texto}${aprov}${_manifLi(i.manifestacoes)}</li>`;
        });
        html+=`</ul>`;
      }
      if(rdis.length){
        html+=`<h3>Requerimentos para Conhecimento</h3><ul>`;
        rdis.forEach(r=>{
          const prop=r.proponente?` (${r.proponente})`:'';
          html+=`<li><span class="lbl">${r.tipo||'RDI'} ${r.numero}/${r.ano}</span>${prop}: ${r.ementa||''}${_manifLi(r.manifestacoes)}</li>`;
        });
        html+=`</ul>`;
      }
      if(delib.length){
        html+=`<h3>Deliberativos Administrativos</h3><ul>`;
        delib.forEach(d=>{
          const res=d.resultado?(d.resultado==='aprovado'?'<span class="ok">Aprovado</span>':'<span class="bad">Rejeitado</span>'):'<span class="muted it">Não deliberado</span>';
          html+=`<li>${d.texto} — ${res}${_manifLi(d.manifestacoes)}</li>`;
        });
        html+=`</ul>`;
      }
      if(aud.length){
        html+=`<h3>Audiências Agendadas</h3><ul>`;
        aud.forEach(a=>{html+=`<li>Audiência pública em ${H.fmtDataBR(a.data)} às ${a.hora} — ${a.pauta}${_manifLi(a.manifestacoes)}</li>`;});
        html+=`</ul>`;
      }
    } else {
      html+=`<p class="muted it">Não houve matérias para conhecimento.</p>`;
    }

    // 5. Ordem do Dia
    const od=meeting?.ordem_do_dia||[];
    const quorumODPdf=meeting?.metadados?.quorum?.ordem_do_dia?.suficiente;
    const odExec=(meta.ordem_apreciacao_od||[]).map(i=>od[i]).filter(item=>item?.execucao?.status);

    if(meta.status_sessao==='sem_quorum_abertura'){
      html+=`<h2>${secN++}. Ordem do Dia</h2>`;
      html+=`<p class="muted it">A reunião não se realizou por falta de quórum de abertura; não houve Ordem do Dia.</p>`;
    } else if(quorumODPdf===false){
      // OD não ocorreu — quórum insuficiente
      const atOD=(meeting?.metadados?.quorum?.ordem_do_dia?.titulares||[]).map(d=>d.nome);
      const supOD=(meeting?.metadados?.quorum?.ordem_do_dia?.suplentes||[]).map(d=>d.nome);
      const presOD=[...atOD,...supOD].sort((a,b)=>a.localeCompare(b));
      html+=`<h2>${secN++}. Ordem do Dia</h2>`;
      html+=`<p class="it warn">Não houve quórum regimental para a Ordem do Dia. Presentes: ${presOD.join(', ')||'—'}. A sessão avançou diretamente para os Assuntos Gerais.</p>`;
    } else if(odExec.length){
      html+=`<h2>${secN++}. Ordem do Dia</h2><ul>`;
      odExec.forEach(item=>{
        const ex=item.execucao;
        const stat=ex.status;
        /* Placar conta o array cru (o desempate soma um voto); a lista nominal
           cita cada Deputado uma vez. Ver nomesVotantes/fraseDesempate. */
        const nFav=(ex.votos_favoraveis||[]).length;
        const nCon=(ex.votos_contrarios||[]).length;
        const favs=H.nomesVotantes(ex.votos_favoraveis);
        const cons=H.nomesVotantes(ex.votos_contrarios);
        const vd=ex.voto_desempate;
        const minerva=vd?` <span class="muted">(voto de desempate ${vd.sentido==='favoravel'?'favorável':'contrário'}${vd.nome?` — ${vd.nome}`:''}, na condução dos trabalhos)</span>`:'';

        html+=`<li class="bordered-item"><span class="lbl">${item.tipo} ${item.numero}/${item.ano}</span>: `;
        // ── FASE B ──────────────────────────────────────────────────────
        if(item.votacao_conclusiva&&!item.relator){
          html+=`<span class="badge badge-blue" style="font-size:10px;vertical-align:middle">Votação conclusiva</span> `;
          const pars=item.pareceres_anteriores||[];
          if(pars.length){
            html+=`<br><span class="subt">Pareceres: ${pars.map(p=>{const com=(p.comissao||'').replace(/\s*\(Fase [AB]\)/i,'').trim();return`${com}: ${H.parecerExt(p.parecer)} (rel. ${p.relator})`;}).join(' · ')}</span>`;
          }
          (item.emendas||[]).forEach((em,ei)=>{
            const nFem=(em.votos_favoraveis||[]).length, nCem=(em.votos_contrarios||[]).length;
            const resEm=em.resultado==='aprovada'?'<span class="ok">Aprovada</span>':'<span class="bad">Rejeitada</span>';
            html+=`<br><span class="subt">Emenda ${ei+1}: ${resEm} (${nFem}×${nCem})`;
            if((em.votos_favoraveis||[]).length)html+=` — Fav: ${(em.votos_favoraveis||[]).map(v=>v.nome).join(', ')}`;
            if((em.votos_contrarios||[]).length)html+=` — Cont: ${(em.votos_contrarios||[]).map(v=>v.nome).join(', ')}`;
            html+=`</span>`;
          });
          if(stat==='aprovado'){
            html+=`<br><span class="ok">Projeto: Aprovado (${nFav}×${nCon})</span>`;
            if(ex.redacao_final_aprovada)html+=` — Redação final aprovada`;
          } else if(stat==='rejeitado'){
            html+=`<br><span class="bad">Projeto: Rejeitado (${nFav}×${nCon})</span> — cabe recurso (Art. 72-A §4º)`;
          } else if(stat==='retirada_de_pauta'){html+=`<br><span class="warn">Retirada de pauta.</span>`;}
          else if(stat==='falta_quorum'){html+=`<br><span class="bad">Falta de quórum.</span>`;}
          if(favs.length||cons.length){
            html+=`<br><span class="subt"><span class="lbl">Favoráveis (PL):</span> ${favs.length?favs.join(', '):'Nenhum'}.`;
            html+=` <span class="lbl">Contrários (PL):</span> ${cons.length?cons.join(', '):'Nenhum'}.</span>`;
          }
          const manifItem=item.manifestacoes||[];
          if(manifItem.length){
            const nomes=[...new Set(manifItem.map(m=>m.deputado||m.nome).filter(Boolean))];
            html+=`<br><span class="subt"><span class="lbl">Manifestações:</span> ${nomes.join(', ')}.</span>`;
          }
          html+=`<br><span class="subt it">Ementa: ${item.ementa}</span></li>`;
          return; // early return dentro do forEach do PDF
        }
        // ────────────────────────────────────────────────────────────────
        if(stat==='aprovado'){
          html+=`<span class="ok">Aprovado (${nFav}×${nCon})</span>${minerva}.`;
          if(item.eleicao&&ex.eleito)html+=` <strong>Eleito ${item.cargo_eleicao||''}:</strong> ${ex.eleito.nome} (${ex.eleito.partido}).`;
          if(item.tipo==='REQSUB'&&item.membros?.length)html+=` Membros designados: ${item.membros.map(m=>m.nome).join(', ')}.`;
        }
        else if(stat==='aprovado_parecer_conclusivo'){html+=`<span class="ok">Parecer aprovado (${nFav}×${nCon})${minerva}</span> — retorna para votação conclusiva.`;}
        else if(stat==='rejeitado'){
          html+=`<span class="bad">Rejeitado (${nFav}×${nCon})</span>${minerva}.`;
          if(ex.redistribuicao?.novo_relator){
            const nr=ex.redistribuicao.novo_relator;
            const f=ex.redistribuicao.forma_escolha==='preferencia'?'por preferência':'pela grade';
            html+=` Relatoria redistribuída ao Dep. ${nr.nome} (${nr.partido||''}), ${f}.`;
          }
        }
        else if(stat==='inconclusivo'){
          html+=`<span class="warn">Inconclusivo (${nFav}×${nCon})</span>${minerva}.`;
          if(ex.redistribuicao?.novo_relator){
            const nr=ex.redistribuicao.novo_relator;
            const f=ex.redistribuicao.forma_escolha==='preferencia'?'por preferência':'pela grade';
            html+=` Relatoria redistribuída ao Dep. ${nr.nome} (${nr.partido||''}), ${f}.`;
          }
        }
        else if(stat==='vista'){
          html+=`<span class="warn">Vista concedida</span>`;
          if(ex.autor_vista)html+=` ao Dep. ${ex.autor_vista.nome} (${ex.autor_vista.partido})`;
          html+=`.`;
        }
        else if(stat==='reexame'){html+=`<span class="warn">Reexame solicitado pelo relator${item.relator?` (Dep. ${item.relator.nome})`:''}.</span>`;}
        else if(stat==='relator_ausente'){html+=`<span class="warn">Relator ausente${item.relator?` (Dep. ${item.relator.nome})`:''} — apreciação postergada.</span>`;}
        else if(stat==='retirada_de_pauta'){html+=`<span class="warn">Retirada de pauta.</span>`;}
        else if(stat==='falta_quorum'){html+=`<span class="bad">Falta de quórum — não apreciado.</span>`;}
        else {html+=`<span class="muted it">Não deliberado.</span>`;}

        if(favs.length||cons.length){
          html+=`<br><span class="subt"><span class="lbl">Favoráveis:</span> ${favs.length?favs.join(', '):'Nenhum'}.`;
          html+=` <span class="lbl">Contrários:</span> ${cons.length?cons.join(', '):'Nenhum'}.</span>`;
        }
        const manifItem=item.manifestacoes||[];
        if(manifItem.length){
          const nomes=[...new Set(manifItem.map(m=>m.deputado||m.nome).filter(Boolean))];
          html+=`<br><span class="subt"><span class="lbl">Manifestações:</span> ${nomes.join(', ')}.</span>`;
        }
        html+=`<br><span class="subt it">Ementa: ${item.ementa}</span></li>`;
      });
      html+=`</ul>`;
    } else {
      html+=`<h2>${secN++}. Ordem do Dia</h2>`;
      html+=`<p class="muted it">Não houve matérias apreciadas na Ordem do Dia.</p>`;
    }

    // 6. Assuntos Gerais
    const ag=meeting?.assuntos_gerais||{};
    const itensAG=(ag.itens||[]).filter(i=>i._anunciado);
    const manifGeraisRestantes=ag.manifestacoes_gerais||[];
    html+=`<h2>${secN++}. Assuntos Gerais</h2>`;
    if(itensAG.length||manifGeraisRestantes.length){
      if(itensAG.length){
        html+=`<ul>`;
        itensAG.forEach(i=>{html+=`<li>${i.assunto}${_manifLi(i.manifestacoes)}</li>`;});
        html+=`</ul>`;
      }
      if(manifGeraisRestantes.length){
        const nomes=[...new Set(manifGeraisRestantes.map(m=>m.deputado||m.nome).filter(Boolean))];
        html+=`<p><span class="lbl">Manifestações gerais:</span> ${nomes.join(', ')}.</p>`;
      }
    } else {
      html+=`<p class="muted it">Não houve assuntos gerais.</p>`;
    }

    html+=`</body></html>`;

    return html;
}


/* ══════════════════════════════════════════════════════════════════
   ENTREGA — funções finas que recebem o HTML e o materializam.
   ══════════════════════════════════════════════════════════════════ */

/* Baixa um HTML como arquivo .doc (Word abre HTML com cabeçalho msword). */
/* ══════════════════════════════════════════════════════════════════
   PLANILHA DE VOTAÇÃO — retorna {html, nome} ou null (item sem votação).
   Um documento .doc por item votado, para anexar ao parecer no sistema
   corporativo. Combina o cabeçalho rico do modelo em papel (proposição,
   proponente, ementa, relator, parecer) com a tabela enxuta do corporativo
   (Partido · Parlamentar · Voto) — lista só quem votou e como.
   Voto de desempate: marcado na linha + nota de rodapé (Art. 63 §4).
   Gerada para qualquer item com votação registrada (aprovado, rejeitado ou
   inconclusivo); retorna null se não houve votação (vista, retirado, etc.).
   ══════════════════════════════════════════════════════════════════ */
function docPlanilhaVotacaoHTML(meeting, itemId){
  const H=_expHelpers(meeting);
  const meta=meeting?.metadados||{};
  const item=(meeting?.ordem_do_dia||[]).find(it=>String(it.id)===String(itemId));
  if(!item)return null;
  const ex=item.execucao||{};
  const nF=(ex.votos_favoraveis||[]).length;
  const nC=(ex.votos_contrarios||[]).length;
  if(!nF && !nC)return null;                 // não houve votação: nada a planilhar

  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const vd=ex.voto_desempate&&ex.voto_desempate.exercido?ex.voto_desempate:null;
  const idDesempate=vd?vd.id_assembleia:null;

  // Linhas: quem votou e como. Deduplica o condutor (que aparece 2× no array
  // quando há desempate) — a marca ¹ na linha dele já registra o voto extra.
  const linhas=[];
  const push=(arr,rotulo)=>{
    const vistos=new Set();
    (arr||[]).forEach(v=>{
      const key=v.id_assembleia!=null?`#${v.id_assembleia}`:`n:${v.nome}`;
      if(vistos.has(key))return;
      vistos.add(key);
      const marca=(idDesempate!=null&&v.id_assembleia===idDesempate)?'<sup>1</sup>':'';
      linhas.push({partido:v.partido||'—', nome:(v.nome||'')+'', voto:rotulo, marca});
    });
  };
  push(ex.votos_favoraveis,'Favorável');
  push(ex.votos_contrarios,'Contrário');
  linhas.sort((a,b)=>a.nome.localeCompare(b.nome));

  const trs=linhas.map(l=>
    `<tr><td>${esc(l.partido)}</td><td>${esc(l.nome)}${l.marca}</td><td>${l.voto}</td></tr>`).join('\n');

  // Resultado por extenso
  const st=ex.status;
  const resultado = st==='aprovado' ? 'APROVADO'
    : st==='rejeitado' ? 'REJEITADO'
    : st==='inconclusivo' ? 'INCONCLUSIVO (sem quórum de deliberação)'
    : (nF>nC?'APROVADO':nC>nF?'REJEITADO':'EMPATE');

  const proponente = item.proponente_principal ? H.formatProponente(item.proponente_principal) : '—';
  const relator = item.relator ? `${item.relator.nome}${item.relator.partido?` (${item.relator.partido})`:''}` : '—';
  const parecer = item.parecer ? H.parecerExt(item.parecer) : '—';
  const tituloItem = `${item.tipo||''} ${item.numero||''}${item.ano?`/${item.ano}`:''}`.trim();

  const notaRodape = vd
    ? `<p class="nota"><sup>1</sup> Voto de desempate, proferido na condução dos trabalhos (Art. 63, §4.º, do Regimento Interno).</p>`
    : '';

  const body = `
<p class="tit"><b>PLANILHA DE VOTAÇÃO</b></p>
<p class="comissao"><b>${esc(meta.comissao||'')}</b></p>
<p class="item"><b>${esc(tituloItem)}${item.votacao_conclusiva?' — parecer (tramitação conclusiva)':' — parecer'}</b></p>
<p><b>Proponente:</b> ${esc(proponente)}</p>
<p class="ementa"><b>Ementa:</b> <i>${esc(item.ementa||'')}</i></p>
<p><b>Relator:</b> ${esc(relator)}</p>
<p><b>Parecer:</b> ${esc(parecer)}</p>
<table class="pv">
  <thead><tr><th>Partido</th><th>Parlamentar</th><th>Voto</th></tr></thead>
  <tbody>
${trs}
  </tbody>
</table>
<p class="totais"><b>Favorável:</b> ${String(nF).padStart(2,'0')} &nbsp;·&nbsp; <b>Contrário:</b> ${String(nC).padStart(2,'0')} &nbsp;·&nbsp; <b>Total:</b> ${String(nF+nC).padStart(2,'0')}</p>
<p class="resultado"><b>Resultado da Votação: ${resultado}</b></p>
${notaRodape}
<p class="fecho">Sala da ${esc(meta.comissao||'Comissão')}, em ${H.dataPorExtenso(meta.data)}.</p>
<p class="assinatura">&nbsp;</p>
<p class="assinatura" style="text-align:center">Deputado ${esc(getDep(meta.condutor_id||0).nome)},<br>Presidente da Comissão.</p>
<p class="assinatura" style="text-align:center">&nbsp;</p>
<p class="assinatura" style="text-align:center">Secretário da Comissão.</p>`;

  const extraCSS = `
.tit { text-align:center; margin-bottom:4pt; }
.comissao, .item { text-align:center; margin:0 0 6pt 0; }
.ementa { text-align:justify; }
table.pv { border-collapse:collapse; width:100%; margin:10pt 0; font-size:11pt; }
table.pv th, table.pv td { border:1px solid #000; padding:4pt 8pt; text-align:left; }
table.pv th { background:#e6e6e6; font-weight:bold; }
.totais, .resultado { text-align:left; margin:6pt 0 0 0; }
.nota { font-size:10pt; margin-top:8pt; }
.fecho { margin-top:20pt; }
.assinatura { margin:0; }`;

  const html=_docEnvelope(body, extraCSS);
  const nomeItem=`${(item.tipo||'').replace(/\s+/g,'')}_${item.numero||''}_${item.ano||''}`.replace(/_+$/,'');
  return {html, nome:`Planilha_Votacao_${nomeItem||H.siglaDoc()}_${H.dataFile()}.doc`};
}

function baixarDOC(html, nomeArquivo){
  const blob=new Blob(['\ufeff',html],{type:'application/msword;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=nomeArquivo;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Abre o HTML numa janela e dispara a impressão (fluxo "salvar como PDF"). */
function imprimirPDF(html){
  const win=window.open('','_blank','width=900,height=700');
  win.document.write(html); win.document.close();
  setTimeout(()=>{ win.focus(); win.print(); }, 250);
}
