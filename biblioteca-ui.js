'use strict';
/* ══════════════════════════════════════════════════════════════════
   biblioteca-ui.js — Camada de interface da Biblioteca de Reuniões.
   Separada de biblioteca.js (lógica pura, testável sem browser) para
   manter o mesmo padrão do resto do projeto: núcleo + UI.
   ══════════════════════════════════════════════════════════════════ */

const BUI = { visAtiva:'presencas' };

function blEl(id){ return document.getElementById(id); }
function blEsc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── TEMA ──────────────────────────────────────────────────────────*/
function blToggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')||'light';
  const novo=cur==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme',novo);
  try{ localStorage.setItem('ui_theme',novo); }catch(e){}
}

/* ── CARGA DE ARQUIVOS ─────────────────────────────────────────────*/
function blLerArquivos(fileList){
  const arquivos=[...fileList];
  let pendentes=arquivos.length;
  if(!pendentes) return;
  const erros=[];
  arquivos.forEach(file=>{
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const obj=JSON.parse(rd.result);
        const v=bibValidarMeeting(obj);
        if(!v.ok){ erros.push(`${file.name}: ${v.erro}`); }
        else bibAdicionar(obj, file.name);
      }catch(e){ erros.push(`${file.name}: JSON inválido`); }
      if(--pendentes===0) blAposCarga(erros);
    };
    rd.onerror=()=>{ erros.push(`${file.name}: falha de leitura`); if(--pendentes===0) blAposCarga(erros); };
    rd.readAsText(file);
  });
}

function blAposCarga(erros){
  blRenderKPIs();
  blRenderIndice();
  blRenderVisao();
  if(erros && erros.length){
    alert('Alguns arquivos não foram carregados:\n\n'+erros.join('\n'));
  }
}

/* Faixa de KPIs (gestão). Escondida quando não há reuniões. */
function blRenderKPIs(){
  const box=blEl('bl-kpis');
  if(!BIB.reunioes.length){ box.style.display='none'; box.innerHTML=''; return; }
  const kpis=bibKPIs();
  box.style.display='grid';
  box.innerHTML=kpis.map(k=>{
    // Destaque de alerta no KPI de sessões sem quórum quando houver alguma.
    const alerta=(k.rotulo.startsWith('Sessões sem quórum') && k.valor!=='0')?' alerta':'';
    return `<div class="bl-kpi${alerta}">
      <div class="bl-kpi-val">${blEsc(k.valor)}</div>
      <div class="bl-kpi-rot">${blEsc(k.rotulo)}</div>
      <div class="bl-kpi-sub">${blEsc(k.sub||'')}</div>
    </div>`;
  }).join('');
}

/* ── ÍNDICE ────────────────────────────────────────────────────────*/
function blRenderIndice(){
  const n=BIB.reunioes.length;
  blEl('bl-idx-n').textContent=n;
  blEl('bl-idx-sec').style.display = n?'block':'none';
  blEl('bl-vis-sec').style.display = n?'block':'none';
  blEl('bl-empty').style.display   = n?'none':'block';

  const body=blEl('bl-idx-body');
  body.innerHTML = BIB.reunioes.map(r=>{
    const m=r.meta;
    const qAb=m.quorumAbertura?'<span class="bl-pill ok">Sim</span>':'<span class="bl-pill no">Não</span>';
    const qOD = m.quorumOD===true?'<span class="bl-pill ok">Sim</span>'
              : m.quorumOD===false?'<span class="bl-pill no">Não</span>'
              : '<span class="bl-pill no">—</span>';
    return `<tr>
      <td>${blEsc(bibFmtDataLonga(m.data))}</td>
      <td><span class="bl-com">${blEsc(m.sigla)}</span> <span style="color:var(--text-faint)">${blEsc(m.comissao)}</span></td>
      <td>${blEsc(m.tipo)}</td>
      <td>${qAb}</td>
      <td>${qOD}</td>
      <td>${m.nItensOD}</td>
      <td><span class="bl-x" title="Remover" onclick="blRemover(${r.id})">✕</span></td>
    </tr>`;
  }).join('');

  // Aviso de comissões misturadas
  const siglas=[...new Set(BIB.reunioes.map(r=>r.meta.sigla).filter(Boolean))];
  const av=blEl('bl-aviso-com');
  av.innerHTML = siglas.length>1
    ? `<div class="bl-aviso">⚠️ Há reuniões de <b>comissões diferentes</b> carregadas (${blEsc(siglas.join(', '))}). Os relatórios cruzam todas — confira se é isso que deseja.</div>`
    : '';
}

