const SOURCES = [
  { name: "SP Today - إدلب", url: "https://sp.today/en/currency/us-dollar/idlib" },
  { name: "Lirtna - إدلب", url: "https://lirtna.com/currency/us-dollar/idlib" }
];

function cleanText(html) {
  return String(html)
    .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\\s+/g, " ")
    .trim();
}

function parseLocalUsd(text) {
  const lower = text.toLowerCase();
  const keys = ["dollar - idlib", "dollar - ادلب", "دولار - ادلب", "دولار - إدلب"];
  let pos = -1;
  for (const key of keys) {
    pos = lower.indexOf(key.toLowerCase());
    if (pos >= 0) break;
  }
  if (pos < 0) throw new Error("لم يتم العثور على صف إدلب");
  const section = text.slice(pos, pos + 220);
  const nums = section.match(/\\d+(?:[,.]\\d+)?/g) || [];
  if (nums.length < 2) throw new Error("تعذر قراءة سعري الشراء والمبيع");
  // صفحات المصدر تعرض المبيع أولاً ثم الشراء.
  const sell = Number(nums[0].replace(/,/g, ""));
  const buy = Number(nums[1].replace(/,/g, ""));
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0 || sell < buy || sell > 100000) {
    throw new Error("قيم سعر إدلب غير صالحة");
  }
  return { buy, sell };
}

async function fetchText(url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "NadwaRates/1.1 (+https://alhloo2026.vercel.app)",
        "accept": accept || "text/html,application/json"
      }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function getIdlibUsd() {
  const errors = [];
  for (const source of SOURCES) {
    try {
      const html = await fetchText(source.url, "text/html");
      const rate = parseLocalUsd(cleanText(html));
      return { ok: true, ...rate, source: source.name, sourceUrl: source.url };
    } catch (error) {
      errors.push(source.name + ": " + error.message);
    }
  }
  return { ok: false, error: errors.join(" | ") };
}

async function getTryRate() {
  const url = "https://lirascope.syria-cloud.sy/api/v1/rates/usd-based?lang=ar";
  const raw = await fetchText(url, "application/json");
  const data = JSON.parse(raw);
  if (data.base !== "USD" || !Array.isArray(data.rates)) {
    throw new Error("صيغة استجابة LiraScope غير مطابقة للتوثيق");
  }
  const item = data.rates.find(x => String(x.currency).toUpperCase() === "TRY");
  const value = Number(item && (item.mid || ((Number(item.buy) + Number(item.sell)) / 2)));
  if (!Number.isFinite(value) || value <= 0 || value > 1000) {
    throw new Error("تعذر قراءة سعر TRY من LiraScope");
  }
  return { ok: true, value, source: "LiraScope - سعر السوق", timestamp: (item && item.timestampUtc) || data.timestampUtc || null };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // منع تخزين CDN للاستجابة حتى يعمل زر الجلب اليدوي على طلب جديد.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const [usd, tryResult] = await Promise.all([
    getIdlibUsd(),
    getTryRate().catch(error => ({ ok: false, error: error.message }))
  ]);
  const now = new Date().toISOString();
  return res.status(200).json({
    ok: Boolean(usd.ok || tryResult.ok),
    region: "Idlib",
    currency: "SYP_NEW",
    usd: usd.ok ? {
      ok: true, buy: usd.buy, sell: usd.sell,
      mid: Number(((usd.buy + usd.sell) / 2).toFixed(2)),
      source: usd.source, sourceUrl: usd.sourceUrl
    } : { ok: false, error: usd.error },
    try: tryResult.ok ? {
      ok: true, value: Number(tryResult.value.toFixed(2)),
      source: tryResult.source, timestamp: tryResult.timestamp
    } : { ok: false, error: tryResult.error },
    fetchedAt: now,
    refreshEveryHours: 5
  });
};
