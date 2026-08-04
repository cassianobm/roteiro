'use strict';
/* ══════════════════════════════════════════════════════════════════
   checkin.js — Motor do Check-in de Pauta (satélite do sistema CEDST)
   Fatia 1: carregar JSON → visualização por seções → linter (avisos
   automáticos + selos "confira") → edição estruturada → exportar com
   carimbo de revisão. Modo checkout (leitura) quando o JSON é
   pós-reunião (metadados.status_sessao presente).
   Script comum (NÃO ES module), reusa cadastros.js (CAD) e style.css.
   ══════════════════════════════════════════════════════════════════ */

const CI = {
  data: null,        // JSON carregado (mutável — edições vão aqui)
  original: null,    // cópia imutável para "descartar alterações"
  modo: 'checkin',   // 'checkin' (edição) | 'checkout' (leitura)
  avisos: [],        // [{nivel:'err'|'warn'|'info', titulo, texto, ancora}]
  dirty: false,      // houve edição?
  nomeArquivo: null,
};

/* ── Tema (compartilha a chave ui_theme com o sistema ao vivo) ── */
function ciApplyTheme(t){
  document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');
  const b=document.getElementById('ci-theme');
  if(b){ b.textContent=t==='dark'?'☀️':'🌙'; b.title=t==='dark'?'Tema claro':'Tema escuro'; }
}
function ciToggleTheme(){
  const atual=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
  const novo=atual==='dark'?'light':'dark';
  try{ localStorage.setItem('ui_theme',novo); }catch(e){}
  ciApplyTheme(novo);
}

/* ── Utilidades ── */
function ciEl(id){ return document.getElementById(id); }
/* getDep local: o check-in não carrega script.js; usa resolveDep do cadastros.js. */
function getDep(id){ return (typeof resolveDep==='function')?resolveDep(id):{id,nome:'ID '+id,partido:'?'}; }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function ciToast(msg){ /* toast simples reaproveitando visual do sistema */
  let t=ciEl('ci-toast');
  if(!t){ t=document.createElement('div'); t.id='ci-toast';
    t.style.cssText='position:fixed;top:60px;right:16px;background:var(--surface-2);color:var(--text);padding:10px 16px;border-radius:6px;border-left:4px solid var(--accent);box-shadow:var(--shadow-md);font-size:13px;font-weight:600;z-index:1000;opacity:0;transition:opacity .3s';
    document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._tm); t._tm=setTimeout(()=>{ t.style.opacity='0'; }, 2600);
}

/* ── Carregamento de arquivo ── */
function ciAbrirArquivo(){ ciEl('ci-file').click(); }

function ciLerArquivo(file){
  if(!file)return;
  const r=new FileReader();
  r.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      CI.nomeArquivo=file.name;
      ciCarregarDados(data);
    }catch(err){
      ciToast('Arquivo inválido — não é um JSON válido.');
    }
  };
  r.onerror=()=>ciToast('Não foi possível ler o arquivo.');
  r.readAsText(file);
}

/* Detecta modo e monta a interface. */
function ciCarregarDados(data){
  CI.data=data;
  CI.original=JSON.parse(JSON.stringify(data)); // snapshot para descartar
  CI.dirty=false;
  // Modo: pós-reunião (status_sessao) → checkout (leitura); senão check-in.
  const pos = !!(data.metadados && data.metadados.status_sessao);
  CI.modo = pos ? 'checkout' : 'checkin';
  document.body.classList.toggle('ci-readonly', CI.modo==='checkout');

  // Badge de modo
  const badge=ciEl('ci-modo');
  badge.style.display='inline-block';
  badge.className='ci-modo-badge '+(CI.modo==='checkout'?'checkout':'checkin');
  badge.textContent = CI.modo==='checkout' ? 'Checkout (leitura)' : 'Check-in (edição)';

  // Alterna telas
  ciEl('ci-empty').style.display='none';
  ciEl('ci-main').style.display='flex';
  ciEl('ci-foot').style.display='flex';
  ciEl('ci-fechar').style.display = CI.modo==='checkout' ? 'inline-flex' : 'none';
  // Botões de documentos: só no checkout (reunião concluída, gera ata/resumo do consolidado)
  ['ci-doc-ata','ci-doc-resumo-pdf','ci-doc-resumo-doc'].forEach(id=>{
    const el=ciEl(id); if(el)el.style.display = CI.modo==='checkout' ? 'inline-flex' : 'none';
  });

  // Cabeçalho: identifica a pauta
  const md=data.metadados||{};
  ciEl('ci-hdr-sub').textContent = `${md.sigla||md.comissao||'—'} · ${ciDataBR(md.data)||'sem data'}`;

  // Roda o linter e renderiza
  ciRodarLinter();
  ciRenderConteudo();
  ciRenderAvisos();
  ciAtualizarRodape();
  // Sempre inicia na visão guiada ao carregar um arquivo
  if(CI_VISAO!=='guiada'){ CI_VISAO='json'; ciToggleVisao(); }
}

function ciDataBR(iso){
  if(!iso||!/^\d{4}-\d{2}-\d{2}/.test(iso))return iso||'';
  const [a,m,d]=iso.slice(0,10).split('-'); return `${d}/${m}/${a}`;
}

function ciDescartar(){
  if(!CI.original)return;
  ciCarregarDados(JSON.parse(JSON.stringify(CI.original)));
  ciToast('Alterações descartadas.');
}

function ciFechar(){
  // Reset EM MEMÓRIA (sem location.reload): o reload revalida todos os arquivos
  // no servidor local (1 requisição por vez), causando lentidão/timeout no tablet.
  CI.data=null; CI.original=null; CI.avisos=[]; CI.dirty=false; CI.nomeArquivo=null;
  CI_VISAO='guiada';
  document.body.classList.remove('ci-readonly');
  // Esconde área de trabalho, mostra tela inicial
  ciEl('ci-main').style.display='none';
  ciEl('ci-foot').style.display='none';
  ciEl('ci-json-view').style.display='none';
  ciEl('ci-conteudo-inner').style.display='';
  ciEl('ci-modo').style.display='none';
  ciEl('ci-empty').style.display='flex';
  ciEl('ci-hdr-sub').textContent='Assembleia Legislativa do RS';
  // Restaura o botão de visão
  ciEl('ci-visao').textContent='⌁ Ver JSON';
  ciMostrarFonteCadastros();
}

/* Marca alteração (chamado pelos editores). */
function ciMarcarDirty(){
  CI.dirty=true;
  ciAtualizarRodape();
  // Re-linta em tempo real: correções fazem avisos sumirem
  ciRodarLinter();
  ciRenderAvisos();
}

function ciAtualizarRodape(){
  const info=ciEl('ci-foot-info');
  if(CI.modo==='checkout'){
    info.textContent='Modo leitura — este arquivo já passou pela reunião.';
  } else {
    const n=CI.avisos.length;
    info.textContent = (CI.dirty?'Alterações não exportadas · ':'') +
      (n? `${n} aviso${n>1?'s':''} a revisar` : 'Sem avisos');
  }
}

/* ── Boot ── */
window.addEventListener('load',()=>{
  ciApplyTheme(localStorage.getItem('ui_theme')||'light');
  carregarCadastros().then(()=>{ ciMostrarFonteCadastros(); });

  ciEl('ci-theme').addEventListener('click',ciToggleTheme);
  ciEl('ci-visao').addEventListener('click',ciToggleVisao);
  ciEl('ci-abrir').addEventListener('click',ciAbrirArquivo);
  ciEl('ci-carregar').addEventListener('click',ciAbrirArquivo);
  ciEl('ci-file').addEventListener('change',e=>{ if(e.target.files[0])ciLerArquivo(e.target.files[0]); e.target.value=''; });
  ciEl('ci-descartar').addEventListener('click',ciDescartar);
  ciEl('ci-exportar').addEventListener('click',ciExportar);
  ciEl('ci-fechar').addEventListener('click',ciFechar);

  // Botões de documentos (checkout) — geram a partir de CI.data (consolidado)
  ciEl('ci-doc-ata').addEventListener('click',()=>{
    try{ const r=docAtaTextualHTML(CI.data); baixarDOC(r.html, r.nome); ciToast('Ata textual (.doc) gerada.'); }
    catch(e){ ciToast('Erro ao gerar ata: '+e.message); }
  });
  ciEl('ci-doc-resumo-pdf').addEventListener('click',()=>{
    try{ imprimirPDF(docResumoHTML(CI.data)); }
    catch(e){ ciToast('Erro ao gerar resumo: '+e.message); }
  });
  ciEl('ci-doc-resumo-doc').addEventListener('click',()=>{
    try{
      const html=docResumoHTML(CI.data);
      const H=_expHelpers(CI.data);
      baixarDOC(html, `Resumo_${H.siglaDoc()}_${H.dataFile()}.doc`);
      ciToast('Resumo (.doc) gerado.');
    }catch(e){ ciToast('Erro ao gerar resumo: '+e.message); }
  });

  // Drag & drop
  const drop=ciEl('ci-drop');
  ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
  drop.addEventListener('drop',e=>{ const f=e.dataTransfer.files[0]; if(f)ciLerArquivo(f); });
});

