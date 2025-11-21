// =============================
// Utils de formatação
// =============================
function parseBRNumber(v) {
  if (!v) return 0;
  return parseFloat(v.replace(/\./g, "").replace(",", "."));
}

const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function fmtDate(d) {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// PRICE
function pmtPrice(principal, iMes, nMeses) {
  return principal * (iMes / (1 - Math.pow(1 + iMes, -nMeses)));
}

// conversão taxa anual para mensal efetiva
function mensalDeAnual(txa) {
  return Math.pow(1 + txa / 100, 1 / 12) - 1;
}

// =============================
// CARREGAR TR LOCAL (CSV)
// =============================
async function obterTRMensalMapa() {
  const resp = await fetch("tr_historico_cache.json");
  if (!resp.ok) throw new Error("Erro ao ler TR local");

  const texto = await resp.text();
  const linhas = texto.trim().split(/\r?\n/);

  const mapa = {};
  for (let i = 1; i < linhas.length; i++) {
    const partes = linhas[i].split(";");
    if (partes.length < 3) continue;

    const dataInicio = partes[0].trim();
    const trStr = partes[2].trim().replace(",", ".");
    const [dia, mes, ano] = dataInicio.split("/").map(Number);

    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    const valorPercentual = parseFloat(trStr);

    if (!isNaN(valorPercentual)) {
      mapa[chave] = valorPercentual / 100;
    }
  }

  return mapa;
}

// =============================
// GERADOR DO CRONOGRAMA
// =============================
function gerarCronograma({
  principal,
  iMes,
  nMeses,
  sistema,
  extras,
  extraMensal,
  seguroTaxa,
  data0,
  usarTR,
  mapaTR,
}) {
  const linhas = [];
  let saldo = principal;

  const parcelaInicialPrice =
    sistema === "price"
      ? Math.round(pmtPrice(principal, iMes, nMeses) * 100) / 100
      : 0;

  let pajAtual = parcelaInicialPrice;
  let amortConstante =
    sistema === "sac" ? Math.round((principal / nMeses) * 100) / 100 : 0;

  const extrasPorMes = {};
  (extras || []).forEach((ex) => {
    extrasPorMes[ex.mes] = (extrasPorMes[ex.mes] || 0) + ex.valor;
  });

  for (let m = 1; m <= nMeses + 50; m++) {
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

    // ============= TR DO MÊS ===============
    let trMes = 0;
    if (usarTR && data && mapaTR) {
      const ano = data.getUTCFullYear();
      const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
      const chave = `${ano}-${mes}`;

      if (mapaTR[chave] != null) {
        trMes = mapaTR[chave];
      }
    }

    // aplica TR no saldo antes dos juros
    if (trMes) {
      saldo = Math.round(saldo * (1 + trMes) * 100) / 100;
    }

    // juros sobre o saldo corrigido
    const juros = Math.round(saldo * iMes * 100) / 100;

    let amort = 0,
      prest = 0,
      taxas = Math.round(seguroTaxa * 100) / 100;

    if (sistema === "price") {
      if (usarTR && trMes) {
        pajAtual = Math.round(pajAtual * (1 + trMes) * 100) / 100;
      }
      const amortCalc = pajAtual - juros;

      if (amortCalc <= 0) {
        amort = 0;
        prest = juros + taxas;
      } else {
        amort = Math.min(amortCalc, saldo);
        prest = pajAtual + taxas;
      }

    } else {
      amort = Math.min(amortConstante, saldo);
      prest = amort + juros + taxas;
    }

    const extra = Math.min(
      (extrasPorMes[m] || 0) + (extraMensal || 0),
      saldo - amort
    );

    const pagoNoMes = prest + extra;

    saldo = Math.max(0, Math.round((saldo - amort - extra) * 100) / 100);

    linhas.push({
      mes: m,
      data: data ? fmtDate(data) : "—",
      prestacao: prest,
      amortizacao: amort,
      juros: juros,
      taxas: taxas,
      extra: extra,
      saldo: saldo,
      tr: trMes,
    });

    if (saldo <= 0) break;
  }

  return { linhas };
}

// =============================
// FUNÇÃO PRINCIPAL CALCULAR
// =============================
async function calcular() {
  const usarTR = document.getElementById("usarTR").checked;

  const principal = parseBRNumber(document.getElementById("principal").value);
  const taxa = parseBRNumber(document.getElementById("rate").value);
  const nMeses = parseInt(document.getElementById("periodo").value);
  const sistema = document.getElementById("sistema").value;
  const tipoTaxa = document.getElementById("tipoTaxa").value;
  const seguroTaxa = parseBRNumber(document.getElementById("seguroTaxa").value);
  const extraMensal = parseBRNumber(document.getElementById("extraMensal").value);

  let data0 = null;
  const dt = document.getElementById("dataInicio").value;
  if (dt) {
    const [dia, mes, ano] = dt.split("/").map(Number);
    data0 = new Date(Date.UTC(ano, mes - 1, dia));
  }

  let iMes = tipoTaxa === "aa" ? mensalDeAnual(taxa) : taxa / 100;

  let mapaTR = null;
  if (usarTR) {
    mapaTR = await obterTRMensalMapa();
  }

  const { linhas } = gerarCronograma({
    principal,
    iMes,
    nMeses,
    sistema,
    extras: [],
    extraMensal,
    seguroTaxa,
    data0,
    usarTR,
    mapaTR,
  });

  console.table(linhas);
  alert("Cálculo concluído com sucesso!");
}
