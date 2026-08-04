'use strict';
// ═══════════════════════════════════════════════════════════
// Deputados e comissões vêm de cadastros.js (CAD).
// getDep resolve por CAD (arquivo → fallback embutido → placeholder).
// ═══════════════════════════════════════════════════════════

const Q_ABERTURA = 3;
const Q_DELIB = 7;
const DURACAO_LIMITE_MIN = 120;   // limite regimental da reunião ordinária: 2h (art. do RI)
const DURACAO_ALERTA_MIN = 105;   // começa a alertar 15 min antes do limite
const TIPOS_RELATOR = ['PL','PLC','PEC','RDI','VT','VP','RELSUB'];
const TIPOS_VISTA   = ['PL','PLC','PEC','RDI','VT','VP'];
const TIPOS_INCONCLUSIVO = ['PL','PLC','PEC','RDI','VT','VP'];

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const S = {
  meeting: null,
  rascunhoKey: null,
  _pendingData: null,
  condutorId: null,
  presencas: {},        // {id: 'ausente'|'ativo'|'acompanhando'}
  outros: [],           // [{nome, id_assembleia, partido}]
  timelinePresencas: [],
  timelineConducao: [],
  falas: [],
  fotoAberturaTs: null,
  fotoOrdemDiaTs: null,
  sessionStatus: 'aguardando',
  sidebarExpanded: true,
  odFases: {},          // {itemId: 'relatorio'|'discussao'|'encaminhamentos'|'votacao'|'minerva'|'redistribuicao'}
  odFaseAnterior: {},   // {itemId: fase anterior ao abrir vista-form}
  fabState: null,       // {contexto, target} — estado unificado do FAB; target:{tipo,idx} define onde persistir
  odOrdem: [],          // array of item indices in execution order
  limparConfirm: false,
  limparTimer: null,
  fabContexto: '',
  fabFalanteId: null,
};

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function now(){ return new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function getDep(id){ return resolveDep(id); }
function getAtivos(){ return Object.entries(S.presencas).filter(([,v])=>v==='ativo').map(([id])=>parseInt(id)); }
function countAtivos(){ return getAtivos().length; }
function isMembro(id){ const m=S.meeting?.membros_comissao; return m&&([...m.titulares,...m.suplentes].includes(parseInt(id))); }
function isTitular(id){ return S.meeting?.membros_comissao?.titulares?.includes(parseInt(id)); }

function autosave(){
  if(!S.rascunhoKey)return;
  try{
    localStorage.setItem(S.rascunhoKey,JSON.stringify({
      meeting:S.meeting,condutorId:S.condutorId,presencas:S.presencas,outros:S.outros,
      timelinePresencas:S.timelinePresencas,timelineConducao:S.timelineConducao,
      falas:S.falas,fotoAberturaTs:S.fotoAberturaTs,fotoOrdemDiaTs:S.fotoOrdemDiaTs,
      sessionStatus:S.sessionStatus,odFases:S.odFases,odOrdem:S.odOrdem,
    }));
  }catch(e){console.error('Autosave failed',e);}
}

// ── MODAL CUSTOMIZADO ──────────────────────────────────────
let _modalOpcoes = null;

// ── Sub-fase legível para contexto granular da OD ──────────
function _odSubfaseLabel(fase){
  if(!fase||fase==='concluido')return'';
  const m={relatorio:'Leitura do Relatório',discussao:'Discussão',encaminhamentos:'Encaminhamentos',
    votacao:'Votação',minerva:'Voto de Desempate',redistribuicao:'Redistribuição',
    'vista-form':'Pedido de Vista','eleicao-result':'Eleição','reqsub-membros':'Designação de Membros',
    'faseb-discussao':'Discussão (Conclusiva)','faseb-enc-pl':'Encaminhamentos do PL (Conclusiva)',
    'faseb-pl':'Votação do PL (Conclusiva)','faseb-redacao':'Redação Final (Conclusiva)'};
  if(m[fase])return m[fase];
  let mt=fase.match(/faseb-enc-emenda-(\d+)/);
  if(mt)return`Encaminhamentos — Emenda ${parseInt(mt[1])+1}`;
  mt=fase.match(/faseb-vot-emenda-(\d+)/);
  if(mt)return`Votação — Emenda ${parseInt(mt[1])+1}`;
  return fase;
}

// ── Modal rico para exibir lista de manifestações ──────────
function showManifModal(titulo, arr){
  if(!arr||!arr.length){toast('Nenhuma manifestação registrada.','info',1500);return;}
  const linhas=arr.map(m=>{
    const quem=m.deputado||m.nome||'—';
    const partido=m.partido?` (${m.partido})`:'';
    const ts=m.timestamp?`<span class="manif-ts">• ${m.timestamp}</span>`:'';
    const nota=m.texto?`<div class="manif-nota">${m.texto}</div>`:'';
    return`<div class="manif-entry"><span class="manif-quem">${quem}${partido}</span>${ts}${nota}</div>`;
  }).join('');
  document.getElementById('modal-titulo').textContent=titulo;
  document.getElementById('modal-msg').innerHTML=`<div class="manif-list">${linhas}</div>`;
  document.getElementById('modal-btns').innerHTML='<button class="btn btn-ghost" onclick="_closeModal()">Fechar</button>';
  _modalOpcoes=null;
  document.getElementById('custom-modal').classList.add('show');
}

// ── Abre modal de manifestações a partir do tipo/idx ───────
function verManifestacoes(tipo,idx,titulo){
  const arr=_resolverArrayManifestacoes({tipo,idx});
  showManifModal(titulo||'Manifestações',arr);
}

// ── Botão 💬 com badge contador opcional ──────────────────
// Retorna HTML: botão de adicionar + badge clicável quando há registros
function _fabBtn(openFn, manifArr, tipo, idx){
  const n=(manifArr||[]).length;
  const badge=n?`<button class="manif-badge" onclick="verManifestacoes('${tipo}',${idx},'Manifestações')" title="${n} manifestação(ões) registrada(s)">${n}</button>`:'';
  return`<button class="btn btn-ghost btn-xs" onclick="${openFn}">💬</button>${badge}`;
}

function showModal(titulo, mensagem, opcoes){
  // opcoes: [{label, cls, action}]
  document.getElementById('modal-titulo').textContent = titulo;
  document.getElementById('modal-msg').textContent = mensagem;
  document.getElementById('modal-btns').innerHTML = opcoes.map((o,i)=>
    `<button class="btn ${o.cls||'btn-ghost'}" onclick="_handleModal(${i})">${o.label}</button>`
  ).join('');
  _modalOpcoes = opcoes;
  document.getElementById('custom-modal').classList.add('show');
}

function _handleModal(idx){
  // Salvar a ação ANTES de fechar (closeModal zera _modalOpcoes)
  const action=_modalOpcoes?.[idx]?.action;
  _closeModal();
  if(action) action();
}

function _closeModal(){
  document.getElementById('custom-modal').classList.remove('show');
  _modalOpcoes = null;
}

// Fecha modal ao clicar no backdrop
document.addEventListener('click', e=>{
  if(e.target.id==='custom-modal') _closeModal();
});
// ───────────────────────────────────────────────────────────
function sessionOpen(silencioso=false){
  // Sessão "sem quórum de abertura" nunca chega a abrir — foto foi tirada mas sem quórum mínimo
  if(!S.fotoAberturaTs || S.sessionStatus==='sem_quorum_abertura'){
    if(!silencioso)toast('A sessão não foi aberta. Registre a presença na seção Abertura.','warn',3000);
    return false;
  }
  return true;
}

function toast(msg,tipo='info',ms=2500){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`show ${tipo}`;
  setTimeout(()=>{t.className='';},ms);
}

function regimental(horaInicio){
  if(!horaInicio)return '09:15';
  const[h,m]=horaInicio.split(':').map(Number);
  const total=h*60+m+15;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}

function getOdItem(id){ return S.meeting?.ordem_do_dia?.find(i=>i.id===id); }

// Normaliza campo maioria_simples (suporta item direto ou legado via regras_regimentais)
function getMaiSimples(item){ return !!(item.maioria_simples||item.regras_regimentais?.maioria_simples); }
// Normaliza campo votacao_conclusiva (suporta direto ou legado via regras_regimentais.fase_conclusiva)
function getConclus(item){ return !!(item.votacao_conclusiva||item.regras_regimentais?.fase_conclusiva); }
// Fase B: item conclusivo SEM relator (votação definitiva do PL, não do parecer)
function isFaseB(item){ return getConclus(item)&&!item.relator; }
// Exibe parecer de forma legível
function parecerLabel(p){
  const m={favoravel:'Favorável',favoravel_com_emendas:'Favorável com emendas',contrario:'Contrário'};
  return m[p]||p||'—';
}
// Formata data para exibição (suporta ISO 8601 e DD/MM/YYYY)
function fmtData(s){
  if(!s)return'—';
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const[y,m,d]=s.split('-');return`${d}/${m}/${y}`;}
  return s;
}
// Nome do proponente com partido entre parênteses quando for deputado com partido.
// Órgão (is_deputado:false) ou sem partido → só o nome.
function propUI(prop){
  if(!prop)return '—';
  const nome=prop.nome||'—';
  if(nome==='—')return nome;
  const ehDep=prop.is_deputado!==false;
  return (ehDep&&prop.partido)?`${nome} (${prop.partido})`:nome;
}
/* ID da sugestão de relatoria — formato canônico PLANO {id_assembleia,...}.
   Tolera o formato legado aninhado {deputado:{id_assembleia}} por robustez. */
function sugestaoRelatorId(s){
  if(!s)return null;
  return s.id_assembleia || s.deputado?.id_assembleia || null;
}
function ensureExecucao(item){
  if(!item.execucao) item.execucao={status:null,hora_inicio_apreciacao:null,hora_fim_apreciacao:null,
    relatorio_lido:false,redacao_final_aprovada:false,autor_vista:null,novo_relator:null,
    voto_desempate:null,votos_favoraveis:[],votos_contrarios:[]};
  if(!item.execucao.votos_favoraveis) item.execucao.votos_favoraveis=[];
  if(!item.execucao.votos_contrarios) item.execucao.votos_contrarios=[];
}

// ═══════════════════════════════════════════════════════════
// IMPORT + INIT
// ═══════════════════════════════════════════════════════════
document.getElementById('file-input').addEventListener('change',function(e){
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=evt=>{
    try{
      const data=JSON.parse(evt.target.result);
      handleNewData(data);
    }catch(err){ alert('Erro ao ler JSON: '+err.message); }
  };
  reader.readAsText(file,'UTF-8');
  this.value='';
});

function handleNewData(data){
  const comissao=(data.metadados?.comissao||'').substring(0,20).replace(/[^a-zA-Z0-9]/g,'_');
  const data_r=data.metadados?.data||'';
  const key=`roteiro_${comissao}_${data_r}`;
  S.rascunhoKey=key;
  const existing=localStorage.getItem(key);
  if(existing){
    S._pendingData=data;
    const snap=JSON.parse(existing);
    const resumeBox=document.getElementById('import-resume-box');
    document.getElementById('import-resume-info').textContent=
      ` ${snap.meeting?.metadados?.comissao||'reunião'} — status: ${snap.sessionStatus||'?'}`;
    resumeBox.style.display='block';
  } else {
    initFromData(data);
  }
}

function retomar(){
  const snap=JSON.parse(localStorage.getItem(S.rascunhoKey));
  S.meeting=snap.meeting; S.condutorId=snap.condutorId;
  S.presencas=snap.presencas||{}; S.outros=snap.outros||[];
  S.timelinePresencas=snap.timelinePresencas||[];
  S.timelineConducao=snap.timelineConducao||[];
  S.falas=snap.falas||[];
  S.fotoAberturaTs=snap.fotoAberturaTs; S.fotoOrdemDiaTs=snap.fotoOrdemDiaTs;
  S.sessionStatus=snap.sessionStatus||'aguardando';
  S.odFases=snap.odFases||{}; S.odOrdem=snap.odOrdem||[];
  if(!S.odOrdem.length) initOdOrdem();
  showApp(); renderAll();
}

function descartarRetomar(){
  document.getElementById('import-resume-box').style.display='none';
  initFromData(S._pendingData);
  S._pendingData=null;
}

/* Aplica a resolução de composição: o ROTEIRO tem precedência; se vier
   magro (sem titulares e/ou suplentes), o arquivo de comissões preenche.
   Sobrescreve os arrays de membros_comissao com IDs inteiros e registra
   a origem em S.composicaoOrigem para aviso ao usuário. */
function aplicarComposicao(meeting){
  const mc=meeting.membros_comissao||(meeting.membros_comissao={});
  const chave=meeting.metadados?.comissao||meeting.metadados?.sigla_comissao||'';
  const r=resolverComposicao(mc, chave);
  mc.titulares=r.titulares;
  mc.suplentes=r.suplentes;
  S.composicaoOrigem=r.origem;
  // Aviso honesto quando o roteiro veio magro
  if(r.origem.titulares==='arquivo'||r.origem.suplentes==='arquivo'){
    const partes=[];
    if(r.origem.titulares==='arquivo')partes.push('titulares');
    if(r.origem.suplentes==='arquivo')partes.push('suplentes');
    setTimeout(()=>toast(`Composição (${partes.join(' e ')}) preenchida pelo cadastro de comissões.`,'info',3500),400);
  } else if(r.origem.titulares==='ausente'||r.origem.suplentes==='ausente'){
    setTimeout(()=>toast('Composição não encontrada no roteiro nem no cadastro. Verifique a comissão.','warn',4500),400);
  }
}

function initFromData(data){
  // Deep-copy para não mutar o objeto original parseado
  const meeting=JSON.parse(JSON.stringify(data));
  const mdIn=meeting.metadados||{};

  // ── JSON PÓS-REUNIÃO (consolidado via exportJSON) ─────────
  // Detectado pela presença de status_sessao — só existe após consolidarMeeting().
  // Restaura a sessão completa para consulta/reexportação, em vez de resetar.
  if(mdIn.status_sessao){
    S.meeting=meeting;
    aplicarComposicao(meeting);
    S.condutorId=mdIn.condutor_id||null;
    S.outros=mdIn.presencas_gerais?.visitantes||[];
    S.timelinePresencas=mdIn.timeline_presencas||[];
    S.timelineConducao=mdIn.timeline_conducao||[];
    S.falas=mdIn.falas_sessao||[];
    S.sessionStatus=mdIn.status_sessao;
    S.presencas={};
    [...(mdIn.presencas_gerais?.titulares||[]),...(mdIn.presencas_gerais?.suplentes||[])]
      .forEach(d=>{if(d.id_assembleia!=null)S.presencas[d.id_assembleia]='ativo';});
    S.odFases={};
    (meeting.ordem_do_dia||[]).forEach(item=>{
      ensureExecucao(item);
      if(item.execucao?.status)S.odFases[item.id]='concluido';
    });
    S.odOrdem=(mdIn.ordem_apreciacao_od||[]).slice();
    if(!S.odOrdem.length)initOdOrdem();
    S.fotoAberturaTs=mdIn.quorum?.abertura?(mdIn.quorum.abertura.timestamp||'restaurada'):null;
    S.fotoOrdemDiaTs=mdIn.quorum?.ordem_do_dia?(mdIn.quorum.ordem_do_dia.timestamp||'restaurada'):null;
    showApp(); renderAll(); autosave();
    toast('Sessão realizada restaurada (modo consulta/reexportação).','info',3500);
    return;
  }

  // ── PAUTA NOVA (pré-reunião) ──────────────────────────────
  // Zerar campos de execução que são preenchidos DURANTE a sessão
  // (garante que JSONs exportados com resultados não contaminem nova importação)
  (meeting.ordem_do_dia||[]).forEach(item=>{
    if(!item.execucao)item.execucao={};
    item.execucao.status=null;
    item.execucao.hora_inicio_apreciacao=null;
    item.execucao.hora_fim_apreciacao=null;
    item.execucao.relatorio_lido=item.execucao.relatorio_lido&&!!item.relatorio_lido_em; // preserva se lido em sessão anterior
    // Rede de segurança: se o JSON não indicou leitura mas há vista anterior registrada,
    // o relatório necessariamente já foi lido em algum momento (não se pede vista sem leitura prévia).
    // Não sobrepõe relatorio_lido_em nem o controle manual — só evita reexibir "peça a leitura"
    // quando a extração deixou a informação incompleta.
    if(!item.relatorio_lido_em && !item.execucao.relatorio_lido && (item.pedidos_de_vista_anteriores||[]).length){
      item.execucao.relatorio_lido=true;
    }
    item.execucao.autor_vista=null;
    item.execucao.redistribuicao=null;
    item.execucao.voto_desempate=null;
    item.execucao.votos_favoraveis=[];
    item.execucao.votos_contrarios=[];
    item.execucao.eleito=null;
  });
  S.meeting=meeting; S.condutorId=meeting.metadados?.condutor_id||null;
  aplicarComposicao(S.meeting);
  S.presencas={}; S.outros=[]; S.timelinePresencas=[];
  S.timelineConducao=[]; S.falas=[];
  S.fotoAberturaTs=null; S.fotoOrdemDiaTs=null;
  S.sessionStatus='aguardando'; S.odFases={};
  (S.meeting.ordem_do_dia||[]).forEach(item=>ensureExecucao(item));
  initOdOrdem();
  showApp(); renderAll(); autosave();
}

function initOdOrdem(){
  S.odOrdem=(S.meeting.ordem_do_dia||[]).map((_,i)=>i);
  S.odOrdem.sort((a,b)=>(S.meeting.ordem_do_dia[a].ordem||0)-(S.meeting.ordem_do_dia[b].ordem||0));
}