function ciMostrarFonteCadastros(){
  const f=(typeof descrFonteCadastros==='function')?descrFonteCadastros():null;
  if(!f)return;
  const txt=`Cadastros: deputados ${f.depOk?'✓':'⚠'} · comissões ${f.comOk?'✓':'⚠'}`;
  const a=ciEl('ci-cad-fonte'); if(a)a.textContent=txt;
  const b=ciEl('ci-cad-fonte-empty'); if(b)b.textContent=`${f.depOk?'✓':'⚠'} Deputados: ${f.dep} · ${f.comOk?'✓':'⚠'} Comissões: ${f.com}`;
}

/* ══════════════════════════════════════════════════════════════════
   LINTER — Nível 1 (verificações automáticas de inconsistência).
   Preenche CI.avisos. Cada aviso tem uma âncora (id de elemento) para
   navegação. Nível 2 (selos "confira") é aplicado na renderização.
   ══════════════════════════════════════════════════════════════════ */
function ciRodarLinter(){
  CI.avisos=[];
  const d=CI.data; if(!d)return;
  // No checkout, o linter de pré-sessão não se aplica (a reunião já ocorreu).
  if(CI.modo==='checkout')return;
  const md=d.metadados||{};

  // Conjunto de IDs de membros da comissão (para checar relator/proponente)
  const membros=new Set();
  const mc=d.membros_comissao||{};
  (mc.titulares||[]).forEach(x=>membros.add(_idDe(x)));
  (mc.suplentes||[]).forEach(x=>membros.add(_idDe(x)));
  // Partidos presentes no quadro (para checar bancada impedida)
  const partidos=new Set();
  membros.forEach(id=>{ const dep=(typeof getDep==='function')?getDep(id):null; if(dep&&dep.partido)partidos.add(dep.partido.toUpperCase()); });

  function add(nivel,titulo,texto,ancora){ CI.avisos.push({nivel,titulo,texto,ancora:ancora||null}); }

  // ── Tramitação conclusiva mencionada na ementa mas campo não setado ──
  // A IA às vezes deixa "tramitação/votação conclusiva nesta comissão" no texto
  // da ementa em vez de setar votacao_conclusiva:true.
  (d.ordem_do_dia||[]).forEach((it,i)=>{
    const ementa=(it.ementa||'').toLowerCase();
    const mencionaConclusiva=/(tramita|votaç|votac).{0,20}conclusiv|conclusiv.{0,20}(nesta comiss|comiss)/.test(ementa);
    if(mencionaConclusiva && it.votacao_conclusiva!==true){
      add('warn',
        `Item ${i+1}: conclusiva na ementa, campo não marcado`,
        `A ementa de ${_rotItem(it)} menciona tramitação conclusiva, mas o campo não está marcado. Confira e, se for o caso, marque "conclusiva" (e limpe a instrução da ementa).`,
        `od-${i}`);
    }
  });

  // ── Inconsistências eleição × maioria simples ──
  // Regra de domínio: eleição exige maioria QUALIFICADA; maioria simples só se
  // aplica a certos casos (ex.: convite) e deve ser explícita no roteiro. Os
  // dois NÃO podem ser verdadeiros ao mesmo tempo.
  (d.ordem_do_dia||[]).forEach((it,i)=>{
    if(it.eleicao===true && it.maioria_simples===true){
      add('err',
        `Item ${i+1}: eleição com maioria simples`,
        `${_rotItem(it)} está marcado como eleição E maioria simples ao mesmo tempo — incompatível. Eleição exige maioria qualificada. Confira qual dos dois é o correto.`,
        `od-${i}`);
    }
  });

  // ── ★ Dor nº 1: sugestão de relator gravada COMO relator ──
  // Assinatura: votacao_conclusiva:true + relator preenchido + parecer nulo.
  // Nesse cenário o item deveria ser Fase B (relator null); relator preenchido
  // sem parecer sugere que a IA colocou a SUGESTÃO no campo relator.
  (d.ordem_do_dia||[]).forEach((it,i)=>{
    if(it.votacao_conclusiva===true && it.relator && (it.parecer==null||it.parecer==='') ){
      add('err',
        `Item ${i+1}: relator em votação conclusiva sem parecer`,
        `${_rotItem(it)} está marcado como votação conclusiva (Fase B), mas tem relator preenchido e nenhum parecer. Confira se o que está no campo "relator" não é, na verdade, uma sugestão de relatoria.`,
        `od-${i}`);
    }
  });

  // ── Relator que não é membro da comissão ──
  (d.ordem_do_dia||[]).forEach((it,i)=>{
    const rid=it.relator&&_idDe(it.relator);
    if(rid && membros.size && !membros.has(rid)){
      add('warn',
        `Item ${i+1}: relator fora do quadro`,
        `O relator de ${_rotItem(it)} não consta entre os membros da comissão. Verifique se o ID está correto.`,
        `od-${i}`);
    }
  });

  // ── ★ Art. 61-A: relator não pode ser do partido do proponente ──
  // Regra INVIOLÁVEL, e vale já na designação original (que vem no roteiro).
  // Fonte da bancada impedida: o campo `bancada_impedida` do item. Enquanto os
  // roteiros antigos não o trouxerem na OD, deriva-se do proponente — e, se nem
  // isso resolver, avisa que NÃO foi possível verificar (nunca silencia).
  (d.ordem_do_dia||[]).forEach((it,i)=>{
    const rid=it.relator&&_idDe(it.relator);
    if(!rid)return;                                   // sem relator designado: nada a checar
    const relator=(typeof getDep==='function')?getDep(rid):null;
    const partRel=relator&&relator.partido;
    if(!partRel||partRel==='?')return;                // relator não resolvido: outro aviso já cobre

    const banc=_bancadaImpedidaDe(it);
    if(banc.sigla){
      if(String(banc.sigla).toUpperCase()===String(partRel).toUpperCase()){
        add('err',
          `Item ${i+1}: relator do partido do proponente`,
          `O relator de ${_rotItem(it)} é do ${esc(partRel)}, mesmo partido do proponente — vedado pelo Art. 61-A. Designe outro relator.`,
          `od-${i}`);
      }
    } else if(banc.motivo==='indeterminado'){
      add('warn',
        `Item ${i+1}: impedimento de bancada não verificável`,
        `Não foi possível determinar o partido do proponente de ${_rotItem(it)}, então a vedação do Art. 61-A não pôde ser conferida. Confira manualmente.`,
        `od-${i}`);
    }
  });

  // ── Matérias a distribuir: sugestão de relatoria fora do quadro ──
  const mad=(d.leitura_expediente&&d.leitura_expediente.materias_a_distribuir)||[];
  mad.forEach((it,i)=>{
    const sid=it.sugestao_relatoria&&_idDe(it.sugestao_relatoria);
    if(sid && membros.size && !membros.has(sid)){
      add('warn',
        `Matéria a distribuir ${i+1}: sugestão fora do quadro`,
        `A sugestão de relatoria de ${_rotItem(it)} não consta entre os membros da comissão.`,
        `mad-${i}`);
    }
  });

  // ── Bancada impedida sem correspondência de partido ──
  mad.forEach((it,i)=>{
    const b=it.bancada_impedida;
    if(b && partidos.size && !partidos.has(String(b).toUpperCase())){
      add('warn',
        `Matéria a distribuir ${i+1}: bancada impedida não presente`,
        `A bancada impedida "${esc(b)}" não corresponde a nenhum partido dos membros atuais. Confira.`,
        `mad-${i}`);
    }
  });

  // ── Proponente com ID inexistente no cadastro ──
  function checaProp(p,ondeAncora,ondeTexto){
    if(!p)return;
    if(p.is_deputado===false)return; // órgão, ok
    const pid=_idDe(p);
    if(pid && typeof getDep==='function'){
      const dep=getDep(pid);
      if(dep && dep.nome && dep.nome.startsWith('ID ')){
        add('warn', `${ondeTexto}: proponente desconhecido`,
          `O proponente (ID ${pid}) não foi encontrado no cadastro de deputados.`, ondeAncora);
      }
    }
  }
  (d.leitura_expediente&&d.leitura_expediente.proposicoes_recebidas||[]).forEach((it,i)=>checaProp(it.proponente_principal,`pr-${i}`,`Proposição recebida ${i+1}`));

  // ── Composição vazia (informa que virá do cadastro) ──
  const temTit=(mc.titulares||[]).length>0, temSup=(mc.suplentes||[]).length>0;
  if(!temTit || !temSup){
    const faltando=[!temTit?'titulares':null,!temSup?'suplentes':null].filter(Boolean).join(' e ');
    const c=(typeof acharComissao==='function')?acharComissao(md.sigla||md.comissao):null;
    if(c){
      add('info', `Composição incompleta no roteiro`,
        `O roteiro não trouxe ${faltando}. O cadastro de comissões pode preencher no sistema ao vivo (comissão "${esc(c.sigla)}" encontrada).`, null);
    } else {
      add('warn', `Composição não encontrada`,
        `O roteiro não trouxe ${faltando} e a comissião não foi localizada no cadastro. Verifique.`, null);
    }
  }

  // ── Data de ata posterior à reunião ──
  const dataReuniao=md.data;
  (d.aprovacao_atas&&d.aprovacao_atas.atas||[]).forEach((a,i)=>{
    if(a.reuniao_referencia && dataReuniao){
      // reuniao_referencia costuma ter data no fim; comparação simples de ISO se houver
      const m=String(a.reuniao_referencia).match(/(\d{4}-\d{2}-\d{2})/);
      if(m && m[1] > dataReuniao){
        add('warn', `Ata ${a.numero||i+1}: data futura`,
          `A ata ${esc(a.numero||'')} referencia data posterior à reunião. Confira.`, `ata-${i}`);
      }
    }
  });

  // Ordena: erros primeiro, depois avisos, depois infos
  const ordem={err:0,warn:1,info:2};
  CI.avisos.sort((a,b)=>ordem[a.nivel]-ordem[b.nivel]);
}

