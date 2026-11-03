const fs = require("node:fs/promises");

const SOURCES = {
  usd: "https://lirtna.com/currency/us-dollar/idlib",
  try: "https://lirtna.com/currency/turkish-lira"
};

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function pageText(html) {
  return decodeEntities(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseRateDate(text) {
  const match = text.match(/أسعار صرف العملات مقابل الليرة السورية[\s\S]{0,160}?(\d{2})-(\d{2})-(\d{4})/i)
    || text.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!match) throw new Error("لم أتمكن من قراءة تاريخ نشرة ليرتنا.");
  return match[3] + "-" + match[2] + "-" + match[1];
}

function parseRow(text, labelPattern, description) {
  const match = text.match(new RegExp(labelPattern.source + "([\\s\\S]{0,180})", "i"));
  if (!match) throw new Error("لم أجد صف " + description + " في صفحة ليرتنا.");
  const numbers = (match[1].match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || [])
    .map(value => Number(value.replace(/,/g, "")))
    .filter(Number.isFinite);
  if (numbers.length < 2 || numbers[0] <= 0 || numbers[1] <= 0) {
    throw new Error("تعذرت قراءة سعري المبيع والشراء لـ " + description + ".");
  }
  return { sell: numbers[0], buy: numbers[1] };
}

function toNewSyp(value) {
  return value >= 1000 ? value / 100 : value;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "NadwaExchangeRatesBot/1.0 (+https://github.com/alhlooalhloo9-ship-it/Alhloo2026)" },
    signal: AbortSignal.timeout(25000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("ليرتنا أعادت HTTP " + response.status + " عند جلب " + url);
  return pageText(await response.text());
}

async function main() {
  const [usdText, tryText] = await Promise.all([
    fetchPage(SOURCES.usd),
    fetchPage(SOURCES.try)
  ]);
  const usdDate = parseRateDate(usdText);
  const tryDate = parseRateDate(tryText);
  if (usdDate !== tryDate) throw new Error("تاريخ نشرتَي الدولار والتركية غير متطابق: " + usdDate + " / " + tryDate);
  const rateDay = new Date(usdDate + "T23:59:59Z").getTime();
  if (!Number.isFinite(rateDay) || Date.now() - rateDay > 48 * 60 * 60 * 1000 || rateDay > Date.now() + 24 * 60 * 60 * 1000) {
    throw new Error("نشرة ليرتنا قديمة أو بتاريخ غير متوقع: " + usdDate);
  }

  const usd = parseRow(usdText, /(?:دولار|الدولار)\s*[-–—]\s*ادلب\s*\(\s*\$\s*\)/i, "الدولار في إدلب");
  const turkish = parseRow(tryText, /(?:ليرة\s*تركية|الليرة\s*التركية)\s*[-–—]\s*ادلب\s*\(\s*TRY\s*\)/i, "الليرة التركية في إدلب");
  const usdSellSyp = toNewSyp(usd.sell);
  const tryBuySyp = toNewSyp(turkish.buy);
  const trySellSyp = toNewSyp(turkish.sell);
  const usdBuySyp = toNewSyp(usd.buy);
  const tryRate = usdSellSyp / tryBuySyp;
  if (![usdSellSyp, tryBuySyp, trySellSyp, usdBuySyp, tryRate].every(value => Number.isFinite(value) && value > 0) ||
      tryRate < 1 || tryRate > 1000) {
    throw new Error("نتيجة حساب سعر الدولار مقابل التركية خارج النطاق المنطقي؛ لم يتم نشرها.");
  }

  const output = {
    source: "ليرتنا",
    sourceKey: "lirtna",
    city: "Idlib",
    rateDate: usdDate,
    updatedAt: new Date().toISOString(),
    pricingMethod: "USD sell price divided by TRY buy price",
    usdSellSyp,
    usdBuySyp,
    trySellSyp,
    tryBuySyp,
    sypRate: Number(usdSellSyp.toFixed(6)),
    tryRate: Number(tryRate.toFixed(6)),
    sourceUrls: [SOURCES.usd, SOURCES.try]
  };
  await fs.writeFile("rates.json", JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log("Updated rates.json:", JSON.stringify(output));
}

main().catch(error => {
  console.error("Exchange-rate update failed:", error);
  process.exitCode = 1;
});