function showApp(){
  document.getElementById('import-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('fab-btn').style.display='flex';
  _initLongPress();
}

// ═══════════════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════════════
function renderAll(){
  renderHeader(); renderSidebar();
  renderAbertura(); renderAtas(); renderExpediente(); renderConhecimento();
  renderOrdemDoDia(); renderAssuntosGerais(); renderEncerramento();
}

// ═══════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════
function renderHeader(){
  const m=S.meeting?.metadados||{};
  const sigla=m.sigla||(m.comissao||'').split(' ').filter(w=>w.length>3&&!/^(de|do|da|e|a|o)$/i.test(w)).map(w=>w[0]).join('')||'ALRS';
  document.getElementById('hdr-sigla').textContent=sigla;
  document.getElementById('hdr-data').textContent=fmtData(m.data)||'';
  const st=document.getElementById('hdr-status');
  const map={
    aguardando:'Aguardando abertura',
    'em-andamento':'● Em andamento',
    sem_quorum_abertura:'⚠️ Sem quórum — Ata Declaratória',
    encerrada:'Encerrada'
  };
  st.textContent=map[S.sessionStatus]||S.sessionStatus;
  st.className=S.sessionStatus;
  tickCronometro();
}

/* Cronômetro de duração da reunião, exibido no header do sistema ao vivo.
   Conta desde hora_inicio_efetiva (crescente, HH:MM). Muda de cor perto do
   limite regimental de 2h: neutro < 1h45, âmbar 1h45–2h, vermelho ≥ 2h.
   Só aparece com a sessão em andamento; some quando encerrada/aguardando.
   Robusto a horários malformados: se não conseguir parsear, não exibe. */
function _minutosDesde(hhmm){
  const m=String(hhmm||'').match(/(\d{1,2})\s*[:h.\s]\s*(\d{1,2})/);
  if(!m)return null;
  const ini=parseInt(m[1],10)*60+parseInt(m[2],10);
  const agora=new Date();
  let cur=agora.getHours()*60+agora.getMinutes();
  if(cur<ini)cur+=24*60;   // atravessou meia-noite (defensivo)
  return cur-ini;
}
function tickCronometro(){
  const el=document.getElementById('hdr-cronometro');
  if(!el)return;
  const emAndamento = S.sessionStatus==='em-andamento';
  const inicio = S.meeting?.metadados?.hora_inicio_efetiva;
  const mins = emAndamento ? _minutosDesde(inicio) : null;
  if(mins==null){ el.textContent=''; el.className=''; el.style.display='none'; return; }
  el.style.display='';
  const h=Math.floor(mins/60), m=mins%60;
  el.textContent=`⏱ ${h}:${String(m).padStart(2,'0')}`;
  el.className = mins>=DURACAO_LIMITE_MIN ? 'cron-limite'
              : mins>=DURACAO_ALERTA_MIN ? 'cron-alerta'
              : 'cron-ok';
  const restante=DURACAO_LIMITE_MIN-mins;
  el.title = mins>=DURACAO_LIMITE_MIN
    ? `Limite regimental de 2h atingido (${mins-DURACAO_LIMITE_MIN} min além). Cabe prorrogação por uma vez.`
    : `Duração da reunião · ${restante} min para o limite regimental de 2h`;
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════
function toggleSidebar(){
  S.sidebarExpanded=!S.sidebarExpanded;
  const sb=document.getElementById('sidebar');
  const btn=document.getElementById('sb-toggle');
  if(S.sidebarExpanded){sb.classList.remove('collapsed');btn.textContent='◀';}
  else{sb.classList.add('collapsed');btn.textContent='▶';}
}

function renderSidebar(){
  const cnt=countAtivos();
  const dot=document.getElementById('sb-q-dot');
  const txt=document.getElementById('sb-q-text');
  if(cnt<Q_ABERTURA){dot.className='';dot.style.background='var(--red)';txt.textContent=`Sem quórum (${cnt})`;}
  else if(cnt<Q_DELIB){dot.className='warn';dot.style.background='var(--amber)';txt.textContent=`Só abertura (${cnt})`;}
  else{dot.className='ok';dot.style.background='var(--green)';txt.textContent=`Quórum pleno (${cnt})`;}

  const m=S.meeting?.membros_comissao;
  if(!m)return;

  // Condutor select
  const sel=document.getElementById('condutor-sel');
  const prev=sel.value;
  sel.innerHTML='';
  const todos=[...m.titulares,...m.suplentes].map(id=>getDep(id));
  todos.forEach(d=>{
    const o=document.createElement('option');
    o.value=d.id; o.textContent=`${d.nome} (${d.partido})`;
    if(d.id==S.condutorId)o.selected=true;
    sel.appendChild(o);
  });
  if(!S.condutorId && todos.length) S.condutorId=todos[0].id;

  // Titulares grid
  document.getElementById('grid-titulares').innerHTML=
    m.titulares.map(id=>depCell(id,'titular')).join('');

  // Suplentes grid
  document.getElementById('grid-suplentes').innerHTML=
    m.suplentes.map(id=>depCell(id,'suplente')).join('');

  // Anotação persistente de origem: aparece SÓ quando a composição não veio
  // do roteiro (preenchida pelo cadastro de comissões). Complementa o toast,
  // que é efêmero e pode passar despercebido.
  const org=S.composicaoOrigem||{};
  document.getElementById('lbl-titulares').innerHTML=
    'Titulares'+(org.titulares==='arquivo'?' <span class="lbl-origem">(do cadastro)</span>':'');
  document.getElementById('lbl-suplentes').innerHTML=
    'Suplentes'+(org.suplentes==='arquivo'?' <span class="lbl-origem">(do cadastro)</span>':'');

  // Outros
  document.getElementById('outros-list').innerHTML=
    S.outros.length?S.outros.map(o=>`<div class="small muted">• ${o.nome}${o.partido?' ('+o.partido+')':''}</div>`).join(''):'';
}

function depCell(id,tipo){
  const d=getDep(id);
  const st=S.presencas[id]||'ausente';
  const nomeAbr=d.nome.split(' ').slice(0,3).join(' ');
  return `<div class="dep-cell ${st}" data-dep-id="${id}" data-dep-tipo="${tipo}" onclick="togglePresenca(${id},'${tipo}')" title="${d.nome} (${d.partido})">
    <div class="dn">${nomeAbr}</div>
    <div class="dp">${d.partido.toLowerCase()}</div>
  </div>`;
}

/* ── Long-press nas células: abre mini-menu de estado explícito ──
   Toque curto mantém o ciclo (onclick inline). Toque longo (>500ms)
   abre o menu Ativo/Acompanhando/Ausente e SUPRIME o clique de ciclo. */
let _lpTimer=null, _lpSuppress=false, _lpCell=null;
function _setPresencaDireto(id,estado){
  const cur=S.presencas[id]||'ausente';
  if(cur===estado){ fecharMenuPresenca(); return; }
  // Saída em sessão já aberta: reaproveita a confirmação existente
  const isSaida=(cur==='ativo'||cur==='acompanhando')&&estado==='ausente'&&!!S.fotoAberturaTs;
  fecharMenuPresenca();
  if(isSaida){
    const d=getDep(id);
    showModal('Confirmar Saída',
      `Confirma a retirada do Deputado ${d.nome} (${d.partido}) da sessão?`,
      [
        {label:'✓ Confirmar saída', cls:'btn-danger', action:()=>_aplicarTogglePresenca(id,cur,estado)},
        {label:'Cancelar', cls:'btn-ghost', action:()=>{}},
      ]
    );
    return;
  }
  _aplicarTogglePresenca(id,cur,estado);
}
function abrirMenuPresenca(cell){
  const id=parseInt(cell.getAttribute('data-dep-id'));
  const d=getDep(id);
  const st=S.presencas[id]||'ausente';
  fecharMenuPresenca();
  const menu=document.createElement('div');
  menu.id='presenca-menu';
  menu.className='presenca-menu';
  const opt=(estado,rotulo,ic)=>`<button class="pm-opt ${st===estado?'atual':''}" onclick="_setPresencaDireto(${id},'${estado}')">${ic} ${rotulo}${st===estado?' ✓':''}</button>`;
  menu.innerHTML=`<div class="pm-nome">${d.nome} <span class="pm-part">(${d.partido})</span></div>`+
    opt('ativo','Ativo','🟢')+opt('acompanhando','Acompanhando','🟡')+opt('ausente','Ausente','⚪');
  document.body.appendChild(menu);
  // Posiciona junto à célula, dentro da viewport
  const r=cell.getBoundingClientRect();
  const mw=180, mh=menu.offsetHeight||150;
  let left=r.right+6, top=r.top;
  if(left+mw>window.innerWidth) left=Math.max(6,r.left-mw-6);
  if(top+mh>window.innerHeight) top=Math.max(6,window.innerHeight-mh-6);
  menu.style.left=left+'px'; menu.style.top=top+'px';
  // Fecha ao tocar fora
  setTimeout(()=>document.addEventListener('pointerdown',_menuOutside,{capture:true}),0);
}
function _menuOutside(e){
  if(!e.target.closest('#presenca-menu')) fecharMenuPresenca();
}
function fecharMenuPresenca(){
  const m=document.getElementById('presenca-menu');
  if(m)m.remove();
  document.removeEventListener('pointerdown',_menuOutside,{capture:true});
}
function _initLongPress(){
  const body=document.getElementById('sb-body');
  if(!body||body._lpBound)return;
  body._lpBound=true;
  // Bloqueia o menu de contexto nativo (Baixar/Compartilhar/Imprimir do Chrome)
  // sobre as células — é o que "roubava" o long-press antes do nosso menu.
  body.addEventListener('contextmenu',e=>{
    if(e.target.closest('.dep-cell')) e.preventDefault();
  });
  body.addEventListener('pointerdown',e=>{
    const cell=e.target.closest('.dep-cell');
    if(!cell)return;
    _lpCell=cell; _lpSuppress=false;
    _lpTimer=setTimeout(()=>{
      _lpSuppress=true;
      // Feedback tátil se o dispositivo suportar
      if(navigator.vibrate) try{ navigator.vibrate(15); }catch(_){}
      abrirMenuPresenca(cell);
    }, 500);
  });
  const cancel=()=>{ clearTimeout(_lpTimer); };
  body.addEventListener('pointerup',cancel);
  body.addEventListener('pointermove',e=>{ if(_lpCell && !_lpCell.contains(e.target)) cancel(); });
  body.addEventListener('pointercancel',cancel);
  body.addEventListener('pointerleave',cancel);
  // Suprime o click de ciclo quando houve long-press
  body.addEventListener('click',e=>{
    if(_lpSuppress){ e.stopPropagation(); e.preventDefault(); _lpSuppress=false; }
  },{capture:true});
}

function setCondutor(id){
  if(!id)return;
  if(S.condutorId && S.condutorId!=id){
    const d=getDep(id);
    S.timelineConducao.push({id_assembleia:d.id,nome:d.nome,partido:d.partido,
      timestamp:now(),contexto:fabGetContexto()});
  }
  S.condutorId=id; autosave();
}

// Atualiza estado do botão de foto de abertura sem re-renderizar a seção toda
// Foto de abertura: sempre habilitada — o sistema registra o que está presente
// e bifurca: com quórum abre normalmente, sem quórum gera Ata Declaratória
function updateFotoBtn(){
  const btn=document.getElementById('btn-foto-abertura');
  if(!btn||S.fotoAberturaTs)return;
  btn.removeAttribute('disabled');
  btn.style.opacity='1';
  btn.style.cursor='pointer';
  // Atualizar texto informativo de quórum
  const cnt=countAtivos();
  const temQ=cnt>=Q_ABERTURA;
  const info=btn.parentElement?.querySelector('.quorum-info');
  if(info){
    info.textContent=temQ
      ?`✅ ${cnt} presentes — quórum de abertura atingido`
      :`⚠️ ${cnt} presente${cnt!==1?'s':''} — mínimo: ${Q_ABERTURA} para abrir`;
    info.style.color=temQ?'var(--green)':'var(--amber)';
  }
  // Atualizar label do botão
  btn.childNodes.forEach(n=>{if(n.nodeType===3)n.textContent=`📸 Registrar Presença e ${temQ?'Abrir Sessão':'Declarar Reunião sem Quórum'} `;});
}

function togglePresenca(id,tipo){
  const cur=S.presencas[id]||'ausente';
  let next;
  if(tipo==='titular'){ next=cur==='ausente'?'ativo':'ausente'; }
  else { next=cur==='ausente'?'ativo':cur==='ativo'?'acompanhando':'ausente'; }

  // Saída real em sessão (já estava ativo/acompanhando, foto de abertura já tirada): confirmar antes
  const isSaida=(cur==='ativo'||cur==='acompanhando')&&next==='ausente'&&!!S.fotoAberturaTs;
  if(isSaida){
    const d=getDep(id);
    showModal('Confirmar Saída',
      `Confirma a retirada do Deputado ${d.nome} (${d.partido}) da sessão?`,
      [
        {label:'✓ Confirmar saída', cls:'btn-danger', action:()=>_aplicarTogglePresenca(id,cur,next)},
        {label:'Cancelar', cls:'btn-ghost', action:()=>{}},
      ]
    );
    return;
  }
  _aplicarTogglePresenca(id,cur,next);
}

function _aplicarTogglePresenca(id,cur,next){
  S.presencas[id]=next;
  S.timelinePresencas.push({id_assembleia:id,nome:getDep(id).nome,partido:getDep(id).partido,
    de:cur,para:next,timestamp:now(),contexto:fabGetContexto()});
  autosave(); renderSidebar();
  updateFotoBtn();
  updateFotoODBtn();
  checkQuorumOD();
  // Atualizar cards da OD que dependem do estado de presença (ex: badge relator ausente)
  if(document.getElementById('body-od')?.classList.contains('open')) renderOrdemDoDia();
}

function addOutro(){
  const inp=document.getElementById('outros-input');
  const val=inp.value.trim(); if(!val)return;
  const dep=Object.values(CAD.deputados).find(d=>d.nome.toLowerCase().includes(val.toLowerCase()));
  if(dep){S.outros.push({nome:dep.nome,id_assembleia:dep.id,partido:dep.partido,contexto:fabGetContexto()});}
  else{S.outros.push({nome:val,id_assembleia:null,partido:null,contexto:fabGetContexto()});}
  inp.value=''; autosave(); renderSidebar();
}

// Foto da OD: sempre habilitada se sessão aberta — registra quem estava,
// bifurca: com quórum inicia OD, sem quórum passa direto para AG
function updateFotoODBtn(){
  const btn=document.getElementById('btn-foto-od');
  if(!btn||S.fotoOrdemDiaTs)return;
  if(!S.fotoAberturaTs||S.sessionStatus==='sem_quorum_abertura'){
    btn.style.display='none'; return;
  }
  btn.style.display='';
  const cnt=countAtivos(); const temQ=cnt>=Q_DELIB;
  btn.className=`foto-btn mt4 mb8${temQ?'':' sem-quorum'}`;
  btn.innerHTML=`📸 Registrar Presenças e ${temQ?'Iniciar Ordem do Dia':'Verificar Quórum Insuficiente para OD'}<br><small style="font-weight:400">${cnt}/${Q_DELIB} mínimos para deliberação</small>`;
}

function checkQuorumOD(){
  const alerta=document.getElementById('alerta-quorum-od');
  if(!alerta)return;
  const cnt=countAtivos();
  if(S.fotoOrdemDiaTs&&cnt<Q_DELIB){alerta.classList.add('show');}
  else{alerta.classList.remove('show');}
}

// ═══════════════════════════════════════════════════════════
// SECTION TOGGLE
// ═══════════════════════════════════════════════════════════
function toggleSec(id){
  const hdr=document.querySelector(`#sec-${id} .sec-hdr`);
  const body=document.getElementById(`body-${id}`);
  hdr.classList.toggle('open'); body.classList.toggle('open');
}

// ═══════════════════════════════════════════════════════════
// ABERTURA
// ═══════════════════════════════════════════════════════════
function renderAbertura(){
  const m=S.meeting?.metadados||{};
  const locked=!!S.fotoAberturaTs;
  const reg=regimental(m.hora_inicio);
  document.getElementById('body-abertura').innerHTML=`
    <div class="meta-grid">
      <div class="meta-item"><span>Comissão</span><strong>${m.comissao||'—'}</strong></div>
      <div class="meta-item"><span>Data</span><strong>${fmtData(m.data)||'—'}</strong></div>
      <div class="meta-item"><span>Local</span><strong>${m.local||'—'}</strong></div>
      <div class="meta-item"><span>Hora prevista</span><strong>${m.hora_inicio||'—'} · ${m.modalidade||''}</strong></div>
    </div>
    <hr class="divider">
    <div class="meta-edit-row">
      <div class="meta-edit-group">
        <label class="fld-lbl">Início efetivo</label>
        <input type="time" id="inp-inicio" value="${m.hora_inicio_efetiva||''}" ${locked?'disabled':''} onchange="S.meeting.metadados.hora_inicio_efetiva=this.value;autosave()">
        ${!locked?`<div class="time-btns">
          <button class="btn btn-ghost btn-xs" onclick="setInicio(now())">⏱ Agora</button>
          <button class="btn btn-ghost btn-xs" onclick="setInicio('${reg}')">⏱ ${reg} (regimental)</button>
        </div>`:''}
      </div>
      <div class="meta-edit-group">
        <label class="fld-lbl">Local efetivo</label>
        <input type="text" id="inp-local" value="${m.local_efetivo||m.local||''}" ${locked?'disabled':''} onchange="S.meeting.metadados.local_efetivo=this.value;autosave()" placeholder="${m.local||'Local...'}">
      </div>
    </div>
    <div class="meta-edit-group mb8">
      <label class="fld-lbl">Condução dos trabalhos</label>
      <select onchange="setCondutor(parseInt(this.value))" ${locked?'disabled':''} style="width:100%;max-width:400px">
        ${(S.meeting?.membros_comissao?[...S.meeting.membros_comissao.titulares,...S.meeting.membros_comissao.suplentes]:[]).map(id=>{
          const d=getDep(id);
          return`<option value="${d.id}" ${d.id==S.condutorId?'selected':''}>${d.nome} (${d.partido})</option>`;
        }).join('')}
      </select>
    </div>
    <hr class="divider">
    ${!S.fotoAberturaTs?`
      <div class="quorum-info small mb8" style="color:${countAtivos()>=Q_ABERTURA?'var(--green)':'var(--amber)'}">
        ${countAtivos()>=Q_ABERTURA
          ?`✅ ${countAtivos()} presentes — quórum de abertura atingido`
          :`⚠️ ${countAtivos()} presente${countAtivos()!==1?'s':''} — mínimo: ${Q_ABERTURA} para abrir`}
      </div>
      <button class="foto-btn" onclick="fotoAbertura()" id="btn-foto-abertura">
        📸 Registrar Presença e ${countAtivos()>=Q_ABERTURA?'Abrir Sessão':'Declarar Reunião sem Quórum'}
      </button>
    `:S.sessionStatus==='sem_quorum_abertura'?`
      <div class="foto-btn" style="background:var(--amber-lt);border-color:var(--amber);color:var(--amber);cursor:default">
        ⚠️ Presenças registradas sem quórum — ${S.fotoAberturaTs}
      </div>
      <div class="result-card vista mt8">
        <strong>Art. 59, §1º RI — Reunião declarada sem quórum</strong>
        <div class="small mt4">As presenças foram registradas. A <strong>Ata Declaratória</strong> está disponível na seção Encerramento.</div>
      </div>
    `:`
      <div class="foto-btn foto-done">
        📸 Abertura registrada — ${S.fotoAberturaTs} &nbsp;|&nbsp; ${countAtivos()} presentes
      </div>
    `}
  `;
}

function setInicio(h){
  S.meeting.metadados.hora_inicio_efetiva=h;
  document.getElementById('inp-inicio').value=h;
  autosave();
}

function fotoAbertura(){
  const cnt=countAtivos();
  const suficiente=cnt>=Q_ABERTURA;
  const ativos=getAtivos();
  // Sempre registra quem estava presente
  S.fotoAberturaTs=now();
  S.meeting.metadados.hora_inicio_efetiva=S.meeting.metadados.hora_inicio_efetiva||S.fotoAberturaTs;
  S.meeting.metadados.quorum.abertura.suficiente=suficiente;
  S.meeting.metadados.quorum.abertura.titulares=ativos.filter(id=>isTitular(id)).map(id=>{const d=getDep(id);return{id_assembleia:d.id,nome:d.nome,partido:d.partido};});
  S.meeting.metadados.quorum.abertura.suplentes=ativos.filter(id=>!isTitular(id)&&isMembro(id)).map(id=>{const d=getDep(id);return{id_assembleia:d.id,nome:d.nome,partido:d.partido};});
  S.meeting.metadados.quorum.abertura.visitantes=S.outros.map(o=>({nome:o.nome,instituicao:o.partido||''}));
  if(suficiente){
    S.sessionStatus='em-andamento';
    autosave(); renderAll();
    toast('Sessão aberta — quórum de abertura registrado.','success');
  } else {
    // Reunião não se realiza — Ata Declaratória
    S.sessionStatus='sem_quorum_abertura';
    autosave(); renderAll();
    toast(`Quórum insuficiente (${cnt} de ${Q_ABERTURA} mínimo). Gere a Ata Declaratória no Encerramento.`,'warn',6000);
    // Abre e rola até o encerramento
    setTimeout(()=>{
      const b=document.getElementById('body-enc');
      const h=document.querySelector('#sec-enc .sec-hdr');
      if(b&&!b.classList.contains('open')){b.classList.add('open');h?.classList.add('open');}
      document.getElementById('sec-enc')?.scrollIntoView({behavior:'smooth'});
    },400);
  }
}

// ═══════════════════════════════════════════════════════════
// ATAS
// ═══════════════════════════════════════════════════════════
function renderAtas(){
  const atas=S.meeting?.aprovacao_atas?.atas||[];
  if(!atas.length){document.getElementById('body-atas').innerHTML='<div class="empty">Nenhuma ata para deliberar.</div>';return;}
  const aberta=!!S.fotoAberturaTs;
  document.getElementById('body-atas').innerHTML=`
    ${!aberta?`<div class="badge badge-amber mb8" style="display:block;padding:6px 10px">⚠️ Sessão não iniciada — aguardando abertura oficial</div>`:''}
    <div class="row-between mb8">
      <span class="small muted">${atas.length} ata(s)</span>
      <button class="btn btn-success btn-sm" onclick="aprovarTodas()" ${!aberta?'disabled style="opacity:.4"':''}>✓ Aprovar todas</button>
    </div>
    ${atas.map((a,i)=>{
      const stBadge={aprovada:'badge-green',aprovada_com_ressalvas:'badge-green',rejeitada:'badge-red',nao_apreciada:'badge-amber',retirada:'badge-amber'};
      const stLabel={aprovada:'&#10003; Aprovada',aprovada_com_ressalvas:'&#10003; Com ressalvas',rejeitada:'&#10007; Rejeitada',nao_apreciada:'N&#xe3;o apreciada',retirada:'Retirada'};
      return `
      <div class="ata-row" style="flex-wrap:wrap;gap:6px">
        <div style="flex:1;min-width:0">
          <strong>Ata n&#xba; ${a.numero}</strong>
          <span class="muted small ml4">${a.tipo_reuniao||''}</span>
          ${a.reuniao_referencia?`<span class="muted small ml4">&middot; ${fmtData(a.reuniao_referencia)}</span>`:''}
        </div>
        <div class="row" style="gap:6px;align-items:center;flex-shrink:0">
          ${a.status?`<span class="badge ${stBadge[a.status]||'badge-gray'} small">${stLabel[a.status]||a.status}</span>`:''}
          <select onchange="if(!sessionOpen())return;S.meeting.aprovacao_atas.atas[${i}].status=this.value;autosave();renderAtas()" ${!aberta?'disabled':''}>
            <option value="">Aguardando...</option>
            <option value="aprovada" ${a.status==='aprovada'?'selected':''}>Aprovada</option>
            <option value="aprovada_com_ressalvas" ${a.status==='aprovada_com_ressalvas'?'selected':''}>Aprovada com ressalvas</option>
            <option value="rejeitada" ${a.status==='rejeitada'?'selected':''}>Rejeitada</option>
            <option value="nao_apreciada" ${a.status==='nao_apreciada'?'selected':''}>N&#xe3;o apreciada</option>
            <option value="retirada" ${a.status==='retirada'?'selected':''}>Retirada</option>
          </select>
          ${_fabBtn(`abrirFABAta(${i})`,a.ressalvas,'ata',i)}
        </div>
        ${a.status==='aprovada_com_ressalvas'?`<div class="small mt4" style="color:var(--blue);width:100%">💬 Use o botão ao lado para registrar a(s) ressalva(s).</div>`:''}
        </div>
      </div>`;
    }).join('')}
  `;
}

function aprovarTodas(){
  if(!sessionOpen())return;
  S.fabState={contexto:'Aprovação de Atas',target:null};
  (S.meeting?.aprovacao_atas?.atas||[]).forEach(a=>a.status='aprovada');
  autosave(); renderAtas();
}

// ═══════════════════════════════════════════════════════════
// EXPEDIENTE
// ═══════════════════════════════════════════════════════════
function renderExpediente(){
  const le=S.meeting?.leitura_expediente||{};
  let html='';

  // Correspondências
  const corr=le.correspondencias_recebidas||[];
  if(corr.length){
    html+=`<div class="sb-lbl" style="margin-top:0">Correspondências Recebidas</div>`;
    corr.forEach((c,i)=>{ html+=`
      <div class="exp-item ${c._lida?'done':''}">
        <div class="exp-item-hdr">
          <div>
            <div class="exp-item-title">${c.remetente}</div>
            <div class="exp-item-text">${c.mensagem}</div>
          </div>
          <div class="exp-item-actions">
            ${!c._lida?`<button class="btn btn-ghost btn-xs" onclick="marcarLida('corr',${i})">✓ Lida</button>`
              :`<span class="badge badge-green">✓ ${c._ts||''}</span>`}
            ${_fabBtn(`abrirFABCorr(${i})`,c.manifestacoes,'correspondencia',i)}
          </div>
        </div>
      </div>`;
    });
  }

  // Proposições recebidas
  const pr=le.proposicoes_recebidas||[];
  if(pr.length){
    html+=`<hr class="divider"><div class="sb-lbl">Proposições Recebidas</div>`;
    pr.forEach((p,i)=>{ html+=`
      <div class="exp-item ${p._anunciada?'done':''}">
        <div class="exp-item-hdr">
          <div>
            <div class="exp-item-title">${p.tipo} ${p.numero}/${p.ano}
              ${p.votacao_conclusiva?'<span class="badge badge-blue ml4">Tramitação Conclusiva</span>':''}
            </div>
            <div class="exp-item-text">${p.ementa}</div>
            <div class="small muted mt4">Proponente: ${propUI(p.proponente_principal)}</div>
          </div>
          <div class="exp-item-actions">
            ${!p._anunciada?`<button class="btn btn-ghost btn-xs" onclick="marcarLida('prop',${i})">✓ Anunciada</button>`
              :`<span class="badge badge-green">✓ ${p._ts||''}</span>`}
            ${_fabBtn(`abrirFABProp(${i})`,p.manifestacoes,'proposicao_recebida',i)}
          </div>
        </div>
      </div>`;
    });
  }

  // Proposições distribuídas (comunicadas nesta sessão)
  const pd=le.proposicoes_distribuidas||[];
  if(pd.length){
    html+=`<hr class="divider"><div class="sb-lbl">Proposições Distribuídas</div>`;
    pd.forEach((p,i)=>{ html+=`
      <div class="exp-item ${p._anunciada?'done':''}">
        <div class="exp-item-hdr">
          <div>
            <div class="exp-item-title">${p.tipo} ${p.numero}/${p.ano}</div>
            <div class="exp-item-text">${p.ementa}</div>
            <div class="small muted mt4">Proponente: ${propUI(p.proponente_principal)}
              ${p.relator?` · Relator: ${p.relator.nome} (${p.relator.partido||''})` : ''}
              ${p.data_distribuicao?` · Distribuído em: ${fmtData(p.data_distribuicao)}`:''}
            </div>
          </div>
          <div class="exp-item-actions">
            ${!p._anunciada?`<button class="btn btn-ghost btn-xs" onclick="marcarLida('prop-dist',${i})">✓ Anunciada</button>`
              :`<span class="badge badge-green">✓ ${p._ts||''}</span>`}
            ${_fabBtn(`abrirFABPropDist(${i})`,p.manifestacoes,'proposicao_distribuida',i)}
          </div>
        </div>
      </div>`;
    });
  }

  // Matérias a distribuir
  const md=le.materias_a_distribuir||[];
  if(md.length){
    html+=`<hr class="divider"><div class="sb-lbl">Matérias a Distribuir</div>`;
    md.forEach((m2,i)=>{
      // Titulares apenas (suplente não relata). O impedido NÃO some: fica
      // visível e desabilitado, com o motivo — padrão do pedido de vista (F5).
      const _b=bancadaImpedidaDe(m2).sigla;
      const _tit=(S.meeting?.membros_comissao?.titulares||[]);
      const _imp=id=>{const p=getDep(id).partido;return !!(_b&&p&&String(p).toUpperCase()===String(_b).toUpperCase());};
      const deps=_tit.filter(id=>!_imp(id));
      const depsImp=_tit.filter(_imp);
      const distFeita=!!(m2.relator||m2.relator_designado);
      html+=`
      <div class="exp-item ${distFeita?'done':''}">
        <div class="exp-item-hdr">
          <div>
            <div class="exp-item-title">${m2.tipo} ${m2.numero}/${m2.ano}
              ${m2.bancada_impedida?`<span class="badge badge-amber ml4">Impedida: ${m2.bancada_impedida}</span>`:''}
            </div>
            <div class="exp-item-text">${m2.ementa}</div>
            <div class="small muted mt4">Proponente: ${m2.proponente_principal?propUI(m2.proponente_principal):(m2.proponente||'—')}</div>
            ${sugestaoRelatorId(m2.sugestao_relatoria)?`<div class="small mt4" style="color:var(--blue)">Sugestão: ${getDep(sugestaoRelatorId(m2.sugestao_relatoria)).nome}</div>`:''}
          </div>
        </div>
        ${!distFeita?`
        <div class="dist-select-row">
          <select id="dist-dep-${i}">
            <option value="">— Selecionar relator —</option>
            ${deps.map(id=>{const d=getDep(id);const sug=sugestaoRelatorId(m2.sugestao_relatoria)==d.id;return`<option value="${d.id}" ${sug?'selected':''}>${d.nome} (${d.partido})${sug?' ★ sugestão':''}</option>`;}).join('')}
            ${depsImp.length?`<optgroup label="Impedidos">${depsImp.map(id=>{const d=getDep(id);return`<option value="${d.id}" disabled style="color:var(--gray-400)">${d.nome} (${d.partido}) — bancada do proponente</option>`;}).join('')}</optgroup>`:''}
          </select>
          <div class="dist-forma">
            <label><input type="radio" name="dist-forma-${i}" value="preferencia"> Por preferência</label>
            <label><input type="radio" name="dist-forma-${i}" value="grade"> Pela grade</label>
          </div>
          <button class="btn btn-primary btn-sm" onclick="confirmarRelator(${i})">✓ Confirmar</button>
        </div>`:`
        <div class="mt8 small"><strong>Relator:</strong> ${getDep((m2.relator||m2.relator_designado||{}).id_assembleia).nome}
          — ${((m2.forma_escolha_relator||m2.forma_designacao)==='preferencia')?'por preferência':'pela grade'}
          <span class="muted">(${m2._ts||''})</span>
        </div>`}
      </div>`;
    });
  }

  if(!html)html='<div class="empty">Nenhum item de expediente.</div>';
  document.getElementById('body-exp').innerHTML=html;
}

// ═══════════════════════════════════════════════════════════
// CONHECIMENTO DE MATÉRIAS DA ALÇADA DA COMISSÃO
// ═══════════════════════════════════════════════════════════
function renderConhecimento(){
  const km=S.meeting?.conhecimento_materias||{};
  let html='';

  // Informativos
  const info=km.informativos||[];
  if(info.length){
    html+=`<div class="sb-lbl" style="margin-top:0">Informativos</div>`;
    info.forEach((inf,i)=>{ html+=`
      <div class="exp-item ${inf._anunciado?'done':''}">
        <div class="exp-item-hdr">
          <div class="exp-item-text">${inf.texto}</div>
          <div class="exp-item-actions">
            ${!inf._anunciado?`
              <button class="btn btn-ghost btn-xs" onclick="marcarLida('info',${i})">✓ Anunciado</button>
              <button class="btn btn-ghost btn-xs" onclick="marcarLida('info-aprov',${i})">✓ Aprovado s/ objeção</button>
              ${_fabBtn(`abrirFABInfo(${i})`,inf.manifestacoes,'informativo',i)}
            `:`<span class="badge badge-green">✓ ${inf._ts||''}</span>
               ${inf._aprovado_sem_objecao?'<span class="badge badge-gray">Aprovado</span>':''}
               ${_fabBtn(`abrirFABInfo(${i})`,inf.manifestacoes,'informativo',i)}`}
          </div>
        </div>
      </div>`;
    });
  }

  // Requerimentos Diversos (RDI) para conhecimento
  const rdis=km.requerimentos_conhecimento||[];
  if(rdis.length){
    html+=`<hr class="divider"><div class="sb-lbl">Requerimentos para Conhecimento</div>`;
    rdis.forEach((r,i)=>{
      const titulo=`${r.tipo||'RDI'} n.º ${r.numero}/${r.ano}`;
      html+=`
      <div class="exp-item ${r._anunciado?'done':''}">
        <div class="exp-item-hdr">
          <div>
            <div class="exp-item-title">${titulo}</div>
            <div class="small muted mt2">Proponente: ${r.proponente||'—'}</div>
            <div class="exp-item-text">${r.ementa||''}</div>
          </div>
          <div class="exp-item-actions">
            ${!r._anunciado?`<button class="btn btn-ghost btn-xs" onclick="marcarLida('rdi',${i})">✓ Anunciado</button>
              ${_fabBtn(`abrirFABRdi(${i})`,r.manifestacoes,'requerimento_conhecimento',i)}`
              :`<span class="badge badge-green">✓ ${r._ts||''}</span>${_fabBtn(`abrirFABRdi(${i})`,r.manifestacoes,'requerimento_conhecimento',i)}`}
          </div>
        </div>
      </div>`;
    });
  }

  // Deliberativos administrativos
  const delib=km.deliberativos_administrativos||[];
  if(delib.length){
    html+=`<hr class="divider"><div class="sb-lbl">Deliberativos Administrativos</div>`;
    delib.forEach((d,i)=>{ html+=`
      <div class="exp-item ${d.resultado?'done':''}">
        <div class="exp-item-hdr">
          <div class="exp-item-text">${d.texto}</div>
          <div class="exp-item-actions">
            ${!d.resultado?`
              <button class="btn btn-success btn-xs" onclick="deliberarAdmin(${i},'aprovado')">✓ Aprovado</button>
              <button class="btn btn-danger btn-xs" onclick="deliberarAdmin(${i},'rejeitado')">✗ Rejeitado</button>
            `:`<span class="badge ${d.resultado==='aprovado'?'badge-green':'badge-red'}">${d.resultado==='aprovado'?'✓ Aprovado':'✗ Rejeitado'}</span>`}
            ${_fabBtn(`abrirFABDelib(${i})`,d.manifestacoes,'deliberativo_administrativo',i)}
          </div>
        </div>
      </div>`;
    });
  }

  // Audiências agendadas
  const aud=km.audiencias_agendadas||[];
  if(aud.length){
    html+=`<hr class="divider"><div class="sb-lbl">Audiências Agendadas</div>`;
    aud.forEach((a,i)=>{ html+=`
      <div class="exp-item ${a._anunciada?'done':''}">
        <div class="exp-item-hdr">
          <div>
            <div class="exp-item-title">${fmtData(a.data)} às ${a.hora} — ${a.local}</div>
            <div class="small muted mt2">Proponente: ${a.proponente||'—'}</div>
            <div class="exp-item-text">${a.pauta}</div>
          </div>
          <div class="exp-item-actions">
            ${!a._anunciada?`<button class="btn btn-ghost btn-xs" onclick="marcarLida('aud',${i})">✓ Anunciada</button>
              ${_fabBtn(`abrirFABAud(${i})`,a.manifestacoes,'audiencia',i)}`
              :`<span class="badge badge-green">✓</span>${_fabBtn(`abrirFABAud(${i})`,a.manifestacoes,'audiencia',i)}`}
          </div>
        </div>
      </div>`;
    });
  }

  if(!html)html='<div class="empty">Sem matérias de conhecimento.</div>';
  document.getElementById('body-cm').innerHTML=html;
}

function marcarLida(tipo,i){
  if(!sessionOpen())return;
  const ts=now();
  const le=S.meeting.leitura_expediente||{};
  const km=S.meeting.conhecimento_materias||{};
  if(tipo==='corr'){const c=le.correspondencias_recebidas[i];c._lida=true;c._ts=ts;S.fabState={contexto:`Correspondência — ${(c.remetente||'').substring(0,40)}`,target:{tipo:'correspondencia',idx:i}};autosave();renderExpediente();}
  else if(tipo==='prop'){const p=le.proposicoes_recebidas[i];p._anunciada=true;p._ts=ts;S.fabState={contexto:`Proposição — ${p.tipo} ${p.numero}/${p.ano}`,target:{tipo:'proposicao_recebida',idx:i}};autosave();renderExpediente();}
  else if(tipo==='prop-dist'){const p=le.proposicoes_distribuidas[i];p._anunciada=true;p._ts=ts;S.fabState={contexto:`Proposição Distribuída — ${p.tipo} ${p.numero}/${p.ano}`,target:{tipo:'proposicao_distribuida',idx:i}};autosave();renderExpediente();}
  else if(tipo==='info'){const inf=km.informativos[i];inf._anunciado=true;inf._ts=ts;S.fabState={contexto:`Conhecimento de Matérias — Informativo: ${(inf.texto||'').substring(0,40)}`,target:{tipo:'informativo',idx:i}};autosave();renderConhecimento();}
  else if(tipo==='info-aprov'){const inf=km.informativos[i];inf._anunciado=true;inf._aprovado_sem_objecao=true;inf._ts=ts;S.fabState={contexto:`Conhecimento de Matérias — Informativo: ${(inf.texto||'').substring(0,40)}`,target:{tipo:'informativo',idx:i}};autosave();renderConhecimento();}
  else if(tipo==='aud'){const a=km.audiencias_agendadas[i];a._anunciada=true;S.fabState={contexto:`Conhecimento de Matérias — Audiência ${a.data} ${a.hora}`,target:{tipo:'audiencia',idx:i}};autosave();renderConhecimento();}
  else if(tipo==='rdi'){const r=km.requerimentos_conhecimento[i];r._anunciado=true;r._ts=ts;S.fabState={contexto:`Conhecimento de Matérias — ${r.tipo||'RDI'} ${r.numero}/${r.ano}`,target:{tipo:'requerimento_conhecimento',idx:i}};autosave();renderConhecimento();}
}

function deliberarAdmin(i,resultado){
  if(!sessionOpen())return;
  const d=S.meeting.conhecimento_materias.deliberativos_administrativos[i];
  d.resultado=resultado;
  S.fabState={contexto:`Conhecimento de Matérias — Deliberativo: ${(d.texto||'').substring(0,40)}`,target:{tipo:'deliberativo_administrativo',idx:i}};
  autosave(); renderConhecimento();
  toast(resultado==='aprovado'?'Aprovado.':'Rejeitado.',resultado==='aprovado'?'success':'warn');
}

function confirmarRelator(i){
  if(!sessionOpen())return;
  S.fabState={contexto:'Expediente — Distribuição de Relatoria',target:null};
  const depId=parseInt(document.getElementById(`dist-dep-${i}`).value);
  if(!depId){toast('Selecione um relator.','warn');return;}
  const forma=document.querySelector(`input[name="dist-forma-${i}"]:checked`)?.value||'preferencia';
  const d=getDep(depId);
  const m2=S.meeting.leitura_expediente.materias_a_distribuir[i];
  m2.relator={id_assembleia:d.id,nome:d.nome,partido:d.partido};
  m2.forma_escolha_relator=forma;
  m2.data_distribuicao=S.meeting?.metadados?.data||null;
  m2._ts=now();
  autosave(); renderExpediente(); toast('Relator confirmado.','success');
}

// ═══════════════════════════════════════════════════════════
// ORDEM DO DIA
// ═══════════════════════════════════════════════════════════
function renderOrdemDoDia(){
  const od=S.meeting?.ordem_do_dia||[];
  let html='';

  // Foto OD — só mostra se há itens na pauta
  if(od.length){
    if(!S.fotoOrdemDiaTs){
      const temQ=countAtivos()>=Q_DELIB;
      html+=`<button id="btn-foto-od" class="foto-btn mt4 mb8${temQ?'':' sem-quorum'}" onclick="fotoOrdemDia()">
        📸 Registrar Presenças e ${temQ?'Iniciar Ordem do Dia':'Verificar Quórum Insuficiente para OD'}
        <br><small style="font-weight:400">${countAtivos()}/${Q_DELIB} mínimos para deliberação</small>
      </button>`;
    } else {
      html+=`<div class="foto-btn foto-done mb8">📸 Ordem do Dia registrada — ${S.fotoOrdemDiaTs}</div>`;
    }
    // Alerta quórum insuficiente
    html+=`<div id="alerta-quorum-od" class="${S.fotoOrdemDiaTs&&countAtivos()<Q_DELIB?'show':''}">
      <span style="color:var(--red);font-weight:700">⚠️ Quórum insuficiente para deliberação</span>
      <button class="btn btn-danger btn-sm" onclick="encerrarOD()">Encerrar Ordem do Dia</button>
    </div>`;
  }

  if(!od.length){html+='<div class="empty">Sem itens na ordem do dia.</div>';}

  S.odOrdem.forEach(idx=>{
    const item=od[idx];
    if(!item)return;
    html+=renderOdCard(item,idx);
  });

  document.getElementById('body-od').innerHTML=html;
}

function renderOdCard(item,idx){
  ensureExecucao(item);
  const ex=item.execucao;
  const fase=S.odFases[item.id];
  const isAtivo=ex.status==='em_deliberacao';
  const isTerminal=ex.status&&ex.status!=='em_deliberacao'&&ex.status!==null;
  const condutorId=S.condutorId;
  // Relator EXTERNO (ex.: RELSUB): tem nome mas id_assembleia null → o sistema NÃO
  // consegue rastrear presença (ele fica em "Outros/visitantes", sem vínculo de ID).
  // Presença indeterminada: oferecemos ao secretário a decisão manual (botão ausente),
  // em vez de assumir "presente" e mostrar só "Iniciar".
  const relatorExterno=!!(item.relator && item.relator.nome && !item.relator.id_assembleia);
  const relatorPresente=!item.relator||(!relatorExterno && !isDeputadoAusente(item.relator.id_assembleia));

  // Badges
  let badges='';
  if(item.eleicao)badges+=`<span class="badge badge-amber">⚑ Eleição de ${item.cargo_eleicao||'cargo'}</span> `;
  if(item.tipo==='RELSUB')badges+=`<span class="badge badge-gray">Relatório de Subcomissão</span> `;
  if(item.tipo==='REQSUB')badges+=`<span class="badge badge-gray">Requerimento de Subcomissão</span> `;
  if(getConclus(item)){
    const fb=isFaseB(item);
    badges+=`<span class="badge badge-blue">${fb?'Votação Conclusiva':'Tramitação Conclusiva'}</span> `;
  }
  if(getMaiSimples(item)&&!item.eleicao)badges+=`<span class="badge badge-amber">Maioria Simples</span> `;
  if((item.pedidos_de_vista_anteriores||[]).length)badges+=`<span class="badge badge-gray">Vista: ${item.pedidos_de_vista_anteriores.map(v=>v.partido||v.deputado?.partido).filter(Boolean).join(', ')}</span> `;
  if(item.execucao.relatorio_lido&&!item.relatorio_lido_em)badges+=`<span class="badge badge-green small">Relatório lido</span> `;
  if(item.relatorio_lido_em)badges+=`<span class="badge badge-gray small">Rel. lido em ${fmtData(item.relatorio_lido_em)}</span> `;
  if(item.execucao.eleito){
    const jaAprovado=ex.status==='aprovado';
    badges+=`<span class="badge ${jaAprovado?'badge-green':'badge-amber'}">${jaAprovado?'✓ Eleito':'→ Indicado'}: ${item.execucao.eleito.nome}</span> `;
  }

  // Status badge
  let statusBadge='';
  if(isTerminal){
    const map={aprovado:'badge-green',aprovado_parecer_conclusivo:'badge-blue',rejeitado:'badge-red',
      inconclusivo:'badge-red',vista:'badge-amber',reexame:'badge-amber',relator_ausente:'badge-amber',
      retirada_de_pauta:'badge-gray',falta_quorum:'badge-red'};
    const lbl={aprovado:'✓ Aprovado',aprovado_parecer_conclusivo:'✓ Parecer aprovado — retorna',
      rejeitado:'✗ Rejeitado',inconclusivo:'~ Inconclusivo',vista:'👁 Vista',reexame:'↩ Reexame',
      relator_ausente:'Relator ausente',retirada_de_pauta:'Retirado',falta_quorum:'Falta de quórum'};
    statusBadge=`<span class="badge ${map[ex.status]||'badge-gray'}">${lbl[ex.status]||ex.status}</span>`;
  }

  // Fases que ainda precisam mostrar o painel de deliberação mesmo com status terminal
  const fasePainel=['redistribuicao','minerva','vista-form','eleicao-result','reqsub-membros'];
  const emPainel=fasePainel.includes(fase)||!!(fase&&fase.startsWith('faseb-'));

  // Ação principal (botão direito do card)
  let cardAction='';
  if(!S.fotoOrdemDiaTs){
    cardAction=`<span class="small muted">Aguardando foto OD</span>`;
  } else if(isTerminal && !emPainel){
    cardAction=statusBadge;
  } else if(!isAtivo && !emPainel){
    if(!relatorPresente && TIPOS_RELATOR.includes(item.tipo)){
      cardAction=`<button class="btn btn-amber btn-sm" onclick="alertaRelatorAusente('${item.id}')">⚠ Relator ausente</button>`;
    } else {
      cardAction=`<button class="btn btn-primary btn-sm" onclick="iniciarItem('${item.id}')">▶ Iniciar</button>`;
    }
  } else {
    cardAction=`<span class="badge badge-blue">Em deliberação</span>`;
  }

  // Reordenação (só se pendente e não em painel)
  const ordemAtual=S.odOrdem.indexOf(idx)+1;
  const posInput=(!isAtivo&&!isTerminal&&!emPainel)?`<input type="number" class="od-pos-input" value="${ordemAtual}" min="1" max="${S.odOrdem.length}" onchange="reordenar(${idx},parseInt(this.value))" title="Reordenar">`:
    `<div class="od-card-pos">${ordemAtual}</div>`;

  let bodyHtml='';

  // Corpo do card: painel de deliberação (inclui fases intermediárias pós-apuração)
  if(isAtivo || emPainel){
    const faseB=isFaseB(item)||(fase&&fase.startsWith('faseb-'));
    bodyHtml=`<div class="od-card-body">${faseB?renderPainelFaseB(item):renderPainelDeliberacao(item)}</div>`;
  } else if(isTerminal){
    bodyHtml=renderResultadoCard(item);
  }

  return `
  <div class="od-card ${(isAtivo||emPainel)?'active':''}" id="od-card-${item.id}">
    <div class="od-card-hdr">
      ${posInput}
      <div class="od-card-info">
        <div class="od-card-tipo">${item.tipo} ${item.numero}/${item.ano}</div>
        <div class="od-card-ementa">${item.ementa}</div>
        ${item.proponente_principal?.nome?`<div class="small muted">Proponente: ${propUI(item.proponente_principal)}</div>`:''}
        ${item.relator?`<div class="od-card-relator">Relator: <strong>${item.relator.nome}</strong>${item.parecer?` · Parecer: ${parecerLabel(item.parecer)}`:''}</div>`:''}
        ${isFaseB(item)&&(item.pareceres_anteriores||[]).length?`<div class="small" style="color:var(--blue);margin-top:2px">Pareceres anteriores: ${item.pareceres_anteriores.map(p=>`${(p.comissao||'').replace(/\s*\(Fase [AB]\)/i,'').trim()}: <em>${parecerLabel(p.parecer)}</em> (${p.relator})`).join(' · ')}</div>`:''}
        ${item.tipo==='RAP'&&(item.local||item.modalidade)? `<div class="small muted">📍 ${[item.local,item.modalidade&&item.modalidade!=='presencial'?'('+item.modalidade+')':''].filter(Boolean).join(' ')}</div>`:''}
        ${item.tipo==='RAP'&&(item.convidados||[]).length?`<details style="margin-top:4px"><summary class="small" style="cursor:pointer;color:var(--blue)">👥 ${item.convidados.length} convidado${item.convidados.length!==1?'s':''}</summary><ul style="margin:4px 0 0 16px;padding:0">${(item.convidados||[]).map(c=>`<li class="small muted">${c}</li>`).join('')}</ul></details>`:''}
        ${item.tipo==='RELSUB'&&item.data_aprovacao_subcomissao?`<div class="small muted">📋 Subcomissão aprovada em ${fmtData(item.data_aprovacao_subcomissao)}${item.req_criacao?`, através do ${item.req_criacao}`:''}</div>`:''}
        ${item.tipo==='RELSUB'&&(item.demais_integrantes||[]).length?`<div class="small muted">👥 Demais integrantes: ${item.demais_integrantes.map(m=>m.nome||m).join('; ')}</div>`:''}
        <div class="mt4">${badges}</div>
      </div>
      <div class="od-card-actions">
        ${cardAction}
        ${_fabBtn(`abrirFABOD('${item.id}')`,item.manifestacoes,'od',idx)}
      </div>
    </div>
    ${bodyHtml}
  </div>`;
}

function alertaRelatorAusente(itemId){
  const item=getOdItem(itemId);
  const nm=item?.relator?.nome||'Relator';
  const externo=!!(item?.relator && item.relator.nome && !item.relator.id_assembleia);
  const titulo = externo ? '⚠️ Confirmar presença do relator' : '⚠️ Relator não está presente';
  const msg = externo
    ? `${nm} é relator externo à comissão, então sua presença não é rastreada automaticamente. Confirme como prosseguir:`
    : `${nm} não está registrado como presente na sessão. Como deseja prosseguir?`;
  showModal(
    titulo,
    msg,
    [
      {label:'▶ Iniciar deliberação mesmo assim', cls:'btn-primary',
        action:()=>iniciarItem(itemId)},
      {label:'⏸ Registrar como relator ausente (postergar)', cls:'btn-amber',
        action:()=>encerrarItem(itemId,'relator_ausente')},
      {label:'Cancelar', cls:'btn-ghost', action:()=>{}},
    ]
  );
}

function iniciarItem(itemId){
  if(!sessionOpen())return;
  if(!S.fotoOrdemDiaTs){toast('Trave o quórum da Ordem do Dia primeiro (📸).','warn');return;}
  const item=getOdItem(itemId);
  if(!item)return;
  const odIdx=S.meeting.ordem_do_dia.findIndex(i=>i.id===itemId);
  S.fabState={contexto:`Ordem do Dia — ${item.tipo} ${item.numero}/${item.ano}`,target:{tipo:'od',idx:odIdx}};
  ensureExecucao(item);
  item.execucao.status='em_deliberacao';
  item.execucao.hora_inicio_apreciacao=now();
  // Fase B: conclusiva sem relator → votação definitiva do PL
  if(isFaseB(item)){
    S.odFases[item.id]='faseb-discussao';
  } else {
    const temRelatorio=TIPOS_RELATOR.includes(item.tipo);
    const relatorioJaLido=item.execucao.relatorio_lido||!!item.relatorio_lido_em;
    S.odFases[item.id]=temRelatorio&&!relatorioJaLido?'relatorio':'discussao';
  }
  autosave(); renderOrdemDoDia();
}

function renderPainelDeliberacao(item){
  const fase=S.odFases[item.id]||'discussao';
  const temRelatorio=TIPOS_RELATOR.includes(item.tipo);
  const relatorioJaLido=item.execucao.relatorio_lido||!!item.relatorio_lido_em;
  const permiteVista=TIPOS_VISTA.includes(item.tipo);

  const fases=['relatorio','discussao','encaminhamentos','votacao'];
  const faseIdx=fases.indexOf(fase);

  // Phase indicator
  let phaseHtml=`<div class="phase-indicator">`;
  if(temRelatorio){
    const st=relatorioJaLido||faseIdx>0?'done':fase==='relatorio'?'active':'';
    phaseHtml+=`<span class="phase-step ${st}">1. Relatório</span>`;
  }
  ['discussao','encaminhamentos','votacao'].forEach((f,i)=>{
    const n=temRelatorio?i+2:i+1;
    const lbl=['Discussão','Encaminhamentos','Votação'][i];
    const st=faseIdx>fases.indexOf(f)?'done':fase===f?'active':'';
    phaseHtml+=`<span class="phase-step ${st}">${n}. ${lbl}</span>`;
  });
  phaseHtml+=`</div>`;

  // Botões de ação regimental (disponíveis antes de votar)
  let regBtns='';
  if(fase!=='votacao'){
    regBtns=`<div class="row mb8" style="flex-wrap:wrap;gap:6px">`;
    if(permiteVista)regBtns+=`<button class="btn btn-ghost btn-xs" onclick="abrirVista('${item.id}')">👁 Pedido de Vista</button>`;
    if(item.relator)regBtns+=`<button class="btn btn-ghost btn-xs" onclick="encerrarItem('${item.id}','reexame')">↩ Reexame (relator)</button>`;
    regBtns+=`<button class="btn btn-ghost btn-xs" onclick="encerrarItem('${item.id}','retirada_de_pauta')">✕ Retirar de pauta</button>
      <button class="btn btn-ghost btn-xs" onclick="fecharPainel('${item.id}')">⏸ Recolher painel</button>`;
    regBtns+=`</div>`;
  }

  let conteudo='';

  // Painel de indicação de candidato (eleição de presidente/vice)
  const todosT=(S.meeting?.membros_comissao?.titulares||[]).map(id=>getDep(id)).filter(d=>d.nome);
  const painelIndicacao = item.eleicao && ['discussao','encaminhamentos'].includes(fase) ? `
    <div class="mt8 mb8" style="background:var(--amber-lt);border:1px solid var(--amber);border-radius:6px;padding:10px">
      <label class="fld-lbl">⚑ Deputado indicado para ${item.cargo_eleicao||'cargo'}</label>
      <div class="row mt4">
        <select id="eleito-sel-${item.id}" onchange="setEleito('${item.id}',parseInt(this.value)||null)" style="flex:1;max-width:360px">
          <option value="">— Selecionar indicado —</option>
          ${todosT.map(d=>{const sel=item.execucao.eleito?.id_assembleia==d.id?'selected':'';return`<option value="${d.id}" ${sel}>${d.nome} (${d.partido||''})</option>`;}).join('')}
        </select>
        ${item.execucao.eleito?`<span class="badge badge-amber">→ Indicado: ${item.execucao.eleito.nome}</span>`:''}
      </div>
    </div>` : '';

  if(fase==='eleicao-result'){
    const el=item.execucao.eleito;
    conteudo=`<div class="result-card aprovado mt8">
      <strong>✓ Eleição aprovada</strong>
      ${el?`— Eleito: <strong>${el.nome} (${el.partido})</strong>`:''}
    </div>
    ${!el?`<div class="mt8">
      <label class="fld-lbl">Registrar deputado eleito</label>
      <div class="row mt4">
        <select id="eleito-final-${item.id}" style="flex:1;max-width:360px">
          <option value="">— Selecionar —</option>
          ${todosT.map(d=>`<option value="${d.id}">${d.nome} (${d.partido||''})</option>`).join('')}
        </select>
        <button class="btn btn-success btn-sm" onclick="setEleito('${item.id}',parseInt(document.getElementById('eleito-final-${item.id}').value))">✓ Confirmar</button>
      </div>
    </div>`:''}`;
  } else if(fase==='reqsub-membros'){
    const membros=item.membros||[];
    const nMembros=membros.length;
    const podeConfirmar=nMembros>=2;
    conteudo=`<div class="result-card aprovado mt8 mb8"><strong>✓ REQSUB aprovado — designar membros da subcomissão</strong></div>
    <div class="small muted mb8">Selecione os membros titulares (mínimo 2 além do proponente). Selecionados: <strong>${nMembros}</strong></div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:12px">
      ${todosT.map(d=>{const sel=membros.some(m=>m.id_assembleia==d.id);return`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:4px;border-radius:4px;background:${sel?'var(--green-lt)':'var(--gray-50)'}"><input type="checkbox" ${sel?'checked':''} onchange="toggleMembroReqsub('${item.id}',${d.id})"> ${d.nome} (${d.partido||''})</label>`;}).join('')}
    </div>
    <button class="btn btn-success btn-sm" ${podeConfirmar?'':'disabled title="Selecione pelo menos 2 membros"'} onclick="confirmMembroReqsub('${item.id}')">
      ✓ Confirmar membros e encerrar ${podeConfirmar?`(${nMembros} selecionados)`:'— mín. 2'}
    </button>`;
  } else if(fase==='relatorio'){
    conteudo=`<div class="mt8">
      <p class="small muted mb8">Passe a palavra ao relator para a leitura do relatório.</p>
      <button class="btn btn-success btn-sm" onclick="marcarRelatorioLido('${item.id}')">✓ Relatório lido em voz alta</button>
    </div>`;
  } else if(fase==='discussao'){
    conteudo=`${painelIndicacao}<div class="mt8">
      <p class="small muted mb8">Período de discussão aberto. Use 💬 para registrar manifestações.</p>
      <button class="btn btn-primary btn-sm" onclick="avancarFase('${item.id}','encaminhamentos')">✓ Encerrar discussão</button>
    </div>`;
  } else if(fase==='encaminhamentos'){
    conteudo=`${painelIndicacao}<div class="mt8">
      <p class="small muted mb8">Período de encaminhamentos aberto.</p>
      <button class="btn btn-primary btn-sm" onclick="avancarFase('${item.id}','votacao')">✓ Encerrar encaminhamentos → Votação</button>
    </div>`;
  } else if(fase==='votacao'){
    conteudo=renderUrna(item);
  } else if(fase==='minerva'){
    conteudo=renderMinerva(item);
  } else if(fase==='redistribuicao'){
    conteudo=renderRedistribuicao(item);
  } else if(fase==='vista-form'){
    conteudo=renderVistaForm(item);
  }

  return phaseHtml+regBtns+conteudo;
}

function marcarRelatorioLido(itemId){
  const item=getOdItem(itemId); if(!item)return;
  item.execucao.relatorio_lido=true;
  S.odFases[itemId]='discussao';
  autosave(); renderOrdemDoDia();
}

function avancarFase(itemId,novaFase){
  S.odFases[itemId]=novaFase;
  autosave(); renderOrdemDoDia();
}

function fecharPainel(itemId){
  const item=getOdItem(itemId); if(!item)return;
  item.execucao.status=null;
  S.odFases[itemId]=null;
  autosave(); renderOrdemDoDia();
}

// ── URNA ──
// ═══════════════════════════════════════════════════════════
// FASE B — Votação conclusiva definitiva
// ═══════════════════════════════════════════════════════════

function renderPainelFaseB(item){
  const id=item.id;
  const fase=S.odFases[id]||'faseb-discussao';
  const emendas=item.emendas||[];
  const nEm=emendas.length;

  // Indicador de progresso Fase B
  const steps=['Discussão'];
  emendas.forEach((e,i)=>steps.push(`Emenda ${i+1}`));
  steps.push('Votação do PL');
  if(nEm>0)steps.push('Redação Final');

  function stepState(label,idx){
    const activeIdx=
      fase==='faseb-discussao'?0:
      fase.startsWith('faseb-enc-emenda-')||fase.startsWith('faseb-vot-emenda-')?
        1+parseInt(fase.replace(/faseb-(enc|vot)-emenda-/,'')): // emenda N → step 1+N
      fase==='faseb-enc-pl'||fase==='faseb-pl'?nEm+1:
      fase==='faseb-redacao'?nEm+2:nEm+2;
    return idx<activeIdx?'done':idx===activeIdx?'active':'';
  }

  let phaseHtml=`<div class="phase-indicator">`;
  steps.forEach((s,i)=>phaseHtml+=`<span class="phase-step ${stepState(s,i)}">${s}</span>`);
  phaseHtml+=`</div>`;

  // Pareceres anteriores exibidos no cabeçalho do card (od-card-hdr, linha isFaseB)
  let parAnt='';

  // Botão retirar disponível durante discussão
  const regBtns=fase==='faseb-discussao'?`<div class="row mb8" style="gap:6px">
    <button class="btn btn-ghost btn-xs" onclick="encerrarItem('${id}','retirada_de_pauta')">✕ Retirar de pauta</button>
    <button class="btn btn-ghost btn-xs" onclick="fecharPainel('${id}')">⏸ Recolher painel</button>
  </div>`:'';

  let conteudo='';

  if(fase==='faseb-discussao'){
    const descEm=nEm?`<div class="small mt4"><strong>${nEm} emenda${nEm>1?'s':''}:</strong> ${emendas.map((e,i)=>`(${i+1}) ${e.descricao||'Sem descrição'}`).join('; ')}</div>`:'<div class="small muted mt4">Sem emendas — votação direta do PL.</div>';
    conteudo=`${parAnt}
      <p class="small muted mb4">Discussão conjunta do PL${nEm?` e da${nEm>1?'s':''} emenda${nEm>1?'s':''}`:''} (5 min)</p>
      ${descEm}
      <div class="row mt12" style="gap:8px">
        <button class="btn btn-primary btn-sm" onclick="avancarFaseB('${id}')">✓ Encerrar discussão</button>
      </div>`;

  } else if(fase.startsWith('faseb-enc-emenda-')){
    const idx=parseInt(fase.replace('faseb-enc-emenda-',''));
    const em=emendas[idx]||{};
    conteudo=`${parAnt}
      <div class="result-card" style="background:var(--gray-100)">
        <strong>Emenda nº ${idx+1}</strong>
        ${em.descricao?`<div class="small mt4">${em.descricao}</div>`:''}
      </div>
      <p class="small muted mt8">Encaminhamentos da emenda (5 min)</p>
      <button class="btn btn-primary btn-sm mt8" onclick="avancarFaseB('${id}')">✓ Passar à votação da emenda ${idx+1}</button>`;

  } else if(fase.startsWith('faseb-vot-emenda-')){
    const idx=parseInt(fase.replace('faseb-vot-emenda-',''));
    const em=emendas[idx]||{};
    conteudo=`${parAnt}
      <div class="result-card" style="background:var(--gray-100);margin-bottom:8px">
        <strong>Votação — Emenda nº ${idx+1}</strong>
        ${em.descricao?`<div class="small mt2">${em.descricao}</div>`:''}
      </div>
      ${renderUrnaEmenda(item,idx)}`;

  } else if(fase==='faseb-enc-pl'){
    // Mostrar resultados das emendas votadas
    const resEm=nEm?`<div class="small mb8">${emendas.map((e,i)=>`Emenda ${i+1}: <strong class="${e.resultado==='aprovada'?'ok':'bad'}">${e.resultado==='aprovada'?'Aprovada':'Rejeitada'}</strong>`).join(' · ')}</div>`:'';
    conteudo=`${parAnt}${resEm}
      <p class="small muted">Encaminhamentos do Projeto de Lei (5 min)</p>
      <button class="btn btn-primary btn-sm mt8" onclick="avancarFaseB('${id}')">✓ Passar à votação do PL</button>`;

  } else if(fase==='faseb-pl'){
    const resEm=nEm?`<div class="small mb8">${emendas.map((e,i)=>`Emenda ${i+1}: <strong class="${e.resultado==='aprovada'?'ok':'bad'}">${e.resultado==='aprovada'?'Aprovada':'Rejeitada'}</strong>`).join(' · ')}</div>`:'';
    conteudo=`${parAnt}${resEm}<div class="mt4"><strong>Votação do Projeto de Lei</strong></div>${renderUrnaFaseB(item)}`;

  } else if(fase==='faseb-redacao'){
    const ex=item.execucao;
    const favs=(ex.votos_favoraveis||[]).map(v=>v.nome).sort((a,b)=>a.localeCompare(b));
    const cons=(ex.votos_contrarios||[]).map(v=>v.nome).sort((a,b)=>a.localeCompare(b));
    const resEm=nEm?`<div class="small mb8">${emendas.map((e,i)=>`Emenda ${i+1}: <strong class="${e.resultado==='aprovada'?'ok':'bad'}">${e.resultado==='aprovada'?'Aprovada':'Rejeitada'}</strong>`).join(' · ')}</div>`:'';
    conteudo=`${parAnt}${resEm}
      <div class="result-card aprovado mb8">
        ✓ Projeto aprovado (${favs.length}F × ${cons.length}C)
      </div>
      <p class="small muted mb4">Redação final — os deputados que concordam permaneçam como estão.</p>
      <button class="btn btn-success btn-sm" onclick="confirmarRedacaoFinal('${id}')">✓ Aprovada por aclamação — Encerrar</button>`;
  }

  return phaseHtml+regBtns+conteudo;
}

function renderUrnaEmenda(item, emendaIdx){
  const em=item.emendas[emendaIdx]; if(!em)return'';
  em.votos_favoraveis=em.votos_favoraveis||[];
  em.votos_contrarios=em.votos_contrarios||[];
  const ativos=getAtivos();
  const condutorId=S.condutorId;
  const membros=S.meeting?.membros_comissao||{};
  const membroIds=[...(membros.titulares||[]),...(membros.suplentes||[])];
  const votantes=ativos.filter(id=>membroIds.includes(id));
  const vtSC=votantes.filter(id=>id!=condutorId);
  const condVota=votantes.includes(condutorId);
  const nF=em.votos_favoraveis.length, nC=em.votos_contrarios.length;

  const depRow=id=>{
    const d=getDep(id);
    const vF=em.votos_favoraveis.some(v=>v.id_assembleia==id);
    const vC=em.votos_contrarios.some(v=>v.id_assembleia==id);
    const cls=vF?'vf':vC?'vc':'';
    const isCond=id==condutorId;
    return `<div class="vote-dep-row ${cls} ${isCond?'condutor':''}">
      <span class="vote-dep-name">${d.nome}${isCond?' ★':''}</span>
      <span class="vote-dep-party">${d.partido}</span>
      <div class="vote-btns">
        <button class="vbtn vbtn-f ${vF?'sel':''}" onclick="registrarVotoEmenda('${item.id}',${emendaIdx},${id},'f')">F</button>
        <button class="vbtn vbtn-c ${vC?'sel':''}" onclick="registrarVotoEmenda('${item.id}',${emendaIdx},${id},'c')">C</button>
      </div>
    </div>`;
  };

  return `<div class="vote-placar mt8">
    <div><div class="vote-placar-num f">${nF}</div><div class="vote-placar-lbl">Fav.</div></div>
    <div><div class="vote-placar-num c">${nC}</div><div class="vote-placar-lbl">Cont.</div></div>
    <div style="margin-left:auto;font-size:12px;opacity:.7">${nF+nC}/${votantes.length} votaram</div>
  </div>
  <div class="vote-grid mt8">${vtSC.map(depRow).join('')}${condVota?depRow(condutorId):''}</div>
  <div class="row-between mt12">
    <span></span>
    <div class="row">
      <button class="btn btn-ghost btn-sm" onclick="avancarFaseBVoltar('${item.id}')">← Voltar</button>
      <button class="btn btn-primary btn-sm" onclick="apurarEmenda('${item.id}',${emendaIdx})">⚖ Apurar emenda</button>
    </div>
  </div>`;
}

function renderUrnaFaseB(item){
  // Urna para votação do PL em Fase B — usa execucao normal
  const ex=item.execucao;
  const ativos=getAtivos();
  const condutorId=S.condutorId;
  const membros=S.meeting?.membros_comissao||{};
  const membroIds=[...(membros.titulares||[]),...(membros.suplentes||[])];
  const votantes=ativos.filter(id=>membroIds.includes(id));
  const vtSC=votantes.filter(id=>id!=condutorId);
  const condVota=votantes.includes(condutorId);
  const nF=ex.votos_favoraveis.length, nC=ex.votos_contrarios.length;

  const depRow=id=>{
    const d=getDep(id);
    const vF=ex.votos_favoraveis.some(v=>v.id_assembleia==id);
    const vC=ex.votos_contrarios.some(v=>v.id_assembleia==id);
    const cls=vF?'vf':vC?'vc':'';
    const isCond=id==condutorId;
    return `<div class="vote-dep-row ${cls} ${isCond?'condutor':''}">
      <span class="vote-dep-name">${d.nome}${isCond?' ★':''}</span>
      <span class="vote-dep-party">${d.partido}</span>
      <div class="vote-btns">
        <button class="vbtn vbtn-f ${vF?'sel':''}" onclick="registrarVoto('${item.id}',${id},'f')">F</button>
        <button class="vbtn vbtn-c ${vC?'sel':''}" onclick="registrarVoto('${item.id}',${id},'c')">C</button>
      </div>
    </div>`;
  };

  return `<div class="vote-placar mt8">
    <div><div class="vote-placar-num f">${nF}</div><div class="vote-placar-lbl">Fav.</div></div>
    <div><div class="vote-placar-num c">${nC}</div><div class="vote-placar-lbl">Cont.</div></div>
    <div style="margin-left:auto;font-size:12px;opacity:.7">${nF+nC}/${votantes.length} votaram</div>
  </div>
  <div class="vote-grid mt8">${vtSC.map(depRow).join('')}${condVota?depRow(condutorId):''}</div>
  <div class="row-between mt12">
    <span></span>
    <div class="row">
      <button class="btn btn-ghost btn-sm" onclick="S.odFases['${item.id}']='faseb-enc-pl';autosave();renderOrdemDoDia()">← Voltar</button>
      <button class="btn btn-primary btn-sm" onclick="apurarResultadoFaseB('${item.id}')">⚖ Apurar resultado do PL</button>
    </div>
  </div>`;
}

function avancarFaseB(itemId){
  const item=getOdItem(itemId); if(!item)return;
  const emendas=item.emendas||[];
  const fase=S.odFases[itemId]||'faseb-discussao';

  if(fase==='faseb-discussao'){
    S.odFases[itemId]=emendas.length>0?'faseb-enc-emenda-0':'faseb-enc-pl';
  } else if(fase.startsWith('faseb-enc-emenda-')){
    const idx=parseInt(fase.replace('faseb-enc-emenda-',''));
    S.odFases[itemId]=`faseb-vot-emenda-${idx}`;
  } else if(fase==='faseb-enc-pl'){
    S.odFases[itemId]='faseb-pl';
  }
  autosave(); renderOrdemDoDia();
}

function avancarFaseBVoltar(itemId){
  const item=getOdItem(itemId); if(!item)return;
  const fase=S.odFases[itemId];
  if(fase.startsWith('faseb-vot-emenda-')){
    const idx=parseInt(fase.replace('faseb-vot-emenda-',''));
    S.odFases[itemId]=`faseb-enc-emenda-${idx}`;
    autosave(); renderOrdemDoDia();
  }
}

function registrarVotoEmenda(itemId, emendaIdx, depId, tipo){
  const item=getOdItem(itemId); if(!item)return;
  const em=item.emendas?.[emendaIdx]; if(!em)return;
  const d=getDep(depId);
  const obj={id_assembleia:d.id,nome:d.nome,partido:d.partido};
  em.votos_favoraveis=(em.votos_favoraveis||[]).filter(v=>v.id_assembleia!=depId);
  em.votos_contrarios=(em.votos_contrarios||[]).filter(v=>v.id_assembleia!=depId);
  if(tipo==='f')em.votos_favoraveis.push(obj);
  else em.votos_contrarios.push(obj);
  autosave(); renderOrdemDoDia();
}

function apurarEmenda(itemId, emendaIdx){
  const item=getOdItem(itemId); if(!item)return;
  const em=item.emendas?.[emendaIdx]; if(!em)return;
  const nF=(em.votos_favoraveis||[]).length, nC=(em.votos_contrarios||[]).length;
  if(nF===0&&nC===0){toast('Registre ao menos um voto antes de apurar.','warn');return;}
  em.resultado=nF>=Q_DELIB?'aprovada':'rejeitada';
  // Avançar para próxima emenda ou para PL
  const emendas=item.emendas||[];
  const proximo=emendaIdx+1<emendas.length?`faseb-enc-emenda-${emendaIdx+1}`:'faseb-enc-pl';
  S.odFases[itemId]=proximo;
  autosave(); renderOrdemDoDia();
  toast(`Emenda ${emendaIdx+1}: ${em.resultado==='aprovada'?'Aprovada':'Rejeitada'}.`,
    em.resultado==='aprovada'?'success':'warn',2000);
}

function apurarResultadoFaseB(itemId){
  const item=getOdItem(itemId); if(!item)return;
  const ex=item.execucao;
  const nF=ex.votos_favoraveis.length, nC=ex.votos_contrarios.length;
  if(nF===0&&nC===0){toast('Registre ao menos um voto antes de apurar.','warn');return;}
  if(nF>=Q_DELIB){
    // Aprovado → aguardar confirmação da redação final
    S.odFases[itemId]='faseb-redacao';
    autosave(); renderOrdemDoDia();
    toast('PL aprovado — confirmar redação final.','success',3000);
  } else {
    // Não atingiu 7 favoráveis → rejeitado (Art. 72-A §4º), sem redistribuição
    ex.status='rejeitado'; ex.hora_fim_apreciacao=now();
    S.odFases[itemId]='concluido';
    autosave(); renderOrdemDoDia();
    toast('PL rejeitado — não atingiu quórum de aprovação (Art. 72-A §4º).','warn',3000);
  }
}

function confirmarRedacaoFinal(itemId){
  const item=getOdItem(itemId); if(!item)return;
  item.execucao.status='aprovado';
  item.execucao.hora_fim_apreciacao=now();
  item.execucao.redacao_final_aprovada=true;
  S.odFases[itemId]='concluido';
  autosave(); renderOrdemDoDia();
  toast('Redação final aprovada. PL encerrado.','success',3000);
}

// ═══════════════════════════════════════════════════════════
function renderUrna(item){
  const ex=item.execucao;
  const ativos=getAtivos();
  const condutorId=S.condutorId;
  const membros=S.meeting?.membros_comissao||{};
  const membroIds=[...(membros.titulares||[]),...(membros.suplentes||[])];
  const votantes=ativos.filter(id=>membroIds.includes(id));
  // Condutor ao final
  const votantesSemCondutor=votantes.filter(id=>id!=condutorId);
  const condutorVota=votantes.includes(condutorId);

  const nF=ex.votos_favoraveis.length, nC=ex.votos_contrarios.length;
  const total=votantes.length;

  const depRow=(id)=>{
    const d=getDep(id);
    const vF=ex.votos_favoraveis.some(v=>v.id_assembleia==id);
    const vC=ex.votos_contrarios.some(v=>v.id_assembleia==id);
    const cls=vF?'vf':vC?'vc':'';
    const isCondutor=id==condutorId;
    return `<div class="vote-dep-row ${cls} ${isCondutor?'condutor':''}">
      <span class="vote-dep-name">${d.nome}${isCondutor?' ★':''}</span>
      <span class="vote-dep-party">${d.partido}</span>
      <div class="vote-btns">
        <button class="vbtn vbtn-f ${vF?'sel':''}" onclick="registrarVoto('${item.id}',${id},'f')">F</button>
        <button class="vbtn vbtn-c ${vC?'sel':''}" onclick="registrarVoto('${item.id}',${id},'c')">C</button>
      </div>
    </div>`;
  };

  return `
  <div class="vote-placar mt8">
    <div><div class="vote-placar-num f">${nF}</div><div class="vote-placar-lbl">Fav.</div></div>
    <div><div class="vote-placar-num c">${nC}</div><div class="vote-placar-lbl">Cont.</div></div>
    <div style="margin-left:auto;font-size:12px;opacity:.7">${nF+nC}/${total} votaram</div>
  </div>
  <div class="vote-grid mt8">
    ${votantesSemCondutor.map(depRow).join('')}
    ${condutorVota?depRow(condutorId):''}
  </div>
  <div class="row-between mt12">
    ${TIPOS_VISTA.includes(item.tipo)?`<button class="btn btn-ghost btn-sm" onclick="abrirVista('${item.id}')">👁 Vista</button>`:'<span></span>'}
    <div class="row">
      <button class="btn btn-ghost btn-sm" onclick="avancarFase('${item.id}','discussao')">← Voltar</button>
      <button class="btn btn-primary btn-sm" onclick="apurarResultado('${item.id}')">⚖ Apurar resultado</button>
    </div>
  </div>`;
}

function registrarVoto(itemId,depId,tipo){
  const item=getOdItem(itemId); if(!item)return;
  const d=getDep(depId);
  const obj={id_assembleia:d.id,nome:d.nome,partido:d.partido};
  item.execucao.votos_favoraveis=item.execucao.votos_favoraveis.filter(v=>v.id_assembleia!=depId);
  item.execucao.votos_contrarios=item.execucao.votos_contrarios.filter(v=>v.id_assembleia!=depId);
  if(tipo==='f')item.execucao.votos_favoraveis.push(obj);
  else item.execucao.votos_contrarios.push(obj);
  autosave(); renderOrdemDoDia();
}

function apurarResultado(itemId){
  const item=getOdItem(itemId); if(!item)return;
  const ex=item.execucao;
  const nF=ex.votos_favoraveis.length, nC=ex.votos_contrarios.length;
  const maiSimples=getMaiSimples(item);
  const conclusiva=getConclus(item);

  if(nF===0&&nC===0){toast('Registre ao menos um voto antes de apurar.','warn');return;}

  if(nF===nC){S.odFases[itemId]='minerva';autosave();renderOrdemDoDia();return;}

  let status;
  if(maiSimples){
    status=nF>nC?'aprovado':'rejeitado';
  } else {
    if(nF>=Q_DELIB){
      // Fase A: tem relator → aprova apenas o parecer (retorna na próxima sessão como Fase B)
      // Fase B: sem relator → aprovação definitiva do PL, mas o status é setado em confirmarRedacaoFinal
      status=conclusiva&&item.relator?'aprovado_parecer_conclusivo':'aprovado';
    } else if(nC>=Q_DELIB){
      status='rejeitado';
    } else {
      status=TIPOS_INCONCLUSIVO.includes(item.tipo)?'inconclusivo':'rejeitado';
    }
  }

  aplicarResultado(itemId,status);
}

function aplicarResultado(itemId,status){
  const item=getOdItem(itemId); if(!item)return;
  item.execucao.status=status;
  item.execucao.hora_fim_apreciacao=now();
  const precisaRedist=['rejeitado','inconclusivo'].includes(status)&&TIPOS_INCONCLUSIVO.includes(item.tipo);
  if(precisaRedist){
    S.odFases[itemId]='redistribuicao';
  } else if(status==='aprovado'&&item.eleicao){
    // Eleição aprovada — registrar eleito se não foi indicado ainda
    S.odFases[itemId]='eleicao-result';
  } else if(status==='aprovado'&&item.tipo==='REQSUB'){
    // REQSUB aprovado — designar membros
    S.odFases[itemId]='reqsub-membros';
  } else {
    S.odFases[itemId]='concluido';
  }
  autosave(); renderOrdemDoDia();
  toast(`${statusLabel(status)}.`,status==='aprovado'||status==='aprovado_parecer_conclusivo'?'success':'warn',3000);
}

function statusLabel(st){
  const m={aprovado:'Aprovado',aprovado_parecer_conclusivo:'Parecer aprovado — retorna na próxima sessão',
    rejeitado:'Rejeitado',inconclusivo:'Inconclusivo',vista:'Vista concedida',reexame:'Reexame solicitado',
    relator_ausente:'Relator ausente — item postergado',retirada_de_pauta:'Retirado de pauta',falta_quorum:'Falta de quórum'};
  return m[st]||st;
}

// ── MINERVA ──
function renderMinerva(item){
  const ex=item.execucao;
  const nF=ex.votos_favoraveis.length, nC=ex.votos_contrarios.length;
  const cond=getDep(S.condutorId||0);
  return `<div class="minerva-box">
    <h4>⚠️ EMPATE (${nF}×${nC}) — Voto de Desempate: ${cond.nome}</h4>
    <p class="small muted mb8">Quem conduz os trabalhos profere o voto de desempate (Art. 63, §4.º). O voto soma ao lado escolhido.</p>
    <div class="minerva-btns">
      <button class="btn btn-success" onclick="votoMinerva('${item.id}','f')">✓ Favorável</button>
      <button class="btn btn-danger" onclick="votoMinerva('${item.id}','c')">✗ Contrário</button>
    </div>
  </div>`;
}

function confirmMembroReqsub(itemId){
  const item=getOdItem(itemId);
  if(!item||!item.membros||item.membros.length<2){
    toast('Selecione pelo menos 2 membros titulares.','warn');return;
  }
  S.odFases[itemId]='concluido';
  autosave(); renderOrdemDoDia();
  toast(`Subcomissão criada com ${item.membros.length} membro${item.membros.length!==1?'s':''}.`,'success');
}

function setEleito(itemId, depId){
  if(!sessionOpen())return;
  const item=getOdItem(itemId); if(!item)return;
  if(!depId){item.execucao.eleito=null;}
  else{const d=getDep(depId);item.execucao.eleito={id_assembleia:d.id,nome:d.nome,partido:d.partido};}
  autosave(); renderOrdemDoDia();
}

function toggleMembroReqsub(itemId, depId){
  if(!sessionOpen())return;
  const item=getOdItem(itemId); if(!item)return;
  if(!item.membros)item.membros=[];
  const d=getDep(parseInt(depId));
  const idx=item.membros.findIndex(m=>m.id_assembleia==depId);
  if(idx>=0){item.membros.splice(idx,1);}
  else{item.membros.push({id_assembleia:d.id,nome:d.nome,partido:d.partido});}
  autosave(); renderOrdemDoDia();
}

function votoMinerva(itemId,tipo){
  const item=getOdItem(itemId); if(!item)return;
  const cond=getDep(S.condutorId||0);
  const obj={id_assembleia:cond.id,nome:cond.nome,partido:cond.partido};
  if(tipo==='f')item.execucao.votos_favoraveis.push(obj);
  else item.execucao.votos_contrarios.push(obj);
  item.execucao.voto_desempate={exercido:true,id_assembleia:cond.id,nome:cond.nome,partido:cond.partido,
    sentido:tipo==='f'?'favoravel':'contrario'};

  // Recalcular com o voto Minerva incluído — não assumir aprovado/rejeitado
  const nF=item.execucao.votos_favoraveis.length;
  const nC=item.execucao.votos_contrarios.length;
  let status;
  if(getMaiSimples(item)){
    // Maioria simples: Minerva quebra o empate definitivamente
    status=nF>nC?'aprovado':'rejeitado';
  } else {
    // Maioria absoluta: verificar se atingiu o quórum
    if(nF>=Q_DELIB){
      status=(getConclus(item)&&item.relator)?'aprovado_parecer_conclusivo':'aprovado';
    } else if(nC>=Q_DELIB){
      status='rejeitado';
    } else {
      // Minerva votou mas nenhum lado atingiu 7 — inconclusivo
      status=TIPOS_INCONCLUSIVO.includes(item.tipo)?'inconclusivo':'rejeitado';
    }
  }
  aplicarResultado(itemId,status);
}

// ── REDISTRIBUIÇÃO ──
/* Bancada impedida de relatar um item (Art. 61-A). Ponto ÚNICO da regra no
   sistema ao vivo — espelha _bancadaImpedidaDe() do checkin.js.
   Precedência: campo `bancada_impedida` (curado, conferido no check-in) →
   derivação pelo id do proponente → derivação por nome EXATO → indeterminado.
   Match por primeiro nome é PROIBIDO: id errado é pior que ausente. */
function bancadaImpedidaDe(item){
  if(!item)return {sigla:null,motivo:'sem_proponente'};
  if(item.bancada_impedida)return {sigla:String(item.bancada_impedida),motivo:'campo'};
  const p=item.proponente_principal;
  if(!p||(!p.nome&&p.id_assembleia==null))return {sigla:null,motivo:'sem_proponente'};
  if(p.is_deputado===false)return {sigla:null,motivo:'orgao'};   // órgão não tem partido
  if(p.id_assembleia!=null){
    const d=getDep(p.id_assembleia);
    if(d&&d.partido&&d.partido!=='?')return {sigla:d.partido,motivo:'derivado'};
  }
  if(p.nome&&typeof CAD!=='undefined'&&CAD.deputados&&typeof normNome==='function'){
    const alvo=normNome(p.nome);
    const ach=Object.values(CAD.deputados).filter(d=>normNome(d.nome)===alvo);
    if(ach.length===1&&ach[0].partido)return {sigla:ach[0].partido,motivo:'derivado'};
  }
  return {sigla:null,motivo:'indeterminado'};
}

/* Universo de candidatos a novo relator, com a cascata regimental.

   BASE FIXA (nunca cede): apenas TITULARES, e nunca do partido do proponente.
     · Art. 61-A — vedado relator do partido do proponente.
     · Art. 63 §1º + analogia do Art. 40 — suplente convocado não relata.

   O que RELAXA é só o Art. 67 (novo parecer sai dos votos majoritários), em
   degraus, para o sistema JAMAIS travar sem opção numa reunião ao vivo:
     grau 0 — quem votou com o bloco majoritário            (regra cheia)
     grau 1 — + quem votou vencido                          (Art. 67 cede)
     grau 2 — + titulares que não votaram, inclusive ausentes (caso extremo)

   Retorna {candidatos:[{dep,origem}], grau, impedidos:[{dep,motivo}], banc}.
   Impedidos NÃO somem da tela: aparecem desabilitados, com o motivo (padrão
   do pedido de vista). */
function candidatosRedistribuicao(item){
  const ex=item.execucao;
  const membros=S.meeting?.membros_comissao||{};
  const titulares=(membros.titulares||[]).map(Number);
  const banc=bancadaImpedidaDe(item);

  const idsDe=arr=>new Set((arr||[]).map(v=>Number(v.id_assembleia)).filter(v=>!isNaN(v)));
  const nF=(ex.votos_favoraveis||[]).length, nC=(ex.votos_contrarios||[]).length;
  const majFav = ex.status==='rejeitado' ? false : (nF>=nC);
  const idsMaioria = idsDe(majFav?ex.votos_favoraveis:ex.votos_contrarios);
  const idsMinoria = idsDe(majFav?ex.votos_contrarios:ex.votos_favoraveis);

  const impedidos=[];
  const elegivel=id=>{
    const d=getDep(id);
    if(banc.sigla && d.partido && String(d.partido).toUpperCase()===String(banc.sigla).toUpperCase()){
      impedidos.push({dep:d,motivo:`bancada do proponente (${banc.sigla})`});
      return false;
    }
    return true;
  };
  // Suplentes nem entram no universo (não são titulares) — regra silenciosa por
  // desenho: o cargo, não a conduta, os exclui.
  const base=titulares.filter(elegivel);

  const monta=(ids,origem)=>base.filter(id=>ids.has(id)).map(id=>({dep:getDep(id),origem}));

  let candidatos=monta(idsMaioria,'majoritario'), grau=0;
  if(!candidatos.length){
    candidatos=monta(idsMinoria,'vencido'); grau=1;
  }
  if(!candidatos.length){
    const votou=new Set([...idsMaioria,...idsMinoria]);
    candidatos=base.filter(id=>!votou.has(id)).map(id=>({dep:getDep(id),origem:'nao_votou'}));
    grau=2;
  }
  // Grau 2 real: se ainda assim ninguém, devolve todos os titulares elegíveis.
  if(!candidatos.length){
    candidatos=base.map(id=>({dep:getDep(id),origem:'nao_votou'})); grau=2;
  }
  return {candidatos,grau,impedidos,banc};
}

function renderRedistribuicao(item){
  const ex=item.execucao;
  const status=ex.status;
  const {candidatos,grau,impedidos,banc}=candidatosRedistribuicao(item);

  // Aviso quando o Art. 67 teve de ceder, ou quando o impedimento não pôde ser aferido.
  let alerta='';
  if(grau===1){
    alerta=`<div class="redist-alerta">⚠️ Nenhum titular do bloco majoritário está elegível (Art. 61-A). A lista mostra os titulares que votaram vencidos.</div>`;
  } else if(grau===2){
    alerta=`<div class="redist-alerta">⚠️ Nenhum titular que votou está elegível. Caso não previsto no Regimento — a lista inclui titulares que não votaram (inclusive ausentes). Decisão da Mesa.</div>`;
  }
  if(banc.motivo==='indeterminado'){
    alerta+=`<div class="redist-alerta">⚠️ Não foi possível determinar o partido do proponente: a vedação do Art. 61-A <b>não</b> foi aplicada. Confira antes de confirmar.</div>`;
  }

  const rotOrigem={majoritario:'',vencido:' — votou vencido',nao_votou:' — não votou'};
  const opcs=candidatos.map(c=>
    `<option value="${c.dep.id}">${c.dep.nome} (${c.dep.partido})${rotOrigem[c.origem]||''}</option>`).join('');
  // Impedidos ficam VISÍVEIS e desabilitados, com o motivo (padrão do vista).
  const opcsImp=impedidos.map(i=>
    `<option value="${i.dep.id}" disabled style="color:var(--gray-400)">${i.dep.nome} (${i.dep.partido}) — ${i.motivo}</option>`).join('');

  return `<div class="redist-box">
    <h4>⚠️ Parecer ${status==='rejeitado'?'rejeitado':'inconclusivo'} (${ex.votos_favoraveis.length}×${ex.votos_contrarios.length})</h4>
    ${alerta}
    <p class="small mb8">Escolha o novo relator (Art. 67) — apenas titulares, vedada a bancada do proponente (Art. 61-A):</p>
    <select id="novo-rel-${item.id}" style="width:100%;max-width:420px">
      <option value="">— Selecionar novo relator —</option>
      ${opcs}
      ${opcsImp?`<optgroup label="Impedidos">${opcsImp}</optgroup>`:''}
    </select>
    <div class="redist-forma">
      <label><input type="radio" name="redist-forma-${item.id}" value="preferencia" checked> Por preferência</label>
      <label><input type="radio" name="redist-forma-${item.id}" value="grade"> Pela grade</label>
    </div>
    <button class="btn btn-amber btn-sm mt8" onclick="confirmarRedist('${item.id}')">✓ Confirmar redistribuição</button>
  </div>`;
}

function confirmarRedist(itemId){
  const item=getOdItem(itemId); if(!item)return;
  const sel=document.getElementById(`novo-rel-${itemId}`);
  if(!sel||!sel.value){toast('Selecione o novo relator.','warn');return;}
  const d=getDep(parseInt(sel.value));
  const forma=document.querySelector(`input[name="redist-forma-${itemId}"]:checked`)?.value||'preferencia';
  // Registra COMO se chegou a este relator: o grau conta se o Art. 67 teve de
  // ceder (0 = regra cheia). Dado histórico — a ata precisa poder explicar.
  const {candidatos,grau,banc}=candidatosRedistribuicao(item);
  const esc=candidatos.find(c=>c.dep.id===d.id);
  item.execucao.redistribuicao={
    novo_relator:{id_assembleia:d.id,nome:d.nome,partido:d.partido},
    forma_escolha:forma,
    origem_voto:esc?esc.origem:null,      // majoritario | vencido | nao_votou
    grau_elegibilidade:grau,              // 0 = Art. 67 cumprido; 1|2 = relaxado
    bancada_impedida:banc.sigla||null,
  };
  S.odFases[itemId]='concluido';
  autosave(); renderOrdemDoDia(); toast('Novo relator confirmado.','success');
}

// ── VISTA ──
function abrirVista(itemId){
  S.odFaseAnterior[itemId]=S.odFases[itemId]||'encaminhamentos'; // salva fase anterior
  S.odFases[itemId]='vista-form';
  autosave(); renderOrdemDoDia();
}

function renderVistaForm(item){
  const bloqueados=(item.pedidos_de_vista_anteriores||[]).map(v=>v.partido||v.deputado?.partido).filter(Boolean);
  const membros=S.meeting?.membros_comissao||{};
  const todos=[...(membros.titulares||[]),...(membros.suplentes||[])].map(id=>getDep(id));
  const opcs=todos.map(d=>{
    const bl=bloqueados.includes(d.partido);
    return`<option value="${d.id}" ${bl?'disabled':''} ${bl?`style="color:var(--gray-400)"`:''}>${d.nome} (${d.partido})${bl?' — bancada bloqueada':''}</option>`;
  }).join('');
  return `<div style="background:#eef2ff;border:2px solid #c7d2fe;border-radius:8px;padding:14px;margin-top:10px">
    <strong style="color:#3730a3">👁 Pedido de Vista Regimental</strong>
    <div class="small muted mb8 mt4">Cada bancada pode pedir vista apenas 1× por proposição.</div>
    <div class="row">
      <select id="vista-dep-${item.id}" style="flex:1;max-width:360px">
        <option value="">— Selecionar deputado requerente —</option>
        <optgroup label="Membros">${opcs}</optgroup>
      </select>
      <button class="btn btn-primary btn-sm" onclick="confirmarVista('${item.id}')">Confirmar Vista</button>
      <button class="btn btn-ghost btn-sm" onclick="cancelarVista('${item.id}')">Cancelar</button>
    </div>
  </div>`;
}

function confirmarVista(itemId){
  const sel=document.getElementById(`vista-dep-${itemId}`);
  if(!sel||!sel.value){toast('Selecione o deputado requerente.','warn');return;}
  const d=getDep(parseInt(sel.value));
  const item=getOdItem(itemId); if(!item)return;
  if(!item.pedidos_de_vista_anteriores)item.pedidos_de_vista_anteriores=[];
  item.pedidos_de_vista_anteriores.push({id_assembleia:d.id,nome:d.nome,partido:d.partido});
  encerrarItem(itemId,'vista',{autor_vista:{id_assembleia:d.id,nome:d.nome,partido:d.partido}});
}

function cancelarVista(itemId){
  // Volta para a fase anterior (discussão, encaminhamentos ou relatório)
  S.odFases[itemId]=S.odFaseAnterior[itemId]||'encaminhamentos';
  autosave(); renderOrdemDoDia();
}

function encerrarItem(itemId,status,extras={}){
  const item=getOdItem(itemId); if(!item)return;
  item.execucao.status=status;
  item.execucao.hora_fim_apreciacao=now();
  Object.assign(item.execucao,extras);
  item.execucao.votos_favoraveis=[];
  item.execucao.votos_contrarios=[];
  if(status==='reexame'){
    item.pedidos_de_vista_anteriores=[];
    item.relatorio_lido_em=null;
    item.execucao.relatorio_lido=false;
  }
  S.odFases[itemId]='concluido';
  // Garante contexto correto do FAB mesmo em caminhos que nunca passaram por
  // iniciarItem() (ex: relator ausente, acionado antes de iniciar a deliberação)
  const odIdx=S.meeting.ordem_do_dia.indexOf(item);
  S.fabState={contexto:`Ordem do Dia — ${item.tipo} ${item.numero}/${item.ano}`,target:{tipo:'od',idx:odIdx}};
  autosave(); renderOrdemDoDia();
  toast(statusLabel(status),status==='vista'||status==='reexame'?'warn':'info');
}

function renderResultadoCard(item){
  const ex=item.execucao;
  const nF=ex.votos_favoraveis.length, nC=ex.votos_contrarios.length;
  const temVotos=nF>0||nC>0;
  let html=`<div class="result-card ${ex.status}">
    <strong>${statusLabel(ex.status)}</strong>`;
  if(temVotos)html+=` <span class="small">(${nF}F × ${nC}C)</span>`;
  if(ex.autor_vista)html+=`<br><span class="small">Vista: ${ex.autor_vista.nome} (${ex.autor_vista.partido})</span>`;
  if(ex.redistribuicao?.novo_relator)html+=`<br><span class="small">Novo relator: ${ex.redistribuicao.novo_relator.nome} — ${ex.redistribuicao.forma_escolha==='preferencia'?'por preferência':'pela grade'}</span>`;
  if(ex.voto_desempate)html+=`<br><span class="small">Voto de desempate: ${ex.voto_desempate.nome}${ex.voto_desempate.partido?` (${ex.voto_desempate.partido})`:''} — ${ex.voto_desempate.sentido==='favoravel'?'favorável':'contrário'}</span>`;
  if(ex.eleito)html+=`<br><span class="small">Eleito: ${ex.eleito.nome}${ex.eleito.partido?` (${ex.eleito.partido})`:''}</span>`;
  if(item.tipo==='REQSUB'&&(item.membros||[]).length)html+=`<br><span class="small">Integrantes: ${item.membros.map(m=>m.nome).join('; ')}</span>`;
  if(ex.hora_fim_apreciacao)html+=`<span class="small muted"> · ${ex.hora_fim_apreciacao}</span>`;
  html+=`</div>`;
  return html;
}

function fotoOrdemDia(){
  if(!sessionOpen())return;
  const cnt=countAtivos();
  const suficiente=cnt>=Q_DELIB;
  const ativos=getAtivos();
  S.fotoOrdemDiaTs=now();
  const m=S.meeting.membros_comissao||{};
  if(!S.meeting.metadados.quorum.ordem_do_dia)S.meeting.metadados.quorum.ordem_do_dia={};
  S.meeting.metadados.quorum.ordem_do_dia.suficiente=suficiente;
  S.meeting.metadados.quorum.ordem_do_dia.titulares=ativos.filter(id=>m.titulares?.includes(id)).map(id=>{const d=getDep(id);return{id_assembleia:d.id,nome:d.nome,partido:d.partido};});
  S.meeting.metadados.quorum.ordem_do_dia.suplentes=ativos.filter(id=>m.suplentes?.includes(id)).map(id=>{const d=getDep(id);return{id_assembleia:d.id,nome:d.nome,partido:d.partido};});
  if(suficiente){
    autosave(); renderOrdemDoDia();
    toast('Quórum da Ordem do Dia registrado.','success');
  } else {
    // Sem quórum para OD — marcar todos como falta_quorum e avançar para AG
    (S.meeting?.ordem_do_dia||[]).forEach(item=>{
      ensureExecucao(item);
      item.execucao.status='falta_quorum';
      item.execucao.hora_fim_apreciacao=S.fotoOrdemDiaTs;
      S.odFases[item.id]='concluido';
    });
    autosave(); renderAll();
    toast(`Quórum insuficiente para a Ordem do Dia (${cnt} de ${Q_DELIB} mínimo). Passando para Assuntos Gerais.`,'warn',6000);
    setTimeout(()=>{
      const b=document.getElementById('body-ag');
      const h=document.querySelector('#sec-ag .sec-hdr');
      if(b&&!b.classList.contains('open')){b.classList.add('open');h?.classList.add('open');}
      document.getElementById('sec-ag')?.scrollIntoView({behavior:'smooth'});
    },400);
  }
}

function encerrarOD(){
  showModal(
    'Encerrar Ordem do Dia',
    'O quórum caiu abaixo de 7. Os itens pendentes serão marcados como falta de quórum e a sessão avançará para Assuntos Gerais.',
    [
      {label:'✓ Confirmar encerramento', cls:'btn-danger', action:()=>{
        (S.meeting?.ordem_do_dia||[]).forEach(item=>{
          ensureExecucao(item);
          if(!item.execucao.status||item.execucao.status==='em_deliberacao'){
            item.execucao.status='falta_quorum';
            item.execucao.hora_fim_apreciacao=now();
            S.odFases[item.id]='concluido';
          }
        });
        autosave(); renderOrdemDoDia();
        toggleSec('od'); toggleSec('ag');
        toast('Ordem do Dia encerrada por falta de quórum.','warn');
      }},
      {label:'Cancelar — aguardar mais', cls:'btn-ghost', action:()=>{}},
    ]
  );
}

function reordenar(idx,novaPosicao){
  const total=S.odOrdem.length;
  if(isNaN(novaPosicao)||novaPosicao<1||novaPosicao>total)return;
  const curPos=S.odOrdem.indexOf(idx);
  if(curPos===-1||curPos===novaPosicao-1)return;
  S.odOrdem.splice(curPos,1);
  S.odOrdem.splice(novaPosicao-1,0,idx);
  autosave(); renderOrdemDoDia();
}

function isDeputadoAusente(id){
  if(!id)return false;
  return !S.presencas[id]||S.presencas[id]==='ausente';
}

// ═══════════════════════════════════════════════════════════
// ASSUNTOS GERAIS
// ═══════════════════════════════════════════════════════════
function renderAssuntosGerais(){
  const ag=S.meeting?.assuntos_gerais||{};
  const itens=ag.itens||[];
  let html='';
  itens.forEach((it,i)=>{
    const isLast=i===itens.length-1;
    html+=`<div class="ag-item">
      <div class="ag-item-text">${it.assunto}${it.solicitante?.nome?` <span class="small muted">(${it.solicitante.nome})</span>`:''}</div>
      <div>
        ${!it._anunciado?`<button class="btn btn-ghost btn-xs" onclick="anunciarAG(${i})">✓ Anunciado</button>`:
          `<span class="badge badge-green">✓ ${it._ts||''}</span>`}
        ${_fabBtn(`abrirFABAG(${i})`,it.manifestacoes,'assuntos_gerais_item',i)}
      </div>
    </div>`;
  });
  const manifGerais=S.falas.filter(f=>(f.contexto||'').startsWith('Assuntos Gerais'));
  if(manifGerais.length){
    html+=`<hr class="divider"><div class="sb-lbl">Manifestações Gerais</div>`;
    manifGerais.forEach(f=>{
      html+=`<div class="small mt4"><strong>${f.nome}</strong> <span class="muted">${f.timestamp}</span>${f.nota?` — ${f.nota}`:''}</div>`;
    });
  }
  if(!html)html='<div class="empty">Sem itens de assuntos gerais.</div>';
  document.getElementById('body-ag').innerHTML=html;
}

function anunciarAG(i){
  if(!sessionOpen())return;
  const it=S.meeting.assuntos_gerais.itens[i];
  S.fabState={contexto:`Assuntos Gerais — ${(it.assunto||'').substring(0,40)}`,target:{tipo:'assuntos_gerais_item',idx:i}};
  it._anunciado=true; it._ts=now();
  autosave(); renderAssuntosGerais();
}

function mostrarEncerramento(){
  const sec=document.getElementById('sec-enc');
  sec.scrollIntoView({behavior:'smooth'});
  const body=document.getElementById('body-enc');
  const hdr=document.querySelector('#sec-enc .sec-hdr');
  if(!body.classList.contains('open')){body.classList.add('open');hdr.classList.add('open');}
}

// ═══════════════════════════════════════════════════════════
// ENCERRAMENTO
// ═══════════════════════════════════════════════════════════
function dataSemAno(s){
  if(!s)return'';
  const iso=(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!iso)return s;
  const meses=['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  return `${parseInt(iso[3],10)} de ${meses[parseInt(iso[2],10)-1]}`;
}

function renderCalendario(dataProxy){
  const mesesNm=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  // Âncora: mês corrente (data da reunião, se disponível; senão hoje)
  const dataReuniao=S.meeting?.metadados?.data;
  const base=dataReuniao?new Date(dataReuniao+'T12:00:00'):new Date();
  // Data-alvo a destacar (próxima reunião), se informada
  const alvo=dataProxy?new Date(dataProxy+'T12:00:00'):null;
  let html='<div class="cal-grid">';
  for(let offset=0;offset<3;offset++){
    const ano=base.getFullYear()+Math.floor((base.getMonth()+offset)/12);
    const mes=(base.getMonth()+offset)%12;
    const dias=new Date(ano,mes+1,0).getDate();
    const inicio=new Date(ano,mes,1).getDay(); // 0=Dom
    html+=`<table class="cal-mes"><caption>${mesesNm[mes]} ${ano}</caption><thead><tr>`;
    ['D','S','T','Q','Q','S','S'].forEach(d=>html+=`<th>${d}</th>`);
    html+=`</tr></thead><tbody><tr>`;
    for(let i=0;i<inicio;i++)html+=`<td></td>`;
    for(let dia=1;dia<=dias;dia++){
      const isTarget=alvo&&alvo.getFullYear()===ano&&alvo.getMonth()===mes&&alvo.getDate()===dia;
      const dow=new Date(ano,mes,dia).getDay();
      html+=`<td class="${isTarget?'cal-target':''}${(dow===0||dow===6)?' cal-fim-semana':''}">${dia}</td>`;
      if(dow===6&&dia<dias)html+=`</tr><tr>`;
    }
    html+=`</tr></tbody></table>`;
  }
  return html+'</div>';
}

function renderEncerramento(){
  const ataDecl=S.sessionStatus==='sem_quorum_abertura';
  const enc=S.sessionStatus==='encerrada';

  if(ataDecl){
    // Modo Ata Declaratória — reunião não se realizou
    document.getElementById('body-enc').innerHTML=`
      <div class="result-card rejeitado" style="margin-bottom:14px">
        ⚠️ <strong>Reunião não realizada</strong><br>
        <span class="small">Quórum insuficiente para abertura. Conforme art. 59 §1º do RI, o presidente declarará que a reunião deixa de realizar-se, devendo o fato ficar registrado em Ata Declaratória.</span>
      </div>
      <div class="enc-field">
        <label class="fld-lbl">Hora de registro</label>
        <div class="row">
          <input type="time" id="inp-enc" value="${S.meeting?.metadados?.hora_encerramento||''}">
          <button class="btn btn-ghost btn-sm" onclick="setEncerramento(now())">⏱ Agora</button>
        </div>
      </div>
      <div class="enc-export-grid">
        <button class="enc-export-btn" style="background:var(--amber-lt);color:var(--amber)" onclick="setEncerramento(document.getElementById('inp-enc')?.value||now());gerarAtaDOC()">
          <span class="enc-export-icon">📋</span>Gerar Ata Declaratória (DOC)
        </button>
        <button class="enc-export-btn" style="background:var(--blue-lt);color:var(--blue)" onclick="exportJSON()">
          <span class="enc-export-icon">📄</span>Exportar JSON
        </button>
        <button class="enc-export-btn" style="background:var(--gray-100);color:var(--gray-600)" onclick="printPDF()">
          <span class="enc-export-icon">🖨</span>Resumo (PDF)
        </button>
      </div>
    `;
    return;
  }

  const proxReuniao=S.meeting?.assuntos_gerais?.proxima_reuniao;
  const textoConv=proxReuniao
    ?`Não havendo mais nada a tratar, CONVOCO os Srs. Deputados, membros titulares e suplentes, para a próxima reunião ordinária da Comissão, quarta-feira ${dataSemAno(proxReuniao)}, na hora regimental, e ENCERRO a presente reunião, XX horas XX minutos.`
    :`Não havendo mais nada a tratar, CONVOCO os Srs. Deputados, membros titulares e suplentes, para a próxima reunião ordinária da Comissão, na hora regimental, e ENCERRO a presente reunião, XX horas XX minutos.`;
  const calHtml=renderCalendario(proxReuniao);

  document.getElementById('body-enc').innerHTML=`
    <div class="enc-conv-box">${textoConv}</div>
    ${calHtml}
    ${!enc?`
    <div class="enc-field">
      <label class="fld-lbl">Hora de encerramento</label>
      <div class="row">
        <input type="time" id="inp-enc" value="${S.meeting?.metadados?.hora_encerramento||''}">
        <button class="btn btn-ghost btn-sm" onclick="setEncerramento(now())">⏱ Agora</button>
      </div>
    </div>
    <button class="btn btn-danger" onclick="encerrarSessao()">⏹ Encerrar Reunião</button>
    `:``}
    ${enc||S.meeting?.metadados?.hora_encerramento?`
    <div class="enc-export-grid">
      <button class="enc-export-btn" style="background:var(--blue-lt);color:var(--blue)" onclick="exportJSON()">
        <span class="enc-export-icon">📄</span>Exportar JSON
      </button>
      <button class="enc-export-btn" style="background:var(--green-lt);color:var(--green)" onclick="gerarAtaDOC()">
        <span class="enc-export-icon">📝</span>Gerar Ata (DOC)
      </button>
      <button class="enc-export-btn" style="background:var(--gray-100);color:var(--gray-600)" onclick="printPDF()">
        <span class="enc-export-icon">🖨</span>Resumo (PDF)
      </button>
    </div>
    `:`
    <div class="empty mb8">Exporte os dados após encerrar a reunião.</div>
    `}
    <hr class="divider">
    <button class="btn btn-ghost btn-sm" onclick="exportJSON()">📄 Exportar JSON</button>
  `;
}

function setEncerramento(h){
  S.meeting.metadados.hora_encerramento=h;
  const el=document.getElementById('inp-enc');
  if(el)el.value=h;
}

function encerrarSessao(){
  if(!sessionOpen())return;
  const h=document.getElementById('inp-enc')?.value||now();
  showModal(
    '⏹ Encerrar Reunião',
    `Confirma o encerramento às ${h}? A sessão será travada e não poderão ser feitas mais alterações.`,
    [
      {label:`⏹ Confirmar encerramento às ${h}`, cls:'btn-danger', action:()=>{
        S.meeting.metadados.hora_encerramento=h;
        S.sessionStatus='encerrada';
        autosave(); renderAll(); toast('Sessão encerrada.','success');
      }},
      {label:'Cancelar', cls:'btn-ghost', action:()=>{}},
    ]
  );
}

// ═══════════════════════════════════════════════════════════
// FAB — SISTEMA DE FALAS
// ═══════════════════════════════════════════════════════════
// Detecta automaticamente o contexto atual da sessão
// Retorna {contexto, target} — target indica onde gravar a manifestação
function computeContexto(){
  // 1. Item em deliberação — mais específico e sempre correto
  const od=S.meeting?.ordem_do_dia||[];
  const odAtivoIdx=od.findIndex(i=>i.execucao?.status==='em_deliberacao');
  if(odAtivoIdx>=0){
    const item=od[odAtivoIdx];
    const fase=S.odFases[item.id]||'';
    const subfase=_odSubfaseLabel(fase);
    const ctx=`Ordem do Dia — ${item.tipo} ${item.numero}/${item.ano}${subfase?` — ${subfase}`:''}`;
    return {contexto:ctx, target:{tipo:'od',idx:odAtivoIdx}};
  }
  // 2. Estado explicitamente setado pela última ação do secretário
  if(S.fabState) return S.fabState;
  // 3. Sem estado definido: contexto neutro
  return {contexto:'Geral',target:null};
}

// Define o estado do FAB a partir de uma ação e opcionalmente o alvo
function setFabState(contexto, target=null){
  S.fabState={contexto, target};
}

function fabGetContexto(){ return computeContexto().contexto; }

function abrirFAB(ctx, target){
  let contexto, tgt;
  if(ctx){
    contexto=ctx; tgt=target||null;
  } else {
    const auto=computeContexto();
    contexto=auto.contexto; tgt=auto.target;
  }
  // Salva como estado ativo do FAB
  S.fabState={contexto, target:tgt};
  document.getElementById('fab-contexto').value=contexto;
  document.getElementById('fab-falante').value='';
  document.getElementById('fab-nota').value='';
  document.getElementById('fab-nota-area').style.display='none';
  S.fabFalanteId=null;
  document.getElementById('fab-panel').style.display='block';
  document.getElementById('fab-falante').focus();
}

// Helpers para abrir FAB com alvo específico sem interpolar HTML perigoso
function abrirFABCorr(i){
  const c=S.meeting?.leitura_expediente?.correspondencias_recebidas?.[i];
  abrirFAB(c?`Correspondência — ${c.remetente.substring(0,40)}`:'Correspondência',{tipo:'correspondencia',idx:i});
}
function abrirFABProp(i){
  const p=S.meeting?.leitura_expediente?.proposicoes_recebidas?.[i];
  abrirFAB(p?`Proposição — ${p.tipo} ${p.numero}/${p.ano}`:'Proposição Recebida',{tipo:'proposicao_recebida',idx:i});
}
function abrirFABPropDist(i){
  const p=S.meeting?.leitura_expediente?.proposicoes_distribuidas?.[i];
  abrirFAB(p?`Proposição Distribuída — ${p.tipo} ${p.numero}/${p.ano}`:'Proposição Distribuída',{tipo:'proposicao_distribuida',idx:i});
}
function abrirFABInfo(i){
  const inf=S.meeting?.conhecimento_materias?.informativos?.[i];
  abrirFAB(inf?`Conhecimento de Matérias — Informativo: ${(inf.texto||'').substring(0,40)}`:'Conhecimento de Matérias — Informativo',{tipo:'informativo',idx:i});
}
function abrirFABAud(i){
  const a=S.meeting?.conhecimento_materias?.audiencias_agendadas?.[i];
  abrirFAB(a?`Conhecimento de Matérias — Audiência ${a.data} ${a.hora}`:'Conhecimento de Matérias — Audiência',{tipo:'audiencia',idx:i});
}
function abrirFABDelib(i){
  const d=S.meeting?.conhecimento_materias?.deliberativos_administrativos?.[i];
  abrirFAB(d?`Conhecimento de Matérias — Deliberativo: ${(d.texto||'').substring(0,40)}`:'Conhecimento de Matérias — Deliberativo Administrativo',{tipo:'deliberativo_administrativo',idx:i});
}
function abrirFABRdi(i){
  const r=S.meeting?.conhecimento_materias?.requerimentos_conhecimento?.[i];
  abrirFAB(r?`Conhecimento de Matérias — ${r.tipo||'RDI'} ${r.numero}/${r.ano}`:'Conhecimento de Matérias — Requerimento',{tipo:'requerimento_conhecimento',idx:i});
}
function abrirFABAG(i){
  const it=S.meeting?.assuntos_gerais?.itens?.[i];
  abrirFAB(it?`Assuntos Gerais — ${(it.assunto||'').substring(0,40)}`:'Assuntos Gerais',{tipo:'assuntos_gerais_item',idx:i});
}
function abrirFABOD(itemId){
  const od=S.meeting?.ordem_do_dia||[];
  const idx=od.findIndex(i=>i.id===itemId);
  const item=od[idx];
  if(!item)return;
  const fase=S.odFases[itemId]||'';
  const subfase=_odSubfaseLabel(fase);
  const ctx=`Ordem do Dia — ${item.tipo} ${item.numero}/${item.ano}${subfase?` — ${subfase}`:''}`;
  abrirFAB(ctx,{tipo:'od',idx});
}

function fecharFAB(){
  document.getElementById('fab-panel').style.display='none';
}

function toggleFabNota(){
  const el=document.getElementById('fab-nota-area');
  el.style.display=el.style.display==='none'?'block':'none';
}

function fabAutocomplete(val){
  const sug=document.getElementById('fab-sugest');
  if(val.length<2){sug.style.display='none';return;}
  const matches=Object.values(CAD.deputados).filter(d=>d.nome.toLowerCase().includes(val.toLowerCase())).slice(0,6);
  if(!matches.length){sug.style.display='none';return;}
  sug.style.display='block';
  sug.innerHTML=matches.map(d=>`<div style="padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--gray-100)"
    onclick="selecionarFalante(${d.id},'${d.nome.replace(/'/g,"\\'")}','${d.partido}')">${d.nome} (${d.partido})</div>`).join('');
}

function selecionarFalante(id,nome,partido){
  document.getElementById('fab-falante').value=nome;
  document.getElementById('fab-sugest').style.display='none';
  S.fabFalanteId=id;
}

// Resolve o array de manifestações de destino a partir do tipo/índice do alvo do FAB.
// Único lugar que mapeia tipo de alvo → localização no objeto da reunião —
// adicionar um novo tipo de seção é uma linha aqui, não um if/else espalhado.
function abrirFABAta(i){
  const a=S.meeting?.aprovacao_atas?.atas?.[i];
  abrirFAB(a?`Aprovação de Atas — nº ${a.numero}`:'Aprovação de Atas',{tipo:'ata',idx:i});
}

function _resolverArrayManifestacoes(tgt){
  if(!tgt)return null;
  const le=S.meeting?.leitura_expediente||{};
  const km=S.meeting?.conhecimento_materias||{};
  const od=S.meeting?.ordem_do_dia||[];
  const ag=S.meeting?.assuntos_gerais||{};
  let item=null;
  switch(tgt.tipo){
    case 'ata': {
      const ataItem=S.meeting?.aprovacao_atas?.atas?.[tgt.idx];
      if(!ataItem)return null;
      ataItem.ressalvas=ataItem.ressalvas||[];
      return ataItem.ressalvas;
    }
    case 'correspondencia': item=le.correspondencias_recebidas?.[tgt.idx]; break;
    case 'proposicao_recebida': item=le.proposicoes_recebidas?.[tgt.idx]; break;
    case 'proposicao_distribuida': item=le.proposicoes_distribuidas?.[tgt.idx]; break;
    case 'informativo': item=km.informativos?.[tgt.idx]; break;
    case 'audiencia': item=km.audiencias_agendadas?.[tgt.idx]; break;
    case 'deliberativo_administrativo': item=km.deliberativos_administrativos?.[tgt.idx]; break;
    case 'requerimento_conhecimento': item=km.requerimentos_conhecimento?.[tgt.idx]; break;
    case 'od': item=od[tgt.idx]; break;
    case 'assuntos_gerais_item': item=ag.itens?.[tgt.idx]; break;
    case 'assuntos_gerais':
      ag.manifestacoes_gerais=ag.manifestacoes_gerais||[];
      return ag.manifestacoes_gerais;
  }
  if(!item)return null;
  item.manifestacoes=item.manifestacoes||[];
  return item.manifestacoes;
}

function registrarFala(){
  if(!sessionOpen())return;
  const nome=document.getElementById('fab-falante').value.trim();
  if(!nome){toast('Informe o nome do falante.','warn');return;}
  const ctx=document.getElementById('fab-contexto').value||'Geral';
  const nota=document.getElementById('fab-nota').value.trim();
  const partido=S.fabFalanteId?getDep(S.fabFalanteId).partido:null;
  const fala={
    id_assembleia:S.fabFalanteId, nome, partido,
    timestamp:now(), contexto:ctx, nota
  };
  // 1. Registra no array global (para retomar timeline cronológica)
  S.falas.push(fala);
  // 2. Persiste também no manifestacoes[] do item correspondente
  const obj={id_assembleia:S.fabFalanteId,deputado:nome,partido,texto:nota,timestamp:now(),contexto:ctx};
  const arrDestino=_resolverArrayManifestacoes(S.fabState?.target);
  if(arrDestino)arrDestino.push(obj);
  fecharFAB(); autosave();
  // Re-renderiza a seção correta para que o badge contador apareça imediatamente
  const tipo=S.fabState?.target?.tipo||'';
  if(tipo==='od'){
    if(document.getElementById('body-od')?.classList.contains('open')) renderOrdemDoDia();
  } else if(['correspondencia','proposicao_recebida','proposicao_distribuida'].includes(tipo)){
    renderExpediente();
  } else if(['informativo','audiencia','deliberativo_administrativo'].includes(tipo)){
    renderConhecimento();
  } else if(tipo==='ata'){
    renderAtas();
  } else {
    // assuntos_gerais_item, assuntos_gerais, Geral
    renderAssuntosGerais();
  }
  toast('Fala registrada.','success',1500);
}

// ═══════════════════════════════════════════════════════════
// LIMPAR SESSÃO
// ═══════════════════════════════════════════════════════════
function limparSessao(){
  const btn=document.getElementById('hdr-limpar');
  if(!S.limparConfirm){
    S.limparConfirm=true;
    btn.textContent='⚠️';
    btn.title='Toque novamente para confirmar a limpeza';
    btn.classList.add('confirm');
    S.limparTimer=setTimeout(()=>{S.limparConfirm=false;btn.textContent='🗑';btn.title='Limpar sessão';btn.classList.remove('confirm');},3000);
  } else {
    clearTimeout(S.limparTimer);
    // Remove TODAS as sessões salvas (não só a atual), para evitar contaminação ao reimportar
    Object.keys(localStorage)
      .filter(k=>k.startsWith('roteiro_'))
      .forEach(k=>localStorage.removeItem(k));
    // Reset EM MEMÓRIA (sem location.reload): o reload forçava a revalidação
    // de ~265KB no servidor local, que atende 1 requisição por vez — causa de
    // lentidão/timeout observada em campo. O reset in-place é instantâneo e
    // preserva os cadastros (CAD) já carregados, sem re-fetch.
    S.meeting=null; S.rascunhoKey=null; S._pendingData=null; S.condutorId=null;
    S.presencas={}; S.outros=[]; S.timelinePresencas=[]; S.timelineConducao=[];
    S.falas=[]; S.fotoAberturaTs=null; S.fotoOrdemDiaTs=null;
    S.sessionStatus='aguardando'; S.odFases={}; S.odFaseAnterior={};
    S.fabState=null; S.odOrdem=[]; S.fabContexto=''; S.fabFalanteId=null;
    S.limparConfirm=false; S.limparTimer=null; S.composicaoOrigem=null;
    // Restaura o botão do header para o próximo uso
    btn.textContent='🗑'; btn.title='Limpar sessão'; btn.classList.remove('confirm');
    // Fecha painéis flutuantes que possam estar abertos
    const fp=document.getElementById('fab-panel'); if(fp)fp.style.display='none';
    if(typeof fecharMenuPresenca==='function')fecharMenuPresenca();
    // Volta para a tela de importação
    document.getElementById('app').style.display='none';
    document.getElementById('fab-btn').style.display='none';
    document.getElementById('import-resume-box').style.display='none';
    document.getElementById('import-screen').style.display='flex';
    atualizarIndicadorCadastros();
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORT — JSON
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// CONSOLIDAÇÃO — dobra todo o estado da sessão para dentro do
// objeto meeting, tornando-o autossuficiente (fonte única).
// Chamada por exportJSON, gerarAtaDOC e printPDF.
// ═══════════════════════════════════════════════════════════
function consolidarMeeting(){
  if(!S.meeting)return null;
  const md=S.meeting.metadados=S.meeting.metadados||{};
  const m=S.meeting.membros_comissao||{};
  md.schema_versao='2.3';
  md.status_sessao=S.sessionStatus||null;
  md.ordem_apreciacao_od=(S.odOrdem||[]).slice();
  md.condutor_id=S.condutorId||null;
  const ativos=Object.entries(S.presencas).filter(([,v])=>v!=='ausente').map(([id])=>parseInt(id));
  md.presencas_gerais={
    titulares:ativos.filter(id=>(m.titulares||[]).includes(id)).map(id=>{const d=getDep(id);return{id_assembleia:d.id,nome:d.nome,partido:d.partido};}),
    suplentes:ativos.filter(id=>(m.suplentes||[]).includes(id)).map(id=>{const d=getDep(id);return{id_assembleia:d.id,nome:d.nome,partido:d.partido};}),
    visitantes:S.outros
  };
  md.timeline_presencas=S.timelinePresencas;
  md.timeline_conducao=S.timelineConducao;
  md.falas_sessao=S.falas;
  return S.meeting;
}

function exportJSON(){
  if(!S.meeting){toast('Sem dados para exportar.','warn');return;}
  consolidarMeeting();
  // Limpa campos internos transitórios (_ts, _fabState, etc.), MAS preserva os
  // flags de anúncio (_anunciada/_anunciado) — eles indicam que a proposição/
  // audiência foi lida em reunião, informação de execução que os documentos usam.
  const PRESERVAR=new Set(['_anunciada','_anunciado','_lida']);
  const limpo=JSON.parse(JSON.stringify(S.meeting));
  const limparObj=(obj)=>{
    if(typeof obj!=='object'||obj===null)return;
    Object.keys(obj).forEach(k=>{if(k.startsWith('_')&&!PRESERVAR.has(k))delete obj[k];else limparObj(obj[k]);});
  };
  limparObj(limpo);
  const sigla=(S.meeting.metadados?.sigla||(S.meeting.metadados?.comissao||'').split(' ').filter(w=>w.length>3).map(w=>w[0]).join('')||'ALRS');
  const data=(S.meeting.metadados?.data||'').replace(/\//g,'');
  const blob=new Blob([JSON.stringify(limpo,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`RO_${sigla}_${data}.json`;a.click();
  toast('JSON exportado.','success');
}

// ═══════════════════════════════════════════════════════════
// HELPERS COMPARTILHADOS DE FORMATAÇÃO (DOC + PDF)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// EXPORT — Documentos (ata textual, resumo). As funções de montagem
// e helpers migraram para documentos.js (compartilhado com o checkout).
// Aqui ficam apenas as cascas: consolidam, chamam o módulo, entregam.
// ═══════════════════════════════════════════════════════════
function gerarAtaDOC(){
  try{
    consolidarMeeting();
    const r=docAtaTextualHTML(S.meeting);   // {html, nome}
    baixarDOC(r.html, r.nome);
    toast(r.nome.startsWith('Ata_Declaratoria')?'Ata Declaratória DOC gerada.':'Ata DOC gerada.','success');
  }catch(e){console.error(e);toast('Erro ao gerar DOC: '+e.message,'error',5000);}
}

function printPDF(){
  try{
    consolidarMeeting();
    const html=docResumoHTML(S.meeting);
    imprimirPDF(html);
  }catch(e){console.error(e);toast('Erro ao gerar PDF: '+e.message,'error',5000);}
}

/* ══════════════════════════════════════════════════════════
   TEMA CLARO/ESCURO
   Chave 'ui_theme' fica FORA do prefixo 'roteiro_' de propósito,
   para que limparSessao() não apague a preferência do usuário.
   ══════════════════════════════════════════════════════════ */
const THEME_KEY='ui_theme';
function applyTheme(t){
  const dark = t==='dark';
  document.documentElement.setAttribute('data-theme', dark?'dark':'light');
  // Atualiza os dois botões (header e import), se presentes
  document.querySelectorAll('#hdr-theme,#import-theme').forEach(b=>{
    b.textContent = dark ? '☀️' : '🌙';
    b.title = dark ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  });
}
function toggleTheme(){
  const atual = document.documentElement.getAttribute('data-theme')==='dark' ? 'dark' : 'light';
  const novo = atual==='dark' ? 'light' : 'dark';
  try{ localStorage.setItem(THEME_KEY, novo); }catch(e){}
  applyTheme(novo);
}
function initTheme(){
  let t='light';
  try{ t = localStorage.getItem(THEME_KEY) || 'light'; }catch(e){}
  applyTheme(t);
}

window.onload=function(){
  initTheme();
  // Carrega cadastros (fetch com fallback embutido). Não bloqueia a UI:
  // getDep já funciona com o fallback; ao concluir, atualiza o indicador.
  carregarCadastros().then(()=>{
    atualizarIndicadorCadastros();
  });
  // Fecha fab sugestões ao clicar fora
  document.addEventListener('click',e=>{
    if(!e.target.closest('#fab-falante'))document.getElementById('fab-sugest').style.display='none';
  });
  // Cronômetro de duração: atualiza a cada 30s (granularidade minuto basta).
  setInterval(tickCronometro, 30000);
};

/* Atualiza o indicador de fonte de cadastros na tela de importação. */
function atualizarIndicadorCadastros(){
  const el=document.getElementById('cad-fonte');
  if(!el)return;
  const f=descrFonteCadastros();
  const icoDep=f.depOk?'✓':'⚠';
  const icoCom=f.comOk?'✓':'⚠';
  el.innerHTML=`<span class="${f.depOk?'cad-ok':'cad-warn'}">${icoDep} Deputados: ${f.dep}</span>`+
               `<span class="${f.comOk?'cad-ok':'cad-warn'}">${icoCom} Comissões: ${f.com}</span>`;
}