function blRemover(id){ bibRemover(id); blRenderKPIs(); blRenderIndice(); blRenderVisao(); }
function blLimparTudo(){
  if(!BIB.reunioes.length) return;
  if(!confirm('Remover todas as reuniões carregadas?')) return;
  bibLimpar(); blRenderKPIs(); blRenderIndice(); blRenderVisao();
}

/* ── VISÕES ────────────────────────────────────────────────────────*/
function blRenderVisao(){
  const alvo=blEl('bl-vis-conteudo');
  if(!BIB.reunioes.length){ alvo.innerHTML=''; return; }
  if(BUI.visAtiva==='presencas') alvo.innerHTML=blRenderPresencas();
  else if(BUI.visAtiva==='assiduidade') alvo.innerHTML=blRenderAssiduidade();
  else if(BUI.visAtiva==='fluxo') alvo.innerHTML=blRenderFluxo();
  else if(BUI.visAtiva==='relatoria') alvo.innerHTML=blRenderRelatoria();
}

function blBarClasse(pct){ return pct==null?'':(pct>=75?'hi':pct>=50?'mid':'lo'); }

function blRenderAssiduidade(){
  const a=bibAssiduidade();
  if(!a.deputados.length) return `<p class="bl-empty">Sem dados de assiduidade.</p>`;

  const linhasDep=a.deputados.map(d=>{
    const pct=d.pct==null?'—':`${d.pct}%`;
    const w=d.pct==null?0:d.pct;
    return `<tr>
      <td class="bl-nome">${blEsc(d.nome)}</td>
      <td class="bl-part">${blEsc(d.partido)}</td>
      <td style="width:38%"><div class="bl-bar ${blBarClasse(d.pct)}"><span style="width:${w}%"></span></div></td>
      <td class="bl-num">${d.presentes}/${d.elegiveis}</td>
      <td class="bl-num">${pct}</td>
    </tr>`;
  }).join('');

  const linhasBanc=a.bancadas.map(b=>{
    const pct=b.pct==null?'—':`${b.pct}%`;
    const w=b.pct==null?0:b.pct;
    return `<tr>
      <td class="bl-nome">${blEsc(b.partido)}</td>
      <td style="width:44%"><div class="bl-bar ${blBarClasse(b.pct)}"><span style="width:${w}%"></span></div></td>
      <td class="bl-num">${b.presentes}/${b.elegiveis}</td>
      <td class="bl-num">${pct}</td>
    </tr>`;
  }).join('');

  return `
    <p class="bl-hint">Assiduidade sobre ${a.nReunioes} reuniõe${a.nReunioes>1?'s':''} carregada${a.nReunioes>1?'s':''}. O denominador é o nº de reuniões em que cada um era titular (não conta datas em que não integrava a comissão).</p>
    <div class="bl-sec-titulo">Por deputado</div>
    <div class="bl-card" style="padding:4px 0">
      <table class="bl-assi">
        <thead><tr><th>Deputado</th><th>Partido</th><th>Presença</th><th class="bl-num">Presenças</th><th class="bl-num">%</th></tr></thead>
        <tbody>${linhasDep}</tbody>
      </table>
    </div>
    <div class="bl-sec-titulo" style="margin-top:20px">Por bancada</div>
    <div class="bl-card" style="padding:4px 0">
      <table class="bl-assi">
        <thead><tr><th>Bancada</th><th>Presença</th><th class="bl-num">Presenças</th><th class="bl-num">%</th></tr></thead>
        <tbody>${linhasBanc}</tbody>
      </table>
    </div>`;
}

function blRenderPresencas(){
  const mx=bibMatrizPresencas();
  if(!mx.colunas.length) return `<p class="bl-empty">Sem reuniões para montar a matriz.</p>`;

  const th = mx.colunas.map(c=>`<th title="${blEsc(c.sigla)}">${blEsc(c.rotulo)}</th>`).join('');
  const linhas = mx.linhas.map(l=>{
    const tds = l.celulas.map(v=>{
      const cls = v==='P'?'p' : v==='F'?'f' : 'na';
      return `<td class="${cls}">${v}</td>`;
    }).join('');
    return `<tr>
      <td class="bl-dep">${blEsc(l.nome)}</td>
      <td class="bl-part">${blEsc(l.partido)}</td>
      ${tds}
      <td class="bl-tot">${l.totalP}/${l.totalTitular}</td>
    </tr>`;
  }).join('');

  // Rodapé: total de presentes por reunião (coluna)
  const totCol = mx.colunas.map((c,ci)=>{
    let p=0,t=0;
    mx.linhas.forEach(l=>{ if(l.celulas[ci]==='P')p++; if(l.celulas[ci]!=='—')t++; });
    return `<td class="bl-tot">${p}/${t}</td>`;
  }).join('');

  return `
    <p class="bl-hint">P = presença registrada em qualquer momento · F = titular ausente · — = não era titular naquela reunião. Selecione a tabela para copiar.</p>
    <div class="bl-card bl-matriz-wrap">
      <table class="bl-matriz">
        <thead><tr><th class="bl-dep">Deputado</th><th class="bl-part">Partido</th>${th}<th>Total</th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td class="bl-dep">Presentes</td><td></td>${totCol}<td></td></tr></tfoot>
      </table>
    </div>`;
}

