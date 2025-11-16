// ===================== Utilidades BR =====================
const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const fmtDate = (d) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);

function parseBRNumber(str) {
  if (!str) return 0;
  const s = String(str)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

// ===================== Máscaras =====================

// Máscara de moeda BRL (2 casas)
function attachBRLMask(el) {
  if (!el) return;

  el.addEventListener("input", () => {
    let dg = el.value.replace(/\D/g, "");
    if (!dg) {
      el.value = "";
      return;
    }
    dg = dg.substring(0, 13);
    const val = (parseInt(dg, 10) / 100).toFixed(2);
    el.value = fmtBRL.format(val);
  });

  el.addEventListener("blur", () => {
    const v = parseBRNumber(el.value);
    el.value = v === 0 ? "" : fmtBRL.format(v);
  });
}

/**
 * Máscara percentual:
 * - aceita vírgula ou ponto enquanto digita (não trava);
 * - permite até maxInt dígitos inteiros e maxDec decimais;
 * - no blur formata com fixedOnBlur casas decimais (padrão: 4).
 */
function attachPercentMask(
  el,
  { maxInt = 5, maxDec = 6, fixedOnBlur = 4 } = {}
) {
  if (!el) return;

  el.addEventListener("input", (e) => {
    let v = e.target.value;

    // só dígitos, vírgula e ponto
    v = v.replace(/[^\d.,]/g, "");

    // Se começar com vírgula ou ponto -> "0,"
    if (v.startsWith(",") || v.startsWith(".")) {
      v = "0" + v;
    }

    // garante apenas um separador
    const firstSep = v.search(/[.,]/);
    if (firstSep !== -1) {
      const sep = v[firstSep];
      let inteiros = v.slice(0, firstSep).replace(/\D/g, "");
      let decimais = v.slice(firstSep + 1).replace(/\D/g, "");

      inteiros = inteiros.slice(0, maxInt);
      decimais = decimais.slice(0, maxDec);

      if (decimais.length > 0) {
        v = `${inteiros}${sep}${decimais}`;
      } else {
        v = `${inteiros}${sep}`;
      }
    } else {
      // sem separador: só inteiros
      v = v.replace(/\D/g, "").slice(0, maxInt);
    }

    e.target.value = v;
  });

  el.addEventListener("blur", (e) => {
    let v = e.target.value.trim();
    if (!v) return;

    // tira separador no final (ex.: "7," -> "7")
    v = v.replace(/[,\.]$/, "");

    const num = parseBRNumber(v);
    if (isNaN(num)) {
      e.target.value = "";
      return;
    }

    if (fixedOnBlur != null) {
      e.target.value = num.toFixed(fixedOnBlur).replace(".", ",");
    } else {
      // mantém quantas casas tiver, só normalizando vírgula
      e.target.value = String(num).replace(".", ",");
    }
  });
}

// ===================== TR automática (LENDO DO CACHE LOCAL) =====================

/**
 * Carrega a TR histórica do arquivo local 'tr_historico_cache.json'
 * e retorna APENAS o mapa filtrado para o período relevante.
 */
async function obterTRMensalMapa(dataInicial, dataFinal) {
  // A URL aponta para o seu arquivo de cache local
  const urlCache = 'tr_historico_cache.json';
  
  // O fetch pode falhar se o arquivo não existir.
  const resp = await fetch(urlCache);
  if (!resp.ok) {
    // Retorna erro informando que o cache não foi encontrado (e não mais o 404 do BCB)
    throw new Error(`Erro ao carregar o cache TR. Verifique se ${urlCache} existe.`);
  }

  const dadosHistoricos = await resp.json(); 
  const mapaFiltrado = {};
  
  // Convertemos as datas de referência para o formato de comparação
  const dataInicioTs = dataInicial.getTime();
  const dataFinalTs = dataFinal.getTime();

  // Filtra o cache para o período que o cálculo realmente precisa.
  for (const chave in dadosHistoricos) {
    // Chave é "AAAA-MM"
    const [ano, mes] = chave.split('-').map(Number);
    // Cria um objeto Date para o primeiro dia do mês na chave (UTC)
    const dataChave = new Date(Date.UTC(ano, mes - 1, 1)); 

    if (dataChave.getTime() >= dataInicioTs && dataChave.getTime() <= dataFinalTs) {
      mapaFiltrado[chave] = dadosHistoricos[chave];
    }
  }

  return mapaFiltrado;
}


// ===================== Cálculos =====================

function mensalDeAnual(aa) {
  const a = (aa || 0) / 100;
  return Math.pow(1 + a, 1 / 12) - 1;
}

function pmtPrice(P, i, n) {
  if (i === 0) return P / n;
  const f = Math.pow(1 + i, n);
  return (P * (i * f)) / (f - 1);
}

function monthIndexFromDate(startUTC, whenUTC) {
  const y1 = startUTC.getUTCFullYear(),
    m1 = startUTC.getUTCMonth();
  const y2 = whenUTC.getUTCFullYear(),
    m2 = whenUTC.getUTCMonth();
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

/**
 * Agora com TR automática OPCIONAL e média futura:
 * - mapaTR é { "AAAA-MM": fração } ou null
 * - mediaTRFutura é usada para meses não encontrados no mapaTR.
 */
function gerarCronograma({
  principal,
  iMes,
  nMeses,
  sistema,
  extras,
  extraMensal,
  seguroTaxa,
  data0,
  mapaTR,
  mediaTRFutura = 0, // Adicionado como argumento
}) {
  const linhas = [];
  let saldo = principal;
  let prestacaoFixa =
    sistema === "price"
      ? Math.round(pmtPrice(principal, iMes, nMeses) * 100) / 100
      : 0;
  const amortConstante =
    sistema === "sac"
      ? Math.round((principal / nMeses) * 100) / 100
      : 0;

  const extrasPorMes = {};
  (extras || []).forEach((ex) => {
    const k = ex.mes;
    extrasPorMes[k] = (extrasPorMes[k] || 0) + ex.valor;
  });

  let totalJuros = 0,
    totalPago = 0,
    mesesExecutados = 0;

  for (let m = 1; m <= nMeses && saldo > 0.005; m++) {
    const data = data0
      ? new Date(
          Date.UTC(
            data0.getUTCFullYear(),
            data0.getUTCMonth() + m - 1,
            data0.getUTCDate()
          )
        )
      : null;

    // === APLICA TR DO MÊS (se existir ou se for futuro com média) AO SALDO ===
    let trMes = 0;
    if (data && mapaTR) {
      const chaveMes = `${data.getUTCFullYear()}-${String(
        data.getUTCMonth() + 1
      ).padStart(2, "0")}`;
      
      // 1. Tenta obter a TR histórica (mapaTR[chaveMes] existe)
      trMes = mapaTR[chaveMes];
      
      // 2. Se for undefined (mês futuro), usa a média.
      if (trMes === undefined) {
        trMes = mediaTRFutura;
      }
    }
    
    if (trMes !== 0 && trMes !== undefined) {
      saldo = Math.round(saldo * (1 + trMes) * 100) / 100;
    }


    const juros = Math.round(saldo * iMes * 100) / 100;
    let amort = 0,
      prest = 0,
      taxas = Math.round(seguroTaxa * 100) / 100;

    if (sistema === "price") {
      prest = prestacaoFixa + taxas;
      amort = Math.min(prestacaoFixa - juros, saldo);
    } else {
      amort = Math.min(amortConstante, saldo);
      prest = amort + juros + taxas;
    }

    const extraAlvo = (extrasPorMes[m] || 0) + (extraMensal || 0);
    const extra = Math.min(
      Math.round(extraAlvo * 100) / 100,
      Math.max(0, saldo - amort)
    );

    const pagoNoMes = prest + extra;
    saldo = Math.max(
      0,
      Math.round((saldo - amort - extra) * 100) / 100
    );
    totalJuros += juros;
    totalPago += pagoNoMes;
    mesesExecutados = m;

    linhas.push({
      mes: m,
      data: data ? fmtDate(data) : "—",
      prestacao: prest,
      amortizacao: amort,
      juros: juros,
      taxas: taxas,
      extra: extra,
      saldo: saldo,
    });

    if (saldo <= 0.005) break;
  }

  return {
    linhas,
    totalJuros: Math.round(totalJuros * 100) / 100,
    totalPago: Math.round(totalPago * 100) / 100,
    mesesExecutados,
  };
}

// ===================== Gráfico anual (Canvas 2D) =====================
function desenharGraficoAnual(canvas, linhas, data0) {
  const ctx = canvas.getContext("2d");
  const W = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const H = (canvas.height = canvas.clientHeight * devicePixelRatio);

  ctx.clearRect(0, 0, W, H);
  if (!linhas.length) return;

  const series = {};
  linhas.forEach((l, idx) => {
    let ano = "Sem data";
    if (data0) {
      const d = new Date(
        Date.UTC(
          data0.getUTCFullYear(),
          data0.getUTCMonth() + idx,
          data0.getUTCDate()
        )
      );
      ano = d.getUTCFullYear();
    }
    series[ano] = series[ano] || { juros: 0, amort: 0 };
    series[ano].juros += l.juros;
    series[ano].amort += l.amortizacao + l.extra;
  });

  const anos = Object.keys(series).map((a) => String(a));
  const maxV = Math.max(
    1,
    ...anos.map((a) => series[a].juros + series[a].amort)
  );

  const padL = 50 * devicePixelRatio,
    padB = 28 * devicePixelRatio,
    padT = 20 * devicePixelRatio;
  const usableW = W - padL - 20 * devicePixelRatio;
  const usableH = H - padT - padB;
  const barW = Math.max(
    14 * devicePixelRatio,
    usableW / (anos.length * 1.8)
  );

  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1 * devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - 20 * devicePixelRatio, H - padB);
  ctx.stroke();

  anos.forEach((a, i) => {
    const x = padL + (i + 0.5) * (usableW / anos.length);
    const hA = (series[a].amort / maxV) * usableH;
    const hJ = (series[a].juros / maxV) * usableH;

    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(x - barW / 2, H - padB - hA, barW, hA);

    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(x - barW / 2, H - padB - hA - hJ, barW, hJ);

    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${12 * devicePixelRatio}px sans-serif`;
    ctx.fillText(a, x, H - padB + 6 * devicePixelRatio);
  });
}

// ===================== CSV, Link e PDF =====================
function toCSV(linhas) {
  const header = [
    "Mes",
    "Data",
    "Prestacao",
    "Amortizacao",
    "Juros",
    "Taxas",
    "Extra",
    "Saldo",
  ];
  const rows = linhas.map((l) => [
    l.mes,
    l.data,
    l.prestacao.toFixed(2),
    l.amortizacao.toFixed(2),
    l.juros.toFixed(2),
    l.taxas.toFixed(2),
    l.extra.toFixed(2),
    l.saldo.toFixed(2),
  ]);
  const csv =
    [header.join(";")].concat(rows.map((r) => r.join(";"))).join("\n");
  return new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });
}

function copiarLink(params) {
  const url = new URL(location.href);
  Object.entries(params).forEach(([k, v]) =>
    url.searchParams.set(k, String(v))
  );
  navigator.clipboard.writeText(url.toString());
  alert("Link copiado!");
}

function exportarPDF() {
  window.print();
}

// ===================== Controle da UI =====================

// Note: As referências a elementos e funções de inicialização (el, attachBRLMask, etc.)
// devem estar definidas no arquivo amortizacao.html ou em outro script.
// A função calcular foi integrada aqui para o fluxo completo.

// Função auxiliar para obter elementos (necessária para calcular)
const $ = (sel) => document.querySelector(sel);
const el = {
  form: $("#amortForm"),
  principal: $("#principal"),
  periodo: $("#periodo"),
  sistema: $("#sistema"),
  tipoTaxa: $("#tipoTaxa"),
  dataInicio: $("#dataInicio"),
  rate: $("#rate"),
  extraMensal: $("#extraMensal"),
  extraValor: $("#extraValor"),
  extraData: $("#extraData"),
  addExtra: $("#addExtra"),
  extrasChips: $("#extrasChips"),
  seguroTaxa: $("#seguroTaxa"),
  prestacaoIni: $("#prestacaoIni"),
  totalPago: $("#totalPago"),
  totalJuros: $("#totalJuros"),
  mesesQuitados: $("#mesesQuitados"),
  tabela: $("#tabela tbody"),
  grafico: $("#grafico"),
  baixarCsv: $("#baixarCsv"),
  copiarLinkBtn: $("#copiarLink"),
  baixarPdf: $("#baixarPdf"),
  usarTR: $("#usarTR"), 
};

// Funções de UI (renderExtrasChips, paramsAtuais, lerDoQuery) omitidas para foco no cálculo,
// mas assumimos que estão no amortizacao.html para fins de funcionalidade.

// ==== CÁLCULO PRINCIPAL (COM CORREÇÃO DE DATA PARA TR E MÉDIA DE 4 ANOS) ====
async function calcular() {
  const principal = parseBRNumber(el.principal.value);
  const taxa = parseBRNumber(el.rate.value);
  const nMeses = parseInt(el.periodo.value || "0", 10);
  const sistema = el.sistema.value;
  const tipoTaxa = el.tipoTaxa.value;
  const seguroTaxa = parseBRNumber(el.seguroTaxa.value);
  const extraMensal = parseBRNumber(el.extraMensal.value);

  let data0 = null;
  if (el.dataInicio.value) {
    const [Y, M, D] = el.dataInicio.value.split("-").map(Number);
    if (Y && M && D) {
      data0 = new Date(Date.UTC(Y, M - 1, D));
    }
  }

  if (!(principal > 0) || !(nMeses > 0)) {
    // Limpa resultados em caso de dados inválidos
    const empty = "R$ 0,00";
    if (el.prestacaoIni) el.prestacaoIni.textContent = empty;
    if (el.totalPago) el.totalPago.textContent = empty;
    if (el.totalJuros) el.totalJuros.textContent = empty;
    if (el.mesesQuitados) el.mesesQuitados.textContent = "0";
    if (el.tabela) el.tabela.innerHTML = "";
    return;
  }

  const iMes = tipoTaxa === "aa" ? mensalDeAnual(taxa) : taxa / 100;

  // === TR MENSAL AUTOMÁTICA OPCIONAL ===
  let mapaTR = null;
  let mediaTRFutura = 0; // Inicializa a média da TR
  const usarTR = el.usarTR && el.usarTR.checked;

  if (usarTR && data0 && nMeses > 0) {
    try {
      const dataAtual = new Date();
      const dataLimiteBusca = new Date(Date.UTC(dataAtual.getUTCFullYear(), dataAtual.getUTCMonth(), 1));
      
      // Limite para busca no cache (Geral)
      const dataLimiteHistoricaGeral = new Date(Date.UTC(dataAtual.getUTCFullYear() - 5, dataAtual.getUTCMonth(), 1));
      
      // Limite para cálculo da MÉDIA (últimos 4 anos)
      const anosMedia = 4;
      const dataInicioMedia = new Date(Date.UTC(dataAtual.getUTCFullYear() - anosMedia, dataAtual.getUTCMonth(), 1));

      // Data de INÍCIO da busca da TR (para todo o período necessário)
      let dataInicioBusca = data0;
      
      if (data0 > dataLimiteBusca) {
          dataInicioBusca = dataLimiteBusca; // Se o financiamento é futuro, só buscamos até hoje
      }
      
      if (dataInicioBusca < dataLimiteHistoricaGeral) {
          dataInicioBusca = dataLimiteHistoricaGeral; // Limite o passado para estabilidade
      }
      
      const dataInicioReal = dataInicioBusca;
      const dataFimReal = dataLimiteBusca; // A busca de dados reais é sempre até hoje
      
      
      if (dataInicioReal < dataFimReal) {
          console.log(`Buscando TR no cache local de ${fmtDate(dataInicioReal)} até ${fmtDate(dataFimReal)}`);
          
          // Obtém todo o mapa da TR (do cache local)
          mapaTR = await obterTRMensalMapa(dataInicioReal, dataFimReal);
          
          // *** CÁLCULO DA MÉDIA PARA OS ÚLTIMOS 4 ANOS (Projeção Futura) ***
          const trValuesParaMedia = [];
          const dataInicioMediaTs = dataInicioMedia.getTime();
          
          for (const chave in mapaTR) {
              const [ano, mes] = chave.split('-').map(Number);
              const dataMes = new Date(Date.UTC(ano, mes - 1, 1));
              
              // Filtra apenas os meses dentro da janela de 4 anos
              if (dataMes.getTime() >= dataInicioMediaTs) {
                  trValuesParaMedia.push(mapaTR[chave]);
              }
          }

          if (trValuesParaMedia.length > 0) {
              const totalTR = trValuesParaMedia.reduce((sum, current) => sum + current, 0);
              mediaTRFutura = totalTR / trValuesParaMedia.length;
              console.log(`Média da TR dos últimos ${anosMedia} anos para meses futuros: ${(mediaTRFutura * 100).toFixed(4)}%`);
          } else {
              // Fallback se o cache não tiver dados suficientes nos últimos 4 anos
              const TR_ESTIMADA_FUTURO_FRACAO = 0.0005;
              mediaTRFutura = TR_ESTIMADA_FUTURO_FRACAO;
              console.warn(`Não há dados de TR suficientes nos últimos ${anosMedia} anos. Usando TR ESTIMADA de ${(mediaTRFutura * 100).toFixed(4)}% como fallback.`);
          }
          
      } else {
          // Simulação totalmente futura, sem histórico de TR suficiente
          const TR_ESTIMADA_FUTURO_FRACAO = 0.0005;
          mediaTRFutura = TR_ESTIMADA_FUTURO_FRACAO; 
          mapaTR = {}; 
          console.warn(`Simulação totalmente futura. Usando TR ESTIMADA de ${(mediaTRFutura * 100).toFixed(4)}% para todo o prazo.`);
      }

    } catch (err) {
      console.error("Falha ao obter TR (Cache ou API do BCB):", err);
      mapaTR = null; 
      mediaTRFutura = 0;
    }
  }

  const extrasMes = [];
  if (data0) {
    // ... (Lógica de extras)
  }

  const { linhas, totalJuros, totalPago, mesesExecutados } =
    gerarCronograma({
      principal,
      iMes,
      nMeses,
      sistema,
      extras: extrasMes,
      extraMensal,
      seguroTaxa,
      data0,
      mapaTR,
      mediaTRFutura, // Passa a média ou a estimativa
    });

  // ... (Lógica de exibição de resultados)
  if (linhas.length) {
    if (el.prestacaoIni) el.prestacaoIni.textContent = fmtBRL.format(linhas[0].prestacao);
    if (el.totalPago) el.totalPago.textContent = fmtBRL.format(totalPago);
    if (el.totalJuros) el.totalJuros.textContent = fmtBRL.format(totalJuros);
    if (el.mesesQuitados) el.mesesQuitados.textContent = String(mesesExecutados);
  }

  if (el.tabela) {
    el.tabela.innerHTML = "";
    for (const l of linhas) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${l.mes}</td>
        <td>${l.data}</td>
        <td>${fmtBRL.format(l.prestacao)}</td>
        <td>${fmtBRL.format(l.amortizacao)}</td>
        <td>${fmtBRL.format(l.juros)}</td>
        <td>${fmtBRL.format(l.taxas)}</td>
        <td>${fmtBRL.format(l.extra)}</td>
        <td>${fmtBRL.format(l.saldo)}</td>
      `;
      el.tabela.appendChild(tr);
    }
  }

  if (el.grafico) desenharGraficoAnual(el.grafico, linhas, data0);
  // ... (funções de CSV/Link/PDF omitidas)
}

// ... O restante das funções (pmtPrice, monthIndexFromDate, etc.) permanece inalterado.
// IMPORTANTE: Você precisa garantir que a chamada a calcular() no final do seu amortizacao.html
// esteja corretamente definida (como o exemplo que você enviou estava).