function _idDe(x){
  if(!x||typeof x!=='object')return x;
  // Formato aninhado da sugestao_relatoria: {deputado:{id_assembleia}}
  if(x.deputado&&typeof x.deputado==='object')return x.deputado.id_assembleia||x.deputado.id;
  return x.id_assembleia||x.id;
}
function _rotItem(it){
  const t=it.tipo||'item'; const n=it.numero!=null?` ${it.numero}`:''; const a=it.ano?`/${it.ano}`:'';
  return `${t}${n}${a}`;
}

/* ── Bancada impedida de relatar um item (Art. 61-A) ──────────────────
   Ponto ÚNICO da regra. Retorna {sigla, motivo, origem}:
     sigla: 'PT' | null
     motivo: 'campo' | 'derivado' | 'orgao' | 'sem_proponente' | 'indeterminado'
   Precedência:
     1) `bancada_impedida` do item (fonte curada, conferida no check-in);
     2) derivação do proponente — pelo id no cadastro, ou por nome EXATO
        (normNome). Match por primeiro nome é PROIBIDO: id errado é pior que
        ausente (é o achado que passamos ao construtor externo);
     3) órgão proponente (is_deputado:false) → não há bancada impedida;
     4) nada resolveu → 'indeterminado' (o chamador AVISA; nunca silencia). */
function _bancadaImpedidaDe(it){
  if(!it)return {sigla:null, motivo:'sem_proponente'};

  // 1) Campo explícito (o que a Rota 2 passa a emitir também na OD)
  if(it.bancada_impedida)return {sigla:String(it.bancada_impedida), motivo:'campo'};

  const p=it.proponente_principal;
  if(!p||(!p.nome&&p.id_assembleia==null))return {sigla:null, motivo:'sem_proponente'};

  // 3) Órgão (Poder Executivo, Tribunal de Contas...): não tem partido
  if(p.is_deputado===false)return {sigla:null, motivo:'orgao'};

  // 2) Derivação — id primeiro (fonte forte)
  if(p.id_assembleia!=null && typeof getDep==='function'){
    const d=getDep(p.id_assembleia);
    if(d&&d.partido&&d.partido!=='?')return {sigla:d.partido, motivo:'derivado', origem:'id'};
  }
  // 2b) Derivação por NOME EXATO normalizado (nunca por primeiro nome)
  if(p.nome && typeof CAD!=='undefined' && CAD.deputados && typeof normNome==='function'){
    const alvo=normNome(p.nome);
    const achados=Object.values(CAD.deputados).filter(d=>normNome(d.nome)===alvo);
    if(achados.length===1 && achados[0].partido)
      return {sigla:achados[0].partido, motivo:'derivado', origem:'nome'};
  }
  // 4) Não deu para saber
  return {sigla:null, motivo:'indeterminado'};
}

/* ══════════════════════════════════════════════════════════════════
   RENDERIZAÇÃO — painel de avisos + conteúdo por seções.
   ══════════════════════════════════════════════════════════════════ */
function ciRenderAvisos(){
  const cont=ciEl('ci-avisos-list');
  const cnt=ciEl('ci-av-count');

  // ── Modo checkout: painel vira RESUMO DE RESULTADOS ──
  if(CI.modo==='checkout'){
    document.querySelector('.ci-av-head').childNodes[0].textContent='Resultados ';
    const od=CI.data.ordem_do_dia||[];
    const contagem={};
    od.forEach(it=>{ const s=(it.execucao&&it.execucao.status)||'nao_apreciado'; contagem[s]=(contagem[s]||0)+1; });
    cnt.textContent=od.length; cnt.className='ci-av-count ok';
    const rot=s=>CI_STATUS_ROT[s]||(s==='nao_apreciado'?'Não apreciado':s);
    const cls=s=>({aprovado:'info',aprovado_parecer_conclusivo:'info',rejeitado:'err',
      inconclusivo:'warn',vista:'warn',falta_quorum:'warn'}[s]||'info');
    cont.innerHTML=Object.entries(contagem).map(([s,n])=>
      `<div class="ci-aviso ${cls(s)}"><span class="ci-av-t">${n}× ${esc(rot(s))}</span></div>`).join('')
      || '<div class="ci-av-vazio">Sem itens na ordem do dia.</div>';
    ciAtualizarRodape(); return;
  }

  const n=CI.avisos.length;
  document.querySelector('.ci-av-head').childNodes[0].textContent='Avisos ';
  const nErr=CI.avisos.filter(a=>a.nivel==='err').length;
  cnt.textContent=n;
  cnt.className='ci-av-count '+(nErr?'err':n?'warn':'ok');
  if(!n){
    cont.innerHTML='<div class="ci-av-vazio">Nenhuma inconsistência automática encontrada.<br>Revise os campos marcados com "confira".</div>';
    ciAtualizarRodape(); return;
  }
  cont.innerHTML=CI.avisos.map((a,i)=>
    `<div class="ci-aviso ${a.nivel}" ${a.ancora?`onclick="ciIrPara('${a.ancora}')"`:''}>
       <span class="ci-av-t">${esc(a.titulo)}</span>${esc(a.texto)}
     </div>`).join('');
  ciAtualizarRodape();
}

function ciIrPara(ancora){
  const el=ciEl('anc-'+ancora);
  if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});
    el.style.transition='background .3s'; const o=el.style.background;
    el.style.background='var(--warn-bg)'; setTimeout(()=>el.style.background=o,1200); }
}

