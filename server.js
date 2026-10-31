import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

app.use(express.json({ limit: "30kb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(API_KEY), model: MODEL });
});

app.post("/api/analyze", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        error: "لم يُضبط مفتاح الذكاء الاصطناعي على الخادم بعد. اتبع خطوات README."
      });
    }

    const { scenario, kind, context = "" } = req.body || {};
    if (typeof scenario !== "string" || scenario.trim().length < 5) {
      return res.status(400).json({ error: "اكتب سيناريو واضحًا قبل التحليل." });
    }
    if (scenario.length > 5000 || String(context).length > 3000) {
      return res.status(413).json({ error: "النص طويل جدًا. اختصر السيناريو والتفاصيل." });
    }

    const category = kind === "world" ? "سيناريو عالمي أو اجتماعي أو اقتصادي أو بيئي" : "قرار شخصي";
    const instructions = `
أنت محرك تحليل سيناريوهات لتطبيق SOMNIA. حلّل السيناريو باللغة العربية الواضحة.
لا تدّعِ أنك تعرف المستقبل أو تستطيع إعطاء نتيجة مؤكدة بنسبة 100%. ميّز بين الحقائق العامة والافتراضات والتوقعات.
لا تخترع إحصاءات أو نسب احتمالات رقمية. إذا لم تتوفر بيانات كافية، صرّح بذلك. لا تقدم تشخيصًا طبيًا أو ضمانًا ماليًا أو قانونيًا.
أنشئ 3 مسارات متمايزة: إيجابي/أفضل نسبيًا، متوازن/أساسي، وصعب/أسوأ نسبيًا. اشرح أن كل مسار مشروط بافتراضات.
اجعل الوصف مفيدًا ومحددًا، لا كلامًا عامًا. اذكر العوامل الأكثر تأثيرًا وأسئلة تساعد المستخدم على التحقق من الافتراضات.
أعد JSON فقط وفق البنية التالية:
{
 "summary":"ملخص موجز",
 "confidence":"وصف لفظي للثقة وسببها، دون نسبة مئوية مخترعة",
 "key_factors":["عامل 1","عامل 2","عامل 3"],
 "questions_to_check":["سؤال 1","سؤال 2"],
 "paths":[
  {"type":"مسار إيجابي","title":"عنوان قصير","description":"شرح المسار وشروطه","conditions":"الافتراضات الأساسية"},
  {"type":"مسار متوازن","title":"عنوان قصير","description":"شرح المسار وشروطه","conditions":"الافتراضات الأساسية"},
  {"type":"مسار صعب","title":"عنوان قصير","description":"شرح المسار وشروطه","conditions":"الافتراضات الأساسية"}
 ]
}`;
    const input = `نوع السيناريو: ${category}\nالسيناريو الذي كتبه المستخدم:\n${scenario.trim()}\n\nتفاصيل إضافية من المستخدم:\n${String(context).trim() || "لم يقدّم تفاصيل إضافية."}`;

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        instructions,
        input,
        max_output_tokens: 1600
      })
    });

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = payload?.error?.message || "تعذّر على مزوّد الذكاء الاصطناعي معالجة الطلب.";
      return res.status(502).json({ error: message });
    }

    let outputText = payload.output_text;
    if (!outputText && Array.isArray(payload.output)) {
      outputText = payload.output
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(part => part.type === "output_text")
        .map(part => part.text)
        .join("\n");
    }
    if (!outputText) {
      return res.status(502).json({ error: "لم يرجع النموذج نص تحليل قابلًا للقراءة." });
    }

    const cleaned = outputText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: "لم يكن رد النموذج بصيغة JSON سليمة. حاول مرة أخرى." });
    }
    if (!analysis || !Array.isArray(analysis.paths)) {
      return res.status(502).json({ error: "رد التحليل لا يحتوي على المسارات المطلوبة." });
    }
    res.json({ analysis, model: MODEL });
  } catch (error) {
    console.error("Scenario analysis error:", error);
    res.status(500).json({ error: "حدث خطأ داخلي أثناء التحليل. حاول مرة أخرى." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SOMNIA AI is running on http://localhost:${PORT}`);
  console.log(`AI key configured: ${Boolean(API_KEY)}; model: ${MODEL}`);
});
