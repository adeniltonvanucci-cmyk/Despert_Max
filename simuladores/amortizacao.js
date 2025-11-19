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
  return Number.isFinite(v) ? v : 0;
}

// =============== Funções de máscara em tempo real ===============

function attachMoneyMask(input, options = {}) {
  const {
    allowNegative = false,
    maxDigits = 12, // antes da vírgula
  } = options;

  input.addEventListener("input", () => {
    let value = input.value;

    // Remove qualquer caractere que não seja dígito ou sinal
    value = value.replace(/[^\d-]/g, "");

    // Trata sinal negativo
    let isNegative = false;
    if (allowNegative && value.startsWith("-")) {
      isNegative = true;
      value = value.slice(1);
    }

    // Remove zeros à esquerda
    value = value.replace(/^0+(\d)/, "$1");

    if (!value) {
      input.value = isNegative ? "-" : "";
      return;
    }

    // Limita a quantidade de dígitos
    value = value.slice(0, maxDigits);

    // Garante pelo menos 3 dígitos para formatar em centavos
    while (value.length < 3) {
      value = "0" + value;
    }

    const inteiros = value.slice(0, -2);
    const centavos = value.slice(-2);

    let formatted = "";
    let count = 0;
    for (let i = inteiros.length - 1; i >= 0; i--) {
      formatted = inteiros[i] + formatted;
      count++;
      if (count === 3 && i > 0) {
        formatted = "." + formatted;
        count = 0;
      }
    }

    formatted = formatted + "," + centavos;

    if (isNegative) {
      formatted = "-" + formatted;
    }

    input.value = formatted;
  });

  input.addEventListener("blur", () => {
    let value = input.value;

    if (!value || value === "-") {
      input.value = "";
      return;
    }

    let num = parseBRNumber(value);
    input.value = fmtBRL.format(num).replace("R$", "").trim();
  });
}

