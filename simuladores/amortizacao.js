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

  input.addEventListener("blur", (e) => {
    let v = e.target.value.trim();
    if (!v) return;

    // Normaliza vírgula/ponto para vírgula, por exemplo
    v = v.replace(/\./g, ",");
    e.target.value = v;
  });
}

// ===================== CORREÇÃO: Carregamento e Reestruturação da TR (Formato CSV) =====================

/**
 * Carrega e reestrutura o histórico de TR no formato "dd/mm/aaaa;dd/mm/aaaa;0,0605"
 * para um mapa que a função gerarCronograma possa usar (chave: AAAA-MM, valor: TR em decimal).
 */
async function carregarEReformatarTR(dataInicial, dataFinal) {
  const urlCache = "tr_historico_cache.json"; // Mantém o nome do arquivo para o fetch
  const mapaFiltrado = {};

  try {
    const resp = await fetch(urlCache);
    if (!resp.ok) {
      throw new Error(`Erro ao carregar cache TR. Verifique se ${urlCache} existe.`);
    }

    // LÊ O CONTEÚDO COMO TEXTO, NÃO COMO JSON
    const textoHistorico = await resp.text();
    const linhas = textoHistorico.split('\n');

    for (const linha of linhas) {
      const partes = linha.trim().split(';');
      if (partes.length < 3) continue; // Ignora linhas incompletas ou cabeçalhos

      const [dataInicioStr, , trStr] = partes; // Pega o primeiro e o terceiro campo
      
      // Ajuste CRÍTICO: Assume que "0,1690" representa 0.1690% a.m., 
      // então dividimos APENAS por 100 para obter o decimal (ex: 0.001690)
      const trDecimal = parseBRNumber(trStr) / 100; 

      if (trDecimal === 0) continue; 

      // Converte a data de início (dd/mm/aaaa) para um objeto Date (UTC)
      const dataParts = dataInicioStr.split('/');
      if (dataParts.length !== 3) continue;
      
      const [dia, mes, ano] = dataParts.map(Number);
      const dataChave = new Date(Date.UTC(ano, mes - 1, dia)); 

      
      const chaveMes = `${dataChave.getUTCFullYear()}-${String(dataChave.getUTCMonth() + 1).padStart(2, "0")}`;

      // Usa apenas o primeiro valor de TR encontrado para aquele AAAA-MM.
      if (mapaFiltrado[chaveMes] === undefined) {
          mapaFiltrado[chaveMes] = trDecimal;
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
  
  const pajInicial =
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
        // Se a TR não for encontrada para o mês (futuro), usa a média calculada
        if (trMes === undefined || trMes === null) {
          trMes = mediaTRFutura;
        }
      } else {
        trMes = mediaTRFutura;
      }
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
      
      // 2. Aplica a correção da TR diretamente no componente PAJ da parcela
      let pajCorrigido = pajInicial;
      if (trMes !== 0 && trMes !== undefined) {
         pajCorrigido = Math.round(pajInicial * (1 + trMes) * 100) / 100;
      }
      
      const amortAlvo = pajCorrigido - juros; 
      
      if (amortAlvo <= 0) {
        // Se a correção do PAJ ainda não for suficiente para cobrir os juros.
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
      
    } else { // SAC
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
    
    // Se o saldo for zero, saímos do loop
    if (saldo === 0) break;
  }

  // === AJUSTE para saldo residual ===
  if (saldo > 0.001) { 
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

// ==== CÁLCULO PRINCIPAL (COM TR REAL NO PASSADO E MÉDIA DE TR DO CSV NO FUTURO) ====
async function calcular() {
  if (typeof el === 'undefined') {
    console.error("Erro: Objeto 'el' não está definido. Verifique a integração com o HTML.");
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
    const [dia, mes, ano] = el.dataInicio.value.split("/").map(Number);
    data0 = new Date(Date.UTC(ano, mes - 1, dia));
  }

  const listaExtras = []; 

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

  // ==========================
  // Mapa TR e média futura
  // ==========================
  let mapaTR = null;
  let mediaTRFutura = 0;

  if (usarTR && data0 && nMeses > 0) {
    
    // Calcula o período de busca (do início do empréstimo até o final)
    const dataFinal = new Date(
      Date.UTC(
        data0.getUTCFullYear(),
        data0.getUTCMonth() + (nMeses + 100), // Max meses
        data0.getUTCDate()
      )
    );
    
    try {
      // Data Inicial para busca é a data de início do empréstimo
      mapaTR = await carregarEReformatarTR(data0, dataFinal);

      if (mapaTR) {
        const valoresTR = Object.values(mapaTR); // Pega todos os valores de TR lidos do arquivo
        
        if (valoresTR.length > 0) {
          const soma = valoresTR.reduce((acc, v) => acc + v, 0);
          // Média calculada APENAS com os valores encontrados no mapa (do CSV)
          mediaTRFutura = soma / valoresTR.length; 
        } else {
          mediaTRFutura = 0;
        }

        console.log(
          `Média da TR para meses futuros (baseada nos dados do CSV): ${(mediaTRFutura * 100).toFixed(5)}% a.m.`
        );
      }
    } catch (err) {
      console.error("Falha ao processar TR:", err);
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

  console.log(`Cálculo concluído: Total Pago R$ ${fmtBRL.format(totalPago).replace("R$", "").trim()}, Total Juros R$ ${fmtBRL.format(totalJuros).replace("R$", "").trim()}, Meses: ${mesesExecutados}`);
}