/* selo "confira" para campos de inferência (Nível 2) */
function selo(){ return CI.modo==='checkout' ? '' : `<span class="ci-selo">⚠ confira</span>`; }
function campoConfira(rotulo,valorHtml,vazio){
  const v = (valorHtml==null||valorHtml==='') ? `<span class="ci-campo-vazio">${esc(vazio||'não informado')}</span>` : valorHtml;
  return `<div class="ci-confira"><span class="ci-item-meta"><b>${esc(rotulo)}</b> ${v} ${selo()}</span></div>`;
}

function secWrap(n,titulo,corpo){
  return `<div class="ci-sec"><div class="ci-sec-hdr"><span class="ci-sec-n">${n}</span> ${esc(titulo)}</div>
    <div class="ci-sec-body">${corpo}</div></div>`;
}
function vazia(msg){ return `<div class="ci-sec-vazia">${esc(msg)}</div>`; }

function nomeDeRef(x){
  if(!x)return '';
  if(typeof x==='object'){
    // Desembrulha o formato aninhado {deputado:{...}} da sugestao_relatoria
    if(x.deputado&&typeof x.deputado==='object')x=x.deputado;
    const id=_idDe(x);
    // 1) ID resolvível no cadastro → nome do cadastro
    if(id && typeof getDep==='function'){ const d=getDep(id); if(d&&!String(d.nome).startsWith('ID '))return `${d.nome}${d.partido?' ('+d.partido+')':''}`; }
    // 2) nome próprio no objeto (ex.: relator EXTERNO do RELSUB, sem ID no cadastro)
    if(x.nome)return `${x.nome}${x.partido?' ('+x.partido+')':''}`;
    // 3) só ID, não resolvível → mostra o ID; sem nada → vazio
    return id!=null ? `ID ${id}` : '';
  }
  if(typeof getDep==='function'){ const d=getDep(x); if(d)return `${d.nome}${d.partido?' ('+d.partido+')':''}`; }
  return String(x);
}

function ciRenderConteudo(){
  const d=CI.data; const md=d.metadados||{};
  let h='';

  // ── Cabeçalho da pauta ──
  h+=secWrap('','Reunião', `
    <div class="ci-item-meta">
      <b>Comissão:</b> ${esc(md.comissao||'—')} ${md.sigla?`(${esc(md.sigla)})`:''}<br>
      <b>Tipo:</b> ${esc(md.tipo_reuniao||'—')} · <b>Data:</b> ${esc(ciDataBR(md.data))} · <b>Hora:</b> ${esc(md.hora_inicio||'—')}<br>
      <b>Local:</b> ${esc(md.local||'—')} · <b>Modalidade:</b> ${esc(md.modalidade||'—')}
    </div>`);

  // ── Resumo da sessão (só no checkout: o que aconteceu) ──
  h+=ciRenderSessao();

  // ── Membros ──
  const mc=d.membros_comissao||{};
  const listaMembros=arr=>(arr||[]).map(x=>nomeDeRef(x)).join(' · ')||'—';
  h+=secWrap('','Membros da Comissão', `
    <div class="ci-item-meta"><b>Titulares (${(mc.titulares||[]).length}):</b> ${esc(listaMembros(mc.titulares))}</div>
    <div class="ci-item-meta" style="margin-top:6px"><b>Suplentes (${(mc.suplentes||[]).length}):</b> ${esc(listaMembros(mc.suplentes))}</div>`);

  // ── Aprovação de atas ──
  const atas=(d.aprovacao_atas&&d.aprovacao_atas.atas)||[];
  h+=secWrap('2','Aprovação de Atas', atas.length? atas.map((a,i)=>`
    <div class="ci-item" id="anc-ata-${i}">
      <div class="ci-item-top"><span class="ci-item-tipo">Ata ${esc(a.numero||'—')}</span>
        <span class="badge badge-gray">${esc(a.tipo_reuniao||'')}</span>
        ${a.status?`<span class="badge ${a.status==='aprovada'?'badge-green':'badge-amber'}">${esc(a.status)}</span>`:''}</div>
      <div class="ci-item-meta">Referência: ${esc(a.reuniao_referencia||'—')}</div>
      ${(a.ressalvas||[]).length?`<div class="ci-item-meta">Ressalvas: ${(a.ressalvas||[]).map(r=>esc(typeof r==='string'?r:(r.texto||''))).join(' · ')}</div>`:''}
    </div>`).join('') : vazia('Nenhuma ata para deliberar.'));

  // ── Expediente ──
  h+=ciRenderExpediente(d.leitura_expediente||{});

  // ── Conhecimento de matérias ──
  h+=ciRenderConhecimento(d.conhecimento_materias||{});

  // ── Ordem do dia ──
  h+=ciRenderOrdemDia(d.ordem_do_dia||[]);

  // ── Assuntos gerais ──
  const ag=d.assuntos_gerais||{};
  const itensAg=(ag.itens||[]);
  h+=secWrap('6','Assuntos Gerais', itensAg.length? itensAg.map((it,i)=>{
    const solic = it.solicitante ? nomeDeRef(it.solicitante) : '';
    const solicTxt = (solic && !/^ID /.test(solic)) ? ` — ${esc(solic)}` : '';
    return `<div class="ci-item">
      <div class="ci-item-meta ci-read-view"><b>${esc(it.assunto||'—')}</b>${solicTxt}</div>
      <div class="ci-edit-row ci-edit-only" style="align-items:flex-start">
        <label>Assunto</label>
        <textarea rows="2" onchange="ciSetAssunto(${i},this.value)">${esc(it.assunto||'')}</textarea>
      </div>
    </div>`;
  }).join('')
    + (ag.proxima_reuniao?`<div class="ci-item-meta" style="margin-top:8px">Próxima reunião: ${esc(ciDataBR(ag.proxima_reuniao))}</div>`:'')
    : vazia('Sem assuntos gerais.'));

  ciEl('ci-conteudo-inner').innerHTML=h;
}

/* ── Expediente (correspondências, proposições, matérias a distribuir) ── */
function ciRenderExpediente(exp){
  let inner='';
  const corr=exp.correspondencias_recebidas||[];
  if(corr.length){
    inner+=`<div class="ci-item-meta" style="font-weight:700;margin:4px 0 8px">Correspondências recebidas</div>`;
    inner+=corr.map(c=>`<div class="ci-item"><div class="ci-item-meta"><b>${esc(c.remetente||'—')}</b></div>
      <div class="ci-item-ementa">${esc(c.mensagem||'')}</div></div>`).join('');
  }
  const rec=exp.proposicoes_recebidas||[];
  if(rec.length){
    inner+=`<div class="ci-item-meta" style="font-weight:700;margin:12px 0 8px">Proposições recebidas</div>`;
    inner+=rec.map((it,i)=>`<div class="ci-item" id="anc-pr-${i}">
      <div class="ci-item-top"><span class="ci-item-tipo">${esc(_rotItem(it))}</span>
        ${badgeConclusiva(it)}</div>
      <div class="ci-item-ementa">${esc(it.ementa||'')}</div>
      <div class="ci-item-meta">Proponente: ${esc(nomeProp(it.proponente_principal))}</div>
    </div>`).join('');
  }
  const dist=exp.proposicoes_distribuidas||[];
  if(dist.length){
    inner+=`<div class="ci-item-meta" style="font-weight:700;margin:12px 0 8px">Proposições distribuídas${CI.modo==='checkout'?' (em reunião anterior)':''}</div>`;
    inner+=dist.map((it,i)=>`<div class="ci-item" id="anc-pd-${i}">
      <div class="ci-item-top"><span class="ci-item-tipo">${esc(_rotItem(it))}</span>
        ${badgeConclusiva(it)}</div>
      <div class="ci-item-ementa">${esc(it.ementa||'')}</div>
      <div class="ci-item-meta">Proponente: ${esc(nomeProp(it.proponente_principal))}</div>
      ${it.relator?`<div class="ci-item-meta">Relator: <b>${esc(nomeDeRef(it.relator))}</b></div>`:''}
    </div>`).join('');
  }
  const mad=exp.materias_a_distribuir||[];
  if(mad.length){
    inner+=`<div class="ci-item-meta" style="font-weight:700;margin:12px 0 8px">Matérias a distribuir</div>`;
    inner+=mad.map((it,i)=>`<div class="ci-item" id="anc-mad-${i}">
      <div class="ci-item-top"><span class="ci-item-tipo">${esc(_rotItem(it))}</span></div>
      <div class="ci-item-ementa">${esc(it.ementa||'')}</div>
      <div class="ci-item-meta">Proponente: ${esc(nomeProp(it.proponente_principal))}</div>
      ${it.relator?`<div class="ci-item-meta">Relator designado: <b>${esc(nomeDeRef(it.relator))}</b>${it.forma_escolha_relator?` (${it.forma_escolha_relator==='preferencia'?'por preferência':esc(it.forma_escolha_relator)})`:''}${it.data_distribuicao?` · em ${esc(ciDataBR(it.data_distribuicao))}`:''}</div>`:''}
      ${editRelator(it,'mad',i,'sugestao_relatoria','Sugestão de relatoria')}
      ${editBancada(it,'mad',i)}
    </div>`).join('');
  }
  if(!inner)inner=vazia('Expediente vazio.');
  return secWrap('3','Expediente', inner);
}