function attachPercentMask(input, options = {}) {
  const { maxInt = 3, maxDec = 4 } = options;

  input.addEventListener("input", (e) => {
    let v = e.target.value;

    // remove tudo que não for dígito, ponto ou vírgula
    v = v.replace(/[^\d.,]/g, "");

    // se começar com separador, prefixa 0
    if (/^[.,]/.test(v)) {
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

    // Normaliza vírgula/ponto para vírgula, por exemplo
    v = v.replace(/\./g, ",");
    e.target.value = v;
  });
}

// ===================== Carregamento do cache de TR =====================
async function obterTRMensalMapa(dataInicial, dataFinal) {
  // URL do arquivo de cache local
  const urlCache = "tr_historico_cache.json";

  // Fazemos o fetch do arquivo JSON
  const resp = await fetch(urlCache);
  if (!resp.ok) {
    throw new Error(`Erro ao carregar o cache TR. Verifique se ${urlCache} existe.`);
  }

  // Lê o conteúdo como JSON
  const dadosHistoricos = await resp.json();

  // Vamos montar um mapa apenas com os meses dentro do intervalo de interesse.
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
  const fator = Math.pow(1 + i, n);
  return (P * i * fator) / (fator - 1);
}

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
  let amortConstante =
    sistema === "sac" ? Math.round((principal / nMeses) * 100) / 100 : 0;

  let totalJuros = 0;
  let totalPago = 0;
  let mesesExecutados = 0;

  const extrasPorMes = {};
  (extras || []).forEach((ex) => {
    if (!ex.data || ex.valor <= 0) return;
    extrasPorMes[ex.mes] = (extrasPorMes[ex.mes] || 0) + ex.valor;
  });

  for (let m = 1; m <= nMeses; m++) {
    let data = null;
    if (data0) {
      data = new Date(
        Date.UTC(
          data0.getUTCFullYear(),
          data0.getUTCMonth() + (m - 1),
          data0.getUTCDate()
        )
      );
    }

    // --- TR do mês (real ou média futura) ---
    let trMes = 0;
    if (mapaTR) {
      if (data) {
        const chaveMes = `${data.getUTCFullYear()}-${String(
          data.getUTCMonth() + 1
        ).padStart(2, "0")}`;
        trMes = mapaTR[chaveMes];
        if (trMes === undefined || trMes === null) {
          trMes = mediaTRFutura;
        }
      } else {
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

  // === Ajuste para saldo residual quando TR ou taxas geram diferença ===
  if (saldo > 0.01) {
    const jurosResidual = Math.round(saldo * iMes * 100) / 100;
    const parcelaFinal = Math.round((saldo + jurosResidual) * 100) / 100;

    linhas.push({
      mes: mesesExecutados + 1,
      data: "Saldo residual",
      prestacao: parcelaFinal,
      amortizacao: saldo,
      juros: jurosResidual,
      taxas: 0,
      extra: 0,
      saldo: 0,
    });

    totalJuros += jurosResidual;
    totalPago += parcelaFinal;
    mesesExecutados = mesesExecutados + 1;
    saldo = 0;
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

  const padL = 40 * devicePixelRatio;
  const padB = 40 * devicePixelRatio;
  const padT = 20 * devicePixelRatio;
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

    const total = series[a].juros + series[a].amort;
    const hTotal = (total / maxV) * usableH;
    const hAmort = (series[a].amort / maxV) * usableH;

    const baseY = H - padB;

    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(
      x - barW / 2,
      baseY - hAmort,
      barW,
      hAmort
    );

    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(
      x - barW / 2,
      baseY - hTotal,
      barW,
      hTotal - hAmort
    );

    ctx.save();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `${10 * devicePixelRatio}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(a, x, baseY + 4 * devicePixelRatio);
    ctx.restore();
  });
}

// ==== CÁLCULO PRINCIPAL (COM TR REAL NO PASSADO E MÉDIA DE 4 ANOS NO FUTURO) ====
async function calcular() {
  // OBS: As funções de leitura de campo dependem de elementos HTML no amortizacao.html
  
  const principal = parseBRNumber(el.principal.value);
  const taxa = parseBRNumber(el.rate.value);
  const nMeses = parseInt(el.periodo.value || "0", 10);
  const sistema = el.sistema.value;
  const tipoTaxa = el.tipoTaxa.value;
  const seguroTaxa = parseBRNumber(el.seguroTaxa.value);
  const extraMensal = parseBRNumber(el.extraMensal.value);

  let data0 = null;
  if (el.dataInicio.value) {
    const [dia, mes, ano] = el.dataInicio.value.split("/").map(Number);
    data0 = new Date(Date.UTC(ano, mes - 1, dia));
  }

  const listaExtras = []; // Aqui você populava de acordo com inputs de amortizações extras por data
  // (Implementação do preenchimento de "listaExtras" omitida por brevidade)

  if (!principal || !taxa || !nMeses) {
    alert("Preencha valor, taxa e prazo.");
    return;
  }

  const usarTR = el.usarTR && el.usarTR.checked;

  // Converte taxa anual para mensal se necessário
  let iMes = 0;
  if (tipoTaxa === "aa") {
    iMes = mensalDeAnual(taxa);
  } else {
    iMes = taxa / 100;
  }

  let mapaTR = null;
  let mediaTRFutura = 0;

  // Só fazemos busca TR se:
  // 1) usarTR estiver marcado
  // 2) houver data inicial e nMeses > 0
  if (usarTR && data0 && nMeses > 0) {
    const dataAtual = new Date(); // "agora" para fins de média futura
    const dataFinal = new Date(
      Date.UTC(
        data0.getUTCFullYear(),
        data0.getUTCMonth() + (nMeses - 1),
        data0.getUTCDate()
      )
    );

    // *** Início do período para cálculo da MÉDIA: 4 anos atrás (Ex: 01/11/2021) ***
    const anosMedia = 4;
    const dataInicioMedia = new Date(Date.UTC(
      dataAtual.getUTCFullYear() - anosMedia,
      dataAtual.getUTCMonth(),
      1
    ));

    try {
      mapaTR = await obterTRMensalMapa(dataInicioMedia, dataFinal);

      const valoresMedia = [];
      const dataInicioTs = dataInicioMedia.getTime();
      const dataAtualTs = dataAtual.getTime();

      for (const chave in mapaTR) {
        const [anoStr, mesStr] = chave.split("-");
        const ano = parseInt(anoStr, 10);
        const mes = parseInt(mesStr, 10);

        const d = new Date(Date.UTC(ano, mes - 1, 1));
        const ts = d.getTime();

        if (ts >= dataInicioTs && ts <= dataAtualTs && typeof mapaTR[chave] === "number") {
          valoresMedia.push(mapaTR[chave]);
        }
      }

      if (valoresMedia.length > 0) {
        const soma = valoresMedia.reduce((acc, v) => acc + v, 0);
        mediaTRFutura = soma / valoresMedia.length;
      } else {
        mediaTRFutura = 0;
      }

      console.log(
        `Média da TR dos últimos ${anosMedia} anos para meses futuros: ${
          (mediaTRFutura * 100).toFixed(5)
        }% a.m.`
      );
    } catch (err) {
      console.error("Falha ao obter TR histórica:", err);
      mapaTR = null;
      mediaTRFutura = 0;
    }
  }

  const { linhas, totalJuros, totalPago, mesesExecutados } = gerarCronograma({
    principal,
    iMes,
    nMeses,
    sistema,
    extras: listaExtras,
    extraMensal,
    seguroTaxa,
    data0,
    mapaTR,
    mediaTRFutura,
  });

  // A partir daqui, você atualiza a interface:
  // - Tabela de cronograma
  // - Resumo de totais
  // - Gráficos etc.
}

// Aqui você precisaria amarrar o botão "Calcular" ao método calcular():
// document.getElementById("btnCalcular").addEventListener("click", calcular);