function blGrupoLabel(g){
  return g==='proposicao'?'Proposições'
       : g==='requerimento'?'Requerimentos e audiências'
       : g==='subcomissao'?'Subcomissões'
       : 'Outros';
}

function blRenderFluxo(){
  const fl=bibFluxo();

  // Bloco 1 — os dois números do semestre
  const numeros=`
    <div class="bl-kpis" style="grid-template-columns:repeat(2,1fr);margin:4px 0 18px">
      <div class="bl-kpi"><div class="bl-kpi-val">${fl.distribuidas}</div>
        <div class="bl-kpi-rot">Matérias distribuídas a relatores</div>
        <div class="bl-kpi-sub">no período carregado</div></div>
      <div class="bl-kpi"><div class="bl-kpi-val">${fl.pareceresAprovados}</div>
        <div class="bl-kpi-rot">Pareceres aprovados</div>
        <div class="bl-kpi-sub">PL, PLC, PEC, VP, RDI · requerimentos não contam</div></div>
    </div>`;

  // Bloco 2 — balanço por tipo, agrupado, com subtotais
  let corpoTipo='', grupoAtual=null, sub=null;
  const flush=()=>{
    if(sub){
      corpoTipo+=`<tr class="bl-subtotal"><td>${blGrupoLabel(grupoAtual)} — subtotal</td>
        <td class="bl-num">${sub.d}</td><td class="bl-num">${sub.ap}</td>
        <td class="bl-num">${sub.av}</td><td class="bl-num">${sub.po}</td></tr>`;
    }
  };
  fl.linhasTipo.forEach(t=>{
    if(t.grupo!==grupoAtual){
      flush();
      grupoAtual=t.grupo; sub={d:0,ap:0,av:0,po:0};
      corpoTipo+=`<tr class="bl-grupo"><td colspan="5">${blGrupoLabel(grupoAtual)}</td></tr>`;
    }
    sub.d+=t.distribuidas; sub.ap+=t.apreciadas; sub.av+=t.aprovados; sub.po+=t.postergadas;
    corpoTipo+=`<tr>
      <td class="bl-nome" style="padding-left:22px">${blEsc(t.tipo)}</td>
      <td class="bl-num">${t.distribuidas}</td>
      <td class="bl-num">${t.apreciadas}</td>
      <td class="bl-num">${t.aprovados}</td>
      <td class="bl-num">${t.postergadas}</td></tr>`;
  });
  flush();
  const balanco = fl.linhasTipo.length ? `
    <div class="bl-sec-titulo">Balanço por tipo de matéria</div>
    <div class="bl-card" style="padding:4px 0">
      <table class="bl-assi">
        <thead><tr><th>Tipo</th><th class="bl-num">Distribuídas</th><th class="bl-num">Apreciadas</th>
          <th class="bl-num">Aprovadas</th><th class="bl-num">Postergadas</th></tr></thead>
        <tbody>${corpoTipo}</tbody>
      </table>
    </div>` : '';

  // Bloco 3 — as duas filas
  const filaEnvio = fl.aguardandoParecer.length ? `
    <table class="bl-assi">
      <thead><tr><th>Matéria</th><th>Proponente</th><th>Relator</th><th>Distribuída em</th></tr></thead>
      <tbody>${fl.aguardandoParecer.map(x=>`<tr>
        <td class="bl-nome">${blEsc(x.titulo)}</td><td>${blEsc(x.proponente)}</td>
        <td>${blEsc(x.relator)}${x.relatorPartido?` (${blEsc(x.relatorPartido)})`:''}</td>
        <td>${x.dataDistrib?blEsc(bibFmtDataLonga(x.dataDistrib)):'—'}</td></tr>`).join('')}</tbody>
    </table>` : `<p class="bl-empty" style="padding:16px 0">Nenhuma matéria distribuída aguardando parecer, dentro das reuniões carregadas.</p>`;

  const filaApreciacao = fl.aguardandoApreciacao.length ? `
    <table class="bl-assi">
      <thead><tr><th>Matéria</th><th>Proponente</th><th>Relator</th><th>Parecer</th></tr></thead>
      <tbody>${fl.aguardandoApreciacao.map(x=>`<tr>
        <td class="bl-nome">${blEsc(x.titulo)}</td><td>${blEsc(x.proponente)}</td>
        <td>${blEsc(x.relator)}${x.relatorPartido?` (${blEsc(x.relatorPartido)})`:''}</td>
        <td>${x.parecer?blEsc(x.parecer):'—'}</td></tr>`).join('')}</tbody>
    </table>` : '';

  return `
    ${numeros}
    ${balanco}
    <div class="bl-aviso" style="margin-top:20px">⚠️ As filas abaixo cobrem apenas matérias distribuídas nas reuniões carregadas. Distribuições anteriores ao período não aparecem — o quadro se completa conforme o estoque antigo é apreciado.</div>
    <div class="bl-sec-titulo">Aguardando envio do parecer do relator</div>
    <div class="bl-card" style="padding:4px 0">${filaEnvio}</div>
    ${fl.aguardandoApreciacao.length?`
      <div class="bl-sec-titulo" style="margin-top:20px">Parecer entregue — aguardando apreciação</div>
      <div class="bl-card" style="padding:4px 0">${filaApreciacao}</div>`:''}`;
}