/* ── Conhecimento de matérias ── */
function ciRenderConhecimento(c){
  let inner='';
  // Informativos: oferecer mover para deliberativo (a classificação que a IA erra)
  if(c.informativos&&c.informativos.length){
    inner+=`<div class="ci-item-meta" style="font-weight:700;margin:8px 0">Informativos ${selo()}</div>`;
    inner+=c.informativos.map((it,i)=>`<div class="ci-item">
      <div class="ci-item-ementa">${esc(it.texto||'')}</div>
      <div class="ci-edit-row ci-edit-only" style="margin-top:8px">
        <button class="btn btn-ghost btn-xs" onclick="ciReclassificar('info2delib',${i})">↧ Mover para deliberativo</button>
      </div>
    </div>`).join('');
  }
  inner+=bloco('Requerimentos para conhecimento',c.requerimentos_conhecimento,it=>`<div class="ci-item">
    <div class="ci-item-top"><span class="ci-item-tipo">${esc(_rotItem(it))}</span></div>
    <div class="ci-item-ementa">${esc(it.ementa||'')}</div></div>`);
  // Deliberativos: oferecer mover para informativo
  if(c.deliberativos_administrativos&&c.deliberativos_administrativos.length){
    inner+=`<div class="ci-item-meta" style="font-weight:700;margin:8px 0">Deliberativos administrativos ${selo()}</div>`;
    inner+=c.deliberativos_administrativos.map((it,i)=>`<div class="ci-item">
      <div class="ci-item-ementa">${esc(it.texto||'')}</div>
      <div class="ci-item-meta">Requer deliberação: ${it.requer_deliberacao?'sim':'não'}</div>
      <div class="ci-edit-row ci-edit-only" style="margin-top:8px">
        <button class="btn btn-ghost btn-xs" onclick="ciReclassificar('delib2info',${i})">↥ Mover para informativo</button>
      </div>
    </div>`).join('');
  }
  inner+=bloco('Audiências agendadas',c.audiencias_agendadas,it=>`<div class="ci-item">
    <div class="ci-item-meta"><b>${esc(it.data||'')}</b> ${esc(it.hora||'')} · ${esc(it.local||'')} (${esc(it.modalidade||'')})</div>
    <div class="ci-item-ementa">${esc(it.pauta||'')}</div></div>`);
  if(!inner)inner=vazia('Sem matérias de conhecimento.');
  return secWrap('4','Conhecimento de Matérias', inner);

  function bloco(titulo,arr,fmt){
    if(!arr||!arr.length)return '';
    return `<div class="ci-item-meta" style="font-weight:700;margin:8px 0">${esc(titulo)}</div>`+arr.map(fmt).join('');
  }
}

/* Move um item entre informativos e deliberativos_administrativos,
   convertendo os campos mínimos entre os dois formatos. */
function ciReclassificar(dir,idx){
  const c=CI.data.conhecimento_materias=CI.data.conhecimento_materias||{};
  c.informativos=c.informativos||[];
  c.deliberativos_administrativos=c.deliberativos_administrativos||[];
  if(dir==='info2delib'){
    const it=c.informativos.splice(idx,1)[0]; if(!it)return;
    c.deliberativos_administrativos.push({texto:it.texto||'', requer_deliberacao:true, resultado:null, manifestacoes:it.manifestacoes||[]});
    ciToast('Movido para deliberativos administrativos.');
  } else {
    const it=c.deliberativos_administrativos.splice(idx,1)[0]; if(!it)return;
    c.informativos.push({texto:it.texto||'', manifestacoes:it.manifestacoes||[]});
    ciToast('Movido para informativos.');
  }
  ciMarcarDirty();
  ciRenderConteudo(); // re-renderiza para refletir a troca de array
}

/* ── Ordem do dia (com Fase A/B e campos de inferência) ── */
function ciRenderOrdemDia(od){
  if(!od.length)return secWrap('5','Ordem do Dia', vazia('Sem itens na ordem do dia.'));
  const inner=od.map((it,i)=>{
    const faseB = it.votacao_conclusiva===true && !it.relator && !it.parecer;
    return `<div class="ci-item" id="anc-od-${i}">
      <div class="ci-item-top">
        <span class="ci-item-tipo">${esc(_rotItem(it))}</span>
        ${badgeConclusiva(it)}
        ${it.eleicao?'<span class="badge badge-gray">eleição</span>':''}
      </div>
      <div class="ci-item-ementa ci-read-view">${esc(it.ementa||'')}</div>
      ${editEmenta(it,'od',i)}
      ${editConclusiva(it,'od',i)}
      ${(()=>{ const pr=nomeProp(it.proponente_principal); return (pr&&pr!=='—')?`<div class="ci-item-meta">Proponente: ${esc(pr)}</div>`:''; })()}
      ${ciRenderSubcomissao(it)}
      ${ciRenderCamposTipo(it)}
      ${!faseB ? editRelator(it,'od',i,'relator','Relator') : ''}
      ${editBancada(it,'od',i)}
      ${!faseB && it.relator ? `<div class="ci-item-meta">Parecer: ${esc(it.parecer||'—')}</div>` : ''}
      ${editVistaAnterior(it,'od',i)}
      ${editMaioriaSimples(it,'od',i)}
      ${ciRenderPareceresAnt(it)}
      ${ciRenderExecucao(it)}
    </div>`;
  }).join('');
  return secWrap('5','Ordem do Dia', inner);
}

/* Renderiza dados de subcomissão (RELSUB): origem, aprovação, integrantes. */
/* Campos específicos por tipo de item que não entram no fluxo comum.
   Extensível: hoje cobre RAP (audiência: local, modalidade, convidados). */
function ciRenderCamposTipo(it){
  let h='';
  if(it.tipo==='RAP'){
    const loc=[it.local,it.modalidade].filter(Boolean).join(' · ');
    if(loc)h+=`<div class="ci-item-meta"><b>Local:</b> ${esc(loc)}</div>`;
    const conv=it.convidados||[];
    if(conv.length){
      const nomes=conv.map(c=>esc(typeof c==='string'?c:(c.nome||c.orgao||''))).filter(Boolean);
      h+=`<div class="ci-item-meta"><b>Convidados (${nomes.length}):</b> ${nomes.join(' · ')}</div>`;
    }
  }
  return h;
}

function ciRenderSubcomissao(it){
  if(it.tipo!=='RELSUB' && it.tipo!=='REQSUB')return '';
  let h='';
  if(it.req_criacao||it.data_aprovacao_subcomissao){
    h+=`<div class="ci-item-meta">Subcomissão: ${it.req_criacao?'criada por '+esc(it.req_criacao):''}${it.data_aprovacao_subcomissao?` · aprovada em ${esc(ciDataBR(it.data_aprovacao_subcomissao))}`:''}</div>`;
  }
  const di=it.demais_integrantes||[];
  if(di.length){
    h+=`<div class="ci-item-meta">Demais integrantes: ${di.map(m=>esc(nomeDeRef(m))).filter(Boolean).join(' · ')}</div>`;
  }
  return h;
}

function ciRenderPareceresAnt(it){
  const pa=it.pareceres_anteriores||[];
  if(!pa.length)return '';
  return `<div class="ci-item-meta" style="margin-top:4px">Pareceres anteriores: `+
    pa.map(p=>`${esc(p.comissao||'')}: ${esc(p.parecer||'')}${p.relator?` (${esc(p.relator)})`:''}`).join(' · ')+`</div>`;
}

