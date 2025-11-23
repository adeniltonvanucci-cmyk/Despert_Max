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

// =============== Funções de máscara e formatação ===============

function attachBRLMask(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    const digits = input.value.replace(/[^\d]/g, "");
    if (!digits) {
      input.value = "";
      return;
    }
    const v = parseInt(digits, 10);
    const num = v / 100;
    input.value = fmtBRL.format(num);
  });
}

function attachPercentMask(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    let val = input.value.replace(/[^\d]/g, "");
    if (!val) {
      input.value = "";
      return;
    }
    if (val.length > 3) {
      val = val.slice(0, 3);
    }
    const num = parseInt(val, 10);
    input.value = num.toString().padStart(3, "0");
  });
}

function attachGenericPercentMask(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    const raw = input.value
      .replace(/[^\d,]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) {
      input.value = "";
      return;
    }
    input.value = v.toString().replace(".", ",");
  });
}

// =============== TR: Carregamento e Reestruturação ===============

/**
 * Carrega e reestrutura o histórico de TR no formato "dd/mm/aaaa;dd/mm/aaaa;0,0605"
 * para um mapa que a função gerarCronograma possa usar (chave: AAAA-MM, valor: TR em decimal).
 */
async function carregarEReformatarTR() {
  const urlCache = "tr_historico_cache.json"; // Mantém o nome do arquivo para o fetch
  const mapaFiltrado = {};

  try {
    const resp = await fetch(urlCache);
    if (!resp.ok) {
      throw new Error(`Erro ao carregar cache TR. Verifique se ${urlCache} existe.`);
    }

    // LÊ O CONTEÚDO COMO TEXTO, NÃO COMO JSON
    const textoHistorico = await resp.text();

    // Divide em linhas
    const linhas = textoHistorico.split(/\r?\n/).filter((l) => l.trim() !== "");

    // Processa cada linha
    for (const linha of linhas) {
      // Formato esperado: dataInicial;dataFinal;valorTR
      const partes = linha.split(";");
      if (partes.length < 3) continue;

      const dataInicialStr = partes[0].trim(); // dd/mm/aaaa
      const dataFinalStr = partes[1].trim(); // dd/mm/aaaa
      const valorTRStr = partes[2].trim().replace(",", ".");

      const valorTR = parseFloat(valorTRStr);
      if (!Number.isFinite(valorTR)) continue;

      const [diaI, mesI, anoI] = dataInicialStr.split("/").map((x) => parseInt(x, 10));
      const [diaF, mesF, anoF] = dataFinalStr.split("/").map((x) => parseInt(x, 10));

      const dataI = new Date(Date.UTC(anoI, mesI - 1, diaI));
      const dataF = new Date(Date.UTC(anoF, mesF - 1, diaF));

      let ano = dataI.getUTCFullYear();
      let mes = dataI.getUTCMonth() + 1;

      while (
        ano < dataF.getUTCFullYear() ||
        (ano === dataF.getUTCFullYear() && mes <= dataF.getUTCMonth() + 1)
      ) {
        const chave = `${ano}-${String(mes).padStart(2, "0")}`;
        mapaFiltrado[chave] = valorTR / 100.0;

        mes++;
        if (mes > 12) {
          mes = 1;
          ano++;
        }
      }
    }
  } catch (err) {
    console.error("Falha ao processar histórico de TR:", err);
    return null;
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
  mediaTRFutura = 0,
}) {
  const linhas = [];
  let saldo = principal;

  // Valor base da Parcela de Amortização e Juros (PAJ)
  const pajInicial =
    sistema === "price"
      ? Math.round(pmtPrice(principal, iMes, nMeses) * 100) / 100
      : 0;

  let amortConstante =
    sistema === "sac" ? Math.round((principal / nMeses) * 100) / 100 : 0;

  let fatorTRAcum = 1;
  let totalJuros = 0;
  let totalPago = 0;
  let mesesExecutados = 0;

  const extrasPorMes = {};
  (extras || []).forEach((ex) => {
    if (!ex.data || ex.valor <= 0) return;
    extrasPorMes[ex.mes] = (extrasPorMes[ex.mes] || 0) + ex.valor;
  });

  const maxMeses = nMeses + 100;

  for (let m = 1; m <= maxMeses; m++) {
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

        // Se a TR for indefinida para o mês (futuro), usa a média calculada.
        if (trMes === undefined || trMes === null) {
          trMes = mediaTRFutura;
        }
      } else {
        trMes = mediaTRFutura;
      }
    }

    // Fator acumulado da TR para correção das parcelas PRICE
    if (trMes !== 0 && trMes !== undefined) {
      fatorTRAcum =
        Math.round(fatorTRAcum * (1 + trMes) * 1e12) / 1e12;
    }
    // 1. Correção da TR no saldo
    if (trMes !== 0 && trMes !== undefined) {
      saldo = Math.round(saldo * (1 + trMes) * 100) / 100;
    }

    const juros = Math.round(saldo * iMes * 100) / 100;
    let amort = 0,
      prest = 0,
      taxas = Math.round(seguroTaxa * 100) / 100;

    if (sistema === "price") {
      // Parcela base (PAJ) corrigida pelo fator acumulado da TR
      let pajCorrigido =
        Math.round(pajInicial * fatorTRAcum * 100) / 100;

      const amortAlvo = pajCorrigido - juros;

      if (amortAlvo <= 0) {
        // Se a correção da parcela ainda não for suficiente para cobrir os juros
        prest = juros + taxas;
        amort = 0;
      } else {
        // Amortização positiva: utiliza a PAJ corrigida + taxas
        amort = Math.min(amortAlvo, saldo);
        prest = pajCorrigido + taxas;
      }

      // Se o saldo for quase zero, a prestação final deve ser ajustada para zerar o saldo
      if (saldo <= amort) {
        amort = saldo;
        prest = amort + juros + taxas;
      }
    } else {
      // SAC
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
      extra: extra,
      totalPagoMes: pagoNoMes,
      saldoDevedor: saldo,
      trMes: trMes * 100,
    });

    if (saldo <= 0.01 || m >= nMeses) break;
  }

  totalJuros = Math.round(totalJuros * 100) / 100;
  totalPago = Math.round(totalPago * 100) / 100;

  return {
    linhas,
    totalJuros,
    totalPago,
    mesesExecutados,
  };
}