function blRenderRelatoria(){
  const rel=bibRelatoria();
  if(!rel.relatores.length)
    return `<p class="bl-empty">Nenhuma relatoria de proposição (PL, PLC, PEC, VP, RDI) registrada nas reuniões carregadas.</p>`;

  const linhas=rel.relatores.map(r=>{
    const pct = r.apreciadas? Math.round((r.aprovadas/r.apreciadas)*100) : null;
    return `<tr>
      <td class="bl-nome">${blEsc(r.nome)}${r.externo?' <span class="bl-part">(externo)</span>':''}</td>
      <td class="bl-part">${blEsc(r.partido||'—')}</td>
      <td class="bl-num">${r.total}</td>
      <td class="bl-num">${r.aguardando}</td>
      <td class="bl-num">${r.apreciadas}</td>
      <td class="bl-num">${r.aprovadas}</td>
    </tr>`;
  }).join('');

  return `
    <p class="bl-hint">Carga de relatorias sobre ${rel.nReunioes} reuniõe${rel.nReunioes>1?'s':''}. Conta só matérias que geram parecer (PL, PLC, PEC, VP, RDI). "Aguardando" = distribuída e ainda não apreciada.</p>
    <div class="bl-card" style="padding:4px 0">
      <table class="bl-assi">
        <thead><tr><th>Relator</th><th>Partido</th><th class="bl-num">Relatorias</th>
          <th class="bl-num">Aguardando</th><th class="bl-num">Apreciadas</th><th class="bl-num">Aprovadas</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

/* ── LISTENERS ─────────────────────────────────────────────────────*/
function blInit(){
  const fi=blEl('bl-file');
  blEl('bl-add').onclick=()=>fi.click();
  blEl('bl-drop').onclick=()=>fi.click();
  blEl('bl-limpar').onclick=blLimparTudo;
  blEl('bl-theme').onclick=blToggleTheme;
  fi.onchange=()=>{ blLerArquivos(fi.files); fi.value=''; };

  const drop=blEl('bl-drop');
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
  drop.addEventListener('drop',e=>{ if(e.dataTransfer?.files) blLerArquivos(e.dataTransfer.files); });

  document.querySelectorAll('.bl-tab').forEach(t=>t.addEventListener('click',()=>{
    document.querySelectorAll('.bl-tab').forEach(x=>x.classList.remove('ativa'));
    t.classList.add('ativa');
    BUI.visAtiva=t.dataset.vis;
    blRenderVisao();
  }));

  // Cadastros (para nome/partido). Degrada para fallback embutido.
  if(typeof carregarCadastros==='function'){
    carregarCadastros().then(()=>{
      const f=(typeof descrFonteCadastros==='function')?descrFonteCadastros():null;
      if(f) blEl('bl-cad-fonte').textContent=`Cadastro: ${f.dep}`;
    });
  }
}
document.addEventListener('DOMContentLoaded',blInit);