function nomeProp(p){
  if(!p)return '—';
  if(p.is_deputado===false)return (p.nome||'órgão')+' (órgão)';
  return nomeDeRef(p);
}

/* Badge padronizada de conclusiva:
   - Fase B (conclusiva + relator null + parecer null) → "votação conclusiva"
   - demais conclusivas → "tramitação conclusiva"
   (o termo "Fase B" é só nosso, interno; nunca vai para a tela). */
function badgeConclusiva(it){
  if(it.votacao_conclusiva!==true)return '';
  const faseB = !it.relator && !it.parecer;
  const rot = faseB ? 'votação conclusiva' : 'tramitação conclusiva';
  return `<span class="badge badge-blue">${rot}</span>`;
}

/* ══════════════════════════════════════════════════════════════════
   EDITORES ESTRUTURADOS (Nível 2) — dropdowns alimentados pelo cadastro.
   Cada editor grava direto em CI.data e chama ciMarcarDirty().
   Em modo checkout, .ci-edit-only é ocultado por CSS (viram leitura).
   ══════════════════════════════════════════════════════════════════ */

/* Opções de membros da comissão para <select> de relator/sugestão. */
function _opcoesMembros(selId){
  const mc=CI.data.membros_comissao||{};
  const ids=[...(mc.titulares||[]),...(mc.suplentes||[])].map(_idDe);
  let out=`<option value="">— não informado —</option>`;
  ids.forEach(id=>{
    const d=(typeof getDep==='function')?getDep(id):{nome:'ID '+id,partido:''};
    const sel=(String(selId)===String(id))?'selected':'';
    out+=`<option value="${id}" ${sel}>${esc(d.nome)}${d.partido?' ('+d.partido+')':''}</option>`;
  });
  return out;
}

/* Editor de relator / sugestão de relatoria. campo = 'relator'|'sugestao_relatoria' */
function editRelator(it,secKey,idx,campo,rotulo){
  const ref=it[campo];
  const atualId=ref?_idDe(ref):'';
  const nome = ref? nomeDeRef(ref) : '';
  const isInfer = (campo==='sugestao_relatoria'); // sugestão é sempre "confira"
  // Relator EXTERNO (ex.: RELSUB): tem nome mas o ID não está entre os membros.
  // Nesse caso o dropdown de membros não serve — usa campo de texto livre.
  const idNum = atualId?parseInt(atualId):null;
  const ehMembro = idNum && _idsMembros().includes(idNum);
  const externo = ref && ref.nome && !ehMembro; // nome próprio fora do quadro
  const leitura = `<div class="ci-item-meta ci-read-view"><b>${esc(rotulo)}:</b> ${nome?esc(nome):'<span class="ci-campo-vazio">não informado</span>'}${externo?' <span class="ci-selo">externo</span>':''}</div>`;
  let edicao;
  if(externo){
    edicao=`<div class="ci-edit-row ci-edit-only">
      <label>${esc(rotulo)} <span class="ci-selo">externo</span></label>
      <input type="text" value="${esc(ref.nome||'')}" placeholder="Nome do relator (externo à comissão)"
        onchange="ciSetRelatorNome('${secKey}',${idx},'${campo}',this.value)">
    </div>`;
  } else {
    edicao=`<div class="ci-edit-row ci-edit-only ${isInfer?'ci-confira':''}">
      <label>${esc(rotulo)} ${isInfer?selo():''}</label>
      <select onchange="ciSetRelator('${secKey}',${idx},'${campo}',this.value)">${_opcoesMembros(atualId)}</select>
    </div>`;
  }
  return leitura+edicao;
}
function ciSetRelatorNome(secKey,idx,campo,val){
  const it=_itemDe(secKey,idx); if(!it)return;
  val=val.trim();
  it[campo]= val? {id_assembleia:null,nome:val,partido:null} : null;
  ciMarcarDirty();
}
function _idsMembros(){
  const mc=(CI.data&&CI.data.membros_comissao)||{};
  return [...(mc.titulares||[]),...(mc.suplentes||[])].map(_idDe).map(Number);
}
function ciSetRelator(secKey,idx,campo,val){
  const it=_itemDe(secKey,idx); if(!it)return;
  if(!val){ it[campo]=null; }
  else{
    const id=parseInt(val); const d=getDep(id);
    // Formato PLANO padronizado para todos os campos de deputado (relator e sugestão).
    it[campo]={id_assembleia:id,nome:d.nome,partido:d.partido};
  }
  ciMarcarDirty();
}

/* Editor de bancada impedida (dropdown dos partidos presentes).
   Quando o roteiro NÃO traz o campo (JSONs anteriores à v2.8, e itens da OD em
   geral), sugere o valor DERIVADO do proponente — mas não grava sozinho: fica
   pré-selecionado, marcado como sugestão, e o secretário confirma no check-in.
   Órgão proponente → "nenhuma" (correto, não é omissão).
   Partido indeterminável → avisa que a vedação do Art. 61-A não pôde ser aferida. */
function editBancada(it,secKey,idx){
  const mc=CI.data.membros_comissao||{};
  const parts=new Set();
  [...(mc.titulares||[]),...(mc.suplentes||[])].map(_idDe).forEach(id=>{const d=getDep(id);if(d&&d.partido)parts.add(d.partido.toUpperCase());});

  const temCampo=!!it.bancada_impedida;
  const der=temCampo?null:_bancadaImpedidaDe(it);            // só deriva se faltar
  const sugerida=der&&der.sigla?String(der.sigla).toUpperCase():'';
  const atual=temCampo?String(it.bancada_impedida).toUpperCase():sugerida;

  /* O partido do proponente pode NÃO ter membro nesta comissão (ex.: proponente
     do PODE/MDB numa comissão sem esses partidos). A sigla precisa existir como
     opção mesmo assim — senão o valor derivado/gravado desaparece do dropdown e
     vira "nenhuma", desligando silenciosamente a vedação do Art. 61-A. */
  if(atual)parts.add(atual);

  let opts=`<option value="" ${!atual?'selected':''}>— nenhuma —</option>`;
  [...parts].sort().forEach(p=>{
    const marca=(!temCampo&&p===sugerida)?' ← sugerido (partido do proponente)':'';
    opts+=`<option value="${esc(p)}" ${p===atual?'selected':''}>${esc(p)}${marca}</option>`;
  });

  let nota='';
  if(!temCampo&&der){
    if(der.motivo==='derivado')      nota=`<div class="ci-item-meta"><span class="ci-selo">confira</span> derivado do proponente — confirme para gravar no JSON.</div>`;
    else if(der.motivo==='orgao')    nota=`<div class="ci-item-meta">Proponente é órgão: não há bancada impedida.</div>`;
    else if(der.motivo==='indeterminado') nota=`<div class="ci-item-meta" style="color:var(--warn-fg)">⚠️ Partido do proponente não identificado — a vedação do Art. 61-A <b>não</b> pôde ser conferida.</div>`;
  }

  const leitura=`<div class="ci-item-meta ci-read-view"><b>Bancada impedida:</b> ${it.bancada_impedida?esc(it.bancada_impedida):'<span class="ci-campo-vazio">nenhuma</span>'}</div>`;
  const edicao=`<div class="ci-edit-row ci-edit-only ci-confira"><label>Bancada impedida ${selo()}</label>
    <select onchange="ciSetBancada('${secKey}',${idx},this.value)">${opts}</select></div>${nota}`;
  return leitura+edicao;
}
function ciSetBancada(secKey,idx,val){ const it=_itemDe(secKey,idx); if(!it)return; it.bancada_impedida=val||null; ciMarcarDirty(); }