// ===================== Renderização da Tabela =====================

function renderTabelaCronograma(linhas, totalJuros, totalPago) {
  const tbody = document.querySelector("#cronograma-body");
  const tfoot = document.querySelector("#cronograma-foot");
  if (!tbody || !tfoot) return;

  tbody.innerHTML = "";
  tfoot.innerHTML = "";

  linhas.forEach((l) => {
    const tr = document.createElement("tr");

    const tdMes = document.createElement("td");
    tdMes.textContent = l.mes;
    tr.appendChild(tdMes);

    const tdData = document.createElement("td");
    tdData.textContent = l.data;
    tr.appendChild(tdData);

    const tdPrest = document.createElement("td");
    tdPrest.textContent = fmtBRL.format(l.prestacao);
    tr.appendChild(tdPrest);

    const tdAmort = document.createElement("td");
    tdAmort.textContent = fmtBRL.format(l.amortizacao);
    tr.appendChild(tdAmort);

    const tdJuros = document.createElement("td");
    tdJuros.textContent = fmtBRL.format(l.juros);
    tr.appendChild(tdJuros);

    const tdExtra = document.createElement("td");
    tdExtra.textContent = fmtBRL.format(l.extra);
    tr.appendChild(tdExtra);

    const tdPago = document.createElement("td");
    tdPago.textContent = fmtBRL.format(l.totalPagoMes);
    tr.appendChild(tdPago);

    const tdSaldo = document.createElement("td");
    tdSaldo.textContent = fmtBRL.format(l.saldoDevedor);
    tr.appendChild(tdSaldo);

    const tdTR = document.createElement("td");
    tdTR.textContent =
      l.trMes !== undefined ? `${l.trMes.toFixed(5)}%` : "—";
    tr.appendChild(tdTR);

    tbody.appendChild(tr);
  });

  const trFoot = document.createElement("tr");

  const tdLabel = document.createElement("td");
  tdLabel.colSpan = 3;
  tdLabel.textContent = "Totais";
  trFoot.appendChild(tdLabel);

  const tdAmortTot = document.createElement("td");
  tdAmortTot.textContent = "—";
  trFoot.appendChild(tdAmortTot);

  const tdJurosTot = document.createElement("td");
  tdJurosTot.textContent = fmtBRL.format(totalJuros);
  trFoot.appendChild(tdJurosTot);

  const tdExtraTot = document.createElement("td");
  tdExtraTot.textContent = "—";
  trFoot.appendChild(tdExtraTot);

  const tdPagoTot = document.createElement("td");
  tdPagoTot.textContent = fmtBRL.format(totalPago);
  trFoot.appendChild(tdPagoTot);

  const tdSaldoFinal = document.createElement("td");
  tdSaldoFinal.textContent = "R$ 0,00";
  trFoot.appendChild(tdSaldoFinal);

  const tdTRFoot = document.createElement("td");
  tdTRFoot.textContent = "—";
  trFoot.appendChild(tdTRFoot);

  tfoot.appendChild(trFoot);
}

