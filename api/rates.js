const SOURCES = [
  { name: "SP Today - إدلب", url: "https://sp.today/en/currency/us-dollar/idlib", kind: "sp" },
  { name: "Lirtna - إدلب", url: "https://lirtna.com/en/currency/us-dollar/idlib", kind: "lirtna" }
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
  const section = text.slice(pos, pos + 260);
  const nums = section.match(/\\d+(?:[,.]\\d+)?/g) || [];
  if (nums.length < 2) throw new Error("تعذر قراءة سعري الشراء والمبيع");
  const sell = Number(nums[0].replace(/,/g, ""));
  const buy = Number(nums[1].replace(/,/g, ""));
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0 || sell < buy || sell > 100000) {
    throw new Error("قيم سعر إدلب غير صالحة");
  }
  return { buy, sell };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "NadwaRates/1.0 (+https://alhloo2026.vercel.app)", "accept": "text/html,application/json" }
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
      const html = await fetchWithTimeout(source.url);
      const rate = parseLocalUsd(cleanText(html));
      return { ...rate, source: source.name, sourceUrl: source.url };
    } catch (error) {
      errors.push(source.name + ": " + error.message);
    }
  }
  throw new Error(errors.join(" | "));
}

async function getTryRate() {
  const url = "https://lirascope.syria-cloud.sy/api/v1/rates/usd-based?lang=ar";
  const raw = await fetchWithTimeout(url);
  const data = JSON.parse(raw);
  const item = (data.rates || []).find(x => x.currency === "TRY");
  const mid = Number(item && (item.mid || ((Number(item.buy) + Number(item.sell)) / 2)));
  if (!Number.isFinite(mid) || mid <= 0 || mid > 1000) throw new Error("تعذر قراءة سعر TRY من LiraScope");
  return { value: mid, source: "LiraScope (سوق سوريا العام)", timestamp: item.timestampUtc || data.timestampUtc || null };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=18000, stale-while-revalidate=3600");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const [usd, tryRate] = await Promise.all([getIdlibUsd(), getTryRate()]);
    const now = new Date().toISOString();
    return res.status(200).json({
      ok: true,
      region: "Idlib",
      currency: "SYP_NEW",
      usd: { buy: usd.buy, sell: usd.sell, mid: Number(((usd.buy + usd.sell) / 2).toFixed(2)), source: usd.source, sourceUrl: usd.sourceUrl },
      try: { value: Number(tryRate.value.toFixed(2)), source: tryRate.source, timestamp: tryRate.timestamp },
      fetchedAt: now,
      refreshEveryHours: 5
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: "تعذر جلب سعر السوق المحلي حالياً", details: error.message, fetchedAt: new Date().toISOString() });
  }
};