/* Editor de pedido de vista anterior (toggle + bancada). */
function editVistaAnterior(it,secKey,idx){
  const pv=it.pedidos_de_vista_anteriores||[];
  const tem=pv.length>0;
  // Rótulo de leitura: bancada + nome do deputado (se houver, para citação política)
  const rotulo=v=>{
    const b=v.bancada||v.partido||v.deputado?.partido||'?';
    const n=v.deputado?.nome||v.nome;
    return n? `${esc(b)} (${esc(n)})` : esc(b);
  };
  const resumo = tem? pv.map(rotulo).join(', ') : '';
  const leitura=`<div class="ci-item-meta ci-read-view"><b>Vista anterior:</b> ${tem?resumo:'<span class="ci-campo-vazio">nenhuma</span>'}</div>`;
  // Edição: bancadas (o que gera consequência regimental). Nome preservado se já existir.
  const valBancadas = tem? pv.map(v=>v.bancada||v.partido||v.deputado?.partido||'').filter(Boolean).join(', ') : '';
  const edicao=`<div class="ci-edit-row ci-edit-only ci-confira">
      <label>Vista anterior ${selo()}</label>
      <input type="text" placeholder="Bancadas que pediram vista (vírgula) ou vazio" value="${esc(valBancadas)}"
        onchange="ciSetVista('${secKey}',${idx},this.value)">
    </div>`;
  return leitura+edicao;
}
function ciSetVista(secKey,idx,val){
  const it=_itemDe(secKey,idx); if(!it)return;
  const antigos=it.pedidos_de_vista_anteriores||[];
  const partes=val.split(',').map(s=>s.trim()).filter(Boolean);
  // Formato canônico: {bancada, deputado?}. Preserva o deputado (citação política)
  // quando a bancada digitada casa com um pedido que já trazia o nome.
  it.pedidos_de_vista_anteriores = partes.map(b=>{
    const bU=b.toUpperCase();
    const anterior=antigos.find(v=>String(v.bancada||v.partido||v.deputado?.partido||'').toUpperCase()===bU);
    const dep = anterior && (anterior.deputado || (anterior.nome?{nome:anterior.nome,id_assembleia:anterior.id_assembleia||null,partido:anterior.partido||b}:null));
    return dep ? {bancada:b, deputado:dep} : {bancada:b};
  });
  ciMarcarDirty();
}

/* Editor de maioria simples (só destaca; erro é marcá-la sem base). */
/* Editor de ementa (texto livre). No check-in permite limpar instruções que a IA
   deixou no texto por engano (ex.: "tramitação conclusiva nesta comissão"). */
function editEmenta(it,secKey,idx){
  return `<div class="ci-edit-row ci-edit-only" style="align-items:flex-start">
      <label>Ementa</label>
      <textarea rows="5" style="flex:1;min-width:100%;width:100%;resize:vertical;font-family:inherit;line-height:1.4"
        onchange="ciSetEmenta('${secKey}',${idx},this.value)">${esc(it.ementa||'')}</textarea>
    </div>`;
}
function ciSetEmenta(secKey,idx,val){
  const it=_itemDe(secKey,idx); if(!it)return;
  it.ementa=val;
  ciMarcarDirty();
}
function ciSetAssunto(idx,val){
  const ag=CI.data.assuntos_gerais; if(!ag||!ag.itens||!ag.itens[idx])return;
  ag.itens[idx].assunto=val;
  ciMarcarDirty();
}

/* Editor de votação conclusiva. A IA às vezes deixa a instrução na ementa em vez de
   setar o campo — este toggle permite corrigir. */
function editConclusiva(it,secKey,idx){
  const v=it.votacao_conclusiva===true;
  return `<div class="ci-edit-row ci-edit-only">
      <label>Tramitação conclusiva</label>
      <select onchange="ciSetConclusiva('${secKey}',${idx},this.value)">
        <option value="nao" ${!v?'selected':''}>não</option>
        <option value="sim" ${v?'selected':''}>sim — conclusiva nesta comissão</option>
      </select>
    </div>`;
}
function ciSetConclusiva(secKey,idx,val){
  const it=_itemDe(secKey,idx); if(!it)return;
  it.votacao_conclusiva=(val==='sim');
  ciMarcarDirty();
  ciRenderConteudo(); // re-render: muda a badge (tramitação/votação conclusiva)
}

function editMaioriaSimples(it,secKey,idx){
  const v=!!it.maioria_simples;
  const leitura=`<div class="ci-item-meta ci-read-view"><b>Maioria simples:</b> ${v?'sim':'não'}</div>`;
  const edicao=`<div class="ci-edit-row ci-edit-only ci-confira"><label>Maioria simples ${selo()}</label>
    <select onchange="ciSetMaioria('${secKey}',${idx},this.value)">
      <option value="nao" ${!v?'selected':''}>não</option>
      <option value="sim" ${v?'selected':''}>sim (só se explícito no roteiro)</option>
    </select></div>`;
  return leitura+edicao;
}
function ciSetMaioria(secKey,idx,val){ const it=_itemDe(secKey,idx); if(!it)return; it.maioria_simples=(val==='sim'); ciMarcarDirty(); }