// ===================== Gráfico =====================

function desenharGrafico(linhas) {
  const canvas = document.querySelector("#grafico-canvas");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const series = {};
  linhas.forEach((l, idx) => {
    let ano = "Sem data";
    if (l.data && l.data !== "—") {
      const [dia, mes, anoStr] = l.data.split("/");
      ano = parseInt(anoStr, 10);
    }
    series[ano] = series[ano] || { juros: 0, amort: 0 };
    series[ano].juros += l.juros;
    series[ano].amort += l.amortizacao;
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
    usableW / Math.max(anos.length * 1.5, 1)
  );
  const gap = barW * 0.4;

  ctx.font = `${12 * devicePixelRatio}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const baseY = padT + usableH;

  anos.forEach((a, idx) => {
    const x =
      padL +
      barW / 2 +
      idx * (barW + gap);

    const vAmort = series[a].amort;
    const vJuros = series[a].juros;

    const hAmort = (vAmort / maxV) * usableH;
    const hJuros = (vJuros / maxV) * usableH;
    const hTotal = hAmort + hJuros;

    ctx.fillStyle = "#0f766e";
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
    ctx.translate(x, baseY + 4 * devicePixelRatio);
    ctx.rotate((-45 * Math.PI) / 180);
    ctx.fillText(a, 0, 0);
    ctx.restore();
  });

  ctx.strokeStyle = "#cbd5f5";
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, baseY);
  ctx.lineTo(W - 10 * devicePixelRatio, baseY);
  ctx.stroke();
}

// ===================== Integração com HTML =====================

const el = (function obterElementos() {
  const form = document.querySelector("#form-amortizacao");
  if (!form) return {};

  return {
    form,
    principal: form.querySelector("#principal"),
    rate: form.querySelector("#taxa"),
    tipoTaxa: form.querySelector("#tipoTaxa"),
    periodo: form.querySelector("#periodo"),
    sistema: form.querySelector("#sistema"),
    dataInicio: form.querySelector("#dataInicio"),
    seguroTaxa: form.querySelector("#seguroTaxa"),
    extraMensal: form.querySelector("#extraMensal"),
    trAtiva: form.querySelector("#trAtiva"),
    historicoTR: form.querySelector("#historicoTR"),
  };
})();

if (Object.keys(el).length > 0) {
  attachBRLMask(el.principal);
  attachGenericPercentMask(el.rate);
  attachBRLMask(el.seguroTaxa);
  attachBRLMask(el.extraMensal);
}

// ===================== Leitura da TR (arquivo local convertido em cache) =====================

async function obterMapaTR(mediaUltimosMeses = 12) {
  const mapaTR = await carregarEReformatarTR();
  if (!mapaTR) return { mapaTR: null, mediaTRFutura: 0 };

  const chaves = Object.keys(mapaTR).sort();
  if (chaves.length === 0) {
    return { mapaTR: null, mediaTRFutura: 0 };
  }

  const ultimas = chaves.slice(-mediaUltimosMeses);

  let soma = 0;
  let cont = 0;
  for (const chave of ultimas) {
    const v = mapaTR[chave];
    if (Number.isFinite(v)) {
      soma += v;
      cont++;
    }
  }

  const media = cont > 0 ? soma / cont : 0;

  return { mapaTR, mediaTRFutura: media };
}

// ===================== Cálculo principal =====================

async function calcular() {
  if (typeof el === "undefined") {
    console.error(
      "Erro: Objeto 'el' não está definido. Verifique a integração com o HTML."
    );
    return;
  }

  const principal = parseBRNumber(el.principal.value);
  const taxa = parseBRNumber(el.rate.value);
  const nMeses = parseInt(el.periodo.value || "0", 10);
  const sistema = el.sistema.value;
  const tipoTaxa = el.tipoTaxa.value;
  const seguroTaxa = parseBRNumber(el.seguroTaxa.value);
  const extraMensal = parseBRNumber(el.extraMensal.value);

  let data0 = null;
  if (el.dataInicio.value) {
    const [dia, mes, ano] = el.dataInicio.value.split("-").map(Number);
    data0 = new Date(Date.UTC(ano, mes - 1, dia));
  }

  if (!principal || !taxa || !nMeses) {
    alert("Preencha valor, taxa e prazo corretamente.");
    return;
  }

  let iMes;
  if (tipoTaxa === "anual") {
    iMes = mensalDeAnual(taxa);
  } else {
    iMes = (taxa || 0) / 100;
  }

  let listaExtras = [];

  const linhasTabela = document.querySelectorAll(
    "#extras-body tr"
  );
  linhasTabela.forEach((tr, idx) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 3) return;

    const dataStr = tds[0].querySelector("input")?.value;
    const valorStr = tds[1].querySelector("input")?.value;

    if (!dataStr || !valorStr) return;

    const [ano, mes, dia] = dataStr.split("-").map(Number);
    const dataEx = new Date(Date.UTC(ano, mes - 1, dia));
    let diffMeses = 0;
    if (data0) {
      diffMeses =
        (dataEx.getUTCFullYear() - data0.getUTCFullYear()) * 12 +
        (dataEx.getUTCMonth() - data0.getUTCMonth());
    }

    if (diffMeses < 0 || diffMeses >= nMeses) return;

    const valorExtra = parseBRNumber(valorStr);
    if (!valorExtra) return;

    listaExtras.push({
      data: dataEx,
      mes: diffMeses + 1,
      valor: valorExtra,
    });
  });

  let mapaTR = null;
  let mediaTRFutura = 0;

  if (el.trAtiva.checked) {
    try {
      const resTR = await obterMapaTR();
      mapaTR = resTR.mapaTR;
      mediaTRFutura = resTR.mediaTRFutura;

      console.log(
        `Média da TR para meses futuros (baseada nos dados do CSV): ${
          (mediaTRFutura * 100).toFixed(5)
        }% a.m.`
      );
    } catch (err) {
      console.error("Falha ao processar TR:", err);
      mapaTR = null;
      mediaTRFutura = 0;
    }
  }

  const { linhas, totalJuros, totalPago, mesesExecutados } =
    gerarCronograma({
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

  renderTabelaCronograma(linhas, totalJuros, totalPago);
  desenharGrafico(linhas);

  console.log(
    `Cálculo concluído: Total Pago ${fmtBRL.format(
      totalPago
    )}, Juros ${fmtBRL.format(
      totalJuros
    )}, Meses: ${mesesExecutados}`
  );
}