/* Resolve o item pelo secKey/idx para os editores. */
function _itemDe(secKey,idx){
  const d=CI.data;
  if(secKey==='od')return (d.ordem_do_dia||[])[idx];
  if(secKey==='mad')return ((d.leitura_expediente||{}).materias_a_distribuir||[])[idx];
  if(secKey==='pr')return ((d.leitura_expediente||{}).proposicoes_recebidas||[])[idx];
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   EXPORTAÇÃO — grava carimbo de revisão e baixa o JSON.
   ══════════════════════════════════════════════════════════════════ */
function ciExportar(){
  if(!CI.data)return;
  const d=CI.data;
  d.metadados=d.metadados||{};
  d.metadados.revisado_em=new Date().toISOString();
  d.metadados.revisado_via='checkin';
  const nome=(CI.nomeArquivo||'pauta').replace(/\.json$/i,'')+'_revisado.json';
  const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=nome; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  CI.dirty=false; ciAtualizarRodape();
  ciToast('Pauta revisada exportada. Substitua o arquivo e importe no sistema da reunião.');
}

/* ══════════════════════════════════════════════════════════════════
   CHECKOUT — renderização dos DADOS DE EXECUÇÃO (o que aconteceu).
   Só entram quando CI.modo==='checkout'. Forma dos dados: ver
   consolidarMeeting() no script.js (metadados.presencas_gerais,
   timeline_*, falas_sessao, ordem_apreciacao_od; item.execucao).
   ══════════════════════════════════════════════════════════════════ */

const CI_STATUS_ROT={
  aprovado:'Aprovado', rejeitado:'Rejeitado', inconclusivo:'Inconclusivo',
  aprovado_parecer_conclusivo:'Parecer conclusivo aprovado',
  vista:'Pedido de vista', reexame:'Reexame', relator_ausente:'Relator ausente',
  retirada_de_pauta:'Retirada de pauta', falta_quorum:'Prejudicado (falta de quórum)',
  em_deliberacao:'Em deliberação (não concluído)'
};

function ciRenderExecucao(it){
  if(CI.modo!=='checkout')return '';
  const ex=it.execucao;
  if(!ex || !ex.status)return `<div class="ci-item-meta ci-read-view" style="opacity:.6">Não apreciado nesta sessão.</div>`;
  const rot=CI_STATUS_ROT[ex.status]||ex.status;
  const nF=(ex.votos_favoraveis||[]).length, nC=(ex.votos_contrarios||[]).length;
  let extra='';
  if(nF||nC){
    extra+=`<div class="ci-item-meta">Votação: <b>${nF}</b> ${nF===1?'favorável':'favoráveis'} × <b>${nC}</b> ${nC===1?'contrário':'contrários'}`;
    /* voto_desempate grava {exercido,id_assembleia,nome,partido,sentido}.
       (Havia leitura de `.resultado`, campo que nunca existiu — mascarado por fallback.) */
    if(ex.voto_desempate){
      const vd=ex.voto_desempate;
      const sent=vd.sentido==='favoravel'?'favorável':(vd.sentido==='contrario'?'contrário':'—');
      extra+=` · <b>voto de desempate</b> ${esc(sent)}${vd.nome?` (${esc(vd.nome)}${vd.partido?' — '+esc(vd.partido):''})`:''}`;
    }
    extra+=`</div>`;
    const nomes=arr=>(arr||[]).map(v=>esc(v.nome||nomeDeRef(v))).join(', ');
    if(nF)extra+=`<div class="ci-item-meta" style="opacity:.8">A favor: ${nomes(ex.votos_favoraveis)}</div>`;
    if(nC)extra+=`<div class="ci-item-meta" style="opacity:.8">Contra: ${nomes(ex.votos_contrarios)}</div>`;
  }
  if(ex.autor_vista)extra+=`<div class="ci-item-meta">Vista concedida a: ${esc(ex.autor_vista.nome||nomeDeRef(ex.autor_vista))}</div>`;
  // Redistribuição (Art. 67): novo relator designado após rejeição/reexame
  if(ex.redistribuicao&&ex.redistribuicao.novo_relator){
    const nr=ex.redistribuicao.novo_relator;
    const forma=ex.redistribuicao.forma_escolha||ex.redistribuicao.forma;
    const formaTxt=forma==='preferencia'?'por preferência':(forma==='grade'?'pela grade':forma||'');
    extra+=`<div class="ci-item-meta">Redistribuído a: <b>${esc(nr.nome||nomeDeRef(nr))}</b>${formaTxt?` (${esc(formaTxt)})`:''}</div>`;
  }
  if(ex.eleito)extra+=`<div class="ci-item-meta">Eleito/indicado: ${esc(ex.eleito.nome||'')}</div>`;
  if(ex.hora_inicio_apreciacao||ex.hora_fim_apreciacao)
    extra+=`<div class="ci-item-meta" style="opacity:.7">Apreciação: ${esc(ex.hora_inicio_apreciacao||'?')} — ${esc(ex.hora_fim_apreciacao||'?')}</div>`;
  // Planilha de votação (.doc) — só quando houve votação registrada. Documento
  // por item, para anexar ao parecer no sistema corporativo.
  if(nF||nC){
    extra+=`<div style="margin-top:6px"><button class="btn btn-ghost btn-sm" onclick="ciBaixarPlanilha('${esc(String(it.id))}')">📄 Planilha de votação (.doc)</button></div>`;
  }
  return `<div class="result-card ${esc(ex.status)}" style="margin-top:8px"><b>${esc(rot)}</b>${extra?'<div style="margin-top:4px">'+extra+'</div>':''}</div>`;
}

/* Gera e baixa a planilha de votação do item (documentos.js é a fonte única). */
function ciBaixarPlanilha(itemId){
  try{
    const r=docPlanilhaVotacaoHTML(CI.data, itemId);
    if(!r){ ciToast('Este item não teve votação registrada.'); return; }
    baixarDOC(r.html, r.nome);
    ciToast('Planilha de votação (.doc) gerada.');
  }catch(e){ ciToast('Erro ao gerar planilha: '+e.message); }
}

/* Seção-resumo da sessão (só checkout): status, horários, presenças, condução. */
function ciRenderSessao(){
  if(CI.modo!=='checkout')return '';
  const md=CI.data.metadados||{};
  const fmtLista=arr=>(arr||[]).map(p=>`${esc(p.nome)}${p.partido?' ('+esc(p.partido)+')':''}`).join(' · ')||'—';
  const condutor = md.condutor_id ? nomeDeRef(md.condutor_id) : '—';

  let h=`
    <div class="ci-item-meta">
      <b>Status:</b> ${esc(md.status_sessao||'—')} ·
      <b>Início efetivo:</b> ${esc(md.hora_inicio_efetiva||'—')} ·
      <b>Encerramento:</b> ${esc(md.hora_encerramento||'—')}
      ${md.local_efetivo?` · <b>Local efetivo:</b> ${esc(md.local_efetivo)}`:''}
    </div>
    <div class="ci-item-meta" style="margin-top:4px"><b>Condução:</b> ${esc(condutor)}</div>`;

  // Trocas de condução (timeline_conducao)
  const tc=md.timeline_conducao||[];
  if(tc.length){
    const trocas=tc.map(t=>{
      const fase=(typeof _faseDeContexto==='function')?_faseDeContexto(t.contexto):null;
      return `${fase?esc(fase)+' → ':''}${esc(t.nome)}${t.partido?' ('+esc(t.partido)+')':''}`;
    }).join('; ');
    h+=`<div class="ci-item-meta" style="margin-top:2px"><b>Trocas de condução:</b> ${trocas}</div>`;
  }

  h+=`<hr class="divider">`;

  // Presenças reconstruídas (história, não resíduo)
  const pr=(typeof reconstruirPresencas==='function')?reconstruirPresencas(CI.data):null;
  if(pr){
    h+=`<div class="ci-item-meta"><b>Presentes à abertura (${pr.abertura.length}):</b> ${fmtLista(pr.abertura)}</div>`;
    if(pr.verificacaoOD)
      h+=`<div class="ci-item-meta" style="margin-top:4px"><b>Na verificação da Ordem do Dia (${pr.verificacaoOD.length}):</b> ${fmtLista(pr.verificacaoOD)}</div>`;
    if(pr.saidas.length){
      const saidasTxt=pr.saidas.map(s=>`${esc(s.nome)}${s.partido?' ('+esc(s.partido)+')':''}${s.fase?' — saiu '+esc(s.fase):(s.timestamp?' — saiu às '+esc(s.timestamp):'')}`).join(' · ');
      h+=`<div class="ci-item-meta" style="margin-top:4px"><b>Saíram durante a sessão (${pr.saidas.length}):</b> ${saidasTxt}</div>`;
    }
    if(pr.visitantes.length)
      h+=`<div class="ci-item-meta" style="margin-top:4px"><b>Outros presentes:</b> ${fmtLista(pr.visitantes)}</div>`;
  }

  // Manifestações: badge com contagem + lista colapsável
  const falas=md.falas_sessao||[];
  if(falas.length){
    h+=`<hr class="divider">
      <div class="ci-item-meta">
        <button class="btn btn-ghost btn-xs" onclick="ciToggleFalas(this)" style="margin-right:6px">▸</button>
        <b>Manifestações registradas:</b> <span class="badge badge-blue">${falas.length}</span>
      </div>
      <div id="ci-falas-lista" style="display:none;margin-top:6px;padding-left:18px">
        ${falas.map(f=>`<div class="ci-item-meta" style="opacity:.85">${esc(f.timestamp||'')} · ${esc(f.nome||nomeDeRef(f.id_assembleia))}${f.partido?' ('+esc(f.partido)+')':''}${f.contexto?` <span style="opacity:.6">— ${esc(String(f.contexto).split('—')[0].trim())}</span>`:''}</div>`).join('')}
      </div>`;
  }

  return secWrap('','Resumo da Sessão', h);
}

/* Expande/colapsa a lista de manifestações na tela do checkout. */
function ciToggleFalas(btn){
  const lista=ciEl('ci-falas-lista');
  if(!lista)return;
  const aberto=lista.style.display!=='none';
  lista.style.display=aberto?'none':'block';
  btn.textContent=aberto?'▸':'▾';
}

/* ══════════════════════════════════════════════════════════════════
   LEITURA TÉCNICA (JSON read-only) — visibilidade total sem risco.
   Mostra o JSON completo formatado com realce leve, feito à mão
   (sem dependência de CDN, fiel à arquitetura do projeto). NÃO edita:
   para diagnosticar o que a IA gerou em campos que o modo base não expõe.
   ══════════════════════════════════════════════════════════════════ */
let CI_VISAO='guiada'; // 'guiada' | 'json'

function ciToggleVisao(){
  CI_VISAO = CI_VISAO==='guiada' ? 'json' : 'guiada';
  const guiada=CI_VISAO==='guiada';
  ciEl('ci-conteudo-inner').style.display=guiada?'':'none';
  ciEl('ci-json-view').style.display=guiada?'none':'';
  const btn=ciEl('ci-visao');
  btn.textContent = guiada ? '⌁ Ver JSON' : '↩ Voltar à visão guiada';
  if(!guiada)ciRenderJSON();
}

function ciRenderJSON(){
  const view=ciEl('ci-json-view');
  if(!CI.data){ view.textContent='(nenhum arquivo carregado)'; return; }
  const hint=`<div class="ci-json-hint">Leitura técnica — somente visualização. Para editar campos, use a visão guiada; para casos raros fora do editor, edite o arquivo no seu computador.</div>`;
  view.innerHTML=hint+_jsonHighlight(JSON.stringify(CI.data,null,2));
}

/* Realce mínimo de JSON já formatado (string vinda de JSON.stringify). */
function _jsonHighlight(json){
  // escapa HTML primeiro
  json=json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // aplica classes por token
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (m)=>{
      let cls='jn';
      if(/^"/.test(m)) cls=/:$/.test(m)?'jk':'js';
      else if(/true|false|null/.test(m)) cls='jb';
      return `<span class="${cls}">${m}</span>`;
    }
  );
}
